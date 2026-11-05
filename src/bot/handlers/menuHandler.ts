import { UserSession } from '../../services/sessionService';
import { BotResponse, BotReplyList } from '../types';

export class MenuHandler {
  /**
   * Menu list interaktif standar untuk navigasi layanan protokol Meta WhatsApp Cloud API
   */
  public getMainMenuInteractiveList(): BotReplyList {
    return {
      buttonTitle: '📋 Buka Menu Layanan',
      sections: [
        {
          title: 'Pelayanan & Administrasi',
          rows: [
            {
              id: '1',
              title: '1. Registrasi Surat',
              description: 'Unggah berkas naskah dinas baru (PDF/Foto)',
            },
            {
              id: '2',
              title: '2. Agenda Jadwal',
              description: 'Cek agenda kegiatan protokol pimpinan',
            },
            {
              id: '3',
              title: '3. Disposisi Surat',
              description: 'Catat arahan atau cek status disposisi',
            },
          ],
        },
        {
          title: 'Informasi & Riwayat',
          rows: [
            {
              id: '4',
              title: '4. Riwayat Surat',
              description: 'Daftar surat masuk yang baru didaftarkan',
            },
            {
              id: '5',
              title: '5. Cari Surat & Agenda',
              description: 'Pencarian arsip persuratan dan agenda',
            },
            {
              id: '6',
              title: '6. Bantuan & Panduan',
              description: 'Petunjuk format dan aturan bot',
            },
          ],
        },
      ],
    };
  }

  /**
   * Tampilan bubble percakapan AI utama saat pengguna menyapa atau membuka menu
   */
  public getMainGreeting(session: UserSession, customIntro?: string): BotResponse {
    const list = this.getMainMenuInteractiveList();

    if (customIntro) {
      return {
        text: `${customIntro}\n\nAda hal lain yang bisa saya bantu terkait persuratan atau agenda kegiatan protokol hari ini? Silakan sentuh tombol *Buka Menu Layanan* di bawah atau sampaikan langsung kebutuhan Anda. 😊`,
        list,
      };
    }

    const text =
      `Halo *${session.userName}*! 👋\n\n` +
      `Saya asisten AI Protokol Kementerian Ketenagakerjaan RI. Saya siap membantu Anda mengurus registrasi *Surat Masuk*, mencatat *Jadwal Arahan Langsung*, mencatat & melacak *Disposisi Surat*, mengecek agenda *Jadwal Kegiatan*, maupun mencari arsip persuratan dinas.\n\n` +
      `Silakan sentuh tombol *Buka Menu Layanan* di bawah atau langsung ketik kebutuhan Anda (contoh: _"jadwal hari ini"_ atau angka _1-6_). 😊`;

    return {
      text,
      list,
    };
  }

  public getConversationalGreeting(session: UserSession, greetingIntro?: string): BotResponse {
    return this.getMainGreeting(session, greetingIntro);
  }

  public getInvalidOptionMessage(userName: string = 'Bapak/Ibu'): string {
    return (
      `Mohon maaf *${userName}*, saya belum menangkap maksud dari pesan Anda. Boleh tolong dijelaskan kembali apa yang Anda perlukan? Misalnya terkait registrasi surat masuk, jadwal kegiatan protokol, atau pengecekan disposisi. 😊`
    );
  }
}

export const menuHandler = new MenuHandler();
