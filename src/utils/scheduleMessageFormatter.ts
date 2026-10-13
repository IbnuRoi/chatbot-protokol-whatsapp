import { NormalizedJadwal } from '../services/jadwalService';
import { BotResponse } from '../bot/types';

export interface ExtractedEventMeta {
  no: number;
  judul: string;
  statusIcon: string;
  statusText: string;
  statusCategory: 'selesai' | 'terjadwal' | 'reschedule' | 'other';
  waktu: string;
  lokasi: string;
  penyelenggara?: string | null;
  arahan?: string | null;
  pendamping?: string | null;
  bahan?: string | null;
  pakaian?: string | null;
  catatanLain?: string | null;
  pic?: string | null;
  sortTime: string;
}

const SEPARATOR_LINE = '━━━━━━━━━━━━━━━';

/**
 * Merapikan nomor telepon ke format yang bersih dan konsisten:
 * Contoh: 081217144402 -> +62 812-1714-4402
 *         +6281217144402 -> +62 812-1714-4402
 */
export function formatPhoneNumber(phoneInput?: string | null): string | null {
  if (!phoneInput) return null;
  const raw = phoneInput.trim();
  if (!raw || raw === '-') return null;

  // Jika sudah rapi dengan format +62 8xx-xxxx-xxxx
  if (/^\+62\s+\d{3,4}-\d{3,4}-\d{3,5}$/.test(raw)) {
    return raw;
  }

  // Bersihkan semua karakter selain angka dan tanda plus
  let cleaned = raw.replace(/[^\d+]/g, '');
  if (!cleaned) return null;

  if (cleaned.startsWith('08')) {
    cleaned = '+628' + cleaned.slice(2);
  } else if (cleaned.startsWith('628')) {
    cleaned = '+628' + cleaned.slice(3);
  } else if (!cleaned.startsWith('+') && cleaned.startsWith('62')) {
    cleaned = '+' + cleaned;
  }

  // Format nomor Indonesia (+62 8xx-xxxx-xxxx)
  const indoMatch = cleaned.match(/^(\+62)(8\d{2})(\d{3,4})(\d{3,5})$/);
  if (indoMatch) {
    return `${indoMatch[1]} ${indoMatch[2]}-${indoMatch[3]}-${indoMatch[4]}`;
  }

  // Jika format lain dengan panjang berbeda, rapikan tanda hubung
  const matchGeneric = cleaned.match(/^(\+62)(\d{3,4})(\d{3,4})(\d{3,4})?$/);
  if (matchGeneric) {
    return `${matchGeneric[1]} ${matchGeneric[2]}-${matchGeneric[3]}${matchGeneric[4] ? '-' + matchGeneric[4] : ''}`;
  }

  return raw;
}

/**
 * Merapikan string PIC yang mungkin berisi nama dan nomor kontak
 */
export function formatPic(picRaw?: string | null, picName?: string | null, picPhone?: string | null): string | null {
  if (picName && picPhone) {
    const formattedPhone = formatPhoneNumber(picPhone);
    const cleanName = picName.trim();
    if (formattedPhone && cleanName && cleanName !== '-') {
      return `${cleanName} (${formattedPhone})`;
    }
    return formattedPhone || (cleanName !== '-' ? cleanName : null);
  }

  if (!picRaw || picRaw.trim() === '-' || picRaw.trim() === '') {
    return null;
  }

  const raw = picRaw.trim();

  // Pola: "Nama (Nomor)" atau "Nama - Nomor"
  const bracketMatch = raw.match(/^([^()]+)\s*\(([^()]+)\)$/);
  if (bracketMatch) {
    const name = bracketMatch[1].trim();
    const phone = bracketMatch[2].trim();
    const formattedPhone = formatPhoneNumber(phone) || phone;
    if (name && name !== '-') {
      return `${name} (${formattedPhone})`;
    }
    return formattedPhone;
  }

  const dashMatch = raw.match(/^([a-zA-Z\s.]+)\s*[-:]\s*([+0-9\s-]+)$/);
  if (dashMatch) {
    const name = dashMatch[1].trim();
    const phone = dashMatch[2].trim();
    const formattedPhone = formatPhoneNumber(phone) || phone;
    return `${name} (${formattedPhone})`;
  }

  // Jika hanya nomor telepon
  if (/^[+0-9\s-]+$/.test(raw)) {
    return formatPhoneNumber(raw) || raw;
  }

  return raw;
}

/**
 * Menstandarkan singkatan jabatan resmi sesuai pedoman protokol:
 * Wakil Menteri Ketenagakerjaan -> Wamenaker
 * Staf Khusus Menaker -> Stafsus
 */
export function standardizeAbbreviations(text: string): string {
  if (!text) return '';
  return text
    .replace(/Wakil\s+Menteri\s+Ketenagakerjaan/gi, 'Wamenaker')
    .replace(/Wakil\s+Menteri/gi, 'Wamen')
    .replace(/Staf\s+Khusus\s+(?:Menteri\s+Ketenagakerjaan|Menaker|Menteri)/gi, 'Stafsus')
    .replace(/Staf\s+Khusus/gi, 'Stafsus');
}

/**
 * Memformat jam: 08.30 – 13.00 WIB (titik sebagai pemisah, tanda en-dash "–" untuk rentang).
 * Jika hanya jam mulai: 13.55 WIB.
 * Sesi Menaker jika ada: 🕒 09.00 WIB (sesi Menaker 09.45–10.30)
 */
export function formatTimeDisplay(
  startTime?: string | null,
  finishTime?: string | null,
  sesiMenaker?: string | null
): string {
  const normTime = (t?: string | null) => {
    if (!t || t.trim() === '-' || t.trim() === '') return '';
    let val = t.trim().replace(':', '.');
    // Jika ada leading zero berlebih seperti 010.00 -> 10.00
    val = val.replace(/^0(\d{2}\.)/, '$1');
    return val;
  };

  const start = normTime(startTime) || '09.00';
  const finish = normTime(finishTime);

  let timeStr = `${start} WIB`;
  if (finish && finish !== start && finish !== '00.00') {
    timeStr = `${start} – ${finish} WIB`;
  }

  if (sesiMenaker && sesiMenaker.trim()) {
    const cleanSesi = sesiMenaker.trim().replace(/:/g, '.').replace(/\s*[-–]\s*/g, '–');
    timeStr += ` (sesi Menaker ${cleanSesi})`;
  }

  return timeStr;
}

/**
 * Memetakan status ke icon dan teks sesuai aturan format WhatsApp
 */
export function mapEventStatus(
  statusNum?: number | bigint | null,
  statusStr?: string | null,
  titleOrNotes?: string | null
): { icon: string; text: string; category: 'selesai' | 'terjadwal' | 'reschedule' | 'other' } {
  const rawStatus = (statusStr || '').toLowerCase();
  const code = statusNum !== null && statusNum !== undefined ? Number(statusNum) : null;
  const isTentatif = /tentatif/i.test(titleOrNotes || '') || /tentatif/i.test(rawStatus);

  if (code === 5 || rawStatus.includes('selesai') || rawStatus.includes('terlaksana')) {
    return { icon: '✅', text: '_Selesai_', category: 'selesai' };
  }

  if (code === 2 || rawStatus.includes('reschedule') || rawStatus.includes('dijadwalkan ulang')) {
    return { icon: '🔄', text: '_Dijadwalkan Ulang_', category: 'reschedule' };
  }

  if (code === 1 || rawStatus.includes('diagendakan') || rawStatus.includes('terjadwal') || rawStatus.includes('onschedule')) {
    if (isTentatif) {
      return { icon: '🗓️', text: '_Diagendakan (Tentatif)_', category: 'terjadwal' };
    }
    return { icon: '🗓️', text: '_Diagendakan_', category: 'terjadwal' };
  }

  if (code === 3 || rawStatus.includes('diwakilkan')) {
    return { icon: '👤', text: '_Diwakilkan_', category: 'other' };
  }

  if (code === 4 || rawStatus.includes('batal') || rawStatus.includes('cancel')) {
    return { icon: '❌', text: '_Dibatalkan_', category: 'other' };
  }

  if (code === 6 || rawStatus.includes('tolak')) {
    return { icon: '❌', text: '_Ditolak_', category: 'other' };
  }

  if (isTentatif) {
    return { icon: '🗓️', text: '_Diagendakan (Tentatif)_', category: 'terjadwal' };
  }

  return { icon: '🗓️', text: '_Diagendakan_', category: 'terjadwal' };
}

/**
 * Mengekstrak informasi dari data mentah satu jadwal kegiatan
 */
export function parseEventMetadata(item: NormalizedJadwal, index: number = 1): ExtractedEventMeta {
  const rawTitle = (item.namaKegiatan || '').trim();
  const rawNotes = (item.notes || '').trim();
  const combinedContext = `${rawTitle}\n${rawNotes}`;

  // 1. ARAHAN MENAKER
  let arahan: string | null = null;
  const arahanMatch = combinedContext.match(/\(Arahan\s+Menaker\s*:\s*([^)]+)\)/i);
  if (arahanMatch) {
    const arahanContent = arahanMatch[1].trim();
    // Hanya tampilkan jika berisi perwakilan/disposisi pejabat
    const isPerwakilan =
      /diwakilkan|mewakili|dihadiri|disposisi|dirjen|wamen|stafsus|sekjen|irjen|direktur|kabiro/i.test(
        arahanContent
      ) && !/^agendakan$/i.test(arahanContent) && !/^belum ada disposisi$/i.test(arahanContent);

    if (isPerwakilan) {
      arahan = standardizeAbbreviations(arahanContent);
    }
  }

  // 2. PENYELENGGARA
  let penyelenggara: string | null = null;
  const penyelenggaraMatch =
    combinedContext.match(/(?:yang\s+)?diselenggarakan\s+oleh\s*[:\s]*([^,.\n()]+)/i) ||
    combinedContext.match(/penyelenggara\s*[:\s]*([^,.\n()]+)/i);

  if (penyelenggaraMatch) {
    penyelenggara = penyelenggaraMatch[1].trim();
  } else if (item.surat && (item.surat as any).dari && (item.surat as any).dari !== '-') {
    penyelenggara = (item.surat as any).dari.trim();
  }

  // 3. SESI MENAKER
  let sesiMenaker: string | null = null;
  const sesiMatch = combinedContext.match(
    /(?:sesi|jam bicara)\s*(?:menaker|ibu menteri|menteri)?\s*[:\s]*(\d{1,2}[.:]\d{2}(?:\s*[-–]\s*\d{1,2}[.:]\d{2})?)/i
  );
  if (sesiMatch) {
    sesiMenaker = sesiMatch[1].trim();
  }

  // 4. PENDAMPING
  let pendamping: string | null = null;
  const pendampingMatch = combinedContext.match(
    /pendamping\s*[:\s]*([\s\S]+?)(?=(?:\r?\n|sesi\b|dresscode\b|pakaian\b|bahan\b|catatan\b|$))/i
  );
  if (pendampingMatch) {
    let pList = pendampingMatch[1].trim();
    // Bersihkan penomoran: 1. ... 2. ... -> pisahkan titik koma
    pList = pList
      .replace(/\b\d+\.\s*/g, '')
      .split(/[,;]/)
      .map((s) => s.trim().replace(/\.+$/, ''))
      .filter((s) => s.length > 0 && s !== '-')
      .join('; ');
    if (pList) {
      pendamping = standardizeAbbreviations(pList);
    }
  } else if (item.pejabatHadir && item.pejabatHadir.trim() !== '-' && item.pejabatHadir.trim() !== '') {
    pendamping = standardizeAbbreviations(item.pejabatHadir.trim());
  }

  // 5. BAHAN
  let bahan: string | null = null;
  const bahanMatch = combinedContext.match(/bahan\s*(?:disiapkan\s*(?:oleh)?)?\s*[:\s]*([^.\n;()]+)/i);
  if (bahanMatch) {
    const bStr = bahanMatch[1].trim();
    if (bStr && bStr !== '-') {
      bahan = standardizeAbbreviations(bStr);
    }
  }

  // 6. PAKAIAN (👔) & CATATAN LAIN (ℹ️)
  let pakaian: string | null = null;
  let catatanLain: string | null = null;

  if (rawNotes) {
    // Pisahkan catatan menjadi bagian-bagian
    const noteLines = rawNotes
      .split(/\r?\n|;/)
      .map((l) => l.trim())
      .filter(Boolean);

    const otherNotes: string[] = [];
    for (const line of noteLines) {
      const dressMatch = line.match(/(?:pakaian|dresscode|baju)\s*[:\s]*([^.\n]+)/i);
      if (dressMatch) {
        pakaian = dressMatch[1].trim();
        continue;
      }

      // Deteksi istilah pakaian umum seperti PSL, PSH, PSR, Batik
      if (/\b(psl|psh|psr|batik\s+lengan\s+panjang|pakaian\s+dinas)\b/i.test(line) && !pakaian) {
        pakaian = line.replace(/^(?:catatan|pakaian)\s*[:\s]*/i, '').trim();
        continue;
      }

      // Lewatkan jika baris ini berisi metadata lain yang sudah diekstrak atau merupakan header
      if (
        /^[🕒📍📞🏢👤👥📝👔ℹ️📌]/.test(line) ||
        /^(?:waktu|lokasi|pic|kontak|pukul|jam)\s*[:\s]/i.test(line) ||
        /^\*?\d+\.\*?/.test(line) ||
        /(?:sesi|jam bicara)\s*(?:menaker|ibu menteri|menteri)?/i.test(line) ||
        /^bahan\s*(?:disiapkan)?/i.test(line) ||
        /^pendamping/i.test(line) ||
        /^(?:yang\s+)?diselenggarakan/i.test(line) ||
        /^(?:diwakilkan|arahan\s+menaker)/i.test(line)
      ) {
        continue;
      }

      const cleanLine = line.replace(/^catatan\s*[:\s]*/i, '').trim();
      if (cleanLine && cleanLine !== '-') {
        otherNotes.push(cleanLine);
      }
    }

    if (otherNotes.length > 0) {
      catatanLain = standardizeAbbreviations(otherNotes.join('; '));
    }
  }

  // 7. BERSIHKAN JUDUL (Maksimal sekitar 12 kata, buang kalimat panjang / disposisi)
  let cleanTitle = rawTitle;
  // Buang tag disposisi
  cleanTitle = cleanTitle.replace(/\(Arahan\s+Menaker\s*:[^)]+\)/gi, '');
  cleanTitle = cleanTitle.replace(/\(Belum\s+ada\s+disposisi\)/gi, '');
  cleanTitle = cleanTitle.replace(/\(Diagendakan(?:\s*-\s*Tentatif)?\)/gi, '');
  cleanTitle = cleanTitle.replace(/\(Tentatif\)/gi, '');

  // Buang klausa penyelenggara dari judul
  cleanTitle = cleanTitle.replace(/(?:,\s*)?(?:yang\s+)?diselenggarakan\s+oleh\s+[^,.\n()]+/gi, '');
  // Buang klausa "dalam rangka..." dari judul
  cleanTitle = cleanTitle.replace(/(?:,\s*)?dalam\s+rangka\s+[^,.\n()]+/gi, '');
  // Buang klausa "dengan tema..." dari judul
  cleanTitle = cleanTitle.replace(/(?:,\s*)?(?:dengan\s+)?tema\s*[:\s]*[^,.\n()]+/gi, '');

  // Rapikan spasi dan tanda baca berlebih di ujung
  cleanTitle = cleanTitle.replace(/\s+/g, ' ').replace(/^[,\s-]+|[,\s-]+$/g, '').trim();

  // Batasi panjang judul jika masih terlalu panjang (>14 kata)
  const words = cleanTitle.split(/\s+/);
  if (words.length > 14) {
    cleanTitle = words.slice(0, 12).join(' ') + '...';
  }

  if (!cleanTitle) {
    cleanTitle = 'Agenda Kegiatan Protokol';
  }

  // 8. STATUS
  const statusInfo = mapEventStatus(item.statusDisposisiCode, item.statusDisposisi, combinedContext);

  // 9. WAKTU
  const waktu = formatTimeDisplay(item.waktuMulai, item.waktuSelesai, sesiMenaker);

  // 10. LOKASI
  let lokasi = (item.lokasi || '').trim();
  if (!lokasi || lokasi === '-') {
    lokasi = '_Belum ditentukan_';
  }

  // 11. PIC
  const pic = formatPic(item.pic, (item as any).picName, (item as any).picPhone);

  const sortTime = (item.waktuMulai || '09:00').replace(':', '.');

  return {
    no: index,
    judul: cleanTitle,
    statusIcon: statusInfo.icon,
    statusText: statusInfo.text,
    statusCategory: statusInfo.category,
    waktu,
    lokasi,
    penyelenggara,
    arahan,
    pendamping,
    bahan,
    pakaian,
    catatanLain,
    pic,
    sortTime,
  };
}

/**
 * Merender satu item kegiatan sesuai template:
 * *{no}. {Judul singkat}*
 * {ikon status} _{status}_
 * 🕒 {waktu}
 * 📍 {lokasi}
 * 🏢 {penyelenggara}
 * 👤 {arahan / perwakilan}
 * 👥 Pendamping: {daftar, dipisah titik koma}
 * 📝 Bahan: {penyiap bahan}
 * 👔 {ketentuan pakaian}
 * ℹ️ {catatan lain}
 * 📞 {PIC}
 */
export function formatSingleEventText(meta: ExtractedEventMeta): string {
  const lines: string[] = [];

  // Baris 1: Judul
  lines.push(`*${meta.no}. ${meta.judul}*`);

  // Baris 2: Status
  lines.push(`${meta.statusIcon} ${meta.statusText}`);

  // Baris 3: Waktu
  lines.push(`🕒 ${meta.waktu}`);

  // Baris 4: Lokasi (Pengecualian: jika kosong, tulis 📍 _Belum ditentukan_)
  lines.push(`📍 ${meta.lokasi}`);

  // Baris 5: Penyelenggara (Hanya jika ada)
  if (meta.penyelenggara) {
    lines.push(`🏢 ${meta.penyelenggara}`);
  }

  // Baris 6: Arahan / Perwakilan (Hanya jika berisi perwakilan)
  if (meta.arahan) {
    lines.push(`👤 ${meta.arahan}`);
  }

  // Baris 7: Pendamping (Hanya jika ada)
  if (meta.pendamping) {
    lines.push(`👥 Pendamping: ${meta.pendamping}`);
  }

  // Baris 8: Bahan (Hanya jika ada)
  if (meta.bahan) {
    lines.push(`📝 Bahan: ${meta.bahan}`);
  }

  // Baris 9: Pakaian (Hanya jika ada)
  if (meta.pakaian) {
    lines.push(`👔 ${meta.pakaian}`);
  }

  // Baris 10: Catatan lain (Hanya jika ada)
  if (meta.catatanLain) {
    lines.push(`ℹ️ ${meta.catatanLain}`);
  }

  // Baris 11: PIC (Hanya jika ada)
  if (meta.pic) {
    lines.push(`📞 ${meta.pic}`);
  }

  return lines.join('\n');
}

/**
 * Menghasilkan baris ringkasan status kegiatan:
 * Total *N kegiatan*
 * ✅ X selesai · 🗓️ Y terjadwal · 🔄 Z reschedule
 * (Hilangkan kategori yang jumlahnya 0)
 */
export function buildSummaryLines(items: ExtractedEventMeta[]): string {
  const total = items.length;
  const selesaiCount = items.filter((i) => i.statusCategory === 'selesai').length;
  const terjadwalCount = items.filter((i) => i.statusCategory === 'terjadwal').length;
  const rescheduleCount = items.filter((i) => i.statusCategory === 'reschedule').length;

  const parts: string[] = [];
  if (selesaiCount > 0) parts.push(`✅ ${selesaiCount} selesai`);
  if (terjadwalCount > 0) parts.push(`🗓️ ${terjadwalCount} terjadwal`);
  if (rescheduleCount > 0) parts.push(`🔄 ${rescheduleCount} reschedule`);

  let res = `Total *${total} kegiatan*`;
  if (parts.length > 0) {
    res += `\n${parts.join(' · ')}`;
  }

  return res;
}

export interface FormatAgendaOptions {
  dateFormatted: string; // Contoh: "Senin, 13 Oktober 2026"
  items: NormalizedJadwal[];
  isRange?: boolean;
  rangeLabel?: string;
  footerCallToAction?: string;
}

/**
 * Mengubah data kegiatan menjadi pesan WhatsApp protokol yang rapi, ringkas, dan mudah dipindai
 * Sesuai seluruh aturan format WhatsApp protokol Kemnaker
 */
export function formatAgendaProtocolMessage(options: FormatAgendaOptions): BotResponse {
  const { dateFormatted, items, isRange, rangeLabel, footerCallToAction } = options;

  // Header pesan
  const headerTitle = isRange && rangeLabel
    ? `📅 *AGENDA KEGIATAN PROTOKOL (${rangeLabel.toUpperCase()})*\n${dateFormatted}`
    : `📅 *AGENDA KEGIATAN PROTOKOL*\n${dateFormatted}`;

  // Kasus Khusus: Tidak ada kegiatan
  if (!items || items.length === 0) {
    const emptyText =
      `${headerTitle}\n\n` +
      `Tidak ada kegiatan terjadwal pada tanggal ini.`;
    return { text: emptyText };
  }

  // Urutkan kegiatan berdasarkan waktu mulai (paling awal dulu)
  const sortedItems = [...items].sort((a, b) => {
    const timeA = (a.waktuMulai || '00:00').replace(':', '.');
    const timeB = (b.waktuMulai || '00:00').replace(':', '.');
    return timeA.localeCompare(timeB);
  });

  // Parse metadata tiap item
  const parsedItems: ExtractedEventMeta[] = sortedItems.map((item, idx) =>
    parseEventMetadata(item, idx + 1)
  );

  // Render teks masing-masing kegiatan
  const formattedActivities = parsedItems.map((meta) => formatSingleEventText(meta));

  const summaryText = buildSummaryLines(parsedItems);
  const footerText = footerCallToAction || 'Ketik *jadwal besok* atau *jadwal [tanggal]* untuk agenda lainnya.';

  // Pembagian pesan jika jumlah kegiatan > 8 atau karakter > 3500
  const MAX_ITEMS_PER_PAGE = 8;
  const MAX_CHARS_PER_MSG = 3400;

  const chunks: string[][] = [];
  let currentChunk: string[] = [];
  let currentChunkLength = 0;

  for (let i = 0; i < formattedActivities.length; i++) {
    const actText = formattedActivities[i];
    const actLength = actText.length + 2;

    if (
      currentChunk.length >= MAX_ITEMS_PER_PAGE ||
      (currentChunk.length > 0 && currentChunkLength + actLength > MAX_CHARS_PER_MSG)
    ) {
      chunks.push(currentChunk);
      currentChunk = [actText];
      currentChunkLength = actLength;
    } else {
      currentChunk.push(actText);
      currentChunkLength += actLength;
    }
  }
  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  const totalPages = chunks.length;

  // Jika hanya 1 bagian (<= 8 kegiatan dan muat dalam 1 pesan)
  if (totalPages === 1) {
    const fullText =
      `${headerTitle}\n\n` +
      `${summaryText}\n\n` +
      `${SEPARATOR_LINE}\n\n` +
      `${formattedActivities.join('\n\n')}\n\n` +
      `${SEPARATOR_LINE}\n` +
      `${footerText}`;

    return { text: fullText };
  }

  // Jika terbagi menjadi beberapa pesan (> 8 kegiatan)
  const messages: string[] = [];
  for (let pageIdx = 0; pageIdx < totalPages; pageIdx++) {
    const pageItems = chunks[pageIdx];
    const pageNum = pageIdx + 1;
    const isFirstPage = pageNum === 1;
    const isLastPage = pageNum === totalPages;

    let msgContent = '';

    if (isFirstPage) {
      msgContent =
        `${headerTitle}\n\n` +
        `${summaryText}\n\n` +
        `${SEPARATOR_LINE}\n\n` +
        `${pageItems.join('\n\n')}\n\n` +
        `${SEPARATOR_LINE}\n` +
        `_(Bagian ${pageNum}/${totalPages})_`;
    } else if (isLastPage) {
      msgContent =
        `${SEPARATOR_LINE}\n\n` +
        `${pageItems.join('\n\n')}\n\n` +
        `${SEPARATOR_LINE}\n` +
        `${footerText}\n\n` +
        `_(Bagian ${pageNum}/${totalPages})_`;
    } else {
      msgContent =
        `${SEPARATOR_LINE}\n\n` +
        `${pageItems.join('\n\n')}\n\n` +
        `${SEPARATOR_LINE}\n` +
        `_(Bagian ${pageNum}/${totalPages})_`;
    }

    messages.push(msgContent);
  }

  return {
    text: messages.join('\n\n'),
    messages,
  };
}

/**
 * Mem-parse data jadwal mentah berupa string (misalnya dari copy-paste teks user)
 * dan mengonversinya langsung ke format WhatsApp protokol resmi.
 */
export function formatRawScheduleText(tanggalStr: string, rawText: string): string {
  if (!rawText || !rawText.trim()) {
    return (
      `📅 *AGENDA KEGIATAN PROTOKOL*\n` +
      `${tanggalStr}\n\n` +
      `Tidak ada kegiatan terjadwal pada tanggal ini.`
    );
  }

  // Pisahkan blok per kegiatan berdasarkan penomoran atau baris kosong
  const rawBlocks = rawText
    .split(/\n\s*\n|(?=^\s*(?:\d+\.|\*?\d+\.\*?)\s+)/m)
    .map((b) => b.trim())
    .filter(Boolean);

  const mockItems: NormalizedJadwal[] = [];

  for (let i = 0; i < rawBlocks.length; i++) {
    const block = rawBlocks[i];

    // Ekstrak waktu jika ada (contoh: 08:30 atau 08.30)
    let startTime = '09:00';
    let finishTime: string | null = null;
    const timeMatch = block.match(/(?:🕒|waktu|pukul)?\s*(\d{1,2}[.:]\d{2})\s*(?:[-–]\s*(\d{1,2}[.:]\d{2}))?/i);
    if (timeMatch) {
      startTime = timeMatch[1].replace('.', ':');
      if (timeMatch[2]) finishTime = timeMatch[2].replace('.', ':');
    }

    // Ekstrak lokasi jika ada
    let lokasi = '-';
    const locMatch = block.match(/(?:📍|lokasi)\s*[:\s]*([^\n]+)/i);
    if (locMatch) {
      lokasi = locMatch[1].trim();
    }

    // Ekstrak status jika ada
    let statusDisp = 'Diagendakan';
    let statusCode: number | null = 1;
    if (/selesai|terlaksana/i.test(block)) {
      statusDisp = 'Selesai / Terlaksana';
      statusCode = 5;
    } else if (/reschedule|jadwal ulang/i.test(block)) {
      statusDisp = 'Dijadwalkan Ulang (Reschedule)';
      statusCode = 2;
    } else if (/tentatif/i.test(block)) {
      statusDisp = 'Diagendakan - Tentatif';
      statusCode = 1;
    }

    // Ekstrak PIC jika ada
    let pic: string = '-';
    const picMatch = block.match(/(?:📞|pic|kontak)\s*[:\s]*([^\n]+)/i);
    if (picMatch) {
      pic = picMatch[1].trim();
    }

    // Ekstrak baris pertama sebagai judul mentah
    const firstLine = block.split('\n')[0].replace(/^\*?\d+\.\*?\s*/, '').trim();

    mockItems.push({
      id: i + 1,
      namaKegiatan: firstLine || block,
      tanggalKegiatan: tanggalStr,
      waktuMulai: startTime,
      waktuSelesai: finishTime,
      lokasi,
      pejabatHadir: '-',
      pic,
      statusDisposisi: statusDisp,
      statusDisposisiCode: statusCode,
      notes: block,
    });
  }

  const res = formatAgendaProtocolMessage({
    dateFormatted: tanggalStr,
    items: mockItems,
  });

  return typeof res === 'string' ? res : res.text;
}
