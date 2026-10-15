/**
 * Utilitas untuk membersihkan tag HTML dan decode entitas HTML umum
 * dari teks yang disimpan di database (seperti title event atau note disposisi)
 */
export function cleanHtml(text: string | null | undefined): string {
  if (!text) return '';

  let clean = text
    // 1. Ganti line breaks dan paragraph endings dengan spasi atau newline
    .replace(/<br\s*[\/]?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    // 2. Buang seluruh tag HTML lainnya
    .replace(/<[^>]+>/g, '')
    // 3. Decode entitas HTML yang sering muncul di teks database
    .replace(/&nbsp;/gi, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&#13;/gi, '')
    // 4. Normalisasi newline dan whitespace ganda
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim();

  return clean;
}

/**
 * Memformat teks perihal ke format HTML paragraf (<p>...</p>)
 * sesuai standar penyimpanan kolom `note` pada tabel `letters` dan `dispositions` di database.
 */
export function formatNoteHtml(text: string | null | undefined): string {
  if (!text || !text.trim() || text.trim() === '-') return '';
  const trimmed = text.trim();

  // Jika teks sudah diawali dan diakhiri tag <p>...</p>, pertahankan
  if (trimmed.startsWith('<p>') && trimmed.endsWith('</p>')) {
    return trimmed;
  }

  // Pisahkan berdasarkan baris baru jika teks memiliki beberapa paragraf
  const paragraphs = trimmed
    .split(/\r?\n+/)
    .map((p) => p.trim())
    .filter(Boolean);

  if (paragraphs.length === 0) return '';
  return paragraphs.map((p) => `<p>${p}</p>`).join('');
}

/**
 * Menghitung jarak Levenshtein (edit distance) antara dua kata/string.
 * Mengembalikan jumlah operasi penambahan, penghapusan, atau penggantian karakter.
 */
export function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array(b.length + 1).fill(0);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1, // insertion
        prev[j] + 1, // deletion
        prev[j - 1] + cost // substitution
      );
    }
    for (let j = 0; j <= b.length; j++) {
      prev[j] = curr[j];
    }
  }

  return prev[b.length];
}

/**
 * Memeriksa apakah kata sumber memiliki kemiripan (fuzzy match) dengan kata target
 * berdasarkan ambang batas toleransi kesalahan ketik (typo).
 * - Panjang <= 3: exact match
 * - Panjang 4-6: toleransi 1 karakter typo
 * - Panjang >= 7: toleransi 2 karakter typo
 */
export function isFuzzyMatch(word: string, target: string, maxDistance?: number): boolean {
  if (!word || !target) return false;
  const w = word.toLowerCase().trim();
  const t = target.toLowerCase().trim();
  if (w === t) return true;

  const lenDiff = Math.abs(w.length - t.length);
  const maxLen = Math.max(w.length, t.length);

  let threshold = maxDistance;
  if (threshold === undefined) {
    if (maxLen <= 3) {
      threshold = 0;
    } else if (maxLen <= 6) {
      threshold = 1;
    } else {
      threshold = 2;
    }
  }

  if (lenDiff > threshold) return false;
  return levenshteinDistance(w, t) <= threshold;
}

/**
 * Menormalkan karakter yang berulang akibat ketidaksengajaan mengetik di WhatsApp.
 * Contoh:
 * - "dikirimkann" -> "dikirimkan"
 * - "suratt" -> "surat"
 * - "mauuu" -> "mau"
 * - "halooo" -> "halo"
 * - "yaaa" -> "ya"
 * - "siapp" -> "siap"
 * - "besokk" -> "besok"
 */
export function normalizeRepeatedCharacters(text: string): string {
  if (!text) return '';

  let res = text;
  // 1. Kompresi 3 atau lebih karakter berulang di mana pun dalam kata (e.g. "assssalamualaikum" -> "asalamualaikum", "mauuu" -> "mau")
  res = res.replace(/(.)\1{2,}/gi, '$1');

  // 2. Kompresi 2 konsonan identik di akhir kata (e.g. "dikirimkann" -> "dikirimkan", "suratt" -> "surat", "jadwall" -> "jadwal")
  res = res.replace(/\b(\w+?)([b-df-hj-np-tv-z])\2+\b/gi, '$1$2');

  // 3. Kompresi 2 vokal identik di akhir kata (e.g. "haloo" -> "halo", "iyaa" -> "iya", "siapp" -> "siap", "okee" -> "oke")
  res = res.replace(/\b(\w+?)([aeiou])\2+\b/gi, '$1$2');

  return res;
}

/**
 * Kamus pemetaan kata slang, singkatan percakapan WhatsApp, dan typo umum
 * ke bentuk kata baku protokol Kemnaker RI
 */
export const SLANG_DICTIONARY: Record<string, string> = {
  // Kata bantu & percakapan santai
  'igin': 'ingin',
  'pengen': 'ingin',
  'pingin': 'ingin',
  'pgn': 'ingin',
  'mauu': 'mau',
  'bsk': 'besok',
  'beso': 'besok',
  'bso': 'besok',
  'hr': 'hari',
  'hri': 'hari',
  'skrg': 'sekarang',
  'skrang': 'sekarang',
  'tdk': 'tidak',
  'tdak': 'tidak',
  'ngga': 'tidak',
  'nggak': 'tidak',
  'gak': 'tidak',
  'ga': 'tidak',
  'gk': 'tidak',
  'udh': 'sudah',
  'uda': 'sudah',
  'sdh': 'sudah',
  'sda': 'sudah',
  'blm': 'belum',
  'blom': 'belum',
  'dgn': 'dengan',
  'dg': 'dengan',
  'utk': 'untuk',
  'untk': 'untuk',
  'sy': 'saya',
  'sya': 'saya',
  'ak': 'aku',
  'km': 'kamu',
  'kmu': 'kamu',
  'lg': 'lagi',
  'lgi': 'lagi',
  'dr': 'dari',
  'dri': 'dari',
  'krn': 'karena',
  'karna': 'karena',
  'tp': 'tapi',
  'tpi': 'tapi',
  'bkn': 'bukan',
  'bgt': 'banget',
  'gmn': 'gimana',
  'bgmn': 'bagaimana',
  'knp': 'kenapa',
  'tlg': 'tolong',
  'tlong': 'tolong',
  'tlng': 'tolong',
  'mhon': 'mohon',
  'mhn': 'mohon',
  'mks': 'makasih',
  'mksh': 'makasih',
  'makasi': 'makasih',
  'makasihh': 'makasih',
  'terimakasih': 'terima kasih',
  'ywdh': 'ya sudah',
  'hay': 'hai',

  // Aksi & Perintah
  'liat': 'lihat',
  'lhat': 'lihat',
  'lht': 'lihat',
  'cek': 'cek',
  'ck': 'cek',
  'batalin': 'batal',
  'batalkeun': 'batal',
  'gajadi': 'batal',
  'inpt': 'input',
  'imput': 'input',
  'tmbh': 'tambah',
  'tmbah': 'tambah',
  'ctat': 'catat',
  'catet': 'catat',
  'masukkin': 'masukkan',
  'masukin': 'masukkan',
  'crkn': 'carikan',
  'cri': 'cari',
  'bntuan': 'bantuan',
  'bntu': 'bantuan',
  'bantun': 'bantuan',

  // Domain Protokol & Persuratan
  'jdwl': 'jadwal',
  'jadwl': 'jadwal',
  'jadwall': 'jadwal',
  'jawal': 'jadwal',
  'jdwal': 'jadwal',
  'agnda': 'agenda',
  'kgiatan': 'kegiatan',
  'dispo': 'disposisi',
  'dispossi': 'disposisi',
  'diposisi': 'disposisi',
  'disposi': 'disposisi',
  'disposs': 'disposisi',
  'dispoisi': 'disposisi',
  'dissposisi': 'disposisi',
  'surt': 'surat',
  'suratt': 'surat',
  'srat': 'surat',
  'surat2': 'surat-surat',
  'dok': 'dokumen',
  'dokmen': 'dokumen',
  'riwyat': 'riwayat',
  'riwayt': 'riwayat',
  'riwayatt': 'riwayat',
  'rkor': 'rakor',
  'rakro': 'rakor',
  'rakorr': 'rakor',
  'audinsi': 'audiensi',
  'audensi': 'audiensi',
  'poltekes': 'poltekkes',
  'kemenakr': 'kemnaker',
  'kemnker': 'kemnaker',
};

/**
 * Mengganti kata slang / singkatan percakapan WhatsApp dengan padanan kata baku
 */
export function normalizeChatSlang(text: string): string {
  if (!text) return '';
  return text.replace(/\b[a-zA-Z0-9_-]+\b/g, (token) => {
    const lower = token.toLowerCase();
    const replacement = SLANG_DICTIONARY[lower];
    if (replacement) {
      if (token[0] === token[0].toUpperCase() && token.length > 1 && token[1] === token[1].toLowerCase()) {
        return replacement.charAt(0).toUpperCase() + replacement.slice(1);
      }
      return replacement;
    }
    return token;
  });
}

/**
 * Normalisasi lengkap input teks pengguna:
 * 1. Menghilangkan spasi berlebih
 * 2. Mengompresi karakter/huruf berulang (typo WhatsApp)
 * 3. Mengganti singkatan/slang ke kata baku protokol
 */
export function normalizeUserInput(text: string | null | undefined): string {
  if (!text) return '';
  let clean = text.trim();
  clean = normalizeRepeatedCharacters(clean);
  clean = normalizeChatSlang(clean);
  return clean;
}

/**
 * Menghitung skor relevansi pencocokan antara query pengguna dengan teks target
 * (Digunakan untuk pencarian fluid pada daftar perihal surat dan nama kegiatan)
 * Dilengkapi dengan Fuzzy Token Matching (Levenshtein Distance) agar kebal terhadap typo.
 */
export function scoreTextMatch(query: string, target: string | null | undefined): number {
  if (!query || !target) return 0;
  const q = normalizeUserInput(query).toLowerCase().trim();
  const t = target.toLowerCase().trim();

  if (!q || !t) return 0;
  if (t === q) return 100;

  // 1. Kecocokan singkatan atau kata mandiri (word-boundary) langsung
  const escapedQ = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const wordBoundaryRegex = new RegExp(`\\b${escapedQ}\\b`, 'i');
  if (q.length >= 2 && wordBoundaryRegex.test(target)) {
    return 85 + Math.min(15, q.length);
  }

  if (t.includes(q)) return 70 + Math.min(25, q.length);
  if (q.includes(t)) return 60 + Math.min(25, t.length);

  const stopWords = new Set([
    'yang', 'di', 'ke', 'dari', 'dan', 'atau', 'ini', 'itu', 'pada', 'untuk',
    'dengan', 'tentang', 'mengenai', 'terkait', 'soal', 'hal', 'perihal',
    'surat', 'jadwal', 'kegiatan', 'agenda', 'acara', 'tolong', 'mohon', 'bisa',
    'detail', 'rincian', 'lihat', 'cek', 'buka', 'tampilkan', 'dong', 'ya', 'min'
  ]);

  const queryTokens = q.split(/\s+/).filter((w) => w.length >= 2 && !stopWords.has(w));
  if (queryTokens.length === 0) return 0;

  // Siapkan token target untuk fuzzy comparison
  const targetTokens = t
    .split(/\s+/)
    .map((w) => w.replace(/[^\w]/g, ''))
    .filter((w) => w.length >= 2);

  let matched = 0;
  for (const token of queryTokens) {
    const escapedToken = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const tokenBoundary = new RegExp(`\\b${escapedToken}\\b`, 'i');
    if (tokenBoundary.test(target)) {
      matched += 1.5; // Bobot lebih tinggi untuk kecocokan kata/akronim mandiri
    } else if (t.includes(token)) {
      matched += 1;
    } else {
      // 2. Fuzzy Token Matching: Bandingkan token query terhadap setiap kata di target
      let foundFuzzy = false;
      for (const tgtToken of targetTokens) {
        if (isFuzzyMatch(token, tgtToken)) {
          matched += 1.2; // Nilai relevansi tinggi untuk kata yang sedikit typo
          foundFuzzy = true;
          break;
        }
      }
    }
  }

  if (matched === 0) return 0;
  const ratio = Math.min(1, matched / queryTokens.length);
  if (ratio === 1) return 55 + Math.min(25, matched * 6);
  if (ratio >= 0.5) return 30 + Math.min(20, matched * 5);
  return matched * 5;
}

/**
 * Membersihkan query input pengguna dari kata pengantar, perintah, dan partikel
 * untuk keperluan pencocokan fluid pada daftar perihal surat dan nama kegiatan
 */
export function cleanQueryForSelection(input: string): string {
  if (!input) return '';
  let clean = input.toLowerCase().trim();

  // 1. Bersihkan tanda baca di awal/akhir
  clean = clean.replace(/^[^\w]+|[^\w]+$/g, '');

  // 2. Bersihkan partikel akhir kalimat bahasa Indonesia
  clean = clean.replace(/\s+(dong|deh|ya|min|sih|ngga|nggak|gak|ga|kah|nih|gan|bro|pak|bu|\?|\.)+$/i, '');
  clean = clean.replace(/[?!.]+$/g, '').trim();

  // 3. Bersihkan awalan kata pengantar, perintah, dan kata hubung secara berulang
  const prefixRegex =
    /^(tolong|mohon|bisa|bisakah|coba|min|halo|hai|ada|apakah|berikan|beri|kasih|kasih tau|beritahu|beri tahu|minta|tampilkan|tampilkanlah|jelaskan|terangkan|detail|rincian|keterangan|penjelasan|informasi|info|carikan|cari|cek|lacak|lihat|liat|buka|temukan|surat masuk|surat dinas|surat|jadwal|agenda|kegiatan|acara|dokumen|arsip|berkas|tentang|perihal|mengenai|terkait|soal|dari|dengan topik|topik|hal|mau lihat|pengen lihat)\s+/i;

  let previous = '';
  while (clean !== previous && prefixRegex.test(clean)) {
    previous = clean;
    const candidate = clean.replace(prefixRegex, '').trim();
    if (candidate.length >= 2) {
      clean = candidate;
    } else {
      break;
    }
  }

  // 4. Bersihkan lagi kata hubung yang tersisa di awal
  clean = clean.replace(/^(tentang|mengenai|terkait|soal|hal|perihal|dari)\s+/i, '').trim();

  return clean;
}

import { ENV } from '../config/env';
import crypto from 'crypto';
import path from 'path';

/**
 * Mengambil URL publik berkas surat yang dapat langsung diklik oleh pengguna di WhatsApp.
 * Menggunakan base URL dari ENV.FILE_URL + nama berkas dari kolom `file` tabel `letters`.
 * Mengembalikan null jika berkas tidak ada atau kosong.
 */
export function getLetterFileUrl(fileName?: string | null): string | null {
  if (!fileName || fileName.trim() === '' || fileName.trim() === '-') {
    return null;
  }

  const cleanFile = fileName.trim();
  if (cleanFile.startsWith('http://') || cleanFile.startsWith('https://')) {
    return cleanFile;
  }

  const baseUrl = ENV.FILE_URL.endsWith('/') ? ENV.FILE_URL : `${ENV.FILE_URL}/`;
  return `${baseUrl}${cleanFile}`;
}

/**
 * Format nomor agenda untuk tampilan teks WhatsApp.
 * WhatsApp tidak mendukung sintaks Markdown hyperlink [text](url), sehingga link harus
 * ditampilkan sebagai URL langsung agar dapat diklik.
 */
export function formatNomorAgendaLink(nomorAgenda: string | null | undefined, fileName?: string | null): string {
  const agenda = (nomorAgenda || '-').trim();
  const fileUrl = getLetterFileUrl(fileName);
  if (!fileUrl) {
    return agenda;
  }

  return `${agenda} - ${fileUrl}`;
}

export const formatNomorSuratLink = formatNomorAgendaLink;

/**
 * Menghasilkan format nama berkas unik yang sesuai dengan standar kolom `file` di tabel `letters` database.
 * Format standar di database: {timestamp_10_digit}_{uniqid_13_hex}.{ext}
 * Contoh di database: 1784083526_6a56f446d15f5.pdf
 */
export function generateLetterFileName(originalOrExtName?: string | null): string {
  const ext = originalOrExtName ? (path.extname(originalOrExtName) || '.pdf') : '.pdf';
  const now = Date.now();
  const sec = Math.floor(now / 1000);
  const secHex = sec.toString(16).padStart(8, '0');
  const microHex = crypto.randomBytes(3).toString('hex').slice(0, 5);
  const uniqid = `${secHex}${microHex}`;
  const cleanExt = ext.toLowerCase();
  return `${sec}_${uniqid}${cleanExt}`;
}

/**
 * Menghasilkan format nama berkas unik yang sesuai dengan standar kolom `file` di tabel `dispositions` database.
 * Format standar sama dengan format letters: {timestamp_10_digit}_{uniqid_13_hex}.{ext}
 */
export function generateDispositionFileName(originalOrExtName?: string | null): string {
  return generateLetterFileName(originalOrExtName);
}

/**
 * Mendapatkan URL publik berkas lembar disposisi berdasarkan nama file di database.
 */
export function getDispositionFileUrl(fileName?: string | null): string | null {
  if (!fileName || fileName.trim() === '' || fileName.trim() === '-') {
    return null;
  }

  const cleanFile = fileName.trim();
  if (cleanFile.startsWith('http://') || cleanFile.startsWith('https://')) {
    return cleanFile;
  }

  const baseUrl = (ENV.DISPOSITION_FILE_URL || 'https://pwa-protokol.gatsu51.com/files/disposition/').endsWith('/')
    ? (ENV.DISPOSITION_FILE_URL || 'https://pwa-protokol.gatsu51.com/files/disposition/')
    : `${ENV.DISPOSITION_FILE_URL || 'https://pwa-protokol.gatsu51.com/files/disposition/'}/`;
  return `${baseUrl}${cleanFile}`;
}

/**
 * Memeriksa apakah teks input pengguna murni berupa sapaan/greeting santai atau pembuka percakapan
 * (contoh: "halo", "hai", "pagi", "selamat pagi", "assalamualaikum", "ping", "menu", dsb.)
 * tanpa memuat permintaan atau kata kunci pencarian fitur lainnya.
 */
export function isPureGreeting(text: string | null | undefined): boolean {
  if (!text) return false;
  const rawClean = text
    .toLowerCase()
    .replace(/^[^\w]+|[^\w]+$/g, '')
    .trim();
  if (!rawClean) return false;

  const normalized = normalizeUserInput(rawClean).toLowerCase().trim();

  const greetingTokens = new Set([
    'halo', 'halo min', 'halo bot', 'halo admin', 'halo pak', 'halo bu', 'halo kak',
    'hai', 'hai min', 'hai bot', 'hai admin', 'hai kak',
    'hay', 'hay min', 'hay bot', 'hay admin',
    'hi', 'hi min', 'hi bot', 'helo', 'hello', 'hey', 'heyy',
    'pagi', 'selamat pagi', 'pagi min', 'selamat pagi min', 'selamat pagi pak', 'selamat pagi bu',
    'siang', 'selamat siang', 'siang min', 'selamat siang min', 'selamat siang pak', 'selamat siang bu',
    'sore', 'selamat sore', 'sore min', 'selamat sore min', 'selamat sore pak', 'selamat sore bu',
    'malam', 'selamat malam', 'malam min', 'selamat malam min', 'selamat malam pak', 'selamat malam bu',
    'assalamualaikum', "assalamu'alaikum", 'assalamu alaikum', 'assalamualaikum wr wb', "assalamu'alaikum wr wb",
    'salam', 'sampurasun', 'kulonuwun',
    'ping', 'p', 'tes', 'test',
    'menu', 'start', '/start', 'buka menu', 'tampilkan menu'
  ]);

  if (greetingTokens.has(rawClean) || greetingTokens.has(normalized)) return true;

  const greetingPattern = /^(?:halo|hai|hay|hi|helo|hello|hey|p|ping|tes|test|assalamu\s*['’]?alaikum(?:\s*wr\s*wb)?|selamat\s+(?:pagi|siang|sore|malam)|salam)(?:\s+(?:min|admin|bot|kak|pak|bu|bapak|ibu|protokol|asisten))?[.!?~]*$/i;

  return greetingPattern.test(rawClean) || greetingPattern.test(normalized);
}

/**
 * Memeriksa apakah teks input pengguna merupakan kata konfirmasi affirmative/koreksi langkah formulir
 * (contoh: "ya", "iya", "benar", "simpan", "oke", "1", "salah", "tidak", "koreksi", "2", dsb.)
 */
export function isFormConfirmationInput(text: string | null | undefined): boolean {
  if (!text) return false;
  const rawClean = text.toLowerCase().trim();
  const normalized = normalizeUserInput(rawClean).toLowerCase().trim();

  const confirmationWords = new Set([
    '1', '2', '3', '4', '5', '6', '7',
    'ya', 'iya', 'y', 'yes', 'benar', 'betul', 'simpan', 'oke', 'ok',
    'sesuai', 'sudah benar', 'lanjut', 'pas', 'siap', 'sudah sesuai',
    'salah', 'tidak', 'bukan', 't', 'koreksi', 'ubah', 'edit', 'ganti', 'ada yang salah',
    'manual', 'batal', 'cancel', 'gajadi'
  ]);

  return confirmationWords.has(rawClean) || confirmationWords.has(normalized);
}

/**
 * Memisahkan string gabungan PIC menjadi Nama PIC dan Nomor Telepon PIC
 * Contoh:
 * - "Budi Santoso (081234567890)" -> { name: "Budi Santoso", phone: "081234567890" }
 * - "Ahmad Fauzi - 0812-3456-7890" -> { name: "Ahmad Fauzi", phone: "0812-3456-7890" }
 * - "081234567890" -> { name: "-", phone: "081234567890" }
 * - "Budi Santoso" -> { name: "Budi Santoso", phone: "-" }
 */
export function splitPicNameAndPhone(raw: string | null | undefined): { name: string; phone: string } {
  if (!raw || !raw.trim() || raw.trim() === '-') {
    return { name: '-', phone: '-' };
  }

  let clean = raw.trim();

  // Bersihkan awalan seperti "PIC:", "Narahubung:", "Contact Person:", "Kontak:"
  clean = clean.replace(/^(?:pic|narahubung|contact\s+person|cp|kontak|telp|hp)\s*[:.-]?\s*/i, '').trim();

  // Regex untuk mendeteksi nomor telepon (Indonesia: 08xx, +62xx, 62xx, (021)xx, dll.)
  // Minimal 8 digit angka
  const phoneRegex = /(?:\+?62|08|02[1-9]|03[1-9]|04[1-9]|05[1-9]|06[1-9]|07[1-9]|09[1-9])[0-9\-\s/.()]{7,25}/;

  const phoneMatch = clean.match(phoneRegex);

  let phone = '-';
  let name = '-';

  if (phoneMatch) {
    const rawPhone = phoneMatch[0].trim();
    // Bersihkan karakter selain angka, tanda plus (+), dan strip (-)
    phone = rawPhone.replace(/[^\d+]/g, '').trim();

    // Hapus bagian phone dari teks untuk menyisakan nama
    let remainingName = clean.replace(rawPhone, '').trim();
    // Bersihkan tanda kurung yang tersisa, strip, slash, atau kata 'WA', 'HP', 'Telp'
    remainingName = remainingName
      .replace(/[\(\)\[\]\{\}]/g, ' ')
      .replace(/^(?:wa|whatsapp|hp|telp|telepon|phone)\s*[:.-]?\s*/i, '')
      .replace(/[\s\-_/]+$/, '')
      .replace(/^[\s\-_/]+/, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (remainingName && remainingName !== '-' && remainingName.length >= 2) {
      name = remainingName;
    }
  } else {
    // Tidak ditemukan nomor telepon, seluruh string dianggap nama
    name = clean;
  }

  // Jika nama hanya berisi angka atau simbol, kosongkan jadi '-'
  if (name !== '-' && (/^[\d\s+\-_/().]+$/.test(name) || name.length < 2)) {
    name = '-';
  }

  // Jika phone hanya simbol atau terlalu pendek (< 7 digit angka), kosongkan jadi '-'
  if (phone !== '-' && phone.replace(/\D/g, '').length < 7) {
    phone = '-';
  }

  return {
    name: name.slice(0, 100),
    phone: phone.slice(0, 50),
  };
}

/**
 * Menggabungkan nama PIC dan nomor telepon menjadi format standar PIC
 * yang tersimpan pada tabel letters (format: "Nama PIC (Nomor PIC)" atau "Nama PIC")
 *
 * Contoh:
 * - formatCombinedPic("Budi Santoso", "081234567890") -> "Budi Santoso (081234567890)"
 * - formatCombinedPic("Ahmad Fauzi (081234567890)", "081234567890") -> "Ahmad Fauzi (081234567890)"
 * - formatCombinedPic("Budi Santoso", "-") -> "Budi Santoso"
 * - formatCombinedPic("-", "081234567890") -> "081234567890"
 * - formatCombinedPic("-", "-") -> "-"
 */
export function formatCombinedPic(name: string | null | undefined, phone: string | null | undefined): string {
  const cleanName = (name || '').trim();
  const cleanPhone = (phone || '').trim();
  const hasName = cleanName && cleanName !== '-' && cleanName.length >= 2;
  const hasPhone = cleanPhone && cleanPhone !== '-' && cleanPhone.replace(/\D/g, '').length >= 7;

  if (hasName && hasPhone) {
    // Jika nama sudah memuat nomor telepon, tidak perlu digabungkan lagi
    if (cleanName.includes(cleanPhone)) {
      return cleanName.slice(0, 100);
    }
    return `${cleanName} (${cleanPhone})`.slice(0, 100);
  }
  if (hasName) {
    return cleanName.slice(0, 100);
  }
  if (hasPhone) {
    return cleanPhone.slice(0, 50);
  }
  return '-';
}

/**
 * Membersihkan template awalan permohonan/undangan surat masuk
 * menjadi kalimat aktif judul kegiatan protokol (sebagaimana pola judul di database).
 *
 * Contoh:
 * - "Permohonan Memberikan Sambutan dan Arahan pada kegiatan..." -> "Memberikan Sambutan dan Arahan pada kegiatan..."
 * - "Permohonan Menjadi Narasumber dalam talkshow..." -> "Menjadi Narasumber dalam talkshow..."
 * - "Permohonan Memberikan Video Ucapan..." -> "Memberikan Video Ucapan..."
 * - "Undangan Menghadiri Resepsi Pernikahan..." -> "Menghadiri Resepsi Pernikahan..."
 * - "Permohonan Audiensi dari..." -> "Audiensi dari..."
 */
export function cleanTemplatePrefix(title: string | null | undefined): string {
  if (!title) return '';
  let text = cleanHtml(title).trim();
  if (!text) return '';

  // 1. Hapus suffix arahan atau catatan lama di akhir jika sudah pernah ditambahkan sebelumnya
  text = text
    .replace(/\s*\(?\s*(?:(?:arahan|disposisi)\s+menaker\s*:[^\)]*|belum\s+ada\s+disposisi)\)?\s*$/i, '')
    .trim();

  // 2. Daftar pola spesifik yang umum di perihal surat masuk
  const specificReplacements: [RegExp, string][] = [
    [/^permohonan\s+memberikan\s+sambutan\s+dan\s+arahan\b/i, 'Memberikan Sambutan dan Arahan'],
    [/^permohonan\s+memberikan\s+sambutan\b/i, 'Memberikan Sambutan'],
    [/^permohonan\s+memberikan\s+kata\s+sambutan\b/i, 'Memberikan Kata Sambutan'],
    [/^permohonan\s+memberikan\s+video\s+ucapan\b/i, 'Pembuatan Video Ucapan'],
    [/^permohonan\s+video\s+ucapan\b/i, 'Pembuatan Video Ucapan'],
    [/^permohonan\s+memberikan\s+keynote\s+speech\b/i, 'Menjadi Keynote Speaker'],
    [/^permohonan\s+keynote\s+speech\b/i, 'Menjadi Keynote Speaker'],
    [/^permohonan\s+memberikan\s+kuliah\s+umum\b/i, 'Memberikan Kuliah Umum'],
    [/^permohonan\s+memberikan\s+orasi\s+ilmiah\b/i, 'Menjadi Narasumber Orasi Ilmiah'],
    [/^permohonan\s+memberikan\s+materi\b/i, 'Memberikan Materi'],
    [/^permohonan\s+memberikan\s+paparan\b/i, 'Memberikan Paparan'],
    [/^permohonan\s+memberikan\s+arahan\b/i, 'Memberikan Arahan'],
    [/^permohonan\s+memberikan\b/i, 'Memberikan'],
    [/^permohonan\s+menjadi\s+narasumber\b/i, 'Menjadi Narasumber'],
    [/^permohonan\s+menjadi\s+keynote\s+speaker\b/i, 'Menjadi Keynote Speaker'],
    [/^permohonan\s+menjadi\s+pembicara\b/i, 'Menjadi Pembicara'],
    [/^permohonan\s+menjadi\s+pemateri\b/i, 'Menjadi Pemateri'],
    [/^permohonan\s+menjadi\s+saksi\b/i, 'Menjadi Saksi'],
    [/^permohonan\s+menjadi\s+juri\b/i, 'Menjadi Juri'],
    [/^permohonan\s+menjadi\s+pembina\b/i, 'Menjadi Pembina'],
    [/^permohonan\s+menjadi\b/i, 'Menjadi'],
    [/^permohonan\s+membuka\s+(?:secara\s+resmi\s+)?acara\b/i, 'Membuka Acara'],
    [/^permohonan\s+membuka\s+kegiatan\b/i, 'Membuka Kegiatan'],
    [/^permohonan\s+membuka\b/i, 'Membuka'],
    [/^undangan\s+menghadiri\s+(?:resepsi\s+)?pernikahan\b/i, 'Menghadiri acara Resepsi Pernikahan'],
    [/^permohonan\s+menghadiri\s+(?:resepsi\s+)?pernikahan\b/i, 'Menghadiri acara Resepsi Pernikahan'],
    [/^permohonan\s+menghadiri\b/i, 'Menghadiri'],
    [/^undangan\s+menghadiri\b/i, 'Menghadiri'],
    [/^permohonan\s+kehadiran\s+pada\b/i, 'Menghadiri'],
    [/^permohonan\s+kehadiran\s+dan\s+sambutan\b/i, 'Menghadiri dan Memberikan Sambutan'],
    [/^permohonan\s+kehadiran\b/i, 'Kehadiran'],
    [/^undangan\s+kehadiran\s+pada\b/i, 'Menghadiri'],
    [/^undangan\s+kehadiran\b/i, 'Kehadiran'],
    [/^permohonan\s+audiensi\s+dari\s+/i, 'Menerima audiensi '],
    [/^permohonan\s+audiensi\s+bersama\s+/i, 'Audiensi bersama '],
    [/^permohonan\s+audiensi\b/i, 'Menerima audiensi'],
    [/^permohonan\s+wawancara\s+dari\s+/i, 'Menerima Wawancara '],
    [/^permohonan\s+wawancara\s+bersama\s+/i, 'Wawancara bersama '],
    [/^permohonan\s+wawancara\b/i, 'Menerima Wawancara'],
    [/^permohonan\s+kunjungan\b/i, 'Kunjungan'],
    [/^permohonan\s+fasilitasi\b/i, 'Fasilitasi'],
  ];

  for (const [regex, replacement] of specificReplacements) {
    if (regex.test(text)) {
      text = text.replace(regex, replacement);
      return text.trim();
    }
  }

  // 3. Fallback pembersihan umum untuk kata 'Permohonan' atau 'Undangan' di awal kalimat
  if (/^permohonan\s+/i.test(text)) {
    text = text.replace(/^permohonan\s+/i, '');
    text = text.charAt(0).toUpperCase() + text.slice(1);
  } else if (/^undangan\s+/i.test(text)) {
    text = text.replace(/^undangan\s+/i, '');
    text = text.charAt(0).toUpperCase() + text.slice(1);
  }

  return text.trim();
}

/**
 * Menentukan nama pejabat yang ditunjuk dari kolom "Diteruskan Kepada" lembar disposisi.
 * Mendukung string tunggal, koma, atau array string.
 */
export function resolvePejabatDitunjuk(diteruskanKepada: string | string[] | undefined | null): string {
  if (!diteruskanKepada) return 'Pejabat Terkait';

  let list: string[] = [];
  if (Array.isArray(diteruskanKepada)) {
    list = diteruskanKepada;
  } else if (typeof diteruskanKepada === 'string') {
    list = diteruskanKepada.split(/[,;\n\r]+/).map((s) => s.trim()).filter(Boolean);
  }

  const cleanedList = list
    .map((item) => item.replace(/^\s*(?:\d+[\.\)]|[-•*])\s*/, '').trim())
    .filter((item) => item && item !== '-');

  if (cleanedList.length === 0) return 'Pejabat Terkait';
  if (cleanedList.length === 1) return cleanedList[0];
  if (cleanedList.length === 2) return `${cleanedList[0]} & ${cleanedList[1]}`;

  return cleanedList.join(', ');
}

/**
 * Memformat judul event di database sesuai arahan disposisi pimpinan (Agendakan vs Mewakili Menteri)
 * dengan template bold di akhir kalimat:
 * - Agendakan: <p>Judul Acara<br />\r\n<strong>(Arahan Menaker: Agendakan)</strong></p>
 * - Mewakili Menteri: <p>Judul Acara<br />\r\n<strong>(Arahan Menaker: PEJABAT_DITUNJUK)</strong></p>
 */
export function formatEventTitleFromDisposition(
  originalTitle: string | null | undefined,
  arahanType: 'agendakan' | 'diwakilkan',
  pejabatDitunjuk?: string | string[] | null
): string {
  const cleanedTitle = cleanTemplatePrefix(originalTitle) || 'Agenda Kegiatan Protokol';
  const resolvedOfficial = resolvePejabatDitunjuk(pejabatDitunjuk);

  const suffix = arahanType === 'agendakan' ? 'Agendakan' : resolvedOfficial;

  return `<p>${cleanedTitle}<br />\r\n<strong>(Arahan Menaker: ${suffix})</strong></p>`;
}

/**
 * Memformat judul event awal pada saat surat masuk baru diinput (sebelum ada lembar disposisi)
 * dengan template teks bold:
 * <p>Judul Acara<br />\r\n<strong>(Belum ada disposisi)</strong></p>
 */
export function formatInitialEventTitle(baseTitle: string | null | undefined): string {
  const cleanedTitle = cleanTemplatePrefix(baseTitle) || 'Agenda Kegiatan Protokol';
  return `<p>${cleanedTitle}<br />\r\n<strong>(Belum ada disposisi)</strong></p>`;
}

/**
 * Memvalidasi dan membersihkan nilai tempat/lokasi acara (placeEvent).
 * Mencegah teks perihal, permohonan, atau judul acara yang tidak sengaja terinput ke kolom lokasi.
 * Mengembalikan null jika kandidat tidak valid atau bukan lokasi fisik/daring yang sebenarnya.
 */
export function sanitizePlaceEvent(
  candidate?: string | null,
  perihal?: string | null,
  subject?: string | null,
  namaAcara?: string | null
): string | null {
  if (!candidate || typeof candidate !== 'string') return null;

  const trimmed = candidate.trim().replace(/^[\*•\-\s]+|[\*•\-\s]+$/g, '');
  if (
    !trimmed ||
    trimmed === '-' ||
    /^(?:tidak\s+ada|belum\s+ada|null|undefined|kosong|nihil|-|di\s+tempat|tempat|lokasi|tempat\s+masing-masing|tempat\s+kerja\s+masing-masing|kedudukan\s+masing-masing)$/i.test(trimmed)
  ) {
    return null;
  }

  // Jika teks terlalu panjang seperti paragraf perihal/isi surat
  if (trimmed.length > 180) {
    return null;
  }

  const lowerCandidate = trimmed.toLowerCase();

  // Kata kunci tempat/lokasi nyata
  const hasVenueKeyword = /\b(?:hotel|gedung|ruang(?:an)?|ballroom|auditorium|aula|graha|hall|istana|kantor|lantai|lt\.?|zoom|daring|online|virtual|plaza|menara|kompleks|kav(?:ling)?|jl\.?|jalan|kemnaker|kementerian|resort|villa|stadion|lapangan|mesjid|masjid|gereja)\b/i.test(lowerCandidate);

  // Periksa apakah kandidat sama persis atau merupakan bagian dari perihal / subject / namaAcara
  const compareTargets = [perihal, subject, namaAcara]
    .filter((t): t is string => Boolean(t && t.trim() && t.trim() !== '-'))
    .map((t) => t.trim().toLowerCase());

  for (const target of compareTargets) {
    if (lowerCandidate === target) {
      return null; // Duplikasi 100% perihal / subject
    }
    // Jika kandidat merupakan kalimat panjang yang terkandung dalam perihal tanpa kata kunci venue
    if (!hasVenueKeyword && target.includes(lowerCandidate) && lowerCandidate.length > 15) {
      return null;
    }
  }

  // Jika kandidat diawali kata-kata perihal / judul surat dan tidak mengandung kata kunci tempat
  if (!hasVenueKeyword) {
    if (
      /^(?:undangan|permohonan|pemberitahuan|penyampaian|laporan|pengantar|konfirmasi|audiensi|wawancara|rapat\s+koordinasi|agenda)\b/i.test(lowerCandidate)
    ) {
      return null;
    }
  }

  // Jika memuat awalan kalimat seperti "bertempat di" atau "Undangan rapat di <venue>", bersihkan agar murni nama lokasi
  let cleanResult = trimmed.replace(/^(?:bertempat\s+(?:di|pada)|tempat\s*:|lokasi\s*:|venue\s*:)\s*/i, '');
  const prefixMatch = cleanResult.match(/^(?:undangan|acara|kegiatan|rapat|pertemuan|sosialisasi)\b.*?\s+(?:di|bertempat di)\s+(.+)$/i);
  if (prefixMatch && prefixMatch[1]) {
    cleanResult = prefixMatch[1].trim();
  }

  return cleanResult;
}

/**
 * Memformat status disposisi/kegiatan protokol dengan badge ikon visual yang rapi dan mudah dipahami
 */
export function formatStatusBadge(status?: string | null, statusCode?: number | null): string {
  const code = statusCode !== null && statusCode !== undefined ? Number(statusCode) : null;
  const s = (status || '').toLowerCase();

  if (code === 5 || s.includes('selesai') || s.includes('terlaksana')) {
    return '🟢 Selesai / Terlaksana';
  }
  if (code === 2 || s.includes('reschedule') || s.includes('dijadwalkan ulang')) {
    return '🔄 Dijadwalkan Ulang';
  }
  if (code === 3 || s.includes('diwakilkan')) {
    return '👤 Diwakilkan';
  }
  if (code === 4 || s.includes('batal') || s.includes('cancel')) {
    return '❌ Dibatalkan';
  }
  if (code === 6 || s.includes('tolak')) {
    return '❌ Ditolak';
  }
  if (s.includes('tentatif')) {
    return '🟡 Diagendakan (Tentatif)';
  }
  if (code === 1 || s.includes('diagendakan') || s.includes('terjadwal') || s.includes('onschedule')) {
    return '🟡 Diagendakan';
  }
  return status || '🟡 Diagendakan';
}

export interface ExtractedEventTitle {
  cleanTitle: string;
  pendamping?: string;
  peserta?: string;
  arahan?: string;
  catatan?: string;
}

/**
 * Memisahkan dan merapikan komponen di dalam title event yang sering kali memuat
 * daftar pendamping, peserta rapat, arahan pimpinan, dan catatan teknis di database.
 */
export function extractEventTitleDetails(rawTitle: string | null | undefined): ExtractedEventTitle {
  if (!rawTitle) {
    return { cleanTitle: 'Agenda Kegiatan Protokol' };
  }

  // 1. Bersihkan HTML tags namun pertahankan jeda baris/paragraf
  const textWithBreaks = rawTitle
    .replace(/<br\s*[\/]?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&#13;/gi, '')
    .replace(/\r/g, '');

  const rawLines = textWithBreaks.split('\n').map((l) => l.trim()).filter(Boolean);

  if (rawLines.length === 0) {
    return { cleanTitle: 'Agenda Kegiatan Protokol' };
  }

  const titleParts: string[] = [];
  const arahanParts: string[] = [];
  const pendampingList: string[] = [];
  const pesertaList: string[] = [];
  const catatanList: string[] = [];

  type ParseSection = 'TITLE' | 'ARAHAN' | 'PENDAMPING' | 'PESERTA' | 'CATATAN';
  let currentSection: ParseSection = 'TITLE';

  const cleanItem = (item: string) => {
    return item.replace(/^[-•*–—]\s*/, '').replace(/^\d+[\.)]\s*/, '').replace(/;$/, '').trim();
  };

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];

    // Deteksi Header Pendamping
    const pendampingHeaderMatch = line.match(/^(?:pejabat\s+|staf\s+)?(?:pendamping|didampingi(?:\s+oleh)?)\s*:?\s*(.*)$/i);
    if (pendampingHeaderMatch) {
      currentSection = 'PENDAMPING';
      const remainder = cleanItem(pendampingHeaderMatch[1]);
      if (remainder) {
        const subItems = remainder.split(/[;,]/).map(cleanItem).filter(Boolean);
        pendampingList.push(...subItems);
      }
      continue;
    }

    // Deteksi Header Peserta Rapat / Dihadiri
    const pesertaHeaderMatch = line.match(/^(?:daftar\s+)?(?:peserta(?:\s+rapat)?|dihadiri(?:\s+oleh)?)\s*:?\s*(.*)$/i);
    if (pesertaHeaderMatch) {
      currentSection = 'PESERTA';
      const remainder = cleanItem(pesertaHeaderMatch[1]);
      if (remainder) {
        const subItems = remainder.split(/[;,]/).map(cleanItem).filter(Boolean);
        pesertaList.push(...subItems);
      }
      continue;
    }

    // Deteksi Header Catatan
    const catatanHeaderMatch = line.match(/^(?:catatan(?:\s+khusus)?|note)\s*:?\s*(.*)$/i);
    if (catatanHeaderMatch) {
      currentSection = 'CATATAN';
      const remainder = cleanItem(catatanHeaderMatch[1]);
      if (remainder) {
        catatanList.push(remainder);
      }
      continue;
    }

    // Deteksi Arahan Menaker / Disposisi Menaker di awal/tengah baris
    const arahanMatch = line.match(/^[\(\[]?\s*(?:arahan|disposisi|dispo)\s+(?:menaker|pimpinan|menteri)\s*:?\s*([^\]\)]*)[\)\]]?(.*)$/i);
    if (arahanMatch) {
      const coreArahan = arahanMatch[1].trim();
      const extraNote = cleanItem(arahanMatch[2].trim());
      const fullArahan = extraNote ? `${coreArahan}. ${extraNote}` : coreArahan;
      if (fullArahan) {
        arahanParts.push(fullArahan);
      }
      continue;
    }

    // Deteksi baris "Info dari ..." atau info agenda terpisah
    if (/^info\s+dari\s+/i.test(line) || /^\(agenda\s+kunker\s+dibuat\s+terpisah\)/i.test(line)) {
      catatanList.push(cleanItem(line));
      continue;
    }

    // Pemrosesan berdasarkan section aktif
    if (currentSection === 'PENDAMPING') {
      const item = cleanItem(line);
      if (item) pendampingList.push(item);
    } else if (currentSection === 'PESERTA') {
      const item = cleanItem(line);
      if (item) pesertaList.push(item);
    } else if (currentSection === 'CATATAN') {
      const item = cleanItem(line);
      if (item) catatanList.push(item);
    } else {
      // Masih di TITLE
      const inlineArahanMatch = line.match(/^(.*?)\s*[\(\[]\s*(?:arahan|disposisi|dispo)\s+(?:menaker|pimpinan|menteri)\s*:?\s*([^\]\)]*)[\)\]](.*)$/i);
      if (inlineArahanMatch) {
        const titlePart = inlineArahanMatch[1].trim();
        const coreArahan = inlineArahanMatch[2].trim();
        const extraNote = cleanItem(inlineArahanMatch[3].trim());
        const fullArahan = extraNote ? `${coreArahan}. ${extraNote}` : coreArahan;
        if (titlePart) titleParts.push(titlePart);
        if (fullArahan) arahanParts.push(fullArahan);
      } else {
        titleParts.push(line);
      }
    }
  }

  let cleanTitle = titleParts.join(' ').replace(/\s+/g, ' ').trim();
  cleanTitle = cleanTitle.replace(/[\(\[]\s*[\)\]]$/, '').trim();
  if (!cleanTitle) {
    cleanTitle = 'Agenda Kegiatan Protokol';
  }

  const pendamping = pendampingList.length > 0 ? pendampingList.join('; ') : undefined;
  const peserta = pesertaList.length > 0 ? pesertaList.join('; ') : undefined;
  const arahan = arahanParts.length > 0 ? arahanParts.join('; ') : undefined;
  const catatan = catatanList.length > 0 ? catatanList.join('; ') : undefined;

  return {
    cleanTitle,
    pendamping,
    peserta,
    arahan,
    catatan,
  };
}

/**
 * Format string daftar (dipisahkan '; ') menjadi versi ringkas satu baris untuk kartu list jadwal
 */
export function formatListSummary(itemsStr?: string, maxItems: number = 2): string | undefined {
  if (!itemsStr) return undefined;
  const items = itemsStr.split(';').map((s) => s.trim()).filter(Boolean);
  if (items.length === 0) return undefined;
  if (items.length <= maxItems) return items.join('; ');
  const shown = items.slice(0, maxItems).join('; ');
  const remaining = items.length - maxItems;
  return `${shown} (+${remaining} lainnya)`;
}

/**
 * Format string daftar (dipisahkan '; ') menjadi multiline bullet points untuk detail jadwal
 */
export function formatDetailBullets(itemsStr?: string): string | undefined {
  if (!itemsStr) return undefined;
  const items = itemsStr.split(';').map((s) => s.trim()).filter(Boolean);
  if (items.length === 0) return undefined;
  return items.map((it) => `  • ${it}`).join('\n');
}

export interface SuratCardData {
  id?: number | bigint;
  nomorAgenda?: string | null;
  nomorSurat?: string | null;
  perihal?: string | null;
  subject?: string | null;
  asalSurat?: string | null;
  asalInstansi?: string | null;
  jenisSurat?: string | null;
  tipeSurat?: string | null;
  tanggalSurat?: string | null;
  event?: string | null;
  dateEvent?: string | null;
  timeEvent?: string | null;
  placeEvent?: string | null;
  picPengirim?: string | null;
  fileName?: string | null;
  userInput?: { nama?: string | null; jabatan?: string | null } | null;
  disposisi?: {
    status?: string | null;
    tanggalDisposisi?: Date | string | null;
    tujuanDisposisi?: string | null;
    instruksi?: string | null;
    catatan?: string | null;
  } | null;
}

/**
 * Mengonversi kode kategori surat (seperti AU, UND, PH) ke representasi teks lengkap yang mudah dipahami
 */
export function formatFriendlyCategory(categoryCode?: string | null, typeName?: string | null): string {
  if (!categoryCode || categoryCode === '-') return typeName || 'Umum';
  const code = categoryCode.toUpperCase().trim();
  const map: Record<string, string> = {
    UND: 'Undangan',
    UNR: 'Undangan Resmi',
    PH: 'Permohonan',
    AU: 'Audiensi',
    WR: 'Warta / Pemberitahuan',
    LP: 'Laporan',
    TAP: 'Tanggapan / Jawaban',
  };
  const label = map[code] || code;
  const suffix = code !== label ? ` (${code})` : '';
  const typeStr = typeName && typeName !== '-' ? ` · ${typeName}` : '';
  return `${label}${suffix}${typeStr}`;
}

/**
 * Format satu kartu ringkasan surat masuk untuk tampilan daftar hasil pencarian di WhatsApp
 */
export function formatSuratListItem(s: SuratCardData, index: number): string {
  const isSudah = s.disposisi?.status === 'SUDAH_DISPOSISI';
  let statusBadge = isSudah ? '🟢 Sudah Disposisi' : '🟡 Belum Disposisi';
  if (isSudah && s.disposisi?.tujuanDisposisi && s.disposisi.tujuanDisposisi !== '-') {
    statusBadge += ` (Kepada: ${s.disposisi.tujuanDisposisi})`;
  }

  const cleanPerihalText = cleanHtml(s.perihal) || cleanHtml(s.subject) || 'Surat Masuk';

  const lines = [
    `*${index}.* 📑 *${cleanPerihalText}*`,
    `   📄 *No. Agenda* : ${s.nomorAgenda || '-'}`,
  ];

  if (s.nomorSurat && s.nomorSurat !== '-' && s.nomorSurat !== s.nomorAgenda) {
    lines.push(`   ✉️ *No. Surat*  : ${s.nomorSurat}`);
  }

  const instansiStr =
    s.asalInstansi && s.asalInstansi !== '-' && s.asalInstansi !== s.asalSurat
      ? ` · ${s.asalInstansi}`
      : '';
  lines.push(`   🏢 *Pengirim*   : ${s.asalSurat || '-'}${instansiStr}`);

  const kategoriStr = formatFriendlyCategory(s.jenisSurat, s.tipeSurat);
  if (kategoriStr) {
    lines.push(`   🏷️ *Kategori*   : ${kategoriStr}`);
  }

  if (s.tanggalSurat && s.tanggalSurat !== '-') {
    lines.push(`   📅 *Tgl. Surat* : ${s.tanggalSurat}`);
  }

  // Jika memuat info agenda / acara kegiatan
  if (s.dateEvent || s.placeEvent || (s.event && s.event !== '-')) {
    const parts = [];
    if (s.dateEvent) parts.push(s.dateEvent);
    if (s.timeEvent) parts.push(s.timeEvent);
    if (s.placeEvent) parts.push(s.placeEvent);
    else if (s.event && s.event !== '-') parts.push(s.event);
    if (parts.length > 0) {
      lines.push(`   📍 *Agenda*     : ${parts.join(' · ')}`);
    }
  }

  lines.push(`   📋 *Status*     : ${statusBadge}`);

  const fileUrl = getLetterFileUrl(s.fileName);
  if (fileUrl) {
    lines.push(`   📎 *Dokumen*    : ${fileUrl}`);
  }

  return lines.join('\n');
}

/**
 * Format tampilan rincian lengkap surat masuk beserta lembar disposisi dan agenda terkait
 */
export function formatSuratDetail(surat: SuratCardData, waktuInputStr: string): string {
  const disposisi = surat.disposisi;
  const isSudah = disposisi?.status === 'SUDAH_DISPOSISI';
  const fileUrl = getLetterFileUrl(surat.fileName);

  const cleanPerihalText = cleanHtml(surat.perihal) || cleanHtml(surat.subject) || 'Surat Masuk';
  const noSuratLine =
    surat.nomorSurat && surat.nomorSurat !== '-' ? `• *Nomor Surat*      : ${surat.nomorSurat}\n` : '';
  const instansiLine =
    surat.asalInstansi && surat.asalInstansi !== '-' ? `• *Asal Instansi*    : ${surat.asalInstansi}\n` : '';
  const fileLine = fileUrl ? `• *Link Berkas PDF*  : ${fileUrl}\n` : '';
  const kategori = formatFriendlyCategory(surat.jenisSurat, surat.tipeSurat);

  let agendaSection = '';
  const hasEventInfo =
    (surat.event && surat.event !== '-') || surat.dateEvent || surat.placeEvent || surat.picPengirim;
  if (hasEventInfo) {
    const agendaLines = ['\n📅 *AGENDA / KEGIATAN TERKAIT:*'];
    if (surat.event && surat.event !== '-') agendaLines.push(`• *Nama Acara*       : ${surat.event}`);
    if (surat.dateEvent)
      agendaLines.push(
        `• *Waktu Acara*      : ${surat.dateEvent}${surat.timeEvent ? ` pukul ${surat.timeEvent}` : ''}`
      );
    if (surat.placeEvent) agendaLines.push(`• *Tempat / Lokasi*  : ${surat.placeEvent}`);
    if (surat.picPengirim && surat.picPengirim !== '-')
      agendaLines.push(`• *PIC Pengirim*     : ${surat.picPengirim}`);
    agendaSection = agendaLines.join('\n') + '\n';
  }

  let disposisiSection = '';
  if (isSudah && disposisi) {
    const tgl = disposisi.tanggalDisposisi
      ? new Date(disposisi.tanggalDisposisi).toLocaleDateString('id-ID', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        })
      : '-';
    disposisiSection =
      `\n📬 *LEMBAR DISPOSISI PIMPINAN:*\n` +
      `🟢 *Status: Sudah Didisposisikan*\n` +
      `• *Tanggal Disposisi*: ${tgl}\n` +
      `• *Diteruskan Kepada*: ${disposisi.tujuanDisposisi || '-'}\n` +
      `• *Instruksi Pimpinan*: ${cleanHtml(disposisi.instruksi) || '-'}\n` +
      `• *Catatan Tambahan* : ${cleanHtml(disposisi.catatan) || '-'}\n`;
  } else {
    disposisiSection =
      `\n📬 *LEMBAR DISPOSISI PIMPINAN:*\n` +
      `🟡 *Status: Belum Didisposisikan*\n` +
      `_Surat masuk ini belum menerima lembar disposisi / instruksi dari Pimpinan._\n`;
  }

  return (
    `📋 *RINCIAN LENGKAP SURAT MASUK*\n\n` +
    `• *Perihal*          : *${cleanPerihalText}*\n` +
    `• *Nomor Agenda*     : ${surat.nomorAgenda || '-'}\n` +
    noSuratLine +
    `• *Pengirim*         : ${surat.asalSurat || '-'}\n` +
    instansiLine +
    `• *Kategori Surat*   : ${kategori}\n` +
    `• *Tanggal Surat*    : ${surat.tanggalSurat || '-'}\n` +
    fileLine +
    `• *Waktu Registrasi* : ${waktuInputStr} (Oleh: ${surat.userInput?.nama || 'Petugas Protokol'})\n` +
    agendaSection +
    disposisiSection +
    `\n─────────────────────────\n` +
    `💡 *Petunjuk:*\n` +
    `Ketik *0* atau *kembali* untuk kembali ke daftar hasil pencarian, atau langsung ketik kata kunci topik lainnya. 😊`
  );
}

