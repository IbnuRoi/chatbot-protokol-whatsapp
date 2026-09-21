import { authHandler } from './handlers/authHandler';
import { menuHandler } from './handlers/menuHandler';
import { suratMasukHandler } from './handlers/suratMasukHandler';
import { jadwalHandler } from './handlers/jadwalHandler';
import { disposisiHandler } from './handlers/disposisiHandler';
import { riwayatHandler } from './handlers/riwayatHandler';
import { cariSuratHandler } from './handlers/cariSuratHandler';
import { hybridSearchHandler } from './handlers/hybridSearchHandler';
import { bantuanHandler } from './handlers/bantuanHandler';
import { sessionService, BotState, UserSession } from '../services/sessionService';
import { nluService, NluResult } from '../services/nluService';
import { extractDateRangeFromText } from '../utils/dateHelper';
import { BotResponse } from './types';

export interface IncomingMessagePayload {
  senderNumber: string;
  pushName?: string;
  text?: string;
  media?: {
    filePath: string;
    fileName: string;
    mimeType?: string;
  };
}

/**
 * Memeriksa apakah pertanyaan/pencarian pengguna bersifat umum (tidak secara eksklusif membatasi hanya surat atau hanya jadwal,
 * atau menyebut surat dan jadwal sekaligus).
 */
function isUnspecificSearch(text: string): boolean {
  const lower = text.toLowerCase().trim();
  const hasSurat = /\b(surat|arsip|dokumen|berkas|no surat|nomor surat)\b/i.test(lower);
  const hasJadwal = /\b(jadwal|agenda|kegiatan|acara)\b/i.test(lower);

  // Jika menyebut keduanya (misal: "ada agenda atau surat tentang vokasi") -> terpadu
  if (hasSurat && hasJadwal) return true;
  // Jika tidak menyebut surat maupun jadwal (misal: "vokasi", "info vokasi", "tentang k3", "kunker papua") -> terpadu
  if (!hasSurat && !hasJadwal) return true;

  return false;
}

export class MessageRouter {
  /**
   * Titik masuk utama pemrosesan pesan dari WhatsApp atau Simulator
   */
  public async processMessage(payload: IncomingMessagePayload): Promise<BotResponse> {
    const rawNumber = payload.senderNumber;
    const textInput = (payload.text || '').trim();

    // 1. Autentikasi & Otorisasi Pengguna
    const authResult = await authHandler.authenticate(rawNumber, payload.pushName);
    if (!authResult.isAuthenticated || !authResult.user) {
      return authResult.message!;
    }

    const user = authResult.user;

    // 2. Ambil atau Buat Sesi Pengguna
    let session = sessionService.getSession(user.whatsappNumber);
    if (!session) {
      session = sessionService.createSession(
        user.whatsappNumber,
        user.id,
        user.nama,
        user.role,
        BotState.MAIN_MENU
      );
    }

    // 3. Perintah Cepat Khusus (/cancel, /reset, /start)
    const lower = textInput.toLowerCase();
    if (lower === '/cancel' || lower === '/reset') {
      if (session.draftSurat) {
        await suratMasukHandler.handleFinalConfirm(session, '2');
      }
      sessionService.resetSession(session.whatsappNumber);
      return menuHandler.getConversationalGreeting(
        session,
        `Baik *${session.userName}*, proses sebelumnya telah dibatalkan.`
      );
    }

    if (lower === '/start' || lower === 'menu') {
      if (session.draftSurat) {
        await suratMasukHandler.handleFinalConfirm(session, '2');
      }
      sessionService.resetSession(session.whatsappNumber);
      return menuHandler.getMainGreeting(session);
    }

    if (lower === 'help' || lower === 'bantuan') {
      return bantuanHandler.showBantuanMenu(session);
    }

    // 4. Tangani Pengunggahan Dokumen PDF (Otomatis langsung registrasi surat)
    if (payload.media) {
      return suratMasukHandler.handleDirectPdfUpload(
        session,
        payload.media.filePath,
        payload.media.fileName
      );
    }

    // 5. Analisis NLU (OpenRouter AI) untuk setiap pesan teks percakapan
    const nlu = await nluService.processNaturalLanguage(textInput, session.userName, session.state);

    // 6. Penanganan Intent Global Cepat: BATAL & SELESAI
    if (nlu.intent === 'BATAL') {
      if (session.draftSurat) {
        await suratMasukHandler.handleFinalConfirm(session, '2', nlu);
      }
      sessionService.resetSession(session.whatsappNumber);
      const cancelNote = `Baik *${session.userName}*, proses sebelumnya telah dibatalkan.`;
      const reply = nlu.conversationalReply && nlu.conversationalReply.toLowerCase().includes('batal')
        ? nlu.conversationalReply
        : `${cancelNote} ${nlu.conversationalReply || ''}`.trim();

      return menuHandler.getConversationalGreeting(session, reply);
    }

    if (nlu.intent === 'SELESAI') {
      if (session.draftSurat) {
        await suratMasukHandler.handleFinalConfirm(session, '2', nlu);
      }
      sessionService.deleteSession(session.whatsappNumber);
      return {
        text:
          `${nlu.conversationalReply}\n\n` +
          `Sesi obrolan telah selesai. Jika nanti Anda membutuhkan bantuan lagi seputar administrasi protokol, silakan sapa saya kembali kapan saja ya. Sampai jumpa! 👋`,
      };
    }

    // 7. Context Switching di tengah alur jika pengguna meminta fitur lain
    const isSuratMasukState = session.state.startsWith('SURAT_MASUK_');
    const isJadwalState = session.state.startsWith('JADWAL_');
    const isDisposisiState = session.state.startsWith('DISPOSISI_');
    const isBantuanState = session.state.startsWith('BANTUAN_');
    const isCariSuratState = session.state.startsWith('CARI_SURAT_');
    const isRiwayatState = session.state.startsWith('RIWAYAT_');
    const isHybridState = session.state === BotState.SEARCH_HYBRID_HASIL;

    const isFormInputState =
      session.state === BotState.SURAT_MASUK_EDIT_TEMPLATE ||
      session.state === BotState.SURAT_MASUK_INPUT_NILAI_KOREKSI ||
      session.state === BotState.SURAT_MASUK_INPUT_PERIHAL_MANUAL ||
      session.state === BotState.SURAT_MASUK_INPUT_AGENDA_MANUAL;

    let isDifferentFeature = false;

    if (isFormInputState) {
      isDifferentFeature = nlu.intent === 'BANTUAN';
    } else if (isJadwalState) {
      isDifferentFeature =
        nlu.intent === 'SURAT_MASUK' ||
        nlu.intent === 'CARI_SURAT' ||
        nlu.intent === 'RIWAYAT' ||
        nlu.intent === 'DISPOSISI' ||
        nlu.intent === 'CARI_UMUM' ||
        nlu.intent === 'BANTUAN';
    } else if (isCariSuratState) {
      isDifferentFeature =
        nlu.intent === 'SURAT_MASUK' ||
        nlu.intent.startsWith('JADWAL_') ||
        nlu.intent === 'DISPOSISI' ||
        nlu.intent === 'CARI_UMUM' ||
        nlu.intent === 'BANTUAN';
    } else if (isDisposisiState) {
      isDifferentFeature =
        nlu.intent === 'SURAT_MASUK' ||
        nlu.intent.startsWith('JADWAL_') ||
        nlu.intent === 'CARI_SURAT' ||
        nlu.intent === 'RIWAYAT' ||
        nlu.intent === 'CARI_UMUM' ||
        nlu.intent === 'BANTUAN';
    } else if (isRiwayatState) {
      isDifferentFeature =
        nlu.intent === 'SURAT_MASUK' ||
        nlu.intent.startsWith('JADWAL_') ||
        nlu.intent === 'DISPOSISI' ||
        nlu.intent === 'CARI_SURAT' ||
        nlu.intent === 'CARI_UMUM' ||
        nlu.intent === 'BANTUAN';
    } else if (isSuratMasukState) {
      isDifferentFeature =
        nlu.intent.startsWith('JADWAL_') ||
        nlu.intent === 'DISPOSISI' ||
        nlu.intent === 'CARI_SURAT' ||
        nlu.intent === 'RIWAYAT' ||
        nlu.intent === 'CARI_UMUM' ||
        nlu.intent === 'BANTUAN';
    } else if (isBantuanState) {
      isDifferentFeature =
        nlu.intent === 'SURAT_MASUK' ||
        nlu.intent.startsWith('JADWAL_') ||
        nlu.intent === 'CARI_SURAT' ||
        nlu.intent === 'RIWAYAT' ||
        nlu.intent === 'CARI_UMUM' ||
        nlu.intent === 'DISPOSISI';
    } else if (isHybridState) {
      const isSelectionInput =
        /^(?:surat|jadwal|agenda|kegiatan)\s*(?:ke\s*)?\d+$/i.test(textInput.trim()) ||
        /^\d+$/.test(textInput.trim());

      isDifferentFeature =
        !isSelectionInput &&
        (nlu.intent === 'SURAT_MASUK' ||
          nlu.intent === 'JADWAL_HARI_INI' ||
          nlu.intent === 'JADWAL_BESOK' ||
          nlu.intent === 'JADWAL_RENTANG' ||
          nlu.intent === 'DISPOSISI' ||
          nlu.intent === 'RIWAYAT' ||
          nlu.intent === 'BANTUAN');
    }

    if (session.state !== BotState.MAIN_MENU && isDifferentFeature) {
      if (session.draftSurat) {
        await suratMasukHandler.handleFinalConfirm(session, '2', nlu);
      }
      sessionService.resetSession(session.whatsappNumber);
      return this.handleConversationalInput(session, textInput, nlu);
    }

    // 8. Routing Berdasarkan State Percakapan
    switch (session.state) {
      case BotState.MAIN_MENU:
        return this.handleConversationalInput(session, textInput, nlu);

      // Alur Surat Masuk
      case BotState.SURAT_MASUK_PILIH_JENIS: {
        const res = await suratMasukHandler.handlePilihJenis(session, textInput, nlu);
        const resText = typeof res === 'string' ? res : res.text;
        if (resText.includes('⚠️ Jenis surat belum dikenali')) {
          return this.handleConversationalInterruption(session, textInput, res, nlu);
        }
        return res;
      }

      case BotState.SURAT_MASUK_KONFIRMASI_AGENDA: {
        const res = await suratMasukHandler.handleKonfirmasiAgenda(session, textInput, nlu);
        const resText = typeof res === 'string' ? res : res.text;
        if (resText.includes('Apakah Nomor Agenda tersebut sudah sesuai')) {
          return this.handleConversationalInterruption(session, textInput, res, nlu);
        }
        return res;
      }

      case BotState.SURAT_MASUK_INPUT_AGENDA_MANUAL:
        return suratMasukHandler.handleInputAgendaManual(session, textInput);

      case BotState.SURAT_MASUK_PILIH_TIPE: {
        const res = await suratMasukHandler.handlePilihTipe(session, textInput, nlu);
        const resText = typeof res === 'string' ? res : res.text;
        if (resText.includes('Surat ini termasuk klasifikasi yang mana ya')) {
          return this.handleConversationalInterruption(session, textInput, res, nlu);
        }
        return res;
      }

      case BotState.SURAT_MASUK_UPLOAD_PDF:
        return this.handleConversationalInterruption(
          session,
          textInput,
          `📄 *Menunggu Berkas PDF*\n\n` +
          `Saya masih menunggu kiriman berkas surat format PDF dari Anda. Silakan kirimkan dokumen tersebut ke sini ya.`,
          nlu
        );

      case BotState.SURAT_MASUK_REVIEW_DATA: {
        const res = await suratMasukHandler.handleReviewData(session, textInput, nlu);
        const resText = typeof res === 'string' ? res : res.text;
        if (resText.includes('Apakah data di atas sudah benar')) {
          return this.handleConversationalInterruption(session, textInput, res, nlu);
        }
        return res;
      }

      case BotState.SURAT_MASUK_EDIT_TEMPLATE:
        return suratMasukHandler.handleEditTemplateInput(session, textInput);

      case BotState.SURAT_MASUK_PILIH_FIELD_KOREKSI:
        return suratMasukHandler.handlePilihFieldKoreksi(session, textInput, nlu);

      case BotState.SURAT_MASUK_INPUT_NILAI_KOREKSI:
        return suratMasukHandler.handleInputNilaiKoreksi(session, textInput);

      case BotState.SURAT_MASUK_PILIH_ASAL_INSTANSI: {
        const res = await suratMasukHandler.handlePilihAsalInstansi(session, textInput, nlu);
        const resText = typeof res === 'string' ? res : res.text;
        if (resText.includes('Surat ini berasal dari instansi kategori apa ya')) {
          return this.handleConversationalInterruption(session, textInput, res, nlu);
        }
        return res;
      }

      case BotState.SURAT_MASUK_REVIEW_PERIHAL_AI: {
        const res = await suratMasukHandler.handleReviewPerihalAi(session, textInput, nlu);
        const resText = typeof res === 'string' ? res : res.text;
        if (resText.includes('Apakah perihal rekomendasi AI sudah sesuai')) {
          return this.handleConversationalInterruption(session, textInput, res, nlu);
        }
        return res;
      }

      case BotState.SURAT_MASUK_INPUT_PERIHAL_MANUAL:
        return suratMasukHandler.handleInputPerihalManual(session, textInput);

      case BotState.SURAT_MASUK_FINAL_CONFIRM:
        return suratMasukHandler.handleFinalConfirm(session, textInput, nlu);

      // Alur Jadwal
      case BotState.JADWAL_MENU:
        return jadwalHandler.handleJadwalInput(session, textInput, nlu);

      case BotState.JADWAL_CARI_INPUT:
        return jadwalHandler.handleSearchKeyword(session, textInput);

      case BotState.JADWAL_CARI_HASIL:
        return jadwalHandler.handleSearchResultInput(session, textInput, nlu);

      // Alur Disposisi
      case BotState.DISPOSISI_INPUT_NOMOR:
        return disposisiHandler.handleSearch(session, textInput);

      // Alur Riwayat
      case BotState.RIWAYAT_LIST:
        return riwayatHandler.handleListInput(session, textInput);

      case BotState.RIWAYAT_DETAIL:
        return riwayatHandler.handleDetailInput(session, textInput);

      // Alur Pencarian Surat Berdasarkan Perihal
      case BotState.CARI_SURAT_INPUT_KEYWORD:
        return cariSuratHandler.handleSearchKeyword(session, textInput);

      case BotState.CARI_SURAT_HASIL_LIST:
        return cariSuratHandler.handleListInput(session, textInput, nlu);

      case BotState.CARI_SURAT_DETAIL:
        return cariSuratHandler.handleDetailInput(session, textInput);

      // Alur Pencarian Terpadu (Hybrid Search Surat & Jadwal)
      case BotState.SEARCH_HYBRID_HASIL:
        return hybridSearchHandler.handleHybridListInput(session, textInput, nlu);

      // Alur Bantuan
      case BotState.BANTUAN_MENU:
        return bantuanHandler.handleBantuanInput(session, textInput);

      default:
        sessionService.resetSession(session.whatsappNumber);
        return this.handleConversationalInput(session, textInput, nlu);
    }
  }

  /**
   * Menangani interupsi percakapan / pergantian niat pengguna saat sedang berada di dalam alur bertahap
   */
  private async handleConversationalInterruption(
    session: UserSession,
    textInput: string,
    fallbackResponse: BotResponse,
    precalculatedNlu?: NluResult
  ): Promise<BotResponse> {
    const nlu = precalculatedNlu || (await nluService.processNaturalLanguage(textInput, session.userName, session.state));

    if (nlu.intent === 'BATAL') {
      if (session.draftSurat) {
        await suratMasukHandler.handleFinalConfirm(session, '2', nlu);
      }
      sessionService.resetSession(session.whatsappNumber);
      const cancelNote = `Baik *${session.userName}*, proses sebelumnya telah dibatalkan.`;
      const reply = nlu.conversationalReply && nlu.conversationalReply.toLowerCase().includes('batal')
        ? nlu.conversationalReply
        : `${cancelNote} ${nlu.conversationalReply || ''}`.trim();

      return menuHandler.getConversationalGreeting(session, reply);
    }

    if (nlu.intent === 'SELESAI') {
      if (session.draftSurat) {
        await suratMasukHandler.handleFinalConfirm(session, '2', nlu);
      }
      sessionService.deleteSession(session.whatsappNumber);
      return {
        text:
          `${nlu.conversationalReply}\n\n` +
          `Sesi obrolan telah selesai. Jika nanti Anda membutuhkan bantuan lagi seputar administrasi protokol, silakan sapa saya kembali kapan saja ya. Sampai jumpa! 👋`,
      };
    }

    // Jika pengguna meminta fitur lain di tengah alur (Context Switching cerdas)
    const isSuratMasukState = session.state.startsWith('SURAT_MASUK_');
    const isJadwalState = session.state.startsWith('JADWAL_');
    const isDisposisiState = session.state.startsWith('DISPOSISI_');
    const isBantuanState = session.state.startsWith('BANTUAN_');
    const isCariSuratState = session.state.startsWith('CARI_SURAT_');
    const isRiwayatState = session.state.startsWith('RIWAYAT_');
    const isHybridState = session.state === BotState.SEARCH_HYBRID_HASIL;

    const isFormInputState =
      session.state === BotState.SURAT_MASUK_EDIT_TEMPLATE ||
      session.state === BotState.SURAT_MASUK_INPUT_NILAI_KOREKSI ||
      session.state === BotState.SURAT_MASUK_INPUT_PERIHAL_MANUAL ||
      session.state === BotState.SURAT_MASUK_INPUT_AGENDA_MANUAL;

    let isDifferentFeature = false;
    if (isFormInputState) {
      isDifferentFeature = nlu.intent === 'BANTUAN';
    } else if (isJadwalState) {
      isDifferentFeature =
        nlu.intent === 'SURAT_MASUK' ||
        nlu.intent === 'CARI_SURAT' ||
        nlu.intent === 'RIWAYAT' ||
        nlu.intent === 'DISPOSISI' ||
        nlu.intent === 'CARI_UMUM' ||
        nlu.intent === 'BANTUAN';
    } else if (isCariSuratState) {
      isDifferentFeature =
        nlu.intent === 'SURAT_MASUK' ||
        nlu.intent.startsWith('JADWAL_') ||
        nlu.intent === 'DISPOSISI' ||
        nlu.intent === 'CARI_UMUM' ||
        nlu.intent === 'BANTUAN';
    } else if (isDisposisiState) {
      isDifferentFeature =
        nlu.intent === 'SURAT_MASUK' ||
        nlu.intent.startsWith('JADWAL_') ||
        nlu.intent === 'CARI_SURAT' ||
        nlu.intent === 'RIWAYAT' ||
        nlu.intent === 'CARI_UMUM' ||
        nlu.intent === 'BANTUAN';
    } else if (isRiwayatState) {
      isDifferentFeature =
        nlu.intent === 'SURAT_MASUK' ||
        nlu.intent.startsWith('JADWAL_') ||
        nlu.intent === 'DISPOSISI' ||
        nlu.intent === 'CARI_SURAT' ||
        nlu.intent === 'CARI_UMUM' ||
        nlu.intent === 'BANTUAN';
    } else if (isSuratMasukState) {
      isDifferentFeature =
        nlu.intent.startsWith('JADWAL_') ||
        nlu.intent === 'DISPOSISI' ||
        nlu.intent === 'CARI_SURAT' ||
        nlu.intent === 'RIWAYAT' ||
        nlu.intent === 'CARI_UMUM' ||
        nlu.intent === 'BANTUAN';
    } else if (isBantuanState) {
      isDifferentFeature =
        nlu.intent === 'SURAT_MASUK' ||
        nlu.intent.startsWith('JADWAL_') ||
        nlu.intent === 'CARI_SURAT' ||
        nlu.intent === 'RIWAYAT' ||
        nlu.intent === 'CARI_UMUM' ||
        nlu.intent === 'DISPOSISI';
    } else if (isHybridState) {
      const isSelectionInput =
        /^(?:surat|jadwal|agenda|kegiatan)\s*(?:ke\s*)?\d+$/i.test(textInput.trim()) ||
        /^\d+$/.test(textInput.trim());

      isDifferentFeature =
        !isSelectionInput &&
        (nlu.intent === 'SURAT_MASUK' ||
          nlu.intent === 'JADWAL_HARI_INI' ||
          nlu.intent === 'JADWAL_BESOK' ||
          nlu.intent === 'JADWAL_RENTANG' ||
          nlu.intent === 'DISPOSISI' ||
          nlu.intent === 'RIWAYAT' ||
          nlu.intent === 'BANTUAN');
    }

    if (isDifferentFeature) {
      if (session.draftSurat) {
        await suratMasukHandler.handleFinalConfirm(session, '2', nlu);
      }
      sessionService.resetSession(session.whatsappNumber);
      return this.handleConversationalInput(session, textInput, nlu);
    }

    if (nlu.intent === 'CHITCHAT' || nlu.intent === 'GREETING') {
      const fallbackStr = typeof fallbackResponse === 'string' ? fallbackResponse : fallbackResponse.text;
      return {
        text: `${nlu.conversationalReply}\n\n${fallbackStr}`,
      };
    }

    return fallbackResponse;
  }

  /**
   * Menangani input teks percakapan natural (NLU) saat pengguna menyapa atau mengungkapkan maksud secara santai
   */
  private async handleConversationalInput(
    session: UserSession,
    textInput: string,
    precalculatedNlu?: NluResult
  ): Promise<BotResponse> {
    // 1. Dukungan instan shortcut numerik 1-6 untuk pengujian otomatis atau input angka cepat
    if (textInput === '1') {
      return suratMasukHandler.startFlow(session);
    } else if (textInput === '2') {
      return jadwalHandler.showJadwalMenu(session);
    } else if (textInput === '3') {
      return disposisiHandler.promptNomor(session);
    } else if (textInput === '4') {
      return riwayatHandler.showRiwayatList(session, 0);
    } else if (textInput === '5') {
      return cariSuratHandler.promptKeyword(session);
    } else if (textInput === '6') {
      return bantuanHandler.showBantuanMenu(session);
    }

    const nlu = precalculatedNlu || (await nluService.processNaturalLanguage(textInput, session.userName, session.state));

    const prependIntro = (response: BotResponse, intro: string): BotResponse => {
      const cleanIntro = (intro || '').replace(/\[[\s\S]*?\]/g, '').replace(/\s{2,}/g, ' ').trim();
      if (!cleanIntro) {
        return response;
      }
      if (typeof response === 'string') {
        return `${cleanIntro}\n\n${response}`;
      }
      return {
        ...response,
        text: `${cleanIntro}\n\n${response.text}`,
      };
    };

    switch (nlu.intent) {
      case 'GREETING':
        return menuHandler.getConversationalGreeting(session, nlu.conversationalReply);

      case 'SURAT_MASUK': {
        const res = await suratMasukHandler.startFlow(session);
        return prependIntro(res, nlu.conversationalReply);
      }

      case 'JADWAL_HARI_INI': {
        const res = await jadwalHandler.showJadwalMenu(session);
        return prependIntro(res, nlu.conversationalReply);
      }

      case 'JADWAL_BESOK': {
        const res = await jadwalHandler.showJadwalBesok(session);
        return prependIntro(res, nlu.conversationalReply);
      }

      case 'JADWAL_BERIKUTNYA': {
        const res = await jadwalHandler.handleJadwalInput(session, '1');
        return prependIntro(res, nlu.conversationalReply);
      }

      case 'JADWAL_MENDATANG': {
        const res = await jadwalHandler.handleJadwalInput(session, '2');
        return prependIntro(res, nlu.conversationalReply);
      }

      case 'JADWAL_RENTANG': {
        const parsedRange = extractDateRangeFromText(textInput);
        const days = nlu.entities?.rentangHari || parsedRange?.daysCount || 7;
        const label = nlu.entities?.rentangLabel || parsedRange?.label || `${days} Hari ke Depan`;
        const res = await jadwalHandler.showJadwalRentang(session, days, label);
        return prependIntro(res, nlu.conversationalReply);
      }

      case 'JADWAL_CARI': {
        if (nlu.entities?.tanggal) {
          const res = await jadwalHandler.showJadwalTanggal(session, nlu.entities.tanggal);
          return prependIntro(res, nlu.conversationalReply);
        }
        const keyword = nlu.entities?.keyword || nluService.extractSearchKeyword(textInput);
        if (keyword && keyword.length >= 2) {
          // Jika pertanyaan tidak spesifik hanya jadwal (misal menanyakan topik umum atau menyebut surat dan agenda sekaligus):
          if (isUnspecificSearch(textInput)) {
            const res = await hybridSearchHandler.handleSearch(session, keyword);
            return prependIntro(res, nlu.conversationalReply);
          }
          const res = await jadwalHandler.handleSearchKeyword(session, keyword);
          return prependIntro(res, nlu.conversationalReply);
        }
        const res = await jadwalHandler.promptSearch(session);
        return prependIntro(res, nlu.conversationalReply);
      }

      case 'DISPOSISI': {
        if (nlu.entities?.nomorSurat) {
          const res = await disposisiHandler.handleSearch(session, nlu.entities.nomorSurat);
          return prependIntro(res, nlu.conversationalReply);
        }
        const res = await disposisiHandler.promptNomor(session);
        return prependIntro(res, nlu.conversationalReply);
      }

      case 'RIWAYAT': {
        const res = await riwayatHandler.showRiwayatList(session, 0);
        return prependIntro(res, nlu.conversationalReply);
      }

      case 'CARI_SURAT': {
        const keyword = nlu.entities?.keyword || nluService.extractSearchKeyword(textInput);
        const lowerKw = (keyword || '').toLowerCase().trim();
        if (
          lowerKw === 'terbaru' ||
          lowerKw === 'terakhir' ||
          lowerKw === 'baru' ||
          lowerKw === 'surat terbaru' ||
          lowerKw === 'surat terakhir' ||
          lowerKw === 'surat masuk terbaru'
        ) {
          const res = await riwayatHandler.showRiwayatList(session, 0);
          return prependIntro(res, nlu.conversationalReply);
        }

        // Jika pertanyaan tidak spesifik hanya surat (misal menanyakan topik umum atau menyebut surat dan agenda sekaligus):
        if (keyword && keyword.length >= 2 && isUnspecificSearch(textInput)) {
          const res = await hybridSearchHandler.handleSearch(session, keyword);
          return prependIntro(res, nlu.conversationalReply);
        }

        if (keyword && keyword.length >= 2) {
          const res = await cariSuratHandler.handleSearchKeyword(session, keyword);
          return prependIntro(res, nlu.conversationalReply);
        }
        const res = await cariSuratHandler.promptKeyword(session);
        return prependIntro(res, nlu.conversationalReply);
      }

      case 'CARI_UMUM': {
        const keyword = nlu.entities?.keyword || nluService.extractSearchKeyword(textInput);
        if (keyword && keyword.length >= 2) {
          const res = await hybridSearchHandler.handleSearch(session, keyword);
          return prependIntro(res, nlu.conversationalReply);
        }
        return {
          text: `Silakan sebutkan topik atau kata kunci yang ingin Anda cari ya. 😊`,
        };
      }

      case 'BANTUAN':
        return bantuanHandler.showBantuanMenu(session);

      case 'BATAL': {
        sessionService.resetSession(session.whatsappNumber);
        const cancelNote = `Baik *${session.userName}*, proses sebelumnya telah dibatalkan.`;
        const reply = nlu.conversationalReply && nlu.conversationalReply.toLowerCase().includes('batal')
          ? nlu.conversationalReply
          : `${cancelNote} ${nlu.conversationalReply || ''}`.trim();

        return menuHandler.getConversationalGreeting(session, reply);
      }

      case 'SELESAI':
        sessionService.deleteSession(session.whatsappNumber);
        return {
          text:
            `${nlu.conversationalReply}\n\n` +
            `Sesi obrolan telah selesai. Jika nanti Anda membutuhkan bantuan lagi seputar administrasi protokol, silakan sapa saya kembali kapan saja ya. Sampai jumpa! 👋`,
        };

      case 'CHITCHAT':
      case 'UNKNOWN':
      default: {
        const lower = textInput.toLowerCase().trim();
        const isGreetingWord = /^(halo|hai|hi|hey|assalamu|pagi|siang|sore|malam|permisi|ping|p)\b/i.test(lower);
        const isThanksWord = /\b(makasih|terima kasih|thanks|syukron)\b/i.test(lower);
        const isIdentityQuery = /\b(kamu siapa|siapa kamu|namamu|kamu ini)\b/i.test(lower);

        if (!isGreetingWord && !isThanksWord && !isIdentityQuery && textInput.trim().length >= 2 && textInput.trim().length <= 60) {
          const keyword = nlu.entities?.keyword || nluService.extractSearchKeyword(textInput);
          if (keyword && keyword.length >= 2) {
            const res = await hybridSearchHandler.handleSearch(session, keyword);
            return prependIntro(res, nlu.conversationalReply);
          }
        }

        return menuHandler.getConversationalGreeting(session, nlu.conversationalReply);
      }
    }
  }
}

export const messageRouter = new MessageRouter();
