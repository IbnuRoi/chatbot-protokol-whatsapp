import { sessionService, BotState, UserSession } from '../../services/sessionService';
import { jadwalService, formatTanggalIndo, NormalizedJadwal } from '../../services/jadwalService';
import { nluService, NluResult } from '../../services/nluService';
import { menuHandler } from './menuHandler';
import { cariSuratHandler } from './cariSuratHandler';
import { BotResponse } from '../types';
import { scoreTextMatch, cleanQueryForSelection, formatNomorSuratLink } from '../../utils/textHelper';
import { extractDateFromText, extractDateRangeFromText, formatWaktuDisplay } from '../../utils/dateHelper';

export class JadwalHandler {
  /**
   * Menampilkan menu Jadwal Kegiatan
   */
  public async showJadwalMenu(session: UserSession): Promise<BotResponse> {
    sessionService.setState(session.whatsappNumber, BotState.JADWAL_MENU);

    const todayStr = jadwalService.getTodayString();
    const todayFormatted = formatTanggalIndo(todayStr);

    // Ambil jadwal hari ini (urut waktu terdekat)
    const jadwalsHariIni = await jadwalService.getJadwalHariIni(false);

    let listText = '';
    if (jadwalsHariIni.length === 0) {
      listText = `_Tidak ada agenda kegiatan terdaftar untuk hari ini (${todayFormatted})._\n`;
    } else {
      session.jadwalSearchResults = jadwalsHariIni;
      session.jadwalSearchKeyword = 'Agenda Hari Ini';
      sessionService.setState(session.whatsappNumber, BotState.JADWAL_CARI_HASIL);

      listText = jadwalsHariIni
        .map((j, idx) => {
          const waktu = formatWaktuDisplay(j.waktuMulai, j.waktuSelesai);
          const statusDisp = j.statusDisposisi || 'Terjadwal (On Schedule)';
          return (
            `*${idx + 1}.* 📌 *${j.namaKegiatan}*\n` +
            `   📅 *Tanggal Pelaksanaan* : ${todayFormatted}\n` +
            `   🕒 *Waktu*   : ${waktu}\n` +
            `   📍 *Lokasi*  : ${j.lokasi}\n` +
            `   📋 *Status Disposisi* : ${statusDisp}`
          );
        })
        .join('\n\n');
    }

    const text =
      `📅 *JADWAL KEGIATAN PROTOKOL HARI INI*\n` +
      `📅 *Tanggal Pelaksanaan:* ${todayFormatted}\n\n` +
      `${listText}\n\n` +
      `Silakan beri tahu saya jika Anda ingin melihat kegiatan terdekat berikutnya atau agenda beberapa hari ke depan ya.`;

    return { text };
  }

  /**
   * Menampilkan jadwal kegiatan untuk besok (H+1)
   */
  public async showJadwalBesok(session: UserSession): Promise<BotResponse> {
    sessionService.setState(session.whatsappNumber, BotState.JADWAL_MENU);

    const tomorrowStr = jadwalService.getTomorrowString();
    const tomorrowFormatted = formatTanggalIndo(tomorrowStr);

    const jadwalsBesok = await jadwalService.getJadwalBesok();

    let listText = '';
    if (jadwalsBesok.length === 0) {
      const nextResult = await jadwalService.getJadwalBerikutnyaTerdekat();
      const nextInfo = nextResult
        ? `\n\n💡 *Agenda terdekat berikutnya:* ${nextResult.item.namaKegiatan} pada hari *${formatTanggalIndo(nextResult.item.tanggalKegiatan)}* pukul ${formatWaktuDisplay(nextResult.item.waktuMulai, nextResult.item.waktuSelesai)}.`
        : '';
      listText = `_Tidak ada agenda kegiatan terdaftar untuk besok (${tomorrowFormatted})._${nextInfo}`;
    } else {
      session.jadwalSearchResults = jadwalsBesok;
      session.jadwalSearchKeyword = 'Agenda Besok';
      sessionService.setState(session.whatsappNumber, BotState.JADWAL_CARI_HASIL);

      listText = jadwalsBesok
        .map((j, idx) => {
          const waktu = formatWaktuDisplay(j.waktuMulai, j.waktuSelesai);
          const statusDisp = j.statusDisposisi || 'Terjadwal (On Schedule)';
          return (
            `*${idx + 1}.* 📌 *${j.namaKegiatan}*\n` +
            `   📅 *Tanggal Pelaksanaan* : ${tomorrowFormatted}\n` +
            `   🕒 *Waktu*  : ${waktu}\n` +
            `   📍 *Lokasi* : ${j.lokasi}\n` +
            `   📋 *Status Disposisi* : ${statusDisp}\n` +
            `   👥 *Hadir*  : ${j.pejabatHadir || '-'}\n` +
            `   📞 *PIC*    : ${j.pic || '-'}`
          );
        })
        .join('\n\n');
    }

    const text =
      `📅 *JADWAL KEGIATAN PROTOKOL BESOK*\n` +
      `📅 *Tanggal Pelaksanaan:* ${tomorrowFormatted}\n\n` +
      `${listText}\n\n` +
      `Silakan beri tahu saya jika Anda ingin memeriksa jadwal kegiatan lainnya ya.`;

    return { text };
  }

  /**
   * Menampilkan jadwal kegiatan untuk tanggal tertentu (pencarian berdasarkan tanggal)
   */
  public async showJadwalTanggal(session: UserSession, dateInput: string): Promise<BotResponse> {
    const parsed = extractDateFromText(dateInput);
    const targetDateStr = parsed ? parsed.dateStr : dateInput;

    const result = await jadwalService.getJadwalByDate(targetDateStr);
    const { items, formattedDate } = result;

    if (items.length === 0) {
      sessionService.setState(session.whatsappNumber, BotState.JADWAL_MENU);
      const text =
        `📅 *JADWAL KEGIATAN PROTOKOL*\n` +
        `📅 *Tanggal Pelaksanaan:* ${formattedDate}\n\n` +
        `_Tidak ada agenda kegiatan terdaftar untuk tanggal tersebut._\n\n` +
        `Silakan beri tahu saya jika Anda ingin mencari tanggal lain atau kegiatan tertentu ya. 😊`;
      return { text };
    }

    session.jadwalSearchResults = items;
    session.jadwalSearchKeyword = formattedDate;
    sessionService.setState(session.whatsappNumber, BotState.JADWAL_CARI_HASIL);

    const listText = items
      .map((j, idx) => {
        const waktu = formatWaktuDisplay(j.waktuMulai, j.waktuSelesai);
        const statusDisp = j.statusDisposisi || 'Terjadwal (On Schedule)';
        return (
          `*${idx + 1}.* 📌 *${j.namaKegiatan}*\n` +
          `   📅 *Tanggal Pelaksanaan* : ${formattedDate}\n` +
          `   🕒 *Waktu*   : ${waktu}\n` +
          `   📍 *Lokasi*  : ${j.lokasi}\n` +
          `   📋 *Status Disposisi* : ${statusDisp}\n` +
          `   👥 *Hadir*   : ${j.pejabatHadir || '-'}\n` +
          `   📞 *PIC*     : ${j.pic || '-'}`
        );
      })
      .join('\n\n');

    const text =
      `📅 *JADWAL KEGIATAN PROTOKOL*\n` +
      `📅 *Tanggal Pelaksanaan:* ${formattedDate}\n\n` +
      `Ditemukan *${items.length} agenda kegiatan*:\n\n` +
      `${listText}\n\n` +
      `Silakan ketik nomor kegiatan (contoh: _jadwal 1_), atau sebutkan *nama kegiatan* yang ingin Anda lihat rinciannya ya. 😊`;

    return { text };
  }

  /**
   * Menampilkan jadwal kegiatan untuk rentang hari tertentu (misal: 2 hari ke depan, 3 hari, 5 hari, seminggu, dua minggu)
   */
  public async showJadwalRentang(
    session: UserSession,
    daysCount: number,
    labelText?: string
  ): Promise<BotResponse> {
    const result = await jadwalService.getJadwalRentangHari(daysCount, labelText);
    const { items, formattedRange, label } = result;

    if (items.length === 0) {
      sessionService.setState(session.whatsappNumber, BotState.JADWAL_MENU);
      const text =
        `📅 *JADWAL KEGIATAN PROTOKOL (${label.toUpperCase()})*\n` +
        `📅 *Periode:* ${formattedRange}\n\n` +
        `_Tidak ada agenda kegiatan terdaftar untuk periode ${label.toLowerCase()} tersebut._\n\n` +
        `Silakan beri tahu saya jika Anda ingin mencari tanggal lain atau kegiatan tertentu ya. 😊`;
      return { text };
    }

    session.jadwalSearchResults = items;
    session.jadwalSearchKeyword = label;
    sessionService.setState(session.whatsappNumber, BotState.JADWAL_CARI_HASIL);

    const listText = items
      .map((j, idx) => {
        const waktu = formatWaktuDisplay(j.waktuMulai, j.waktuSelesai);
        const tglIndo = formatTanggalIndo(j.tanggalKegiatan);
        const statusDisp = j.statusDisposisi || 'Terjadwal (On Schedule)';
        return (
          `*${idx + 1}.* 📌 *${j.namaKegiatan}*\n` +
          `   📅 *Tanggal Pelaksanaan* : ${tglIndo}\n` +
          `   🕒 *Waktu*   : ${waktu}\n` +
          `   📍 *Lokasi*  : ${j.lokasi}\n` +
          `   📋 *Status Disposisi* : ${statusDisp}\n` +
          `   👥 *Hadir*   : ${j.pejabatHadir || '-'}\n` +
          `   📞 *PIC*     : ${j.pic || '-'}`
        );
      })
      .join('\n\n');

    const text =
      `📅 *JADWAL KEGIATAN PROTOKOL (${label.toUpperCase()})*\n` +
      `📅 *Periode:* ${formattedRange}\n\n` +
      `Ditemukan *${items.length} agenda kegiatan*:\n\n` +
      `${listText}\n\n` +
      `Silakan ketik nomor kegiatan (contoh: _jadwal 1_), atau sebutkan *nama kegiatan* yang ingin Anda lihat rinciannya ya. 😊`;

    return { text };
  }

  /**
   * Menampilkan prompt instruksi pencarian jadwal kegiatan
   */
  public async promptSearch(session: UserSession): Promise<BotResponse> {
    sessionService.setState(session.whatsappNumber, BotState.JADWAL_CARI_INPUT);

    return {
      text:
        `🔍 *PENCARIAN JADWAL KEGIATAN*\n\n` +
        `Tentu, silakan sebutkan nama kegiatan atau topik agenda yang ingin Anda cari (misalnya: _"rakor"_, _"audiensi"_, atau _"pelatihan vokasi"_).`,
    };
  }

  /**
   * Memproses input kata kunci pencarian jadwal dan menampilkan hasilnya
   */
  public async handleSearchKeyword(session: UserSession, input: string): Promise<BotResponse> {
    const clean = input.trim();

    if (clean === '0' || clean.toLowerCase() === 'batal' || clean.toLowerCase() === 'menu') {
      sessionService.resetSession(session.whatsappNumber);
      return menuHandler.getMainGreeting(session);
    }

    if (clean === '2' || clean.toLowerCase() === 'jadwal') {
      return this.showJadwalMenu(session);
    }

    if (clean.length < 2) {
      return {
        text: `Kata kunci pencariannya terlalu singkat. Boleh berikan minimal 2 karakter nama kegiatan yang ingin dicari?`,
      };
    }

    const lower = clean.toLowerCase();

    // Jika input sebenarnya mencari surat masuk / dokumen
    if (
      lower.startsWith('cari surat') ||
      lower.startsWith('carikan surat') ||
      lower.startsWith('cek surat') ||
      lower.includes('surat terbaru') ||
      (lower.includes('surat') && !lower.includes('jadwal') && !lower.includes('agenda'))
    ) {
      return cariSuratHandler.handleSearchKeyword(session, clean);
    }

    // Ekstrak kemungkinan tanggal, rentang waktu, dan kata kunci inti
    const dateMatch = extractDateFromText(clean);
    const rangeMatch = extractDateRangeFromText(clean);
    const keywordOnly = nluService.extractSearchKeyword(clean);

    // Kasus 1: Ada tanggal DAN ada kata kunci topik (contoh: "rakor tanggal 18 september")
    if (dateMatch && keywordOnly && keywordOnly.length >= 2) {
      const dateRange = jadwalService.getWibRangeForDate(dateMatch.dateStr);
      let results = await jadwalService.searchJadwal(keywordOnly, {
        startDate: dateRange.startOfDay,
        endDate: dateRange.endOfDay,
      });

      let fallbackNotice = '';
      if (results.length === 0) {
        // Fallback: cari agenda topik tersebut tanpa batasan tanggal
        results = await jadwalService.searchJadwal(keywordOnly);
        if (results.length > 0) {
          fallbackNotice = `_ℹ️ Catatan: Belum ada agenda terkait "${keywordOnly}" pada tanggal ${dateMatch.formattedIndo}. Berikut agenda terdekat yang ditemukan:_\n\n`;
        }
      }

      session.jadwalSearchKeyword = keywordOnly;
      session.jadwalSearchResults = results;

      if (results.length === 0) {
        sessionService.setState(session.whatsappNumber, BotState.JADWAL_CARI_INPUT);
        return {
          text:
            `🔍 *HASIL PENCARIAN JADWAL*\n\n` +
            `Saya belum menemukan agenda kegiatan terkait *"${keywordOnly}"* baik pada tanggal ${dateMatch.formattedIndo} maupun tanggal lainnya.\n\n` +
            `Boleh coba dengan nama kegiatan atau topik yang lain?`,
        };
      }

      sessionService.setState(session.whatsappNumber, BotState.JADWAL_CARI_HASIL);
      const res = this.renderSearchResultList(session, results, keywordOnly);
      if (fallbackNotice) {
        return typeof res === 'string'
          ? `${fallbackNotice}${res}`
          : { ...res, text: `${fallbackNotice}${res.text}` };
      }
      return res;
    }

    // Kasus 2: Murni rentang waktu (contoh: "2 hari kedepan", "seminggu kedepan")
    if (rangeMatch && (!keywordOnly || keywordOnly.length < 2)) {
      return this.showJadwalRentang(session, rangeMatch.daysCount, rangeMatch.label);
    }

    // Kasus 3: Murni tanggal spesifik (contoh: "18 september", "23/09/2026", "2026-09-18")
    if (dateMatch && (!keywordOnly || keywordOnly.length < 2)) {
      return this.showJadwalTanggal(session, dateMatch.dateStr);
    }

    const searchTarget = keywordOnly && keywordOnly.length >= 2 ? keywordOnly : clean;
    const results = await jadwalService.searchJadwal(searchTarget);

    session.jadwalSearchKeyword = searchTarget;
    session.jadwalSearchResults = results;

    if (results.length === 0) {
      sessionService.setState(session.whatsappNumber, BotState.JADWAL_CARI_INPUT);
      return {
        text:
          `🔍 *HASIL PENCARIAN JADWAL*\n\n` +
          `Saya belum menemukan agenda kegiatan dengan kata kunci *"${searchTarget}"*.\n\n` +
          `Boleh coba dengan nama kegiatan atau topik yang lain?`,
      };
    }

    sessionService.setState(session.whatsappNumber, BotState.JADWAL_CARI_HASIL);
    return this.renderSearchResultList(session, results, searchTarget);
  }

  /**
   * Merender format teks daftar hasil pencarian jadwal
   */
  private renderSearchResultList(session: UserSession, results: NormalizedJadwal[], keyword: string): BotResponse {
    const listText = results
      .map((j, idx) => {
        const waktu = formatWaktuDisplay(j.waktuMulai, j.waktuSelesai);
        const formattedDate = formatTanggalIndo(j.tanggalKegiatan);
        const statusDisp = j.statusDisposisi || 'Terjadwal (On Schedule)';
        return (
          `*${idx + 1}.* 📌 *${j.namaKegiatan}*\n` +
          `   📅 Tanggal Pelaksanaan : ${formattedDate}\n` +
          `   🕒 Waktu   : ${waktu}\n` +
          `   📍 Lokasi  : ${j.lokasi}\n` +
          `   📋 Status Disposisi : ${statusDisp}\n` +
          `   👥 Hadir   : ${j.pejabatHadir || '-'}\n` +
          `   📞 PIC     : ${j.pic || '-'}`
        );
      })
      .join('\n\n');

    const text =
      `🔍 *HASIL PENCARIAN JADWAL KEGIATAN*\n` +
      `Ditemukan *${results.length} agenda kegiatan* untuk kata kunci *"${keyword}"*:\n\n` +
      `${listText}\n\n` +
      `Silakan ketik nomor kegiatan (contoh: _jadwal 1_), atau sebutkan *nama kegiatan* yang ingin Anda lihat rinciannya ya. 😊`;

    return { text };
  }

  /**
   * Merender rincian detail satu agenda kegiatan
   */
  public renderDetailJadwal(item: NormalizedJadwal): BotResponse {
    const waktu = formatWaktuDisplay(item.waktuMulai, item.waktuSelesai);
    const formattedDate = formatTanggalIndo(item.tanggalKegiatan);

    let suratNote = '';
    if (item.surat?.nomorAgenda) {
      suratNote = `\n• *Surat Terkait*        : ${item.surat.nomorAgenda} (${formatNomorSuratLink(item.surat.nomorSurat, item.surat.fileName)})`;
    }

    const statusDisp = item.statusDisposisi || 'Terjadwal (On Schedule)';

    return {
      text:
        `📌 *RINCIAN AGENDA KEGIATAN*\n\n` +
        `• *Kegiatan*            : ${item.namaKegiatan}\n` +
        `• *Tanggal Pelaksanaan* : ${formattedDate}\n` +
        `• *Waktu*               : ${waktu}\n` +
        `• *Lokasi*              : ${item.lokasi}\n` +
        `• *Status Disposisi*    : ${statusDisp}\n` +
        `• *Pejabat Hadir*       : ${item.pejabatHadir || '-'}\n` +
        `• *PIC*                 : ${item.pic || '-'}` +
        suratNote +
        `\n\nBila Anda ingin mencari agenda lainnya atau kembali ke menu utama, silakan beri tahu saya ya. 😊`,
    };
  }

  /**
   * Menangani aksi saat berada di tampilan hasil pencarian jadwal
   */
  public async handleSearchResultInput(session: UserSession, input: string, nlu?: NluResult): Promise<BotResponse> {
    const clean = input.trim();
    const lower = clean.toLowerCase();

    if (clean === '0' || lower === 'kembali' || lower === 'menu' || lower === 'batal' || nlu?.intent === 'BATAL') {
      sessionService.resetSession(session.whatsappNumber);
      return menuHandler.getMainGreeting(session);
    }

    if (clean === '3' || lower === 'cari') {
      return this.promptSearch(session);
    }

    if (clean === '2' || lower === 'jadwal') {
      return this.showJadwalMenu(session);
    }

    // Cek jika pengguna mengetik rentang hari saat berada di hasil pencarian
    const rangeResult = extractDateRangeFromText(clean);
    if (rangeResult) {
      return this.showJadwalRentang(session, rangeResult.daysCount, rangeResult.label);
    }

    const results = session.jadwalSearchResults || [];

    // 1. Cek pemilihan nomor jadwal eksplisit (contoh: "jadwal 1", "agenda 2", "kegiatan 1")
    const jadwalMatch = lower.match(/^(?:jadwal|agenda|kegiatan)\s*(?:ke\s*)?(\d+)$/i);
    if (jadwalMatch) {
      const jIdx = parseInt(jadwalMatch[1], 10);
      if (jIdx >= 1 && jIdx <= results.length) {
        return this.renderDetailJadwal(results[jIdx - 1]);
      }
    }

    // 2. Cek angka tunggal (contoh: "1", "2")
    const numericIndex = parseInt(clean, 10);
    if (!isNaN(numericIndex) && numericIndex >= 1 && numericIndex <= results.length && clean === String(numericIndex)) {
      return this.renderDetailJadwal(results[numericIndex - 1]);
    }

    // 3. Pencocokan Fluid Teks Berdasarkan Nama Kegiatan yang Sedang Tampil
    const cleanQuery = cleanQueryForSelection(clean);
    if (cleanQuery.length >= 2 && results.length > 0) {
      let bestSchedule: { item: NormalizedJadwal; score: number } | null = null;
      for (const schedule of results) {
        const score = Math.max(
          scoreTextMatch(cleanQuery, schedule.namaKegiatan),
          scoreTextMatch(cleanQuery, schedule.lokasi),
          scoreTextMatch(cleanQuery, schedule.pejabatHadir),
          scoreTextMatch(cleanQuery, schedule.pic)
        );
        if (!bestSchedule || score > bestSchedule.score) {
          bestSchedule = { item: schedule, score };
        }
      }

      if (bestSchedule && bestSchedule.score >= 25) {
        return this.renderDetailJadwal(bestSchedule.item);
      }
    }

    // 4. Jika NLU mendeteksi keyword pencarian tertentu, cek juga apakah itu cocok dengan jadwal di list
    if (nlu?.intent === 'JADWAL_CARI' && nlu.entities?.keyword) {
      const nluQuery = cleanQueryForSelection(nlu.entities.keyword);
      if (nluQuery.length >= 2 && results.length > 0) {
        let bestSchedule: { item: NormalizedJadwal; score: number } | null = null;
        for (const schedule of results) {
          const score = Math.max(
            scoreTextMatch(nluQuery, schedule.namaKegiatan),
            scoreTextMatch(nluQuery, schedule.lokasi),
            scoreTextMatch(nluQuery, schedule.pejabatHadir),
            scoreTextMatch(nluQuery, schedule.pic)
          );
          if (!bestSchedule || score > bestSchedule.score) {
            bestSchedule = { item: schedule, score };
          }
        }

        if (bestSchedule && bestSchedule.score >= 25) {
          return this.renderDetailJadwal(bestSchedule.item);
        }
      }

      return this.handleSearchKeyword(session, nlu.entities.keyword);
    }

    // 5. Jika tidak cocok dengan item di layar, lakukan pencarian jadwal baru
    return this.handleSearchKeyword(session, clean);
  }

  /**
   * Menangani pilihan aksi pada Menu Jadwal
   */
  public async handleJadwalInput(session: UserSession, input: string, nlu?: NluResult): Promise<BotResponse> {
    const clean = input.trim();
    const lower = clean.toLowerCase();

    // Cek jika pengguna mengetik rentang hari (contoh: "2 hari kedepan", "seminggu kedepan")
    const dateRangeInput = extractDateRangeFromText(clean);
    if (dateRangeInput) {
      return this.showJadwalRentang(session, dateRangeInput.daysCount, dateRangeInput.label);
    }

    if (
      nlu?.intent === 'JADWAL_BESOK' ||
      lower.includes('besok') ||
      lower.includes('esok')
    ) {
      return this.showJadwalBesok(session);
    } else if (
      nlu?.intent === 'JADWAL_BERIKUTNYA' ||
      clean === '1' ||
      lower.includes('berikut') ||
      lower.includes('terdekat') ||
      lower.includes('setelah')
    ) {
      const nextResult = await jadwalService.getJadwalBerikutnyaTerdekat();

      if (!nextResult) {
        return {
          text:
            `ℹ️ *Tidak Ada Jadwal Mendatang*\n` +
            `Seluruh kegiatan yang terjadwal telah selesai atau belum ada kegiatan baru yang diinput.\n\n` +
            `Silakan beri tahu saya jika ada hal lain yang ingin Anda tanyakan atau periksa.`,
        };
      }

      const item = nextResult.item;
      const formattedDate = formatTanggalIndo(item.tanggalKegiatan);
      const statusLabel = nextResult.isToday ? `Hari Ini (${formattedDate})` : formattedDate;
      const waktu = formatWaktuDisplay(item.waktuMulai, item.waktuSelesai);
      const statusDisp = item.statusDisposisi || 'Terjadwal (On Schedule)';

      session.jadwalSearchResults = [item];
      session.jadwalSearchKeyword = item.namaKegiatan;
      sessionService.setState(session.whatsappNumber, BotState.JADWAL_CARI_HASIL);

      const text =
        `⏰ *KEGIATAN TERDEKAT BERIKUTNYA (${statusLabel})*\n\n` +
        `📌 *Kegiatan*            : ${item.namaKegiatan}\n` +
        `📅 *Tanggal Pelaksanaan* : ${formattedDate}\n` +
        `🕒 *Waktu*               : ${waktu}\n` +
        `📍 *Lokasi*              : ${item.lokasi}\n` +
        `📋 *Status Disposisi*    : ${statusDisp}\n` +
        `👥 *Pejabat Hadir*       : ${item.pejabatHadir || '-'}\n` +
        `📞 *PIC*                 : ${item.pic || '-'}\n\n` +
        `Beri tahu saya jika Anda ingin melihat agenda kegiatan lainnya ya.`;

      return { text };
    } else if (
      nlu?.intent === 'JADWAL_MENDATANG' ||
      clean === '2' ||
      lower.includes('mendatang') ||
      lower.includes('minggu') ||
      lower.includes('depan')
    ) {
      const mendatang = await jadwalService.getJadwalMendatang(10);

      if (mendatang.length === 0) {
        return {
          text: `ℹ️ *Belum ada jadwal kegiatan untuk beberapa hari ke depan.*\n\nSilakan tanyakan jika ada hal lain yang bisa saya bantu.`,
        };
      }

      session.jadwalSearchResults = mendatang;
      session.jadwalSearchKeyword = 'Agenda Mendatang';
      sessionService.setState(session.whatsappNumber, BotState.JADWAL_CARI_HASIL);

      const listText = mendatang
        .map((j, idx) => {
          const waktu = formatWaktuDisplay(j.waktuMulai, j.waktuSelesai);
          const formattedDate = formatTanggalIndo(j.tanggalKegiatan);
          const statusDisp = j.statusDisposisi || 'Terjadwal (On Schedule)';
          return (
            `*${idx + 1}.* 📌 *${j.namaKegiatan}*\n` +
            `   📅 *Tanggal Pelaksanaan* : ${formattedDate}\n` +
            `   🕒 *Waktu*   : ${waktu}\n` +
            `   📍 *Lokasi*  : ${j.lokasi}\n` +
            `   📋 *Status Disposisi* : ${statusDisp}`
          );
        })
        .join('\n\n');

      return {
        text:
          `🗓️ *AGENDA PROTOKOL MENDATANG*\n\n` +
          `${listText}\n\n` +
          `Silakan ketik nomor kegiatan (contoh: _jadwal 1_), atau sebutkan *nama kegiatan* yang ingin Anda lihat rinciannya ya. 😊`,
      };
    } else if (nlu?.intent === 'JADWAL_CARI' || clean === '3' || lower.includes('cari')) {
      if (nlu?.entities?.tanggal) {
        return this.showJadwalTanggal(session, nlu.entities.tanggal);
      }
      const inlineDate = extractDateFromText(clean);
      if (inlineDate && !lower.includes('besok') && !lower.includes('hari ini')) {
        return this.showJadwalTanggal(session, inlineDate.dateStr);
      }
      if (nlu?.entities?.keyword && nlu.entities.keyword.length >= 2) {
        return this.handleSearchKeyword(session, nlu.entities.keyword);
      }
      return this.promptSearch(session);
    } else if (clean === '0' || lower === 'kembali' || lower === 'menu' || lower === 'batal') {
      sessionService.resetSession(session.whatsappNumber);
      return menuHandler.getMainGreeting(session);
    } else if (clean.length >= 2) {
      const inlineDate = extractDateFromText(clean);
      if (inlineDate && !lower.includes('besok') && !lower.includes('hari ini')) {
        return this.showJadwalTanggal(session, inlineDate.dateStr);
      }
      return this.handleSearchKeyword(session, clean);
    } else {
      return this.showJadwalMenu(session);
    }
  }
}

export const jadwalHandler = new JadwalHandler();
