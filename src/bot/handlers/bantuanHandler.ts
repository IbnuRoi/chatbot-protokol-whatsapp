import { sessionService, BotState, UserSession } from '../../services/sessionService';
import { menuHandler } from './menuHandler';
import { BotResponse } from '../types';

export class BantuanHandler {
  /**
   * Menampilkan menu Bantuan utama dengan tampilan bubble teks informatif
   */
  public async showBantuanMenu(session: UserSession): Promise<BotResponse> {
    sessionService.setState(session.whatsappNumber, BotState.BANTUAN_MENU);

    const text =
      `❓ *PUSAT BANTUAN & PANDUAN PENGGUNAAN*\n\n` +
      `Ada beberapa topik panduan yang dapat saya jelaskan:\n\n` +
      `• *1* - 📥 *Panduan Registrasi Surat Masuk* (Alur upload & OCR berkas)\n` +
      `• *2* - 📅 *Panduan Menu Jadwal Kegiatan* (Cek agenda protokol)\n` +
      `• *3* - 🔍 *Panduan Status Disposisi* (Lacak surat pimpinan)\n` +
      `• *4* - 📜 *Panduan Riwayat Surat* (Membaca arsip surat)\n` +
      `• *5* - 🔎 *Panduan Cari Surat* (Pencarian perihal & topik)\n` +
      `• *6* - 📎 *Petunjuk Unggah Berkas PDF* (Ketentuan & format)\n` +
      `• *7* - ⚡ *Perintah Cepat Navigasi Bot*\n\n` +
      `Silakan sebutkan topik atau nomor yang ingin Anda pelajari lebih lanjut ya.`;

    return { text };
  }

  /**
   * Menangani pemilihan topik bantuan
   */
  public async handleBantuanInput(session: UserSession, input: string): Promise<BotResponse> {
    const clean = input.trim();
    const lower = clean.toLowerCase();
    const navText = `\n\nBeri tahu saya jika Anda ingin membaca topik lainnya atau ada hal yang bisa saya bantu.`;

    if (clean === '1' || lower.includes('surat masuk') || lower.includes('registrasi')) {
      return {
        text:
          `📥 *PANDUAN REGISTRASI SURAT MASUK*\n\n` +
          `1. Beri tahu saya jika ingin meregistrasi surat baru (misalnya "mau input surat baru").\n` +
          `2. Pilih jenis surat (contoh: Undangan, Permohonan, Edaran, dsb.).\n` +
          `3. Sistem akan membuatkan Nomor Agenda otomatis yang bisa Anda sesuaikan.\n` +
          `4. Tentukan klasifikasi atau tipe surat (Biasa, Penting, Rahasia, atau Tembusan).\n` +
          `5. Kirimkan berkas PDF surat asli ke ruang obrolan ini.\n` +
          `6. AI akan mengekstrak nomor, tanggal, instansi pengirim, dan perihal dokumen secara cerdas.\n` +
          `7. Anda dapat meninjau dan mengoreksi data sebelum menyimpannya ke database.` +
          navText,
      };
    } else if (clean === '2' || lower.includes('jadwal') || lower.includes('agenda')) {
      return {
        text:
          `📅 *PANDUAN MENU JADWAL KEGIATAN*\n\n` +
          `• Menampilkan daftar seluruh agenda kegiatan protokol hari ini.\n` +
          `• Tanyakan "jadwal berikutnya" untuk melihat agenda terdekat yang belum terlaksana.\n` +
          `• Tanyakan "jadwal mendatang" untuk melihat agenda penting beberapa hari ke depan.\n` +
          `• Anda juga bisa langsung mencari nama kegiatan atau topik agenda secara fleksibel.` +
          navText,
      };
    } else if (clean === '3' || lower.includes('disposisi') || lower.includes('lacak')) {
      return {
        text:
          `🔍 *PANDUAN STATUS DISPOSISI*\n\n` +
          `• Cukup sebutkan Nomor Agenda (misal: UND/2026/09/0001) atau Nomor Surat pengirim.\n` +
          `• Saya akan langsung memeriksa apakah surat sudah menerima disposisi Pimpinan atau masih dalam antrean.` +
          navText,
      };
    } else if (clean === '4' || lower.includes('riwayat') || lower.includes('arsip')) {
      return {
        text:
          `📜 *PANDUAN RIWAYAT SURAT*\n\n` +
          `• Menampilkan arsip surat masuk terbaru yang tersimpan dalam sistem.\n` +
          `• Sebutkan nomor urut dokumen untuk melihat detail lengkap dan status disposisinya.\n` +
          `• Anda juga dapat berpindah halaman untuk menjelajahi arsip yang lebih lama.` +
          navText,
      };
    } else if (clean === '5' || lower.includes('cari') || lower.includes('perihal')) {
      return {
        text:
          `🔎 *PANDUAN CARI SURAT (BERDASARKAN PERIHAL)*\n\n` +
          `• Anda bisa bertanya dengan kalimat wajar seperti "cari surat tentang pelatihan vokasi" atau kata kunci ringkas.\n` +
          `• Sistem pencarian cerdas akan menemukan surat yang relevan dengan topik tersebut.\n` +
          `• Pilih nomor surat untuk membaca rincian lengkapnya.` +
          navText,
      };
    } else if (clean === '6' || lower.includes('pdf') || lower.includes('unggah') || lower.includes('upload')) {
      return {
        text:
          `📎 *PETUNJUK UNGGAH BERKAS PDF*\n\n` +
          `1. Berkas wajib berformat *.pdf*.\n` +
          `2. Ukuran berkas maksimum adalah *20 MB*.\n` +
          `3. Dokumen teks digital akan diekstraksi secara instan oleh AI.` +
          navText,
      };
    } else if (clean === '7' || lower.includes('perintah') || lower.includes('navigasi')) {
      return {
        text:
          `⚡ *PERINTAH CEPAT NAVIGASI BOT*\n\n` +
          `• *menu* : Kembali ke beranda awal kapan saja.\n` +
          `• *batal* : Membatalkan proses aktif yang sedang berjalan.\n` +
          `• *selesai* : Mengakhiri sesi percakapan chatbot secara resmi.` +
          navText,
      };
    } else if (clean === '0' || lower === 'menu' || lower === 'kembali' || lower === 'batal') {
      sessionService.resetSession(session.whatsappNumber);
      return menuHandler.getMainGreeting(session);
    } else {
      return this.showBantuanMenu(session);
    }
  }
}

export const bantuanHandler = new BantuanHandler();
