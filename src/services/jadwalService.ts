import { prisma } from '../database/prisma';
import { Prisma } from '@prisma/client';
import { cleanHtml, splitPicNameAndPhone, extractEventTitleDetails, formatPicWithWhatsApp } from '../utils/textHelper';
import { expandSearchTermsWithAcronyms, calculateRelevanceScore } from '../utils/acronymHelper';
import { formatTanggalIndo, formatWaktuDisplay, parseIndonesianDateToDate, parseIndonesianTimeToDates, isValidDate } from '../utils/dateHelper';
import { syncTableSequence, isDuplicateKeyError } from '../database/sequenceSync';
import { JadwalArahanDraftData } from './sessionService';

export { formatTanggalIndo, formatWaktuDisplay };

export interface NormalizedJadwal {
  id: number;
  namaKegiatan: string;
  tanggalKegiatan: string; // Format YYYY-MM-DD
  waktuMulai: string; // Format HH:mm
  waktuSelesai: string | null; // Format HH:mm
  lokasi: string;
  pejabatHadir: string;
  pendamping?: string;
  peserta?: string;
  arahan?: string;
  catatan?: string;
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
      return 'Diagendakan';
    case 2:
      return 'Dijadwalkan Ulang (Reschedule)';
    case 3:
      return 'Diwakilkan';
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
  onlyDiagendakan?: boolean;
}

export class JadwalService {
  /**
   * Mengembalikan rentang waktu query basis data untuk tanggal tertentu (offset hari dari hari ini)
   * Kolom events.event_time_start di PostgreSQL menyimpan waktu kegiatan secara langsung.
   * Rentang query mencakup 00:00:00.000 s.d. 23:59:59.999 pada hari tersebut.
   */
  public getWibDayRange(daysOffset: number = 0) {
    const nowWibMs = Date.now() + 7 * 3600000;
    const wibDate = new Date(nowWibMs);
    wibDate.setUTCDate(wibDate.getUTCDate() + daysOffset);

    const y = wibDate.getUTCFullYear();
    const m = wibDate.getUTCMonth();
    const d = wibDate.getUTCDate();

    // 00:00:00 s.d. 23:59:59.999 pada hari tersebut
    const startOfDay = new Date(Date.UTC(y, m, d, 0, 0, 0, 0));
    const endOfDay = new Date(Date.UTC(y, m, d, 23, 59, 59, 999));
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
        y = parsed.getUTCFullYear();
        m = parsed.getUTCMonth();
        d = parsed.getUTCDate();
      }
    } else {
      y = dateInput.getUTCFullYear();
      m = dateInput.getUTCMonth();
      d = dateInput.getUTCDate();
    }

    // 00:00:00 s.d. 23:59:59.999 pada hari tersebut
    const startOfDay = new Date(Date.UTC(y, m, d, 0, 0, 0, 0));
    const endOfDay = new Date(Date.UTC(y, m, d, 23, 59, 59, 999));
    const dateStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

    return { startOfDay, endOfDay, dateStr, year: y, month: m + 1, day: d };
  }

  /**
   * Mengambil jadwal kegiatan pada tanggal tertentu (WIB)
   * Menggabungkan kegiatan dari:
   * 1. Tabel events dengan event_time_start dalam rentang waktu yang sesuai (safe UTC + local boundary)
   * 2. Tabel events yang terhubung dengan surat di mana letters.date_event jatuh pada tanggal ini
   * 3. Tabel letters yang memiliki date_event pada tanggal ini (termasuk yang berstatus belum disposisi / belum dibuatkan event row)
   */
  public async getJadwalByDate(
    dateInput: string | Date,
    options?: { onlyDiagendakan?: boolean }
  ): Promise<{ items: NormalizedJadwal[]; formattedDate: string; dateStr: string }> {
    const { startOfDay, endOfDay, dateStr, year: y, month: m, day: d } = this.getWibRangeForDate(dateInput);
    const formattedDate = formatTanggalIndo(dateStr, true);

    // Rentang safe window UTC + Local:
    // Waktu WIB 00:00 - 23:59 adalah UTC (d-1) 17:00 s.d. (d) 16:59.
    // Jika disimpan tanpa konversi UTC: UTC (d) 00:00 s.d. (d) 23:59.
    // Safe range mencakup (d-1) 17:00:00.000Z s.d. (d) 23:59:59.999Z.
    const safeStart = new Date(Date.UTC(y, m - 1, d - 1, 17, 0, 0, 0));
    const safeEnd = new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999));

    // Rentang tanggal murni untuk kolom letters.date_event (@db.Date)
    const letterDateStart = new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
    const letterDateEnd = new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999));

    // 1. Ambil events berdasarkan event_time_start
    const eventsByTime = await prisma.events.findMany({
      where: {
        deleted_at: null,
        event_time_start: {
          gte: safeStart,
          lte: safeEnd,
        },
        ...(options?.onlyDiagendakan ? { status: 1n } : {}),
      },
      orderBy: [
        { event_time_start: 'asc' },
        { id: 'asc' },
      ],
      take: 50,
    });

    // 2. Ambil letters pada tanggal target
    const lettersOnDate = await prisma.letters.findMany({
      where: {
        deleted_at: null,
        date_event: {
          gte: letterDateStart,
          lte: letterDateEnd,
        },
      },
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
        from: true,
        pic_name: true,
        pic_phone_number: true,
        pic_json: true,
        status: true,
      },
      take: 50,
    });

    const letterIdsOnDate = lettersOnDate.map((l) => l.id);

    // 3. Ambil events yang berelasi dengan letters pada tanggal tersebut
    let eventsByLetter: any[] = [];
    if (letterIdsOnDate.length > 0) {
      eventsByLetter = await prisma.events.findMany({
        where: {
          deleted_at: null,
          letter_id: { in: letterIdsOnDate },
          ...(options?.onlyDiagendakan ? { status: 1n } : {}),
        },
        take: 50,
      });
    }

    // Gabungkan events dan deduplikasi berdasarkan ID event
    const eventMap = new Map<string, any>();
    for (const e of eventsByTime) {
      eventMap.set(e.id.toString(), e);
    }
    for (const e of eventsByLetter) {
      if (!eventMap.has(e.id.toString())) {
        eventMap.set(e.id.toString(), e);
      }
    }

    const mergedEvents = Array.from(eventMap.values());
    const eventLetterIds = new Set<string>();
    mergedEvents.forEach((e) => {
      if (e.letter_id) eventLetterIds.add(e.letter_id.toString());
    });

    // Map events ke NormalizedJadwal
    const normalizedEventItems = await this.enrichAndMapEvents(mergedEvents);

    // 4. Cari surat pada tanggal tersebut yang belum dibuatkan row di tabel events
    const unlinkedLetters = lettersOnDate.filter((l) => !eventLetterIds.has(l.id.toString()));
    const unlinkedLetterItems: NormalizedJadwal[] = unlinkedLetters.map((l) => this.mapLetterToJadwal(l, dateStr));

    // 5. Gabungkan dan filter tanggal agar sesuai dateStr
    const allItems = [...normalizedEventItems, ...unlinkedLetterItems].filter((item) => {
      return item.tanggalKegiatan === dateStr;
    });

    // 6. Urutkan berdasarkan waktuMulai (asc) lalu id (asc)
    allItems.sort((a, b) => {
      const timeCompare = a.waktuMulai.localeCompare(b.waktuMulai);
      if (timeCompare !== 0) return timeCompare;
      return a.id - b.id;
    });

    return {
      items: allItems,
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

    // Rentang safe window UTC + Local
    const safeStart = new Date(Date.UTC(todayRange.year, todayRange.month - 1, todayRange.day - 1, 17, 0, 0, 0));
    const safeEnd = new Date(Date.UTC(endRange.year, endRange.month - 1, endRange.day, 23, 59, 59, 999));

    const eventsByTime = await prisma.events.findMany({
      where: {
        deleted_at: null,
        event_time_start: {
          gte: safeStart,
          lte: safeEnd,
        },
      },
      orderBy: [
        { event_time_start: 'asc' },
        { id: 'asc' },
      ],
      take: 100,
    });

    const lettersInRange = await prisma.letters.findMany({
      where: {
        deleted_at: null,
        date_event: {
          gte: new Date(Date.UTC(todayRange.year, todayRange.month - 1, todayRange.day, 0, 0, 0, 0)),
          lte: new Date(Date.UTC(endRange.year, endRange.month - 1, endRange.day, 23, 59, 59, 999)),
        },
      },
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
        from: true,
        pic_name: true,
        pic_phone_number: true,
        pic_json: true,
        status: true,
      },
      take: 100,
    });

    const letterIdsInRange = lettersInRange.map((l) => l.id);
    let eventsByLetter: any[] = [];
    if (letterIdsInRange.length > 0) {
      eventsByLetter = await prisma.events.findMany({
        where: {
          deleted_at: null,
          letter_id: { in: letterIdsInRange },
        },
        take: 100,
      });
    }

    const eventMap = new Map<string, any>();
    for (const e of eventsByTime) {
      eventMap.set(e.id.toString(), e);
    }
    for (const e of eventsByLetter) {
      if (!eventMap.has(e.id.toString())) {
        eventMap.set(e.id.toString(), e);
      }
    }

    const mergedEvents = Array.from(eventMap.values());
    const eventLetterIds = new Set<string>();
    mergedEvents.forEach((e) => {
      if (e.letter_id) eventLetterIds.add(e.letter_id.toString());
    });

    const normalizedEvents = await this.enrichAndMapEvents(mergedEvents);

    const unlinkedLetters = lettersInRange.filter((l) => !eventLetterIds.has(l.id.toString()));
    const unlinkedLetterItems: NormalizedJadwal[] = unlinkedLetters.map((l) =>
      this.mapLetterToJadwal(l, startDateStr)
    );

    const allItems = [...normalizedEvents, ...unlinkedLetterItems].filter((item) => {
      return item.tanggalKegiatan >= startDateStr && item.tanggalKegiatan <= endDateStr;
    });

    allItems.sort((a, b) => {
      const dateCompare = a.tanggalKegiatan.localeCompare(b.tanggalKegiatan);
      if (dateCompare !== 0) return dateCompare;
      const timeCompare = a.waktuMulai.localeCompare(b.waktuMulai);
      if (timeCompare !== 0) return timeCompare;
      return a.id - b.id;
    });

    return {
      items: allItems,
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
          from: true,
          pic_name: true,
          pic_phone_number: true,
          pic_json: true,
          status: true,
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
    let lokasi = cleanHtml(event.location) || '-';

    // 1. Tentukan tanggal kegiatan
    if (letter && letter.date_event && event.status !== 2n) {
      // Prioritaskan tanggal resmi dari surat kecuali event secara eksplisit di-reschedule
      const dt = new Date(letter.date_event);
      const y = dt.getUTCFullYear();
      const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
      const d = String(dt.getUTCDate()).padStart(2, '0');
      tglKegiatan = `${y}-${m}-${d}`;
    } else if (event.event_time_start) {
      const rawHour = event.event_time_start.getUTCHours();
      let dateObj = event.event_time_start;
      if (rawHour < 6 || rawHour >= 17) {
        dateObj = new Date(event.event_time_start.getTime() + 7 * 3600000);
      }
      const y = dateObj.getUTCFullYear();
      const m = String(dateObj.getUTCMonth() + 1).padStart(2, '0');
      const d = String(dateObj.getUTCDate()).padStart(2, '0');
      tglKegiatan = `${y}-${m}-${d}`;
    }

    // 2. Tentukan waktu mulai
    if (letter && letter.time_event) {
      // Prioritaskan jam resmi yang tercatat pada surat
      const hh = String(letter.time_event.getUTCHours()).padStart(2, '0');
      const mm = String(letter.time_event.getUTCMinutes()).padStart(2, '0');
      waktuMulai = `${hh}:${mm}`;
    } else if (event.event_time_start) {
      const rawHour = event.event_time_start.getUTCHours();
      const rawMin = event.event_time_start.getUTCMinutes();
      // Jika tersimpan sebagai UTC murni (jam subuh < 6), konversikan ke WIB (+7 jam)
      const finalH = rawHour < 6 ? (rawHour + 7) % 24 : rawHour;
      const hh = String(finalH).padStart(2, '0');
      const mm = String(rawMin).padStart(2, '0');
      waktuMulai = `${hh}:${mm}`;
    }

    // 3. Tentukan waktu selesai
    if (letter && letter.time_event_finish) {
      const hh = String(letter.time_event_finish.getUTCHours()).padStart(2, '0');
      const mm = String(letter.time_event_finish.getUTCMinutes()).padStart(2, '0');
      waktuSelesai = `${hh}:${mm}`;
    } else if (event.event_time_finish) {
      const rawHour = event.event_time_finish.getUTCHours();
      const rawMin = event.event_time_finish.getUTCMinutes();
      const finalH = rawHour < 6 ? (rawHour + 7) % 24 : rawHour;
      const hh = String(finalH).padStart(2, '0');
      const mm = String(rawMin).padStart(2, '0');
      waktuSelesai = `${hh}:${mm}`;
    }

    // 4. Lokasi
    if (lokasi === '-' && letter && letter.place_event) {
      lokasi = cleanHtml(letter.place_event) || '-';
    }

    // 5. Judul & Rincian
    const extracted = extractEventTitleDetails(event.title);
    const cleanTitle = extracted.cleanTitle || 'Agenda Kegiatan Protokol';

    // 6. PIC
    const rawPicName = event.pic_name || letter?.pic_name || null;
    const rawPicPhone = event.pic_phonenumber || letter?.pic_phone_number || null;
    const rawPicJson = event.pic_json || letter?.pic_json || null;
    const picInfo = formatPicWithWhatsApp(rawPicName, rawPicPhone, rawPicJson);

    const letterInfo = letter
      ? {
          nomorAgenda: letter.agenda_number || '-',
          nomorSurat: letter.number_or_date || '-',
          fileName: letter.file || null,
        }
      : null;

    let statusDisposisi = formatStatusDisposisi(event.status);
    let statusDisposisiCode = event.status !== null && event.status !== undefined ? Number(event.status) : null;

    if (statusDisposisiCode === null && letter) {
      const sLet = letter.status !== null && letter.status !== undefined ? Number(letter.status) : null;
      if (sLet === 2) {
        statusDisposisi = 'Diwakilkan';
        statusDisposisiCode = 3;
      } else if (sLet === 1) {
        statusDisposisi = 'Diagendakan';
        statusDisposisiCode = 1;
      } else {
        statusDisposisi = 'Belum ada disposisi';
        statusDisposisiCode = null;
      }
    }

    return {
      id: Number(event.id),
      namaKegiatan: cleanTitle,
      tanggalKegiatan: tglKegiatan || this.getTodayString(),
      waktuMulai,
      waktuSelesai,
      lokasi: lokasi || '-',
      pejabatHadir: extracted.pendamping || '-',
      pendamping: extracted.pendamping,
      peserta: extracted.peserta,
      arahan: extracted.arahan,
      catatan: extracted.catatan,
      pic: picInfo,
      statusDisposisi,
      statusDisposisiCode,
      surat: letterInfo,
    };
  }

  /**
   * Mengonversi baris tabel letters menjadi interface NormalizedJadwal jika belum dibuatkan baris events
   */
  private mapLetterToJadwal(letter: any, defaultDateStr: string): NormalizedJadwal {
    let tglKegiatan = defaultDateStr;
    if (letter.date_event) {
      const dt = new Date(letter.date_event);
      const y = dt.getUTCFullYear();
      const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
      const d = String(dt.getUTCDate()).padStart(2, '0');
      tglKegiatan = `${y}-${m}-${d}`;
    }

    let waktuMulai = '09:00';
    let waktuSelesai: string | null = null;
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

    const lokasi = cleanHtml(letter.place_event) || '-';
    const extracted = extractEventTitleDetails(letter.subject || 'Agenda Kegiatan Protokol');
    const cleanTitle = extracted.cleanTitle || 'Agenda Kegiatan Protokol';

    const picInfo = formatPicWithWhatsApp(letter.pic_name, letter.pic_phone_number, letter.pic_json);

    const sLet = letter.status !== null && letter.status !== undefined ? Number(letter.status) : null;
    let statusDisposisi = 'Belum ada disposisi';
    let statusDisposisiCode: number | null = null;
    if (sLet === 2) {
      statusDisposisi = 'Diwakilkan';
      statusDisposisiCode = 3;
    } else if (sLet === 1) {
      statusDisposisi = 'Diagendakan';
      statusDisposisiCode = 1;
    }

    return {
      id: Number(letter.id),
      namaKegiatan: cleanTitle,
      tanggalKegiatan: tglKegiatan,
      waktuMulai,
      waktuSelesai,
      lokasi: lokasi || '-',
      pejabatHadir: extracted.pendamping || '-',
      pendamping: extracted.pendamping,
      peserta: extracted.peserta,
      arahan: extracted.arahan,
      catatan: extracted.catatan,
      pic: picInfo,
      statusDisposisi,
      statusDisposisiCode,
      surat: {
        nomorAgenda: letter.agenda_number || '-',
        nomorSurat: letter.number_or_date || '-',
        fileName: letter.file || null,
      },
    };
  }

  /**
   * Mengambil jadwal kegiatan besok (H+1) dari basis data
   */
  public async getJadwalBesok(): Promise<NormalizedJadwal[]> {
    const tomorrowStr = this.getTomorrowString();
    const result = await this.getJadwalByDate(tomorrowStr);
    return result.items;
  }

  /**
   * Mengambil jadwal kegiatan hari ini dari basis data
   * @param onlyUpcoming jika true, hanya ambil kegiatan yang waktu mulainya belum lewat hari ini
   * @param onlyDiagendakan jika true, hanya ambil kegiatan dengan status disposisi 'Diagendakan' (status = 1)
   */
  public async getJadwalHariIni(
    onlyUpcoming: boolean = false,
    onlyDiagendakan: boolean = false
  ): Promise<NormalizedJadwal[]> {
    const todayStr = this.getTodayString();
    const result = await this.getJadwalByDate(todayStr, { onlyDiagendakan });
    let items = result.items;

    if (onlyUpcoming) {
      const nowWibMs = Date.now() + 7 * 3600000;
      const nowWib = new Date(nowWibMs);
      const curHhMm = `${String(nowWib.getUTCHours()).padStart(2, '0')}:${String(nowWib.getUTCMinutes()).padStart(2, '0')}`;
      items = items.filter((j) => (j.waktuSelesai || j.waktuMulai) >= curHhMm);
    }

    return items;
  }

  /**
   * Mengambil 1 kegiatan terdekat berikutnya hari ini atau di hari-hari mendatang
   */
  public async getJadwalBerikutnyaTerdekat(): Promise<{ item: NormalizedJadwal; isToday: boolean } | null> {
    const nowWibMs = Date.now() + 7 * 3600000;
    const nowWib = new Date(nowWibMs);
    const dbNow = new Date(Date.UTC(
      nowWib.getUTCFullYear(),
      nowWib.getUTCMonth(),
      nowWib.getUTCDate(),
      nowWib.getUTCHours(),
      nowWib.getUTCMinutes(),
      nowWib.getUTCSeconds()
    ));
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
      orderBy: [
        { event_time_start: 'asc' },
        { id: 'asc' },
      ],
      take: limit,
    });

    // Jika database tidak memiliki agenda mendatang dari hari ini, tampilkan agenda terbaru
    if (events.length === 0) {
      events = await prisma.events.findMany({
        where: {
          deleted_at: null,
          event_time_start: { not: null },
        },
        orderBy: [
          { event_time_start: 'desc' },
          { id: 'desc' },
        ],
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

    const nowWibMs = Date.now() + 7 * 3600000;
    const wibToday = new Date(nowWibMs);
    const todayEpoch = Date.UTC(wibToday.getUTCFullYear(), wibToday.getUTCMonth(), wibToday.getUTCDate());

    const evDate = new Date(eventDate);
    const evEpoch = Date.UTC(evDate.getUTCFullYear(), evDate.getUTCMonth(), evDate.getUTCDate());
    const diffDays = (evEpoch - todayEpoch) / (1000 * 60 * 60 * 24);

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

    const statusFilter: Prisma.eventsWhereInput = options.onlyDiagendakan ? { status: 1n } : {};

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
          ...statusFilter,
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
          ...statusFilter,
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
        item.pendamping || '',
        item.peserta || '',
        item.arahan || '',
        item.catatan || '',
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

  /**
   * Menyimpan jadwal kegiatan yang berasal dari arahan langsung pimpinan ke tabel events
   */
  public async saveJadwalArahanLangsung(
    draft: JadwalArahanDraftData,
    userId?: number | string,
    userName?: string
  ): Promise<{
    success: boolean;
    event?: any;
    message?: string;
    hasTimeConflict?: boolean;
    conflictingEvents?: any[];
  }> {
    try {
      // 1. Ekstrak tanggal kegiatan
      let eventDate: Date | null = null;
      if (draft.tanggalIso) {
        eventDate = parseIndonesianDateToDate(draft.tanggalIso);
      }
      if (!eventDate && draft.tanggalKegiatan) {
        eventDate = parseIndonesianDateToDate(draft.tanggalKegiatan);
      }
      if (!eventDate) {
        eventDate = new Date();
      }

      const eventYear = eventDate.getUTCFullYear();
      const eventMonth = eventDate.getUTCMonth();
      const eventDay = eventDate.getUTCDate();

      // 2. Ekstrak waktu kegiatan (mulai & selesai)
      let startH = 9;
      let startM = 0;
      let eventTimeFinish: Date | null = null;
      let untilFinish = draft.sampaiSelesai ? 1 : 0;

      const parsedTime = parseIndonesianTimeToDates(
        `${draft.waktuMulai || '09:00'}${draft.waktuSelesai ? ' - ' + draft.waktuSelesai : ''}`
      );

      if (parsedTime.startTime && isValidDate(parsedTime.startTime)) {
        startH = parsedTime.startTime.getUTCHours();
        startM = parsedTime.startTime.getUTCMinutes();
      }

      const calculatedStart = new Date(Date.UTC(eventYear, eventMonth, eventDay, startH, startM, 0, 0));
      const eventTimeStart = isValidDate(calculatedStart)
        ? calculatedStart
        : new Date(Date.UTC(eventYear, eventMonth, eventDay, 9, 0, 0, 0));

      if (parsedTime.finishTime && isValidDate(parsedTime.finishTime)) {
        const finishH = parsedTime.finishTime.getUTCHours();
        const finishM = parsedTime.finishTime.getUTCMinutes();
        const calculatedFinish = new Date(Date.UTC(eventYear, eventMonth, eventDay, finishH, finishM, 0, 0));
        if (isValidDate(calculatedFinish)) {
          eventTimeFinish = calculatedFinish;
          untilFinish = 0;
        }
      } else if (draft.sampaiSelesai) {
        eventTimeFinish = null;
        untilFinish = 1;
      }

      // 3. Gabungkan nama PIC dan kontak
      let picNameStr = draft.pic?.trim() || '';
      let picPhoneStr = '';
      if (picNameStr && picNameStr !== '-') {
        const splitted = splitPicNameAndPhone(picNameStr);
        picNameStr = splitted.name;
        picPhoneStr = splitted.phone;
      }

      // Jika ada info Pejabat Hadir, gabungkan ke pic_name
      let finalPicName = picNameStr;
      if (draft.pejabatHadir && draft.pejabatHadir.trim() !== '-' && draft.pejabatHadir.trim() !== '') {
        finalPicName =
          finalPicName && finalPicName !== '-'
            ? `${draft.pejabatHadir.trim()} | PIC: ${finalPicName}`
            : draft.pejabatHadir.trim();
      }

      let picJson: string | null = null;
      if (picNameStr && picNameStr !== '-') {
        picJson = JSON.stringify([{ name: picNameStr, phone: picPhoneStr || '' }]);
      }

      // 4. Catatan arahan langsung
      const notesParts: string[] = ['[ARAHAN LANGSUNG PIMPINAN]'];
      if (draft.pejabatHadir && draft.pejabatHadir.trim() !== '-') {
        notesParts.push(`Pejabat Hadir: ${draft.pejabatHadir.trim()}`);
      }
      if (draft.catatan && draft.catatan.trim() !== '-' && draft.catatan.trim() !== '') {
        notesParts.push(`Catatan: ${draft.catatan.trim()}`);
      }
      const eventNotes = notesParts.join(' | ');

      const creatorName = (userName || 'Petugas Protokol').trim();

      // 5. Cek apakah ada jadwal lain yang bersamaan / bentrok
      let hasTimeConflict = false;
      let conflictingEvents: any[] = [];
      try {
        conflictingEvents = await prisma.events.findMany({
          where: {
            deleted_at: null,
            event_time_start: eventTimeStart,
          },
          select: {
            id: true,
            title: true,
            location: true,
            status: true,
          },
          take: 5,
        });
        if (conflictingEvents.length > 0) {
          hasTimeConflict = true;
        }
      } catch (confErr) {
        console.warn('[JadwalService] Gagal memeriksa bentrok waktu:', confErr);
      }

      // 6. Buat payload events
      const eventDataPayload: Prisma.eventsCreateInput = {
        title: draft.namaKegiatan.trim(),
        letter_id: null,
        disposition_id: null,
        event_time_start: eventTimeStart,
        event_time_finish: eventTimeFinish,
        until_finish: untilFinish,
        is_internal: '1',
        is_hide_location: '0',
        time_zone: 'WIB',
        status: 1n, // 1: onschedule (Diagendakan)
        location: draft.lokasi && draft.lokasi !== '-' ? draft.lokasi.trim() : null,
        pic_name: finalPicName && finalPicName !== '-' ? finalPicName.slice(0, 225) : null,
        pic_phonenumber: picPhoneStr && picPhoneStr !== '-' ? picPhoneStr.slice(0, 100) : null,
        pic_json: picJson,
        notes: eventNotes,
        created_by: creatorName,
        created_at: new Date(),
        updated_at: new Date(),
      };

      let createdEvent: any = null;
      try {
        createdEvent = await prisma.events.create({
          data: eventDataPayload,
        });
      } catch (evErr: any) {
        if (isDuplicateKeyError(evErr)) {
          console.warn('[JadwalService] Terdeteksi bentrok sequence events. Menjalankan auto-sync dan me-retry insert...');
          await syncTableSequence('events');
          createdEvent = await prisma.events.create({
            data: eventDataPayload,
          });
        } else {
          throw evErr;
        }
      }

      // 7. Catat ke activity_log (sinkron dengan web Laravel)
      if (createdEvent && userId) {
        try {
          await prisma.activity_log.create({
            data: {
              log_name: 'default',
              description: `Menambah Jadwal Arahan Langsung: "${draft.namaKegiatan}" oleh ${creatorName}`,
              subject_id: Number(createdEvent.id),
              subject_type: 'App\\Models\\Events',
              causer_id: Number(userId),
              causer_type: 'App\\Models\\User',
              properties: JSON.stringify({
                title: draft.namaKegiatan,
                location: draft.lokasi,
                eventTimeStart: eventTimeStart.toISOString(),
                eventTimeFinish: eventTimeFinish ? eventTimeFinish.toISOString() : null,
                isInternal: '1',
                status: 'Diagendakan',
                notes: eventNotes,
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
                  description: `Menambah Jadwal Arahan Langsung: "${draft.namaKegiatan}" oleh ${creatorName}`,
                  subject_id: Number(createdEvent.id),
                  subject_type: 'App\\Models\\Events',
                  causer_id: Number(userId),
                  causer_type: 'App\\Models\\User',
                  properties: JSON.stringify({
                    title: draft.namaKegiatan,
                    location: draft.lokasi,
                    eventTimeStart: eventTimeStart.toISOString(),
                    status: 'Diagendakan',
                  }),
                  created_at: new Date(),
                  updated_at: new Date(),
                },
              });
            } catch {}
          }
        }
      }

      return {
        success: true,
        event: createdEvent,
        hasTimeConflict,
        conflictingEvents,
      };
    } catch (err: any) {
      console.error('[JadwalService] Gagal menyimpan jadwal arahan langsung:', err);
      return {
        success: false,
        message: err.message || 'Terjadi kesalahan sistem saat menyimpan ke database.',
      };
    }
  }
}

export const jadwalService = new JadwalService();
