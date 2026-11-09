import { UserSession, isGufronation } from '../../services/sessionService';
import { ProtocolScope } from '../../database/dbManager';
import { BotResponse, BotReplyList } from '../types';

export class MenuHandler {
  /**
   * Menu list interaktif standar untuk navigasi layanan protokol Meta WhatsApp Cloud API
   */
  public getMainMenuInteractiveList(
    scope: ProtocolScope = 'MENAKER',
    isGufron: boolean = false
  ): BotReplyList {
    const isWamen = scope === 'WAMEN';
    const sections: any[] = [
      {
        title: `Pelayanan & Administrasi (${isWamen ? 'Wamen' : 'Menaker'})`,
        rows: [
          {
            id: '1',
            title: '1. Registrasi Surat',
            description: `Unggah berkas naskah dinas baru (${isWamen ? 'Wamen' : 'Menaker'})`,
          },
          {
            id: '2',
            title: '2. Agenda Jadwal',
            description: `Cek agenda kegiatan protokol ${isWamen ? 'Wamen' : 'Menaker'}`,
          },
          {
            id: '3',
            title: '3. Disposisi Surat',
            description: `Lacak status & arahan disposisi ${isWamen ? 'Wamen' : 'Menaker'}`,
          },
          {
            id: 'UPLOAD_DISPOSISI',
            title: '📤 Upload Disposisi',
            description: `Unggah foto / scan PDF lembar disposisi pimpinan`,
          },
        ],
      },
      {
        title: 'Informasi & Arsip',
        rows: [
          {
            id: '4',
            title: '4. Riwayat Surat',
            description: `Daftar surat masuk ${isWamen ? 'Wamen' : 'Menaker'} terkini`,
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
    ];

    // Opsi khusus peralihan ruang lingkup (EKSKLUSIF untuk user Gufronation)
    if (isGufron) {
      sections.push({
        title: 'Ruang Lingkup Pimpinan',
        rows: [
          {
            id: 'SWITCH_SCOPE',
            title: isWamen ? '🏛️ Switch ke Menteri' : '🏛️ Switch ke Wamen',
            description: isWamen
              ? 'Beralih ke arsip & agenda Protokol Menteri'
              : 'Beralih ke arsip & agenda Protokol Wakil Menteri',
          },
        ],
      });
    }

    return {
      buttonTitle: '📋 Buka Menu Layanan',
      sections,
    };
  }

  /**
   * Tampilan bubble percakapan AI utama saat pengguna menyapa atau membuka menu
   */
  public getMainGreeting(session: UserSession, customIntro?: string): BotResponse {
    const scope = session.scope || 'MENAKER';
    const isWamen = scope === 'WAMEN';
    const scopeBadge = isWamen ? '🏛️ *[AGENDA PROTOKOL WAKIL MENTERI]*' : '🏛️ *[AGENDA PROTOKOL MENTERI]*';
    const isGufron = isGufronation(session);
    const list = this.getMainMenuInteractiveList(scope, isGufron);

    const gufronSwitchNote = isGufron
      ? isWamen
        ? `\n\n💡 *Akses Khusus Dual-Scope:*\nAnda memiliki akses ganda. Anda dapat beralih ke ruang lingkup *Menteri* kapan saja melalui menu di bawah atau dengan mengetik */menaker*.`
        : `\n\n💡 *Akses Khusus Dual-Scope:*\nAnda memiliki akses ganda. Anda dapat beralih ke ruang lingkup *Wakil Menteri* kapan saja melalui menu di bawah atau dengan mengetik */wamen*.`
      : '';

    if (customIntro) {
      return {
        text: `${scopeBadge}\n\n${customIntro}${gufronSwitchNote}\n\nAda hal lain yang bisa saya bantu terkait persuratan atau agenda kegiatan protokol hari ini? Silakan sentuh tombol *Buka Menu Layanan* di bawah atau sampaikan langsung kebutuhan Anda. 😊`,
        list,
      };
    }

    const text =
      `${scopeBadge}\n\n` +
      `Halo *${session.userName}*! 👋\n\n` +
      `Saya asisten AI Protokol Kementerian Ketenagakerjaan RI (${isWamen ? 'Ruang Lingkup: *Wakil Menteri*' : 'Ruang Lingkup: *Menteri*'}). Saya siap membantu Anda mengurus registrasi *Surat Masuk*, mencatat & mengunggah *Disposisi Surat*, mencatat *Jadwal Arahan Langsung*, mengecek agenda *Jadwal Kegiatan*, maupun mencari arsip persuratan dinas.${gufronSwitchNote}\n\n` +
      `Silakan sentuh tombol *Buka Menu Layanan* di bawah atau langsung ketik kebutuhan Anda (contoh: _"jadwal hari ini"_, _"upload disposisi"_, atau angka _1-6_). 😊`;

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
