import { prisma } from '../database/prisma';
import { Prisma } from '@prisma/client';
import { pdfService } from './pdfService';
import { SuratDraftData } from './sessionService';
import { cleanHtml, generateLetterFileName } from '../utils/textHelper';
import { ENV } from '../config/env';
import path from 'path';

export interface SuratRegistrationResult {
  success: boolean;
  message: string;
  nomorAgenda?: string;
  suratId?: number;
  fileName?: string;
}

export const LETTER_CATEGORY_MAP: Record<string, bigint> = {
  UND: BigInt(2),
  UNR: BigInt(3),
  PH: BigInt(4),
  AU: BigInt(5),
  WR: BigInt(6),
  LP: BigInt(7),
  TAP: BigInt(8),
};

export const REVERSE_CATEGORY_MAP: Record<string, string> = {
  '2': 'UND',
  '3': 'UNR',
  '4': 'PH',
  '5': 'AU',
  '6': 'WR',
  '7': 'LP',
  '8': 'TAP',
};

export const LETTER_TYPE_MAP: Record<string, bigint> = {
  Biasa: BigInt(1),
  Rahasia: BigInt(2),
  Penting: BigInt(3),
  'Penting / Segera': BigInt(3),
  Tembusan: BigInt(4),
};

export const REVERSE_TYPE_MAP: Record<string, string> = {
  '1': 'Biasa',
  '2': 'Rahasia',
  '3': 'Penting',
  '4': 'Tembusan',
};

export interface NormalizedSurat {
  id: number;
  nomorAgenda: string;
  jenisSurat: string;
  tipeSurat: string;
  nomorSurat: string;
  tanggalSurat: string;
  subject: string;
  asalSurat: string;
  asalInstansi: string;
  event?: string | null;
  picPengirim?: string | null;
  perihal: string;
  filePath: string;
  fileName: string;
  fileSize: number;
  userInputId: number;
  userInput: {
    nama: string;
    jabatan?: string | null;
  };
  disposisi?: {
    id: number;
    status: 'SUDAH_DISPOSISI' | 'BELUM_DISPOSISI';
    tanggalDisposisi?: Date | string | null;
    tujuanDisposisi?: string | null;
    instruksi?: string | null;
    catatan?: string | null;
  } | null;
  createdAt: Date;
  updatedAt: Date;
}

import { expandSearchTermsWithAcronyms, calculateRelevanceScore } from '../utils/acronymHelper';

export interface SuratSearchOptions {
  limit?: number;
  dateStart?: Date;
  dateEnd?: Date;
  sender?: string;
  category?: string;
}

export class SuratService {
  /**
   * Mengonversi baris tabel letters + disposisi ke interface NormalizedSurat
   */
  private mapLetterToNormalized(letter: any, disp?: any): NormalizedSurat {
    const catStr = String(letter.letter_category_id || '2');
    const typeStr = String(letter.type_letter || '1');

    const jenisSurat = REVERSE_CATEGORY_MAP[catStr] || 'UND';
    const tipeSurat = REVERSE_TYPE_MAP[typeStr] || 'Biasa';

    const tglSurat = letter.date_letter
      ? new Date(letter.date_letter).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })
      : '-';

    const cleanSubject = cleanHtml(letter.subject) || cleanHtml(letter.note) || '-';

    let disposisiObj: NormalizedSurat['disposisi'] = {
      id: 0,
      status: 'BELUM_DISPOSISI',
    };

    if (disp) {
      const cleanNote = cleanHtml(disp.note);
      disposisiObj = {
        id: Number(disp.id),
        status: 'SUDAH_DISPOSISI',
        tanggalDisposisi: disp.date || disp.created_at,
        tujuanDisposisi: disp.send_by || '-',
        instruksi: cleanNote || '-',
        catatan: cleanNote || '-',
      };
    }

    return {
      id: Number(letter.id),
      nomorAgenda: letter.agenda_number || '-',
      jenisSurat,
      tipeSurat,
      nomorSurat: letter.number_or_date || '-',
      tanggalSurat: tglSurat,
      subject: cleanSubject,
      asalSurat: letter.from || '-',
      asalInstansi: letter.institution_origin || 'Lainnya',
      event: letter.place_event || '-',
      picPengirim: letter.pic_name || '-',
      perihal: cleanSubject,
      filePath: letter.file || '',
      fileName: letter.file || '',
      fileSize: 0,
      userInputId: 1,
      userInput: {
        nama: letter.created_by || 'Petugas Protokol',
        jabatan: 'Staf Protokol',
      },
      disposisi: disposisiObj,
      createdAt: letter.created_at ? new Date(letter.created_at) : new Date(),
      updatedAt: letter.updated_at ? new Date(letter.updated_at) : new Date(),
    };
  }

  /**
   * Menghasilkan Nomor Agenda berikutnya berdasarkan Jenis Surat dan Bulan/Tahun berjalan
   * Format sesuai standar database: {SEQ}/M/{JENIS}/{ROMAN_MONTH}/{YEAR} (misal: 208/M/UND/IX/2026)
   */
  public async generateNomorAgenda(jenisSurat: string): Promise<string> {
    const cleanJenis = (jenisSurat || 'UND').trim().toUpperCase();
    const now = new Date();
    const tahun = now.getFullYear();
    const monthNum = now.getMonth() + 1;

    const romanMonths: Record<number, string> = {
      1: 'I',
      2: 'II',
      3: 'III',
      4: 'IV',
      5: 'V',
      6: 'VI',
      7: 'VII',
      8: 'VIII',
      9: 'IX',
      10: 'X',
      11: 'XI',
      12: 'XII',
    };
    const romanMonth = romanMonths[monthNum] || 'IX';

    const pattern = `/M/${cleanJenis}/`;

    const existing = await prisma.letters.findMany({
      where: {
        deleted_at: null,
        agenda_number: {
          contains: pattern,
        },
      },
      select: { agenda_number: true },
      take: 100,
      orderBy: { id: 'desc' },
    });

    let maxSeq = 0;
    for (const item of existing) {
      if (!item.agenda_number) continue;
      const match = item.agenda_number.match(/^(\d+)\/M\//i);
      if (match) {
        const num = parseInt(match[1], 10);
        if (!isNaN(num) && num > maxSeq) {
          maxSeq = num;
        }
      }
    }

    let nextSeq = maxSeq + 1;
    // Format urutan nomor agenda di database mengikuti angka natural (contoh: 56/M/UNR/..., 248/M/UND/...)
    const formatSeq = (seq: number) => String(seq);

    let candidate = `${formatSeq(nextSeq)}/M/${cleanJenis}/${romanMonth}/${tahun}`;
    while (await this.isNomorAgendaExists(candidate)) {
      nextSeq++;
      candidate = `${formatSeq(nextSeq)}/M/${cleanJenis}/${romanMonth}/${tahun}`;
    }

    return candidate;
  }

  /**
   * Memeriksa apakah suatu nomor agenda sudah digunakan
   */
  public async isNomorAgendaExists(nomorAgenda: string): Promise<boolean> {
    const existing = await prisma.letters.findFirst({
      where: {
        deleted_at: null,
        agenda_number: nomorAgenda,
      },
    });
    return !!existing;
  }

  /**
   * Menyimpan Surat Masuk secara transaksional di tabel letters (PostgreSQL DB)
   */
  public async saveSuratDraft(draft: SuratDraftData, userId: number): Promise<SuratRegistrationResult> {
    if (!draft.nomorAgenda || !draft.jenisSurat || !draft.tipeSurat || !draft.extractedData || !draft.tempPdfPath) {
      return {
        success: false,
        message: 'Data draft surat belum lengkap.',
      };
    }

    try {
      // Tentukan nama berkas final (dari draft.finalFileName atau generate baru)
      const finalFileName = draft.finalFileName || generateLetterFileName(draft.tempPdfName);

      // 1. Pindahkan berkas dari temp ke folder upload storage (siap disymlink di server)
      const permanentFilePath = pdfService.moveToUploadStorage(draft.tempPdfPath, finalFileName);

      const categoryId = LETTER_CATEGORY_MAP[draft.jenisSurat] || BigInt(2);
      const typeId = LETTER_TYPE_MAP[draft.tipeSurat] || BigInt(1);

      // Parse tanggal surat jika ada
      let parsedDate: Date | null = null;
      if (draft.extractedData.tanggalSurat) {
        const parsed = new Date(draft.extractedData.tanggalSurat);
        if (!isNaN(parsed.getTime())) {
          parsedDate = parsed;
        }
      }

      // Get max ID to avoid sequence primary key conflict
      const lastLetter = await prisma.letters.findFirst({
        orderBy: { id: 'desc' },
        select: { id: true },
      });
      const nextId = lastLetter ? BigInt(lastLetter.id) + BigInt(1) : BigInt(1);

          const finalPerihalDanAcara = draft.finalPerihal || draft.extractedData.perihal || draft.extractedData.event || '-';

          // Simpan surat ke tabel letters
          const surat = await prisma.letters.create({
            data: {
              id: nextId,
              letter_category_id: categoryId,
              agenda_number: draft.nomorAgenda,
              number_or_date: draft.extractedData.nomorSurat || '-',
              date_letter: parsedDate,
              from: draft.extractedData.asalSurat || '-',
              subject: finalPerihalDanAcara,
              place_event: finalPerihalDanAcara,
              type_letter: typeId,
              file: finalFileName,
          pic_name: draft.extractedData.picPengirim || '-',
          institution_origin: draft.asalInstansi || 'Lainnya',
          created_by: 'Chatbot WhatsApp',
          created_at: new Date(),
          updated_at: new Date(),
        },
      });

      // Catat activity log
      try {
        await prisma.activity_log.create({
          data: {
            log_name: 'default',
            description: 'Menambah Surat (Chatbot WhatsApp)',
            subject_id: Number(surat.id),
            subject_type: 'App\\Models\\Letters',
            causer_id: Number(userId),
            causer_type: 'App\\Models\\User',
            properties: JSON.stringify({
              nomorAgenda: surat.agenda_number,
              nomorSurat: surat.number_or_date,
              asalSurat: surat.from,
            }),
            created_at: new Date(),
            updated_at: new Date(),
          },
        });
      } catch (logErr) {
        console.warn('Failed to write activity_log:', logErr);
      }

        return {
          success: true,
          message: 'Surat berhasil disimpan ke sistem.',
          nomorAgenda: surat.agenda_number,
          suratId: Number(surat.id),
          fileName: finalFileName,
        };
    } catch (err: any) {
      console.error('Database error saving surat:', err);
      if (draft.tempPdfPath) {
        pdfService.deleteTempPdf(draft.tempPdfPath);
      }
      return {
        success: false,
        message: `Terjadi kesalahan saat menyimpan ke database: ${err.message}`,
      };
    }
  }

  /**
   * Membatalkan draft dan menghapus berkas sementara
   */
  public async cancelDraft(draft?: SuratDraftData, userId?: number): Promise<void> {
    if (draft?.tempPdfPath) {
      pdfService.deleteTempPdf(draft.tempPdfPath);
    }
  }

  /**
   * Mengambil riwayat surat terbaru dengan pagination (5 surat per halaman)
   */
  public async getRiwayatSurat(page: number = 0, pageSize: number = 5) {
    const totalCount = await prisma.letters.count({
      where: { deleted_at: null },
    });

    const items = await prisma.letters.findMany({
      where: { deleted_at: null },
      skip: page * pageSize,
      take: pageSize,
      orderBy: {
        id: 'desc',
      },
    });

    const letterIds = items.map((i) => i.id);
    const dispositions = await prisma.dispositions.findMany({
      where: {
        letter_id: { in: letterIds },
        deleted_at: null,
      },
      orderBy: { id: 'desc' },
    });

    const dispMap = new Map<string, any>();
    dispositions.forEach((d) => {
      const key = String(d.letter_id);
      if (!dispMap.has(key)) {
        dispMap.set(key, d);
      }
    });

    const normalizedItems = items.map((l) => this.mapLetterToNormalized(l, dispMap.get(String(l.id))));

    return {
      items: normalizedItems,
      page,
      pageSize,
      totalCount,
      hasNextPage: (page + 1) * pageSize < totalCount,
    };
  }

  /**
   * Mengambil detail lengkap satu surat berdasarkan ID
   */
  public async getDetailSurat(id: number): Promise<NormalizedSurat | null> {
    const letter = await prisma.letters.findFirst({
      where: {
        id: BigInt(id),
        deleted_at: null,
      },
    });

    if (!letter) return null;

    const disp = await prisma.dispositions.findFirst({
      where: {
        letter_id: letter.id,
        deleted_at: null,
      },
      orderBy: { id: 'desc' },
    });

    return this.mapLetterToNormalized(letter, disp);
  }

  /**
   * Menghitung bobot kebaruan (recency) tanggal surat terhadap hari ini
   * - Surat baru (pekan ini / bulan ini): prioritas tertinggi (+50 s.d. +80 poin)
   * - Surat 1-2 bulan lalu: (+25 poin)
   * - Surat 2-3 bulan lalu: (-15 poin)
   * - Surat > 3 bulan lalu: penalti bertingkat (-15 s.d. -120 poin)
   */
  public calculateLetterRecencyBonus(letterDate: Date | string | null | undefined): number {
    if (!letterDate) return -80;
    const d = new Date(letterDate);
    if (isNaN(d.getTime())) return -80;

    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const daysAgo = diffMs / (1000 * 60 * 60 * 24);

    if (daysAgo < 0) {
      // Surat bertanggal masa depan (misal undangan acara mendatang)
      return 80;
    }
    if (daysAgo <= 7) return 80; // Pekan ini
    if (daysAgo <= 30) return 50; // Bulan ini
    if (daysAgo <= 60) return 25; // 1-2 bulan lalu
    if (daysAgo <= 90) return -15; // 2-3 bulan lalu
    return Math.max(-120, -15 - (daysAgo - 90) * 0.4); // > 3 bulan lalu
  }

  /**
   * Mencari surat masuk secara cerdas dan relevan di tabel letters dengan memprioritaskan surat terbaru
   * Mendukung pencarian multi-dimensi: perihal, pengirim, instansi, catatan surat, instruksi disposisi, dan nomor
   */
  public async searchSuratByPerihal(
    keyword: string,
    limitOrOptions: number | SuratSearchOptions = 10
  ): Promise<NormalizedSurat[]> {
    const clean = keyword.trim().toLowerCase();
    if (!clean) return [];

    const options: SuratSearchOptions =
      typeof limitOrOptions === 'number' ? { limit: limitOrOptions } : limitOrOptions;
    const limit = options.limit || 10;

    // Filter tanggal jika ditentukan di options
    const dateFilter =
      options.dateStart || options.dateEnd
        ? {
            date_letter: {
              ...(options.dateStart ? { gte: options.dateStart } : {}),
              ...(options.dateEnd ? { lte: options.dateEnd } : {}),
            },
          }
        : {};

    // Jika kata kunci pencarian adalah 'terbaru' atau 'terakhir', ambil langsung surat-surat paling baru
    if (
      clean === 'terbaru' ||
      clean === 'terakhir' ||
      clean === 'baru' ||
      clean === 'surat terbaru' ||
      clean === 'surat terakhir' ||
      clean === 'surat baru'
    ) {
      const recentLetters = await prisma.letters.findMany({
        where: {
          deleted_at: null,
          ...dateFilter,
        },
        take: limit,
        orderBy: [
          { date_letter: 'desc' },
          { id: 'desc' },
        ],
      });

      const candidateIds = recentLetters.map((c) => c.id);
      const disps = await prisma.dispositions.findMany({
        where: {
          letter_id: { in: candidateIds },
          deleted_at: null,
        },
        orderBy: { id: 'desc' },
      });

      const dispMap = new Map<string, any>();
      disps.forEach((d) => {
        const key = String(d.letter_id);
        if (!dispMap.has(key)) {
          dispMap.set(key, d);
        }
      });

      return recentLetters.map((l) => this.mapLetterToNormalized(l, dispMap.get(String(l.id))));
    }

    // 1. Ekspansi cerdas kata kunci dengan akronim & kepanjangannya
    const expansion = expandSearchTermsWithAcronyms(clean);
    const searchTermsArray = expansion.expandedTerms;

    // 1b. Cari ID surat yang cocok dari isi catatan & tujuan disposisi
    const qMode: Prisma.QueryMode = 'insensitive';
    let dispLetterIds: bigint[] = [];
    try {
      const matchingDisps = await prisma.dispositions.findMany({
        where: {
          deleted_at: null,
          OR: searchTermsArray.flatMap((term) => [
            { note: { contains: term, mode: qMode } },
            { send_by: { contains: term, mode: qMode } },
          ]),
        },
        select: { letter_id: true },
        take: 40,
      });
      dispLetterIds = matchingDisps
        .map((d) => d.letter_id)
        .filter((id): id is bigint => Boolean(id));
    } catch {
      // Abaikan error relasi disposisi jika skema belum sepenuhnya terisi
    }

    // 2. Ambil kandidat surat dari database (mencakup subject, from, note, place_event, number, institution, pic, & disposisi)
    let candidates: any[] = [];

    // Jika query terdiri dari 2 kata atau lebih, coba cari dengan klausa AND terlebih dahulu
    if (expansion.meaningfulTokens.length >= 2) {
      candidates = await prisma.letters.findMany({
        where: {
          deleted_at: null,
          ...dateFilter,
          AND: expansion.meaningfulTokens.map((tok) => ({
            OR: [
              { subject: { contains: tok, mode: qMode } },
              { from: { contains: tok, mode: qMode } },
              { note: { contains: tok, mode: qMode } },
              { place_event: { contains: tok, mode: qMode } },
              { number_or_date: { contains: tok, mode: qMode } },
              { agenda_number: { contains: tok, mode: qMode } },
              { institution_origin: { contains: tok, mode: qMode } },
              { pic_name: { contains: tok, mode: qMode } },
              ...(dispLetterIds.length > 0 ? [{ id: { in: dispLetterIds } }] : []),
            ],
          })),
        },
        take: 60,
        orderBy: [
          { date_letter: 'desc' },
          { id: 'desc' },
        ],
      });
    }

    // Jika tidak ditemukan dengan AND atau query hanya 1 token, cari dengan klausa OR
    if (candidates.length === 0) {
      candidates = await prisma.letters.findMany({
        where: {
          deleted_at: null,
          ...dateFilter,
          OR: [
            ...searchTermsArray.flatMap((term) => [
              { subject: { contains: term, mode: qMode } },
              { from: { contains: term, mode: qMode } },
              { note: { contains: term, mode: qMode } },
              { number_or_date: { contains: term, mode: qMode } },
              { agenda_number: { contains: term, mode: qMode } },
              { place_event: { contains: term, mode: qMode } },
              { institution_origin: { contains: term, mode: qMode } },
              { pic_name: { contains: term, mode: qMode } },
            ]),
            ...(dispLetterIds.length > 0 ? [{ id: { in: dispLetterIds } }] : []),
          ],
        },
        take: 60,
        orderBy: [
          { date_letter: 'desc' },
          { id: 'desc' },
        ],
      });
    }

    if (candidates.length === 0) {
      return [];
    }

    // Ambil disposisi terkait
    const candidateIds = candidates.map((c) => c.id);
    const disps = await prisma.dispositions.findMany({
      where: {
        letter_id: { in: candidateIds },
        deleted_at: null,
      },
      orderBy: { id: 'desc' },
    });

    const dispMap = new Map<string, any>();
    disps.forEach((d) => {
      const key = String(d.letter_id);
      if (!dispMap.has(key)) {
        dispMap.set(key, d);
      }
    });

    // 3. Hitung Relevansi Skor Presisi Tinggi (Kecocokan Teks + Kebaruan Tanggal Surat)
    const scored = candidates.map((letter) => {
      const perihal = letter.subject || '';
      const dispInfo = dispMap.get(String(letter.id));
      const metadata = [
        letter.place_event || '',
        letter.from || '',
        letter.institution_origin || '',
        letter.number_or_date || '',
        letter.agenda_number || '',
        letter.note || '',
        letter.pic_name || '',
        dispInfo?.note || '',
        dispInfo?.send_by || '',
      ];

      const relevance = calculateRelevanceScore(expansion, perihal, metadata);
      const recencyBonus = this.calculateLetterRecencyBonus(letter.date_letter || letter.created_at);
      const totalScore = relevance.score + recencyBonus;
      const normalized = this.mapLetterToNormalized(letter, dispMap.get(String(letter.id)));

      return {
        letter: normalized,
        textScore: relevance.score,
        recencyBonus,
        totalScore,
        matchedAllSpecific: relevance.matchedAllSpecific,
        specificMatchesCount: relevance.specificMatchesCount,
        letterDate: letter.date_letter ? new Date(letter.date_letter) : (letter.created_at ? new Date(letter.created_at) : null),
      };
    });

    // Urutkan berdasarkan totalScore, lalu surat terbaru jika skor setara
    scored.sort((a, b) => {
      if (b.totalScore !== a.totalScore) {
        return b.totalScore - a.totalScore;
      }
      const aTime = a.letterDate ? a.letterDate.getTime() : 0;
      const bTime = b.letterDate ? b.letterDate.getTime() : 0;
      return bTime - aTime;
    });

    const topScore = scored[0]?.totalScore || 0;
    if (topScore <= 0) return [];

    let filtered = scored;
    // 4. Dynamic Specificity Filter:
    // Jika query memuat token spesifik (akronim/entitas seperti BKSTI, SBNI, K3, AMLI, dll.)
    // dan ada surat yang cocok dengan token spesifik tersebut, saring keluar surat lain yang tidak memuat entitas tersebut.
    if (expansion.specificTokens.length > 0) {
      const perfectSpecifics = scored.filter((s) => s.matchedAllSpecific && s.specificMatchesCount > 0);
      if (perfectSpecifics.length > 0) {
        filtered = perfectSpecifics;
      }
    }

    const maxScore = filtered[0]?.totalScore || topScore;
    const threshold = Math.max(30, maxScore * 0.35);

    return filtered
      .filter((s) => s.totalScore >= threshold)
      .slice(0, limit)
      .map((s) => s.letter);
  }
}

export const suratService = new SuratService();
