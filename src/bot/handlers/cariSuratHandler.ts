import { sessionService, BotState, UserSession } from '../../services/sessionService';
import { suratService, NormalizedSurat } from '../../services/suratService';
import { nluService } from '../../services/nluService';
import { menuHandler } from './menuHandler';
import { riwayatHandler } from './riwayatHandler';
import { BotResponse } from '../types';
import { scoreTextMatch, cleanQueryForSelection, formatNomorAgendaLink } from '../../utils/textHelper';

export class CariSuratHandler {
  /**
   * Menampilkan prompt instruksi pencarian berdasarkan perihal
   */
  public async promptKeyword(session: UserSession): Promise<BotResponse> {
    sessionService.setState(session.whatsappNumber, BotState.CARI_SURAT_INPUT_KEYWORD);

    return {
      text:
        `🔎 *PENCARIAN SURAT MASUK (PERIHAL)*\n\n` +
        `Tentu, silakan sebutkan topik atau perihal surat yang ingin Anda cari. Anda bisa mengetik kata kunci singkat maupun kalimat deskriptif (misalnya: _"rapat koordinasi vokasi"_, _"laporan investigasi k3"_, atau _"audiensi upah buruh"_).`,
    };
  }

  /**
   * Memproses input kata kunci dan menampilkan hasil pencarian
   */
  public async handleSearchKeyword(
    session: UserSession,
    input: string,
    options?: { dateStart?: Date; dateEnd?: Date; sender?: string; dateLabel?: string }
  ): Promise<BotResponse> {
    const raw = input.trim();
    let clean = raw;

    if (clean === '0' || clean.toLowerCase() === 'batal' || clean.toLowerCase() === 'menu') {
      sessionService.resetSession(session.whatsappNumber);
      return menuHandler.getMainGreeting(session);
    }

    if (clean === '5' || clean.toLowerCase() === 'cari surat') {
      return this.promptKeyword(session);
    }

    // Jika pengguna meminta surat terbaru
    const lowerRaw = raw.toLowerCase();
    if (
      lowerRaw === 'terbaru' ||
      lowerRaw === 'terakhir' ||
      lowerRaw === 'surat terbaru' ||
      lowerRaw === 'surat terakhir' ||
      lowerRaw === 'surat masuk terbaru' ||
      lowerRaw === 'daftar surat' ||
      lowerRaw === 'daftar surat masuk' ||
      lowerRaw === 'lihat surat masuk'
    ) {
      return riwayatHandler.showRiwayatList(session, 0);
    }

    // Bersihkan kata pengantar atau perangkai jika pengguna mengetik kalimat percakapan
    const extracted = nluService.extractSearchKeyword(clean);
    if (extracted && extracted.length >= 2) {
      clean = extracted;
    }

    if (
      clean.toLowerCase() === 'terbaru' ||
      clean.toLowerCase() === 'terakhir' ||
      clean.toLowerCase() === 'surat terbaru'
    ) {
      return riwayatHandler.showRiwayatList(session, 0);
    }

    if (clean.length < 2) {
      return {
        text: `Kata kunci pencariannya terlalu singkat. Boleh berikan minimal 2 karakter kata atau topik surat yang ingin dicari?`,
      };
    }

    let results = await suratService.searchSuratByPerihal(clean, options);
    let timeFilterNotice = '';

    // Smart fallback jika tidak ada surat pada tanggal spesifik
    if (results.length === 0 && (options?.dateStart || options?.dateEnd)) {
      const broadResults = await suratService.searchSuratByPerihal(clean);
      if (broadResults.length > 0) {
        results = broadResults;
        timeFilterNotice = options.dateLabel
          ? `_ℹ️ Catatan: Belum ditemukan surat pada ${options.dateLabel}. Berikut arsip surat terdekat terkait "${clean}":_\n\n`
          : `_ℹ️ Catatan: Menampilkan arsip surat terdekat terkait "${clean}":_\n\n`;
      }
    }

    session.searchKeyword = clean;
    session.searchResults = results;

    if (results.length === 0) {
      sessionService.setState(session.whatsappNumber, BotState.CARI_SURAT_INPUT_KEYWORD);
      return {
        text:
          `🔎 *HASIL PENCARIAN SURAT*\n\n` +
          `Tidak ditemukan surat masuk dengan perihal atau kata kunci *"${clean}"*.\n\n` +
          `Boleh coba dengan topik atau kata kunci perihal yang lain?`,
      };
    }

    sessionService.setState(session.whatsappNumber, BotState.CARI_SURAT_HASIL_LIST);
    const res = this.renderSearchResults(session);
    if (timeFilterNotice) {
      return typeof res === 'string'
        ? `${timeFilterNotice}${res}`
        : { ...res, text: `${timeFilterNotice}${res.text}` };
    }
    return res;
  }

  /**
   * Merender tampilan daftar hasil pencarian
   */
  public renderSearchResults(session: UserSession): BotResponse {
    const results = session.searchResults || [];
    const keyword = session.searchKeyword || '';

    const listText = results
      .map((s, idx) => {
        const itemNumber = idx + 1;
        const statusIcon = s.disposisi?.status === 'SUDAH_DISPOSISI' ? '🟢 Sudah Disposisi' : '🟡 Belum Disposisi';
        return (
          `*${itemNumber}.* 📑 *${formatNomorAgendaLink(s.nomorAgenda, s.fileName)}*\n` +
          `   • Tanggal : ${s.tanggalSurat}\n` +
          `   • Pengirim: ${s.asalSurat}\n` +
          `   • Perihal : ${s.perihal}\n` +
          `   • Status  : ${statusIcon}`
        );
      })
      .join('\n\n');

    const text =
      `🔎 *HASIL PENCARIAN SURAT*\n` +
      `Ditemukan *${results.length} surat* yang berkaitan dengan *"${keyword}"*:\n\n` +
      `${listText}\n\n` +
      `Silakan sebutkan nomor surat (contoh: _surat 1_), atau cukup sebutkan *perihal surat* yang ingin Anda lihat rinciannya ya. 😊`;

    return { text };
  }

  /**
   * Menangani navigasi saat berada di daftar hasil pencarian
   */
  public async handleListInput(session: UserSession, input: string, nlu?: any): Promise<BotResponse> {
    const clean = input.trim();
    const lower = clean.toLowerCase();

    if (clean === '0' || lower === 'menu' || lower === 'batal' || nlu?.intent === 'BATAL') {
      sessionService.resetSession(session.whatsappNumber);
      return menuHandler.getMainGreeting(session);
    }

    if (clean === '5' || lower === 'cari') {
      return this.promptKeyword(session);
    }

    const results = session.searchResults || [];

    // 1. Cek pemilihan nomor surat eksplisit (contoh: "surat 1", "surat ke 2")
    const suratMatch = lower.match(/^surat\s*(?:ke\s*)?(\d+)$/i);
    if (suratMatch) {
      const suratIdx = parseInt(suratMatch[1], 10);
      if (suratIdx >= 1 && suratIdx <= results.length) {
        const chosen = results[suratIdx - 1];
        return this.showDetailSurat(session, chosen.id);
      }
    }

    // 2. Cek angka tunggal (contoh: "1", "2")
    const index = parseInt(clean, 10);
    if (!isNaN(index) && index >= 1 && index <= results.length && clean === String(index)) {
      const chosen = results[index - 1];
      return this.showDetailSurat(session, chosen.id);
    }

    // 3. Pencocokan Fluid Teks Berdasarkan Perihal Surat yang Sedang Tampil
    const cleanQuery = cleanQueryForSelection(clean);
    if (cleanQuery.length >= 2 && results.length > 0) {
      let bestMatch: { item: NormalizedSurat; score: number } | null = null;
      for (const letter of results) {
        const score = Math.max(
          scoreTextMatch(cleanQuery, letter.perihal),
          scoreTextMatch(cleanQuery, letter.subject),
          scoreTextMatch(cleanQuery, letter.nomorAgenda),
          scoreTextMatch(cleanQuery, letter.nomorSurat),
          scoreTextMatch(cleanQuery, letter.asalSurat),
          letter.event ? scoreTextMatch(cleanQuery, letter.event) : 0
        );
        if (!bestMatch || score > bestMatch.score) {
          bestMatch = { item: letter, score };
        }
      }

      if (bestMatch && bestMatch.score >= 25) {
        return this.showDetailSurat(session, bestMatch.item.id);
      }
    }

    // 4. Jika NLU mendeteksi keyword pencarian tertentu, cek juga apakah itu cocok dengan surat di list
    if (nlu?.intent === 'CARI_SURAT' && nlu.entities?.keyword) {
      const nluQuery = cleanQueryForSelection(nlu.entities.keyword);
      if (nluQuery.length >= 2 && results.length > 0) {
        let bestMatch: { item: NormalizedSurat; score: number } | null = null;
        for (const letter of results) {
          const score = Math.max(
            scoreTextMatch(nluQuery, letter.perihal),
            scoreTextMatch(nluQuery, letter.subject),
            scoreTextMatch(nluQuery, letter.nomorAgenda),
            scoreTextMatch(nluQuery, letter.nomorSurat),
            scoreTextMatch(nluQuery, letter.asalSurat),
            letter.event ? scoreTextMatch(nluQuery, letter.event) : 0
          );
          if (!bestMatch || score > bestMatch.score) {
            bestMatch = { item: letter, score };
          }
        }

        if (bestMatch && bestMatch.score >= 25) {
          return this.showDetailSurat(session, bestMatch.item.id);
        }
      }

      return this.handleSearchKeyword(session, nlu.entities.keyword);
    }

    // 5. Jika pengguna mengetik kata kunci pencarian baru yang tidak cocok dengan daftar
    if (clean.length >= 2) {
      const extracted = nluService.extractSearchKeyword(clean);
      return this.handleSearchKeyword(session, extracted || clean);
    }

    return {
      text:
        `Silakan ketik nomor surat (contoh: _surat 1_), atau sebutkan perihal surat yang ingin Anda lihat rinciannya ya. 😊`,
    };
  }

  /**
   * Menampilkan detail lengkap satu surat hasil pencarian
   */
  public async showDetailSurat(session: UserSession, suratId: number): Promise<BotResponse> {
    const surat = await suratService.getDetailSurat(suratId);
    if (!surat) {
      return {
        text: `Surat yang Anda cari tidak ditemukan di sistem.`,
      };
    }

    session.selectedSuratId = surat.id;
    sessionService.setState(session.whatsappNumber, BotState.CARI_SURAT_DETAIL);

    const disposisi = surat.disposisi;
    const statusDisp = disposisi?.status === 'SUDAH_DISPOSISI' ? '🟢 SUDAH DISPOSISI' : '🟡 BELUM DISPOSISI';
    const tglInput = surat.createdAt.toLocaleDateString('id-ID', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    const text =
      `📋 *DETAIL SURAT MASUK (PENCARIAN)*\n\n` +
      `• *Nomor Agenda*   : ${formatNomorAgendaLink(surat.nomorAgenda, surat.fileName)}\n` +
      `• *Jenis / Tipe*    : ${surat.jenisSurat} / ${surat.tipeSurat}\n` +
      `• *Tanggal Surat*   : ${surat.tanggalSurat}\n` +
      `• *Asal Instansi*   : ${surat.asalInstansi}\n` +
      `• *Pengirim*        : ${surat.asalSurat}\n` +
      `• *Event / Acara*   : ${surat.event || '-'}\n` +
      `• *PIC & Kontak*    : ${surat.picPengirim || '-'}\n` +
      `• *Perihal*         : ${surat.perihal}\n` +
      `• *Status Disposisi*: ${statusDisp}\n` +
      `• *Perekaman*       : Diinput oleh ${surat.userInput?.nama || 'Petugas'} (${tglInput} WIB)\n\n` +
      `Bila Anda ingin melihat rincian disposisi surat ini atau kembali ke daftar pencarian, silakan beri tahu saya ya.`;

    return { text };
  }

  /**
   * Menangani aksi saat di halaman detail surat hasil pencarian
   */
  public async handleDetailInput(session: UserSession, input: string): Promise<BotResponse> {
    const clean = input.trim();

    const lower = clean.toLowerCase();

    if ((clean === '1' || lower.includes('disposisi')) && session.selectedSuratId) {
      const surat = await suratService.getDetailSurat(session.selectedSuratId);
      if (!surat || !surat.disposisi) {
        return {
          text: `Rincian disposisi untuk surat ini belum tersedia di sistem.`,
        };
      }

      const d = surat.disposisi;
      const isSudah = d.status === 'SUDAH_DISPOSISI';
      const tgl = d.tanggalDisposisi
        ? new Date(d.tanggalDisposisi).toLocaleDateString('id-ID', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          })
        : '-';

      let statusInfo = '';
      if (isSudah) {
        statusInfo =
          `🟢 *STATUS: SUDAH DISPOSISI*\n` +
          `📅 *Tanggal Disposisi :* ${tgl}\n` +
          `🎯 *Tujuan Disposisi  :* ${d.tujuanDisposisi || '-'}\n` +
          `📋 *Instruksi Pimpinan :* ${d.instruksi || '-'}\n` +
          `📝 *Catatan Khusus    :* ${d.catatan || '-'}`;
      } else {
        statusInfo = `🟡 *STATUS: BELUM DISPOSISI*\nSurat belum menerima instruksi disposisi dari Pimpinan.`;
      }

      return {
        text:
          `📬 *RINCIAN DISPOSISI (${surat.nomorAgenda})*\n\n` +
          `${statusInfo}`,
      };
    } else if (
      clean === 'back_list' ||
      clean === '2' ||
      clean === '0' ||
      lower.includes('kembali') ||
      lower.includes('daftar') ||
      lower.includes('list')
    ) {
      sessionService.setState(session.whatsappNumber, BotState.CARI_SURAT_HASIL_LIST);
      return this.renderSearchResults(session);
    } else if (lower === 'menu' || lower === 'batal') {
      sessionService.resetSession(session.whatsappNumber);
      return menuHandler.getMainGreeting(session);
    } else {
      // Cek apakah user langsung menyebut perihal atau nomor surat lain yang ada di searchResults
      const results = session.searchResults || [];
      const suratMatch = lower.match(/^surat\s*(?:ke\s*)?(\d+)$/i);
      if (suratMatch) {
        const suratIdx = parseInt(suratMatch[1], 10);
        if (suratIdx >= 1 && suratIdx <= results.length) {
          return this.showDetailSurat(session, results[suratIdx - 1].id);
        }
      }

      const cleanQuery = cleanQueryForSelection(clean);
      if (cleanQuery.length >= 2 && results.length > 0) {
        let bestMatch: { item: NormalizedSurat; score: number } | null = null;
        for (const letter of results) {
          const score = Math.max(
            scoreTextMatch(cleanQuery, letter.perihal),
            scoreTextMatch(cleanQuery, letter.subject),
            scoreTextMatch(cleanQuery, letter.nomorAgenda),
            scoreTextMatch(cleanQuery, letter.nomorSurat),
            scoreTextMatch(cleanQuery, letter.asalSurat),
            letter.event ? scoreTextMatch(cleanQuery, letter.event) : 0
          );
          if (!bestMatch || score > bestMatch.score) {
            bestMatch = { item: letter, score };
          }
        }

        if (bestMatch && bestMatch.score >= 25) {
          return this.showDetailSurat(session, bestMatch.item.id);
        }
      }

      return {
        text: `Boleh beri tahu apakah Anda ingin melihat rincian disposisi surat ini, kembali ke daftar pencarian, atau mencari topik lainnya? 😊`,
      };
    }
  }
}

export const cariSuratHandler = new CariSuratHandler();