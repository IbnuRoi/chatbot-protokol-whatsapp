import fs from 'fs';
import path from 'path';
import { sessionService, BotState, UserSession, DisposisiDraftData, ExtractedDisposisiData } from '../../services/sessionService';
import { disposisiService } from '../../services/disposisiService';
import { aiService } from '../../services/aiService';
import { pdfService } from '../../services/pdfService';
import { menuHandler } from './menuHandler';
import { BotResponse } from '../types';
import {
  formatNomorAgendaLink,
  getLetterFileUrl,
  getDispositionFileUrl,
  generateDispositionFileName,
  isPureGreeting,
  cleanHtml,
} from '../../utils/textHelper';
import { formatWaktuInputIndo, formatTanggalIndo } from '../../utils/dateHelper';

export class DisposisiHandler {
  /**
   * Menampilkan permintaan input nomor surat / nomor agenda untuk pelacakan status
   */
  public async promptNomor(session: UserSession): Promise<BotResponse> {
    sessionService.setState(session.whatsappNumber, BotState.DISPOSISI_INPUT_NOMOR);

    return {
      text:
        `🔍 *PELACAKAN STATUS DISPOSISI*\n\n` +
        `Boleh sebutkan atau ketikkan *Nomor Agenda* atau *Nomor Surat* yang ingin Anda cek statusnya (misalnya: _UND/2026/09/0001_ atau _B-104/MENKO/MARVES_).\n\n` +
        `_(Ketik *Batal* untuk kembali ke menu utama)_`,
    };
  }

  /**
   * Menampilkan permintaan unggah berkas Lembar Disposisi (PDF / Foto)
   */
  public async promptUpload(session: UserSession): Promise<BotResponse> {
    sessionService.setState(session.whatsappNumber, BotState.DISPOSISI_UPLOAD_BERKAS);

    return {
      text:
        `📥 *PENCATATAN DISPOSISI SURAT*\n\n` +
        `Silakan kirimkan dokumen atau foto *Lembar Disposisi* (berupa file PDF scan atau foto/gambar formulir disposisi).\n\n` +
        `Sistem akan mengekstrak otomatis Nomor Agenda, Pejabat Penerima, Arahan Pimpinan, dan Catatan Khusus dari lembar disposisi.\n\n` +
        `_(Ketik *Batal* untuk membatalkan)_`,
    };
  }

  /**
   * Menangani berkas media (PDF scan atau Gambar) lembar disposisi yang diunggah
   */
  public async handleDirectUpload(
    session: UserSession,
    tempFilePath: string,
    originalFileName: string,
    isImage: boolean = false
  ): Promise<BotResponse> {
    if (!fs.existsSync(tempFilePath)) {
      return {
        text: `⚠️ Berkas unggahan tidak ditemukan atau gagal diproses oleh server. Silakan coba unggah kembali.`,
      };
    }

    let stats: fs.Stats | null = null;
    try {
      stats = fs.statSync(tempFilePath);
    } catch (e) {}

    // 1. Ekstraksi Lembar Disposisi menggunakan AI
    let extracted: ExtractedDisposisiData;
    if (isImage) {
      extracted = await aiService.extractDisposisiFromImages([tempFilePath], originalFileName);
    } else {
      extracted = await aiService.extractDisposisiFromPdf(tempFilePath, originalFileName);
    }

    // 2. Generate nama berkas final sesuai standar database
    const finalFileName = generateDispositionFileName(originalFileName);

    // 3. Cari surat induk berdasarkan nomor agenda hasil ekstraksi
    const cleanAgenda = (extracted.nomorAgenda || '').trim();
    let matchedLetter: any = null;
    let existingDisposition: any = null;

    if (cleanAgenda && cleanAgenda !== '-') {
      matchedLetter = await disposisiService.findLetterByAgenda(cleanAgenda);
      if (matchedLetter) {
        existingDisposition = await disposisiService.findExistingDispositionByLetterId(matchedLetter.id);
      }
    }

    // Fallback: Jika belum cocok dari nomor agenda, coba cari dari nomor surat pengirim
    if (!matchedLetter && extracted.nomorSurat && extracted.nomorSurat !== '-' && extracted.nomorSurat.length >= 3) {
      matchedLetter = await disposisiService.findLetterByAgenda(extracted.nomorSurat);
      if (matchedLetter) {
        existingDisposition = await disposisiService.findExistingDispositionByLetterId(matchedLetter.id);
      }
    }

    // Jika tanggal disposisi belum ditemukan dari berkas disposisi, gunakan tanggal surat masuk
    if ((!extracted.tanggalDisposisi || extracted.tanggalDisposisi === '-') && matchedLetter?.date_letter) {
      extracted.tanggalDisposisi = formatTanggalIndo(matchedLetter.date_letter, false);
    }

    // 4. Simpan ke draft sesi
    const draftData: DisposisiDraftData = {
      tempFilePath,
      tempFileName: originalFileName,
      finalFileName,
      fileSize: stats?.size || 0,
      isImage,
      extractedData: extracted,
      existingDispositionId: existingDisposition ? Number(existingDisposition.id) : undefined,
      matchedLetter: matchedLetter
        ? {
            id: Number(matchedLetter.id),
            agendaNumber: matchedLetter.agenda_number,
            from: matchedLetter.from,
            subject: matchedLetter.subject || '-',
            perihal: matchedLetter.note || matchedLetter.subject || '-',
            dateLetter: matchedLetter.date_letter ? String(matchedLetter.date_letter) : undefined,
            file: matchedLetter.file || undefined,
          }
        : undefined,
    };

    sessionService.updateDisposisiDraft(session.whatsappNumber, draftData);

    // Jika surat induk ditemukan di database -> Masuk ke review konfirmasi
    if (matchedLetter) {
      sessionService.setState(session.whatsappNumber, BotState.DISPOSISI_REVIEW_DATA);
      return this.renderDisposisiReview(session);
    }

    // Jika nomor agenda belum ada atau surat tidak ditemukan di database
    sessionService.setState(session.whatsappNumber, BotState.DISPOSISI_INPUT_AGENDA_MANUAL);

    const agendaPrompt = cleanAgenda && cleanAgenda !== '-'
      ? `Sistem membaca Nomor Agenda: *${cleanAgenda}*, namun nomor agenda tersebut belum ditemukan di arsip surat masuk.`
      : `Nomor Agenda tidak terbaca dengan jelas pada berkas lembar disposisi.`;

    return {
      text:
        `⚠️ *Surat Induk Belum Terhubung*\n\n` +
        `${agendaPrompt}\n\n` +
        `Silakan ketikkan *Nomor Agenda* yang benar dari surat masuk yang didisposisikan (contoh: _UND/2026/09/0001_).\n\n` +
        `_(Atau ketik *Batal* untuk membatalkan proses pencatatan)_`,
    };
  }

  /**
   * Menampilkan formulir review pratinjau data disposisi sebelum disimpan
   */
  public renderDisposisiReview(session: UserSession): BotResponse {
    const draft = session.draftDisposisi;
    if (!draft || !draft.extractedData) {
      sessionService.resetSession(session.whatsappNumber);
      return {
        text: `⚠️ Sesi pencatatan disposisi telah kedaluwarsa. Silakan mulai kembali dari menu disposisi.`,
      };
    }

    const ext = draft.extractedData;
    const letter = draft.matchedLetter;

    const diteruskanStr =
      ext.diteruskanKepada && ext.diteruskanKepada.length > 0
        ? ext.diteruskanKepada.join(', ')
        : '- (Tidak ada / Belum ditentukan)';

    const arahanStr =
      ext.arahanDisposisi && ext.arahanDisposisi.length > 0
        ? ext.arahanDisposisi.join(', ')
        : '-';

    const agendaDisplay = letter ? letter.agendaNumber : (ext.nomorAgenda || '-');
    const pengirimDisplay = letter ? letter.from : (ext.asalSurat || '-');
    const perihalRaw = letter ? letter.perihal : (ext.perihal || '-');
    const perihalDisplay = cleanHtml(perihalRaw) || perihalRaw;

    const isUpdate = Boolean(draft.existingDispositionId);
    const headerTitle = isUpdate
      ? `📋 *KONFIRMASI PEMBARUAN DISPOSISI*`
      : `📋 *KONFIRMASI PENCATATAN DISPOSISI*`;

    const updateNote = isUpdate
      ? `ℹ️ _Surat dengan Nomor Agenda ini sudah memiliki data disposisi di sistem. Menyimpan berkas ini akan **memperbarui** detail disposisi di database._\n\n`
      : '';

    const confirmAction = isUpdate ? 'Perbarui Data di Database' : 'Simpan ke Database';

    const text =
      `${headerTitle}\n\n` +
      updateNote +
      `📄 *Informasi Surat Induk:*\n` +
      `• *Nomor Agenda* : ${agendaDisplay}\n` +
      `• *Pengirim*     : ${pengirimDisplay}\n` +
      `• *Perihal*      : ${perihalDisplay}\n\n` +
      `🎯 *Rincian Lembar Disposisi:*\n` +
      `• *Pemberi Disposisi* : ${ext.pemberiDisposisi || 'Menteri Ketenagakerjaan RI'}\n` +
      (ext.sifat && ext.sifat !== '-' ? `• *Sifat Disposisi*   : ${ext.sifat}\n` : '') +
      `• *Diteruskan Kepada* : ${diteruskanStr}\n` +
      `• *Arahan Pimpinan*   : ${arahanStr}\n` +
      `• *Catatan Khusus*    : ${ext.catatan || '-'}\n` +
      `• *Tanggal Disposisi* : ${ext.tanggalDisposisi || '-'}\n` +
      (ext.tanggalAcara && ext.tanggalAcara !== '-' ? `• *Tanggal Acara*     : ${ext.tanggalAcara}\n` : '') +
      `• *Nama Berkas*       : ${draft.finalFileName || draft.tempFileName}\n\n` +
      `──────────────────────────────\n` +
      `Apakah data disposisi di atas sudah sesuai?\n\n` +
      `1️⃣ Ketik *1* atau *Ya* : ${confirmAction}\n` +
      `2️⃣ Ketik *2* atau *Koreksi* : Ubah/Koreksi Data\n` +
      `❌ Ketik *Batal* : Batalkan proses ini`;

    return { text };
  }

  /**
   * Menangani respon konfirmasi review (Ya / Koreksi / Batal)
   */
  public async handleReviewResponse(session: UserSession, input: string): Promise<BotResponse> {
    const clean = input.trim().toLowerCase();

    if (clean === 'batal' || clean === '/cancel') {
      if (session.draftDisposisi?.tempFilePath) {
        pdfService.deleteTempPdf(session.draftDisposisi.tempFilePath);
      }
      sessionService.clearDisposisiDraft(session.whatsappNumber);
      sessionService.resetSession(session.whatsappNumber);
      return menuHandler.getConversationalGreeting(
        session,
        `Baik *${session.userName}*, proses pencatatan disposisi telah dibatalkan.`
      );
    }

    // Pilihan 1: Simpan
    if (clean === '1' || clean === 'ya' || clean === 'simpan' || clean === 'sudah' || clean === 'sesuai' || clean === 'ok') {
      const draft = session.draftDisposisi;
      if (!draft || !draft.matchedLetter) {
        return {
          text: `⚠️ Data disposisi belum lengkap atau belum terhubung dengan surat masuk. Silakan ketik Nomor Agenda yang valid.`,
        };
      }

      const saveResult = await disposisiService.saveDisposisiDraft(
        draft,
        session.userId,
        session.userName
      );

      sessionService.clearDisposisiDraft(session.whatsappNumber);
      sessionService.resetSession(session.whatsappNumber);

      if (!saveResult.success) {
        return {
          text: `❌ *Gagal Menyimpan Disposisi*\n\n${saveResult.message || 'Terjadi kesalahan sistem.'}`,
        };
      }

      const fileLinkLine = saveResult.fileUrl
        ? `• *Link Berkas Disposisi* : ${saveResult.fileUrl}\n`
        : '';

      const eventStatusLine =
        saveResult.eventUpdated && saveResult.eventStatusText
          ? `• *Status Jadwal* : *${saveResult.eventStatusText}* (Judul & arahan diperbarui)\n`
          : '';

      const successTitle = saveResult.isUpdate
        ? `✅ *DATA DISPOSISI BERHASIL DIPERBARUI!*`
        : `✅ *DISPOSISI SURAT BERHASIL DISIMPAN!*`;

      const statusNote = saveResult.isUpdate
        ? `• *Status Surat* : Sudah Disposisi 🟢 (Diperbarui)\n\nDetail data disposisi dan berkas fisik telah berhasil diperbarui di database sistem.`
        : `• *Status Surat* : Sudah Disposisi 🟢\n\nLembar disposisi telah digabungkan pada halaman pertama berkas surat dan berhasil diarsipkan ke database sistem.`;

      const tanggalDispDisplay =
        saveResult.tanggalDisposisi ||
        (draft.extractedData?.tanggalDisposisi && draft.extractedData.tanggalDisposisi !== '-'
          ? draft.extractedData.tanggalDisposisi
          : null);

      const tanggalDispLine = tanggalDispDisplay
        ? `• *Tanggal Disposisi* : ${tanggalDispDisplay}\n`
        : '';

      return {
        text:
          `${successTitle}\n\n` +
          `• *Nomor Agenda* : ${saveResult.nomorAgenda}\n` +
          `• *Perihal*      : ${saveResult.perihal}\n` +
          tanggalDispLine +
          `• *Nama Berkas*  : ${saveResult.fileName}\n` +
          fileLinkLine +
          eventStatusLine +
          `${statusNote}\n\n` +
          `Silakan beri tahu saya jika Anda ingin mencatat disposisi lainnya atau membutuhkan bantuan lain ya.`,
      };
    }

    // Jika pengguna langsung mengirim teks template koreksi saat di tahap review
    if (input.includes(':') && this.hasDisposisiTemplateFields(input)) {
      return this.handleDisposisiEditTemplateInput(session, input);
    }

    // Pilihan 2: Koreksi
    if (
      clean === '2' ||
      clean === 'koreksi' ||
      clean === 'ubah' ||
      clean === 'edit' ||
      clean === 'salah' ||
      clean === 'tidak' ||
      clean.includes('ada yang salah') ||
      clean === 'ganti'
    ) {
      sessionService.setState(session.whatsappNumber, BotState.DISPOSISI_EDIT_TEMPLATE);
      session.state = BotState.DISPOSISI_EDIT_TEMPLATE;
      return this.renderDisposisiEditTemplate(session);
    }

    return {
      text:
        `Mohon ketik:\n` +
        `• *1* atau *Ya* untuk menyimpan data disposisi\n` +
        `• *2* atau *Koreksi* untuk mengubah data\n` +
        `• *Batal* untuk membatalkan proses`,
    };
  }

  /**
   * Menampilkan template teks koreksi lembar disposisi yang bisa disalin langsung oleh pengguna.
   * Arahan dipisahkan ke bubble chat tersendiri (Bubble 1) dan template murni bersih di bubble chat tersendiri (Bubble 2),
   * sehingga pengguna di WhatsApp tinggal menyalin Bubble 2 tanpa perlu menghapus arahan/catatan manual.
   */
  public renderDisposisiEditTemplate(session: UserSession, customGuidePrefix?: string): BotResponse {
    const draft = session.draftDisposisi;
    const ext = draft?.extractedData;

    const diteruskanStr = ext?.diteruskanKepada && ext.diteruskanKepada.length > 0
      ? ext.diteruskanKepada.join(', ')
      : '-';

    const arahanStr = ext?.arahanDisposisi && ext.arahanDisposisi.length > 0
      ? ext.arahanDisposisi.join(', ')
      : '-';

    // Bubble 1: Petunjuk dan Catatan Pengisian
    const guideText =
      (customGuidePrefix ? `${customGuidePrefix}\n\n` : `✏️ *PANDUAN KOREKSI DATA DISPOSISI*\n\n`) +
      `Silakan *salin (copy)* pesan template di bawah ini, ubah data pada bagian yang salah, lalu *langsung kirimkan kembali* ke chat ini tanpa perlu memilih menu:\n\n` +
      `📌 *Catatan Pengisian:*\n` +
      `• *Nomor Agenda*: Nomor agenda surat masuk induk yang didisposisikan\n` +
      `• *Pemberi Disposisi*: Jabatan/Nama pemberi disposisi (contoh: Menteri Ketenagakerjaan RI)\n` +
      `• *Sifat Disposisi*: Biasa, Segera, Sangat Segera, Rahasia, Penting\n` +
      `• *Diteruskan Kepada*: Pejabat/unit kerja tujuan, pisahkan koma jika lebih dari satu (contoh: Sekjen, Dirjen PHI)\n` +
      `• *Arahan Pimpinan*: Arahan/instruksi pimpinan, pisahkan koma jika lebih dari satu (contoh: Agendakan, Hadiri)\n` +
      `• *Catatan Khusus*: Catatan khusus pimpinan (isi *-* jika tidak ada)\n` +
      `• *Tanggal Disposisi*: Tanggal lembar disposisi (contoh: 5 Oktober 2026 atau 2026-10-05)\n` +
      `• *Tanggal Acara*: Tanggal kegiatan jika ada acara terkait (isi *-* jika tidak ada)\n\n` +
      `_(Ketik *batal* jika ingin membatalkan)_`;

    // Bubble 2: Template Bersih (Murni Key-Value, Tanpa Arahan/Catatan agar 100% siap disalin dan diedit)
    const cleanTemplateText =
      `Nomor Agenda: ${ext?.nomorAgenda || '-'}\n` +
      `Pemberi Disposisi: ${ext?.pemberiDisposisi || 'Menteri Ketenagakerjaan RI'}\n` +
      `Sifat Disposisi: ${ext?.sifat || '-'}\n` +
      `Diteruskan Kepada: ${diteruskanStr}\n` +
      `Arahan Pimpinan: ${arahanStr}\n` +
      `Catatan Khusus: ${ext?.catatan || '-'}\n` +
      `Tanggal Disposisi: ${ext?.tanggalDisposisi || '-'}\n` +
      `Tanggal Acara: ${ext?.tanggalAcara || '-'}`;

    return {
      text: `${guideText}\n\n${cleanTemplateText}`,
      messages: [guideText, cleanTemplateText],
    };
  }

  /**
   * Menangani input template koreksi disposisi yang diedit dan dikirim kembali oleh pengguna
   */
  public async handleDisposisiEditTemplateInput(session: UserSession, input: string): Promise<BotResponse> {
    const clean = input.trim();
    const lower = clean.toLowerCase();

    if (lower === 'batal' || lower === '/cancel' || lower.includes('cancel')) {
      if (session.draftDisposisi?.tempFilePath) {
        pdfService.deleteTempPdf(session.draftDisposisi.tempFilePath);
      }
      sessionService.clearDisposisiDraft(session.whatsappNumber);
      sessionService.resetSession(session.whatsappNumber);
      return menuHandler.getConversationalGreeting(
        session,
        `Baik *${session.userName}*, proses pencatatan disposisi telah dibatalkan.`
      );
    }

    const draft = session.draftDisposisi;
    if (!draft || !draft.extractedData) {
      sessionService.resetSession(session.whatsappNumber);
      return menuHandler.getMainGreeting(session);
    }

    const parsed = this.parseDisposisiTemplate(clean);
    const updatedKeys: string[] = [];

    // Jika Nomor Agenda diubah -> Cek dan tautkan ulang surat induk
    if (parsed.nomorAgenda !== undefined) {
      const cleanAgenda = parsed.nomorAgenda.trim();
      draft.extractedData.nomorAgenda = cleanAgenda;
      updatedKeys.push('Nomor Agenda');

      if (cleanAgenda && cleanAgenda !== '-') {
        const matched = await disposisiService.findLetterByAgenda(cleanAgenda);
        if (matched) {
          draft.matchedLetter = {
            id: Number(matched.id),
            agendaNumber: matched.agenda_number,
            from: matched.from,
            subject: matched.subject || '-',
            perihal: matched.note || matched.subject || '-',
            dateLetter: matched.date_letter ? String(matched.date_letter) : undefined,
            file: matched.file || undefined,
          };
          const existingDisp = await disposisiService.findExistingDispositionByLetterId(matched.id);
          draft.existingDispositionId = existingDisp ? Number(existingDisp.id) : undefined;
          if ((!draft.extractedData.tanggalDisposisi || draft.extractedData.tanggalDisposisi === '-') && matched.date_letter) {
            draft.extractedData.tanggalDisposisi = formatTanggalIndo(matched.date_letter, false);
          }
        } else {
          draft.matchedLetter = undefined;
          draft.existingDispositionId = undefined;
        }
      } else {
        draft.matchedLetter = undefined;
        draft.existingDispositionId = undefined;
      }
    }

    if (parsed.pemberiDisposisi !== undefined) {
      const val = parsed.pemberiDisposisi.trim();
      draft.extractedData.pemberiDisposisi = val && val !== '-' ? val : 'Menteri Ketenagakerjaan RI';
      updatedKeys.push('Pemberi Disposisi');
    }

    if (parsed.sifat !== undefined) {
      const val = parsed.sifat.trim();
      draft.extractedData.sifat = val && val !== '-' ? val : '-';
      updatedKeys.push('Sifat Disposisi');
    }

    if (parsed.diteruskanKepada !== undefined) {
      const val = parsed.diteruskanKepada.trim();
      if (!val || val === '-' || /^(?:tidak\s+ada|belum\s+ada|kosong|-)$/i.test(val)) {
        draft.extractedData.diteruskanKepada = [];
      } else {
        draft.extractedData.diteruskanKepada = val.split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean);
      }
      updatedKeys.push('Diteruskan Kepada');
    }

    if (parsed.arahanDisposisi !== undefined) {
      const val = parsed.arahanDisposisi.trim();
      if (!val || val === '-' || /^(?:tidak\s+ada|belum\s+ada|kosong|-)$/i.test(val)) {
        draft.extractedData.arahanDisposisi = [];
      } else {
        draft.extractedData.arahanDisposisi = val.split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean);
      }
      updatedKeys.push('Arahan Pimpinan');
    }

    if (parsed.catatan !== undefined) {
      const val = parsed.catatan.trim();
      draft.extractedData.catatan = !val || val === '-' || /^(?:tidak\s+ada|belum\s+ada|kosong|-)$/i.test(val) ? '-' : val;
      updatedKeys.push('Catatan Khusus');
    }

    if (parsed.tanggalDisposisi !== undefined) {
      const val = parsed.tanggalDisposisi.trim();
      draft.extractedData.tanggalDisposisi = val && val !== '-' ? val : '-';
      updatedKeys.push('Tanggal Disposisi');
    }

    if (parsed.tanggalAcara !== undefined) {
      const val = parsed.tanggalAcara.trim();
      draft.extractedData.tanggalAcara = !val || val === '-' || /^(?:tidak\s+ada|belum\s+ada|kosong|-)$/i.test(val) ? undefined : val;
      updatedKeys.push('Tanggal Acara');
    }

    // Jika pengguna tidak menggunakan format key-value atau tidak ada field yang terdeteksi
    if (updatedKeys.length === 0) {
      const isSimpan = clean === '1' || lower === 'ya' || lower === 'simpan' || lower === 'sudah' || lower === 'sesuai' || lower === 'ok';
      if (isSimpan) {
        return this.handleReviewResponse(session, clean);
      }

      return this.renderDisposisiEditTemplate(session, `⚠️ *Format perubahan belum dikenali.*\nPastikan menggunakan format *Bagian: Nilai baru*.`);
    }

    sessionService.updateDisposisiDraft(session.whatsappNumber, draft);
    sessionService.setState(session.whatsappNumber, BotState.DISPOSISI_REVIEW_DATA);
    session.state = BotState.DISPOSISI_REVIEW_DATA;
    session.draftDisposisi = draft;

    return this.renderDisposisiReview(session);
  }

  /**
   * Mengecek apakah teks mengandung kata kunci field lembar disposisi
   */
  public hasDisposisiTemplateFields(text: string): boolean {
    const lower = text.toLowerCase();
    return (
      lower.includes('nomor agenda') ||
      lower.includes('agenda') ||
      lower.includes('pemberi disposisi') ||
      lower.includes('pemberi') ||
      lower.includes('sifat disposisi') ||
      lower.includes('sifat') ||
      lower.includes('diteruskan kepada') ||
      lower.includes('diteruskan') ||
      lower.includes('tujuan') ||
      lower.includes('arahan pimpinan') ||
      lower.includes('arahan') ||
      lower.includes('instruksi') ||
      lower.includes('catatan khusus') ||
      lower.includes('catatan') ||
      lower.includes('tanggal disposisi') ||
      lower.includes('tgl disposisi') ||
      lower.includes('tanggal acara') ||
      lower.includes('tgl acara')
    );
  }

  /**
   * Parsing teks template berformat key: value untuk koreksi lembar disposisi
   */
  public parseDisposisiTemplate(text: string): {
    nomorAgenda?: string;
    pemberiDisposisi?: string;
    sifat?: string;
    diteruskanKepada?: string;
    arahanDisposisi?: string;
    catatan?: string;
    tanggalDisposisi?: string;
    tanggalAcara?: string;
  } {
    const result: {
      nomorAgenda?: string;
      pemberiDisposisi?: string;
      sifat?: string;
      diteruskanKepada?: string;
      arahanDisposisi?: string;
      catatan?: string;
      tanggalDisposisi?: string;
      tanggalAcara?: string;
    } = {};

    const lines = text.split('\n');
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      // Abaikan baris pembungkus markdown atau instruksi dalam kurung
      if (/^_\s*\(.*?\)\s*_$/.test(line) || /^\(.*?\)$/.test(line)) continue;

      // Bersihkan dekorator awal baris seperti bullet, underscore, tanda bintang
      const lowerClean = line.toLowerCase().replace(/[\*\_•\-]/g, '').trim();
      if (
        lowerClean.startsWith('format ') ||
        lowerClean.startsWith('pilihan ') ||
        lowerClean.startsWith('panduan ') ||
        lowerClean.startsWith('catatan pengisian') ||
        lowerClean.startsWith('petunjuk ') ||
        lowerClean.startsWith('contoh ') ||
        lowerClean.startsWith('keterangan ') ||
        lowerClean.startsWith('silakan ') ||
        lowerClean.startsWith('cukup salin') ||
        lowerClean.startsWith('template ') ||
        lowerClean.startsWith('ketik ') ||
        lowerClean.startsWith('atau ketik ')
      ) {
        continue;
      }

      // Baris field harus memiliki tanda titik dua ':'
      const colonIdx = line.indexOf(':');
      if (colonIdx === -1) continue;

      const rawKey = line.slice(0, colonIdx).replace(/[\*\_•\-]/g, '').trim().toLowerCase();
      const rawVal = line.slice(colonIdx + 1).replace(/^[\*\_]+|[\*\_]+$/g, '').trim();

      if (!rawVal) continue;

      // Abaikan jika key diawali kata panduan/catatan
      if (
        rawKey.startsWith('format ') ||
        rawKey.startsWith('pilihan ') ||
        rawKey.startsWith('panduan ') ||
        rawKey.startsWith('catatan pengisian') ||
        rawKey.startsWith('petunjuk ') ||
        rawKey.startsWith('contoh ') ||
        rawKey.startsWith('keterangan ') ||
        rawKey.startsWith('nb')
      ) {
        continue;
      }

      if (rawKey.includes('agenda')) {
        result.nomorAgenda = rawVal;
      } else if (rawKey.includes('pemberi')) {
        result.pemberiDisposisi = rawVal;
      } else if (rawKey.includes('sifat')) {
        result.sifat = rawVal;
      } else if (rawKey.includes('diteruskan') || rawKey.includes('tujuan') || rawKey.includes('kepada')) {
        result.diteruskanKepada = rawVal;
      } else if (rawKey.includes('arahan') || rawKey.includes('instruksi') || rawKey.includes('tindakan')) {
        result.arahanDisposisi = rawVal;
      } else if (rawKey.includes('catatan') || rawKey.includes('keterangan')) {
        result.catatan = rawVal;
      } else if (rawKey.includes('tanggal disposisi') || rawKey.includes('tgl disposisi')) {
        result.tanggalDisposisi = rawVal;
      } else if (rawKey.includes('tanggal acara') || rawKey.includes('tgl acara') || rawKey.includes('tanggal kegiatan') || rawKey.includes('tgl kegiatan')) {
        result.tanggalAcara = rawVal;
      }
    }

    return result;
  }

  /**
   * Menangani pilihan bagian yang ingin dikoreksi
   */
  public handleEditChoice(session: UserSession, input: string): BotResponse {
    const clean = input.trim().toLowerCase();

    if (clean === 'kembali' || clean === 'batal') {
      sessionService.setState(session.whatsappNumber, BotState.DISPOSISI_REVIEW_DATA);
      return this.renderDisposisiReview(session);
    }

    const draft = session.draftDisposisi;
    if (!draft) {
      sessionService.resetSession(session.whatsappNumber);
      return menuHandler.getMainGreeting(session);
    }

    let fieldName = '';
    let promptMsg = '';

    switch (clean) {
      case '1':
      case 'agenda':
      case 'nomor agenda':
        fieldName = 'nomorAgenda';
        promptMsg = `Silakan ketikkan *Nomor Agenda* baru yang sesuai (contoh: _UND/2026/09/0001_):`;
        break;

      case '2':
      case 'diteruskan':
      case 'tujuan':
        fieldName = 'diteruskanKepada';
        promptMsg = `Silakan ketikkan daftar pejabat tujuan *Diteruskan Kepada* (pisahkan dengan koma, contoh: _Wakil Menteri, Sekjen, Dirjen PHI_):`;
        break;

      case '3':
      case 'arahan':
      case 'instruksi':
        fieldName = 'arahanDisposisi';
        promptMsg = `Silakan ketikkan *Arahan Pimpinan* (pisahkan dengan koma jika lebih dari satu, contoh: _Agendakan, Hadiri_):`;
        break;

      case '4':
      case 'catatan':
        fieldName = 'catatan';
        promptMsg = `Silakan ketikkan *Catatan Khusus* arahan pimpinan:`;
        break;

      case '5':
      case 'tanggal':
        fieldName = 'tanggalDisposisi';
        promptMsg = `Silakan ketikkan *Tanggal Disposisi* baru (contoh: _5 Oktober 2026_):`;
        break;

      default:
        return {
          text: `Pilihan tidak valid. Silakan ketik angka *1 - 5* untuk memilih field, atau ketik *Kembali*.`,
        };
    }

    draft.fieldBeingEdited = fieldName;
    sessionService.updateDisposisiDraft(session.whatsappNumber, draft);
    sessionService.setState(session.whatsappNumber, BotState.DISPOSISI_INPUT_NILAI_KOREKSI);

    return { text: promptMsg };
  }

  /**
   * Menangani input nilai baru hasil koreksi
   */
  public async handleEditValue(session: UserSession, input: string): Promise<BotResponse> {
    const draft = session.draftDisposisi;
    if (!draft || !draft.extractedData) {
      sessionService.resetSession(session.whatsappNumber);
      return menuHandler.getMainGreeting(session);
    }

    const field = draft.fieldBeingEdited;
    const value = input.trim();

    if (value.toLowerCase() === 'batal' || value.toLowerCase() === 'kembali') {
      draft.fieldBeingEdited = undefined;
      sessionService.setState(session.whatsappNumber, BotState.DISPOSISI_REVIEW_DATA);
      return this.renderDisposisiReview(session);
    }

    switch (field) {
      case 'nomorAgenda': {
        draft.extractedData.nomorAgenda = value;
        const matched = await disposisiService.findLetterByAgenda(value);
        if (matched) {
          draft.matchedLetter = {
            id: Number(matched.id),
            agendaNumber: matched.agenda_number,
            from: matched.from,
            subject: matched.subject || '-',
            perihal: matched.note || matched.subject || '-',
            dateLetter: matched.date_letter ? String(matched.date_letter) : undefined,
            file: matched.file || undefined,
          };
          const existingDisp = await disposisiService.findExistingDispositionByLetterId(matched.id);
          draft.existingDispositionId = existingDisp ? Number(existingDisp.id) : undefined;
          if ((!draft.extractedData.tanggalDisposisi || draft.extractedData.tanggalDisposisi === '-') && matched.date_letter) {
            draft.extractedData.tanggalDisposisi = formatTanggalIndo(matched.date_letter, false);
          }
        } else {
          draft.matchedLetter = undefined;
          draft.existingDispositionId = undefined;
        }
        break;
      }

      case 'diteruskanKepada': {
        const list = value.split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean);
        draft.extractedData.diteruskanKepada = list;
        break;
      }

      case 'arahanDisposisi': {
        const list = value.split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean);
        draft.extractedData.arahanDisposisi = list;
        break;
      }

      case 'catatan': {
        draft.extractedData.catatan = value;
        break;
      }

      case 'tanggalDisposisi': {
        draft.extractedData.tanggalDisposisi = value;
        break;
      }
    }

    draft.fieldBeingEdited = undefined;
    sessionService.updateDisposisiDraft(session.whatsappNumber, draft);

    // Jika nomor agenda baru tidak ditemukan di database
    if (field === 'nomorAgenda' && !draft.matchedLetter) {
      sessionService.setState(session.whatsappNumber, BotState.DISPOSISI_INPUT_AGENDA_MANUAL);
      return {
        text:
          `⚠️ Nomor Agenda *"${value}"* belum ditemukan di database surat masuk.\n\n` +
          `Silakan ketikkan Nomor Agenda yang valid, atau ketik *Batal*.`,
      };
    }

    sessionService.setState(session.whatsappNumber, BotState.DISPOSISI_REVIEW_DATA);
    return this.renderDisposisiReview(session);
  }

  /**
   * Menangani input nomor agenda secara manual jika OCR awal belum menemukan suratnya
   */
  public async handleAgendaManualInput(session: UserSession, input: string): Promise<BotResponse> {
    const clean = input.trim();

    if (clean.toLowerCase() === 'batal' || clean === '/cancel') {
      if (session.draftDisposisi?.tempFilePath) {
        pdfService.deleteTempPdf(session.draftDisposisi.tempFilePath);
      }
      sessionService.clearDisposisiDraft(session.whatsappNumber);
      sessionService.resetSession(session.whatsappNumber);
      return menuHandler.getConversationalGreeting(
        session,
        `Baik *${session.userName}*, proses pencatatan disposisi telah dibatalkan.`
      );
    }

    const matched = await disposisiService.findLetterByAgenda(clean);

    if (!matched) {
      return {
        text:
          `⚠️ Arsip surat dengan nomor agenda *"${clean}"* tidak ditemukan di database.\n\n` +
          `Mohon periksa kembali nomor agendanya atau ketik *Batal*.`,
      };
    }

    const existingDisp = await disposisiService.findExistingDispositionByLetterId(matched.id);

    const draft = session.draftDisposisi || {};
    draft.extractedData = draft.extractedData || {
      nomorAgenda: matched.agenda_number,
      diteruskanKepada: ['Sekretaris Jenderal'],
      arahanDisposisi: ['Agendakan'],
    };
    draft.extractedData.nomorAgenda = matched.agenda_number;
    draft.existingDispositionId = existingDisp ? Number(existingDisp.id) : undefined;
    if ((!draft.extractedData.tanggalDisposisi || draft.extractedData.tanggalDisposisi === '-') && matched.date_letter) {
      draft.extractedData.tanggalDisposisi = formatTanggalIndo(matched.date_letter, false);
    }
    draft.matchedLetter = {
      id: Number(matched.id),
      agendaNumber: matched.agenda_number,
      from: matched.from,
      subject: matched.subject || '-',
      perihal: matched.note || matched.subject || '-',
      dateLetter: matched.date_letter ? String(matched.date_letter) : undefined,
      file: matched.file || undefined,
    };

    sessionService.updateDisposisiDraft(session.whatsappNumber, draft);
    sessionService.setState(session.whatsappNumber, BotState.DISPOSISI_REVIEW_DATA);

    return this.renderDisposisiReview(session);
  }

  /**
   * Menangani pencarian surat dan menampilkan status disposisi (Fitur Pelacakan Status)
   */
  public async handleSearch(session: UserSession, input: string): Promise<BotResponse> {
    const clean = input.trim();
    if (isPureGreeting(clean) || clean.toLowerCase() === 'batal' || clean.toLowerCase() === 'menu') {
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

    const waktuInputStr = formatWaktuInputIndo(surat.createdAt);

    const fileUrl = getLetterFileUrl(surat.fileName);
    const fileLine = fileUrl ? `• *Link Berkas Surat*: ${fileUrl}\n` : '';

    const text =
      `📬 *DETAIL DISPOSISI SURAT*\n\n` +
      `• *Nomor Agenda* : ${surat.nomorAgenda}\n` +
      fileLine +
      `• *Pengirim*     : ${surat.asalSurat}\n` +
      `• *Perihal*      : ${surat.perihal}\n` +
      `• *Diinput Oleh* : ${surat.userInput?.nama || 'Petugas Protokol'}\n` +
      `• *Waktu Input*  : ${waktuInputStr}\n\n` +
      `${statusText}\n\n` +
      `Silakan beri tahu saya jika Anda ingin memeriksa status surat lainnya ya.`;

    return { text };
  }
}

export const disposisiHandler = new DisposisiHandler();
