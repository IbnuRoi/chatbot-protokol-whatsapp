import { prisma } from '../database/prisma';
import { Prisma } from '@prisma/client';
import { cleanHtml } from '../utils/textHelper';
import { expandSearchTermsWithAcronyms, calculateRelevanceScore } from '../utils/acronymHelper';
import { formatTanggalIndo, formatWaktuDisplay } from '../utils/dateHelper';

export { formatTanggalIndo, formatWaktuDisplay };

export interface NormalizedJadwal {
  id: number;
  namaKegiatan: string;
  tanggalKegiatan: string; // Format YYYY-MM-DD
  waktuMulai: string; // Format HH:mm
  waktuSelesai: string | null; // Format HH:mm
  lokasi: string;
  pejabatHadir: string;
  pic: string;
  statusDisposisi?: string;
  statusDisposisiCode?: number | null;
  surat?: {
    nomorAgenda: string;
    nomorSurat: string;
    fileName?: string | null;
  } | null;
}

/**
 * Memformat status disposisi/kegiatan protokol dari kolom events.status ke representasi bahasa Indonesia
 * Sesuai dokumentasi tabel events:
 * 1 : onschedule (Terjadwal / On Schedule)
 * 2 : reschedule (Dijadwalkan Ulang / Reschedule)
 * 3 : izinkan (Diizinkan / Disetujui)
 * 4 : cancel (Dibatalkan / Cancel)
 * 5 : selesai / terlaksana
 * 6 : ditolak
 */
export function formatStatusDisposisi(status: number | bigint | null | undefined): string {
  if (status === null || status === undefined) {
    return 'Belum Ditentukan';
  }
  const code = Number(status);
  switch (code) {
    case 1:
      return 'Terjadwal (On Schedule)';
    case 2:
      return 'Dijadwalkan Ulang (Reschedule)';
    case 3:
      return 'Diizinkan / Disetujui';
    case 4:
      return 'Dibatalkan (Cancel)';
    case 5:
      return 'Selesai / Terlaksana';
    case 6:
      return 'Ditolak';
    default:
      return `Status ${code}`;
  }
}


export interface JadwalSearchOptions {
  limit?: number;
  startDate?: Date;
  endDate?: Date;
  location?: string;
}

export class JadwalService {
  /**
   * Mengembalikan rentang waktu query basis data untuk tanggal tertentu (offset hari dari hari ini)
   * Catatan Database: Kolom events.event_time_start di PostgreSQL tersimpan dengan pergeseran +7 jam
   * (misal jam 08:00 WIB tersimpan sebagai 15:00:00 UTC).
   * Oleh karena itu, 00:00:00 WIB tersimpan sebagai 07:00:00 UTC pada hari berjalan,
   * dan 23:59:59.999 WIB tersimpan sebagai 06:59:59.999 UTC pada keesokan harinya.
   */
  public getWibDayRange(daysOffset: number = 0) {
    const now = new Date();
    // Offset waktu ke WIB (UTC+7)
    const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
    const wibMs = utcMs + 7 * 3600000;
    const wibDate = new Date(wibMs);
    wibDate.setDate(wibDate.getDate() + daysOffset);

    const y = wibDate.getFullYear();
    const m = wibDate.getMonth();
    const d = wibDate.getDate();

    // 00:00:00 WIB tersimpan di DB sebagai 07:00:00 UTC hari yang sama
    const startOfDay = new Date(Date.UTC(y, m, d, 7, 0, 0, 0));
    // 23:59:59 WIB tersimpan di DB sebagai 06:59:59.999 UTC hari berikutnya
    const endOfDay = new Date(Date.UTC(y, m, d + 1, 6, 59, 59, 999));
    const dateStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

    return { startOfDay, endOfDay, dateStr, year: y, month: m + 1, day: d };
  }

  /**
   * Mengembalikan rentang waktu query basis data untuk tanggal tertentu (YYYY-MM-DD atau Date)
   */
  public getWibRangeForDate(dateInput: string | Date) {
    let y: number;
    let m: number;
    let d: number;

    if (typeof dateInput === 'string') {
      const parts = dateInput.trim().split('-');
      if (parts.length === 3) {
        y = parseInt(parts[0], 10);
        m = parseInt(parts[1], 10) - 1;
        d = parseInt(parts[2], 10);
      } else {
        const parsed = new Date(dateInput);
        y = parsed.getFullYear();
        m = parsed.getMonth();
        d = parsed.getDate();
      }
    } else {
      y = dateInput.getFullYear();
      m = dateInput.getMonth();
      d = dateInput.getDate();
    }

    // 00:00:00 WIB tersimpan di DB sebagai 07:00:00 UTC hari yang sama
    const startOfDay = new Date(Date.UTC(y, m, d, 7, 0, 0, 0));
    // 23:59:59 WIB tersimpan di DB sebagai 06:59:59.999 UTC hari berikutnya
    const endOfDay = new Date(Date.UTC(y, m, d + 1, 6, 59, 59, 999));
    const dateStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

    return { startOfDay, endOfDay, dateStr, year: y, month: m + 1, day: d };
  }

  /**
   * Mengambil jadwal kegiatan pada tanggal tertentu (WIB) dari tabel events
   */
  public async getJadwalByDate(dateInput: string | Date): Promise<{ items: NormalizedJadwal[]; formattedDate: string; dateStr: string }> {
    const { startOfDay, endOfDay, dateStr } = this.getWibRangeForDate(dateInput);
    const formattedDate = formatTanggalIndo(dateStr, true);

    const events = await prisma.events.findMany({
      where: {
        deleted_at: null,
        event_time_start: {
          gte: startOfDay,
          lte: endOfDay,
        },
      },
      orderBy: {
        event_time_start: 'asc',
      },
      take: 30,
    });

    const items = await this.enrichAndMapEvents(events);

    return {
      items,
      formattedDate,
      dateStr,
    };
  }

  /**
   * Mengambil jadwal kegiatan untuk rentang hari ke depan (misal: 2 hari, 3 hari, 5 hari, 7 hari/seminggu, 14 hari/dua minggu)
   */
  public async getJadwalRentangHari(
    daysCount: number,
    labelText?: string
  ): Promise<{
    items: NormalizedJadwal[];
    formattedRange: string;
    label: string;
    startDateStr: string;
    endDateStr: string;
  }> {
    const todayRange = this.getWibDayRange(0);
    const endRange = this.getWibDayRange(daysCount);

    const startDateStr = todayRange.dateStr;
    const endDateStr = endRange.dateStr;

    const formattedStart = formatTanggalIndo(startDateStr, true);
    const formattedEnd = formatTanggalIndo(endDateStr, true);
    const formattedRange = `${formattedStart} s.d. ${formattedEnd}`;

    const label = labelText || `${daysCount} Hari ke Depan`;

    const events = await prisma.events.findMany({
      where: {
        deleted_at: null,
        event_time_start: {
          gte: todayRange.startOfDay,
          lte: endRange.endOfDay,
        },
      },
      orderBy: {
        event_time_start: 'asc',
      },
      take: 50,
    });

    const items = await this.enrichAndMapEvents(events);

    return {
      items,
      formattedRange,
      label,
      startDateStr,
      endDateStr,
    };
  }


  public getTodayString(): string {
    return this.getWibDayRange(0).dateStr;
  }

  public getTomorrowString(): string {
    return this.getWibDayRange(1).dateStr;
  }

  /**
   * Memperkaya daftar event dengan data dari tabel letters dan memetakannya ke NormalizedJadwal
   */
  private async enrichAndMapEvents(events: any[]): Promise<NormalizedJadwal[]> {
    if (!events || events.length === 0) return [];

    const letterIds = events
      .map((e) => e.letter_id)
      .filter((id): id is bigint => id !== null && id !== undefined);

    const letterMap = new Map<string, any>();
    if (letterIds.length > 0) {
      const letters = await prisma.letters.findMany({
        where: { id: { in: letterIds } },
        select: {
          id: true,
          agenda_number: true,
          number_or_date: true,
          file: true,
          date_event: true,
          time_event: true,
          time_event_finish: true,
          place_event: true,
          subject: true,
        },
      });
      for (const l of letters) {
        letterMap.set(l.id.toString(), l);
      }
    }

    return events.map((e) => this.mapEventToJadwal(e, e.letter_id ? letterMap.get(e.letter_id.toString()) : null));
  }

  /**
   * Mengonversi baris tabel events PostgreSQL DB ke interface NormalizedJadwal
   */
  private mapEventToJadwal(event: any, letter?: any | null): NormalizedJadwal {
    let tglKegiatan = '';
    let waktuMulai = '09:00';
    let waktuSelesai: string | null = null;
    let lokasi = cleanHtml(event.location) || 'Gedung Kemnaker RI, Jakarta';

    let hasRescheduledDate = false;
    if (event.event_time_start) {
      // Nilai timestamp di DB adalah (WIB + 7 jam), sehingga kurangi 7 jam untuk kembali ke waktu riil WIB
      const realWibMs = event.event_time_start.getTime() - 7 * 3600000;
      const realWibDate = new Date(realWibMs);
      const y = realWibDate.getUTCFullYear();
      const m = String(realWibDate.getUTCMonth() + 1).padStart(2, '0');
      const d = String(realWibDate.getUTCDate()).padStart(2, '0');
      tglKegiatan = `${y}-${m}-${d}`;

      const hh = String(realWibDate.getUTCHours()).padStart(2, '0');
      const mm = String(realWibDate.getUTCMinutes()).padStart(2, '0');
      waktuMulai = `${hh}:${mm}`;

      if (event.event_time_finish) {
        const finishWibMs = event.event_time_finish.getTime() - 7 * 3600000;
        const finishWibDate = new Date(finishWibMs);
        const fHh = String(finishWibDate.getUTCHours()).padStart(2, '0');
        const fMm = String(finishWibDate.getUTCMinutes()).padStart(2, '0');
        waktuSelesai = `${fHh}:${fMm}`;
      }

      if (letter && letter.date_event) {
        const letterDateStr = letter.date_event.toISOString().slice(0, 10);
        if (letterDateStr !== tglKegiatan) {
          hasRescheduledDate = true;
        }
      }
    }

    if (letter) {
      // Jika surat memiliki data waktu resmi dan event tidak di-reschedule ke tanggal lain
      if (!hasRescheduledDate && letter.date_event) {
        const dt = new Date(letter.date_event);
        const y = dt.getUTCFullYear();
        const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
        const d = String(dt.getUTCDate()).padStart(2, '0');
        tglKegiatan = `${y}-${m}-${d}`;
      }

      if (letter.time_event) {
        const hh = String(letter.time_event.getUTCHours()).padStart(2, '0');
        const mm = String(letter.time_event.getUTCMinutes()).padStart(2, '0');
        waktuMulai = `${hh}:${mm}`;
      }
      if (letter.time_event_finish) {
        const hh = String(letter.time_event_finish.getUTCHours()).padStart(2, '0');
        const mm = String(letter.time_event_finish.getUTCMinutes()).padStart(2, '0');
        waktuSelesai = `${hh}:${mm}`;
      }
      if (letter.place_event && (!event.location || event.location === 'Gedung Kemnaker RI, Jakarta')) {
        lokasi = cleanHtml(letter.place_event);
      }
    }

    const cleanTitle = cleanHtml(event.title) || 'Agenda Kegiatan Protokol';
    const picInfo = event.pic_name || event.pic_phonenumber || '-';

    const letterInfo = letter
      ? {
          nomorAgenda: letter.agenda_number,
          nomorSurat: letter.number_or_date || '-',
          fileName: letter.file || null,
        }
      : null;

    const statusDisposisi = formatStatusDisposisi(event.status);
    const statusDisposisiCode = event.status !== null && event.status !== undefined ? Number(event.status) : null;

    return {
      id: Number(event.id),
      namaKegiatan: cleanTitle,
      tanggalKegiatan: tglKegiatan || this.getTodayString(),
      waktuMulai,
      waktuSelesai,
      lokasi: lokasi || 'Gedung Kemnaker RI, Jakarta',
      pejabatHadir: '-',
      pic: picInfo,
      statusDisposisi,
      statusDisposisiCode,
      surat: letterInfo,
    };
  }

  /**
   * Mengambil jadwal kegiatan besok (H+1) dari tabel events
   */
  public async getJadwalBesok(): Promise<NormalizedJadwal[]> {
    const { startOfDay, endOfDay } = this.getWibDayRange(1);

    const events = await prisma.events.findMany({
      where: {
        deleted_at: null,
        event_time_start: {
          gte: startOfDay,
          lte: endOfDay,
        },
      },
      orderBy: {
        event_time_start: 'asc',
      },
      take: 20,
    });

    return this.enrichAndMapEvents(events);
  }

  /**
   * Mengambil jadwal kegiatan hari ini dari tabel events
   */
  public async getJadwalHariIni(onlyUpcoming: boolean = false): Promise<NormalizedJadwal[]> {
    const { startOfDay, endOfDay } = this.getWibDayRange(0);
    const now = new Date();
    // Nilai timestamp di DB adalah (WIB + 7 jam), sehingga posisi sekarang dalam skala DB:
    const dbNow = new Date(now.getTime() + 7 * 3600000);

    const events = await prisma.events.findMany({
      where: {
        deleted_at: null,
        event_time_start: {
          gte: onlyUpcoming ? dbNow : startOfDay,
          lte: endOfDay,
        },
      },
      orderBy: {
        event_time_start: 'asc',
      },
      take: 20,
    });

    return this.enrichAndMapEvents(events);
  }

  /**
   * Mengambil 1 kegiatan terdekat berikutnya hari ini atau di hari-hari mendatang
   */
  public async getJadwalBerikutnyaTerdekat(): Promise<{ item: NormalizedJadwal; isToday: boolean } | null> {
    const now = new Date();
    const dbNow = new Date(now.getTime() + 7 * 3600000);
    const { endOfDay, dateStr } = this.getWibDayRange(0);

    // 1. Cari kegiatan hari ini yang waktu mulainya belum lewat
    const todayUpcoming = await prisma.events.findFirst({
      where: {
        deleted_at: null,
        event_time_start: {
          gte: dbNow,
          lte: endOfDay,
        },
      },
      orderBy: {
        event_time_start: 'asc',
      },
    });

    if (todayUpcoming) {
      const items = await this.enrichAndMapEvents([todayUpcoming]);
      return { item: items[0], isToday: true };
    }

    // 2. Jika hari ini sudah selesai semua, cari kegiatan terdekat di masa depan
    const nextEvent = await prisma.events.findFirst({
      where: {
        deleted_at: null,
        event_time_start: {
          gt: endOfDay,
        },
      },
      orderBy: {
        event_time_start: 'asc',
      },
    });

    if (nextEvent) {
      const items = await this.enrichAndMapEvents([nextEvent]);
      return { item: items[0], isToday: items[0].tanggalKegiatan === dateStr };
    }

    // 3. Fallback jika tidak ada event masa depan: ambil event terjadwal terakhir yang tercatat
    const fallbackEvent = await prisma.events.findFirst({
      where: {
        deleted_at: null,
        event_time_start: { not: null },
      },
      orderBy: {
        event_time_start: 'desc',
      },
    });

    if (fallbackEvent) {
      const items = await this.enrichAndMapEvents([fallbackEvent]);
      return { item: items[0], isToday: false };
    }

    return null;
  }

  /**
   * Mengambil daftar jadwal kegiatan beberapa hari ke depan (mendatang)
   */
  public async getJadwalMendatang(limit: number = 10): Promise<NormalizedJadwal[]> {
    const { startOfDay } = this.getWibDayRange(0);

    let events = await prisma.events.findMany({
      where: {
        deleted_at: null,
        event_time_start: {
          gte: startOfDay,
        },
      },
      orderBy: {
        event_time_start: 'asc',
      },
      take: limit,
    });

    // Jika database tidak memiliki agenda mendatang dari hari ini, tampilkan agenda terbaru
    if (events.length === 0) {
      events = await prisma.events.findMany({
        where: {
          deleted_at: null,
          event_time_start: { not: null },
        },
        orderBy: {
          event_time_start: 'desc',
        },
        take: limit,
      });
    }

    return this.enrichAndMapEvents(events);
  }

  /**
   * Menghitung bobot relevansi temporal (kedekatan dengan hari ini) untuk agenda kegiatan
   * - Agenda hari ini & mendatang (aktif): prioritas tertinggi (+30 s.d. +120 poin)
   * - Agenda lampau baru-baru ini (pekan ini / bulan ini): penalti ringan (-15 s.d. +10 poin)
   * - Agenda lampau berbulan-bulan / bertahun-tahun lalu: penalti bertingkat (-45 s.d. -180 poin)
   */
  public calculateJadwalTimeBonus(eventDate: Date | null | undefined): number {
    if (!eventDate) return -150;

    const now = new Date();
    // Konversi hari ini ke awal hari WIB (00:00:00 UTC+7)
    const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
    const wibMs = utcMs + 7 * 3600000;
    const wibToday = new Date(wibMs);
    wibToday.setHours(0, 0, 0, 0);

    // Waktu event dalam WIB
    const evDateObj = new Date(eventDate);
    const evUtc = evDateObj.getTime() + evDateObj.getTimezoneOffset() * 60000;
    const evWib = new Date(evUtc + 7 * 3600000);

    const diffDays = (evWib.getTime() - wibToday.getTime()) / (1000 * 60 * 60 * 24);

    if (diffDays >= 0) {
      // Agenda Hari Ini atau Mendatang (Prioritas Utama)
      if (diffDays < 1) return 120; // Hari ini
      if (diffDays <= 7) return 100 - diffDays * 2; // Pekan ini (86 - 98)
      if (diffDays <= 30) return 80 - (diffDays - 7) * 1.2; // Bulan ini (52 - 80)
      return Math.max(25, 50 - (diffDays - 30) * 0.5); // Mendatang > 30 hari
    } else {
      // Agenda Lampau
      const daysAgo = Math.abs(diffDays);
      if (daysAgo <= 7) return 10; // Baru lewat pekan ini
      if (daysAgo <= 30) return -15; // Bulan berjalan
      if (daysAgo <= 60) return -45; // 1-2 bulan lalu
      if (daysAgo <= 90) return -80; // 2-3 bulan lalu
      return Math.max(-180, -80 - (daysAgo - 90) * 0.5); // Sangat lampau
    }
  }

  /**
   * Mencari jadwal kegiatan secara cerdas dan relevan dengan memprioritaskan agenda terkini & terdekat dari hari ini
   * Mendukung pencarian multi-dimensi: judul kegiatan, lokasi, PIC, surat bertaut (pengirim & perihal surat), dan rentang waktu
   */
  public async searchJadwal(
    keyword: string,
    limitOrOptions: number | JadwalSearchOptions = 10
  ): Promise<NormalizedJadwal[]> {
    const clean = keyword.trim().toLowerCase();
    if (!clean) return [];

    const options: JadwalSearchOptions =
      typeof limitOrOptions === 'number' ? { limit: limitOrOptions } : limitOrOptions;
    const limit = options.limit || 10;

    // Filter rentang waktu jika ada
    const dateFilter =
      options.startDate || options.endDate
        ? {
            event_time_start: {
              ...(options.startDate ? { gte: options.startDate } : {}),
              ...(options.endDate ? { lte: options.endDate } : {}),
            },
          }
        : {};

    // 1. Ekspansi cerdas kata kunci dengan akronim & kepanjangannya
    const expansion = expandSearchTermsWithAcronyms(clean);
    const searchTermsArray = expansion.expandedTerms;

    // 1b. Cari ID event yang bertaut dengan surat masuk yang sesuai dengan kata kunci
    const qMode: Prisma.QueryMode = 'insensitive';
    let letterEventIds: bigint[] = [];
    try {
      const matchingLetters = await prisma.letters.findMany({
        where: {
          deleted_at: null,
          OR: searchTermsArray.flatMap((term) => [
            { subject: { contains: term, mode: qMode } },
            { from: { contains: term, mode: qMode } },
            { number_or_date: { contains: term, mode: qMode } },
            { place_event: { contains: term, mode: qMode } },
          ]),
        },
        select: { id: true },
        take: 40,
      });

      const letterIds = matchingLetters.map((l) => l.id);
      if (letterIds.length > 0) {
        const linkedEvents = await prisma.events.findMany({
          where: {
            deleted_at: null,
            letter_id: { in: letterIds },
          },
          select: { id: true },
          take: 40,
        });
        letterEventIds = linkedEvents.map((e) => e.id);
      }
    } catch {
      // Abaikan jika relasi surat belum terisi
    }

    // 2. Ambil kandidat events dengan case-insensitive di PostgreSQL (mengutamakan tanggal terkini)
    let candidates: any[] = [];

    // Jika query terdiri dari 2 kata atau lebih, coba cari dengan klausa AND terlebih dahulu
    if (expansion.meaningfulTokens.length >= 2) {
      candidates = await prisma.events.findMany({
        where: {
          deleted_at: null,
          ...dateFilter,
          AND: expansion.meaningfulTokens.map((tok) => ({
            OR: [
              { title: { contains: tok, mode: qMode } },
              { location: { contains: tok, mode: qMode } },
              { pic_name: { contains: tok, mode: qMode } },
              ...(letterEventIds.length > 0 ? [{ id: { in: letterEventIds } }] : []),
            ],
          })),
        },
        take: 60,
        orderBy: [
          { event_time_start: 'desc' },
          { id: 'desc' },
        ],
      });
    }

    // Jika tidak ditemukan dengan AND atau query hanya 1 kata, cari dengan klausa OR
    if (candidates.length === 0) {
      candidates = await prisma.events.findMany({
        where: {
          deleted_at: null,
          ...dateFilter,
          OR: [
            ...searchTermsArray.flatMap((term) => [
              { title: { contains: term, mode: qMode } },
              { location: { contains: term, mode: qMode } },
              { pic_name: { contains: term, mode: qMode } },
            ]),
            ...(letterEventIds.length > 0 ? [{ id: { in: letterEventIds } }] : []),
          ],
        },
        take: 60,
        orderBy: [
          { event_time_start: 'desc' },
          { id: 'desc' },
        ],
      });
    }

    if (candidates.length === 0) {
      return [];
    }

    // 3. Hitung Relevansi Skor Presisi Tinggi (Spesifisitas Teks + Kedekatan Waktu dengan Hari Ini)
    const enrichedCandidates = await this.enrichAndMapEvents(candidates);

    const scored = candidates.map((e, idx) => {
      const item = enrichedCandidates[idx] || this.mapEventToJadwal(e);
      const title = cleanHtml(e.title);
      const metadata = [
        e.location || '',
        e.pic_name || '',
        item.surat?.nomorSurat || '',
        item.surat?.nomorAgenda || '',
        item.pejabatHadir || '',
      ];

      const relevance = calculateRelevanceScore(expansion, title, metadata);
      const timeBonus = this.calculateJadwalTimeBonus(e.event_time_start);
      const totalScore = relevance.score + timeBonus;

      return {
        item,
        textScore: relevance.score,
        timeBonus,
        totalScore,
        matchedAllSpecific: relevance.matchedAllSpecific,
        specificMatchesCount: relevance.specificMatchesCount,
        eventDate: e.event_time_start ? new Date(e.event_time_start) : null,
      };
    });

    // Urutkan berdasarkan totalScore (gabungan relevansi teks dan kedekatan dengan hari ini)
    scored.sort((a, b) => {
      if (b.totalScore !== a.totalScore) {
        return b.totalScore - a.totalScore;
      }
      const aTime = a.eventDate ? a.eventDate.getTime() : 0;
      const bTime = b.eventDate ? b.eventDate.getTime() : 0;
      return bTime - aTime;
    });

    const topScore = scored[0]?.totalScore || 0;
    if (topScore <= 0) return [];

    let filtered = scored;
    // 4. Dynamic Specificity Filter:
    // Jika pengguna menyertakan singkatan atau entitas spesifik (seperti 'bksti', 'k3', 'sbni', dll.)
    // dan ada agenda yang memuat entitas tersebut, saring keluar agenda lain yang hanya kebetulan memuat kata umum.
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
      .map((s) => s.item);
  }
}

export const jadwalService = new JadwalService();
