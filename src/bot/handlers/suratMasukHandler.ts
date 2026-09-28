import { sessionService, BotState, UserSession, ExtractedSuratData } from '../../services/sessionService';
import { suratService } from '../../services/suratService';
import { pdfService } from '../../services/pdfService';
import { aiService, formatPerihalByTemplate, generateSubjectSummary, formatAsalSurat } from '../../services/aiService';
import { NluResult } from '../../services/nluService';
import { menuHandler } from './menuHandler';
import { BotResponse } from '../types';
import { formatNomorAgendaLink, generateLetterFileName, splitPicNameAndPhone } from '../../utils/textHelper';
import { formatWaktuInputIndo } from '../../utils/dateHelper';

export const KATEGORI_LABEL_MAP: Record<string, string> = {
  UND: 'UND',
  PH: 'PH',
  UNR: 'UNR',
  AU: 'AU',
  WR: 'WR',
  TAP: 'TAP',
  LP: 'LP',
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

    const finalPerihal = extractedData.perihal || '-';
    const finalSubject = (extractedData.subject || generateSubjectSummary(finalPerihal, extractedData)).slice(0, 200);

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
      finalPerihal,
      finalSubject,
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
    const finalPerihal = draft?.finalPerihal || data?.perihal || '-';
    const finalSubject = (draft?.finalSubject || data?.subject || generateSubjectSummary(finalPerihal, data)).slice(0, 200);

    let picName = data?.picName || '';
    let picPhone = data?.picPhoneNumber || '';
    if ((!picName || picName === '-' || !picPhone || picPhone === '-') && data?.picPengirim && data.picPengirim !== '-') {
      const splitted = splitPicNameAndPhone(data.picPengirim);
      if (!picName || picName === '-') picName = splitted.name;
      if (!picPhone || picPhone === '-') picPhone = splitted.phone;
    }
    if (!picName) picName = '-';
    if (!picPhone) picPhone = '-';

    const title = isUpdated ? `📄 *DATA SURAT BERHASIL DIPERBARUI*` : `📄 *HASIL ANALISIS & EKSTRAKSI DOKUMEN*`;

    const text =
      `${title}\n\n` +
      `Sistem telah membaca isi surat dan menentukan kategori serta perihalnya:\n\n` +
      `• 📌 *Nomor Agenda* : ${agendaLink}\n` +
      `• 📑 *Kategori Surat*: *${jenisCode}*\n` +
      `• 🏷️ *Tipe Klasifikasi*: ${draft?.tipeSurat || 'Biasa'}\n` +
      `• 🔢 *Nomor Surat*   : ${data?.nomorSurat || '-'}\n` +
      `• 📅 *Tanggal Surat* : ${data?.tanggalSurat || '-'}\n` +
      `• ✍️ *Asal Surat*    : ${data?.asalSurat || '-'}\n` +
      `• 📋 *Subject*       : ${finalSubject}\n` +
      `• 📝 *Perihal Resmi* : ${finalPerihal}\n` +
      (data?.dateEvent && data.dateEvent !== '-' ? `• 🗓️ *Waktu / Tgl Acara*: ${data.dateEvent}\n` : '') +
      `• 👤 *Nama PIC*      : ${picName}\n` +
      `• 📞 *Nomor PIC*     : ${picPhone}\n` +
      `• 👤 *Petugas Input* : ${session.userName || 'Petugas Protokol'}\n\n` +
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

      const result = await suratService.saveSuratDraft(session.draftSurat, session.userId, session.userName);

      if (result.success) {
        const savedFileName = result.fileName || session.draftSurat.finalFileName || session.draftSurat.tempPdfName;
        const savedData = session.draftSurat.extractedData;
        const finalPerihal = session.draftSurat.finalPerihal || savedData?.perihal || '-';
        const finalSubject = (session.draftSurat.finalSubject || savedData?.subject || generateSubjectSummary(finalPerihal, savedData)).slice(0, 200);
        const agendaLink = formatNomorAgendaLink(result.nomorAgenda, savedFileName);
        const jenisCode = (session.draftSurat?.jenisSurat || 'UND').toUpperCase();
        const jenisLabel = KATEGORI_LABEL_MAP[jenisCode] || jenisCode;
        const userPenginput = result.createdBy || session.userName || 'Petugas Protokol';
        const waktuInputStr = formatWaktuInputIndo(result.createdAt || new Date());

        sessionService.resetSession(session.whatsappNumber);

        let picName = savedData?.picName || '';
        let picPhone = savedData?.picPhoneNumber || '';
        if ((!picName || picName === '-' || !picPhone || picPhone === '-') && savedData?.picPengirim && savedData.picPengirim !== '-') {
          const splitted = splitPicNameAndPhone(savedData.picPengirim);
          if (!picName || picName === '-') picName = splitted.name;
          if (!picPhone || picPhone === '-') picPhone = splitted.phone;
        }
        if (!picName) picName = '-';
        if (!picPhone) picPhone = '-';

        return {
          text:
            `✅ *SURAT BERHASIL DISIMPAN KE DATABASE!*\n\n` +
            `Data surat dan berkas fisik telah berhasil diregistrasi ke sistem:\n` +
            `• 📌 *Nomor Agenda* : ${agendaLink}\n` +
            `• 📑 *Kategori Surat*: *${jenisCode}*\n` +
            `• 🏷️ *Tipe Klasifikasi*: ${session.draftSurat?.tipeSurat || 'Biasa'}\n` +
            `• 🔢 *Nomor Surat*  : ${savedData?.nomorSurat || '-'}\n` +
            `• ✍️ *Asal Surat*   : ${savedData?.asalSurat || '-'}\n` +
            `• 📋 *Subject*      : ${finalSubject}\n` +
            `• 📝 *Perihal Resmi*: ${finalPerihal}\n` +
            (savedData?.dateEvent && savedData.dateEvent !== '-' ? `• 🗓️ *Waktu / Tgl Acara*: ${savedData.dateEvent}\n` : '') +
            `• 👤 *Nama PIC*     : ${picName}\n` +
            `• 📞 *Nomor PIC*    : ${picPhone}\n` +
            `• 📂 *Status Disposisi*: 🟡 BELUM DISPOSISI\n` +
            `• 👤 *Diinput Oleh*  : ${userPenginput}\n` +
            `• ⏰ *Waktu Input*   : ${waktuInputStr}\n\n` +
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
    const perihal = draft?.finalPerihal || data?.perihal || '-';
    const subject = (draft?.finalSubject || data?.subject || generateSubjectSummary(perihal, data)).slice(0, 200);
    const kategori = (draft?.jenisSurat || 'UND').toUpperCase();

    let picName = data?.picName || '';
    let picPhone = data?.picPhoneNumber || '';
    if ((!picName || picName === '-' || !picPhone || picPhone === '-') && data?.picPengirim && data.picPengirim !== '-') {
      const splitted = splitPicNameAndPhone(data.picPengirim);
      if (!picName || picName === '-') picName = splitted.name;
      if (!picPhone || picPhone === '-') picPhone = splitted.phone;
    }
    if (!picName) picName = '-';
    if (!picPhone) picPhone = '-';

    const text =
      `✏️ *TEMPLATE KOREKSI DATA SURAT*\n\n` +
      `Silakan **salin (copy)** template teks di bawah ini, ubah data pada bagian yang salah, lalu **kirimkan kembali** ke chat ini tanpa perlu memilih menu:\n\n` +
      `Kategori: ${kategori}\n` +
      `Nomor Surat: ${data?.nomorSurat || '-'}\n` +
      `Tanggal Surat: ${data?.tanggalSurat || '-'}\n` +
      `Asal Surat: ${data?.asalSurat || '-'}\n` +
      `Subject: ${subject}\n` +
      `Perihal: ${perihal}\n` +
      `Tanggal Acara: ${data?.dateEvent || '-'}\n` +
      `Nama PIC: ${picName}\n` +
      `Nomor PIC: ${picPhone}\n\n` +
      `_Format Asal Surat: Nama Pengirim - Jabatan (nama individu/pejabat penandatangan di paling bawah surat, bukan instansi. Jika ada beberapa orang penandatangan, pilih salah satu nama beserta jabatannya)_\n` +
      `_Tanggal Acara: isi jika surat memuat kegiatan/acara, atau isi '-' jika tidak ada acara_\n` +
      `_Pilihan Kategori: UND, PH, UNR, AU, WR, TAP, LP_\n\n` +
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
        session.draftSurat.extractedData.event = autoPerihal;
        if (!parsed.subject) {
          const autoSubj = generateSubjectSummary(autoPerihal, session.draftSurat.extractedData);
          session.draftSurat.finalSubject = autoSubj;
          session.draftSurat.extractedData.subject = autoSubj;
        }
      }
    }

    if (parsed.nomorSurat) {
      session.draftSurat.extractedData.nomorSurat = parsed.nomorSurat.trim().slice(0, 100);
      updatedKeys.push('Nomor Surat');
    }
    if (parsed.tanggalSurat) {
      session.draftSurat.extractedData.tanggalSurat = parsed.tanggalSurat.trim().slice(0, 50);
      updatedKeys.push('Tanggal Surat');
    }
    if (parsed.asalSurat) {
      session.draftSurat.extractedData.asalSurat = formatAsalSurat(parsed.asalSurat).slice(0, 220);
      updatedKeys.push('Asal Surat');
    }
    if (parsed.subject) {
      const cleanSubj = parsed.subject.slice(0, 200);
      session.draftSurat.finalSubject = cleanSubj;
      session.draftSurat.extractedData.subject = cleanSubj;
      updatedKeys.push('Subject');
    }
    if (parsed.perihal) {
      session.draftSurat.extractedData.perihal = parsed.perihal;
      session.draftSurat.extractedData.event = parsed.perihal;
      session.draftSurat.finalPerihal = parsed.perihal;
      if (!parsed.subject) {
        const autoSubj = generateSubjectSummary(parsed.perihal, session.draftSurat.extractedData);
        session.draftSurat.finalSubject = autoSubj;
        session.draftSurat.extractedData.subject = autoSubj;
      }
      updatedKeys.push('Perihal');
    } else if (parsed.event) {
      session.draftSurat.extractedData.event = parsed.event;
      session.draftSurat.extractedData.perihal = parsed.event;
      session.draftSurat.finalPerihal = parsed.event;
      if (!parsed.subject) {
        const autoSubj = generateSubjectSummary(parsed.event, session.draftSurat.extractedData);
        session.draftSurat.finalSubject = autoSubj;
        session.draftSurat.extractedData.subject = autoSubj;
      }
      updatedKeys.push('Perihal');
    }
    if (parsed.dateEvent !== undefined) {
      if (parsed.dateEvent === '-' || /^(?:tidak\s+ada|belum\s+ada|kosong|-)$/i.test(parsed.dateEvent)) {
        session.draftSurat.extractedData.dateEvent = undefined;
      } else {
        session.draftSurat.extractedData.dateEvent = parsed.dateEvent.trim().slice(0, 100);
      }
      updatedKeys.push('Tanggal Acara');
    }
    if (parsed.picName) {
      session.draftSurat.extractedData.picName = parsed.picName.trim().slice(0, 100);
      updatedKeys.push('Nama PIC');
    }
    if (parsed.picPhoneNumber) {
      session.draftSurat.extractedData.picPhoneNumber = parsed.picPhoneNumber.trim().slice(0, 50);
      updatedKeys.push('Nomor PIC');
    }
    if (parsed.picPengirim && !parsed.picName && !parsed.picPhoneNumber) {
      const splitted = splitPicNameAndPhone(parsed.picPengirim);
      session.draftSurat.extractedData.picName = splitted.name.slice(0, 100);
      session.draftSurat.extractedData.picPhoneNumber = splitted.phone.slice(0, 50);
      session.draftSurat.extractedData.picPengirim = parsed.picPengirim.trim().slice(0, 100);
      updatedKeys.push('PIC');
    } else if (parsed.picName || parsed.picPhoneNumber) {
      const curN = session.draftSurat.extractedData.picName || '';
      const curP = session.draftSurat.extractedData.picPhoneNumber || '';
      session.draftSurat.extractedData.picPengirim = [curN, curP].filter(Boolean).join(' - ').slice(0, 100);
    }

    // Jika pengguna tidak menggunakan format key-value sama sekali:
    if (updatedKeys.length === 0) {
      if (lower === 'ya' || lower === 'simpan' || lower === 'benar') {
        return this.handleReviewData(session, clean);
      }

      const curPerihal = session.draftSurat.finalPerihal || session.draftSurat.extractedData.perihal || '-';
      const curSubject = (session.draftSurat.finalSubject || session.draftSurat.extractedData.subject || generateSubjectSummary(curPerihal, session.draftSurat.extractedData)).slice(0, 200);

      let curPicName = session.draftSurat.extractedData.picName || '';
      let curPicPhone = session.draftSurat.extractedData.picPhoneNumber || '';
      if ((!curPicName || curPicName === '-' || !curPicPhone || curPicPhone === '-') && session.draftSurat.extractedData.picPengirim && session.draftSurat.extractedData.picPengirim !== '-') {
        const splitted = splitPicNameAndPhone(session.draftSurat.extractedData.picPengirim);
        if (!curPicName || curPicName === '-') curPicName = splitted.name;
        if (!curPicPhone || curPicPhone === '-') curPicPhone = splitted.phone;
      }
      if (!curPicName) curPicName = '-';
      if (!curPicPhone) curPicPhone = '-';
      const curDateEvent = session.draftSurat.extractedData.dateEvent || '-';

      return {
        text:
          `⚠️ Format perubahan belum dikenali.\n\n` +
          `Silakan salin template berikut dan kirimkan kembali dengan perubahan Anda:\n\n` +
          `Kategori: ${session.draftSurat.jenisSurat || 'UND'}\n` +
          `Nomor Surat: ${session.draftSurat.extractedData.nomorSurat || '-'}\n` +
          `Tanggal Surat: ${session.draftSurat.extractedData.tanggalSurat || '-'}\n` +
          `Asal Surat: ${session.draftSurat.extractedData.asalSurat || '-'}\n` +
          `Subject: ${curSubject}\n` +
          `Perihal: ${curPerihal}\n` +
          `Tanggal Acara: ${curDateEvent}\n` +
          `Nama PIC: ${curPicName}\n` +
          `Nomor PIC: ${curPicPhone}\n\n` +
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
      lower.includes('penandatangan') ||
      lower.includes('ttd') ||
      lower.includes('subject') ||
      lower.includes('subjek') ||
      lower.includes('perihal') ||
      lower.includes('event') ||
      lower.includes('tanggal acara') ||
      lower.includes('tgl acara') ||
      lower.includes('waktu acara') ||
      lower.includes('date event') ||
      lower.includes('tanggal kegiatan') ||
      lower.includes('nama pic') ||
      lower.includes('nomor pic') ||
      lower.includes('no pic') ||
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
    subject?: string;
    perihal?: string;
    event?: string;
    dateEvent?: string;
    picPengirim?: string;
    picName?: string;
    picPhoneNumber?: string;
  } {
    const result: {
      kategori?: string;
      nomorSurat?: string;
      tanggalSurat?: string;
      asalSurat?: string;
      subject?: string;
      perihal?: string;
      event?: string;
      dateEvent?: string;
      picPengirim?: string;
      picName?: string;
      picPhoneNumber?: string;
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
      } else if (rawKey.includes('tanggal surat') || rawKey.includes('tgl surat') || (rawKey.includes('tanggal') && !rawKey.includes('acara') && !rawKey.includes('kegiatan') && !rawKey.includes('event')) || rawKey === 'tgl') {
        result.tanggalSurat = rawVal;
      } else if (rawKey.includes('asal') || rawKey.includes('pengirim') || rawKey.includes('penandatangan') || rawKey.includes('ttd') || rawKey.includes('instansi')) {
        result.asalSurat = formatAsalSurat(rawVal);
      } else if (rawKey === 'subject' || rawKey === 'subjek' || rawKey === 'judul') {
        result.subject = rawVal.slice(0, 200);
      } else if (rawKey.includes('perihal') || rawKey.includes('hal')) {
        result.perihal = rawVal;
      } else if (
        rawKey.includes('tanggal acara') ||
        rawKey.includes('tgl acara') ||
        rawKey.includes('waktu acara') ||
        rawKey.includes('tanggal kegiatan') ||
        rawKey.includes('tgl kegiatan') ||
        rawKey.includes('waktu kegiatan') ||
        rawKey.includes('date event') ||
        rawKey.includes('tanggal event') ||
        rawKey.includes('tgl event')
      ) {
        result.dateEvent = rawVal;
      } else if (rawKey.includes('event') || rawKey.includes('acara') || rawKey.includes('kegiatan')) {
        result.event = rawVal;
      } else if (rawKey === 'nama pic' || rawKey === 'pic name') {
        result.picName = rawVal;
      } else if (
        rawKey === 'nomor pic' ||
        rawKey === 'no pic' ||
        rawKey === 'telepon pic' ||
        rawKey === 'hp pic' ||
        rawKey === 'wa pic' ||
        rawKey === 'kontak pic' ||
        rawKey === 'no hp pic' ||
        rawKey === 'nomor hp pic' ||
        rawKey === 'pic phone' ||
        rawKey === 'pic phone number'
      ) {
        result.picPhoneNumber = rawVal;
      } else if (rawKey.includes('pic') || rawKey.includes('kontak') || rawKey.includes('telepon')) {
        result.picPengirim = rawVal;
        const splitted = splitPicNameAndPhone(rawVal);
        if (splitted.name && !result.picName) result.picName = splitted.name;
        if (splitted.phone && !result.picPhoneNumber) result.picPhoneNumber = splitted.phone;
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
      '3': { key: 'subject', label: 'Subject (Ringkasan)' },
      '4': { key: 'perihal', label: 'Perihal Resmi' },
      '5': { key: 'asalSurat', label: 'Asal Surat (Nama Pengirim - Jabatan)' },
      '6': { key: 'dateEvent', label: 'Waktu / Tanggal Acara' },
      '7': { key: 'picName', label: 'Nama PIC' },
      '8': { key: 'picPhoneNumber', label: 'Nomor Kontak PIC' },
      '9': { key: 'jenisSurat', label: 'Kategori / Jenis Surat' },
      '10': { key: 'tipeSurat', label: 'Tipe / Klasifikasi' },
    };

    let target: { key: string; label: string } | undefined = fieldMap[clean];

    if (!target) {
      if (lower.includes('tanggal surat') || lower.includes('tgl surat') || (lower.includes('tanggal') && !lower.includes('acara') && !lower.includes('kegiatan') && !lower.includes('event'))) target = fieldMap['1'];
      else if (lower.includes('nomor surat') || lower.includes('no surat') || (lower.includes('nomor') && !lower.includes('pic'))) target = fieldMap['2'];
      else if (lower.includes('subject') || lower.includes('subjek') || lower.includes('judul')) target = fieldMap['3'];
      else if (lower.includes('perihal') || lower.includes('hal')) target = fieldMap['4'];
      else if (lower.includes('asal') || lower.includes('pengirim') || lower.includes('penandatangan') || lower.includes('ttd') || lower.includes('instansi')) target = fieldMap['5'];
      else if (lower.includes('tanggal acara') || lower.includes('tgl acara') || lower.includes('waktu acara') || lower.includes('date event') || lower.includes('tanggal kegiatan') || lower.includes('waktu kegiatan') || lower.includes('acara')) target = fieldMap['6'];
      else if (lower.includes('nama pic') || lower === 'nama') target = fieldMap['7'];
      else if (lower.includes('nomor pic') || lower.includes('no pic') || lower.includes('hp pic') || lower.includes('wa pic') || lower.includes('telepon pic') || lower.includes('kontak pic') || lower.includes('telepon') || lower.includes('nomor hp') || lower.includes('no hp')) target = fieldMap['8'];
      else if (lower.includes('pic') || lower.includes('kontak')) target = fieldMap['7'];
      else if (lower.includes('kategori') || lower.includes('jenis')) target = fieldMap['9'];
      else if (lower.includes('tipe') || lower.includes('klasifikasi')) target = fieldMap['10'];
    }

    if (!target) {
      return {
        text: `⚠️ Data yang ingin diubah belum dikenali.\n\nSilakan ketik nomor (1-10) atau nama data yang ingin diubah (contoh: *Subject*, *Perihal*, *Asal Surat*, *Tanggal Acara*, *Nama PIC*, *Nomor PIC*, *Kategori*):`,
      };
    }

    sessionService.updateDraft(session.whatsappNumber, { fieldBeingEdited: target.key });
    sessionService.setState(session.whatsappNumber, BotState.SURAT_MASUK_INPUT_NILAI_KOREKSI);

    let currentValue = '-';
    if (target.key === 'jenisSurat') {
      currentValue = session.draftSurat?.jenisSurat || 'UND';
    } else if (target.key === 'tipeSurat') {
      currentValue = session.draftSurat?.tipeSurat || 'Biasa';
    } else if (target.key === 'subject') {
      currentValue = session.draftSurat?.finalSubject || session.draftSurat?.extractedData?.subject || '-';
    } else if (target.key === 'perihal') {
      currentValue = session.draftSurat?.finalPerihal || session.draftSurat?.extractedData?.perihal || '-';
    } else if (target.key === 'dateEvent') {
      currentValue = session.draftSurat?.extractedData?.dateEvent || '-';
    } else if (target.key === 'picName') {
      currentValue = session.draftSurat?.extractedData?.picName || (session.draftSurat?.extractedData?.picPengirim ? splitPicNameAndPhone(session.draftSurat.extractedData.picPengirim).name : '') || '-';
    } else if (target.key === 'picPhoneNumber') {
      currentValue = session.draftSurat?.extractedData?.picPhoneNumber || (session.draftSurat?.extractedData?.picPengirim ? splitPicNameAndPhone(session.draftSurat.extractedData.picPengirim).phone : '') || '-';
    } else if (session.draftSurat?.extractedData) {
      currentValue = (session.draftSurat.extractedData as any)[target.key] || '-';
    }

    let hint = '';
    if (target.key === 'asalSurat') {
      hint = `\n_(Gunakan format: Nama Pengirim - Jabatan, nama penandatangan di paling bawah surat, bukan instansi. Jika ada beberapa orang, pilih salah satu nama beserta jabatannya)_\n`;
    } else if (target.key === 'dateEvent') {
      hint = `\n_(Ketik tanggal dan waktu pelaksanaan acara, atau ketik "-" jika tidak ada acara)_\n`;
    }

    return {
      text:
        `📝 *Koreksi ${target.label}*\n` +
        `Nilai saat ini: _${currentValue}_\n${hint}\n` +
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
        const autoSubject = generateSubjectSummary(autoPerihal, session.draftSurat.extractedData);
        session.draftSurat.finalSubject = autoSubject;
        session.draftSurat.extractedData.subject = autoSubject;
      }
    } else if (field === 'tipeSurat') {
      session.draftSurat.tipeSurat = val;
    } else if (session.draftSurat.extractedData) {
      if (field === 'subject') {
        const cleanSubj = val.slice(0, 200);
        session.draftSurat.finalSubject = cleanSubj;
        session.draftSurat.extractedData.subject = cleanSubj;
      } else if (field === 'perihal' || field === 'event') {
        session.draftSurat.finalPerihal = val;
        session.draftSurat.extractedData.perihal = val;
        session.draftSurat.extractedData.event = val;
        const autoSubject = generateSubjectSummary(val, session.draftSurat.extractedData);
        session.draftSurat.finalSubject = autoSubject;
        session.draftSurat.extractedData.subject = autoSubject;
      } else if (field === 'asalSurat') {
        session.draftSurat.extractedData.asalSurat = formatAsalSurat(val);
      } else if (field === 'dateEvent') {
        if (val === '-' || /^(?:tidak\s+ada|belum\s+ada|kosong|-)$/i.test(val)) {
          session.draftSurat.extractedData.dateEvent = undefined;
        } else {
          session.draftSurat.extractedData.dateEvent = val.slice(0, 100);
        }
      } else if (field === 'picName') {
        const cleanPicName = val.slice(0, 100);
        session.draftSurat.extractedData.picName = cleanPicName;
        const curPhone = session.draftSurat.extractedData.picPhoneNumber || '';
        session.draftSurat.extractedData.picPengirim = [cleanPicName, curPhone].filter(Boolean).join(' - ').slice(0, 100);
      } else if (field === 'picPhoneNumber') {
        const cleanPicPhone = val.slice(0, 50);
        session.draftSurat.extractedData.picPhoneNumber = cleanPicPhone;
        const curName = session.draftSurat.extractedData.picName || '';
        session.draftSurat.extractedData.picPengirim = [curName, cleanPicPhone].filter(Boolean).join(' - ').slice(0, 100);
      } else if (field === 'picPengirim') {
        const splitted = splitPicNameAndPhone(val);
        session.draftSurat.extractedData.picName = splitted.name.slice(0, 100);
        session.draftSurat.extractedData.picPhoneNumber = splitted.phone.slice(0, 50);
        session.draftSurat.extractedData.picPengirim = val.slice(0, 100);
      } else {
        (session.draftSurat.extractedData as any)[field] = val;
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

    let picName = ext?.picName || '';
    let picPhone = ext?.picPhoneNumber || '';
    if ((!picName || picName === '-' || !picPhone || picPhone === '-') && ext?.picPengirim && ext.picPengirim !== '-') {
      const splitted = splitPicNameAndPhone(ext.picPengirim);
      if (!picName || picName === '-') picName = splitted.name;
      if (!picPhone || picPhone === '-') picPhone = splitted.phone;
    }
    if (!picName) picName = '-';
    if (!picPhone) picPhone = '-';

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
      (ext?.dateEvent && ext.dateEvent !== '-' ? `• *Waktu / Tgl Acara*: ${ext.dateEvent}\n` : '') +
      `• *Nama PIC*       : ${picName}\n` +
      `• *Nomor PIC*      : ${picPhone}\n` +
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
      const result = await suratService.saveSuratDraft(session.draftSurat!, session.userId, session.userName);

      if (result.success) {
        sessionService.resetSession(session.whatsappNumber);
        const agendaLink = formatNomorAgendaLink(result.nomorAgenda, result.fileName);
        const userPenginput = result.createdBy || session.userName || 'Petugas Protokol';
        const waktuInputStr = formatWaktuInputIndo(result.createdAt || new Date());
        return {
          text:
            `✅ *REGISTRASI SURAT BERHASIL!*\n\n` +
            `Surat telah resmi tercatat di sistem:\n` +
            `• 📌 *Nomor Agenda*   : ${agendaLink}\n` +
            `• 📂 *Status Disposisi*: 🟡 BELUM DISPOSISI\n` +
            `• 👤 *Diinput Oleh*    : ${userPenginput}\n` +
            `• ⏰ *Waktu Input*     : ${waktuInputStr}\n\n` +
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
