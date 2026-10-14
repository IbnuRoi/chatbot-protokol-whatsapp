import { sessionService, BotState, UserSession, JadwalArahanDraftData } from '../../services/sessionService';
import { jadwalService } from '../../services/jadwalService';
import { prisma } from '../../database/prisma';
import { sendPushNotification } from '../whatsappClient';
import { BotResponse } from '../types';
import { NluResult } from '../../services/nluService';
import { cleanHtml } from '../../utils/textHelper';
import {
  formatTanggalIndo,
  formatWaktuDisplay,
  formatWaktuInputIndo,
  parseIndonesianDateToDate,
  parseIndonesianTimeToDates,
  isValidDate,
  extractDateFromText,
} from '../../utils/dateHelper';

export class ArahanLangsungHandler {
  /**
   * Nomor WhatsApp resmi akun Gufronation (Pak Acho) untuk push notification khusus
   */
  private readonly DEFAULT_GUFRON_PHONE = '6282299294269';

  /**
   * Memulai alur input jadwal arahan langsung: Tampilkan panduan dan template formulir bersih
   */
  public startFlow(session: UserSession): BotResponse {
    sessionService.setState(session.whatsappNumber, BotState.JADWAL_ARAHAN_INPUT_TEMPLATE);
    sessionService.clearJadwalArahanDraft(session.whatsappNumber);

    return this.renderInputTemplatePrompt(session);
  }

  /**
   * Merender prompt formulir input template dalam 2 bubble pesan terpisah
   * Bubble 1: Petunjuk dan Panduan Pengisian
   * Bubble 2: Template Bersih (Murni Key-Value) yang 100% siap disalin dan diisi pengguna
   */
  public renderInputTemplatePrompt(session: UserSession, prefilledDraft?: JadwalArahanDraftData): BotResponse {
    const isEdit = Boolean(prefilledDraft);

    const guideText =
      (isEdit ? `✏️ *PANDUAN KOREKSI JADWAL ARAHAN LANGSUNG*\n\n` : `📋 *INPUT JADWAL ARAHAN LANGSUNG*\n\n`) +
      `Silakan *salin (copy)* pesan formulir di bawah ini, sesuaikan isian data kegiatan, lalu *langsung kirimkan kembali* ke chat ini tanpa perlu memilih menu:\n\n` +
      `📌 *Catatan Pengisian:*\n` +
      `• *Nama Kegiatan*: Nama agenda / acara arahan pimpinan\n` +
      `• *Tanggal Kegiatan*: Tanggal acara (contoh: 16 Oktober 2026 atau 16/10/2026)\n` +
      `• *Jam Kegiatan*: Waktu acara (contoh: 09:00 - 11:30 WIB atau 14:00 - Selesai)\n` +
      `• *Lokasi*: Tempat / Ruangan / Hotel kegiatan\n` +
      `• *Pejabat Hadir*: Pejabat yang hadir/terkait (contoh: Menaker RI, Wamenaker, atau -)\n` +
      `• *PIC*: Nama & No. HP narahubung jika ada (contoh: Budi 08123456789 atau -)\n` +
      `• *Catatan Arahan*: Instruksi khusus pimpinan / memo singkat\n\n` +
      `_(Ketik *batal* jika ingin membatalkan)_`;

    let cleanTemplateText = '';
    if (prefilledDraft) {
      cleanTemplateText =
        `Nama Kegiatan: ${prefilledDraft.namaKegiatan || ''}\n` +
        `Tanggal Kegiatan: ${prefilledDraft.tanggalKegiatan || ''}\n` +
        `Jam Kegiatan: ${prefilledDraft.waktuMulai ? `${prefilledDraft.waktuMulai}${prefilledDraft.waktuSelesai ? ' - ' + prefilledDraft.waktuSelesai : (prefilledDraft.sampaiSelesai ? ' - Selesai' : '')} WIB` : ''}\n` +
        `Lokasi: ${prefilledDraft.lokasi || ''}\n` +
        `Pejabat Hadir: ${prefilledDraft.pejabatHadir || '-'}\n` +
        `PIC: ${prefilledDraft.pic || '-'}\n` +
        `Catatan Arahan: ${prefilledDraft.catatan || '-'}`;
    } else {
      cleanTemplateText =
        `Nama Kegiatan: \n` +
        `Tanggal Kegiatan: \n` +
        `Jam Kegiatan: \n` +
        `Lokasi: \n` +
        `Pejabat Hadir: \n` +
        `PIC: \n` +
        `Catatan Arahan: `;
    }

    return {
      text: `${guideText}\n\n${cleanTemplateText}`,
      messages: [guideText, cleanTemplateText],
    };
  }

  /**
   * Menangani input formulir template yang dikirimkan oleh pengguna
   */
  public async handleInputTemplate(session: UserSession, input: string): Promise<BotResponse> {
    const clean = input.trim();
    const lower = clean.toLowerCase();

    // 1. Pembatalan
    if (lower === 'batal' || lower.includes('cancel')) {
      sessionService.resetSession(session.whatsappNumber);
      return {
        text: `🚫 *INPUT JADWAL DIBATALKAN*\n\nDraft input jadwal arahan langsung telah dibatalkan.`,
      };
    }

    // 2. Parsing teks template
    const parsed = this.parseJadwalTemplate(clean);

    // Ambil draft sebelumnya jika ini proses koreksi
    const prevDraft = session.draftJadwalArahan;

    const namaKegiatan = (parsed.namaKegiatan || prevDraft?.namaKegiatan || '').trim();
    if (!namaKegiatan || namaKegiatan === '-') {
      return {
        text:
          `⚠️ *Nama Kegiatan Belum Diisi!*\n\n` +
          `Mohon isi *Nama Kegiatan* pada formulir Anda. Silakan salin kembali template di atas atau ketik nama kegiatannya ya.\n\n` +
          `_(Ketik *batal* untuk membatalkan)_`,
      };
    }

    // Parsing Tanggal Kegiatan
    const rawTanggal = parsed.tanggalKegiatan || prevDraft?.tanggalKegiatan || '';
    let parsedDate: Date | null = null;
    let formattedDateStr = rawTanggal;
    let isoDateStr = '';

    if (rawTanggal && rawTanggal !== '-') {
      parsedDate = parseIndonesianDateToDate(rawTanggal);
      if (!parsedDate) {
        const ext = extractDateFromText(rawTanggal);
        if (ext) {
          isoDateStr = ext.dateStr;
          parsedDate = new Date(Date.UTC(ext.year, ext.month - 1, ext.day));
        }
      }
    }

    if (!parsedDate) {
      // Default ke hari ini jika tidak ditentukan
      parsedDate = new Date();
    }

    const y = parsedDate.getUTCFullYear();
    const m = String(parsedDate.getUTCMonth() + 1).padStart(2, '0');
    const d = String(parsedDate.getUTCDate()).padStart(2, '0');
    isoDateStr = `${y}-${m}-${d}`;
    formattedDateStr = formatTanggalIndo(isoDateStr, true);

    // Parsing Waktu / Jam Kegiatan
    const rawJam = parsed.jamKegiatan || prevDraft?.waktuMulai || '09:00';
    let waktuMulai = '09:00';
    let waktuSelesai: string | null = null;
    let sampaiSelesai = false;

    if (rawJam.toLowerCase().includes('selesai') || rawJam.toLowerCase().includes('s.d selesai') || rawJam.toLowerCase().includes('sd selesai')) {
      sampaiSelesai = true;
    }

    const parsedTime = parseIndonesianTimeToDates(rawJam);
    if (parsedTime.startTime && isValidDate(parsedTime.startTime)) {
      const sh = String(parsedTime.startTime.getUTCHours()).padStart(2, '0');
      const sm = String(parsedTime.startTime.getUTCMinutes()).padStart(2, '0');
      waktuMulai = `${sh}:${sm}`;
    }

    if (parsedTime.finishTime && isValidDate(parsedTime.finishTime)) {
      const fh = String(parsedTime.finishTime.getUTCHours()).padStart(2, '0');
      const fm = String(parsedTime.finishTime.getUTCMinutes()).padStart(2, '0');
      waktuSelesai = `${fh}:${fm}`;
      sampaiSelesai = false;
    }

    const lokasi = (parsed.lokasi || prevDraft?.lokasi || '-').trim();
    const pejabatHadir = (parsed.pejabatHadir || prevDraft?.pejabatHadir || '-').trim();
    const pic = (parsed.pic || prevDraft?.pic || '-').trim();
    const catatan = (parsed.catatanArahan || prevDraft?.catatan || '-').trim();

    const draft: JadwalArahanDraftData = {
      namaKegiatan,
      tanggalKegiatan: formattedDateStr,
      tanggalIso: isoDateStr,
      waktuMulai,
      waktuSelesai,
      sampaiSelesai,
      lokasi,
      pejabatHadir,
      pic,
      catatan,
    };

    sessionService.updateJadwalArahanDraft(session.whatsappNumber, draft);
    sessionService.setState(session.whatsappNumber, BotState.JADWAL_ARAHAN_REVIEW);

    return this.renderReview(session);
  }

  /**
   * Menampilkan ringkasan data review untuk dikonfirmasi pengguna
   */
  public renderReview(session: UserSession, isUpdated: boolean = false): BotResponse {
    const draft = session.draftJadwalArahan;
    if (!draft) {
      sessionService.resetSession(session.whatsappNumber);
      return { text: `⚠️ Draft jadwal tidak ditemukan. Silakan ketik *input jadwal arahan* untuk memulai kembali.` };
    }

    const waktuStr = formatWaktuDisplay(
      draft.waktuMulai,
      draft.sampaiSelesai ? null : draft.waktuSelesai
    ) + (draft.sampaiSelesai ? ' (s.d. Selesai)' : '');

    const header = isUpdated ? `📋 *JADWAL ARAHAN LANGSUNG DIPERBARUI*` : `📋 *REVIEW JADWAL ARAHAN LANGSUNG*`;

    const text =
      `${header}\n\n` +
      `Mohon periksa kembali rincian agenda sebelum disimpan ke database:\n\n` +
      `• 📌 *Nama Kegiatan* : *${draft.namaKegiatan}*\n` +
      `• 🗓️ *Tanggal*       : ${draft.tanggalKegiatan}\n` +
      `• ⏰ *Waktu*         : ${waktuStr}\n` +
      `• 📍 *Lokasi*        : ${draft.lokasi && draft.lokasi !== '-' ? draft.lokasi : 'Belum Ditentukan'}\n` +
      `• 👥 *Pejabat Hadir* : ${draft.pejabatHadir && draft.pejabatHadir !== '-' ? draft.pejabatHadir : '-'}\n` +
      `• 📞 *PIC / Kontak*  : ${draft.pic && draft.pic !== '-' ? draft.pic : '-'}\n` +
      `• 📝 *Catatan Arahan*: ${draft.catatan && draft.catatan !== '-' ? draft.catatan : '-'}\n` +
      `• 👤 *Petugas Input* : ${session.userName || 'Petugas Protokol'}\n\n` +
      `Apakah data di atas sudah benar?\n` +
      `👉 Ketik *Ya* / *Benar* untuk langsung menyimpan ke database.\n` +
      `👉 Ketik *Salah* / *Koreksi* jika ada data yang ingin diperbaiki.\n` +
      `👉 Ketik *Batal* untuk membatalkan.`;

    return { text };
  }

  /**
   * Menangani respon pengguna pada tahap review (Ya / Koreksi / Batal)
   */
  public async handleReview(session: UserSession, input: string, nlu?: NluResult): Promise<BotResponse> {
    const clean = input.trim();
    const lower = clean.toLowerCase();

    // Jika pengguna langsung mengirimkan formulir template koreksi (memuat tanda ':' dan kata kunci field)
    if (clean.includes(':') && this.hasTemplateFields(clean)) {
      return this.handleInputTemplate(session, clean);
    }

    // 1. Konfirmasi YA / BENAR / SIMPAN
    const isConfirm =
      nlu?.entities?.reviewAction === 'CONFIRM' ||
      clean === '1' ||
      lower === 'ya' ||
      lower === 'iya' ||
      lower === 'y' ||
      lower === 'betul' ||
      lower === 'simpan' ||
      lower === 'oke' ||
      lower.includes('benar') ||
      lower.includes('sesuai') ||
      lower.includes('sudah benar') ||
      lower.includes('simpan');

    if (isConfirm) {
      const draft = session.draftJadwalArahan;
      if (!draft) {
        sessionService.resetSession(session.whatsappNumber);
        return { text: `⚠️ Draft jadwal tidak ditemukan. Silakan ketik *input jadwal arahan* untuk memulai kembali.` };
      }

      const saveResult = await jadwalService.saveJadwalArahanLangsung(
        draft,
        session.userId,
        session.userName
      );

      if (!saveResult.success) {
        return {
          text: `❌ *Gagal Menyimpan Jadwal:*\n${saveResult.message || 'Terjadi kesalahan sistem.'}\n\nKetik *Ya* untuk mencoba menyimpan kembali, atau *Batal*.`,
        };
      }

      const savedDraft = { ...draft };
      const penginputName = session.userName || 'Petugas Protokol';
      const penginputPhone = session.whatsappNumber;
      const waktuInputStr = formatWaktuInputIndo(new Date());

      // Reset sesi penginput setelah berhasil disimpan
      sessionService.resetSession(session.whatsappNumber);

      // Kirim Push Notification KHUSUS ke akun Gufronation
      await this.sendNotificationToGufronation(savedDraft, penginputName, penginputPhone, waktuInputStr);

      const waktuStr = formatWaktuDisplay(
        savedDraft.waktuMulai,
        savedDraft.sampaiSelesai ? null : savedDraft.waktuSelesai
      ) + (savedDraft.sampaiSelesai ? ' (s.d. Selesai)' : '');

      let conflictNote = '';
      if (saveResult.hasTimeConflict && saveResult.conflictingEvents && saveResult.conflictingEvents.length > 0) {
        const firstConflict = saveResult.conflictingEvents[0];
        const cleanConflictTitle = cleanHtml(firstConflict.title) || firstConflict.title;
        const conflictCount = saveResult.conflictingEvents.length;
        const otherText = conflictCount > 1 ? ` dan ${conflictCount - 1} agenda lainnya` : '';
        conflictNote =
          `\n⚠️ *Perhatian (Jadwal Bersamaan/Bentrok):*\n` +
          `Terdapat agenda kegiatan lain pada waktu yang sama: *${cleanConflictTitle}*${otherText}.\n` +
          `_Jadwal arahan langsung tetap berhasil didaftarkan ke sistem sesuai waktu yang Anda tentukan._\n`;
      }

      return {
        text:
          `✅ *JADWAL ARAHAN LANGSUNG BERHASIL DISIMPAN!*\n\n` +
          `Agenda kegiatan arahan langsung telah resmi tercatat ke dalam sistem Protokol:\n` +
          `• 📌 *Nama Kegiatan* : *${savedDraft.namaKegiatan}*\n` +
          `• 🗓️ *Tanggal*       : ${savedDraft.tanggalKegiatan}\n` +
          `• ⏰ *Waktu*         : ${waktuStr}\n` +
          `• 📍 *Lokasi*        : ${savedDraft.lokasi && savedDraft.lokasi !== '-' ? savedDraft.lokasi : 'Belum Ditentukan'}\n` +
          `• 👥 *Pejabat Hadir* : ${savedDraft.pejabatHadir && savedDraft.pejabatHadir !== '-' ? savedDraft.pejabatHadir : '-'}\n` +
          `• 📞 *PIC / Kontak*  : ${savedDraft.pic && savedDraft.pic !== '-' ? savedDraft.pic : '-'}\n` +
          `• 📝 *Catatan Arahan*: ${savedDraft.catatan && savedDraft.catatan !== '-' ? savedDraft.catatan : '-'}\n` +
          `• 📅 *Status Jadwal* : 🟢 Diagendakan (Arahan Langsung)\n` +
          `• 👤 *Diinput Oleh*  : ${penginputName}\n` +
          `• ⏰ *Waktu Input*   : ${waktuInputStr}\n` +
          conflictNote +
          `\n🔔 _Notifikasi pemberitahuan telah dikirimkan secara otomatis ke WhatsApp Bapak Gufronation._\n\n` +
          `Ada agenda atau administrasi lain yang ingin Anda kelola? Silakan beri tahu saya ya. 😊`,
      };
    }

    // 2. Koreksi / Salah / Edit
    const isKoreksi =
      nlu?.entities?.reviewAction === 'KOREKSI' ||
      clean === '2' ||
      lower === 'salah' ||
      lower === 'tidak' ||
      lower === 't' ||
      lower.includes('koreksi') ||
      lower.includes('ubah') ||
      lower.includes('edit') ||
      lower.includes('ada yang salah') ||
      lower.includes('ganti');

    if (isKoreksi) {
      sessionService.setState(session.whatsappNumber, BotState.JADWAL_ARAHAN_INPUT_TEMPLATE);
      return this.renderInputTemplatePrompt(session, session.draftJadwalArahan);
    }

    // 3. Pembatalan
    if (lower === 'batal' || lower.includes('cancel')) {
      sessionService.resetSession(session.whatsappNumber);
      return {
        text: `🚫 *INPUT JADWAL DIBATALKAN*\n\nDraft jadwal arahan langsung telah dibatalkan.`,
      };
    }

    // Default jika belum jelas
    return {
      text:
        `Apakah data jadwal arahan langsung di atas sudah benar?\n` +
        `👉 Ketik *Ya* / *Benar* untuk langsung menyimpan ke database.\n` +
        `👉 Ketik *Salah* / *Koreksi* jika ada data yang ingin diperbaiki.\n` +
        `👉 Ketik *Batal* untuk membatalkan.`,
    };
  }

  /**
   * Mengirimkan Push Notification khusus ke akun WhatsApp user Gufronation
   */
  private async sendNotificationToGufronation(
    draft: JadwalArahanDraftData,
    penginputName: string,
    penginputPhone: string,
    waktuInputStr: string
  ): Promise<void> {
    try {
      console.log(`[Push Notification] Mencari kontak user Gufronation di database...`);

      // 1. Cari user Gufronation secara dinamis di database
      let targetJid = `${this.DEFAULT_GUFRON_PHONE}@s.whatsapp.net`;
      try {
        const gufronUser = await prisma.users.findFirst({
          where: {
            deleted_at: null,
            OR: [
              { name: { contains: 'gufron', mode: 'insensitive' } },
              { phone_number: { contains: '82299294269' } },
              { phone_number: { contains: '082299294269' } },
            ],
          },
        });

        if (gufronUser) {
          const rawPhone = (gufronUser.phone_number || '').replace(/[^0-9]/g, '');
          if (rawPhone.length >= 9) {
            const normalizedPhone = rawPhone.startsWith('0') ? '62' + rawPhone.slice(1) : rawPhone;
            targetJid = `${normalizedPhone}@s.whatsapp.net`;
          }
          console.log(`[Push Notification] Ditemukan akun Gufronation di DB (ID ${gufronUser.id}): ${targetJid}`);
        } else {
          console.log(`[Push Notification] Akun Gufronation tidak ditemukan spesifik di DB, menggunakan default JID: ${targetJid}`);
        }
      } catch (dbErr) {
        console.warn(`[Push Notification] Gagal query user Gufronation di DB, fallback ke nomor standar:`, dbErr);
      }

      const waktuDisplay = formatWaktuDisplay(
        draft.waktuMulai,
        draft.sampaiSelesai ? null : draft.waktuSelesai
      ) + (draft.sampaiSelesai ? ' (s.d. Selesai)' : '');

      const cleanPhone = penginputPhone.replace(/@.*$/, '');

      // 2. Susun pesan notifikasi lengkap sesuai instruksi
      const notificationText =
        `🔔 *PEMBERITAHUAN JADWAL ARAHAN LANGSUNG BARU*\n\n` +
        `Yth. Bapak Gufronation,\n` +
        `Terdapat penambahan agenda jadwal baru berdasarkan *Arahan Langsung* yang baru saja diinput ke dalam sistem Protokol:\n\n` +
        `📄 *Rincian Jadwal Kegiatan:*\n` +
        `• 📌 *Nama Kegiatan* : *${draft.namaKegiatan}*\n` +
        `• 🗓️ *Tanggal*       : ${draft.tanggalKegiatan}\n` +
        `• ⏰ *Waktu*         : ${waktuDisplay}\n` +
        `• 📍 *Lokasi*        : ${draft.lokasi && draft.lokasi !== '-' ? draft.lokasi : 'Belum Ditentukan'}\n` +
        `• 👥 *Pejabat Hadir* : ${draft.pejabatHadir && draft.pejabatHadir !== '-' ? draft.pejabatHadir : '-'}\n` +
        `• 📞 *PIC / Kontak*  : ${draft.pic && draft.pic !== '-' ? draft.pic : '-'}\n` +
        `• 📝 *Catatan Arahan*: ${draft.catatan && draft.catatan !== '-' ? draft.catatan : '-'}\n\n` +
        `👤 *Diinput Oleh*   : *${penginputName}* (${cleanPhone})\n` +
        `⏰ *Waktu Input*    : ${waktuInputStr}\n\n` +
        `_Pesan notifikasi ini dikirimkan otomatis oleh Sistem Chatbot Protokol Kemnaker RI._`;

      console.log(`[Push Notification] Mengirimkan notifikasi arahan langsung ke ${targetJid}...`);
      const sent = await sendPushNotification(targetJid, notificationText);
      if (sent) {
        console.log(`🎉 [Push Notification] Notifikasi jadwal arahan langsung berhasil terkirim ke Gufronation (${targetJid})`);
      } else {
        console.warn(`⚠️ [Push Notification] Pengiriman notifikasi ke Gufronation gagal.`);
      }
    } catch (pushErr) {
      console.error(`❌ [Push Notification] Error saat proses pengiriman notifikasi Gufronation:`, pushErr);
    }
  }

  /**
   * Mengecek apakah teks memuat indikasi template isian jadwal
   */
  private hasTemplateFields(text: string): boolean {
    const lower = text.toLowerCase();
    return (
      lower.includes('nama kegiatan') ||
      lower.includes('tanggal kegiatan') ||
      lower.includes('jam kegiatan') ||
      lower.includes('lokasi') ||
      lower.includes('pejabat hadir') ||
      lower.includes('catatan arahan')
    );
  }

  /**
   * Mem-parsing teks formulir template berformat key: value
   */
  private parseJadwalTemplate(text: string): {
    namaKegiatan?: string;
    tanggalKegiatan?: string;
    jamKegiatan?: string;
    lokasi?: string;
    pejabatHadir?: string;
    pic?: string;
    catatanArahan?: string;
  } {
    const result: {
      namaKegiatan?: string;
      tanggalKegiatan?: string;
      jamKegiatan?: string;
      lokasi?: string;
      pejabatHadir?: string;
      pic?: string;
      catatanArahan?: string;
    } = {};

    const lines = text.split('\n');
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      if (/^_\s*\(.*?\)\s*_$/.test(line) || /^\(.*?\)$/.test(line)) continue;

      const lowerClean = line.toLowerCase().replace(/[\*\_•\-]/g, '').trim();
      if (
        lowerClean.startsWith('panduan ') ||
        lowerClean.startsWith('catatan pengisian') ||
        lowerClean.startsWith('petunjuk ') ||
        lowerClean.startsWith('contoh ') ||
        lowerClean.startsWith('keterangan ') ||
        lowerClean.startsWith('silakan ') ||
        lowerClean.startsWith('ketik ')
      ) {
        continue;
      }

      const colonIdx = line.indexOf(':');
      if (colonIdx === -1) continue;

      const rawKey = line.substring(0, colonIdx).replace(/[\*\_•\-]/g, '').trim().toLowerCase();
      const val = line.substring(colonIdx + 1).replace(/^[\*\_]/, '').replace(/[\*\_]$/, '').trim();

      if (rawKey.includes('nama kegiatan') || rawKey.includes('nama acara') || rawKey.includes('judul kegiatan') || rawKey === 'kegiatan' || rawKey === 'agenda') {
        result.namaKegiatan = val;
      } else if (rawKey.includes('tanggal kegiatan') || rawKey.includes('tanggal acara') || rawKey === 'tanggal' || rawKey === 'tgl' || rawKey.includes('hari/tanggal')) {
        result.tanggalKegiatan = val;
      } else if (rawKey.includes('jam kegiatan') || rawKey.includes('jam acara') || rawKey === 'jam' || rawKey === 'waktu' || rawKey === 'pukul') {
        result.jamKegiatan = val;
      } else if (rawKey.includes('lokasi') || rawKey.includes('tempat') || rawKey.includes('ruangan') || rawKey.includes('venue')) {
        result.lokasi = val;
      } else if (rawKey.includes('pejabat hadir') || rawKey.includes('pejabat') || rawKey.includes('pendamping') || rawKey.includes('dihadiri')) {
        result.pejabatHadir = val;
      } else if (rawKey === 'pic' || rawKey.includes('nama pic') || rawKey.includes('kontak') || rawKey.includes('narahubung') || rawKey.includes('penanggung jawab')) {
        result.pic = val;
      } else if (rawKey.includes('catatan arahan') || rawKey.includes('catatan') || rawKey.includes('arahan') || rawKey.includes('keterangan')) {
        result.catatanArahan = val;
      }
    }

    return result;
  }
}

export const arahanLangsungHandler = new ArahanLangsungHandler();
