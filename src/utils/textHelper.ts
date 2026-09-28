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
 * Menghitung skor relevansi pencocokan antara query pengguna dengan teks target
 * (Digunakan untuk pencarian fluid pada daftar perihal surat dan nama kegiatan)
 */
export function scoreTextMatch(query: string, target: string | null | undefined): number {
  if (!query || !target) return 0;
  const q = query.toLowerCase().trim();
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

  let matched = 0;
  for (const token of queryTokens) {
    const escapedToken = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const tokenBoundary = new RegExp(`\\b${escapedToken}\\b`, 'i');
    if (tokenBoundary.test(target)) {
      matched += 1.5; // Bobot lebih tinggi untuk kecocokan kata/akronim mandiri
    } else if (t.includes(token)) {
      matched += 1;
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
 * Format nomor agenda sebagai hyperlink markdown yang mengarah langsung ke berkas PDF
 * Menggunakan base URL dari ENV.FILE_URL + nama berkas dari kolom `file` tabel `letters`.
 * Jika berkas tidak ada / kosong, mengembalikan nomor agenda biasa.
 */
export function formatNomorAgendaLink(nomorAgenda: string | null | undefined, fileName?: string | null): string {
  const agenda = (nomorAgenda || '-').trim();
  if (!fileName || fileName.trim() === '' || fileName === '-') {
    return agenda;
  }

  const cleanFile = fileName.trim();
  let fullUrl = '';
  if (cleanFile.startsWith('http://') || cleanFile.startsWith('https://')) {
    fullUrl = cleanFile;
  } else {
    const baseUrl = ENV.FILE_URL.endsWith('/') ? ENV.FILE_URL : `${ENV.FILE_URL}/`;
    fullUrl = `${baseUrl}${cleanFile}`;
  }

  return `[${agenda}](${fullUrl})`;
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
 * Memeriksa apakah teks input pengguna murni berupa sapaan/greeting santai atau pembuka percakapan
 * (contoh: "halo", "hai", "pagi", "selamat pagi", "assalamualaikum", "ping", "menu", dsb.)
 * tanpa memuat permintaan atau kata kunci pencarian fitur lainnya.
 */
export function isPureGreeting(text: string | null | undefined): boolean {
  if (!text) return false;
  const clean = text
    .toLowerCase()
    .replace(/^[^\w]+|[^\w]+$/g, '')
    .trim();
  if (!clean) return false;

  const greetingTokens = new Set([
    'halo', 'halo min', 'halo bot', 'halo admin', 'halo pak', 'halo bu', 'halo kak',
    'hai', 'hai min', 'hai bot', 'hai admin', 'hai kak',
    'hi', 'hi min', 'hi bot', 'helo', 'hello',
    'pagi', 'selamat pagi', 'pagi min', 'selamat pagi min', 'selamat pagi pak', 'selamat pagi bu',
    'siang', 'selamat siang', 'siang min', 'selamat siang min', 'selamat siang pak', 'selamat siang bu',
    'sore', 'selamat sore', 'sore min', 'selamat sore min', 'selamat sore pak', 'selamat sore bu',
    'malam', 'selamat malam', 'malam min', 'selamat malam min', 'selamat malam pak', 'selamat malam bu',
    'assalamualaikum', "assalamu'alaikum", 'assalamu alaikum', 'assalamualaikum wr wb', "assalamu'alaikum wr wb",
    'salam', 'sampurasun', 'kulonuwun',
    'ping', 'p', 'tes', 'test',
    'menu', 'start', '/start', 'buka menu', 'tampilkan menu'
  ]);

  if (greetingTokens.has(clean)) return true;

  const greetingPattern = /^(?:halo|hai|hi|helo|hello|p|ping|tes|test|assalamu\s*['’]?alaikum(?:\s*wr\s*wb)?|selamat\s+(?:pagi|siang|sore|malam)|salam)(?:\s+(?:min|admin|bot|kak|pak|bu|bapak|ibu|protokol|asisten))?[.!?~]*$/i;

  return greetingPattern.test(clean);
}

/**
 * Memeriksa apakah teks input pengguna merupakan kata konfirmasi affirmative/koreksi langkah formulir
 * (contoh: "ya", "iya", "benar", "simpan", "oke", "1", "salah", "tidak", "koreksi", "2", dsb.)
 */
export function isFormConfirmationInput(text: string | null | undefined): boolean {
  if (!text) return false;
  const clean = text.toLowerCase().trim();
  const confirmationWords = new Set([
    '1', '2', '3', '4', '5', '6', '7',
    'ya', 'iya', 'y', 'yes', 'benar', 'betul', 'simpan', 'oke', 'ok',
    'sesuai', 'sudah benar', 'lanjut', 'pas', 'siap', 'sudah sesuai',
    'salah', 'tidak', 'bukan', 't', 'koreksi', 'ubah', 'edit', 'ganti', 'ada yang salah',
    'manual', 'batal', 'cancel', 'gajadi'
  ]);
  return confirmationWords.has(clean);
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


