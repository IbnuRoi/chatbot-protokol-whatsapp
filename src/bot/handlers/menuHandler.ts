import { UserSession } from '../../services/sessionService';
import { BotResponse } from '../types';

export class MenuHandler {
  /**
   * Tampilan bubble percakapan AI utama saat pengguna menyapa atau membuka menu
   */
  public getMainGreeting(session: UserSession, customIntro?: string): BotResponse {
    if (customIntro) {
      return {
        text: `${customIntro}\n\nAda hal lain yang bisa saya bantu terkait persuratan atau agenda kegiatan protokol hari ini? 😊`,
      };
    }

    const text =
      `Halo *${session.userName}*! 👋\n\n` +
      `Saya asisten AI Protokol Kementerian Ketenagakerjaan RI. Saya siap membantu Anda mengurus registrasi *Surat Masuk*, mengecek agenda *Jadwal Kegiatan*, melacak *Status Disposisi*, maupun mencari arsip persuratan dinas.\n\n` +
      `Ada yang bisa saya bantu hari ini? Silakan langsung sampaikan apa yang Anda perlukan ya. 😊`;

    return { text };
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
