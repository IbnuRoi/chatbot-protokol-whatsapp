import { sessionService, BotState, UserSession } from '../../services/sessionService';
import { disposisiService } from '../../services/disposisiService';
import { menuHandler } from './menuHandler';
import { BotResponse } from '../types';

import { formatNomorAgendaLink } from '../../utils/textHelper';

export class DisposisiHandler {
  /**
   * Menampilkan permintaan input nomor surat / nomor agenda
   */
  public async promptNomor(session: UserSession): Promise<BotResponse> {
    sessionService.setState(session.whatsappNumber, BotState.DISPOSISI_INPUT_NOMOR);

    return {
      text:
        `🔍 *PELACAKAN STATUS DISPOSISI*\n\n` +
        `Boleh sebutkan atau ketikkan *Nomor Agenda* atau *Nomor Surat* yang ingin Anda cek statusnya (misalnya: _UND/2026/09/0001_ atau _B-104/MENKO/MARVES_).`,
    };
  }

  /**
   * Menangani pencarian surat dan menampilkan status disposisi
   */
  public async handleSearch(session: UserSession, input: string): Promise<BotResponse> {
    const clean = input.trim();
    if (clean.toLowerCase() === 'batal' || clean.toLowerCase() === 'menu') {
      sessionService.resetSession(session.whatsappNumber);
      return menuHandler.getMainGreeting(session);
    }

    const surat = await disposisiService.findDisposisiByKeyword(clean);

    sessionService.resetSession(session.whatsappNumber);

    if (!surat) {
      return {
        text:
          `⚠️ *Surat Tidak Ditemukan*\n\n` +
          `Saya belum menemukan arsip surat dengan nomor agenda atau nomor surat *"${clean}"*.\n\n` +
          `Boleh coba periksa kembali nomornya atau beri tahu saya jika ada nomor lain yang ingin dicek?`,
      };
    }

    const disposisi = surat.disposisi;
    const isSudah = disposisi?.status === 'SUDAH_DISPOSISI';

    let statusText = '';
    if (isSudah) {
      const tgl = disposisi?.tanggalDisposisi
        ? new Date(disposisi.tanggalDisposisi).toLocaleDateString('id-ID', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          })
        : '-';

      statusText =
        `🟢 *STATUS: SUDAH DISPOSISI*\n` +
        `📅 *Tanggal Disposisi :* ${tgl}\n` +
        `🎯 *Tujuan Disposisi  :* ${disposisi?.tujuanDisposisi || '-'}\n` +
        `📋 *Instruksi Pimpinan :* ${disposisi?.instruksi || '-'}\n` +
        `📝 *Catatan Khusus    :* ${disposisi?.catatan || '-'}`;
    } else {
      statusText =
        `🟡 *STATUS: BELUM DISPOSISI*\n` +
        `Surat saat ini masih dalam proses penelaahan atau antrean disposisi Pimpinan.`;
    }

    const text =
      `📬 *DETAIL DISPOSISI SURAT*\n\n` +
      `• *Nomor Agenda* : ${formatNomorAgendaLink(surat.nomorAgenda, surat.fileName)}\n` +
      `• *Pengirim*     : ${surat.asalSurat}\n` +
      `• *Perihal*      : ${surat.perihal}\n\n` +
      `${statusText}\n\n` +
      `Silakan beri tahu saya jika Anda ingin memeriksa status surat lainnya ya.`;

    return { text };
  }
}

export const disposisiHandler = new DisposisiHandler();
