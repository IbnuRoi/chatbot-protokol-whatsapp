/**
 * Helper untuk parsing dan formatting tanggal dalam bahasa Indonesia
 */

const MONTH_MAP: Record<string, number> = {
  januari: 1,
  jan: 1,
  februari: 2,
  feb: 2,
  maret: 3,
  mar: 3,
  april: 4,
  apr: 4,
  mei: 5,
  may: 5,
  juni: 6,
  jun: 6,
  juli: 7,
  jul: 7,
  agustus: 8,
  ags: 8,
  agu: 8,
  aug: 8,
  september: 9,
  sep: 9,
  sept: 9,
  oktober: 10,
  okt: 10,
  oct: 10,
  november: 11,
  nov: 11,
  desember: 12,
  des: 12,
  dec: 12,
};

const INDO_MONTH_NAMES = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
];

const INDO_DAY_NAMES = [
  'Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'
];

export interface ParsedDateResult {
  dateStr: string; // Format ISO: YYYY-MM-DD
  formattedIndo: string; // Contoh: "Jumat, 18 September 2026"
  year: number;
  month: number;
  day: number;
}

/**
 * Memformat objek Date atau string YYYY-MM-DD ke string tanggal bahasa Indonesia
 */
export function formatTanggalIndo(dateInput: string | Date, withDay: boolean = true): string {
  if (!dateInput) return '';

  let dateObj: Date;
  let y: number;
  let m: number;
  let d: number;

  if (typeof dateInput === 'string') {
    const parts = dateInput.trim().split('-');
    if (parts.length === 3) {
      y = parseInt(parts[0], 10);
      m = parseInt(parts[1], 10) - 1;
      d = parseInt(parts[2], 10);
      dateObj = new Date(y, m, d);
    } else {
      dateObj = new Date(dateInput);
      y = dateObj.getFullYear();
      m = dateObj.getMonth();
      d = dateObj.getDate();
    }
  } else {
    dateObj = dateInput;
    y = dateObj.getFullYear();
    m = dateObj.getMonth();
    d = dateObj.getDate();
  }

  if (isNaN(dateObj.getTime())) {
    return String(dateInput);
  }

  const dayName = INDO_DAY_NAMES[dateObj.getDay()];
  const monthName = INDO_MONTH_NAMES[m] || '';

  if (withDay) {
    return `${dayName}, ${d} ${monthName} ${y}`;
  }
  return `${d} ${monthName} ${y}`;
}

/**
 * Memformat jam mulai dan jam selesai ke string tampilan waktu yang rapi
 * Contoh:
 * - ("08:00", "12:00") -> "08:00 - 12:00 WIB"
 * - ("11:39", "11:39") -> "11:39 WIB"
 * - ("00:00", "00:00") -> "Sepanjang Hari (All Day)"
 * - ("09:00", null) -> "09:00 WIB"
 */
export function formatWaktuDisplay(waktuMulai: string, waktuSelesai?: string | null): string {
  if (!waktuMulai || (waktuMulai === '00:00' && (!waktuSelesai || waktuSelesai === '00:00'))) {
    return 'Sepanjang Hari (All Day)';
  }
  if (waktuSelesai && waktuSelesai !== waktuMulai && waktuSelesai !== '00:00') {
    return `${waktuMulai} - ${waktuSelesai} WIB`;
  }
  return `${waktuMulai} WIB`;
}

/**
 * Mengekstrak tanggal dari teks percakapan bahasa Indonesia
 * Contoh input:
 * - "kirim jadwal tanggal 18 september dong"
 * - "jadwal 18 sep 2026"
 * - "jadwal tanggal 23/09/2026"
 * - "ada apa tanggal 18-09"
 * - "jadwal besok" / "hari ini" / "lusa"
 */
export function extractDateFromText(text: string, referenceDate: Date = new Date()): ParsedDateResult | null {
  if (!text || typeof text !== 'string') return null;
  const clean = text.toLowerCase().trim();

  const refYear = referenceDate.getFullYear();

  // 1. Cek kata relatif: "hari ini", "besok", "lusa"
  if (clean.includes('hari ini')) {
    const d = new Date(referenceDate);
    return toResult(d.getFullYear(), d.getMonth() + 1, d.getDate());
  }
  if (clean.includes('besok') || clean.includes('esok')) {
    const d = new Date(referenceDate);
    d.setDate(d.getDate() + 1);
    return toResult(d.getFullYear(), d.getMonth() + 1, d.getDate());
  }
  if (clean.includes('lusa')) {
    const d = new Date(referenceDate);
    d.setDate(d.getDate() + 2);
    return toResult(d.getFullYear(), d.getMonth() + 1, d.getDate());
  }

  // 2. Format: "18 September 2026", "18 september", "tgl 18 sep", "tanggal 18 sept"
  const monthWords = Object.keys(MONTH_MAP).join('|');
  const textDateRegex = new RegExp(
    `(?:tanggal|tgl)?\\s*\\b([0-2]?[1-9]|3[01])\\s*(?:-|/|\\s)\\s*(${monthWords})(?:\\s*(?:-|/|\\s)\\s*(\\d{4}))?\\b`,
    'i'
  );
  const textMatch = clean.match(textDateRegex);
  if (textMatch) {
    const day = parseInt(textMatch[1], 10);
    const month = MONTH_MAP[textMatch[2].toLowerCase()];
    const year = textMatch[3] ? parseInt(textMatch[3], 10) : refYear;
    if (day >= 1 && day <= 31 && month) {
      return toResult(year, month, day);
    }
  }

  // 3. Format ISO: "2026-09-18"
  const isoMatch = clean.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (isoMatch) {
    const year = parseInt(isoMatch[1], 10);
    const month = parseInt(isoMatch[2], 10);
    const day = parseInt(isoMatch[3], 10);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      return toResult(year, month, day);
    }
  }

  // 4. Format Numerik: "18/09/2026", "18-09-2026", "18/09", "18-09"
  const numMatch = clean.match(/(?:tanggal|tgl)?\s*\b([0-2]?[1-9]|3[01])[/.-](\d{1,2})(?:[/.-](\d{4}))?\b/i);
  if (numMatch) {
    const day = parseInt(numMatch[1], 10);
    const month = parseInt(numMatch[2], 10);
    const year = numMatch[3] ? parseInt(numMatch[3], 10) : refYear;
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      return toResult(year, month, day);
    }
  }

  return null;
}

export interface ParsedDateRangeResult {
  daysCount: number; // Jumlah hari ke depan (misal: 2, 3, 5, 7, 14)
  startDateStr: string; // Format ISO: YYYY-MM-DD (hari ini)
  endDateStr: string; // Format ISO: YYYY-MM-DD (hari ini + N hari)
  formattedStart: string; // Contoh: "Senin, 21 September 2026"
  formattedEnd: string; // Contoh: "Rabu, 23 September 2026"
  formattedRange: string; // Contoh: "Senin, 21 September 2026 s.d. Rabu, 23 September 2026"
  label: string; // Contoh: "2 Hari ke Depan", "Seminggu ke Depan", "Dua Minggu ke Depan"
}

const INDO_NUMBER_WORDS: Record<string, number> = {
  satu: 1,
  se: 1,
  dua: 2,
  tiga: 3,
  empat: 4,
  lima: 5,
  enam: 6,
  tujuh: 7,
  delapan: 8,
  sembilan: 9,
  sepuluh: 10,
  sebelas: 11,
  'dua belas': 12,
  'tiga belas': 13,
  'empat belas': 14,
};

/**
 * Mengekstrak rentang hari pencarian jadwal dari percakapan bahasa Indonesia
 * Contoh input:
 * - "berikan jadwal 2 hari kedepan"
 * - "berikan jadwal 3 hari ke depan"
 * - "berikan jadwal 5 hari kedepan"
 * - "berikan jadwal seminggu kedepan"
 * - "berikan jadwal dua minggu kedepan"
 * - "jadwal 7 hari ke depan", "agenda sebulan kedepan"
 */
export function extractDateRangeFromText(text: string, referenceDate: Date = new Date()): ParsedDateRangeResult | null {
  if (!text || typeof text !== 'string') return null;
  const clean = text.toLowerCase().trim();

  let daysCount: number | null = null;
  let label = '';

  // 1. Deteksi pola minggu / pekan
  if (
    clean.includes('dua minggu') ||
    clean.includes('2 minggu') ||
    clean.includes('dua pekan') ||
    clean.includes('2 pekan')
  ) {
    daysCount = 14;
    label = 'Dua Minggu ke Depan';
  } else if (
    clean.includes('seminggu') ||
    clean.includes('sepekan') ||
    clean.includes('1 minggu') ||
    clean.includes('1 pekan') ||
    clean.includes('satu minggu') ||
    clean.includes('satu pekan')
  ) {
    daysCount = 7;
    label = 'Seminggu ke Depan';
  } else if (clean.includes('tiga minggu') || clean.includes('3 minggu') || clean.includes('3 pekan')) {
    daysCount = 21;
    label = '3 Minggu ke Depan';
  } else if (
    clean.includes('sebulan') ||
    clean.includes('1 bulan') ||
    clean.includes('satu bulan') ||
    clean.includes('empat minggu') ||
    clean.includes('4 minggu')
  ) {
    daysCount = 30;
    label = 'Sebulan ke Depan';
  }

  // 2. Deteksi pola hari dengan angka atau kata:
  // contoh: "2 hari kedepan", "3 hari ke depan", "5 hari kedepan", "sepuluh hari ke depan"
  if (daysCount === null) {
    // Regex mendeteksi: [angka/kata] hari [ke depan / kedepan / mendatang / berikutnya]
    const daysRegex =
      /\b(\d+|satu|dua|tiga|empat|lima|enam|tujuh|delapan|sembilan|sepuluh|sebelas|dua\s*belas|tiga\s*belas|empat\s*belas)\s*hari(?:\s*(?:ke\s*depan|kedepan|mendatang|berikutnya|kedepannya))?\b/i;
    const match = clean.match(daysRegex);

    if (match) {
      // Pastikan ada konteks "ke depan / kedepan / mendatang / jadwal / agenda / berikan"
      const hasForwardContext =
        clean.includes('depan') ||
        clean.includes('mendatang') ||
        clean.includes('berikutnya') ||
        clean.includes('jadwal') ||
        clean.includes('agenda') ||
        clean.includes('kegiatan') ||
        clean.includes('berikan') ||
        clean.includes('minta') ||
        clean.includes('cari');

      if (hasForwardContext) {
        const rawNum = match[1].toLowerCase().replace(/\s+/g, ' ');
        if (/^\d+$/.test(rawNum)) {
          daysCount = parseInt(rawNum, 10);
        } else if (INDO_NUMBER_WORDS[rawNum]) {
          daysCount = INDO_NUMBER_WORDS[rawNum];
        }

        if (daysCount && daysCount > 0) {
          label = `${daysCount} Hari ke Depan`;
        }
      }
    }
  }

  // 3. Deteksi pola terbalik: "ke depan 3 hari" / "kedepan 5 hari"
  if (daysCount === null) {
    const reverseRegex = /(?:ke\s*depan|kedepan|mendatang)\s*(\d+|satu|dua|tiga|empat|lima|enam|tujuh|delapan|sembilan|sepuluh)\s*hari/i;
    const matchRev = clean.match(reverseRegex);
    if (matchRev) {
      const rawNum = matchRev[1].toLowerCase();
      if (/^\d+$/.test(rawNum)) {
        daysCount = parseInt(rawNum, 10);
      } else if (INDO_NUMBER_WORDS[rawNum]) {
        daysCount = INDO_NUMBER_WORDS[rawNum];
      }

      if (daysCount && daysCount > 0) {
        label = `${daysCount} Hari ke Depan`;
      }
    }
  }

  if (daysCount === null || daysCount <= 0) {
    return null;
  }

  // Hitung rentang tanggal (WIB UTC+7)
  const utcMs = referenceDate.getTime() + referenceDate.getTimezoneOffset() * 60000;
  const wibMs = utcMs + 7 * 3600000;
  const wibStart = new Date(wibMs);
  const y1 = wibStart.getFullYear();
  const m1 = wibStart.getMonth() + 1;
  const d1 = wibStart.getDate();
  const startDateStr = `${y1}-${String(m1).padStart(2, '0')}-${String(d1).padStart(2, '0')}`;

  const wibEnd = new Date(wibMs);
  wibEnd.setDate(wibEnd.getDate() + daysCount);
  const y2 = wibEnd.getFullYear();
  const m2 = wibEnd.getMonth() + 1;
  const d2 = wibEnd.getDate();
  const endDateStr = `${y2}-${String(m2).padStart(2, '0')}-${String(d2).padStart(2, '0')}`;

  const formattedStart = formatTanggalIndo(startDateStr, true);
  const formattedEnd = formatTanggalIndo(endDateStr, true);
  const formattedRange = `${formattedStart} s.d. ${formattedEnd}`;

  return {
    daysCount,
    startDateStr,
    endDateStr,
    formattedStart,
    formattedEnd,
    formattedRange,
    label,
  };
}

function toResult(year: number, month: number, day: number): ParsedDateResult {
  const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const formattedIndo = formatTanggalIndo(dateStr, true);
  return {
    dateStr,
    formattedIndo,
    year,
    month,
    day,
  };
}

