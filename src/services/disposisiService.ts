import fs from 'fs';
import path from 'path';
import { Prisma } from '@prisma/client';
import { prisma } from '../database/prisma';
import { ENV } from '../config/env';
import { suratService, NormalizedSurat } from './suratService';
import { DisposisiDraftData } from './sessionService';
import { pdfService } from './pdfService';
import {
  generateDispositionFileName,
  getDispositionFileUrl,
  formatEventTitleFromDisposition,
  resolvePejabatDitunjuk,
} from '../utils/textHelper';
import { parseIndonesianDateToDate } from '../utils/dateHelper';
import {
  matchPositionsList,
  matchActionsList,
  ActionCandidate,
} from '../utils/dispositionMatcher';

export interface SaveDisposisiResult {
  success: boolean;
  message?: string;
  dispositionId?: number;
  fileName?: string;
  fileUrl?: string | null;
  nomorAgenda?: string;
  perihal?: string;
  isUpdate?: boolean;
  eventUpdated?: boolean;
  eventStatusText?: string;
  eventTitleText?: string;
}

export class DisposisiService {
  /**
   * Mencari status disposisi berdasarkan nomor agenda atau nomor surat di database PostgreSQL
   */
  public async findDisposisiByKeyword(keyword: string): Promise<NormalizedSurat | null> {
    const clean = keyword.trim();
    if (!clean) return null;

    // Cari exact match atau insensitive match pada agenda_number atau number_or_date
    const letter = await prisma.letters.findFirst({
      where: {
        deleted_at: null,
        OR: [
          { agenda_number: { equals: clean, mode: 'insensitive' } },
          { number_or_date: { equals: clean, mode: 'insensitive' } },
          { agenda_number: { contains: clean, mode: 'insensitive' } },
          { number_or_date: { contains: clean, mode: 'insensitive' } },
        ],
      },
      orderBy: { id: 'desc' },
    });

    if (!letter) return null;

    return suratService.getDetailSurat(Number(letter.id));
  }

  /**
   * Mencari surat induk di tabel letters berdasarkan Nomor Agenda atau Nomor Surat
   */
  public async findLetterByAgenda(agendaOrNumber: string): Promise<any | null> {
    const clean = agendaOrNumber.trim();
    if (!clean || clean === '-') return null;

    // 1. Coba exact match dulu
    let letter = await prisma.letters.findFirst({
      where: {
        deleted_at: null,
        OR: [
          { agenda_number: { equals: clean, mode: 'insensitive' } },
          { number_or_date: { equals: clean, mode: 'insensitive' } },
        ],
      },
      orderBy: { id: 'desc' },
    });

    if (letter) return letter;

    // 2. Coba contains match
    letter = await prisma.letters.findFirst({
      where: {
        deleted_at: null,
        OR: [
          { agenda_number: { contains: clean, mode: 'insensitive' } },
          { number_or_date: { contains: clean, mode: 'insensitive' } },
        ],
      },
      orderBy: { id: 'desc' },
    });

    return letter;
  }

  /**
   * Mencari data disposisi yang sudah ada untuk letter_id tertentu
   */
  public async findExistingDispositionByLetterId(letterId: number | bigint): Promise<any | null> {
    try {
      return await prisma.dispositions.findFirst({
        where: {
          letter_id: BigInt(letterId),
          deleted_at: null,
        },
        orderBy: { id: 'desc' },
      });
    } catch (err) {
      console.warn('[DisposisiService] Gagal memeriksa data disposisi eksisting:', err);
      return null;
    }
  }

  /**
   * Menyimpan draft lembar disposisi baru secara transaksional ke database
   */
  public async saveDisposisiDraft(
    draft: DisposisiDraftData,
    userId: number,
    userName?: string
  ): Promise<SaveDisposisiResult> {
    if (!draft.extractedData || !draft.matchedLetter || !draft.tempFilePath) {
      return {
        success: false,
        message: 'Data draft lembar disposisi belum lengkap atau belum terhubung dengan surat masuk.',
      };
    }

    try {
      // 1. Dapatkan nama file surat induk dari tabel letters
      let letterFileName = draft.matchedLetter.file;
      if (!letterFileName) {
        try {
          const letterRecord = await prisma.letters.findUnique({
            where: { id: BigInt(draft.matchedLetter.id) },
            select: { file: true },
          });
          if (letterRecord?.file) {
            letterFileName = letterRecord.file;
          }
        } catch (fetchErr) {
          console.warn('[DisposisiService] Gagal mengambil kolom file dari surat induk:', fetchErr);
        }
      }

      // 2. Tentukan nama berkas final sesuai standar Laravel / database: {timestamp}_{uniqid}.pdf
      const baseFinalName =
        draft.finalFileName || generateDispositionFileName(draft.tempFileName || draft.tempFilePath);
      const targetPdfName = baseFinalName.replace(/\.[^.]+$/, '') + '.pdf';

      // 3. Gabungkan lembar disposisi (halaman 1) dengan berkas surat masuk (halaman 2 dst)
      const mergeResult = await pdfService.mergeDispositionWithLetterPdf(
        draft.tempFilePath,
        letterFileName,
        targetPdfName
      );

      const finalFileName = mergeResult.finalFileName;
      draft.tempFilePath = mergeResult.targetPath;
      draft.finalFileName = finalFileName;

      // 3. Parse tanggal disposisi
      let parsedDate: Date | null = parseIndonesianDateToDate(draft.extractedData.tanggalDisposisi);
      if (!parsedDate && draft.extractedData.tanggalDisposisi) {
        const parsed = new Date(draft.extractedData.tanggalDisposisi);
        if (!isNaN(parsed.getTime())) {
          parsedDate = parsed;
        }
      }
      if (!parsedDate) {
        parsedDate = new Date();
      }

      // Catatan disposisi gabungan dari instruksi dan catatan khusus
      const cleanNote =
        draft.extractedData.catatan && draft.extractedData.catatan !== '-'
          ? draft.extractedData.catatan
          : (draft.extractedData.arahanDisposisi && draft.extractedData.arahanDisposisi.length > 0
              ? draft.extractedData.arahanDisposisi.join(', ')
              : 'Disposisi Pimpinan');

      // 4. Periksa apakah surat ini sudah memiliki disposisi di database (nomor agenda yang sama)
      const existingDisp =
        (draft.existingDispositionId
          ? await prisma.dispositions.findUnique({ where: { id: BigInt(draft.existingDispositionId) } })
          : null) ||
        (await this.findExistingDispositionByLetterId(draft.matchedLetter.id));

      let disp: any;
      let isUpdate = false;

      if (existingDisp) {
        // UPDATE record disposisi yang sudah ada
        disp = await prisma.dispositions.update({
          where: { id: existingDisp.id },
          data: {
            date: parsedDate,
            note: cleanNote,
            file: finalFileName,
            send_by: draft.extractedData.pemberiDisposisi || 'Menteri Ketenagakerjaan',
            updated_by: userName || 'Petugas Protokol',
            updated_at: new Date(),
          },
        });
        isUpdate = true;
        console.log(`[DisposisiService] Berhasil memperbarui data disposisi ID: ${disp.id} untuk nomor agenda: ${draft.matchedLetter.agendaNumber || draft.extractedData.nomorAgenda}`);

        // Bersihkan berkas fisik disposisi lama jika berbeda nama
        if (existingDisp.file && existingDisp.file !== finalFileName) {
          try {
            const oldFilePath = path.join(ENV.DISPOSITION_STORAGE_PATH, existingDisp.file);
            if (fs.existsSync(oldFilePath)) {
              fs.unlinkSync(oldFilePath);
              console.log(`[DisposisiService] Berkas disposisi lama (${existingDisp.file}) berhasil dibersihkan dari storage.`);
            }
          } catch (cleanErr) {
            console.warn('[DisposisiService] Gagal membersihkan berkas disposisi lama:', cleanErr);
          }
        }

        // Hapus relasi posisi & tindakan lama agar disinkronkan dengan data terbaru
        try {
          await prisma.disposition_positions.deleteMany({
            where: { disposition_id: disp.id },
          });
          await prisma.disposition_actions.deleteMany({
            where: { disposition_id: disp.id },
          });
        } catch (delRelErr) {
          console.warn('[DisposisiService] Gagal mereset relasi lama posisi/tindakan:', delRelErr);
        }
      } else {
        // INSERT disposisi baru jika belum pernah ada
        disp = await prisma.dispositions.create({
          data: {
            letter_id: BigInt(draft.matchedLetter.id),
            date: parsedDate,
            note: cleanNote,
            file: finalFileName,
            send_by: draft.extractedData.pemberiDisposisi || 'Menteri Ketenagakerjaan',
            created_by: userName || 'Petugas Protokol',
            created_at: new Date(),
            updated_at: new Date(),
          },
        });
        console.log(`[DisposisiService] Berhasil membuat data disposisi baru ID: ${disp.id} untuk nomor agenda: ${draft.matchedLetter.agendaNumber || draft.extractedData.nomorAgenda}`);
      }

      // 5. Hubungkan ke disposition_positions jika ada jabatan yang cocok
      if (draft.extractedData.diteruskanKepada && draft.extractedData.diteruskanKepada.length > 0) {
        try {
          const allPositions = await prisma.positions.findMany({
            where: { deleted_at: null },
            select: { id: true, name: true, alias: true },
          });

          const matchedPositions = matchPositionsList(draft.extractedData.diteruskanKepada, allPositions);

          for (const pos of matchedPositions) {
            await prisma.disposition_positions.create({
              data: {
                disposition_id: disp.id,
                position_id: BigInt(pos.id),
                note: '',
                created_by: userName || 'Petugas Protokol',
                created_at: new Date(),
                updated_at: new Date(),
              },
            });
            console.log(`[DisposisiService] Berhasil menautkan jabatan: "${pos.name}" (ID: ${pos.id}) ke disposisi ID: ${disp.id}`);
          }
        } catch (posErr) {
          console.warn('[DisposisiService] Gagal memetakan disposition_positions:', posErr);
        }
      }

      // 6. Hubungkan ke disposition_actions jika ada tindakan yang cocok
      let matchedActions: ActionCandidate[] = [];
      if (draft.extractedData.arahanDisposisi && draft.extractedData.arahanDisposisi.length > 0) {
        try {
          const allActions = await prisma.actions.findMany({
            where: { deleted_at: null },
            select: { id: true, name: true },
          });

          matchedActions = matchActionsList(draft.extractedData.arahanDisposisi, allActions);

          for (const act of matchedActions) {
            await prisma.disposition_actions.create({
              data: {
                disposition_id: disp.id,
                action_id: BigInt(act.id),
                note: '',
                created_by: userName || 'Petugas Protokol',
                created_at: new Date(),
                updated_at: new Date(),
              },
            });
            console.log(`[DisposisiService] Berhasil menautkan arahan: "${act.name}" (ID: ${act.id}) ke disposisi ID: ${disp.id}`);
          }
        } catch (actErr) {
          console.warn('[DisposisiService] Gagal memetakan disposition_actions:', actErr);
        }
      }

      // Deteksi instruksi arahan pimpinan: Agendakan/Acarakan vs Mewakili Menteri
      const rawArahanText = (
        Array.isArray(draft.extractedData.arahanDisposisi)
          ? draft.extractedData.arahanDisposisi.join(' ')
          : (draft.extractedData.arahanDisposisi || '')
      ).toLowerCase();

      const isMewakili =
        matchedActions.some((a) => Number(a.id) === 18 || /mewakili|wakili/i.test(a.name)) ||
        /\b(mewakili|wakili|perwakilan)\b/i.test(rawArahanText);

      const isAgendakan =
        !isMewakili &&
        (matchedActions.some((a) => Number(a.id) === 16 || Number(a.id) === 10 || /agendakan|acarakan/i.test(a.name)) ||
         /\b(agendakan|acarakan|jadwalkan|acara)\b/i.test(rawArahanText));

      // 7. Update status pada tabel letters
      const letterUpdatePayload: Prisma.lettersUpdateInput = {
        disposition_printed_at: new Date(),
        updated_at: new Date(),
        updated_by: userName || 'Petugas Protokol',
      };
      if (isMewakili) {
        letterUpdatePayload.status = 2; // 2: diwakilkan
      } else if (isAgendakan) {
        letterUpdatePayload.status = 1; // 1: normal
      }

      await prisma.letters.update({
        where: { id: BigInt(draft.matchedLetter.id) },
        data: letterUpdatePayload,
      });

      // 8. Hubungkan disposition_id ke tabel events dan event_letters,
      // serta perbarui status dan judul jadwal kegiatan di database sesuai arahan pimpinan
      let eventUpdated = false;
      let eventStatusText: string | undefined = undefined;
      let eventTitleText: string | undefined = undefined;

      try {
        const linkedEvents = await prisma.events.findMany({
          where: {
            letter_id: BigInt(draft.matchedLetter.id),
            deleted_at: null,
          },
        });

        const pivotEntries = await prisma.event_letters.findMany({
          where: {
            letter_id: draft.matchedLetter.id.toString(),
            deleted_at: null,
          },
        });

        const pivotEventIds = pivotEntries
          .map((p) => {
            try {
              return BigInt(p.event_id.toString());
            } catch {
              return null;
            }
          })
          .filter((id): id is bigint => id !== null);

        const allEventIds = Array.from(
          new Set([...linkedEvents.map((e) => e.id), ...pivotEventIds])
        );

        const targetOfficial = resolvePejabatDitunjuk(draft.extractedData.diteruskanKepada);

        for (const evId of allEventIds) {
          const ev = await prisma.events.findUnique({ where: { id: evId } });
          if (!ev || ev.deleted_at !== null) continue;

          const baseTitle =
            ev.title ||
            draft.matchedLetter.subject ||
            draft.matchedLetter.perihal ||
            draft.extractedData.perihal ||
            'Agenda Kegiatan Protokol';

          const eventPayload: Prisma.eventsUpdateInput = {
            disposition_id: disp.id,
            updated_at: new Date(),
            updated_by: userName || 'Petugas Protokol',
          };

          if (isMewakili) {
            eventPayload.status = 3n; // 3: Diwakilkan
            eventPayload.title = formatEventTitleFromDisposition(baseTitle, 'diwakilkan', targetOfficial);
            eventUpdated = true;
            eventStatusText = 'Diwakilkan';
            eventTitleText = eventPayload.title as string;
            console.log(
              `[DisposisiService] Berhasil memperbarui event ID ${ev.id}: status -> 3 (Diwakilkan), title -> "${eventPayload.title}"`
            );
          } else if (isAgendakan) {
            eventPayload.status = 1n; // 1: onschedule (Diagendakan)
            eventPayload.title = formatEventTitleFromDisposition(baseTitle, 'agendakan');
            eventUpdated = true;
            eventStatusText = 'onschedule';
            eventTitleText = eventPayload.title as string;
            console.log(
              `[DisposisiService] Berhasil memperbarui event ID ${ev.id}: status -> 1 (onschedule), title -> "${eventPayload.title}"`
            );
          }

          await prisma.events.update({
            where: { id: ev.id },
            data: eventPayload,
          });
        }

        await prisma.event_letters.updateMany({
          where: {
            letter_id: draft.matchedLetter.id.toString(),
            deleted_at: null,
          },
          data: {
            disposition_id: disp.id,
            updated_at: new Date(),
            updated_by: userName || 'Petugas Protokol',
          },
        });
      } catch (evLinkErr) {
        console.warn('[DisposisiService] Peringatan saat memperbarui events/event_letters:', evLinkErr);
      }

      return {
        success: true,
        dispositionId: Number(disp.id),
        fileName: finalFileName,
        fileUrl: getDispositionFileUrl(finalFileName),
        nomorAgenda: draft.matchedLetter.agendaNumber || draft.extractedData.nomorAgenda,
        perihal: draft.matchedLetter.subject || draft.matchedLetter.perihal || draft.extractedData.perihal,
        isUpdate,
        eventUpdated,
        eventStatusText,
        eventTitleText,
      };
    } catch (err: any) {
      console.error('[DisposisiService] Gagal menyimpan data disposisi:', err);
      return {
        success: false,
        message: err.message || 'Terjadi kesalahan sistem saat menyimpan disposisi.',
      };
    }
  }
}

export const disposisiService = new DisposisiService();
