import { prisma } from '../database/prisma';
import { suratService, NormalizedSurat } from './suratService';
import { DisposisiDraftData } from './sessionService';
import { pdfService } from './pdfService';
import { generateDispositionFileName, getDispositionFileUrl } from '../utils/textHelper';
import { parseIndonesianDateToDate } from '../utils/dateHelper';

export interface SaveDisposisiResult {
  success: boolean;
  message?: string;
  dispositionId?: number;
  fileName?: string;
  fileUrl?: string | null;
  nomorAgenda?: string;
  perihal?: string;
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

      // 4. Insert ke tabel dispositions
      const disp = await prisma.dispositions.create({
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

      // 5. Hubungkan ke disposition_positions jika ada jabatan yang cocok
      if (draft.extractedData.diteruskanKepada && draft.extractedData.diteruskanKepada.length > 0) {
        try {
          const allPositions = await prisma.positions.findMany({
            where: { deleted_at: null },
          });

          for (const posName of draft.extractedData.diteruskanKepada) {
            const cleanTarget = posName.toLowerCase().replace(/[^a-z0-9]/g, '');
            if (!cleanTarget) continue;

            const matched = allPositions.find((p) => {
              const pName = p.name.toLowerCase().replace(/[^a-z0-9]/g, '');
              const pAlias = (p.alias || '').toLowerCase().replace(/[^a-z0-9]/g, '');
              return (
                pName.includes(cleanTarget) ||
                cleanTarget.includes(pName) ||
                (pAlias && (pAlias.includes(cleanTarget) || cleanTarget.includes(pAlias)))
              );
            });

            if (matched) {
              await prisma.disposition_positions.create({
                data: {
                  disposition_id: disp.id,
                  position_id: matched.id,
                  note: '',
                  created_by: userName || 'Petugas Protokol',
                  created_at: new Date(),
                  updated_at: new Date(),
                },
              });
            }
          }
        } catch (posErr) {
          console.warn('[DisposisiService] Gagal memetakan disposition_positions:', posErr);
        }
      }

      // 6. Hubungkan ke disposition_actions jika ada tindakan yang cocok
      if (draft.extractedData.arahanDisposisi && draft.extractedData.arahanDisposisi.length > 0) {
        try {
          const allActions = await prisma.actions.findMany({
            where: { deleted_at: null },
          });

          for (const actName of draft.extractedData.arahanDisposisi) {
            const cleanTarget = actName.toLowerCase().replace(/[^a-z0-9]/g, '');
            if (!cleanTarget) continue;

            const matched = allActions.find((a) => {
              const aName = a.name.toLowerCase().replace(/[^a-z0-9]/g, '');
              return aName.includes(cleanTarget) || cleanTarget.includes(aName);
            });

            if (matched) {
              await prisma.disposition_actions.create({
                data: {
                  disposition_id: disp.id,
                  action_id: matched.id,
                  note: '',
                  created_by: userName || 'Petugas Protokol',
                  created_at: new Date(),
                  updated_at: new Date(),
                },
              });
            }
          }
        } catch (actErr) {
          console.warn('[DisposisiService] Gagal memetakan disposition_actions:', actErr);
        }
      }

      // 7. Update status pada tabel letters
      await prisma.letters.update({
        where: { id: BigInt(draft.matchedLetter.id) },
        data: {
          disposition_printed_at: new Date(),
          updated_at: new Date(),
          updated_by: userName || 'Petugas Protokol',
        },
      });

      // 8. Hubungkan disposition_id ke tabel events jika kegiatan sudah ada
      try {
        await prisma.events.updateMany({
          where: {
            letter_id: BigInt(draft.matchedLetter.id),
            deleted_at: null,
          },
          data: {
            disposition_id: disp.id,
            updated_at: new Date(),
            updated_by: userName || 'Petugas Protokol',
          },
        });
      } catch (evLinkErr) {
        console.warn('[DisposisiService] Peringatan saat menautkan disposition_id ke events:', evLinkErr);
      }

      return {
        success: true,
        dispositionId: Number(disp.id),
        fileName: finalFileName,
        fileUrl: getDispositionFileUrl(finalFileName),
        nomorAgenda: draft.matchedLetter.agendaNumber || draft.extractedData.nomorAgenda,
        perihal: draft.matchedLetter.subject || draft.matchedLetter.perihal || draft.extractedData.perihal,
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
