import { prisma } from '../database/prisma';
import { Prisma, letters } from '@prisma/client';
import { pdfService } from './pdfService';
import { SuratDraftData } from './sessionService';
import { cleanHtml, formatCombinedPic, formatNoteHtml, generateLetterFileName, splitPicNameAndPhone, sanitizePlaceEvent, formatInitialEventTitle, buildNarasiPenayanganTap } from '../utils/textHelper';
import { parseIndonesianDateToDate, formatTanggalIndo, parseIndonesianTimeToDates, parseIndonesianDateEventRange, isValidDate, extractWaktuAcaraFromText } from '../utils/dateHelper';
import { generateEventTitleFromSurat, generateSubjectSummary } from './aiService';
import { syncTableSequence, isDuplicateKeyError } from '../database/sequenceSync';
import { ENV } from '../config/env';
import path from 'path';

export interface SuratRegistrationResult {
  success: boolean;
  message: string;
  nomorAgenda?: string;
  suratId?: number;
  eventId?: number;
  fileName?: string;
  createdBy?: string;
  createdAt?: Date;
  isDuplicateNomorSurat?: boolean;
  duplicateLetter?: letters;
  hasTimeConflict?: boolean;
  conflictingEvents?: Array<{
    id: number | bigint;
    title: string;
    eventTimeStart?: Date | null;
    eventTimeFinish?: Date | null;
    location?: string | null;
  }>;
  isTapCategory?: boolean;
  narasiPenayangan?: string;
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
  dateEvent?: string | null;
  timeEvent?: string | null;
  placeEvent?: string | null;
  picPengirim?: string | null;
  picName?: string | null;
  picPhoneNumber?: string | null;
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

    const cleanPerihal = cleanHtml(letter.note) || cleanHtml(letter.subject) || cleanHtml(letter.place_event) || '-';
    const cleanSubject = cleanHtml(letter.subject) || cleanPerihal || '-';

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
      placeEvent: letter.place_event || null,
      dateEvent: letter.date_event ? formatTanggalIndo(letter.date_event, true) : null,
      timeEvent: letter.time_event
        ? `${String(letter.time_event.getUTCHours()).padStart(2, '0')}:${String(letter.time_event.getUTCMinutes()).padStart(2, '0')} ${letter.time_zone || 'WIB'}`
        : null,
      picPengirim: (() => {
        let n = letter.pic_name || '-';
        let p = letter.pic_phone_number || '-';
        if ((p === '-' || !p) && n !== '-') {
          const s = splitPicNameAndPhone(n);
          if (s.phone !== '-') { n = s.name; p = s.phone; }
        }
        const comb = formatCombinedPic(n, p);
        return comb !== '-' ? comb : (letter.pic_name || '-');
      })(),
      picName: (() => {
        const n = letter.pic_name || '-';
        const p = letter.pic_phone_number || '-';
        if ((p === '-' || !p) && n !== '-') {
          const s = splitPicNameAndPhone(n);
          return s.name !== '-' ? s.name : n;
        }
        return n;
      })(),
      picPhoneNumber: (() => {
        const p = letter.pic_phone_number || '-';
        if (p && p !== '-') return p;
        const n = letter.pic_name || '-';
        if (n !== '-') {
          const s = splitPicNameAndPhone(n);
          if (s.phone !== '-') return s.phone;
        }
        return '-';
      })(),
      perihal: cleanPerihal,
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
   * Memeriksa apakah ada surat di database yang memiliki kesamaan nomor surat (number_or_date).
   * Melakukan pencocokan secara case-insensitive dan mengabaikan perbedaan spasi pemisah.
   */
  public async findExistingLetterByNomorSurat(nomorSurat: string): Promise<letters | null> {
    if (!nomorSurat) return null;
    const clean = nomorSurat.trim();
    if (!clean || clean === '-' || clean.length < 3) return null;
    if (/^(?:tidak\s+ada|belum\s+ada|kosong|null|undefined|-)$/i.test(clean)) return null;

    try {
      // 1. Pencocokan exact case-insensitive via Prisma
      const exactMatch = await prisma.letters.findFirst({
        where: {
          deleted_at: null,
          number_or_date: {
            equals: clean,
            mode: 'insensitive',
          },
        },
        orderBy: { id: 'desc' },
      });

      if (exactMatch) {
        return exactMatch;
      }

      // 2. Pencocokan normalisasi spasi (misal: "B - 123 / 2026" vs "B-123/2026")
      const cleanNoSpace = clean.replace(/\s+/g, '').toLowerCase();
      if (cleanNoSpace.length >= 3) {
        const rawMatches = await prisma.$queryRaw<letters[]>`
          SELECT * FROM "letters"
          WHERE "deleted_at" IS NULL
            AND "number_or_date" IS NOT NULL
            AND "number_or_date" != '-'
            AND LENGTH(TRIM("number_or_date")) >= 3
            AND LOWER(REPLACE("number_or_date", ' ', '')) = ${cleanNoSpace}
          ORDER BY "id" DESC
          LIMIT 1
        `;

        if (rawMatches && rawMatches.length > 0) {
          return rawMatches[0];
        }
      }

      return null;
    } catch (err: any) {
      console.warn('[SuratService] Gagal memeriksa duplikasi nomor surat:', err.message);
      return null;
    }
  }

  /**
   * Cek apakah nomor surat sudah ada di database
   */
  public async isNomorSuratExists(nomorSurat: string): Promise<boolean> {
    const existing = await this.findExistingLetterByNomorSurat(nomorSurat);
    return !!existing;
  }

  /**
   * Memeriksa apakah terdapat jadwal kegiatan lain yang berbenturan atau memiliki waktu yang sama
   * pada tabel events. Bersifat informatif (non-blocking).
   */
  public async findConflictingEvents(
    eventTimeStart: Date | null,
    eventTimeFinish: Date | null,
    excludeEventId?: number | bigint
  ): Promise<any[]> {
    if (!eventTimeStart || !isValidDate(eventTimeStart)) return [];

    try {
      const where: Prisma.eventsWhereInput = {
        deleted_at: null,
      };

      if (excludeEventId) {
        where.id = { not: BigInt(excludeEventId) };
      }

      if (eventTimeFinish && isValidDate(eventTimeFinish) && eventTimeFinish > eventTimeStart) {
        where.OR = [
          { event_time_start: eventTimeStart },
          {
            event_time_start: {
              gte: eventTimeStart,
              lt: eventTimeFinish,
            },
          },
        ];
      } else {
        where.event_time_start = eventTimeStart;
      }

      const conflicts = await prisma.events.findMany({
        where,
        select: {
          id: true,
          title: true,
          event_time_start: true,
          event_time_finish: true,
          location: true,
          status: true,
        },
        take: 3,
        orderBy: [{ event_time_start: 'asc' }, { id: 'asc' }],
      });

      return conflicts;
    } catch (err) {
      console.warn('[SuratService] Gagal memeriksa bentrok jadwal:', err);
      return [];
    }
  }

  /**
   * Menyimpan Surat Masuk secara transaksional di tabel letters (PostgreSQL DB)
   */
  public async saveSuratDraft(
    draft: SuratDraftData,
    userId: number,
    userName?: string
  ): Promise<SuratRegistrationResult> {
    if (!draft.nomorAgenda || !draft.jenisSurat || !draft.tipeSurat || !draft.extractedData || !draft.tempPdfPath) {
      return {
        success: false,
        message: 'Data draft surat belum lengkap.',
      };
    }

    // Validasi Anti-Duplikasi: Batalkan proses jika nomor surat sudah ada di database
    const nomorSuratToCheck = (draft.extractedData.nomorSurat || '').trim();
    if (nomorSuratToCheck && nomorSuratToCheck !== '-' && nomorSuratToCheck.length >= 3) {
      const existingLetter = await this.findExistingLetterByNomorSurat(nomorSuratToCheck);
      if (existingLetter) {
        console.warn(`[SuratService] Pendaftaran surat dibatalkan: Nomor surat "${nomorSuratToCheck}" sudah ada pada nomor agenda "${existingLetter.agenda_number}".`);
        if (draft.tempPdfPath) {
          try {
            pdfService.deleteTempPdf(draft.tempPdfPath);
          } catch {}
        }
        return {
          success: false,
          isDuplicateNomorSurat: true,
          duplicateLetter: existingLetter,
          message: `Nomor surat "${nomorSuratToCheck}" sudah terdaftar di database pada nomor agenda ${existingLetter.agenda_number}.`,
        };
      }
    }

    try {
      // Tentukan nama berkas final (dari draft.finalFileName atau generate baru)
      const finalFileName = draft.finalFileName || generateLetterFileName(draft.tempPdfName);

      // 1. Pindahkan berkas dari temp ke folder upload storage (siap disymlink di server)
      const permanentFilePath = pdfService.moveToUploadStorage(draft.tempPdfPath, finalFileName);
      draft.tempPdfPath = permanentFilePath;

      const categoryId = LETTER_CATEGORY_MAP[draft.jenisSurat] || BigInt(2);
      const typeId = LETTER_TYPE_MAP[draft.tipeSurat] || BigInt(1);

      // Parse tanggal surat jika ada
      let parsedDate: Date | null = parseIndonesianDateToDate(draft.extractedData.tanggalSurat);
      if (!isValidDate(parsedDate) && draft.extractedData.tanggalSurat) {
        const parsed = new Date(draft.extractedData.tanggalSurat);
        if (isValidDate(parsed)) {
          parsedDate = parsed;
        }
      }

      // Parse tanggal acara/event jika ada (termasuk kemungkinan rentang tanggal)
      const dateEventRange = parseIndonesianDateEventRange(draft.extractedData.dateEvent);
      let parsedDateEvent: Date | null = isValidDate(dateEventRange.startDate) ? dateEventRange.startDate : null;
      let parsedDateEventEnd: Date | null = isValidDate(dateEventRange.endDate) ? dateEventRange.endDate : null;

      if (!parsedDateEvent && draft.extractedData.dateEvent) {
        const parsed = new Date(draft.extractedData.dateEvent);
        if (isValidDate(parsed)) {
          parsedDateEvent = parsed;
        }
      }

      // Ekstrak string jam acara (prioritaskan timeEvent, jika kosong atau strip ambil dari dateEvent)
      let rawTimeStr = (draft.extractedData.timeEvent || '').trim();
      if (rawTimeStr === '-' || /^(?:tidak\s+ada|belum\s+ada|kosong|null|undefined)$/i.test(rawTimeStr)) {
        rawTimeStr = '';
      }
      if (!rawTimeStr && draft.extractedData.dateEvent) {
        rawTimeStr = draft.extractedData.dateEvent;
      }
      if (!rawTimeStr && (draft.extractedData as any).rawText) {
        rawTimeStr = extractWaktuAcaraFromText((draft.extractedData as any).rawText) || '';
      }

      // Parse jam acara/event jika ada
      const parsedTimeInfo = parseIndonesianTimeToDates(rawTimeStr);
      const parsedTimeEvent: Date | null = isValidDate(parsedTimeInfo.startTime) ? parsedTimeInfo.startTime : null;
      const parsedTimeFinish: Date | null = isValidDate(parsedTimeInfo.finishTime) ? parsedTimeInfo.finishTime : null;
      const parsedTimeZone: string = (parsedTimeInfo.timeZone || 'WIB').toUpperCase().slice(0, 10);

      // Waktu acara untuk kolom letters.time_event dan time_event_finish (@db.Time(6)) disimpan sesuai jam hasil ekstraksi surat
      let letterTimeEvent: Date | null = null;
      if (isValidDate(parsedTimeEvent)) {
        const startH = parsedTimeEvent.getUTCHours();
        const startM = parsedTimeEvent.getUTCMinutes();
        letterTimeEvent = new Date(Date.UTC(1970, 0, 1, startH, startM, 0, 0));
      }

      let letterTimeFinish: Date | null = null;
      if (isValidDate(parsedTimeFinish)) {
        const finishH = parsedTimeFinish.getUTCHours();
        const finishM = parsedTimeFinish.getUTCMinutes();
        letterTimeFinish = new Date(Date.UTC(1970, 0, 1, finishH, finishM, 0, 0));
      }

      // ID ditangani otomatis oleh PostgreSQL Sequence (autoincrement) agar selalu sinkron dengan website
      let finalPerihal = draft.finalPerihal || draft.extractedData.perihal || '-';

      // Deteksi kategori surat apakah TAP (Permohonan Video Ucapan / Taping)
      const rawKategori = (
        draft.jenisSurat ||
        draft.extractedData?.kategoriSurat ||
        ''
      ).toUpperCase().trim();
      const isTapCategory = rawKategori === 'TAP' || (draft.nomorAgenda || '').toUpperCase().includes('/TAP/');

      // Khusus kategori TAP, pastikan narasi penayangan ("akan ditayangkan pada ...") disertakan pada perihal jika ada info tanggal
      if (isTapCategory && finalPerihal !== '-' && !finalPerihal.toLowerCase().includes('ditayangkan')) {
        const narasiTayang = buildNarasiPenayanganTap({
          dateEvent: draft.extractedData.dateEvent,
          timeEvent: draft.extractedData.timeEvent,
          placeEvent: draft.extractedData.placeEvent,
        });
        if (draft.extractedData.dateEvent && draft.extractedData.dateEvent !== '-') {
          finalPerihal = `${finalPerihal} yang ${narasiTayang}`;
        }
      }

      const finalSubject = (
        draft.finalSubject ||
        draft.extractedData.subject ||
        generateSubjectSummary(finalPerihal, draft.extractedData)
      ).slice(0, 200);

      // Format perihal ke format HTML (<p>...</p>) sesuai format kolom note di tabel letters
      const formattedNote = formatNoteHtml(finalPerihal);

      const creatorName = (userName || '').trim() || 'Petugas Protokol';

      // Pisahkan antara nama PIC dan nomor teleponnya
      let rawPicName = (draft.extractedData.picName || '').trim();
      let rawPicPhone = (draft.extractedData.picPhoneNumber || '').trim();

      if ((!rawPicName || rawPicName === '-' || !rawPicPhone || rawPicPhone === '-') && draft.extractedData.picPengirim) {
        const splitted = splitPicNameAndPhone(draft.extractedData.picPengirim);
        if ((!rawPicName || rawPicName === '-') && splitted.name !== '-') {
          rawPicName = splitted.name;
        }
        if ((!rawPicPhone || rawPicPhone === '-') && splitted.phone !== '-') {
          rawPicPhone = splitted.phone;
        }
      }

      const safePicName = (rawPicName && rawPicName !== '-' ? rawPicName : '-').slice(0, 100);
      const safePicPhone = (rawPicPhone && rawPicPhone !== '-' ? rawPicPhone : '-').slice(0, 50);

      // Format kolom PIC yang disimpan ke tabel letters
      // Pada tabel letters, kolom PIC (pic_name) memuat nama dan nomor kontak sesuai format tabel letters: "Nama PIC (Nomor PIC)" atau "Nama PIC"
      const safePicCombined = formatCombinedPic(
        safePicName !== '-' ? safePicName : (draft.extractedData.picPengirim || safePicPhone),
        safePicPhone
      ).slice(0, 100);

      const safeLettersPicPhone = safePicPhone && safePicPhone !== '-' ? safePicPhone : null;

      let picJson: string | null = null;
      if (safePicName !== '-' || safePicPhone !== '-') {
        picJson = JSON.stringify([
          {
            name: safePicName !== '-' ? safePicName : '',
            phone: safePicPhone !== '-' ? safePicPhone : '',
          },
        ]);
      }

      // Sanitisasi dan batasi panjang setiap kolom secara ketat sesuai skema database PostgreSQL
      // agar tidak pernah terjadi error 22001 (value too long for type character varying)
      const safeAgendaNumber = (draft.nomorAgenda || '').trim().slice(0, 100);
      const safeNomorSurat = (draft.extractedData.nomorSurat || '-').trim().slice(0, 100);
      const safeAsalSurat = (draft.extractedData.asalSurat || '-').trim().slice(0, 225);
      const safeSubject = finalSubject.trim().slice(0, 200);

      // Bersihkan dan validasi tempat/lokasi acara (cegah teks perihal/acara masuk ke lokasi)
      const cleanSanitizedPlace = sanitizePlaceEvent(
        draft.extractedData.placeEvent,
        finalPerihal,
        draft.extractedData.namaAcara
      );
      const safePlaceEvent = (cleanSanitizedPlace && cleanSanitizedPlace !== '-' && cleanSanitizedPlace.trim().length > 0)
        ? cleanSanitizedPlace.trim().slice(0, 220)
        : null;

      // Zona waktu untuk surat hanya disimpan jika memang ada tanggal atau jam acara
      const safeLettersTimeZone = (isValidDate(parsedDateEvent) || isValidDate(parsedTimeEvent)) ? parsedTimeZone : null;

      const safeFileName = finalFileName.trim().slice(0, 225);
      const safeInstansi = (draft.asalInstansi || 'Lainnya').trim().slice(0, 50);
      const safeCreatorName = creatorName.trim().slice(0, 191);

      // Siapkan payload data surat (tanpa id manual agar sequence PostgreSQL bertambah otomatis dan sinkron dengan website)
      const letterPayload: Prisma.lettersCreateInput = {
        letter_category_id: categoryId,
        agenda_number: safeAgendaNumber,
        number_or_date: safeNomorSurat,
        date_letter: parsedDate,
        date_event: isValidDate(parsedDateEvent) ? parsedDateEvent : null,
        date_event_end: isValidDate(parsedDateEventEnd) ? parsedDateEventEnd : null,
        time_event: isValidDate(letterTimeEvent) ? letterTimeEvent : null,
        time_event_finish: isValidDate(letterTimeFinish) ? letterTimeFinish : null,
        time_zone: safeLettersTimeZone,
        from: safeAsalSurat,
        subject: safeSubject,
        place_event: safePlaceEvent,
        type_letter: typeId,
        note: formattedNote,
        file: safeFileName,
        pic_name: safePicCombined,
        pic_phone_number: safeLettersPicPhone,
        pic_json: picJson,
        institution_origin: safeInstansi,
        created_by: safeCreatorName,
        created_at: new Date(),
        updated_at: new Date(),
      };

      // Simpan surat ke tabel letters dengan fallback protektif & self-healing sequence sync
      let surat: any;
      try {
        surat = await prisma.letters.create({
          data: letterPayload,
        });
      } catch (insertErr: any) {
        if (isDuplicateKeyError(insertErr)) {
          console.warn('[SuratService] Terdeteksi bentrok sequence pada tabel letters. Menjalankan auto-sync sequence dan me-retry insert...');
          await syncTableSequence('letters');
          surat = await prisma.letters.create({
            data: letterPayload,
          });
        } else if (
          insertErr.message?.includes('too long') ||
          insertErr.code === 'P2000' ||
          insertErr.code === '22001'
        ) {
          console.warn('[SuratService] Insert pertama gagal karena nilai terlalu panjang, mencoba fallback note dipotong:', insertErr.message);
          const truncatedNote = formattedNote ? `<p>${finalPerihal.trim().slice(0, 210)}</p>` : null;
          try {
            surat = await prisma.letters.create({
              data: {
                ...letterPayload,
                note: truncatedNote,
              },
            });
          } catch (retryErr: any) {
            if (isDuplicateKeyError(retryErr)) {
              console.warn('[SuratService] Terdeteksi bentrok sequence pada tabel letters saat retry note. Menjalankan auto-sync sequence...');
              await syncTableSequence('letters');
              surat = await prisma.letters.create({
                data: {
                  ...letterPayload,
                  note: truncatedNote,
                },
              });
            } else {
              throw retryErr;
            }
          }
        } else {
          throw insertErr;
        }
      }

      // Catat activity log surat dengan penanganan bentrok sequence
      try {
        await prisma.activity_log.create({
          data: {
            log_name: 'default',
            description: `Menambah Surat oleh ${creatorName}`,
            subject_id: Number(surat.id),
            subject_type: 'App\\Models\\Letters',
            causer_id: Number(userId),
            causer_type: 'App\\Models\\User',
            properties: JSON.stringify({
              nomorAgenda: surat.agenda_number,
              nomorSurat: surat.number_or_date,
              asalSurat: surat.from,
              subject: surat.subject,
              note: surat.note,
              createdBy: creatorName,
            }),
            created_at: new Date(),
            updated_at: new Date(),
          },
        });
      } catch (logErr: any) {
        if (isDuplicateKeyError(logErr)) {
          await syncTableSequence('activity_log');
          try {
            await prisma.activity_log.create({
              data: {
                log_name: 'default',
                description: `Menambah Surat oleh ${creatorName}`,
                subject_id: Number(surat.id),
                subject_type: 'App\\Models\\Letters',
                causer_id: Number(userId),
                causer_type: 'App\\Models\\User',
                properties: JSON.stringify({
                  nomorAgenda: surat.agenda_number,
                  nomorSurat: surat.number_or_date,
                  asalSurat: surat.from,
                  subject: surat.subject,
                  note: surat.note,
                  createdBy: creatorName,
                }),
                created_at: new Date(),
                updated_at: new Date(),
              },
            });
          } catch {}
        } else {
          console.warn('Failed to write activity_log:', logErr);
        }
      }

      // Otomatis masukkan ke jadwal kegiatan (tabel events) walaupun belum ada lembar disposisi
      // Khusus surat kategori TAP: JANGAN langsung masukkan ke tabel events (hanya diarsipkan, belum masuk jadwal)
      let createdEvent: any = null;
      let eventTimeStart: Date | null = null;
      let eventTimeFinish: Date | null = null;

      if (!isTapCategory) {
        try {
          // 1. Waktu kegiatan (hanya diisi jika memang ada tanggal kegiatan pada surat/hasil ekstraksi)
          let untilFinish = 0;
          let safeEventTimeZone: string | null = null;

        if (isValidDate(parsedDateEvent)) {
          const eventYear = parsedDateEvent.getUTCFullYear();
          const eventMonth = parsedDateEvent.getUTCMonth();
          const eventDay = parsedDateEvent.getUTCDate();

          // 2. Jam mulai: jika ada jam spesifik gunakan itu, jika tidak ada jam spesifik gunakan default 09:00
          let startH = 9;
          let startM = 0;
          if (isValidDate(parsedTimeEvent)) {
            startH = parsedTimeEvent.getUTCHours();
            startM = parsedTimeEvent.getUTCMinutes();
          }

          // Waktu di DB disimpan persis sesuai jam hasil ekstraksi surat:
          const calculatedStart = new Date(Date.UTC(eventYear, eventMonth, eventDay, startH, startM, 0, 0));
          eventTimeStart = isValidDate(calculatedStart) ? calculatedStart : null;

          // 3. Jam selesai: date_event & time_event_finish ke kolom event_time_finish jika ada
          if (isValidDate(parsedTimeFinish)) {
            const finishH = parsedTimeFinish.getUTCHours();
            const finishM = parsedTimeFinish.getUTCMinutes();
            const endYear = isValidDate(parsedDateEventEnd) ? parsedDateEventEnd.getUTCFullYear() : eventYear;
            const endMonth = isValidDate(parsedDateEventEnd) ? parsedDateEventEnd.getUTCMonth() : eventMonth;
            const endDay = isValidDate(parsedDateEventEnd) ? parsedDateEventEnd.getUTCDate() : eventDay;

            const calculatedFinish = new Date(Date.UTC(endYear, endMonth, endDay, finishH, finishM, 0, 0));
            if (isValidDate(calculatedFinish)) {
              eventTimeFinish = calculatedFinish;
              untilFinish = 0;
            } else {
              eventTimeFinish = null;
              untilFinish = 1;
            }
          } else if (isValidDate(parsedDateEventEnd) && parsedDateEventEnd.getTime() !== parsedDateEvent.getTime()) {
            // Acara multi-hari tanpa jam selesai spesifik -> simpan waktu selesai hari terakhir pukul 17:00
            const endYear = parsedDateEventEnd.getUTCFullYear();
            const endMonth = parsedDateEventEnd.getUTCMonth();
            const endDay = parsedDateEventEnd.getUTCDate();
            const calcEndMulti = new Date(Date.UTC(endYear, endMonth, endDay, 17, 0, 0, 0));
            eventTimeFinish = isValidDate(calcEndMulti) ? calcEndMulti : null;
            untilFinish = 1;
          } else {
            // Acara 1 hari tanpa jam selesai spesifik (atau berlangsung sampai selesai)
            eventTimeFinish = null;
            untilFinish = 1;
          }

          if (!isValidDate(eventTimeStart)) eventTimeStart = null;
          if (!isValidDate(eventTimeFinish)) eventTimeFinish = null;

          safeEventTimeZone = (parsedTimeZone || 'WIB').slice(0, 10);
        } else {
          // Surat TIDAK menyebutkan tanggal/waktu event atau tidak ada pada hasil ekstraksi:
          // Kosongkan kolom waktu event (null) di tabel database
          eventTimeStart = null;
          eventTimeFinish = null;
          untilFinish = 0;
          safeEventTimeZone = null;
        }

        // 4. Judul kegiatan protokol: generate judul aksi aktif pimpinan + template bold belum ada disposisi
        const rawPerihal = draft.finalPerihal || draft.extractedData.perihal || finalPerihal || '';
        const baseEventTitle = generateEventTitleFromSurat(draft.extractedData, rawPerihal);
        const eventTitle = formatInitialEventTitle(baseEventTitle);

        // 5. Lokasi acara: place_event ke location (kosongkan / null jika tidak ada pada surat)
        const eventLocation = safePlaceEvent || null;

        // 6. Kelengkapan kolom lainnya pada tabel events
        let eventPicJson: string | null = null;
        if (safePicName && safePicName !== '-') {
          eventPicJson = JSON.stringify([
            {
              name: safePicName,
              phone: safePicPhone && safePicPhone !== '-' ? safePicPhone : '',
            },
          ]);
        }

        const eventNotes = `Asal Surat: ${safeAsalSurat} | No. Surat: ${safeNomorSurat} | No. Agenda: ${safeAgendaNumber}`;

        // Siapkan data event baru (tanpa id manual agar sequence PostgreSQL bertambah otomatis dan sinkron dengan website)
        const eventDataPayload: Prisma.eventsCreateInput = {
          title: eventTitle,
          letter_id: BigInt(surat.id),
          disposition_id: null,
          event_time_start: eventTimeStart,
          event_time_finish: eventTimeFinish,
          until_finish: untilFinish,
          is_internal: '0',
          is_hide_location: '0',
          time_zone: safeEventTimeZone,
          status: 1n, // 1: onschedule (Terjadwal / Diagendakan)
          location: eventLocation,
          pic_name: safePicCombined && safePicCombined !== '-' ? safePicCombined : (safePicName && safePicName !== '-' ? safePicName : null),
          pic_phonenumber: safeLettersPicPhone,
          pic_json: picJson || eventPicJson,
          notes: eventNotes,
          created_by: safeCreatorName,
          created_at: new Date(),
          updated_at: new Date(),
        };

        try {
          createdEvent = await prisma.events.create({
            data: eventDataPayload,
          });
        } catch (evIdErr: any) {
          if (isDuplicateKeyError(evIdErr)) {
            console.warn('[SuratService] Terdeteksi bentrok sequence pada tabel events. Menjalankan auto-sync sequence dan me-retry insert...');
            await syncTableSequence('events');
            createdEvent = await prisma.events.create({
              data: eventDataPayload,
            });
          } else {
            console.warn('[SuratService] Gagal membuat event jadwal:', evIdErr.message);
          }
        }

        console.log(`[SuratService] Acara kegiatan berhasil dibuat otomatis untuk surat ${surat.agenda_number} (Event ID: ${createdEvent?.id})`);

        if (createdEvent) {
          // Hubungkan ke tabel pivot event_letters untuk relasi many-to-many Laravel
          try {
            await prisma.event_letters.create({
              data: {
                event_id: createdEvent.id.toString(),
                letter_id: surat.id.toString(),
                disposition_id: null,
                created_by: safeCreatorName,
                created_at: new Date(),
                updated_at: new Date(),
              },
            });
            console.log(`[SuratService] Menautkan event ID ${createdEvent.id} dan letter ID ${surat.id} di tabel event_letters`);
          } catch (elErr: any) {
            if (isDuplicateKeyError(elErr)) {
              console.warn('[SuratService] Terdeteksi bentrok sequence pada tabel event_letters. Menjalankan auto-sync sequence dan me-retry...');
              await syncTableSequence('event_letters');
              try {
                await prisma.event_letters.create({
                  data: {
                    event_id: createdEvent.id.toString(),
                    letter_id: surat.id.toString(),
                    disposition_id: null,
                    created_by: safeCreatorName,
                    created_at: new Date(),
                    updated_at: new Date(),
                  },
                });
              } catch (elRetryErr) {
                console.warn('[SuratService] Gagal me-retry relasi event_letters:', elRetryErr);
              }
            } else {
              console.warn('[SuratService] Gagal membuat relasi event_letters:', elErr);
            }
          }

          // Catat activity log untuk penambahan agenda acara
          try {
            await prisma.activity_log.create({
              data: {
                log_name: 'default',
                description: `Menambah Jadwal Kegiatan Otomatis dari Surat ${surat.agenda_number} oleh ${creatorName}`,
                subject_id: Number(createdEvent.id),
                subject_type: 'App\\Models\\Events',
                causer_id: Number(userId),
                causer_type: 'App\\Models\\User',
                properties: JSON.stringify({
                  letterId: Number(surat.id),
                  agendaNumber: surat.agenda_number,
                  title: eventTitle,
                  location: eventLocation,
                  eventTimeStart: isValidDate(eventTimeStart) ? eventTimeStart.toISOString() : null,
                  eventTimeFinish: isValidDate(eventTimeFinish) ? eventTimeFinish.toISOString() : null,
                  untilFinish,
                  status: 'Diagendakan',
                }),
                created_at: new Date(),
                updated_at: new Date(),
              },
            });
          } catch (evLogErr: any) {
            if (isDuplicateKeyError(evLogErr)) {
              await syncTableSequence('activity_log');
              try {
                await prisma.activity_log.create({
                  data: {
                    log_name: 'default',
                    description: `Menambah Jadwal Kegiatan Otomatis dari Surat ${surat.agenda_number} oleh ${creatorName}`,
                    subject_id: Number(createdEvent.id),
                    subject_type: 'App\\Models\\Events',
                    causer_id: Number(userId),
                    causer_type: 'App\\Models\\User',
                    properties: JSON.stringify({
                      letterId: Number(surat.id),
                      agendaNumber: surat.agenda_number,
                      title: eventTitle,
                      location: eventLocation,
                      eventTimeStart: isValidDate(eventTimeStart) ? eventTimeStart.toISOString() : null,
                      eventTimeFinish: isValidDate(eventTimeFinish) ? eventTimeFinish.toISOString() : null,
                      untilFinish,
                      status: 'Diagendakan',
                    }),
                    created_at: new Date(),
                    updated_at: new Date(),
                  },
                });
              } catch {}
            } else {
              console.warn('Failed to write activity_log for event:', evLogErr);
            }
          }
        }
      } catch (eventErr: any) {
        console.error('[SuratService] Gagal membuat jadwal kegiatan otomatis dari surat:', eventErr);
      }
    } else {
      console.log(`[SuratService] Surat ${surat.agenda_number} adalah kategori TAP (Video Ucapan). Tidak dibuatkan jadwal di tabel events.`);
    }

      // Cek apakah ada jadwal lain yang bentrok / bersamaan waktunya (bersifat informatif, tidak membatalkan)
      let conflictingEvents: any[] = [];
      if (!isTapCategory && eventTimeStart && isValidDate(eventTimeStart)) {
        conflictingEvents = await this.findConflictingEvents(
          eventTimeStart,
          eventTimeFinish,
          createdEvent ? createdEvent.id : undefined
        );
      }

      return {
        success: true,
        message: isTapCategory
          ? 'Surat kategori TAP berhasil disimpan ke sistem (tidak dijadwalkan otomatis ke kalender kegiatan).'
          : 'Surat berhasil disimpan ke sistem.',
        nomorAgenda: surat.agenda_number,
        suratId: Number(surat.id),
        eventId: createdEvent ? Number(createdEvent.id) : undefined,
        fileName: safeFileName,
        createdBy: creatorName,
        createdAt: surat.created_at || new Date(),
        hasTimeConflict: conflictingEvents.length > 0,
        conflictingEvents,
        isTapCategory,
        narasiPenayangan: isTapCategory
          ? buildNarasiPenayanganTap({
              dateEvent: draft.extractedData.dateEvent,
              timeEvent: draft.extractedData.timeEvent,
              placeEvent: draft.extractedData.placeEvent,
            })
          : undefined,
      };
    } catch (err: any) {
      console.error('Database error saving surat:', err);
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
      const perihal = cleanHtml(letter.note) || letter.subject || '';
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
