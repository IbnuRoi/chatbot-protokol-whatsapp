import { sessionService, BotState, UserSession, ExtractedSuratData } from '../../services/sessionService';
import { suratService } from '../../services/suratService';
import { pdfService } from '../../services/pdfService';
import { aiService, formatPerihalByTemplate } from '../../services/aiService';
import { NluResult } from '../../services/nluService';
import { menuHandler } from './menuHandler';
import { BotResponse } from '../types';
import { formatNomorAgendaLink, generateLetterFileName } from '../../utils/textHelper';

export const KATEGORI_LABEL_MAP: Record<string, string> = {
  UND: 'UND (Undangan Acara / Rapat)',
  PH: 'PH (Permohonan Hadir / Sambutan)',
  UNR: 'UNR (Undangan Pernikahan)',
  AU: 'AU (Permohonan Audiensi)',
  WR: 'WR (Permohonan Wawancara)',
  TAP: 'TAP (Permohonan Video Ucapan)',
  LP: 'LP (Laporan Pelaksanaan)',
};

export class SuratMasukHandler {
  /**
   * Memulai alur Surat Masuk: Tampilkan instruksi kirim dokumen PDF
   */
  public async startFlow(session: UserSession): Promise<BotResponse> {
    sessionService.setState(session.whatsappNumber, BotState.SURAT_MASUK_UPLOAD_PDF);
    sessionService.clearDraft(session.whatsappNumber);

    const text =
      `📥 *REGISTRASI SURAT MASUK*\n\n` +
      `Silakan langsung kirimkan berkas dokumen surat berformat *PDF* ke chat ini. 📄\n\n` +
      `Sistem cerdas Protokol akan otomatis membaca isi surat, menentukan kategori (*UND / PH / UNR / AU / WR / TAP*), meng-generate nomor agenda sesuai kategori, dan menyusun perihal resmi sesuai template standar.\n\n` +
      `Ketik *batal* jika ingin membatalkan.`;

    return { text };
  }

  /**
   * Menangani pilihan Jenis Surat
   */
  public async handlePilihJenis(session: UserSession, input: string, nlu?: NluResult): Promise<BotResponse> {
    const clean = input.trim().toUpperCase();
    const lower = input.trim().toLowerCase();

    const mapJenis: Record<string, string> = {
      '1': 'UND',
      '2': 'UNR',
      '3': 'PH',
      '4': 'AU',
      '5': 'WR',
      '6': 'LP',
      '7': 'TAP',
      'UND': 'UND',
      'UNR': 'UNR',
      'PH': 'PH',
      'AU': 'AU',
      'WR': 'WR',
      'LP': 'LP',
      'TAP': 'TAP',
    };

    let selectedJenis: string | undefined = nlu?.entities?.jenisSurat || mapJenis[clean];

    if (!selectedJenis) {
      if (lower.includes('rapat')) {
        selectedJenis = 'UNR';
      } else if (lower.includes('undangan')) {
        selectedJenis = 'UND';
      } else if (lower.includes('permohonan') || lower.includes('narasumber')) {
        selectedJenis = 'PH';
      } else if (lower.includes('audiensi')) {
        selectedJenis = 'AU';
      } else if (lower.includes('wawancara') || lower.includes('liputan')) {
        selectedJenis = 'WR';
      } else if (lower.includes('laporan')) {
        selectedJenis = 'LP';
      } else if (lower.includes('upacara') || lower.includes('protokol')) {
        selectedJenis = 'TAP';
      }
    }

    if (!selectedJenis) {
      return {
        text: `⚠️ Jenis surat belum dikenali.\n\n` +
        `Silakan ketik nama jenis surat (misal: *Undangan*, *Rapat*, *Permohonan*, *Audiensi*):`
      };
    }

    // Generate Nomor Agenda otomatis
    const generatedAgenda = await suratService.generateNomorAgenda(selectedJenis);

    sessionService.updateDraft(session.whatsappNumber, {
      jenisSurat: selectedJenis,
      nomorAgenda: generatedAgenda,
    });
    sessionService.setState(session.whatsappNumber, BotState.SURAT_MASUK_KONFIRMASI_AGENDA);

    const text =
      `📌 *Nomor Agenda yang digenerate sistem:*\n` +
      `👉 *${generatedAgenda}*\n\n` +
      `Apakah nomor agenda ini sudah sesuai? Anda bisa mengonfirmasi _"sudah sesuai"_ untuk melanjutkan, atau beri tahu saya jika ingin mengisi secara manual ya.`;

    return { text };
  }

  /**
   * Menangani konfirmasi Nomor Agenda
   */
  public async handleKonfirmasiAgenda(session: UserSession, input: string, nlu?: NluResult): Promise<BotResponse> {
    const clean = input.trim().toLowerCase();

    if (
      nlu?.entities?.agendaAction === 'CONFIRM' ||
      clean === '1' ||
      clean === 'ya' ||
      clean === 'y' ||
      clean.includes('sesuai') ||
      clean.includes('benar') ||
      clean.includes('oke') ||
      clean.includes('lanjut') ||
      clean.includes('gunakan')
    ) {
      return this.showPilihTipeSurat(session);
    } else if (
      nlu?.entities?.agendaAction === 'MANUAL' ||
      clean === '2' ||
      clean === 'tidak' ||
      clean === 't' ||
      clean.includes('manual') ||
      clean.includes('ubah') ||
      clean.includes('ganti')
    ) {
      sessionService.setState(session.whatsappNumber, BotState.SURAT_MASUK_INPUT_AGENDA_MANUAL);
      return (
        `✏️ *Input Nomor Agenda Manual*\n` +
        `Silakan ketik Nomor Agenda yang diinginkan (contoh: *${session.draftSurat?.nomorAgenda || 'UND/2026/09/0001'}*):`
      );
    } else {
      return {
        text: `Apakah nomor agenda tersebut sudah sesuai? Silakan jawab _"sudah sesuai"_ atau beri tahu jika ingin input manual ya.`,
      };
    }
  }

  /**
   * Menangani input manual Nomor Agenda
   */
  public async handleInputAgendaManual(session: UserSession, input: string): Promise<BotResponse> {
    const cleanAgenda = input.trim();
    if (cleanAgenda.length < 3) {
      return `⚠️ Nomor Agenda terlalu pendek. Silakan masukkan nomor agenda yang valid:`;
    }

    const isExists = await suratService.isNomorAgendaExists(cleanAgenda);
    if (isExists) {
      return (
        `⚠️ Nomor Agenda *${cleanAgenda}* sudah digunakan oleh surat lain di database!\n` +
        `Silakan masukkan nomor agenda lain:`
      );
    }

    sessionService.updateDraft(session.whatsappNumber, { nomorAgenda: cleanAgenda });
    return this.showPilihTipeSurat(session);
  }

  /**
   * Menampilkan pilihan Tipe Surat
   */
  private showPilihTipeSurat(session: UserSession): BotResponse {
    sessionService.setState(session.whatsappNumber, BotState.SURAT_MASUK_PILIH_TIPE);
    return {
      text:
        `📑 *Tingkat Klasifikasi / Tipe Surat*\n\n` +
        `Surat ini termasuk klasifikasi yang mana ya?\n\n` +
        `• *Biasa*\n` +
        `• *Rahasia*\n` +
        `• *Penting*\n` +
        `• *Tembusan*\n\n` +
        `Silakan sebutkan tingkat klasifikasinya (misalnya: _Penting_ atau _Biasa_).`,
    };
  }

  /**
   * Menangani pilihan Tipe Surat
   */
  public async handlePilihTipe(session: UserSession, input: string, nlu?: NluResult): Promise<BotResponse> {
    const clean = input.trim().toUpperCase();
    const lower = input.trim().toLowerCase();

    const mapTipe: Record<string, string> = {
      '1': 'Biasa',
      '2': 'Rahasia',
      '3': 'Penting',
      '4': 'Tembusan',
      'BIASA': 'Biasa',
      'RAHASIA': 'Rahasia',
      'PENTING': 'Penting',
      'TEMBUSAN': 'Tembusan',
    };

    let tipe: string | undefined = nlu?.entities?.tipeSurat || mapTipe[clean];

    if (!tipe) {
      if (lower.includes('penting')) tipe = 'Penting';
      else if (lower.includes('rahasia')) tipe = 'Rahasia';
      else if (lower.includes('tembusan')) tipe = 'Tembusan';
      else if (lower.includes('biasa')) tipe = 'Biasa';
    }

    if (!tipe) {
      return this.showPilihTipeSurat(session);
    }

    sessionService.updateDraft(session.whatsappNumber, { tipeSurat: tipe });
    sessionService.setState(session.whatsappNumber, BotState.SURAT_MASUK_UPLOAD_PDF);

    return (
      `📤 *UNGGAH DOKUMEN SURAT (PDF)*\n\n` +
      `Nomor Agenda: *${session.draftSurat?.nomorAgenda}*\n` +
      `Jenis Surat : *${session.draftSurat?.jenisSurat}* | Tipe: *${tipe}*\n\n` +
      `Silakan kirimkan berkas dokumen surat berformat *PDF* (maks. 20 MB) ke ruang percakapan ini ya.`
    );
  }

  /**
   * Menangani unggah berkas PDF langsung (tanpa melalui menu manual)
   */
  public async handleDirectPdfUpload(
    session: UserSession,
    tempFilePath: string,
    originalFileName: string
  ): Promise<BotResponse> {
    const scanResult = await pdfService.validateAndScanPdf(tempFilePath, originalFileName);

    if (!scanResult.isValid || !scanResult.isSafe) {
      return {
        text:
          `⚠️ *Unggahan Dokumen Ditolak!*\n\n` +
          `Alasan: ${scanResult.errorMessage || 'Berkas PDF tidak memenuhi standar keamanan sistem.'}\n\n` +
          `Silakan unggah kembali dokumen PDF yang valid.`,
      };
    }

    // Ekstraksi teks dari berkas PDF
    const rawPdfText = await pdfService.extractText(tempFilePath);

    // AI Ekstraksi Data Dokumen & Pemahaman Isi Surat
    const extractedData = await aiService.extractSuratData(rawPdfText, originalFileName);

    // Kategori surat hasil pemahaman AI (UND, PH, UNR, WR, AU, TAP, LP)
    const detectedJenis = (extractedData.kategoriSurat || 'UND').toUpperCase();
    const defaultTipe = 'Biasa';

    // Generate Nomor Agenda otomatis berdasarkan kategori surat yang dihasilkan chatbot
    const generatedAgenda = await suratService.generateNomorAgenda(detectedJenis);
    const finalFileName = generateLetterFileName(originalFileName);

    sessionService.updateDraft(session.whatsappNumber, {
      jenisSurat: detectedJenis,
      tipeSurat: defaultTipe,
      nomorAgenda: generatedAgenda,
      asalInstansi: 'Lainnya',
      tempPdfPath: tempFilePath,
      tempPdfName: originalFileName,
      finalFileName,
      fileSize: scanResult.fileSize,
      extractedData,
      finalPerihal: extractedData.perihal || extractedData.subject || '-',
    });

    sessionService.setState(session.whatsappNumber, BotState.SURAT_MASUK_REVIEW_DATA);

    return this.renderExtractedDataReview(session);
  }

  /**
   * Menangani berkas PDF yang diunggah dari menu manual
   */
  public async handlePdfUpload(
    session: UserSession,
    tempFilePath: string,
    originalFileName: string
  ): Promise<BotResponse> {
    return this.handleDirectPdfUpload(session, tempFilePath, originalFileName);
  }

  /**
   * Menampilkan hasil ekstraksi dokumen ke dalam satu bubble chat untuk dikonfirmasi
   */
  public renderExtractedDataReview(session: UserSession, isUpdated: boolean = false): BotResponse {
    const draft = session.draftSurat;
    const data = draft?.extractedData;
    const finalName = draft?.finalFileName || generateLetterFileName(draft?.tempPdfName);
    const agendaLink = formatNomorAgendaLink(draft?.nomorAgenda, finalName);
    const jenisCode = (draft?.jenisSurat || 'UND').toUpperCase();
    const jenisLabel = KATEGORI_LABEL_MAP[jenisCode] || jenisCode;
    const finalPerihalDanAcara = draft?.finalPerihal || data?.perihal || data?.subject || '-';

    const title = isUpdated ? `📄 *DATA SURAT BERHASIL DIPERBARUI*` : `📄 *HASIL ANALISIS & EKSTRAKSI DOKUMEN*`;

    const text =
      `${title}\n\n` +
      `Sistem telah membaca isi surat dan menentukan kategori serta perihalnya:\n\n` +
      `• 📌 *Nomor Agenda* : ${agendaLink}\n` +
      `• 📑 *Kategori Surat*: *${jenisLabel}* _(Auto-Detect)_\n` +
      `• 🏷️ *Tipe Klasifikasi*: ${draft?.tipeSurat || 'Biasa'}\n` +
      `• 🔢 *Nomor Surat*   : ${data?.nomorSurat || '-'}\n` +
      `• 📅 *Tanggal Surat* : ${data?.tanggalSurat || '-'}\n` +
      `• 🏛️ *Asal Surat*    : ${data?.asalSurat || '-'}\n` +
      `• 📝 *Perihal Resmi* : ${finalPerihalDanAcara}\n` +
      `• 📍 *Kegiatan/Acara*: ${finalPerihalDanAcara}\n` +
      `• 👤 *PIC & Kontak*  : ${data?.picPengirim || '-'}\n\n` +
      `Apakah data di atas sudah benar?\n` +
      `👉 Ketik *Ya* / *Benar* untuk langsung menyimpan ke database.\n` +
      `👉 Ketik *Salah* / *Koreksi* jika ada data atau kategori yang ingin diperbaiki.`;

    return { text };
  }

  /**
   * Menangani respon review data hasil ekstraksi
   */
  public async handleReviewData(session: UserSession, input: string, nlu?: NluResult): Promise<BotResponse> {
    const clean = input.trim();
    const lower = clean.toLowerCase();

    // Cek jika pengguna langsung mengirimkan teks template koreksi
    if (clean.includes(':') && this.hasTemplateFields(clean)) {
      return this.handleEditTemplateInput(session, clean);
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
      if (!session.draftSurat) {
        sessionService.resetSession(session.whatsappNumber);
        return { text: `⚠️ Draft surat tidak ditemukan. Silakan kirimkan kembali berkas dokumen surat ya.` };
      }

      session.draftSurat.jenisSurat = session.draftSurat.jenisSurat || 'UND';
      session.draftSurat.tipeSurat = session.draftSurat.tipeSurat || 'Biasa';

      const result = await suratService.saveSuratDraft(session.draftSurat, session.userId);

      if (result.success) {
        const savedFileName = result.fileName || session.draftSurat.finalFileName || session.draftSurat.tempPdfName;
        const savedData = session.draftSurat.extractedData;
        const finalPerihal = session.draftSurat.finalPerihal || savedData?.perihal || '-';
        const agendaLink = formatNomorAgendaLink(result.nomorAgenda, savedFileName);
        const jenisCode = (session.draftSurat?.jenisSurat || 'UND').toUpperCase();
        const jenisLabel = KATEGORI_LABEL_MAP[jenisCode] || jenisCode;

        sessionService.resetSession(session.whatsappNumber);

        return {
          text:
            `✅ *SURAT BERHASIL DISIMPAN KE DATABASE!*\n\n` +
            `Data surat dan berkas fisik telah berhasil diregistrasi ke sistem:\n` +
            `• 📌 *Nomor Agenda* : ${agendaLink}\n` +
            `• 📑 *Kategori Surat*: *${jenisLabel}*\n` +
            `• 🏷️ *Tipe Klasifikasi*: ${session.draftSurat?.tipeSurat || 'Biasa'}\n` +
            `• 🔢 *Nomor Surat*  : ${savedData?.nomorSurat || '-'}\n` +
            `• 🏛️ *Pengirim*     : ${savedData?.asalSurat || '-'}\n` +
            `• 📝 *Perihal Resmi*: ${finalPerihal}\n` +
            `• 📂 *Status Disposisi*: 🟡 BELUM DISPOSISI\n\n` +
            `_Catatan: Berkas telah tersimpan di database dan siap ditindaklanjuti lebih lanjut melalui sistem protokol._\n\n` +
            `Bila ada hal lain yang ingin Anda kelola atau cari, silakan beri tahu saya ya. 😊`,
        };
      } else {
        return {
          text: `❌ Gagal menyimpan surat: ${result.message}\n\nKetik *Ya* untuk mencoba menyimpan kembali, atau *Batal*.`,
        };
      }
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
      sessionService.setState(session.whatsappNumber, BotState.SURAT_MASUK_EDIT_TEMPLATE);
      return this.renderEditTemplatePrompt(session);
    }

    // 3. Pembatalan
    if (lower === 'batal' || lower.includes('cancel')) {
      await suratService.cancelDraft(session.draftSurat, session.userId);
      sessionService.resetSession(session.whatsappNumber);
      return {
        text:
          `🚫 *REGISTRASI DIBATALKAN*\n\n` +
          `Draft registrasi surat telah dibatalkan dan berkas sementara telah dibersihkan.`,
      };
    }

    // Default jika belum jelas
    return {
      text:
        `Apakah data di atas sudah benar?\n` +
        `👉 Ketik *Ya* / *Benar* untuk langsung menyimpan ke database.\n` +
        `👉 Ketik *Salah* / *Koreksi* jika ada data yang ingin diperbaiki.`,
    };
  }

  /**
   * Menampilkan template teks koreksi yang bisa disalin langsung oleh pengguna tanpa menu pilihan
   */
  public renderEditTemplatePrompt(session: UserSession): BotResponse {
    const draft = session.draftSurat;
    const data = draft?.extractedData;
    const perihal = draft?.finalPerihal || data?.perihal || data?.subject || '-';
    const kategori = (draft?.jenisSurat || 'UND').toUpperCase();

    const text =
      `✏️ *TEMPLATE KOREKSI DATA SURAT*\n\n` +
      `Silakan **salin (copy)** template teks di bawah ini, ubah data pada bagian yang salah, lalu **kirimkan kembali** ke chat ini tanpa perlu memilih menu:\n\n` +
      `Kategori: ${kategori}\n` +
      `Nomor Surat: ${data?.nomorSurat || '-'}\n` +
      `Tanggal Surat: ${data?.tanggalSurat || '-'}\n` +
      `Asal Surat: ${data?.asalSurat || '-'}\n` +
      `Perihal: ${perihal}\n` +
      `Event: ${perihal}\n` +
      `PIC: ${data?.picPengirim || '-'}\n\n` +
      `_Pilihan Kategori: UND (Undangan Acara), PH (Permohonan Hadir/Sambutan), UNR (Pernikahan), AU (Audiensi), WR (Wawancara), TAP (Video Ucapan)_\n\n` +
      `_(Cukup salin teks di atas, sesuaikan isinya, lalu kirimkan kembali ke sini ya. Ketik *batal* jika ingin membatalkan)_`;

    return { text };
  }

  /**
   * Menangani input template yang diedit dan dikirim kembali oleh pengguna
   */
  public async handleEditTemplateInput(session: UserSession, input: string): Promise<BotResponse> {
    const clean = input.trim();
    const lower = clean.toLowerCase();

    if (lower === 'batal' || lower.includes('cancel')) {
      await suratService.cancelDraft(session.draftSurat, session.userId);
      sessionService.resetSession(session.whatsappNumber);
      return {
        text: `🚫 *REGISTRASI DIBATALKAN*\n\nDraft registrasi surat telah dibatalkan.`,
      };
    }

    if (!session.draftSurat) {
      sessionService.resetSession(session.whatsappNumber);
      return { text: `⚠️ Draft surat tidak ditemukan. Silakan kirimkan kembali berkas dokumen surat ya.` };
    }

    if (!session.draftSurat.extractedData) {
      session.draftSurat.extractedData = {
        nomorSurat: '-',
        tanggalSurat: '-',
        subject: '-',
        asalSurat: '-',
        event: '-',
        picPengirim: '-',
        perihal: '-',
      };
    }

    const parsed = this.parseSuratTemplate(clean);
    const updatedKeys: string[] = [];

    // Jika pengguna mengubah kategori surat
    if (parsed.kategori && parsed.kategori !== session.draftSurat.jenisSurat) {
      session.draftSurat.jenisSurat = parsed.kategori;
      session.draftSurat.extractedData.kategoriSurat = parsed.kategori as any;
      const newAgenda = await suratService.generateNomorAgenda(parsed.kategori);
      session.draftSurat.nomorAgenda = newAgenda;
      updatedKeys.push(`Kategori (${parsed.kategori}) & Nomor Agenda (${newAgenda})`);

      // Jika perihal tidak diisi manual oleh user di koreksi, generate ulang template perihal sesuai kategori baru
      if (!parsed.perihal) {
        const autoPerihal = formatPerihalByTemplate(session.draftSurat.extractedData);
        session.draftSurat.finalPerihal = autoPerihal;
        session.draftSurat.extractedData.perihal = autoPerihal;
      }
    }

    if (parsed.nomorSurat) {
      session.draftSurat.extractedData.nomorSurat = parsed.nomorSurat;
      updatedKeys.push('Nomor Surat');
    }
    if (parsed.tanggalSurat) {
      session.draftSurat.extractedData.tanggalSurat = parsed.tanggalSurat;
      updatedKeys.push('Tanggal Surat');
    }
    if (parsed.asalSurat) {
      session.draftSurat.extractedData.asalSurat = parsed.asalSurat;
      updatedKeys.push('Asal Surat');
    }
    if (parsed.perihal) {
      session.draftSurat.extractedData.perihal = parsed.perihal;
      session.draftSurat.extractedData.subject = parsed.perihal;
      session.draftSurat.extractedData.event = parsed.perihal;
      session.draftSurat.finalPerihal = parsed.perihal;
      updatedKeys.push('Perihal & Acara');
    } else if (parsed.event) {
      session.draftSurat.extractedData.event = parsed.event;
      session.draftSurat.extractedData.perihal = parsed.event;
      session.draftSurat.extractedData.subject = parsed.event;
      session.draftSurat.finalPerihal = parsed.event;
      updatedKeys.push('Perihal & Acara');
    }
    if (parsed.picPengirim) {
      session.draftSurat.extractedData.picPengirim = parsed.picPengirim;
      updatedKeys.push('PIC');
    }

    // Jika pengguna tidak menggunakan format key-value sama sekali:
    if (updatedKeys.length === 0) {
      if (lower === 'ya' || lower === 'simpan' || lower === 'benar') {
        return this.handleReviewData(session, clean);
      }

      return {
        text:
          `⚠️ Format perubahan belum dikenali.\n\n` +
          `Silakan salin template berikut dan kirimkan kembali dengan perubahan Anda:\n\n` +
          `Kategori: ${session.draftSurat.jenisSurat || 'UND'}\n` +
          `Nomor Surat: ${session.draftSurat.extractedData.nomorSurat || '-'}\n` +
          `Tanggal Surat: ${session.draftSurat.extractedData.tanggalSurat || '-'}\n` +
          `Asal Surat: ${session.draftSurat.extractedData.asalSurat || '-'}\n` +
          `Perihal: ${session.draftSurat.finalPerihal || session.draftSurat.extractedData.perihal || '-'}\n` +
          `Event: ${session.draftSurat.extractedData.event || '-'}\n` +
          `PIC: ${session.draftSurat.extractedData.picPengirim || '-'}\n\n` +
          `_(Atau ketik *batal* untuk membatalkan)_`,
      };
    }

    // Kembali ke state REVIEW_DATA dengan tampilan hasil pembaruan
    sessionService.setState(session.whatsappNumber, BotState.SURAT_MASUK_REVIEW_DATA);
    return this.renderExtractedDataReview(session, true);
  }

  /**
   * Mengecek apakah teks mengandung kata kunci template surat
   */
  public hasTemplateFields(text: string): boolean {
    const lower = text.toLowerCase();
    return (
      lower.includes('kategori') ||
      lower.includes('jenis') ||
      lower.includes('nomor surat') ||
      lower.includes('tanggal surat') ||
      lower.includes('asal surat') ||
      lower.includes('pengirim') ||
      lower.includes('perihal') ||
      lower.includes('event') ||
      lower.includes('pic')
    );
  }

  /**
   * Parsing teks template berformat key: value yang dikirim kembali oleh pengguna
   */
  public parseSuratTemplate(text: string): {
    kategori?: string;
    nomorSurat?: string;
    tanggalSurat?: string;
    asalSurat?: string;
    perihal?: string;
    event?: string;
    picPengirim?: string;
  } {
    const result: {
      kategori?: string;
      nomorSurat?: string;
      tanggalSurat?: string;
      asalSurat?: string;
      perihal?: string;
      event?: string;
      picPengirim?: string;
    } = {};

    const lines = text.split('\n');
    for (const line of lines) {
      const trimmed = line.trim().replace(/^[\*•\-\s]+/, '');
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx === -1) continue;

      const rawKey = trimmed.slice(0, colonIdx).replace(/[\*\_]/g, '').trim().toLowerCase();
      const rawVal = trimmed.slice(colonIdx + 1).replace(/[\*\_]/g, '').trim();

      if (!rawVal || rawVal === '-') continue;

      if (rawKey.includes('kategori') || rawKey.includes('jenis')) {
        const valUpper = rawVal.toUpperCase();
        if (['UND', 'PH', 'UNR', 'AU', 'WR', 'TAP', 'LP'].includes(valUpper)) {
          result.kategori = valUpper;
        } else if (valUpper.includes('NIKAH') || valUpper.includes('PERNIKAHAN') || valUpper.includes('UNR')) {
          result.kategori = 'UNR';
        } else if (valUpper.includes('SAMBUTAN') || valUpper.includes('NARASUMBER') || valUpper.includes('PERMOHONAN HADIR') || valUpper.includes('PH')) {
          result.kategori = 'PH';
        } else if (valUpper.includes('AUDIENSI') || valUpper.includes('AU')) {
          result.kategori = 'AU';
        } else if (valUpper.includes('WAWANCARA') || valUpper.includes('LIPUTAN') || valUpper.includes('WR')) {
          result.kategori = 'WR';
        } else if (valUpper.includes('UCAPAN') || valUpper.includes('VIDEO') || valUpper.includes('TAP')) {
          result.kategori = 'TAP';
        } else if (valUpper.includes('UNDANGAN') || valUpper.includes('UND')) {
          result.kategori = 'UND';
        }
      } else if (rawKey.includes('nomor surat') || rawKey === 'nomor' || rawKey === 'no surat') {
        result.nomorSurat = rawVal;
      } else if (rawKey.includes('tanggal') || rawKey.includes('tgl')) {
        result.tanggalSurat = rawVal;
      } else if (rawKey.includes('asal') || rawKey.includes('pengirim') || rawKey.includes('instansi')) {
        result.asalSurat = rawVal;
      } else if (rawKey.includes('perihal') || rawKey.includes('hal') || rawKey.includes('subject')) {
        result.perihal = rawVal;
      } else if (rawKey.includes('event') || rawKey.includes('acara') || rawKey.includes('kegiatan')) {
        result.event = rawVal;
      } else if (rawKey.includes('pic') || rawKey.includes('kontak') || rawKey.includes('telepon')) {
        result.picPengirim = rawVal;
      }
    }

    return result;
  }

  /**
   * Menangani pemilihan field yang ingin dikoreksi
   */
  public async handlePilihFieldKoreksi(session: UserSession, input: string, nlu?: NluResult): Promise<BotResponse> {
    const clean = input.trim();
    const lower = clean.toLowerCase();

    if (
      nlu?.entities?.fieldToEdit === 'LANJUT' ||
      clean === '0' ||
      lower.includes('selesai') ||
      lower.includes('lanjut') ||
      lower.includes('batal')
    ) {
      sessionService.setState(session.whatsappNumber, BotState.SURAT_MASUK_REVIEW_DATA);
      return this.renderExtractedDataReview(session);
    }

    const fieldMap: Record<string, { key: string; label: string }> = {
      '1': { key: 'tanggalSurat', label: 'Tanggal Surat' },
      '2': { key: 'nomorSurat', label: 'Nomor Surat' },
      '3': { key: 'subject', label: 'Subject/Hal' },
      '4': { key: 'asalSurat', label: 'Asal Surat' },
      '5': { key: 'event', label: 'Event/Acara' },
      '6': { key: 'picPengirim', label: 'PIC & Kontak' },
      '7': { key: 'perihal', label: 'Perihal' },
      '8': { key: 'jenisSurat', label: 'Jenis Surat' },
      '9': { key: 'tipeSurat', label: 'Tipe / Klasifikasi' },
    };

    let target: { key: string; label: string } | undefined = fieldMap[clean];

    if (!target) {
      if (lower.includes('tanggal')) target = fieldMap['1'];
      else if (lower.includes('nomor')) target = fieldMap['2'];
      else if (lower.includes('subject') || lower.includes('hal')) target = fieldMap['3'];
      else if (lower.includes('asal') || lower.includes('pengirim') || lower.includes('instansi')) target = fieldMap['4'];
      else if (lower.includes('event') || lower.includes('acara') || lower.includes('kegiatan')) target = fieldMap['5'];
      else if (lower.includes('pic') || lower.includes('kontak') || lower.includes('telepon')) target = fieldMap['6'];
      else if (lower.includes('perihal')) target = fieldMap['7'];
      else if (lower.includes('jenis')) target = fieldMap['8'];
      else if (lower.includes('tipe') || lower.includes('klasifikasi')) target = fieldMap['9'];
    }

    if (!target) {
      return {
        text: `⚠️ Data yang ingin diubah belum dikenali.\n\nSilakan ketik nomor (1-9) atau nama data yang ingin diubah (contoh: *Tanggal*, *Nomor Surat*, *Perihal*, *Jenis*):`,
      };
    }

    sessionService.updateDraft(session.whatsappNumber, { fieldBeingEdited: target.key });
    sessionService.setState(session.whatsappNumber, BotState.SURAT_MASUK_INPUT_NILAI_KOREKSI);

    let currentValue = '-';
    if (target.key === 'jenisSurat') {
      currentValue = session.draftSurat?.jenisSurat || 'UND';
    } else if (target.key === 'tipeSurat') {
      currentValue = session.draftSurat?.tipeSurat || 'Biasa';
    } else if (session.draftSurat?.extractedData) {
      currentValue = (session.draftSurat.extractedData as any)[target.key] || '-';
    }

    return {
      text:
        `📝 *Koreksi ${target.label}*\n` +
        `Nilai saat ini: _${currentValue}_\n\n` +
        `Silakan ketikkan nilai baru yang benar:`,
    };
  }

  /**
   * Menangani input nilai baru hasil koreksi
   */
  public async handleInputNilaiKoreksi(session: UserSession, input: string): Promise<BotResponse> {
    const field = session.draftSurat?.fieldBeingEdited;
    if (!field || !session.draftSurat) {
      sessionService.setState(session.whatsappNumber, BotState.SURAT_MASUK_REVIEW_DATA);
      return this.renderExtractedDataReview(session);
    }

    const val = input.trim();
    if (field === 'jenisSurat') {
      const cleanJenis = val.toUpperCase();
      const validJenis = ['UND', 'UNR', 'PH', 'AU', 'WR', 'LP', 'TAP'];
      let chosen = 'UND';
      if (validJenis.includes(cleanJenis)) {
        chosen = cleanJenis;
      } else if (cleanJenis.includes('NIKAH') || cleanJenis.includes('UNR')) {
        chosen = 'UNR';
      } else if (cleanJenis.includes('SAMBUTAN') || cleanJenis.includes('NARASUMBER') || cleanJenis.includes('PERMOHONAN HADIR') || cleanJenis.includes('PH')) {
        chosen = 'PH';
      } else if (cleanJenis.includes('AUDIENSI') || cleanJenis.includes('AU')) {
        chosen = 'AU';
      } else if (cleanJenis.includes('WAWANCARA') || cleanJenis.includes('WR')) {
        chosen = 'WR';
      } else if (cleanJenis.includes('UCAPAN') || cleanJenis.includes('VIDEO') || cleanJenis.includes('TAP')) {
        chosen = 'TAP';
      }
      const generatedAgenda = await suratService.generateNomorAgenda(chosen);
      session.draftSurat.jenisSurat = chosen;
      session.draftSurat.nomorAgenda = generatedAgenda;
      if (session.draftSurat.extractedData) {
        session.draftSurat.extractedData.kategoriSurat = chosen as any;
        const autoPerihal = formatPerihalByTemplate(session.draftSurat.extractedData);
        session.draftSurat.finalPerihal = autoPerihal;
        session.draftSurat.extractedData.perihal = autoPerihal;
        session.draftSurat.extractedData.event = autoPerihal;
      }
    } else if (field === 'tipeSurat') {
      session.draftSurat.tipeSurat = val;
    } else if (session.draftSurat.extractedData) {
      (session.draftSurat.extractedData as any)[field] = val;
      if (field === 'perihal' || field === 'event') {
        session.draftSurat.finalPerihal = val;
        session.draftSurat.extractedData.perihal = val;
        session.draftSurat.extractedData.event = val;
      }
    }

    session.draftSurat.fieldBeingEdited = undefined;
    sessionService.setState(session.whatsappNumber, BotState.SURAT_MASUK_REVIEW_DATA);

    return this.renderExtractedDataReview(session);
  }

  /**
   * Menampilkan pilihan Asal Instansi
   */
  private showPilihAsalInstansi(session: UserSession): BotResponse {
    sessionService.setState(session.whatsappNumber, BotState.SURAT_MASUK_PILIH_ASAL_INSTANSI);
    return {
      text:
        `🏛️ *Kategori Asal Instansi Pengirim*\n\n` +
        `Surat ini berasal dari instansi kategori apa ya?\n\n` +
        `• *Pemerintah* — Kementerian, Lembaga, Pemda, Kedinasan\n` +
        `• *Serikat Kerja* — Serikat Pekerja, Buruh, Federasi\n` +
        `• *Perusahaan* — BUMN, BUMD, Swasta, Korporasi\n` +
        `• *Lainnya* — Organisasi Masyarakat, Individu, dll\n\n` +
        `Silakan sebutkan kategorinya (misalnya: _Pemerintah_ atau _Perusahaan_).`,
    };
  }

  /**
   * Menangani pilihan Asal Instansi dan menghasilkan rekomendasi Perihal AI
   */
  public async handlePilihAsalInstansi(session: UserSession, input: string, nlu?: NluResult): Promise<BotResponse> {
    const clean = input.trim();
    const lower = clean.toLowerCase();
    const mapInstansi: Record<string, string> = {
      '1': 'Pemerintah',
      '2': 'Serikat Kerja',
      '3': 'Perusahaan',
      '4': 'Lainnya',
    };

    let instansi: string | undefined = nlu?.entities?.instansiKategori || mapInstansi[clean];
    if (!instansi) {
      if (lower.includes('pemerintah') || lower.includes('kementerian') || lower.includes('dinas') || lower.includes('pemda')) {
        instansi = 'Pemerintah';
      } else if (lower.includes('serikat') || lower.includes('buruh') || lower.includes('pekerja')) {
        instansi = 'Serikat Kerja';
      } else if (lower.includes('perusahaan') || lower.includes('pt') || lower.includes('cv') || lower.includes('swasta') || lower.includes('bumn')) {
        instansi = 'Perusahaan';
      } else if (lower.includes('lain')) {
        instansi = 'Lainnya';
      }
    }

    if (!instansi) {
      return this.showPilihAsalInstansi(session);
    }

    sessionService.updateDraft(session.whatsappNumber, { asalInstansi: instansi });

    // AI Generate Perihal
    const extracted = session.draftSurat?.extractedData;
    const aiPerihal = await aiService.generatePerihalRecommendation({
      subject: extracted?.subject || 'Surat Dinas',
      asalSurat: extracted?.asalSurat || 'Instansi Terkait',
      event: extracted?.event,
    });

    sessionService.updateDraft(session.whatsappNumber, { aiRecommendedPerihal: aiPerihal });
    sessionService.setState(session.whatsappNumber, BotState.SURAT_MASUK_REVIEW_PERIHAL_AI);

    return {
      text:
        `🤖 *REKOMENDASI PERIHAL RESMI (AI)*\n\n` +
        `👉 *"${aiPerihal}"*\n\n` +
        `Apakah rumusan perihal di atas sudah sesuai? Silakan ketik _"sudah sesuai"_ untuk menggunakan rekomendasi AI, atau ketik _"input manual"_:`,
    };
  }

  /**
   * Menangani review Perihal AI
   */
  public async handleReviewPerihalAi(session: UserSession, input: string, nlu?: NluResult): Promise<BotResponse> {
    const clean = input.trim().toLowerCase();

    if (
      nlu?.entities?.perihalAction === 'CONFIRM' ||
      clean === '1' ||
      clean === 'ya' ||
      clean === 'y' ||
      clean.includes('sesuai') ||
      clean.includes('benar') ||
      clean.includes('oke') ||
      clean.includes('lanjut') ||
      clean.includes('gunakan') ||
      clean.includes('ai')
    ) {
      sessionService.updateDraft(session.whatsappNumber, {
        finalPerihal: session.draftSurat?.aiRecommendedPerihal,
      });
      return this.showFinalConfirmation(session);
    } else if (
      nlu?.entities?.perihalAction === 'MANUAL' ||
      clean === '2' ||
      clean === 'tidak' ||
      clean === 't' ||
      clean.includes('manual') ||
      clean.includes('ubah') ||
      clean.includes('ganti') ||
      clean.includes('sendiri')
    ) {
      sessionService.setState(session.whatsappNumber, BotState.SURAT_MASUK_INPUT_PERIHAL_MANUAL);
      return (
        `✏️ *Input Perihal Manual*\n` +
        `Silakan ketikkan rumusan perihal surat resmi yang diinginkan:`
      );
    } else {
      return {
        text: `Apakah perihal rekomendasi AI sudah sesuai? Silakan ketik _"sudah sesuai"_ atau _"input manual"_:`,
      };
    }
  }

  /**
   * Menangani input perihal manual
   */
  public async handleInputPerihalManual(session: UserSession, input: string): Promise<BotResponse> {
    const perihal = input.trim();
    if (!perihal) {
      return `⚠️ Perihal tidak boleh kosong. Silakan ketikkan perihal surat:`;
    }

    sessionService.updateDraft(session.whatsappNumber, { finalPerihal: perihal });
    return this.showFinalConfirmation(session);
  }

  /**
   * Menampilkan konfirmasi final sebelum transaksi database
   */
  public showFinalConfirmation(session: UserSession): BotResponse {
    const draft = session.draftSurat;
    const ext = draft?.extractedData;

    sessionService.setState(session.whatsappNumber, BotState.SURAT_MASUK_FINAL_CONFIRM);

    const text =
      `📋 *KONFIRMASI FINAL REGISTRASI SURAT*\n\n` +
      `Berikut ringkasan data registrasi yang siap disimpan:\n\n` +
      `• *Nomor Agenda*  : ${draft?.nomorAgenda}\n` +
      `• *Jenis / Tipe*   : ${draft?.jenisSurat} / ${draft?.tipeSurat}\n` +
      `• *Asal Instansi*  : ${draft?.asalInstansi}\n` +
      `• *Pengirim*       : ${ext?.asalSurat}\n` +
      `• *Tanggal Surat*  : ${ext?.tanggalSurat}\n` +
      `• *Event/Agenda*   : ${ext?.event}\n` +
      `• *PIC & Kontak*   : ${ext?.picPengirim}\n` +
      `• *Perihal Final*  : ${draft?.finalPerihal}\n` +
      `• *Berkas Dokumen* : ${draft?.finalFileName || draft?.tempPdfName} (${((draft?.fileSize || 0) / 1024).toFixed(1)} KB)\n\n` +
      `Simpan surat masuk ini ke dalam database? Ketik _"simpan"_ untuk menyelesaikan, atau _"batal"_:`;

    return { text };
  }

  /**
   * Menangani simpan final atau pembatalan
   */
  public async handleFinalConfirm(session: UserSession, input: string, nlu?: NluResult): Promise<BotResponse> {
    const clean = input.trim().toLowerCase();

    if (
      nlu?.entities?.finalAction === 'SAVE' ||
      clean === '1' ||
      clean === 'ya' ||
      clean === 'simpan' ||
      clean.includes('simpan') ||
      clean.includes('terbit') ||
      clean.includes('benar') ||
      clean.includes('oke') ||
      clean.includes('selesai')
    ) {
      const result = await suratService.saveSuratDraft(session.draftSurat!, session.userId);

      if (result.success) {
        sessionService.resetSession(session.whatsappNumber);
        const agendaLink = formatNomorAgendaLink(result.nomorAgenda, result.fileName);
        return {
          text:
            `✅ *REGISTRASI SURAT BERHASIL!*\n\n` +
            `Surat telah resmi tercatat di sistem:\n` +
            `📌 *Nomor Agenda :* ${agendaLink}\n` +
            `📂 *Status Disposisi:* BELUM DISPOSISI\n\n` +
            `Berkas PDF telah dipindahkan ke penyimpanan yang aman. Silakan beri tahu saya jika ada hal lain yang bisa dibantu.`,
        };
      } else {
        return {
          text: `❌ Gagal menyimpan surat: ${result.message}\n\nKetik _"simpan"_ untuk coba lagi atau _"batal"_.`,
        };
      }
    } else if (
      nlu?.entities?.finalAction === 'CANCEL' ||
      nlu?.intent === 'BATAL' ||
      clean === '2' ||
      clean === 'batal' ||
      clean === 'tidak' ||
      clean.includes('gajadi') ||
      clean.includes('cancel')
    ) {
      await suratService.cancelDraft(session.draftSurat, session.userId);
      sessionService.resetSession(session.whatsappNumber);
      return {
        text:
          `🚫 *REGISTRASI DIBATALKAN*\n\n` +
          `Draft registrasi surat telah dibatalkan dan berkas sementara telah dibersihkan. Silakan beri tahu saya jika ada hal lain yang ingin Anda kerjakan.`,
      };
    } else {
      return this.showFinalConfirmation(session);
    }
  }
}

export const suratMasukHandler = new SuratMasukHandler();
