import { prisma } from '../database/prisma';
import { suratService, NormalizedSurat } from './suratService';

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
}

export const disposisiService = new DisposisiService();
