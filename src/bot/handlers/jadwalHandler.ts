import { sessionService, BotState, UserSession } from '../../services/sessionService';
import { jadwalService, formatTanggalIndo, NormalizedJadwal } from '../../services/jadwalService';
import { nluService, NluResult } from '../../services/nluService';
import { menuHandler } from './menuHandler';
import { cariSuratHandler } from './cariSuratHandler';
import { BotResponse } from '../types';
import { scoreTextMatch, cleanQueryForSelection, formatNomorSuratLink, getLetterFileUrl, isPureGreeting, formatStatusBadge, formatListSummary, formatDetailBullets } from '../../utils/textHelper';
import { extractDateFromText, extractDateRangeFromText, formatWaktuDisplay, getGreetingWib, formatWaktuProtokol } from '../../utils/dateHelper';

export class JadwalHandler {
  /**
   * Merender format kartu satu agenda kegiatan dalam daftar sesuai standar resmi protokol
   */
  private formatJadwalItem(j: NormalizedJadwal, index: number, showTanggal: boolean = false): string {
    const waktuStr = formatWaktuProtokol(j.waktuMulai, j.waktuSelesai);

    let headerItem = `*${index}. Pukul ${waktuStr}*`;
    if (showTanggal) {
      const tglIndo = formatTanggalIndo(j.tanggalKegiatan, true);
      headerItem = `*${index}. ${tglIndo} | Pukul ${waktuStr}*`;
    }

    // Status disposisi / arahan pimpinan (muncul di akhir nama kegiatan dalam kurung)
    let statusKeterangan = '';
    const statusLower = (j.statusDisposisi || '').toLowerCase();
    const arahanLower = (j.arahan || '').toLowerCase();

    if (j.statusDisposisiCode === 3 || statusLower.includes('diwakilkan')) {
      if (j.pejabatHadir && j.pejabatHadir !== '-' && !j.pejabatHadir.toLowerCase().includes('diwakilkan')) {
        statusKeterangan = ` *(Diwakilkan ${j.pejabatHadir.trim()})*`;
      } else if (j.arahan && j.arahan.trim() !== '') {
        const arahanClean = j.arahan.trim().replace(/^[\(\[]|[\)\]]$/g, '');
        statusKeterangan = ` *(${arahanClean})*`;
      } else {
        statusKeterangan = ` *(Diwakilkan)*`;
      }
    } else if (j.statusDisposisiCode === 2 || statusLower.includes('reschedule') || statusLower.includes('jadwalkan ulang')) {
      statusKeterangan = ` *(Dijadwalkan Ulang)*`;
    } else if (j.statusDisposisiCode === 4 || statusLower.includes('cancel') || statusLower.includes('batal')) {
      statusKeterangan = ` *(Dibatalkan)*`;
    } else if (
      j.statusDisposisiCode === null ||
      statusLower.includes('belum') ||
      statusLower.includes('tidak ada') ||
      (!j.statusDisposisi && !j.arahan)
    ) {
      statusKeterangan = ` *(Belum ada disposisi)*`;
    } else if (j.arahan && j.arahan.trim() !== '' && !arahanLower.includes('agendakan')) {
      const arahanClean = j.arahan.trim().replace(/^[\(\[]|[\)\]]$/g, '');
      statusKeterangan = ` *(${arahanClean})*`;
    }

    // Nama kegiatan menggunakan blockquote ('> ')
    let cleanNama = j.namaKegiatan.trim();
    if (!cleanNama.endsWith('.') && !cleanNama.endsWith('!') && !cleanNama.endsWith('?')) {
      cleanNama += '.';
    }
    const quoteLines = `> ${cleanNama}${statusKeterangan}`;

    // Baris Lokasi
    const rawLokasi = j.lokasi && j.lokasi !== '-' ? j.lokasi.trim() : 'Belum ditentukan';
    const lokasiStr = rawLokasi.endsWith('.') ? rawLokasi : `${rawLokasi}.`;
    const lokasiLine = `*Lokasi:* ${lokasiStr}`;

    // Baris PIC
    let picLine = '';
    if (j.pic && j.pic.trim() !== '-' && j.pic.trim() !== '') {
      const rawPic = j.pic.trim();
      const picStr = rawPic.endsWith('.') || rawPic.endsWith(')') ? rawPic : `${rawPic}.`;
      picLine = `\n*PIC:* ${picStr}`;
    }

    return `${headerItem}\n${quoteLines}\n\n${lokasiLine}${picLine}`;
  }

  /**
   * Menampilkan menu Jadwal Kegiatan (Hari Ini)
   */
  public async showJadwalMenu(session: UserSession): Promise<BotResponse> {
    sessionService.setState(session.whatsappNumber, BotState.JADWAL_MENU);

    const todayStr = jadwalService.getTodayString();
    const todayFormatted = formatTanggalIndo(todayStr, true);
    const todayUpper = todayFormatted.toUpperCase();
    const greeting = getGreetingWib();

    // Ambil seluruh agenda kegiatan hari ini
    const jadwalsHariIni = await jadwalService.getJadwalHariIni(false, false);

    if (jadwalsHariIni.length === 0) {
      const text =
        `*JADWAL KEGIATAN PROTOKOL*\n` +
        `*${todayUpper}*\n\n` +
        `${greeting}\n` +
        `Mohon izin menyampaikan bahwa tidak ada agenda kegiatan protokol yang terdaftar untuk hari ini (${todayFormatted}).\n\n` +
        `Demikian informasi kami sampaikan. Terima kasih.`;
      return { text };
    }

    session.jadwalSearchResults = jadwalsHariIni;
    session.jadwalSearchKeyword = 'Agenda Hari Ini';
    sessionService.setState(session.whatsappNumber, BotState.JADWAL_CARI_HASIL);

    const listText = jadwalsHariIni
      .map((j, idx) => this.formatJadwalItem(j, idx + 1, false))
      .join('\n\n');

    const text =
      `*JADWAL KEGIATAN PROTOKOL*\n` +
      `*${todayUpper}*\n\n` +
      `${greeting}\n` +
      `Mohon izin menyampaikan jadwal kegiatan protokol untuk hari ini, ${todayFormatted}, sebagai berikut:\n\n` +
      `${listText}\n\n` +
      `Demikian informasi kami sampaikan. Terima kasih.`;

    return { text };
  }

  /**
   * Menampilkan jadwal kegiatan untuk besok (H+1)
   */
  public async showJadwalBesok(session: UserSession): Promise<BotResponse> {
    sessionService.setState(session.whatsappNumber, BotState.JADWAL_MENU);

    const tomorrowStr = jadwalService.getTomorrowString();
    const tomorrowFormatted = formatTanggalIndo(tomorrowStr, true);
    const tomorrowUpper = tomorrowFormatted.toUpperCase();
    const greeting = getGreetingWib();

    const jadwalsBesok = await jadwalService.getJadwalBesok();

    if (jadwalsBesok.length === 0) {
      const nextResult = await jadwalService.getJadwalBerikutnyaTerdekat();
      const nextInfo = nextResult
        ? `\n\n💡 *Agenda terdekat berikutnya:* ${nextResult.item.namaKegiatan} pada hari *${formatTanggalIndo(nextResult.item.tanggalKegiatan)}* pukul ${formatWaktuProtokol(nextResult.item.waktuMulai, nextResult.item.waktuSelesai)}.`
        : '';
      const text =
        `*JADWAL KEGIATAN PROTOKOL*\n` +
        `*${tomorrowUpper}*\n\n` +
        `${greeting}\n` +
        `Mohon izin menyampaikan bahwa tidak ada agenda kegiatan protokol yang terdaftar untuk besok (${tomorrowFormatted}).${nextInfo}\n\n` +
        `Demikian informasi kami sampaikan. Terima kasih.`;
      return { text };
    }

    session.jadwalSearchResults = jadwalsBesok;
    session.jadwalSearchKeyword = 'Agenda Besok';
    sessionService.setState(session.whatsappNumber, BotState.JADWAL_CARI_HASIL);

    const listText = jadwalsBesok
      .map((j, idx) => this.formatJadwalItem(j, idx + 1, false))
      .join('\n\n');

    const text =
      `*JADWAL KEGIATAN PROTOKOL*\n` +
      `*${tomorrowUpper}*\n\n` +
      `${greeting}\n` +
      `Mohon izin menyampaikan jadwal kegiatan protokol untuk besok, ${tomorrowFormatted}, sebagai berikut:\n\n` +
      `${listText}\n\n` +
      `Demikian informasi kami sampaikan. Terima kasih.`;

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
    const greeting = getGreetingWib();
    const formattedDateUpper = formattedDate.toUpperCase();

    if (items.length === 0) {
      sessionService.setState(session.whatsappNumber, BotState.JADWAL_MENU);
      const text =
        `*JADWAL KEGIATAN PROTOKOL*\n` +
        `*${formattedDateUpper}*\n\n` +
        `${greeting}\n` +
        `Mohon izin menyampaikan bahwa tidak ada agenda kegiatan protokol yang terdaftar untuk ${formattedDate}.\n\n` +
        `Demikian informasi kami sampaikan. Terima kasih.`;
      return { text };
    }

    session.jadwalSearchResults = items;
    session.jadwalSearchKeyword = formattedDate;
    sessionService.setState(session.whatsappNumber, BotState.JADWAL_CARI_HASIL);

    const listText = items
      .map((j, idx) => this.formatJadwalItem(j, idx + 1, false))
      .join('\n\n');

    const text =
      `*JADWAL KEGIATAN PROTOKOL*\n` +
      `*${formattedDateUpper}*\n\n` +
      `${greeting}\n` +
      `Mohon izin menyampaikan jadwal kegiatan protokol untuk ${formattedDate}, sebagai berikut:\n\n` +
      `${listText}\n\n` +
      `Demikian informasi kami sampaikan. Terima kasih.`;

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
    const greeting = getGreetingWib();
    const labelUpper = label.toUpperCase();

    if (items.length === 0) {
      sessionService.setState(session.whatsappNumber, BotState.JADWAL_MENU);
      const text =
        `*JADWAL KEGIATAN PROTOKOL*\n` +
        `*PERIODE: ${formattedRange.toUpperCase()} (${labelUpper})*\n\n` +
        `${greeting}\n` +
        `Mohon izin menyampaikan bahwa tidak ada agenda kegiatan protokol yang terdaftar untuk periode ${label.toLowerCase()} (${formattedRange}).\n\n` +
        `Demikian informasi kami sampaikan. Terima kasih.`;
      return { text };
    }

    session.jadwalSearchResults = items;
    session.jadwalSearchKeyword = label;
    sessionService.setState(session.whatsappNumber, BotState.JADWAL_CARI_HASIL);

    const listText = items
      .map((j, idx) => this.formatJadwalItem(j, idx + 1, true))
      .join('\n\n');

    const text =
      `*JADWAL KEGIATAN PROTOKOL*\n` +
      `*PERIODE: ${formattedRange.toUpperCase()} (${labelUpper})*\n\n` +
      `${greeting}\n` +
      `Mohon izin menyampaikan jadwal kegiatan protokol untuk periode ${label.toLowerCase()} (${formattedRange}), sebagai berikut:\n\n` +
      `${listText}\n\n` +
      `Demikian informasi kami sampaikan. Terima kasih.`;

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
      .map((j, idx) => this.formatJadwalItem(j, idx + 1, true))
      .join('\n\n');
    const greeting = getGreetingWib();
    const keywordUpper = keyword.toUpperCase();

    const text =
      `*JADWAL KEGIATAN PROTOKOL*\n` +
      `*HASIL PENCARIAN: "${keywordUpper}"*\n\n` +
      `${greeting}\n` +
      `Mohon izin menyampaikan jadwal kegiatan protokol terkait "${keyword}", sebagai berikut:\n\n` +
      `${listText}\n\n` +
      `Demikian informasi kami sampaikan. Terima kasih.`;

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
      const fileUrl = getLetterFileUrl(item.surat.fileName);
      const noSurat = item.surat.nomorSurat && item.surat.nomorSurat !== '-' ? ` (No: ${item.surat.nomorSurat})` : '';
      suratNote = `\n• *Surat Terkait*    : ${item.surat.nomorAgenda}${noSurat}`;
      if (fileUrl) {
        suratNote += `\n• *Link Berkas*      : ${fileUrl}`;
      }
    }

    const statusBadge = formatStatusBadge(item.statusDisposisi, item.statusDisposisiCode);
    const arahanLine = item.arahan && item.arahan.trim() !== '' ? `\n• *Arahan Pimpinan* : ${item.arahan.trim()}` : '';
    const picLine = item.pic && item.pic.trim() !== '-' ? `\n• *PIC & Kontak*    : ${item.pic.trim()}` : '';

    let pesertaSection = '';
    if (item.peserta && item.peserta.trim() !== '') {
      const bullets = formatDetailBullets(item.peserta);
      if (bullets) {
        pesertaSection = `\n\n👥 *Daftar Peserta Rapat*:\n${bullets}`;
      }
    }

    let pendampingSection = '';
    if (item.pendamping && item.pendamping.trim() !== '') {
      const bullets = formatDetailBullets(item.pendamping);
      if (bullets) {
        pendampingSection = `\n\n🤝 *Daftar Pendamping*:\n${bullets}`;
      }
    } else if (item.pejabatHadir && item.pejabatHadir.trim() !== '-') {
      pendampingSection = `\n• *Pejabat Hadir*   : ${item.pejabatHadir.trim()}`;
    }

    let catatanSection = '';
    if (item.catatan && item.catatan.trim() !== '') {
      const bullets = formatDetailBullets(item.catatan);
      if (bullets) {
        catatanSection = `\n\nℹ️ *Catatan Khusus*:\n${bullets}`;
      }
    }

    return {
      text:
        `📌 *RINCIAN JADWAL KEGIATAN*\n\n` +
        `• *Kegiatan*        : *${item.namaKegiatan}*\n` +
        `• *Tanggal*         : ${formattedDate}\n` +
        `• *Waktu*           : ${waktu}\n` +
        `• *Lokasi*          : ${item.lokasi && item.lokasi !== '-' ? item.lokasi : 'Belum ditentukan'}\n` +
        `• *Status Disposisi*: ${statusBadge}` +
        arahanLine +
        picLine +
        suratNote +
        pesertaSection +
        pendampingSection +
        catatanSection +
        `\n\n─────────────────────────\n` +
        `Bila Anda ingin mencari agenda lainnya atau kembali ke menu utama, silakan beri tahu saya ya. 😊`,
    };
  }

  /**
   * Menangani aksi saat berada di tampilan hasil pencarian jadwal
   */
  public async handleSearchResultInput(session: UserSession, input: string, nlu?: NluResult): Promise<BotResponse> {
    const clean = input.trim();
    const lower = clean.toLowerCase();

    if (
      isPureGreeting(clean) ||
      nlu?.intent === 'GREETING' ||
      clean === '0' ||
      lower === 'kembali' ||
      lower === 'menu' ||
      lower === 'batal' ||
      nlu?.intent === 'BATAL'
    ) {
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

    if (
      isPureGreeting(clean) ||
      nlu?.intent === 'GREETING' ||
      clean === '0' ||
      lower === 'kembali' ||
      lower === 'menu' ||
      lower === 'batal'
    ) {
      sessionService.resetSession(session.whatsappNumber);
      return menuHandler.getMainGreeting(session);
    }

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
      const statusDisp = formatStatusBadge(item.statusDisposisi, item.statusDisposisiCode);

      session.jadwalSearchResults = [item];
      session.jadwalSearchKeyword = item.namaKegiatan;
      sessionService.setState(session.whatsappNumber, BotState.JADWAL_CARI_HASIL);

      let extraDetails = '';
      if (item.arahan) extraDetails += `\n📝 *Arahan Pimpinan* : ${item.arahan}`;
      if (item.peserta) extraDetails += `\n👥 *Peserta*         : ${formatListSummary(item.peserta, 2)}`;
      if (item.pendamping) extraDetails += `\n🤝 *Pendamping*      : ${formatListSummary(item.pendamping, 2)}`;
      else if (item.pejabatHadir && item.pejabatHadir !== '-') extraDetails += `\n👥 *Pejabat Hadir*   : ${item.pejabatHadir}`;
      if (item.catatan) extraDetails += `\nℹ️ *Catatan*         : ${formatListSummary(item.catatan, 1)}`;

      const text =
        `⏰ *KEGIATAN TERDEKAT BERIKUTNYA (${statusLabel})*\n\n` +
        `📌 *Kegiatan*            : ${item.namaKegiatan}\n` +
        `📅 *Tanggal Pelaksanaan* : ${formattedDate}\n` +
        `🕒 *Waktu*               : ${waktu}\n` +
        `📍 *Lokasi*              : ${item.lokasi}\n` +
        `📋 *Status Disposisi*    : ${statusDisp}` +
        extraDetails +
        `\n📞 *PIC*                 : ${item.pic || '-'}\n\n` +
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
        .map((j, idx) => this.formatJadwalItem(j, idx + 1, true))
        .join('\n\n');
      const greeting = getGreetingWib();

      return {
        text:
          `*JADWAL KEGIATAN PROTOKOL*\n` +
          `*AGENDA MENDATANG*\n\n` +
          `${greeting}\n` +
          `Mohon izin menyampaikan jadwal kegiatan protokol untuk beberapa hari ke depan, sebagai berikut:\n\n` +
          `${listText}\n\n` +
          `Demikian informasi kami sampaikan. Terima kasih.`,
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
