import fs from 'fs';
import path from 'path';
import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';
import { ENV } from '../config/env';
import { ExtractedSuratData } from './sessionService';
import { splitPicNameAndPhone } from '../utils/textHelper';
import { imageService } from './imageService';

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
 * Kamus pemetaan nama panjang kementerian, lembaga, BUMN, universitas, dan organisasi ke bentuk singkatannya.
 */
export const INSTITUTION_ACRONYM_MAP: Record<string, string> = {
  'kementerian koordinator bidang perekonomian': 'Kemenko Perekonomian',
  'kementerian koordinator bidang pembangunan manusia dan kebudayaan': 'Kemenko PMK',
  'kementerian koordinator bidang kemaritiman dan investasi': 'Kemenko Marves',
  'kementerian koordinator bidang politik, hukum, dan keamanan': 'Kemenko Polhukam',
  'kementerian ketenagakerjaan': 'Kemnaker',
  'kemenaker': 'Kemnaker',
  'kementerian keuangan': 'Kemenkeu',
  'kementerian sekretariat negara': 'Kemensetneg',
  'sekretariat kabinet': 'Setkab',
  'kementerian perencanaan pembangunan nasional': 'Bappenas',
  'kementerian ppn/bappenas': 'Bappenas',
  'kementerian ppn': 'Bappenas',
  'kementerian pendidikan, kebudayaan, riset, dan teknologi': 'Kemendikbudristek',
  'kementerian pendidikan dasar dan menengah': 'Kemendikdasmen',
  'kementerian pendidikan tinggi, sains, dan teknologi': 'Kemendiktisaintek',
  'kementerian dalam negeri': 'Kemendagri',
  'kementerian luar negeri': 'Kemlu',
  'kementerian hukum dan hak asasi manusia': 'Kemenkumham',
  'kementerian hukum': 'Kemenkum',
  'kementerian hak asasi manusia': 'KemenHAM',
  'kementerian pertahanan': 'Kemenhan',
  'kementerian perindustrian': 'Kemenperin',
  'kementerian perdagangan': 'Kemendag',
  'kementerian pertanian': 'Kementan',
  'kementerian kesehatan': 'Kemenkes',
  'kementerian sosial': 'Kemensos',
  'kementerian agama': 'Kemenag',
  'kementerian perhubungan': 'Kemenhub',
  'kementerian kelautan dan perikanan': 'KKP',
  'kementerian energi dan sumber daya mineral': 'Kementerian ESDM',
  'kementerian pekerjaan umum dan perumahan rakyat': 'Kementerian PUPR',
  'kementerian pekerjaan umum': 'Kementerian PU',
  'kementerian perumahan dan kawasan permukiman': 'Kementerian PKP',
  'kementerian lingkungan hidup dan kehutanan': 'KLHK',
  'kementerian lingkungan hidup': 'KLH',
  'kementerian kehutanan': 'Kemenhut',
  'kementerian desa, pembangunan daerah tertinggal, dan transmigrasi': 'Kemendes PDTT',
  'kementerian desa dan pembangunan daerah tertinggal': 'Kemendes',
  'kementerian transmigrasi': 'Kementrans',
  'kementerian agraria dan tata ruang/badan pertanahan nasional': 'ATR/BPN',
  'kementerian agraria dan tata ruang': 'Kementerian ATR',
  'badan pertanahan nasional': 'BPN',
  'kementerian komunikasi dan informatika': 'Kominfo',
  'kementerian komunikasi dan digital': 'Kemkomdigi',
  'kementerian badan usaha milik negara': 'Kementerian BUMN',
  'kementerian koperasi dan usaha kecil dan menengah': 'Kemenkop UKM',
  'kementerian koperasi': 'Kemenkop',
  'kementerian usaha mikro, kecil, dan menengah': 'Kementerian UMKM',
  'kementerian pariwisata dan ekonomi kreatif': 'Kemenparekraf',
  'kementerian pariwisata': 'Kemenpar',
  'kementerian ekonomi kreatif': 'KemenEkraf',
  'kementerian pemberdayaan perempuan dan perlindungan anak': 'KemenPPPA',
  'kementerian pendayagunaan aparatur negara dan reformasi birokrasi': 'KemenPAN-RB',
  'kementerian pemuda dan olahraga': 'Kemenpora',
  'kementerian investasi/badan koordinasi penanaman modal': 'BKPM',
  'kementerian investasi dan hilirisasi/bkpm': 'BKPM',
  'kementerian investasi': 'BKPM',
  'kementerian perlindungan pekerja migran indonesia': 'KPPMI',
  'dewan perwakilan rakyat republik indonesia': 'DPR RI',
  'dewan perwakilan rakyat': 'DPR RI',
  'majelis permusyawaratan rakyat republik indonesia': 'MPR RI',
  'majelis permusyawaratan rakyat': 'MPR RI',
  'dewan perwakilan daerah': 'DPD RI',
  'badan pemeriksa keuangan': 'BPK RI',
  'mahkamah konstitusi': 'MK RI',
  'mahkamah agung': 'MA RI',
  'badan penyelenggara jaminan sosial ketenagakerjaan': 'BPJS Ketenagakerjaan',
  'badan penyelenggara jaminan sosial kesehatan': 'BPJS Kesehatan',
  'badan pelindungan pekerja migran indonesia': 'BP2MI',
  'badan perlindungan pekerja migran indonesia': 'BP2MI',
  'badan nasional penanggulangan bencana': 'BNPB',
  'badan nasional sertifikasi profesi': 'BNSP',
  'badan pusat statistik': 'BPS',
  'badan riset dan inovasi nasional': 'BRIN',
  'badan pengawas obat dan makanan': 'BPOM',
  'komisi pemberantasan korupsi': 'KPK',
  'komisi pemilihan umum': 'KPU',
  'badan pengawas pemilihan umum': 'Bawaslu',
  'kejaksaan agung': 'Kejagung',
  'kepolisian negara republik indonesia': 'Polri',
  'kepolisian ri': 'Polri',
  'tentara nasional indonesia': 'TNI',
  'asosiasi pengusaha indonesia': 'APINDO',
  'kamar dagang dan industri indonesia': 'KADIN',
  'kamar dagang dan industri': 'KADIN',
  'konfederasi serikat pekerja seluruh indonesia': 'KSPSI',
  'konfederasi serikat buruh seluruh indonesia': 'KSBSI',
  'konfederasi serikat buruh sejahtera indonesia': 'KSBSI',
  'konfederasi serikat pekerja indonesia': 'KSPI',
  'federasi serikat pekerja transport indonesia': 'FSPTI',
  'federasi serikat pekerja metal indonesia': 'FSPMI',
  'serikat pekerja nasional': 'SPN',
  'serikat buruh nasionalis indonesia': 'SBNI',
  'universitas indonesia': 'UI',
  'institut pertanian bogor': 'IPB',
  'institut teknologi bandung': 'ITB',
  'universitas gadjah mada': 'UGM',
  'universitas airlangga': 'UNAIR',
  'universitas diponegoro': 'UNDIP',
  'universitas brawijaya': 'UB',
  'universitas padjadjaran': 'UNPAD',
  'universitas sebelas maret': 'UNS',
  'universitas negeri jakarta': 'UNJ',
  'institut teknologi sepuluh nopember': 'ITS',
  'universitas hasanuddin': 'UNHAS',
  'pt telekomunikasi indonesia tbk': 'PT Telkom',
  'pt telekomunikasi indonesia': 'PT Telkom',
  'pt perusahaan listrik negara': 'PT PLN',
  'pt pertamina': 'PT Pertamina',
  'pt bank rakyat indonesia': 'PT BRI',
  'pt bank mandiri': 'Bank Mandiri',
  'pt bank negara indonesia': 'Bank BNI',
  'pt kereta api indonesia': 'PT KAI',
  'pt pos indonesia': 'Pos Indonesia',
  'pt garuda indonesia': 'Garuda Indonesia',
  'pt jasa raharja': 'Jasa Raharja',
  'pt taspen': 'PT Taspen',
};

/**
 * Menyingkat nama instansi/organisasi secara cerdas jika memiliki singkatan/akronim umum
 */
export function shortenInstitutionName(raw: string | undefined): string {
  if (!raw || raw.trim() === '-' || raw.trim() === '' || raw.trim() === 'Instansi Terkait') return '';
  const s = raw.trim();

  // 1. Cek jika nama instansi memiliki tanda kurung dengan akronim, misal "Federasi Serikat Pekerja Transport Indonesia (FSPTI)" -> "FSPTI"
  const parenMatch = s.match(/\(([^)]+)\)/);
  if (parenMatch && parenMatch[1]) {
    const inside = parenMatch[1].trim();
    if (!/^(?:persero|tbk|ltd|inc|co)$/i.test(inside) && inside.length >= 2 && inside.length <= 25) {
      if (inside === inside.toUpperCase() || /^[A-Z0-9\s/–-]+$/.test(inside)) {
        return inside;
      }
    }
  }

  // 2. Bersihkan suffix "Republik Indonesia", "RI", "Persero", "Tbk"
  const clean = s.replace(/\s*,?\s*(?:republik indonesia|RI|persero|tbk)\s*$/i, '').trim().toLowerCase();

  for (const [k, v] of Object.entries(INSTITUTION_ACRONYM_MAP)) {
    if (clean === k || clean.startsWith(k)) {
      return v;
    }
  }

  return s.replace(/\s*,?\s*(?:republik indonesia|RI)\s*$/i, '').trim();
}

/**
 * Menggabungkan Jabatan dan Instansi secara padu tanpa strip pemisah
 */
export function combineJabatanInstansi(jabatan: string | undefined, instansi: string | undefined): string {
  const cleanJab = (jabatan || '').replace(/[,;\s]+$/, '').trim();
  const shortInst = shortenInstitutionName(instansi);

  if (!shortInst || shortInst === '-' || shortInst === 'Instansi Terkait') {
    return cleanJab;
  }

  if (!cleanJab || cleanJab === '-') {
    return shortInst;
  }

  // Jika jabatan sudah memuat singkatan atau nama instansi (misal: "Rektor IPB" atau "Dirjen Binwasnaker Kemnaker")
  const lowerJab = cleanJab.toLowerCase();
  const lowerInst = shortInst.toLowerCase();
  if (lowerJab.includes(lowerInst)) {
    return cleanJab;
  }

  return `${cleanJab} ${shortInst}`.trim();
}

/**
 * Memformat dan merapikan kolom Asal Surat:
 * Format WAJIB: "Nama Pengirim - Jabatan Nama Instansi"
 * ATURAN:
 * 1. Pemisah tanda hubung (strip) HANYA ada di antara Nama Pengirim dan Jabatan Nama Instansi.
 * 2. TIDAK ADA pemisah strip antara Jabatan dan Instansi.
 * 3. Jika nama instansi memiliki singkatan, gunakan singkatannya saja.
 * 4. Jika ada beberapa orang penandatangan (misal: Ketua & Sekretaris), pilih salah satu saja.
 */
export function formatAsalSurat(raw: string, fallbackJabatan?: string, fallbackInstansi?: string): string {
  if (!raw || raw.trim() === '-' || raw.trim() === '') return '-';
  let clean = raw.trim().replace(/^[\*•\-\s]+/, '');

  // 1. Bersihkan penomoran awal seperti "1. ", "1) ", dsb.
  clean = clean.replace(/^(?:(?:1\.|1\)|nomor\s*1|ke-?1)\s*)/i, '').trim();

  const cleanFallbackInstansi = (fallbackInstansi && fallbackInstansi !== '-' && fallbackInstansi !== 'Instansi Terkait')
    ? fallbackInstansi.trim()
    : undefined;

  // Kasus 1: Menggunakan pemisah tanda kurung: "Nama (Jabatan) Instansi" atau "Nama (Jabatan)"
  const parenMatch = clean.match(/^([^\(\)\n]+?)\s*\(([^\)\n]+)\)(?:\s*[-–—]?\s*(.*))?$/);
  if (parenMatch && !clean.includes(' - ')) {
    let name = parenMatch[1].trim();
    let jab = parenMatch[2].trim();
    let inst = parenMatch[3] ? parenMatch[3].trim() : cleanFallbackInstansi;

    if (/\s+(?:dan|&|serta)\s+/i.test(name)) {
      name = name.split(/\s+(?:dan|&|serta)\s+/i)[0].trim();
    }
    if (/\s+(?:dan|&|serta)\s+/i.test(jab)) {
      jab = jab.split(/\s+(?:dan|&|serta)\s+/i)[0].trim();
    }

    const combined = combineJabatanInstansi(jab, inst);
    return combined ? `${name} - ${combined}`.slice(0, 220) : name.slice(0, 220);
  }

  // Kasus 2: Format dengan strip " - "
  if (clean.includes(' - ')) {
    const rawParts = clean.split(' - ').map(p => p.trim());

    if (rawParts.length >= 2) {
      let name = rawParts[0];

      // Jika pada nama ada "Budi Santoso dan Ahmad Fauzi"
      if (/\s+(?:dan|&|serta)\s+/i.test(name)) {
        name = name.split(/\s+(?:dan|&|serta)\s+/i)[0].trim();
      }

      // Jika rawParts memiliki 3 bagian atau lebih (Nama - Jabatan - Instansi)
      if (rawParts.length >= 3) {
        let jabatan = rawParts[1].replace(/[,;\s]+$/, '').trim();
        let instansi = rawParts.slice(2).join(' - ').replace(/[,;\s]+$/, '').trim();

        if (/\s+(?:dan|&|serta)\s+/i.test(jabatan)) {
          jabatan = jabatan.split(/\s+(?:dan|&|serta)\s+/i)[0].trim().replace(/[,;\s]+$/, '');
        }

        const combined = combineJabatanInstansi(jabatan, instansi || cleanFallbackInstansi);
        return `${name} - ${combined}`.slice(0, 220);
      }

      // Jika rawParts tepat 2 bagian (Nama - JabatanInstansi atau Nama - Jabatan)
      if (rawParts.length === 2) {
        let jabOrCombined = rawParts[1].replace(/[,;\s]+$/, '').trim();
        if (/\s+(?:dan|&|serta)\s+/i.test(jabOrCombined)) {
          jabOrCombined = jabOrCombined.split(/\s+(?:dan|&|serta)\s+/i)[0].trim().replace(/[,;\s]+$/, '');
        }

        const combined = combineJabatanInstansi(jabOrCombined, cleanFallbackInstansi);
        return `${name} - ${combined}`.slice(0, 220);
      }
    }
  }

  // Kasus 3: Format "Nama, Jabatan"
  const commaJabatanMatch = clean.match(
    /^(.*),\s*(Menteri|Wakil Menteri|Sekretaris Jenderal|Sekjen|Sekretaris|Direktur Jenderal|Dirjen|Direktur Utama|Direktur|Kepala Badan|Kepala Dinas|Kepala Biro|Kepala Bagian|Kepala|Ketua Umum|Ketua Panitia|Ketua|Rektor|Dekan|Pimpinan|Deputi|Manager|General Manager|Presiden Direktur|Presiden|Bupati|Walikota|Gubernur|Koordinator|Kuasa Direksi|Kuasa)(.*)$/i
  );
  if (commaJabatanMatch) {
    let name = commaJabatanMatch[1].trim();
    let jabatan = `${commaJabatanMatch[2]}${commaJabatanMatch[3]}`.trim();
    if (/\s+(?:dan|&|serta)\s+/i.test(jabatan)) {
      jabatan = jabatan.split(/\s+(?:dan|&|serta)\s+/i)[0].trim();
    }
    if (/\s+(?:dan|&|serta)\s+/i.test(name)) {
      name = name.split(/\s+(?:dan|&|serta)\s+/i)[0].trim();
    }
    const combined = combineJabatanInstansi(jabatan, cleanFallbackInstansi);
    return `${name} - ${combined}`.slice(0, 220);
  }

  // Fallback jika belum ada strip
  if (fallbackJabatan && fallbackJabatan !== '-') {
    const combined = combineJabatanInstansi(fallbackJabatan, cleanFallbackInstansi);
    return `${clean} - ${combined}`.slice(0, 220);
  } else if (cleanFallbackInstansi) {
    return `${clean} - ${shortenInstitutionName(cleanFallbackInstansi)}`.slice(0, 220);
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
   - "asalSurat": "gabungan nama pengirim yang bertanda tangan di paling bawah, jabatannya, dan asal instansi dengan format 'Nama Pengirim - Jabatan Singkatan Instansi' (pemisah strip HANYA di antara nama pengirim dan jabatan instansi, TIDAK ADA strip antara jabatan dan instansi, serta jika nama instansi memiliki singkatan gunakan singkatannya saja, CONTOH: 'Dr. Ir. Rudy Salahuddin, MEM - Deputi Bidang Koordinasi Ekonomi Digital Kemenko Perekonomian' atau 'Budi Santoso, S.E. - Direktur Utama PT Telkom' atau 'Prof. Dr. Ir. Arif Satria, S.P., M.Si. - Rektor IPB'). JIKA ADA BEBERAPA ORANG PENANDATANGAN, PILIH SALAH SATU NAMA SAJA BESERTA JABATAN DAN ASAL INSTANSINYA (jangan gabungkan beberapa nama orang)!"
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
   - "dateEvent": "hari/tanggal pelaksanaan acara/kegiatan/event yang disebutkan di dalam isi surat (CONTOH: 'Senin, 20 Oktober 2026' atau '20 Oktober 2026' atau '25 - 27 November 2026'). BUKAN tanggal pembuatan surat! Jika surat TIDAK memiliki tanggal event/acara (misalnya surat laporan biasa, pemberitahuan tanpa acara, dll), isi '-'"
   - "timeEvent": "jam/waktu mulai dan/atau selesai pelaksanaan acara/kegiatan yang tercantum di dalam surat (CONTOH: '09.00 WIB' atau '08.30 - 12.00 WIB' atau '13.00 WIB s.d. selesai' atau '10.00 WITA'). Jika surat TIDAK memuat jam acara, isi '-'"
   - "placeEvent": "lokasi/tempat diselenggarakannya acara/kegiatan/event yang tercantum di dalam isi surat (CONTOH: 'Hotel Bidakara Jakarta' atau 'Ruang Rapat Tridharma Lantai 2' atau 'Grand Ballroom Hotel Indonesia Kempinski' atau 'Aplikasi Zoom Meeting / Daring' atau 'Bandung'). HANYA nama tempat/lokasi acara! Jika surat TIDAK memuat tempat/lokasi acara, isi '-'"

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

        const parsedResult = this.parseAiExtractionResponse(rawText, originalFileName);
        if (parsedResult) {
          return parsedResult;
        }
      } catch (err) {
        console.warn(`[AiService] Ekstraksi cerdas AI (${model}) gagal, menggunakan fallback parser:`, err);
      }
    }

    // 2. Fallback Rule-Based Parser (Jika AI Key kosong atau respons tidak sesuai)
    return this.fallbackRuleBasedExtraction(pdfText, originalFileName);
  }

  /**
   * Ekstraksi metadata dan isi surat dinas langsung dari berkas gambar (Multimodal Vision AI)
   */
  public async extractSuratFromImage(imagePath: string, originalFileName?: string): Promise<ExtractedSuratData> {
    const isUsingOpenRouter = Boolean(this.openAiClient);
    let model = 'google/gemini-2.5-flash';

    if (isUsingOpenRouter) {
      if (ENV.PDF_EXTRACTION_MODEL && (ENV.PDF_EXTRACTION_MODEL.includes('/') || ENV.PDF_EXTRACTION_MODEL.includes('vision'))) {
        model = ENV.PDF_EXTRACTION_MODEL;
      } else if (ENV.PDF_EXTRACTION_MODEL && !ENV.PDF_EXTRACTION_MODEL.startsWith('gemini-')) {
        model = ENV.PDF_EXTRACTION_MODEL;
      } else {
        model = 'google/gemini-2.5-flash';
      }
    } else {
      model = ENV.PDF_EXTRACTION_MODEL || 'gemini-2.5-flash';
    }

    if ((this.genAiClient || this.openAiClient) && fs.existsSync(imagePath)) {
      try {
        const buffer = fs.readFileSync(imagePath);
        const ext = path.extname(originalFileName || imagePath).toLowerCase();
        const mimeType = imageService.detectImageMimeType(buffer, ext) || 'image/jpeg';
        const base64Image = buffer.toString('base64');

        const prompt = `Anda adalah asisten AI Protokol Kementerian Ketenagakerjaan (Kemnaker) yang ahli dan sangat teliti dalam menganalisis berkas gambar surat dinas resmi (foto surat fisik, scan surat, atau tangkapan layar surat dinas).

TUGAS UTAMA:
Bacalah seluruh isi gambar surat dinas terlampir secara teliti dan menyeluruh, dari kop surat teratas, nomor, tanggal, lampiran, perihal, isi surat, jadwal/tempat acara, hingga penandatangan dan stempel di bagian bawah surat. Pastikan semua entitas diekstrak persis dan akurat sesuai yang tertulis pada gambar.

1. Tentukan KATEGORI SURAT (kategoriSurat) secara akurat dari salah satu kode berikut:
   - "UND" : Undangan Menghadiri acara/rapat/seminar/konferensi/FGD/diskusi/lokakarya/dies natalis/peringatan umum (BUKAN pernikahan, BUKAN meminta pimpinan memberi sambutan/speech khusus).
   - "PH"  : Permohonan Hadir yang meminta Menteri / Pimpinan Kemnaker untuk MEMBERIKAN SAMBUTAN, KEYNOTE SPEECH, ARAHAN, MEMBUKA ACARA, atau menjadi NARASUMBER / PEMBICARA.
   - "UNR" : Undangan Pernikahan (akad nikah, resepsi pernikahan, walimah, ngunduh mantu).
   - "AU"  : Permohonan Audiensi / Silaturahmi resmi / Tatap muka / Kunjungan kehormatan dari instansi, organisasi, atau serikat pekerja.
   - "WR"  : Permohonan Wawancara / Peliputan khusus dari media / pers / jurnalis.
   - "TAP" : Permohonan pembuatan atau rekaman Video Ucapan (selamat ulang tahun, harlah, milad, perayaan hari jadi).
   - "LP"  : Dokumen Laporan (laporan kegiatan, laporan pelaksanaan, pertanggungjawaban).

2. Aturan ekstraksi entitas secara presisi sesuai gambar:
   - "kategoriSurat": "UND" | "PH" | "UNR" | "WR" | "AU" | "TAP" | "LP"
   - "alasanKategori": "penjelasan singkat mengapa dokumen masuk kategori ini berdasarkan gambar"
   - "nomorSurat": "nomor registrasi surat dinas resmi yang tertulis pada gambar (CONTOH: 'HM.4.6/189/D.IV.M.EKON/09/2026' atau 'B-102/DIR/IX/2026'). SANGAT PENTING: JANGAN mengambil nomor jalan/alamat kantor!"
   - "tanggalSurat": "tanggal surat dibuat/diterbitkan yang tertulis pada gambar dalam bahasa Indonesia (misal: '15 September 2026')"
   - "namaPengirim": "nama lengkap orang/pejabat pengirim yang menandatangani surat di bagian paling bawah surat beserta gelar lengkapnya (CONTOH: 'Dr. Ir. Rudy Salahuddin, MEM' atau 'Budi Santoso, S.E.'). BUKAN instansi! JIKA ADA BEBERAPA ORANG PENANDATANGAN, PILIH SALAH SATU NAMA SAJA (utamakan penandatangan pertama/jabatan tertinggi). JANGAN menggabungkan beberapa nama!"
   - "jabatanPengirim": "jabatan resmi orang/pejabat yang menandatangani surat di bagian paling bawah surat yang SESUAI DENGAN namaPengirim yang dipilih (CONTOH: 'Deputi Bidang Koordinasi Ekonomi Digital' atau 'Direktur Utama' atau 'Ketua Umum'). BUKAN instansi!"
   - "asalSurat": "gabungan nama pengirim yang bertanda tangan di paling bawah, jabatannya, dan asal instansi dengan format 'Nama Pengirim - Jabatan Singkatan Instansi' (pemisah strip HANYA di antara nama pengirim dan jabatan instansi, TIDAK ADA strip antara jabatan dan instansi, serta jika nama instansi memiliki singkatan gunakan singkatannya saja, CONTOH: 'Dr. Ir. Rudy Salahuddin, MEM - Deputi Bidang Koordinasi Ekonomi Digital Kemenko Perekonomian' atau 'Budi Santoso, S.E. - Direktur Utama PT Telkom' atau 'Prof. Dr. Ir. Arif Satria, S.P., M.Si. - Rektor IPB'). JIKA ADA BEBERAPA ORANG PENANDATANGAN, PILIH SALAH SATU NAMA SAJA BESERTA JABATAN DAN ASAL INSTANSINYA!"
   - "penyelenggara": "nama lembaga/instansi/organisasi pengirim atau penyelenggara acara dari KOP SURAT teratas atau stempel resmi pada gambar (CONTOH: 'Kementerian Koordinator Bidang Perekonomian' atau 'PT Telekomunikasi Indonesia Tbk' atau 'Institut Pertanian Bogor')"
   - "namaAcara": "nama murni acara/kegiatan saja (CONTOH: 'Rapat Kerja Nasional (Rakornas) VII Tahun 2026' atau 'Forum Koordinasi Ketenagakerjaan Nasional 2026'). HAPUS kata pengantar seperti 'Permohonan Sambutan pada Pembukaan' atau nama instansi di akhir!"
   - "temaAcara": "tema spesifik acara jika ada tertulis di gambar (misal: 'Transformasi Tenaga Kerja Menuju Indonesia Emas 2045', atau '-' jika tidak ada tema)"
   - "sesiAcara": "khusus kategori PH, peran/sesi yang dimohonkan kepada Menteri / Pimpinan Kemnaker (CONTOH: 'Sambutan', 'Keynote Speech', 'Sambutan dan Arahan', 'Membuka Acara', 'Narasumber'). HANYA sebutkan jenis perannya saja tanpa mengulang nama acara/instansi!"
   - "mempelai1": "jika UNR, nama mempelai 1 dan orang tua (misal: 'Anisa Rahmawati (Putri Bapak Ahmad dan Ibu Siti)', atau '-')"
   - "mempelai2": "jika UNR, nama mempelai 2 dan orang tua (misal: 'Dimas Pratama (Putra Bapak Bambang dan Ibu Sri)', atau '-')"
   - "pokokBahasan": "jika WR/AU, pokok bahasan audiensi atau wawancara (atau '-')"
   - "rangkaUcapan": "jika TAP, rangka pembuatan video ucapan (misal: 'Hari Ulang Tahun ke-75 PT Aneka Tambang Tbk', atau '-')"
   - "picName": "nama lengkap orang PIC / Narahubung / Contact Person jika tertera di gambar surat (CONTOH: 'Sdr. Ahmad Fauzi' atau 'Budi Santoso'). BUKAN nomor telepon! Jika tidak ada, isi '-'"
   - "picPhoneNumber": "nomor HP / telepon / WhatsApp dari PIC yang tertera di gambar (CONTOH: '081234567890' atau '+6281234567890'). HANYA digit nomor kontak! Jika tidak ada, isi '-'"
   - "picPengirim": "gabungan nama PIC dan nomor telepon (CONTOH: 'Ahmad Fauzi (081234567890)'). Jika tidak ada, isi '-'"
   - "dateEvent": "hari/tanggal pelaksanaan acara/kegiatan yang disebutkan di dalam isi surat pada gambar (CONTOH: 'Senin, 20 Oktober 2026' atau '20 Oktober 2026'). BUKAN tanggal pembuatan surat! Jika surat TIDAK memiliki tanggal event/acara, isi '-'"
   - "timeEvent": "jam/waktu mulai dan/atau selesai pelaksanaan acara/kegiatan yang tercantum di dalam gambar surat (CONTOH: '09.00 WIB' atau '08.30 - 12.00 WIB' atau '13.00 WIB s.d. selesai'). Jika surat TIDAK memuat jam acara, isi '-'"
   - "placeEvent": "lokasi/tempat diselenggarakannya acara/kegiatan yang tercantum di dalam gambar surat (CONTOH: 'Hotel Bidakara Jakarta' atau 'Ruang Rapat Tridharma Lantai 2' atau 'Grand Ballroom Hotel Indonesia Kempinski' atau 'Aplikasi Zoom Meeting / Daring'). HANYA nama tempat/lokasi acara! Jika tidak ada, isi '-'"

KEMBALIKAN OUTPUT HANYA DALAM FORMAT JSON VALID TANPA MARKDOWN (\`\`\`json) DAN TANPA PENJELASAN LAIN:
`;

        let rawText = '';
        if (this.openAiClient) {
          const res = await this.openAiClient.chat.completions.create({
            model,
            messages: [
              {
                role: 'user',
                content: [
                  { type: 'text', text: prompt },
                  {
                    type: 'image_url',
                    image_url: {
                      url: `data:${mimeType};base64,${base64Image}`,
                    },
                  },
                ],
              },
            ],
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
            contents: [
              {
                role: 'user',
                parts: [
                  { text: prompt },
                  {
                    inlineData: {
                      mimeType,
                      data: base64Image,
                    },
                  },
                ],
              },
            ],
          });
          rawText = res.text || '';
        }

        const parsedResult = this.parseAiExtractionResponse(rawText, originalFileName);
        if (parsedResult) {
          return parsedResult;
        }
      } catch (err) {
        console.warn(`[AiService] Ekstraksi Vision AI gambar (${model}) gagal:`, err);
      }
    }

    // Fallback default jika AI offline
    const cleanFileName = originalFileName || path.basename(imagePath);
    return {
      kategoriSurat: 'UND',
      alasanKategori: 'Pemeriksaan default dari dokumen gambar.',
      tanggalSurat: this.getTodayFormatted(),
      nomorSurat: `REF-${cleanFileName.replace(/\.[a-zA-Z0-9]+$/, '')}`,
      subject: `Surat Masuk (${cleanFileName})`,
      asalSurat: 'Pimpinan - Instansi Terkait',
      event: `Surat dari Instansi Terkait terkait Kegiatan`,
      perihal: `Surat dari Instansi Terkait terkait Kegiatan`,
      picPengirim: '-',
      picName: '-',
      picPhoneNumber: '-',
      penyelenggara: 'Instansi Terkait',
      namaAcara: 'Kegiatan',
      sesiAcara: 'Sambutan dan Arahan',
    };
  }

  /**
   * Helper parsing terpusat untuk output JSON dari model AI (baik teks PDF maupun Vision Gambar)
   */
  private parseAiExtractionResponse(rawText: string, originalFileName?: string): ExtractedSuratData | null {
    if (!rawText || !rawText.trim()) return null;

    try {
      const clean = rawText.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
      const cleanJson = clean.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
      const jsonMatch = cleanJson.match(/\{[\s\S]*\}/);

      if (!jsonMatch) return null;

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

      // Format asalSurat: WAJIB nama pengirim yang bertanda tangan di paling bawah, jabatan, dan instansi: "Nama Pengirim - Jabatan Singkatan Instansi"
      let finalAsalSurat = (parsed.asalSurat || '').trim();
      const namaPengirim = (parsed.namaPengirim || '').trim();
      const jabatanPengirim = (parsed.jabatanPengirim || '').trim();
      const instansiPenyelenggara = extractedPenyelenggara && extractedPenyelenggara !== '-' ? extractedPenyelenggara : '';

      if (namaPengirim && jabatanPengirim && !finalAsalSurat.includes(' - ')) {
        const jabInst = combineJabatanInstansi(jabatanPengirim, instansiPenyelenggara);
        finalAsalSurat = jabInst ? `${namaPengirim} - ${jabInst}` : namaPengirim;
      } else if (!finalAsalSurat || finalAsalSurat === '-') {
        if (namaPengirim && jabatanPengirim) {
          const jabInst = combineJabatanInstansi(jabatanPengirim, instansiPenyelenggara);
          finalAsalSurat = jabInst ? `${namaPengirim} - ${jabInst}` : namaPengirim;
        } else if (namaPengirim) {
          const shortInst = shortenInstitutionName(instansiPenyelenggara);
          finalAsalSurat = shortInst
            ? `${namaPengirim} - Pengirim ${shortInst}`
            : `${namaPengirim} - Pengirim`;
        } else {
          const shortInst = shortenInstitutionName(instansiPenyelenggara);
          finalAsalSurat = shortInst ? `Pimpinan - ${shortInst}` : '-';
        }
      }
      finalAsalSurat = formatAsalSurat(finalAsalSurat, jabatanPengirim, instansiPenyelenggara);

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
      let cleanDateEvent = (rawDateEvent && rawDateEvent !== '-' && !/^(?:tidak\s+ada|belum\s+ada|null|undefined|-)$/i.test(rawDateEvent))
        ? rawDateEvent.replace(/^[\*•\-\s]+/, '').slice(0, 100)
        : undefined;

      const rawTimeEvent = (parsed.timeEvent || '').trim();
      let cleanTimeEvent = (rawTimeEvent && rawTimeEvent !== '-' && !/^(?:tidak\s+ada|belum\s+ada|null|undefined|-)$/i.test(rawTimeEvent))
        ? rawTimeEvent.replace(/^[\*•\-\s]+/, '').slice(0, 100)
        : undefined;

      const rawPlaceEvent = (parsed.placeEvent || '').trim();
      let cleanPlaceEvent = (rawPlaceEvent && rawPlaceEvent !== '-' && !/^(?:tidak\s+ada|belum\s+ada|null|undefined|-)$/i.test(rawPlaceEvent))
        ? rawPlaceEvent.replace(/^[\*•\-\s]+/, '').slice(0, 220)
        : undefined;

      // Jika cleanTimeEvent belum ada tetapi cleanDateEvent memuat pola jam (misal: "20 Oktober 2026, Pukul 09.00 WIB")
      if (!cleanTimeEvent && cleanDateEvent) {
        const timeInDateMatch = cleanDateEvent.match(/(?:pukul|jam)?\s*(\d{1,2}[:.]\d{2}(?:\s*(?:-|s\.?d\.?|sampai|\/)\s*(?:\d{1,2}[:.]\d{2}|selesai))?\s*(?:WIB|WITA|WIT)?)/i);
        if (timeInDateMatch && timeInDateMatch[1]) {
          cleanTimeEvent = timeInDateMatch[1].trim();
          cleanDateEvent = cleanDateEvent.replace(/[,;]?\s*(?:pukul|jam)?\s*\d{1,2}[:.]\d{2}(?:\s*(?:-|s\.?d\.?|sampai|\/)\s*(?:\d{1,2}[:.]\d{2}|selesai))?\s*(?:WIB|WITA|WIT)?/i, '').trim();
        }
      }

      const extracted: ExtractedSuratData = {
        kategoriSurat: kategori,
        alasanKategori: parsed.alasanKategori || '',
        tanggalSurat: parsed.tanggalSurat || this.getTodayFormatted(),
        nomorSurat: (parsed.nomorSurat || '-').trim().slice(0, 100),
        subject: cleanAcara || parsed.subject || 'Surat Masuk',
        asalSurat: finalAsalSurat.slice(0, 220),
        event: cleanAcara,
        dateEvent: cleanDateEvent,
        timeEvent: cleanTimeEvent,
        placeEvent: cleanPlaceEvent,
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
    } catch (parseErr) {
      console.warn('[AiService] Gagal mem-parse JSON hasil respons AI:', parseErr);
      return null;
    }
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

    // Susun format: "Nama Pengirim - Jabatan Singkatan Instansi"
    let asalSurat = '-';
    const instansiClean = penyelenggara && penyelenggara !== 'Instansi Terkait' ? penyelenggara : '';
    if (namaPengirim && jabatanPengirim) {
      const jabInst = combineJabatanInstansi(jabatanPengirim, instansiClean);
      asalSurat = jabInst ? `${namaPengirim} - ${jabInst}` : namaPengirim;
    } else if (namaPengirim) {
      const shortInst = shortenInstitutionName(instansiClean);
      asalSurat = shortInst
        ? `${namaPengirim} - Pengirim ${shortInst}`
        : `${namaPengirim} - Pengirim`;
    } else if (jabatanPengirim) {
      const jabInst = combineJabatanInstansi(jabatanPengirim, instansiClean);
      asalSurat = jabInst ? `Pengirim - ${jabInst}` : `Pengirim - ${jabatanPengirim}`;
    } else {
      const shortInst = shortenInstitutionName(instansiClean);
      asalSurat = shortInst ? `Pimpinan - ${shortInst}` : 'Pimpinan - Instansi Terkait';
    }
    asalSurat = formatAsalSurat(asalSurat, jabatanPengirim, instansiClean);

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
      /(?:hari\s*(?:\/|\s*dan\s*)?\s*tanggal|pada\s+hari\s*[,/]?\s*tanggal|tanggal\s+pelaksanaan|diselenggarakan\s+pada)\s*[:.-]?\s*([A-Za-z0-9\s,/-]{5,60})/i
    );
    if (dateEventMatch && dateEventMatch[1]) {
      const candidate = dateEventMatch[1].trim().split('\n')[0].replace(/[\(\)]/g, '').trim();
      if (candidate.length >= 5 && candidate !== tanggalSurat) {
        dateEvent = candidate.slice(0, 100);
      }
    }

    // 11. Cari jam/waktu pelaksanaan kegiatan jika ada
    let timeEvent: string | undefined = undefined;
    const timeEventMatch = text.match(
      /(?:pukul|jam|waktu)\s*[:.-]?\s*(\d{1,2}[:.]\d{2}(?:\s*(?:-|s\.?d\.?|sampai|\/)\s*(?:\d{1,2}[:.]\d{2}|selesai))?\s*(?:WIB|WITA|WIT)?)/i
    );
    if (timeEventMatch && timeEventMatch[1]) {
      timeEvent = timeEventMatch[1].trim().slice(0, 100);
    }

    // 12. Cari tempat/lokasi pelaksanaan kegiatan jika ada
    let placeEvent: string | undefined = undefined;
    const placeEventMatch = text.match(
      /(?:tempat|lokasi|bertempat\s+di|venue|ruang(?:an)?)\s*[:.-]?\s*([^\n\r,]+(?:,\s*[^\n\r,]+)?)/i
    );
    if (placeEventMatch && placeEventMatch[1]) {
      const candidate = placeEventMatch[1].trim().replace(/^[\*•\-\s]+/, '');
      if (candidate.length >= 3 && !/^(?:pukul|jam|hari|tanggal|-)$/i.test(candidate)) {
        placeEvent = candidate.slice(0, 220);
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
      timeEvent,
      placeEvent,
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
