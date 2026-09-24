import { sessionService, BotState, UserSession } from '../../services/sessionService';
import { suratService } from '../../services/suratService';
import { jadwalService, formatTanggalIndo } from '../../services/jadwalService';
import { nluService, NluResult } from '../../services/nluService';
import { cariSuratHandler } from './cariSuratHandler';
import { menuHandler } from './menuHandler';
import { BotResponse } from '../types';
import { scoreTextMatch, cleanQueryForSelection, formatNomorAgendaLink } from '../../utils/textHelper';
import { NormalizedSurat } from '../../services/suratService';
import { NormalizedJadwal } from '../../services/jadwalService';

export interface HybridSearchContext {
  startDate?: Date;
  endDate?: Date;
  location?: string;
  sender?: string;
  dateLabel?: string;
}

export class HybridSearchHandler {
  /**
   * Menjalankan pencarian terpadu di arsip Surat Masuk dan Agenda Jadwal Kegiatan secara paralel
   * dengan memperhitungkan konteks topik, pengirim, lokasi, dan rentang waktu.
   */
  public async handleSearch(
    session: UserSession,
    input: string,
    context?: HybridSearchContext
  ): Promise<BotResponse> {
    let clean = input.trim();

    if (clean.toLowerCase() === 'batal' || clean.toLowerCase() === 'menu') {
      sessionService.resetSession(session.whatsappNumber);
      return menuHandler.getMainGreeting(session);
    }

    const extracted = nluService.extractSearchKeyword(clean);
    if (extracted && extracted.length >= 2) {
      clean = extracted;
    }

    if (clean.length < 2) {
      return {
        text: `Topik pencarian terlalu singkat. Boleh berikan minimal 2 karakter kata atau topik yang ingin dicari? 😊`,
      };
    }

    // 1. Eksekusi pencarian dengan filter konteks (waktu, pengirim, lokasi) jika tersedia
    let [letters, schedules] = await Promise.all([
      suratService.searchSuratByPerihal(clean, {
        dateStart: context?.startDate,
        dateEnd: context?.endDate,
        sender: context?.sender,
      }),
      jadwalService.searchJadwal(clean, {
        startDate: context?.startDate,
        endDate: context?.endDate,
        location: context?.location,
      }),
    ]);

    // 2. Fallback cerdas: Jika filter waktu membuat hasil kosong, cari secara luas tanpa batas waktu
    let timeFilterRelaxed = false;
    if (letters.length === 0 && schedules.length === 0 && (context?.startDate || context?.endDate)) {
      const [broadLetters, broadSchedules] = await Promise.all([
        suratService.searchSuratByPerihal(clean),
        jadwalService.searchJadwal(clean),
      ]);
      if (broadLetters.length > 0 || broadSchedules.length > 0) {
        letters = broadLetters;
        schedules = broadSchedules;
        timeFilterRelaxed = true;
      }
    }

    // Simpan ke sesi
    session.searchKeyword = clean;
    session.searchResults = letters;
    session.jadwalSearchKeyword = clean;
    session.jadwalSearchResults = schedules;

    const timeNotice =
      timeFilterRelaxed && context?.dateLabel
        ? `_ℹ️ Catatan: Belum ditemukan agenda/surat khusus pada ${context.dateLabel}. Berikut arsip terdekat terkait "${clean}":_\n\n`
        : '';

    // Skenario 1: Keduanya memiliki hasil yang cocok -> Tampilkan dalam SATU bubble chat bersamaan
    if (letters.length > 0 && schedules.length > 0) {
      sessionService.setState(session.whatsappNumber, BotState.SEARCH_HYBRID_HASIL);
      const res = this.renderHybridResults(session);
      if (timeNotice) {
        return typeof res === 'string'
          ? `${timeNotice}${res}`
          : { ...res, text: `${timeNotice}${res.text}` };
      }
      return res;
    }

    // Skenario 2: Hanya Surat Masuk yang ditemukan
    if (letters.length > 0 && schedules.length === 0) {
      sessionService.setState(session.whatsappNumber, BotState.CARI_SURAT_HASIL_LIST);
      const res = cariSuratHandler.renderSearchResults(session);
      if (timeNotice) {
        return typeof res === 'string'
          ? `${timeNotice}${res}`
          : { ...res, text: `${timeNotice}${res.text}` };
      }
      return res;
    }

    // Skenario 3: Hanya Jadwal Kegiatan yang ditemukan
    if (letters.length === 0 && schedules.length > 0) {
      sessionService.setState(session.whatsappNumber, BotState.JADWAL_CARI_HASIL);

      const listText = schedules
        .map((j, idx) => {
          const waktu = j.waktuSelesai ? `${j.waktuMulai} - ${j.waktuSelesai}` : j.waktuMulai;
          const formattedDate = formatTanggalIndo(j.tanggalKegiatan);
          return (
            `*${idx + 1}.* 📌 *${j.namaKegiatan}*\n` +
            `   📅 *Tanggal Pelaksanaan* : ${formattedDate}\n` +
            `   🕒 *Waktu*   : ${waktu} WIB\n` +
            `   📍 *Lokasi*  : ${j.lokasi}\n` +
            `   📋 *Status Disposisi* : ${j.statusDisposisi || 'Terjadwal (On Schedule)'}\n` +
            `   👥 *Hadir*   : ${j.pejabatHadir || '-'}\n` +
            `   📞 *PIC*     : ${j.pic || '-'}`
          );
        })
        .join('\n\n');

      return {
        text:
          `${timeNotice}` +
          `🔍 *HASIL PENCARIAN JADWAL KEGIATAN*\n` +
          `Ditemukan *${schedules.length} agenda kegiatan* untuk pencarian *"${clean}"*:\n\n` +
          `${listText}\n\n` +
          `Silakan beri tahu saya jika Anda memerlukan informasi lebih lanjut mengenai kegiatan di atas atau ingin mencari agenda lainnya ya.`,
      };
    }

    // Skenario 4: Tidak ditemukan hasil di kedua layanan
    sessionService.setState(session.whatsappNumber, BotState.MAIN_MENU);
    return {
      text:
        `🔎 *HASIL PENCARIAN TERPADU*\n` +
        `Kata Kunci: *"${clean}"*\n\n` +
        `⚠️ _Tidak ditemukan agenda kegiatan maupun arsip surat masuk yang berkaitan dengan kata kunci tersebut._\n\n` +
        `Boleh coba dengan topik atau kata kunci pencarian yang lain? 😊`,
    };
  }

  /**
   * Merender hasil pencarian gabungan (Jadwal & Surat) di dalam SATU bubble chat
   */
  public renderHybridResults(session: UserSession): BotResponse {
    const letters = session.searchResults || [];
    const schedules = session.jadwalSearchResults || [];
    const keyword = session.searchKeyword || '';

    const maxItems = 5;
    const displayedSchedules = schedules.slice(0, maxItems);
    const displayedLetters = letters.slice(0, maxItems);

    // 1. Format bagian Jadwal Kegiatan (dengan tanggal pelaksanaan)
    const jadwalListText = displayedSchedules
      .map((j, idx) => {
        const waktu = j.waktuSelesai ? `${j.waktuMulai} - ${j.waktuSelesai}` : j.waktuMulai;
        const formattedDate = formatTanggalIndo(j.tanggalKegiatan);
        return (
          `*${idx + 1}.* 📌 *${j.namaKegiatan}*\n` +
          `   📅 *Tanggal Pelaksanaan* : ${formattedDate}\n` +
          `   🕒 *Waktu*   : ${waktu} WIB\n` +
          `   📍 *Lokasi*  : ${j.lokasi}\n` +
          `   📋 *Status Disposisi* : ${j.statusDisposisi || 'Terjadwal (On Schedule)'}`
        );
      })
      .join('\n\n');

    // 2. Format bagian Arsip Surat Masuk
    const suratListText = displayedLetters
      .map((s, idx) => {
        const statusIcon = s.disposisi?.status === 'SUDAH_DISPOSISI' ? '🟢 Sudah Disposisi' : '🟡 Belum Disposisi';
        return (
          `*${idx + 1}.* 📑 *${formatNomorAgendaLink(s.nomorAgenda, s.fileName)}*\n` +
          `   • Tanggal : ${s.tanggalSurat}\n` +
          `   • Pengirim: ${s.asalSurat}\n` +
          `   • Perihal : ${s.perihal}\n` +
          `   • Status  : ${statusIcon}`
        );
      })
      .join('\n\n');

    const scheduleNote = schedules.length > maxItems ? ` _(Menampilkan ${maxItems} dari total ${schedules.length} kegiatan)_` : '';
    const letterNote = letters.length > maxItems ? ` _(Menampilkan ${maxItems} dari total ${letters.length} surat)_` : '';

    const text =
      `🔎 *HASIL PENCARIAN TERPADU (JADWAL & SURAT)*\n` +
      `Kata Kunci: *"${keyword}"*\n\n` +
      `Ditemukan *${schedules.length} agenda kegiatan* dan *${letters.length} surat masuk* dengan topik yang serupa:\n\n` +
      `📅 *AGENDA KEGIATAN PROTOKOL*${scheduleNote}:\n` +
      `${jadwalListText}\n\n` +
      `📑 *ARSIP SURAT MASUK*${letterNote}:\n` +
      `${suratListText}\n\n` +
      `Silakan ketik nomor (contoh: *jadwal 1* atau *surat 1*), atau cukup sebutkan *nama agenda* / *perihal surat* untuk melihat rincian lengkapnya ya. 😊`;

    return { text };
  }

  /**
   * Merender detail lengkap agenda kegiatan protokol
   */
  public renderDetailJadwal(item: NormalizedJadwal): BotResponse {
    const waktu = item.waktuSelesai ? `${item.waktuMulai} - ${item.waktuSelesai}` : item.waktuMulai;
    const formattedDate = formatTanggalIndo(item.tanggalKegiatan);

    let suratNote = '';
    if (item.surat?.nomorAgenda) {
      suratNote = `\n• *Surat Terkait*        : ${formatNomorAgendaLink(item.surat.nomorAgenda, item.surat.fileName)}`;
    }

    return {
      text:
        `📌 *RINCIAN AGENDA KEGIATAN*\n\n` +
        `• *Kegiatan*            : ${item.namaKegiatan}\n` +
        `• *Tanggal Pelaksanaan* : ${formattedDate}\n` +
        `• *Waktu*               : ${waktu} WIB\n` +
        `• *Lokasi*              : ${item.lokasi}\n` +
        `• *Status Disposisi*    : ${item.statusDisposisi || 'Terjadwal (On Schedule)'}\n` +
        `• *Pejabat Hadir*       : ${item.pejabatHadir || '-'}\n` +
        `• *PIC*                 : ${item.pic || '-'}` +
        suratNote +
        `\n\nBila Anda ingin melihat dokumen surat terkait atau mencari agenda lainnya, silakan beri tahu saya ya. 😊`,
    };
  }

  /**
   * Menangani navigasi atau pemilihan detail saat berada di tampilan hasil pencarian terpadu
   */
  public async handleHybridListInput(
    session: UserSession,
    input: string,
    nlu?: NluResult
  ): Promise<BotResponse> {
    const clean = input.trim();
    const lower = clean.toLowerCase();

    // 1. Pembatalan atau kembali ke menu
    if (lower === '0' || lower === 'menu' || lower === 'batal' || nlu?.intent === 'BATAL') {
      sessionService.resetSession(session.whatsappNumber);
      return menuHandler.getMainGreeting(session);
    }

    const letters = session.searchResults || [];
    const schedules = session.jadwalSearchResults || [];

    // 2. Pemilihan eksplisit nomor surat (misal "surat 1", "surat ke 2")
    const suratMatch = lower.match(/^surat\s*(?:ke\s*)?(\d+)$/i);
    if (suratMatch) {
      const suratIdx = parseInt(suratMatch[1], 10);
      if (suratIdx >= 1 && suratIdx <= letters.length) {
        const chosen = letters[suratIdx - 1];
        return cariSuratHandler.showDetailSurat(session, chosen.id);
      }
    }

    // 3. Pemilihan eksplisit nomor jadwal (misal "jadwal 1", "agenda 2", "kegiatan 1")
    const jadwalMatch = lower.match(/^(?:jadwal|agenda|kegiatan)\s*(?:ke\s*)?(\d+)$/i);
    if (jadwalMatch) {
      const jIdx = parseInt(jadwalMatch[1], 10);
      if (jIdx >= 1 && jIdx <= schedules.length) {
        return this.renderDetailJadwal(schedules[jIdx - 1]);
      }
    }

    // 4. Pemilihan angka tunggal langsung (misal "1", "2")
    const numericIndex = parseInt(clean, 10);
    if (!isNaN(numericIndex) && numericIndex >= 1 && clean === String(numericIndex)) {
      if (numericIndex <= letters.length && numericIndex > schedules.length) {
        return cariSuratHandler.showDetailSurat(session, letters[numericIndex - 1].id);
      }
      if (numericIndex <= schedules.length && numericIndex > letters.length) {
        return this.renderDetailJadwal(schedules[numericIndex - 1]);
      }
      if (numericIndex <= letters.length && numericIndex <= schedules.length) {
        return cariSuratHandler.showDetailSurat(session, letters[numericIndex - 1].id);
      }
    }

    // 5. PENCARIAN FLUID BERDASARKAN PERIHAL SURAT ATAU NAMA KEGIATAN DARI HASIL YANG SEDANG TAMPIL
    const isExplicitSurat = lower.startsWith('surat ') || lower.includes('surat');
    const isExplicitJadwal =
      lower.startsWith('jadwal ') ||
      lower.startsWith('agenda ') ||
      lower.startsWith('kegiatan ') ||
      lower.includes('jadwal') ||
      lower.includes('kegiatan');

    const cleanQuery = cleanQueryForSelection(clean);

    if (cleanQuery.length >= 2) {
      // Hitung skor kecocokan dengan seluruh surat di daftar hasil saat ini
      let bestLetter: { item: NormalizedSurat; score: number } | null = null;
      for (const letter of letters) {
        const score = Math.max(
          scoreTextMatch(cleanQuery, letter.perihal),
          scoreTextMatch(cleanQuery, letter.subject),
          scoreTextMatch(cleanQuery, letter.nomorAgenda),
          scoreTextMatch(cleanQuery, letter.nomorSurat),
          scoreTextMatch(cleanQuery, letter.asalSurat),
          letter.event ? scoreTextMatch(cleanQuery, letter.event) : 0
        );
        if (!bestLetter || score > bestLetter.score) {
          bestLetter = { item: letter, score };
        }
      }

      // Hitung skor kecocokan dengan seluruh jadwal di daftar hasil saat ini
      let bestSchedule: { item: NormalizedJadwal; score: number } | null = null;
      for (const schedule of schedules) {
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

      // Keputusan pemilihan detail cerdas
      if (isExplicitSurat && bestLetter && bestLetter.score >= 20) {
        return cariSuratHandler.showDetailSurat(session, bestLetter.item.id);
      }

      if (isExplicitJadwal && bestSchedule && bestSchedule.score >= 20) {
        return this.renderDetailJadwal(bestSchedule.item);
      }

      const letterScore = bestLetter?.score || 0;
      const scheduleScore = bestSchedule?.score || 0;

      if (letterScore >= 25 || scheduleScore >= 25) {
        if (letterScore > scheduleScore && bestLetter) {
          return cariSuratHandler.showDetailSurat(session, bestLetter.item.id);
        } else if (scheduleScore > letterScore && bestSchedule) {
          return this.renderDetailJadwal(bestSchedule.item);
        } else if (bestLetter) {
          // Bila skor berimbang, tampilkan detail surat yang relevan
          return cariSuratHandler.showDetailSurat(session, bestLetter.item.id);
        }
      }
    }

    // 6. Jika tidak cocok dengan item manapun yang sedang tampil di layar, jalankan pencarian baru
    if (clean.length >= 2) {
      return this.handleSearch(session, clean);
    }

    return {
      text:
        `Silakan ketik nomor (contoh: _surat 1_), atau sebutkan perihal surat / nama kegiatan yang ingin Anda lihat rinciannya ya. 😊`,
    };
  }
}

export const hybridSearchHandler = new HybridSearchHandler();

