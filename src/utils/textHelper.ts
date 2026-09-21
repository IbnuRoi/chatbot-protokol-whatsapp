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

