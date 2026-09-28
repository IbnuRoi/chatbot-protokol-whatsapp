import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';
import { ENV } from '../config/env';
import { ExtractedSuratData } from './sessionService';
import { splitPicNameAndPhone } from '../utils/textHelper';

/**
 * Memformat rumusan Perihal resmi sesuai formula template resmi berdasarkan kategori surat:
 * - UND - Undangan Menghadiri (Nama Acara) dengan tema (Tema Acara) yang diselenggarakan oleh (Penyelenggara)
 * - PH - Permohonan Memberikan (Sesi Acara(Sambutan/Keynote Speech/Arahan dll) pada kegiatan (Nama Acara) dengan tema (Tema Acara) yang diselenggarakan oleh (Penyelenggara)
 * - UNR - Undangan Menghadiri Pernikahan (Nama Mempelai) (Putri Bapak … dan Ibu …) dengan (Nama Mempelai) (Putri Bapak … dan Ibu …)
 * - WR, AU - Permohonan Wawancara/Audiensi dari (Nama Instansi) terkait (Pokok Bahasan)
 * - TAP - Permohonan Memberikan Video Ucapan dalam rangka ….
 */
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Cek apakah nama instansi/organisasi sudah disebutkan di dalam teks acara
 */
export function isOrganizationMentioned(org: string, text: string): boolean {
  if (!org || !text) return false;
  const cleanOrg = org.trim().toLowerCase();
  const cleanText = text.trim().toLowerCase();

  if (cleanOrg === 'penyelenggara' || cleanOrg === 'instansi terkait' || cleanOrg === '-') return true;

  // 1. Cek exact inclusion
  if (cleanText.includes(cleanOrg)) return true;

  // 2. Cek akronim di dalam tanda kurung, misal "FSPTI" dari "Federasi Serikat Pekerja Transport Indonesia (FSPTI - KSPSI)"
  const parenMatch = org.match(/\(([^)]+)\)/);
  if (parenMatch && parenMatch[1]) {
    const acronyms = parenMatch[1].split(/[-–—/,\s]+/).map(s => s.trim()).filter(s => s.length >= 3);
    for (const acr of acronyms) {
      if (new RegExp(`\\b${escapeRegExp(acr)}\\b`, 'i').test(cleanText)) {
        return true;
      }
    }
  }

  // 3. Cek nama pokok sebelum tanda kurung jika minimal 8 karakter
  const mainName = cleanOrg.replace(/\s*\([^)]*\)/g, '').trim();
  if (mainName.length >= 8 && cleanText.includes(mainName)) {
    return true;
  }

  // 4. Cek token kapital/akronim mandiri pada nama instansi (misal: "KSPSI", "APINDO", "BPJS", "KADIN", "TELKOM")
  const tokens = org.split(/[\s,./()\-–—]+/).filter(t => t.length >= 3 && t === t.toUpperCase() && !/^\d+$/.test(t));
  for (const token of tokens) {
    if (new RegExp(`\\b${escapeRegExp(token)}\\b`, 'i').test(cleanText)) {
      return true;
    }
  }

  return false;
}

/**
 * Membersihkan sesi acara (khusus kategori PH) agar tidak mengulang nama acara atau frasa pengantar
 */
export function cleanSesiAcara(rawSesi: string | undefined, namaAcara?: string): string {
  if (!rawSesi || rawSesi.trim() === '-' || rawSesi.trim() === '') {
    return 'Sambutan dan Arahan';
  }

  let s = rawSesi.trim();

  // Bersihkan prefix seperti "permohonan memberikan", "memberikan", "hadir untuk", dll.
  s = s.replace(/^(?:permohonan|surat)\s+(?:memberikan|menjadi|hadir)?\s*/i, '')
       .replace(/^(?:memberikan|menjadi|sebagai)\s+/i, '')
       .trim();

  const lowerSesi = s.toLowerCase();
  const lowerAcara = (namaAcara || '').toLowerCase();

  // Standarisasi sesi umum jika AI mengekstrak terlalu bertele-tele
  if (lowerSesi.includes('keynote speech') || lowerSesi.includes('keynote')) {
    return 'Keynote Speech';
  }
  if (lowerSesi.includes('narasumber') || lowerSesi.includes('pembicara')) {
    return 'Narasumber';
  }
  if (lowerSesi.includes('membuka')) {
    return 'Membuka Acara';
  }
  if (lowerSesi.includes('sambutan') && lowerSesi.includes('arahan')) {
    return 'Sambutan dan Arahan';
  }
  if (lowerSesi.includes('sambutan')) {
    if (lowerSesi.includes('pembukaan') && !lowerAcara.includes('pembukaan')) {
      return 'Sambutan pada Pembukaan';
    }
    return 'Sambutan';
  }
  if (lowerSesi.includes('arahan')) {
    return 'Arahan';
  }

  // Jika sesi masih mengandung nama acara yang sama, potong bagian pengulangan acara
  if (lowerAcara) {
    s = s.replace(/\s+(?:pada|dalam|terkait|dalam rangka)\s+(?:kegiatan|acara)?\s*.*$/i, '').trim();
  }

  return s || 'Sambutan dan Arahan';
}

/**
 * Membersihkan nama acara agar bebas dari awalan permohonan/undangan dan imbuhan penyelenggara di akhir
 */
export function cleanNamaAcara(rawAcara: string, penyelenggara?: string): string {
  if (!rawAcara || rawAcara === '-') return 'Kegiatan';

  let clean = rawAcara.trim();

  // 1. Bersihkan awalan permohonan / undangan / surat
  clean = clean
    .replace(/^(?:permohonan|undangan|surat)\s+(?:memberikan|menjadi|menghadiri|kehadiran|resmi)?\s*/i, '')
    .replace(/^(?:keynote speech|sambutan|arahan|narasumber)?\s*(?:pada|dalam rangka)?\s*(?:kegiatan|acara|pembukaan)?\s*/i, '')
    .replace(/^(?:kegiatan|acara)\s+/i, '')
    .trim();

  // 2. Jika nama acara mengulang "Pembukaan X pada X", sederhanakan
  const repeatEventMatch = clean.match(/^pembukaan\s+(.+?)\s+pada\s+(?:kegiatan|acara)?\s*(.+)$/i);
  if (repeatEventMatch) {
    const part1 = repeatEventMatch[1].trim();
    const part2 = repeatEventMatch[2].trim();
    if (part2.toLowerCase().includes(part1.toLowerCase()) || part1.toLowerCase().includes(part2.toLowerCase())) {
      clean = part2;
    }
  }

  // 3. Bersihkan jika nama acara memiliki akhiran "yang diselenggarakan oleh ..."
  clean = clean.replace(/\s+(?:yang\s+)?(?:diselenggarakan|diadakan|dilaksanakan)\s+oleh\s+.*$/i, '').trim();

  // 4. Bersihkan jika nama acara memiliki akhiran "dengan tema ..."
  clean = clean.replace(/\s+dengan tema\s+.*$/i, '').trim();

  // 5. Jika nama acara diakhiri dengan " - [Penyelenggara]" yang sama dengan instansi penyelenggara
  if (penyelenggara && penyelenggara !== '-' && penyelenggara !== 'Instansi Terkait') {
    const cleanP = penyelenggara.replace(/\s*\([^)]*\)/g, '').trim();
    const pRegex = new RegExp(`\\s*[-–—]\\s*(?:${escapeRegExp(penyelenggara)}|${escapeRegExp(cleanP)})\\s*$`, 'i');
    clean = clean.replace(pRegex, '').trim();
  }

  return clean || rawAcara.trim();
}

/**
 * Membersihkan frasa yang berulang secara redundant dalam sebuah kalimat
 */
export function cleanRedundantSentence(text: string): string {
  if (!text) return '';
  let clean = text.replace(/\s+/g, ' ').trim();

  // Bersihkan double prefix dan benturan preposisi
  clean = clean.replace(/\b(permohonan memberikan)\s+(?:permohonan\s+)?(?:memberikan\s+)?(sambutan|keynote speech|arahan|narasumber)\b/gi, '$1 $2')
               .replace(/\b(undangan menghadiri)\s+(?:undangan\s+)?(?:menghadiri\s+)?/gi, '$1 ')
               .replace(/\bpada\s+pembukaan\s+pada\s+kegiatan\b/gi, 'pada pembukaan')
               .replace(/\bpada\s+pembukaan\s+kegiatan\b/gi, 'pada pembukaan')
               .replace(/\bpada\s+kegiatan\s+pada\s+kegiatan\b/gi, 'pada kegiatan')
               .replace(/\b(pada kegiatan)\s+(?:pada\s+)?(?:kegiatan\s+)?/gi, '$1 ')
               .replace(/\b(yang diselenggarakan oleh)\s+(?:yang\s+)?(?:diselenggarakan\s+)?(?:oleh\s+)?/gi, '$1 ');

  // Bersihkan kata berulang berturut-turut (misal "Rakornas Rakornas", "pada pada")
  clean = clean.replace(/\b([a-zA-Z0-9]{3,})\s+\1\b/gi, '$1');

  // Bersihkan jika ada klausul penyelenggara yang berulang persis dua kali berturut-turut
  clean = clean.replace(/(yang diselenggarakan oleh\s+[^,.]+?)\s+yang diselenggarakan oleh\s+\1/gi, '$1');

  return clean.replace(/\s+/g, ' ').trim();
}

export function formatPerihalByTemplate(data: Partial<ExtractedSuratData>): string {
  const kat = (data.kategoriSurat || 'UND').toUpperCase();
  const penyelenggaraRaw = (data.penyelenggara || '').trim();
  let penyelenggara = penyelenggaraRaw;
  if (!penyelenggara || penyelenggara === '-' || penyelenggara === 'Instansi Terkait') {
    if (data.asalSurat && !data.asalSurat.includes(' - ')) {
      penyelenggara = data.asalSurat.trim();
    } else {
      penyelenggara = 'Penyelenggara';
    }
  }

  const rawAcara = (data.namaAcara || data.event || data.subject || 'Kegiatan').trim();
  const namaAcara = cleanNamaAcara(rawAcara, penyelenggara);

  const rawTema = data.temaAcara && data.temaAcara !== '-' ? data.temaAcara.trim() : '';
  const tema = rawTema && rawTema.toLowerCase() !== namaAcara.toLowerCase() ? rawTema : '';

  // Periksa apakah penyelenggara sudah disebut di dalam namaAcara agar tidak redundant
  const orgAlreadyMentioned = isOrganizationMentioned(penyelenggara, namaAcara);
  const byPenyelenggaraClause = !orgAlreadyMentioned && penyelenggara !== 'Penyelenggara' && penyelenggara !== 'Instansi Terkait'
    ? ` yang diselenggarakan oleh ${penyelenggara}`
    : '';

  let result = '';

  switch (kat) {
    case 'UND': {
      if (tema) {
        result = `Undangan Menghadiri ${namaAcara} dengan tema "${tema}"${byPenyelenggaraClause}`;
      } else {
        result = `Undangan Menghadiri ${namaAcara}${byPenyelenggaraClause}`;
      }
      break;
    }

    case 'PH': {
      const sesi = cleanSesiAcara(data.sesiAcara, namaAcara);
      let verbPrefix = 'Permohonan Memberikan';
      let connector = ' pada kegiatan ';

      if (sesi.toLowerCase() === 'narasumber' || sesi.toLowerCase() === 'pembicara') {
        verbPrefix = 'Permohonan Menjadi';
        connector = ' pada kegiatan ';
      } else if (sesi.toLowerCase().startsWith('membuka')) {
        verbPrefix = 'Permohonan';
        connector = ' ';
      } else if (sesi.toLowerCase().includes('pada pembukaan') || sesi.toLowerCase().includes('dalam pembukaan')) {
        verbPrefix = 'Permohonan Memberikan';
        connector = ' ';
      } else if (sesi.toLowerCase().includes('pada ') || sesi.toLowerCase().includes('dalam ')) {
        verbPrefix = 'Permohonan Memberikan';
        connector = ' ';
      }

      if (tema) {
        result = `${verbPrefix} ${sesi}${connector}${namaAcara} dengan tema "${tema}"${byPenyelenggaraClause}`;
      } else {
        result = `${verbPrefix} ${sesi}${connector}${namaAcara}${byPenyelenggaraClause}`;
      }
      break;
    }

    case 'UNR': {
      const m1 = data.mempelai1 && data.mempelai1 !== '-' ? data.mempelai1.trim() : '';
      const m2 = data.mempelai2 && data.mempelai2 !== '-' ? data.mempelai2.trim() : '';
      if (m1 && m2) {
        result = `Undangan Menghadiri Pernikahan ${m1} dengan ${m2}`;
      } else if (m1 || m2) {
        result = `Undangan Menghadiri Pernikahan ${m1 || m2}`;
      } else {
        result = `Undangan Menghadiri Pernikahan ${namaAcara}`;
      }
      break;
    }

    case 'WR': {
      const pokok = data.pokokBahasan && data.pokokBahasan !== '-' ? data.pokokBahasan.trim() : (data.subject || 'Isu Terkini Ketenagakerjaan');
      result = `Permohonan Wawancara dari ${penyelenggara} terkait ${pokok}`;
      break;
    }

    case 'AU': {
      const pokok = data.pokokBahasan && data.pokokBahasan !== '-' ? data.pokokBahasan.trim() : (data.subject || 'Silaturahmi dan Pembahasan Isu Ketenagakerjaan');
      result = `Permohonan Audiensi dari ${penyelenggara} terkait ${pokok}`;
      break;
    }

    case 'TAP': {
      const rangka = data.rangkaUcapan && data.rangkaUcapan !== '-' ? data.rangkaUcapan.trim() : (namaAcara || 'Peringatan Hari Besar');
      result = `Permohonan Memberikan Video Ucapan dalam rangka ${rangka}`;
      break;
    }

    case 'LP': {
      const judul = namaAcara || data.subject || 'Pelaksanaan Kegiatan';
      result = `Laporan ${judul}${byPenyelenggaraClause}`;
      break;
    }

    default: {
      result = `Surat dari ${penyelenggara} terkait ${namaAcara}`;
      break;
    }
  }

  return cleanRedundantSentence(result);
}

/**
 * Memformat dan merapikan kolom Asal Surat:
 * Format WAJIB: "Nama Pengirim - Jabatan" (nama individu/pejabat yang bertanda tangan di paling bawah, bukan instansi).
 * ATURAN: Jika ada beberapa orang penandatangan (misal: Ketua & Sekretaris, atau beberapa pimpinan),
 * pilih salah satu saja namanya beserta jabatannya yang sesuai.
 */
export function formatAsalSurat(raw: string, fallbackJabatan?: string): string {
  if (!raw || raw.trim() === '-' || raw.trim() === '') return '-';
  let clean = raw.trim().replace(/^[\*•\-\s]+/, '');

  // 1. Bersihkan penomoran awal seperti "1. ", "1) ", dsb.
  clean = clean.replace(/^(?:(?:1\.|1\)|nomor\s*1|ke-?1)\s*)/i, '').trim();

  // Delimiter untuk memisahkan beberapa orang penandatangan
  const multiPersonSplitter = /(?:\r?\n+|;\s*|\s+(?:dan|serta|&|\/)\s+|\s*(?=\b2[\.\)]\s+))/i;

  const dashCount = (clean.match(/\s+-\s+/g) || []).length;

  if (dashCount > 1) {
    // KASUS A: Ada beberapa pasang "Nama - Jabatan"
    // Contoh: "Dr. Budi Santoso - Ketua Umum dan Ahmad Fauzi, S.E. - Sekretaris Jenderal"
    const segments = clean.split(multiPersonSplitter)
      .map(s => s.trim().replace(/^(?:(?:1\.|1\)|2\.|2\))\s*)/, ''))
      .filter(s => s.includes(' - '));
    if (segments.length > 0) {
      clean = segments[0];
    }
  } else if (dashCount === 1) {
    // KASUS B: Ada tepat satu strip " - "
    // Sub-kasus B1: "Budi Santoso dan Ahmad Fauzi - Ketua dan Sekretaris"
    // Sub-kasus B2: "Budi Santoso - Ketua Umum dan Ahmad Fauzi"
    const parts = clean.split(' - ');
    let name = parts[0].trim();
    let jabatan = parts.slice(1).join(' - ').trim();

    // Jika pada bagian nama terdapat lebih dari satu orang (misal: "Budi Santoso dan Ahmad Fauzi")
    if (/\s+(?:dan|&|serta|\/)\s+/i.test(name)) {
      name = name.split(/\s+(?:dan|&|serta|\/)\s+/i)[0].trim();
    }
    // Jika pada bagian jabatan terdapat lebih dari satu jabatan (misal: "Ketua dan Sekretaris")
    // atau kelanjutan nama orang kedua (misal: "Ketua Umum dan Ahmad Fauzi")
    if (/\s+(?:dan|&|serta|\/)\s+/i.test(jabatan)) {
      jabatan = jabatan.split(/\s+(?:dan|&|serta|\/)\s+/i)[0].trim();
    }

    if (name && jabatan) {
      return `${name} - ${jabatan}`.slice(0, 220);
    }
  } else {
    // KASUS C: Tidak ada strip " - " sama sekali
    // Contoh: "Budi Santoso (Ketua Umum) dan Ahmad Fauzi (Sekretaris)"
    // atau "Dr. Budi Santoso, Ketua Umum dan Ahmad Fauzi, Sekretaris"
    const segments = clean.split(multiPersonSplitter)
      .map(s => s.trim().replace(/^(?:(?:1\.|1\)|2\.|2\))\s*)/, ''))
      .filter(Boolean);
    if (segments.length > 1) {
      clean = segments[0];
    }
  }

  // Cek format "Nama (Jabatan)"
  const parenMatch = clean.match(/^([^\(\)\n]+?)\s*\(([^\)\n]+)\)/);
  if (parenMatch) {
    const name = parenMatch[1].trim();
    const jab = parenMatch[2].trim();
    if (name && jab) {
      return `${name} - ${jab}`.slice(0, 220);
    }
  }

  // Cek format "Nama - Jabatan"
  if (clean.includes(' - ')) {
    const parts = clean.split(' - ');
    let name = parts[0].trim();
    let jabatan = parts.slice(1).join(' - ').trim();
    if (/\s+(?:dan|&|serta|\/)\s+/i.test(name)) {
      name = name.split(/\s+(?:dan|&|serta|\/)\s+/i)[0].trim();
    }
    if (/\s+(?:dan|&|serta|\/)\s+/i.test(jabatan)) {
      jabatan = jabatan.split(/\s+(?:dan|&|serta|\/)\s+/i)[0].trim();
    }
    if (name && jabatan) {
      return `${name} - ${jabatan}`.slice(0, 220);
    }
  }

  // Cek format "Nama, Jabatan" (gunakan greedy .* agar koma gelar tidak memotong nama)
  const commaJabatanMatch = clean.match(
    /^(.*),\s*(Menteri|Wakil Menteri|Sekretaris Jenderal|Sekjen|Sekretaris|Direktur Jenderal|Dirjen|Direktur Utama|Direktur|Kepala Badan|Kepala Dinas|Kepala Biro|Kepala Bagian|Kepala|Ketua Umum|Ketua Panitia|Ketua|Rektor|Dekan|Pimpinan|Deputi|Manager|General Manager|Presiden Direktur|Presiden|Bupati|Walikota|Gubernur|Koordinator|Kuasa Direksi|Kuasa)(.*)$/i
  );
  if (commaJabatanMatch) {
    let name = commaJabatanMatch[1].trim();
    let jabatan = `${commaJabatanMatch[2]}${commaJabatanMatch[3]}`.trim();
    if (/\s+(?:dan|&|serta|\/)\s+/i.test(jabatan)) {
      jabatan = jabatan.split(/\s+(?:dan|&|serta|\/)\s+/i)[0].trim();
    }
    if (/\s+(?:dan|&|serta|\/)\s+/i.test(name)) {
      name = name.split(/\s+(?:dan|&|serta|\/)\s+/i)[0].trim();
    }
    return `${name} - ${jabatan}`.slice(0, 220);
  }

  // Fallback jika belum ada strip dan ada fallbackJabatan
  if (fallbackJabatan && fallbackJabatan !== '-' && !clean.includes(' - ')) {
    let name = clean;
    if (/\s+(?:dan|&|serta|\/)\s+/i.test(name)) {
      name = name.split(/\s+(?:dan|&|serta|\/)\s+/i)[0].trim();
    }
    return `${name} - ${fallbackJabatan}`.slice(0, 220);
  }

  return clean.slice(0, 220);
}

/**
 * Menghasilkan ringkasan padat untuk kolom Subject (maksimal 200 karakter)
 * yang diringkas secara cerdas dari Perihal resmi yang telah di-generate sebelumnya.
 */
export function generateSubjectSummary(perihal: string, data?: Partial<ExtractedSuratData>): string {
  if (!perihal || perihal === '-') return '-';

  const kat = (data?.kategoriSurat || '').toUpperCase();
  const penyelenggara = (data?.penyelenggara || '').trim();
  const rawAcara = (data?.namaAcara || data?.event || '').trim();
  const cleanAcara = cleanNamaAcara(rawAcara, penyelenggara);

  let shortAcara = cleanAcara;
  if (shortAcara.length > 90 && shortAcara.includes(' - ')) {
    shortAcara = shortAcara.split(' - ')[0].trim();
  }

  let summary = '';

  switch (kat) {
    case 'PH': {
      const sesi = cleanSesiAcara(data?.sesiAcara, shortAcara);
      const pokokSesi = sesi.replace(/\s+(?:pada|dalam)\s+.*$/i, '').trim();
      summary = `Permohonan ${pokokSesi || sesi} - ${shortAcara}`;
      break;
    }
    case 'UND': {
      summary = `Undangan - ${shortAcara}`;
      break;
    }
    case 'UNR': {
      const m1 = (data?.mempelai1 || '').replace(/\s*\(.*?\)/g, '').trim();
      const m2 = (data?.mempelai2 || '').replace(/\s*\(.*?\)/g, '').trim();
      if (m1 && m2) {
        summary = `Undangan Pernikahan ${m1} & ${m2}`;
      } else {
        summary = `Undangan Pernikahan ${shortAcara}`;
      }
      break;
    }
    case 'AU': {
      const pokok = data?.pokokBahasan && data.pokokBahasan !== '-' ? data.pokokBahasan.trim() : '';
      if (penyelenggara && pokok && !isOrganizationMentioned(penyelenggara, pokok)) {
        summary = `Permohonan Audiensi ${penyelenggara} - ${pokok}`;
      } else if (penyelenggara && penyelenggara !== 'Instansi Terkait' && penyelenggara !== 'Penyelenggara') {
        summary = `Permohonan Audiensi - ${penyelenggara}`;
      } else {
        summary = `Permohonan Audiensi - ${shortAcara}`;
      }
      break;
    }
    case 'WR': {
      const pokok = data?.pokokBahasan && data.pokokBahasan !== '-' ? data.pokokBahasan.trim() : '';
      if (penyelenggara && pokok && !isOrganizationMentioned(penyelenggara, pokok)) {
        summary = `Permohonan Wawancara ${penyelenggara} - ${pokok}`;
      } else if (penyelenggara && penyelenggara !== 'Instansi Terkait' && penyelenggara !== 'Penyelenggara') {
        summary = `Permohonan Wawancara - ${penyelenggara}`;
      } else {
        summary = `Permohonan Wawancara - ${shortAcara}`;
      }
      break;
    }
    case 'TAP': {
      const rangka = data?.rangkaUcapan && data.rangkaUcapan !== '-' ? data.rangkaUcapan.trim() : shortAcara;
      summary = `Permohonan Video Ucapan - ${rangka}`;
      break;
    }
    case 'LP': {
      summary = `Laporan Pelaksanaan - ${shortAcara}`;
      break;
    }
    default:
      summary = perihal;
      break;
  }

  // Jika formula belum menghasilkan ringkasan atau sama persis dengan perihal, pangkas klausul panjang dari perihal
  if (!summary || summary === perihal) {
    summary = perihal
      .replace(/\s+dengan tema\s+"[^"]+"/i, '')
      .replace(/\s+dengan tema\s+[^\s,]+/i, '')
      .replace(/\s+yang diselenggarakan oleh\s+.*$/i, '')
      .trim();
  }

  summary = cleanRedundantSentence(summary);

  // Pastikan maksimal 200 karakter
  if (summary.length > 200) {
    summary = summary.slice(0, 197).trim() + '...';
  }

  return summary || perihal.slice(0, 200);
}

export class AiService {
  private genAiClient: GoogleGenAI | null = null;
  private openAiClient: OpenAI | null = null;

  constructor() {
    this.initClients();
  }

  private initClients(): void {
    const pdfKey = (ENV.PDF_EXTRACTION_API_KEY || ENV.GEMINI_API_KEY || '').trim();
    const chatKey = (ENV.CHAT_API_KEY || ENV.OPENROUTER_API_KEY || '').trim();
    const apiKey = pdfKey || chatKey;

    if (!apiKey) return;

    const provider = (ENV.PDF_EXTRACTION_PROVIDER || '').toLowerCase();

    // Jika pengguna mengisi GEMINI_API_KEY / PDF_EXTRACTION_API_KEY dengan key Google Gemini (bukan sk-) dan provider 'gemini'
    if (pdfKey && !pdfKey.startsWith('sk-') && provider === 'gemini') {
      this.genAiClient = new GoogleGenAI({ apiKey: pdfKey });
    } else {
      // Menggunakan OpenRouter (baik key gratis CHAT_API_KEY maupun key berbayar yang dimasukkan ke PDF_EXTRACTION_API_KEY / OPENROUTER_API_KEY)
      this.openAiClient = new OpenAI({
        baseURL: 'https://openrouter.ai/api/v1',
        apiKey,
        timeout: 45000,
        defaultHeaders: {
          'HTTP-Referer': 'https://kemnaker.go.id',
          'X-Title': 'Kemnaker Protokol PDF Extractor',
        },
      });
    }
  }

  /**
   * Ekstraksi metadata surat dari teks dokumen
   */
  public async extractSuratData(pdfText: string, originalFileName?: string): Promise<ExtractedSuratData> {
    return this.extractDocumentMetadata(pdfText, originalFileName);
  }

  public async extractDocumentMetadata(pdfText: string, originalFileName?: string): Promise<ExtractedSuratData> {
    const isUsingOpenRouter = Boolean(this.openAiClient);
    let model = 'openrouter/free';

    if (isUsingOpenRouter) {
      // Jika pengguna memasukkan API key OpenRouter berbayar ke PDF_EXTRACTION_API_KEY atau OPENROUTER_API_KEY
      if (ENV.PDF_EXTRACTION_API_KEY && ENV.PDF_EXTRACTION_API_KEY.startsWith('sk-')) {
        // Jika model disetel khusus (misal google/gemini-2.5-flash, openai/gpt-4o-mini, dll), gunakan model tersebut
        model = ENV.PDF_EXTRACTION_MODEL && !ENV.PDF_EXTRACTION_MODEL.startsWith('gemini-')
          ? ENV.PDF_EXTRACTION_MODEL
          : (ENV.PDF_EXTRACTION_MODEL ? `google/${ENV.PDF_EXTRACTION_MODEL}` : 'google/gemini-2.5-flash');
      } else if (ENV.PDF_EXTRACTION_PROVIDER === 'openrouter' && ENV.PDF_EXTRACTION_MODEL) {
        model = ENV.PDF_EXTRACTION_MODEL;
      } else {
        model = ENV.CHAT_MODEL || 'openrouter/free';
      }
    } else {
      model = ENV.PDF_EXTRACTION_MODEL || 'gemini-2.5-flash';
    }

    // 1. Ekstraksi cerdas menggunakan AI
    if ((this.genAiClient || this.openAiClient) && pdfText.trim().length > 20) {
      try {
        const prompt = `Anda adalah asisten AI Protokol Kementerian Ketenagakerjaan (Kemnaker) yang ahli dalam menganalisis dokumen surat dinas masuk.

TUGAS UTAMA:
1. Pahami isi keseluruhan teks dokumen surat resmi berikut.
2. Tentukan KATEGORI SURAT (kategoriSurat) secara akurat dari salah satu kode berikut:
   - "UND" : Undangan Menghadiri acara/rapat/seminar/konferensi/FGD/diskusi/lokakarya/dies natalis/peringatan umum (BUKAN pernikahan, BUKAN meminta pimpinan memberi sambutan/speech khusus).
   - "PH"  : Permohonan Hadir yang meminta Menteri / Pimpinan Kemnaker untuk MEMBERIKAN SAMBUTAN, KEYNOTE SPEECH, ARAHAN, MEMBUKA ACARA, atau menjadi NARASUMBER / PEMBICARA.
   - "UNR" : Undangan Pernikahan (akad nikah, resepsi pernikahan, walimah, ngunduh mantu).
   - "AU"  : Permohonan Audiensi / Silaturahmi resmi / Tatap muka / Kunjungan kehormatan dari instansi, organisasi, atau serikat pekerja.
   - "WR"  : Permohonan Wawancara / Peliputan khusus dari media / pers / jurnalis.
   - "TAP" : Permohonan pembuatan atau rekaman Video Ucapan (selamat ulang tahun, harlah, milad, perayaan hari jadi).
   - "LP"  : Dokumen Laporan (laporan kegiatan, laporan pelaksanaan, pertanggungjawaban).

3. Aturan ekstraksi entitas secara presisi:
   - "kategoriSurat": "UND" | "PH" | "UNR" | "WR" | "AU" | "TAP" | "LP"
   - "alasanKategori": "penjelasan singkat mengapa dokumen masuk kategori ini"
   - "nomorSurat": "nomor registrasi surat dinas resmi (CONTOH: 'HM.4.6/189/D.IV.M.EKON/09/2026' atau 'B-102/DIR/IX/2026'). SANGAT PENTING: JANGAN mengambil nomor jalan/alamat pengirim/penerima (seperti 'No. 2-4' atau 'Kav. 51')!"
   - "tanggalSurat": "tanggal surat dibuat dalam bahasa Indonesia (misal: '15 September 2026')"
   - "namaPengirim": "nama lengkap orang/pejabat pengirim yang menandatangani surat di bagian paling bawah surat beserta gelarnya jika ada (CONTOH: 'Dr. Ir. Rudy Salahuddin, MEM' atau 'Budi Santoso, S.E.'). BUKAN instansi! JIKA ADA BEBERAPA ORANG PENANDATANGAN (misal: Ketua dan Sekretaris, atau beberapa pimpinan): PILIH SALAH SATU NAMA SAJA (utamakan penandatangan pertama/jabatan tertinggi). JANGAN menggabungkan beberapa nama!"
   - "jabatanPengirim": "jabatan resmi orang/pejabat yang menandatangani surat di bagian paling bawah surat yang SESUAI DENGAN namaPengirim yang dipilih (CONTOH: 'Deputi Bidang Koordinasi Ekonomi Digital' atau 'Direktur Utama' atau 'Ketua Umum'). BUKAN instansi!"
   - "asalSurat": "gabungan nama pengirim yang bertanda tangan di paling bawah dan jabatannya dengan format 'Nama Pengirim - Jabatan' (CONTOH: 'Dr. Ir. Rudy Salahuddin, MEM - Deputi Bidang Koordinasi Ekonomi Digital' atau 'Budi Santoso - Direktur Utama'). ATURAN MUTLAK: Isi asal surat BUKAN instansi pengirim, melainkan NAMA PENGIRIM YANG BERTANDA TANGAN DI PALING BAWAH dengan format 'Nama Pengirim - Jabatan'! JIKA ADA BEBERAPA ORANG PENANDATANGAN, PILIH SALAH SATU NAMA SAJA BESERTA JABATANNYA YANG SESUAI (jangan gabungkan beberapa nama orang)!"
   - "penyelenggara": "nama lembaga/instansi/organisasi pengirim atau penyelenggara acara dari KOP SURAT teratas atau stempel resmi (CONTOH: 'Kementerian Koordinator Bidang Perekonomian' atau 'PT Telekomunikasi Indonesia Tbk' atau 'Institut Pertanian Bogor')"
   - "namaAcara": "nama murni acara/kegiatan saja (CONTOH: 'Rapat Kerja Nasional (Rakornas) VII Tahun 2026' atau 'Forum Koordinasi Ketenagakerjaan Nasional 2026'). HAPUS dan JANGAN masukkan kata pengantar permohonan seperti 'Permohonan Sambutan pada Pembukaan' atau 'Undangan Menghadiri' atau nama instansi penyelenggara di bagian akhir acara!"
   - "temaAcara": "tema spesifik acara jika ada tertulis (misal: 'Transformasi Tenaga Kerja Menuju Indonesia Emas 2045', atau '-' jika tidak ada tema)"
   - "sesiAcara": "khusus kategori PH, peran/sesi yang dimohonkan kepada Menteri / Pimpinan Kemnaker (CONTOH: 'Sambutan', 'Keynote Speech', 'Sambutan dan Arahan', 'Membuka Acara', 'Narasumber'). HANYA sebutkan jenis perannya saja, JANGAN memasukkan nama acara atau nama penyelenggara ke dalam sesiAcara (misal: isi 'Sambutan', BUKAN 'Sambutan dalam Pembukaan Rakornas FSPTI')!"
   - "mempelai1": "jika UNR, nama mempelai 1 dan orang tua (misal: 'Anisa Rahmawati (Putri Bapak Ahmad dan Ibu Siti)', atau '-')"
   - "mempelai2": "jika UNR, nama mempelai 2 dan orang tua (misal: 'Dimas Pratama (Putra Bapak Bambang dan Ibu Sri)', atau '-')"
   - "pokokBahasan": "jika WR/AU, pokok bahasan audiensi atau wawancara (atau '-')"
   - "rangkaUcapan": "jika TAP, rangka pembuatan video ucapan (misal: 'Hari Ulang Tahun ke-75 PT Aneka Tambang Tbk', atau '-')"
   - "picName": "nama lengkap orang PIC / Narahubung / Contact Person jika tertera di surat (CONTOH: 'Sdr. Ahmad Fauzi' atau 'Budi Santoso'). BUKAN nomor telepon! Jika tidak ada, isi '-'"
   - "picPhoneNumber": "nomor HP / telepon / WhatsApp dari PIC (CONTOH: '081234567890' atau '+6281234567890'). HANYA digit nomor kontak tanpa nama! Jika tidak ada, isi '-'"
   - "picPengirim": "gabungan nama PIC dan nomor telepon (CONTOH: 'Ahmad Fauzi (081234567890)'). Jika tidak ada, isi '-'"
   - "dateEvent": "hari/tanggal dan/atau waktu pelaksanaan acara/kegiatan/event yang disebutkan di dalam isi surat (CONTOH: 'Senin, 20 Oktober 2026' atau '20 Oktober 2026' atau '25 - 27 November 2026'). BUKAN tanggal pembuatan surat! Jika surat TIDAK memiliki tanggal event/acara (misalnya surat laporan biasa, pemberitahuan tanpa acara, dll), isi '-'"

KEMBALIKAN OUTPUT HANYA DALAM FORMAT JSON VALID TANPA MARKDOWN (\`\`\`json) DAN TANPA PENJELASAN LAIN:

TEKS SURAT:
${pdfText.slice(0, 6000)}
`;

        let rawText = '';
        if (this.openAiClient) {
          const res = await this.openAiClient.chat.completions.create({
            model,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.1,
            max_tokens: 2500,
          });
          rawText = res.choices?.[0]?.message?.content || '';
          if (!rawText && (res.choices?.[0]?.message as any)?.reasoning) {
            rawText = (res.choices?.[0]?.message as any).reasoning;
          }
        } else if (this.genAiClient) {
          const res = await this.genAiClient.models.generateContent({
            model,
            contents: prompt,
          });
          rawText = res.text || '';
        }

        const clean = rawText.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
        const cleanJson = clean.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
        const jsonMatch = cleanJson.match(/\{[\s\S]*\}/);

        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);

          const kategori: 'UND' | 'PH' | 'UNR' | 'WR' | 'AU' | 'TAP' | 'LP' =
            parsed.kategoriSurat && ['UND', 'PH', 'UNR', 'WR', 'AU', 'TAP', 'LP'].includes(parsed.kategoriSurat)
              ? parsed.kategoriSurat
              : 'UND';

          const extractedPenyelenggara = (parsed.penyelenggara || '').trim();
          // Bersihkan nama acara dan peran sesi acara agar bebas dari pengulangan/redundansi
          const rawAcara = (parsed.namaAcara || parsed.event || '-').trim();
          const cleanAcara = cleanNamaAcara(rawAcara, extractedPenyelenggara);
          const cleanSesi = cleanSesiAcara(parsed.sesiAcara, cleanAcara);

          // Format asalSurat: WAJIB nama pengirim yang bertanda tangan di paling bawah: "Nama Pengirim - Jabatan" (bukan instansi)
          let finalAsalSurat = (parsed.asalSurat || '').trim();
          const namaPengirim = (parsed.namaPengirim || '').trim();
          const jabatanPengirim = (parsed.jabatanPengirim || '').trim();

          if (namaPengirim && jabatanPengirim && !finalAsalSurat.includes(' - ')) {
            finalAsalSurat = `${namaPengirim} - ${jabatanPengirim}`;
          } else if (!finalAsalSurat || finalAsalSurat === '-') {
            if (namaPengirim && jabatanPengirim) {
              finalAsalSurat = `${namaPengirim} - ${jabatanPengirim}`;
            } else if (namaPengirim) {
              finalAsalSurat = `${namaPengirim} - Pengirim`;
            } else {
              finalAsalSurat = '-';
            }
          }
          finalAsalSurat = formatAsalSurat(finalAsalSurat, jabatanPengirim);

          const rawPicName = (parsed.picName || '').trim();
          const rawPicPhone = (parsed.picPhoneNumber || '').trim();
          const rawPicPengirim = (parsed.picPengirim || '').trim();

          let finalPicName = rawPicName && rawPicName !== '-' ? rawPicName : '-';
          let finalPicPhone = rawPicPhone && rawPicPhone !== '-' ? rawPicPhone : '-';

          // Jika salah satu belum terisi, coba pisahkan dari picPengirim atau saling melengkapi
          if ((finalPicName === '-' || finalPicPhone === '-') && rawPicPengirim && rawPicPengirim !== '-') {
            const splitted = splitPicNameAndPhone(rawPicPengirim);
            if (finalPicName === '-' && splitted.name !== '-') finalPicName = splitted.name;
            if (finalPicPhone === '-' && splitted.phone !== '-') finalPicPhone = splitted.phone;
          } else if (finalPicName !== '-' && finalPicPhone === '-') {
            const splitted = splitPicNameAndPhone(finalPicName);
            if (splitted.phone !== '-') {
              finalPicPhone = splitted.phone;
              finalPicName = splitted.name;
            }
          }

          finalPicName = finalPicName.slice(0, 100);
          finalPicPhone = finalPicPhone.slice(0, 50);

          const finalPicCombined = finalPicName !== '-' && finalPicPhone !== '-'
            ? `${finalPicName} (${finalPicPhone})`
            : (finalPicName !== '-' ? finalPicName : finalPicPhone);

          const rawDateEvent = (parsed.dateEvent || '').trim();
          const cleanDateEvent = (rawDateEvent && rawDateEvent !== '-' && !/^(?:tidak\s+ada|belum\s+ada|null|undefined|-)$/i.test(rawDateEvent))
            ? rawDateEvent.replace(/^[\*•\-\s]+/, '').slice(0, 100)
            : undefined;

          const extracted: ExtractedSuratData = {
            kategoriSurat: kategori,
            alasanKategori: parsed.alasanKategori || '',
            tanggalSurat: parsed.tanggalSurat || this.getTodayFormatted(),
            nomorSurat: (parsed.nomorSurat || '-').trim().slice(0, 100),
            subject: cleanAcara || parsed.subject || 'Surat Masuk',
            asalSurat: finalAsalSurat.slice(0, 220),
            event: cleanAcara,
            dateEvent: cleanDateEvent,
            picPengirim: finalPicCombined.slice(0, 100),
            picName: finalPicName,
            picPhoneNumber: finalPicPhone,
            namaAcara: cleanAcara,
            temaAcara: parsed.temaAcara && parsed.temaAcara !== '-' ? parsed.temaAcara : undefined,
            penyelenggara: extractedPenyelenggara && extractedPenyelenggara !== '-' ? extractedPenyelenggara : 'Instansi Terkait',
            sesiAcara: cleanSesi,
            mempelai1: parsed.mempelai1 && parsed.mempelai1 !== '-' ? parsed.mempelai1 : undefined,
            mempelai2: parsed.mempelai2 && parsed.mempelai2 !== '-' ? parsed.mempelai2 : undefined,
            pokokBahasan: parsed.pokokBahasan && parsed.pokokBahasan !== '-' ? parsed.pokokBahasan : undefined,
            rangkaUcapan: parsed.rangkaUcapan && parsed.rangkaUcapan !== '-' ? parsed.rangkaUcapan : undefined,
            perihal: '', // Akan diformat di bawah
          };

          // Format perihal secara ketat mengikuti formula template resmi berdasarkan kategori
          extracted.perihal = formatPerihalByTemplate(extracted);
          // Kolom subject merupakan ringkasan dari isi perihal yang telah digenerate (maks 200 karakter)
          extracted.subject = generateSubjectSummary(extracted.perihal, extracted);
          // Samakan isi dari acara seperti yang ada di perihal, templatenya sama
          extracted.event = extracted.perihal;

          return extracted;
        }
      } catch (err) {
        console.warn(`[AiService] Ekstraksi cerdas AI (${model}) gagal, menggunakan fallback parser:`, err);
      }
    }

    // 2. Fallback Rule-Based Parser (Jika AI Key kosong atau respons tidak sesuai)
    return this.fallbackRuleBasedExtraction(pdfText, originalFileName);
  }

  /**
   * Rekomendasi perihal standar birokrasi berdasarkan konteks surat
   */
  public async generatePerihalRecommendation(context: {
    subject: string;
    asalSurat: string;
    event?: string;
    fullText?: string;
  }): Promise<string> {
    return formatPerihalByTemplate({
      kategoriSurat: 'UND',
      namaAcara: context.event || context.subject,
      penyelenggara: context.asalSurat,
      asalSurat: context.asalSurat,
      subject: context.subject,
    });
  }

  /**
   * Ekstraksi berbasis aturan regex/heuristik jika AI offline
   */
  private fallbackRuleBasedExtraction(text: string, fileName?: string): ExtractedSuratData {
    const lower = text.toLowerCase();

    // 1. Deteksi Kategori berbasis kata kunci
    let kategoriSurat: 'UND' | 'PH' | 'UNR' | 'WR' | 'AU' | 'TAP' | 'LP' = 'UND';
    let sesiAcara: string | undefined;

    if (/pernikahan|akad nikah|resepsi pernikahan|walimatul/i.test(lower)) {
      kategoriSurat = 'UNR';
    } else if (/video ucapan|ucapan video|rekaman ucapan/i.test(lower)) {
      kategoriSurat = 'TAP';
    } else if (/wawancara|peliputan media|liputan pers/i.test(lower)) {
      kategoriSurat = 'WR';
    } else if (/audiensi|silaturahmi|kunjungan kehormatan|tatap muka/i.test(lower)) {
      kategoriSurat = 'AU';
    } else if (/keynote speech|memberikan arahan|sambutan|narasumber|pembicara|membuka acara/i.test(lower)) {
      kategoriSurat = 'PH';
      if (/keynote speech/i.test(lower)) {
        sesiAcara = 'Keynote Speech';
      } else if (/narasumber|pembicara/i.test(lower)) {
        sesiAcara = 'Narasumber';
      } else if (/arahan/i.test(lower)) {
        sesiAcara = 'Arahan';
      } else {
        sesiAcara = 'Sambutan dan Arahan';
      }
    } else if (/laporan kegiatan|laporan pertanggungjawaban|laporan hasil/i.test(lower)) {
      kategoriSurat = 'LP';
    } else {
      kategoriSurat = 'UND';
    }

    // 2. Cari nomor surat (hindari nomor jalan / alamat seperti Jl. ... No. 2-4)
    const lines = text.split('\n');
    let nomorSurat = '-';
    for (const line of lines) {
      const trimmed = line.trim();
      if (/^(?:jalan|jl\.|kav\.|gedung|lantai)/i.test(trimmed)) continue;
      const m = trimmed.match(/(?:nomor|no)\s*[:.]\s*([A-Za-z0-9\/\.\-_ ]+)/i);
      if (m && m[1]) {
        const candidate = m[1].trim();
        // Nomor surat resmi biasanya memiliki slash atau minimal 4 karakter dan bukan hanya rentang digit alamat (seperti 2-4)
        if (candidate.includes('/') || (candidate.length >= 4 && !/^\d+\s*-\s*\d+$/.test(candidate))) {
          nomorSurat = candidate;
          break;
        }
      }
    }
    if (nomorSurat === '-' && fileName) {
      nomorSurat = `REF-${fileName.replace('.pdf', '')}`;
    }

    // 3. Cari tanggal surat
    const tanggalMatch = text.match(
      /(\d{1,2}\s+(?:Januari|Februari|Maret|April|Mei|Juni|Juli|Agustus|September|Oktober|November|Desember|Jan|Feb|Mar|Apr|Mei|Jun|Jul|Ags|Sep|Okt|Nov|Des)\s+\d{4})/i
    );
    const tanggalSurat = tanggalMatch ? tanggalMatch[1].trim() : this.getTodayFormatted();

    // 4. Cari hal/perihal
    const halMatch = text.match(/(?:Hal|Perihal|HAL|PERIHAL)\s*[:.]\s*([^\n]+)/i);
    const subject = halMatch ? halMatch[1].trim() : 'Surat Dinas / Undangan Acara';

    // 5. Cari instansi pengirim pada kop surat untuk penyelenggara
    const instansiMatch = text.match(
      /(?:Kementerian|Direktorat|Dinas|Badan|PT|CV|Dewan|Pengurus|Sekretariat)\s+[A-Za-z0-9\s,.-]+/i
    );
    const penyelenggara = instansiMatch ? instansiMatch[0].trim().split('\n')[0].slice(0, 60) : 'Instansi Terkait';

    // 6. Cari nama pengirim & jabatan yang bertanda tangan di paling bawah surat (Asal Surat: Nama - Jabatan)
    let namaPengirim = '';
    let jabatanPengirim = '';

    const allLines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
    let endIdx = allLines.length;
    for (let i = 0; i < allLines.length; i++) {
      if (/^tembusan\s*[:.]/i.test(allLines[i])) {
        endIdx = i;
        break;
      }
    }

    // Ambil maksimal 25 baris terakhir sebelum tembusan / akhir dokumen
    const signatureLines = allLines.slice(Math.max(0, endIdx - 25), endIdx);

    let nameIdx = -1;
    // Cari baris NIP terlebih dahulu (baris tepat sebelum NIP adalah nama penandatangan)
    for (let i = 0; i < signatureLines.length; i++) {
      const line = signatureLines[i];
      if (/^NIP[\s.:0-9\-]+/i.test(line) && i > 0) {
        const candidateName = signatureLines[i - 1].replace(/[\(\)]/g, '').trim();
        if (candidateName.length >= 3 && !/^(?:ttd|tanda\s+tangan)$/i.test(candidateName)) {
          namaPengirim = candidateName;
          nameIdx = i - 1;
          break;
        }
      }
    }

    // Jika belum ketemu nama dari NIP, cari baris yang mengandung gelar atau nama orang bertanda tangan
    if (!namaPengirim) {
      for (let i = signatureLines.length - 1; i >= 0; i--) {
        const line = signatureLines[i].replace(/[\(\)]/g, '').trim();
        if (/^(?:ttd|tanda\s+tangan|hormat\s+kami|wassalamu|demikian|atas\s+perhatian|catatan|lampiran)/i.test(line)) continue;
        if (/^(?:jalan|jl\.|gedung|telp|fax|email|website|www\.)/i.test(line)) continue;
        if (/^NIP[\s.:0-9\-]+/i.test(line)) continue;

        const hasTitle = /(?:Prof\.|Dr\.|Drs\.|Ir\.|H\.|Hj\.)\s+[A-Z]/i.test(line) ||
          /,\s*(?:S\.[A-Z]+|M\.[A-Z]+|Ph\.D|M\.B\.A|MEM|M\.Si|M\.M|S\.E|S\.H|S\.T|S\.Sos|Sp\.)/i.test(line);
        const isAllCapsName = /^[A-Z\s.,'-]{4,45}$/.test(line) && !/^(?:KEMENTERIAN|DIREKTORAT|DEWAN|SEKRETARIAT|REPUBLIK|INDONESIA|UNIVERSITAS|PEMERINTAH)/i.test(line);

        if (hasTitle || isAllCapsName) {
          namaPengirim = line;
          nameIdx = i;
          break;
        }
      }
    }

    // Cari jabatan penandatangan:
    // Paling akurat adalah baris tepat di sekitar namaPengirim (1-4 baris di atas nama, atau 1-2 baris di bawah)
    const isInstitution = (l: string) =>
      /^(?:kementerian|pemerintah|universitas|institut|politeknik|pt\b|cv\b|yayasan|direktorat\s+jenderal\s+[a-z]+|badan\s+[a-z]+|dinas\s+[a-z]+)/i.test(l);

    const jabatanRegex = /(?:Menteri|Wakil Menteri|Sekretaris Jenderal|Sekjen|Direktur Jenderal|Dirjen|Direktur Utama|Direktur|Kepala Badan|Kepala Dinas|Kepala Biro|Kepala Bagian|Kepala|Ketua Umum|Ketua Panitia|Ketua|Rektor|Dekan|Presiden Direktur|General Manager|Manager|Pimpinan|Deputi|Bupati|Walikota|Gubernur|Koordinator|Kuasa Direksi)/i;

    if (nameIdx !== -1) {
      // 1. Cek baris di ATAS namaPengirim (biasanya ada 'ttd' di antaranya)
      for (let offset = 1; offset <= 4; offset++) {
        const checkIdx = nameIdx - offset;
        if (checkIdx < 0) break;
        const line = signatureLines[checkIdx];
        if (jabatanRegex.test(line) && !isInstitution(line)) {
          let fullJabatan = line.replace(/^(?:a\.n\.|plt\.|pj\.)\s*/i, '').trim();
          // Cek jika baris tepat di bawahnya adalah kelanjutan jabatan (sebelum 'ttd')
          if (checkIdx + 1 < nameIdx) {
            const nextL = signatureLines[checkIdx + 1];
            if (!/^(?:ttd|tanda|hormat|nip)/i.test(nextL) && !jabatanRegex.test(nextL) && nextL.length < 60) {
              fullJabatan += ` ${nextL}`;
            }
          }
          jabatanPengirim = fullJabatan;
          break;
        }
      }

      // 2. Jika tidak ada di atas nama, cek baris di BAWAH namaPengirim (seperti: Budi Santoso \n Direktur Utama)
      if (!jabatanPengirim) {
        for (let offset = 1; offset <= 3; offset++) {
          const checkIdx = nameIdx + offset;
          if (checkIdx >= signatureLines.length) break;
          const line = signatureLines[checkIdx];
          if (jabatanRegex.test(line) && !isInstitution(line)) {
            jabatanPengirim = line.replace(/^(?:a\.n\.|plt\.|pj\.)\s*/i, '').trim();
            break;
          }
        }
      }
    }

    // Jika belum ketemu di sekitar nama, scan dari bawah ke atas pada signatureLines
    if (!jabatanPengirim) {
      for (let i = signatureLines.length - 1; i >= 0; i--) {
        const line = signatureLines[i];
        if (jabatanRegex.test(line) && line !== namaPengirim && !isInstitution(line)) {
          jabatanPengirim = line.replace(/^(?:a\.n\.|plt\.|pj\.)\s*/i, '').trim();
          break;
        }
      }
    }

    // Susun format WAJIB: "Nama Pengirim - Jabatan"
    let asalSurat = '-';
    if (namaPengirim && jabatanPengirim) {
      asalSurat = `${namaPengirim} - ${jabatanPengirim}`;
    } else if (namaPengirim) {
      asalSurat = `${namaPengirim} - Pengirim`;
    } else if (jabatanPengirim) {
      asalSurat = `Pengirim - ${jabatanPengirim}`;
    } else {
      asalSurat = `Pimpinan - ${penyelenggara}`;
    }
    asalSurat = formatAsalSurat(asalSurat);

    // 7. Cari PIC / kontak (pisahkan nama dan nomor HP)
    const hpMatch = text.match(/(?:08\d{2}[- ]?\d{4}[- ]?\d{3,4}|\+62\d{2}[- ]?\d{4}[- ]?\d{3,4})/);
    const picPhone = hpMatch ? hpMatch[0].replace(/[^\d+]/g, '').slice(0, 50) : '-';
    let picName = '-';
    if (hpMatch) {
      const idx = text.indexOf(hpMatch[0]);
      const surrounding = text.slice(Math.max(0, idx - 100), Math.min(text.length, idx + 50));
      const nameMatch = surrounding.match(/(?:narahubung|contact\s+person|cp|pic|hubungi|sdr\.?|sdri\.?)\s*[:.-]?\s*([A-Za-z\s.,'-]{3,40})/i);
      if (nameMatch && nameMatch[1]) {
        picName = nameMatch[1].replace(/^(?:sdr|sdri)\.?\s*/i, '').trim().slice(0, 100);
      }
    }
    const picPengirim = picName !== '-' && picPhone !== '-'
      ? `${picName} (${picPhone})`
      : (picPhone !== '-' ? picPhone : (picName !== '-' ? picName : '-'));

    // 8. Cari nama acara
    const eventMatch = text.match(
      /(?:Rapat|Audiensi|Seminar|Sosialisasi|Upacara|Lokakarya|Kunjungan|FGD|Bimtek|Kongres|Konferensi)\s+[A-Za-z0-9\s,.-]+/i
    );
    const rawEvent = eventMatch ? eventMatch[0].trim().split('\n')[0].slice(0, 60) : subject;
    const cleanEventName = cleanNamaAcara(rawEvent, penyelenggara);
    const cleanSesi = cleanSesiAcara(sesiAcara, cleanEventName);

    // 9. Cari tema jika ada
    const temaMatch = text.match(/(?:tema|bertema)\s*[:"']\s*([^"'\n]+)/i);
    const temaAcara = temaMatch ? temaMatch[1].trim() : undefined;

    // 10. Cari tanggal kegiatan/acara di dalam isi surat jika ada
    let dateEvent: string | undefined = undefined;
    const dateEventMatch = text.match(
      /(?:hari\s*(?:\/|\s*dan\s*)?\s*tanggal|pada\s+hari\s*[,/]?\s*tanggal|waktu\s*(?:dan\s*tempat)?|tanggal\s+pelaksanaan|diselenggarakan\s+pada)\s*[:.-]?\s*([A-Za-z0-9\s,/-]{5,60})/i
    );
    if (dateEventMatch && dateEventMatch[1]) {
      const candidate = dateEventMatch[1].trim().split('\n')[0].replace(/[\(\)]/g, '').trim();
      if (candidate.length >= 5 && candidate !== tanggalSurat) {
        dateEvent = candidate.slice(0, 100);
      }
    }

    const data: ExtractedSuratData = {
      kategoriSurat,
      tanggalSurat,
      nomorSurat,
      subject: cleanEventName,
      asalSurat,
      event: cleanEventName,
      dateEvent,
      picPengirim: picPengirim.slice(0, 100),
      picName: picName.slice(0, 100),
      picPhoneNumber: picPhone.slice(0, 50),
      namaAcara: cleanEventName,
      temaAcara,
      penyelenggara,
      sesiAcara: cleanSesi,
      perihal: '',
    };

    // Format perihal berdasarkan template resmi
    data.perihal = formatPerihalByTemplate(data);
    // Kolom subject merupakan ringkasan dari isi perihal (maks 200 karakter)
    data.subject = generateSubjectSummary(data.perihal, data);
    // Samakan isi dari acara seperti yang ada di perihal, templatenya sama
    data.event = data.perihal;
    return data;
  }

  private getTodayFormatted(): string {
    const now = new Date();
    const months = [
      'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
      'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
    ];
    return `${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear()}`;
  }
}

export const aiService = new AiService();
