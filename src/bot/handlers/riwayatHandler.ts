import { sessionService, BotState, UserSession } from '../../services/sessionService';
import { suratService } from '../../services/suratService';
import { menuHandler } from './menuHandler';
import { BotResponse } from '../types';
import { scoreTextMatch, cleanQueryForSelection, formatNomorAgendaLink } from '../../utils/textHelper';

export class RiwayatHandler {
  /**
   * Menampilkan daftar 5 surat terbaru dengan paginasi teks
   */
  public async showRiwayatList(session: UserSession, page: number = 0): Promise<BotResponse> {
    session.riwayatPage = page;
    sessionService.setState(session.whatsappNumber, BotState.RIWAYAT_LIST);

    const result = await suratService.getRiwayatSurat(page, 5);

    if (result.items.length === 0) {
      return {
        text:
          `📜 *RIWAYAT SURAT MASUK*\n\n` +
          `Saat ini belum ada arsip surat masuk yang tersimpan dalam sistem.\n\n` +
          `Beri tahu saya jika ada hal lain yang bisa saya bantu ya.`,
      };
    }

    const totalPages = Math.ceil(result.totalCount / result.pageSize);
    const currentPageDisplay = page + 1;

    const listText = result.items
      .map((s, idx) => {
        const itemNumber = idx + 1;
        const statusIcon = s.disposisi?.status === 'SUDAH_DISPOSISI' ? '🟢 Disposisi' : '🟡 Belum Disposisi';
        return (
          `*${itemNumber}.* 📑 *${formatNomorAgendaLink(s.nomorAgenda, s.fileName)}*\n` +
          `   • Dari: ${s.asalSurat}\n` +
          `   • Perihal: ${s.perihal}\n` +
          `   • Status: ${statusIcon}`
        );
      })
      .join('\n\n');

    let navHelp = `Silakan sebutkan nomor surat (contoh: _surat 1_), atau cukup sebutkan *perihal surat* jika Anda ingin melihat rincian lengkapnya ya. 😊`;
    if (result.hasNextPage) {
      navHelp += ` Ketik *N* untuk halaman berikutnya.`;
    }
    if (page > 0) {
      navHelp += ` Ketik *P* untuk halaman sebelumnya.`;
    }

    const text =
      `📜 *RIWAYAT SURAT MASUK (Hal. ${currentPageDisplay}/${totalPages || 1})*\n\n` +
      `${listText}\n\n` +
      `${navHelp}`;

    return { text };
  }

  /**
   * Menangani navigasi pada tampilan daftar riwayat
   */
  public async handleListInput(session: UserSession, input: string): Promise<BotResponse> {
    const raw = input.trim();
    const clean = raw.toUpperCase();
    const currentPage = session.riwayatPage || 0;

    if (clean === '0' || clean === 'KEMBALI' || clean === 'MENU' || clean === 'BATAL') {
      sessionService.resetSession(session.whatsappNumber);
      return menuHandler.getMainGreeting(session);
    }

    if (clean === 'N') {
      const nextPage = currentPage + 1;
      const check = await suratService.getRiwayatSurat(nextPage, 5);
      if (check.items.length > 0) {
        return this.showRiwayatList(session, nextPage);
      } else {
        return {
          text: `ℹ️ Anda sudah berada di halaman terakhir riwayat surat. Beri tahu saya jika ingin membuka halaman sebelumnya atau melihat dokumen lain ya.`,
        };
      }
    }

    if (clean === 'P') {
      if (currentPage > 0) {
        return this.showRiwayatList(session, currentPage - 1);
      } else {
        return this.showRiwayatList(session, 0);
      }
    }

    const result = await suratService.getRiwayatSurat(currentPage, 5);

    // 1. Cek pemilihan nomor surat eksplisit (contoh: "surat 1", "surat ke 2")
    const suratMatch = raw.match(/^surat\s*(?:ke\s*)?(\d+)$/i);
    if (suratMatch) {
      const suratIdx = parseInt(suratMatch[1], 10);
      if (suratIdx >= 1 && suratIdx <= result.items.length) {
        return this.showDetailSurat(session, result.items[suratIdx - 1].id);
      }
    }

    // 2. Cek angka tunggal 1-5
    const index = parseInt(clean, 10);
    if (!isNaN(index) && index >= 1 && index <= result.items.length && clean === String(index)) {
      return this.showDetailSurat(session, result.items[index - 1].id);
    }

    // 3. Pencocokan Fluid Teks Berdasarkan Perihal Surat pada Halaman Ini
    const cleanQuery = cleanQueryForSelection(raw);
    if (cleanQuery.length >= 2 && result.items.length > 0) {
      let bestMatch: { item: any; score: number } | null = null;
      for (const letter of result.items) {
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

    return this.showRiwayatList(session, currentPage);
  }

  /**
   * Menampilkan detail lengkap satu surat
   */
  public async showDetailSurat(session: UserSession, suratId: number): Promise<BotResponse> {
    const surat = await suratService.getDetailSurat(suratId);
    if (!surat) {
      return {
        text: `⚠️ Surat tidak ditemukan dalam arsip. Silakan beri tahu jika ingin memeriksa surat lainnya.`,
      };
    }

    session.selectedSuratId = surat.id;
    sessionService.setState(session.whatsappNumber, BotState.RIWAYAT_DETAIL);

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
      `📋 *DETAIL SURAT MASUK*\n\n` +
      `• *Nomor Agenda*   : ${formatNomorAgendaLink(surat.nomorAgenda, surat.fileName)}\n` +
      `• *Jenis / Tipe*    : ${surat.jenisSurat} / ${surat.tipeSurat}\n` +
      `• *Tanggal Surat*   : ${surat.tanggalSurat}\n` +
      `• *Asal Instansi*   : ${surat.asalInstansi}\n` +
      `• *Pengirim*        : ${surat.asalSurat}\n` +
      `• *Event / Acara*   : ${surat.event || '-'}\n` +
      `• *PIC & Kontak*    : ${surat.picPengirim || '-'}\n` +
      `• *Perihal*         : ${surat.perihal}\n` +
      `• *Status Disposisi*: ${statusDisp}\n` +
      `• *Diinput Oleh*    : ${surat.userInput?.nama || 'Petugas'} (${tglInput} WIB)\n\n` +
      `Beri tahu saya jika Anda ingin melihat rincian disposisi atau ingin memeriksa surat lainnya.`;

    return { text };
  }

  /**
   * Menangani aksi pada halaman detail surat
   */
  public async handleDetailInput(session: UserSession, input: string): Promise<BotResponse> {
    const clean = input.trim();
    const lower = clean.toLowerCase();

    if ((clean === '1' || lower.includes('disposisi') || lower.includes('rincian')) && session.selectedSuratId) {
      const surat = await suratService.getDetailSurat(session.selectedSuratId);
      if (!surat || !surat.disposisi) {
        return {
          text: `⚠️ Rincian disposisi belum tersedia untuk surat ini. Silakan tanyakan hal lain jika ada yang ingin dibantu.`,
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
          `${statusInfo}\n\n` +
          `Ada lagi yang ingin Anda periksa terkait surat ini?`,
      };
    } else if (clean === '0' || lower === 'kembali' || lower === 'batal') {
      return this.showRiwayatList(session, session.riwayatPage || 0);
    } else if (lower === 'menu') {
      sessionService.resetSession(session.whatsappNumber);
      return menuHandler.getMainGreeting(session);
    } else {
      return {
        text: `Boleh beri tahu apakah Anda ingin melihat rincian disposisi atau kembali ke daftar riwayat?`,
      };
    }
  }
}

export const riwayatHandler = new RiwayatHandler();
