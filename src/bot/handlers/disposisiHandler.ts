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
} from '../../utils/textHelper';
import { formatWaktuInputIndo } from '../../utils/dateHelper';

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

    if (cleanAgenda && cleanAgenda !== '-') {
      matchedLetter = await disposisiService.findLetterByAgenda(cleanAgenda);
    }

    // 4. Simpan ke draft sesi
    const draftData: DisposisiDraftData = {
      tempFilePath,
      tempFileName: originalFileName,
      finalFileName,
      fileSize: stats?.size || 0,
      isImage,
      extractedData: extracted,
      matchedLetter: matchedLetter
        ? {
            id: Number(matchedLetter.id),
            agendaNumber: matchedLetter.agenda_number,
            from: matchedLetter.from,
            subject: matchedLetter.subject || '-',
            perihal: matchedLetter.note || matchedLetter.subject || '-',
            dateLetter: matchedLetter.date_letter ? String(matchedLetter.date_letter) : undefined,
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
        : '-';

    const arahanStr =
      ext.arahanDisposisi && ext.arahanDisposisi.length > 0
        ? ext.arahanDisposisi.join(', ')
        : '-';

    const agendaDisplay = letter ? letter.agendaNumber : (ext.nomorAgenda || '-');
    const pengirimDisplay = letter ? letter.from : (ext.asalSurat || '-');
    const perihalDisplay = letter ? letter.perihal : (ext.perihal || '-');

    const text =
      `📋 *KONFIRMASI PENCATATAN DISPOSISI*\n\n` +
      `📄 *Informasi Surat Induk:*\n` +
      `• *Nomor Agenda* : ${agendaDisplay}\n` +
      `• *Pengirim*     : ${pengirimDisplay}\n` +
      `• *Perihal*      : ${perihalDisplay}\n\n` +
      `🎯 *Rincian Lembar Disposisi:*\n` +
      `• *Pemberi Disposisi* : ${ext.pemberiDisposisi || 'Menteri Ketenagakerjaan'}\n` +
      `• *Diteruskan Kepada* : ${diteruskanStr}\n` +
      `• *Arahan Pimpinan*   : ${arahanStr}\n` +
      `• *Catatan Khusus*    : ${ext.catatan || '-'}\n` +
      `• *Tanggal Disposisi* : ${ext.tanggalDisposisi || '-'}\n` +
      `• *Nama Berkas*       : ${draft.finalFileName || draft.tempFileName}\n\n` +
      `──────────────────────────────\n` +
      `Apakah data disposisi di atas sudah sesuai?\n\n` +
      `1️⃣ Ketik *1* atau *Ya* : Simpan ke Database\n` +
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

      return {
        text:
          `✅ *DISPOSISI SURAT BERHASIL DISIMPAN!*\n\n` +
          `• *Nomor Agenda* : ${saveResult.nomorAgenda}\n` +
          `• *Perihal*      : ${saveResult.perihal}\n` +
          `• *Nama Berkas*  : ${saveResult.fileName}\n` +
          fileLinkLine +
          `• *Status Surat* : Sudah Disposisi 🟢\n\n` +
          `Lembar disposisi telah berhasil diarsipkan ke database sistem dan terhubung dengan surat masuk induk.\n\n` +
          `Silakan beri tahu saya jika Anda ingin mencatat disposisi lainnya atau membutuhkan bantuan lain ya.`,
      };
    }

    // Pilihan 2: Koreksi
    if (clean === '2' || clean === 'koreksi' || clean === 'ubah' || clean === 'edit') {
      sessionService.setState(session.whatsappNumber, BotState.DISPOSISI_EDIT_FIELD);

      return {
        text:
          `✏️ *KOREKSI DATA DISPOSISI*\n\n` +
          `Pilih bagian data yang ingin Anda koreksi:\n\n` +
          `1️⃣ *Nomor Agenda* (Hubungkan ke surat masuk lain)\n` +
          `2️⃣ *Diteruskan Kepada* (Daftar pejabat tujuan)\n` +
          `3️⃣ *Arahan Pimpinan* (Instruksi pimpinan)\n` +
          `4️⃣ *Catatan Khusus* (Catatan tulisan tangan/arahan)\n` +
          `5️⃣ *Tanggal Disposisi*\n\n` +
          `Ketik angka *1 - 5* untuk memilih bagian yang ingin diubah, atau ketik *Kembali* untuk kembali ke menu review:`,
      };
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
          };
        } else {
          draft.matchedLetter = undefined;
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

    const draft = session.draftDisposisi || {};
    draft.extractedData = draft.extractedData || {
      nomorAgenda: matched.agenda_number,
      diteruskanKepada: ['Sekretaris Jenderal'],
      arahanDisposisi: ['Agendakan'],
    };
    draft.extractedData.nomorAgenda = matched.agenda_number;
    draft.matchedLetter = {
      id: Number(matched.id),
      agendaNumber: matched.agenda_number,
      from: matched.from,
      subject: matched.subject || '-',
      perihal: matched.note || matched.subject || '-',
      dateLetter: matched.date_letter ? String(matched.date_letter) : undefined,
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
