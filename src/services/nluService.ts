import OpenAI from 'openai';
import { ENV } from '../config/env';
import { extractDateFromText, extractDateRangeFromText } from '../utils/dateHelper';

export type NluIntent =
  | 'GREETING'
  | 'SURAT_MASUK'
  | 'JADWAL_HARI_INI'
  | 'JADWAL_BESOK'
  | 'JADWAL_BERIKUTNYA'
  | 'JADWAL_MENDATANG'
  | 'JADWAL_RENTANG'
  | 'JADWAL_CARI'
  | 'DISPOSISI'
  | 'RIWAYAT'
  | 'CARI_SURAT'
  | 'CARI_UMUM'
  | 'BANTUAN'
  | 'BATAL'
  | 'SELESAI'
  | 'CHITCHAT'
  | 'SUBMIT_STEP'
  | 'UNKNOWN';

export interface NluEntities {
  keyword?: string;
  tanggal?: string; // Format ISO: YYYY-MM-DD
  rentangHari?: number; // Jumlah hari ke depan (misal: 2, 3, 5, 7, 14)
  rentangLabel?: string; // Label rentang hari (misal: "2 Hari ke Depan", "Seminggu ke Depan")
  nomorSurat?: string;
  jenisSurat?: 'UND' | 'UNR' | 'PH' | 'AU' | 'WR' | 'LP' | 'TAP';
  agendaAction?: 'CONFIRM' | 'MANUAL';
  customAgenda?: string;
  tipeSurat?: 'Biasa' | 'Rahasia' | 'Penting' | 'Tembusan';
  reviewAction?: 'CONFIRM' | 'KOREKSI';
  fieldToEdit?: 'tanggalSurat' | 'nomorSurat' | 'subject' | 'asalSurat' | 'event' | 'picPengirim' | 'perihal' | 'LANJUT';
  instansiKategori?: 'Pemerintah' | 'Serikat Kerja' | 'Perusahaan' | 'Lainnya';
  perihalAction?: 'CONFIRM' | 'MANUAL';
  finalAction?: 'SAVE' | 'CANCEL';
}

export interface NluResult {
  intent: NluIntent;
  confidence: number;
  conversationalReply: string;
  entities: NluEntities;
}

export class NluService {
  private client: OpenAI | null = null;

  private getClient(): OpenAI | null {
    const apiKey = (ENV.CHAT_API_KEY || ENV.OPENROUTER_API_KEY || '').trim();
    if (!apiKey) {
      return null;
    }
    if (!this.client) {
      this.client = new OpenAI({
        baseURL: 'https://openrouter.ai/api/v1',
        apiKey,
        timeout: 15000,
        defaultHeaders: {
          'HTTP-Referer': 'https://kemnaker.go.id',
          'X-Title': 'Kemnaker Protokol WhatsApp Bot',
        },
      });
    }
    return this.client;
  }

  /**
   * Menganalisis pesan teks pengguna menggunakan OpenRouter NLU (dengan fallback heuristik)
   */
  public async processNaturalLanguage(
    message: string,
    userName: string = 'Bapak/Ibu',
    currentState: string = 'MAIN_MENU'
  ): Promise<NluResult> {
    const cleanText = message.trim();

    // 0. Shortcut cepat angka menu 1-6 di MAIN_MENU (agar tidak salah diklasifikasi LLM)
    if (currentState === 'MAIN_MENU') {
      if (cleanText === '1') {
        return {
          intent: 'SURAT_MASUK',
          confidence: 1.0,
          conversationalReply: `Baik ${userName}, mari kita daftarkan surat masuk baru.`,
          entities: {},
        };
      }
      if (cleanText === '2') {
        return {
          intent: 'JADWAL_HARI_INI',
          confidence: 1.0,
          conversationalReply: `Baik ${userName}, ini menu jadwal kegiatan protokol.`,
          entities: {},
        };
      }
      if (cleanText === '3') {
        return {
          intent: 'DISPOSISI',
          confidence: 1.0,
          conversationalReply: `Baik ${userName}, silakan masukkan nomor agenda atau nomor surat yang ingin dicek status disposisinya.`,
          entities: {},
        };
      }
      if (cleanText === '4') {
        return {
          intent: 'RIWAYAT',
          confidence: 1.0,
          conversationalReply: `Baik ${userName}, ini daftar riwayat surat masuk.`,
          entities: {},
        };
      }
      if (cleanText === '5') {
        return {
          intent: 'CARI_SURAT',
          confidence: 1.0,
          conversationalReply: `Baik ${userName}, silakan masukkan kata kunci pencarian surat.`,
          entities: {},
        };
      }
      if (cleanText === '6') {
        return {
          intent: 'BANTUAN',
          confidence: 1.0,
          conversationalReply: `Baik ${userName}, berikut panduan penggunaan sistem.`,
          entities: {},
        };
      }
    }

    const client = this.getClient();

    if (!client) {
      return this.heuristicFallback(cleanText, userName, currentState);
    }

    try {
      const activeChatModel = ENV.CHAT_MODEL || 'openrouter/free';
      console.log(`🧠 [Chat NLU - Free Model] Menganalisis niat: "${cleanText}" (State: ${currentState}) dengan model ${activeChatModel}...`);

      const systemPrompt =
        `Kamu adalah AI Assistant Cerdas Protokol untuk Chatbot WhatsApp Administrasi Protokol Kementerian Ketenagakerjaan (Kemnaker) RI.\n` +
        `Nama pengguna yang sedang kamu layani: "${userName}".\n` +
        `Konteks Sesi/Alur Pengguna Saat Ini: "${currentState}".\n\n` +
        `Tugas utamamu adalah menganalisis pesan percakapan bahasa Indonesia dari pengguna secara mendalam di SETIAP langkah percakapan, memahami NIAT (intention) dan entitas penting meskipun pengguna menggunakan bahasa santai, gaul, atau singkatan (seperti "gajadi deh", "undangan rapat ya min", "sudah sesuai kok", "surat penting", "lanjut"), lalu menyusun balasan percakapan (conversationalReply) yang hangat, ramah, dan solutif.\n\n` +
        `PANDUAN GAYA BALASAN (conversationalReply):\n` +
        `- Berbicaralah secara alami dan manusiawi seperti asisten AI percakapan modern.\n` +
        `- JANGAN PERNAH menyertakan instruksi menu kaku/robotik di balasanmu, seperti "Ketik angka 1 - 6...", "Ketik *menu*...", dsb.\n` +
        `- JANGAN PERNAH menyertakan placeholder dalam tanda kurung siku seperti "[insert ...]", "[sebutkan ...]", "[detail ...]", "[rincian]". Berikan kalimat pengantar alami yang hangat dan ramah tanpa placeholder.\n` +
        `- JANGAN gunakan garis pemisah panjang (seperti "━━━━━━━━━━").\n` +
        `- Mengalirlah seperti percakapan dengan rekan kerja yang profesional dan ramah.\n\n` +
        `=== PANDUAN 6 FITUR UTAMA SISTEM (KLASIFIKASI SEIMBANG & TEPAT SASARAN) ===\n` +
        `1. REGISTRASI SURAT MASUK (Intent: "SURAT_MASUK"):\n` +
        `   - Pengguna ingin mendaftarkan, membuat, menginput, atau mengunggah surat masuk baru.\n` +
        `   - Contoh: "input surat baru", "registrasi surat masuk", "mau daftar surat", "bikin surat", "upload dokumen surat", "tambah surat masuk".\n\n` +
        `2. PENCARIAN ARSIP SURAT (Intent: "CARI_SURAT"):\n` +
        `   - Pengguna ingin mencari dokumen / arsip surat masuk berdasarkan perihal, topik, instansi, pengirim, atau kata kunci tertentu.\n` +
        `   - Contoh: "carikan surat tentang vokasi", "cari surat rakor", "dokumen k3", "surat dari kemenkeu", "cek surat audiensi", "surat permohonan".\n` +
        `   - WAJIB ekstrak entities.keyword (kata kunci/topik perihal surat).\n` +
        `   - CATATAN: Jika pengguna meminta "carikan surat terbaru", "surat terbaru", "surat terakhir", atau "surat yang baru masuk", klasifikasikan sebagai "RIWAYAT" atau "CARI_SURAT" dengan keyword="terbaru".\n\n` +
        `3. RIWAYAT ARSIP SURAT MASUK (Intent: "RIWAYAT"):\n` +
        `   - Pengguna ingin melihat daftar / log riwayat surat masuk terkini atau terbaru.\n` +
        `   - Contoh: "carikan surat terbaru", "surat terbaru", "surat masuk terbaru", "lihat surat masuk", "daftar surat", "riwayat surat masuk", "surat terakhir", "arsip surat terkini".\n\n` +
        `4. PELACAKAN STATUS DISPOSISI (Intent: "DISPOSISI"):\n` +
        `   - Pengguna ingin melacak atau mengecek status disposisi surat / nomor agenda.\n` +
        `   - Contoh: "lacak disposisi", "cek status disposisi", "status surat 320/M/PH/IX/2026", "surat nomor 123 sudah disposisi belum?", "disposisi surat rakor".\n` +
        `   - WAJIB ekstrak entities.nomorSurat (nomor agenda atau nomor surat jika disebutkan).\n\n` +
        `5. JADWAL & KEGIATAN PROTOKOL (Intent: "JADWAL_*"):\n` +
        `   - HANYA gunakan jika pengguna menanyakan kegiatan, agenda pimpinan, rapat, atau acara protokol:\n` +
        `   * JADWAL_HARI_INI: Agenda HARI INI saja ("jadwal hari ini", "agenda hari ini", "ada acara apa hari ini").\n` +
        `   * JADWAL_BESOK: Agenda BESOK saja ("jadwal besok", "agenda besok", "kegiatan besok").\n` +
        `   * JADWAL_BERIKUTNYA: SATU agenda terdekat berikutnya ("jadwal terdekat", "agenda berikutnya", "setelah ini ada apa").\n` +
        `   * JADWAL_RENTANG: Agenda rentang waktu spesifik ("jadwal 2 hari kedepan", "3 hari ke depan", "5 hari kedepan", "seminggu kedepan", "dua minggu kedepan", "10 hari ke depan"). Ekstrak entities.rentangHari (integer) & entities.rentangLabel.\n` +
        `   * JADWAL_MENDATANG: Agenda masa depan umum tanpa angka ("jadwal mendatang", "agenda ke depan", "kegiatan akan datang").\n` +
        `   * JADWAL_CARI: Mencari agenda kegiatan spesifik berdasarkan tanggal tertentu atau nama kegiatan ("jadwal tanggal 18 september", "jadwal rakor", "agenda bksti"). Ekstrak entities.tanggal (YYYY-MM-DD) atau entities.keyword.\n\n` +
        `6. PENCARIAN UMUM TERPADU / HYBRID (Intent: "CARI_UMUM"):\n` +
        `   - WAJIB digunakan jika pengguna menanyakan atau mencari topik, kata kunci, isu, nama instansi/organisasi yang TIDAK SECARA KHUSUS membatasi hanya pada 'surat' saja atau hanya pada 'jadwal' saja, ATAU jika pengguna menanyakan surat dan jadwal sekaligus.\n` +
        `   - Contoh: "ada info tentang vokasi?", "info vokasi", "vokasi", "tentang k3", "kunker papua", "ada kegiatan atau surat apa soal amazon?", "ada apa tentang apindo?", "apakah ada jadwal atau surat perihal pelatihan?", "informasi bnn".\n` +
        `   - Ekstrak entities.keyword = kata kunci topik pencarian.\n` +
        `   - Bot akan memeriksa arsip surat dan jadwal kegiatan sekaligus, lalu menyajikannya secara bersamaan dalam SATU bubble chat bila keduanya memiliki hasil yang sesuai!\n\n` +
        `7. BANTUAN & PANDUAN (Intent: "BANTUAN"):\n` +
        `   - Pengguna meminta panduan atau menu bantuan ("bantuan", "help", "panduan", "cara pakai").\n\n` +
        `=== ATURAN MUTLAK PERALIHAN KONTEKS (CONTEXT SWITCHING) ===\n` +
        `- Pengguna DAPAT beralih atau meminta fitur lain KAPAN SAJA di tengah alur percakapan!\n` +
        `- JANGAN PERNAH membatasi niat pengguna hanya pada fitur alur sebelumnya ("${currentState}")!\n` +
        `- Jika pengguna sedang berada di alur Jadwal ("JADWAL_MENU" atau "JADWAL_CARI_INPUT") tetapi mengetik "carikan surat terbaru" atau "cari surat rakor" atau "cek disposisi": WAJIB pilih intent "CARI_SURAT" atau "RIWAYAT" atau "DISPOSISI", JANGAN pilih JADWAL!\n` +
        `- Begitu juga sebaliknya: Jika sedang berada di alur Surat tapi pengguna meminta "jadwal besok" atau "jadwal 2 hari kedepan", WAJIB pilih intent JADWAL terkait!\n` +
        `- HANYA gunakan intent "SUBMIT_STEP" jika pengguna sedang berada di dalam alur formulir registrasi bertahap ("SURAT_MASUK_*") dan MERESPONS langkah formulir tersebut (misal memilih jenis surat, konfirmasi agenda, konfirmasi simpan, koreksi field).\n` +
        `- Jika pengguna ingin BATAL ("gajadi deh", "batalin", "cancel"): intent = "BATAL".\n` +
        `- Jika pengguna ingin SELESAI ("selesai makasih", "cukup", "bye"): intent = "SELESAI".\n` +
        `- Jika pengguna menyapa ("halo", "hai", "pagi", "menu"): intent = "GREETING".\n` +
        `- Jika menanyakan identitas bot ("kamu siapa?", "siapa namamu?"): intent = "CHITCHAT".\n\n` +
        `WAJIB menjawab HANYA dalam format JSON valid berikut tanpa teks pendahuluan atau penutup apapun:\n` +
        `{\n` +
        `  "intent": "GREETING | SURAT_MASUK | JADWAL_HARI_INI | JADWAL_BESOK | JADWAL_BERIKUTNYA | JADWAL_MENDATANG | JADWAL_RENTANG | JADWAL_CARI | DISPOSISI | RIWAYAT | CARI_SURAT | CARI_UMUM | BANTUAN | BATAL | SELESAI | CHITCHAT | SUBMIT_STEP",\n` +
        `  "conversationalReply": "Balasan ramah & sopan bahasa Indonesia (sapa dengan ${userName})",\n` +
        `  "entities": {\n` +
        `    "keyword": "kata kunci pencarian jika ada",\n` +
        `    "tanggal": "YYYY-MM-DD jika pengguna menanyakan jadwal tanggal tertentu",\n` +
        `    "rentangHari": 2,\n` +
        `    "rentangLabel": "2 Hari ke Depan",\n` +
        `    "nomorSurat": "nomor surat jika ada",\n` +
        `    "jenisSurat": "UND | UNR | PH | AU | WR | LP | TAP",\n` +
        `    "agendaAction": "CONFIRM | MANUAL",\n` +
        `    "customAgenda": "nomor agenda manual jika ada",\n` +
        `    "tipeSurat": "Biasa | Rahasia | Penting | Tembusan",\n` +
        `    "reviewAction": "CONFIRM | KOREKSI",\n` +
        `    "fieldToEdit": "tanggalSurat | nomorSurat | subject | asalSurat | event | picPengirim | perihal | LANJUT",\n` +
        `    "instansiKategori": "Pemerintah | Serikat Kerja | Perusahaan | Lainnya",\n` +
        `    "perihalAction": "CONFIRM | MANUAL",\n` +
        `    "finalAction": "SAVE | CANCEL"\n` +
        `  }\n` +
        `}`;

      let rawContent: string | null | undefined;
      try {
        const response = await client.chat.completions.create({
          model: ENV.CHAT_MODEL || 'openrouter/free',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: cleanText },
          ],
          temperature: 0.1,
          max_tokens: 1500,
        });

        rawContent = response.choices?.[0]?.message?.content;
      } catch (err: any) {
        console.warn(`[NLU Service] OpenRouter fetch failed, switching to heuristic: ${err?.message || err}`);
        return this.heuristicFallback(cleanText, userName, currentState);
      }

      if (
        !rawContent ||
        rawContent.toLowerCase().includes('user safety: safe') ||
        rawContent.toLowerCase().includes('safety: safe') ||
        rawContent.trim().length === 0
      ) {
        console.warn(`[NLU Service] OpenRouter returned safety rating or empty text, switching to heuristic`);
        return this.heuristicFallback(cleanText, userName, currentState);
      }

      // Bersihkan reasoning tag (<think>...</think>) jika model penalaran dipilih oleh free router
      let cleanContent = rawContent.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
      if (!cleanContent) {
        cleanContent = rawContent.trim();
      }

      const cleanJson = cleanContent.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
      let jsonMatch = cleanJson.match(/\{[\s\S]*\}/);

      let jsonStringToParse = jsonMatch ? jsonMatch[0] : '';
      if (!jsonStringToParse && cleanJson.includes('{')) {
        const startIndex = cleanJson.indexOf('{');
        jsonStringToParse = cleanJson.slice(startIndex) + '\n}';
      }

      if (!jsonStringToParse) {
        console.warn(`[NLU Service] Output does not contain JSON block, falling back to heuristic: "${rawContent.slice(0, 80)}"`);
        return this.heuristicFallback(cleanText, userName, currentState);
      }

      let parsed: any;
      try {
        parsed = JSON.parse(jsonStringToParse);
      } catch (parseErr) {
        console.warn(`[NLU Service] JSON parse failed, falling back to heuristic:`, parseErr);
        return this.heuristicFallback(cleanText, userName, currentState);
      }

      let intent = (parsed.intent || 'UNKNOWN') as NluIntent;
      const entities: NluEntities = {
        keyword: parsed.entities?.keyword || undefined,
        tanggal: parsed.entities?.tanggal || undefined,
        rentangHari: parsed.entities?.rentangHari || undefined,
        rentangLabel: parsed.entities?.rentangLabel || undefined,
        nomorSurat: parsed.entities?.nomorSurat || undefined,
        jenisSurat: parsed.entities?.jenisSurat || undefined,
        agendaAction: parsed.entities?.agendaAction || undefined,
        customAgenda: parsed.entities?.customAgenda || undefined,
        tipeSurat: parsed.entities?.tipeSurat || undefined,
        reviewAction: parsed.entities?.reviewAction || undefined,
        fieldToEdit: parsed.entities?.fieldToEdit || undefined,
        instansiKategori: parsed.entities?.instansiKategori || undefined,
        perihalAction: parsed.entities?.perihalAction || undefined,
        finalAction: parsed.entities?.finalAction || undefined,
      };

      // Deteksi rentang hari percakapan secara deterministik (contoh: "2 hari kedepan", "3 hari ke depan", "5 hari kedepan", "seminggu kedepan", "dua minggu kedepan")
      const extractedRange = extractDateRangeFromText(cleanText);
      if (extractedRange) {
        intent = 'JADWAL_RENTANG';
        entities.rentangHari = extractedRange.daysCount;
        entities.rentangLabel = extractedRange.label;
      }

      // Deteksi & normalisasi tanggal bahasa Indonesia secara deterministik jika ada
      const extractedDate = extractDateFromText(cleanText);
      const isRelativeDay = cleanText.toLowerCase().includes('hari ini') || cleanText.toLowerCase().includes('besok') || cleanText.toLowerCase().includes('esok') || cleanText.toLowerCase().includes('lusa');
      if (extractedDate && !isRelativeDay && !extractedRange) {
        // Jika pengguna menyebut tanggal konkret (misal 18 september, 23/09/2026)
        if (intent === 'JADWAL_CARI' || intent === 'JADWAL_HARI_INI' || intent === 'JADWAL_BESOK' || intent === 'UNKNOWN' || intent === 'CHITCHAT') {
          intent = 'JADWAL_CARI';
          entities.tanggal = extractedDate.dateStr;
        }
      }

      // Jika pengguna sedang berada di dalam sub-state (misal form registrasi) dan memilih/mengisi langkah tersebut
      if (currentState.startsWith('SURAT_MASUK_') && intent === 'SURAT_MASUK') {
        intent = 'SUBMIT_STEP';
      }

      // Sanitasi keyword pencarian jika masih mengandung kata sambung/filler
      if (intent === 'CARI_SURAT' || intent === 'CARI_UMUM' || intent === 'JADWAL_CARI') {
        if (!entities.keyword || entities.keyword.toLowerCase().includes('tentang') || entities.keyword.toLowerCase().startsWith('kan ') || entities.keyword.toLowerCase().includes('surat') || entities.keyword.toLowerCase().includes('jadwal')) {
          const refined = this.extractSearchKeyword(cleanText);
          if (refined && refined.length >= 2) {
            entities.keyword = refined;
          }
        } else {
          entities.keyword = this.extractSearchKeyword(entities.keyword);
        }
      }

      const lowerText = cleanText.toLowerCase();

      // Pastikan entitas kritis diekstrak dengan bantuan heuristik jika LLM melewatkannya
      if (currentState === 'SURAT_MASUK_PILIH_JENIS' && !entities.jenisSurat) {
        if (lowerText.includes('rapat') || lowerText.includes('unr')) entities.jenisSurat = 'UNR';
        else if (lowerText.includes('undangan') || lowerText.includes('und')) entities.jenisSurat = 'UND';
        else if (lowerText.includes('permohonan') || lowerText.includes('ph')) entities.jenisSurat = 'PH';
        else if (lowerText.includes('audiensi') || lowerText.includes('au')) entities.jenisSurat = 'AU';
        else if (lowerText.includes('wawancara') || lowerText.includes('wr')) entities.jenisSurat = 'WR';
        else if (lowerText.includes('laporan') || lowerText.includes('lp')) entities.jenisSurat = 'LP';
        else if (lowerText.includes('upacara') || lowerText.includes('tap')) entities.jenisSurat = 'TAP';
      } else if (currentState === 'SURAT_MASUK_KONFIRMASI_AGENDA' && !entities.agendaAction) {
        if (lowerText.includes('sesuai') || lowerText.includes('benar') || lowerText.includes('oke') || lowerText.includes('lanjut') || lowerText.includes('ya')) {
          entities.agendaAction = 'CONFIRM';
        } else if (lowerText.includes('manual') || lowerText.includes('ubah') || lowerText.includes('ganti') || lowerText.includes('tidak')) {
          entities.agendaAction = 'MANUAL';
        }
      } else if (currentState === 'SURAT_MASUK_PILIH_TIPE' && !entities.tipeSurat) {
        if (lowerText.includes('rahasia')) entities.tipeSurat = 'Rahasia';
        else if (lowerText.includes('penting')) entities.tipeSurat = 'Penting';
        else if (lowerText.includes('tembusan')) entities.tipeSurat = 'Tembusan';
        else if (lowerText.includes('biasa')) entities.tipeSurat = 'Biasa';
      }

      console.log(`🎯 [OpenRouter NLU] Berhasil: intent="${intent}", reply="${parsed.conversationalReply}"`);

      return {
        intent,
        confidence: 0.95,
        conversationalReply:
          parsed.conversationalReply || `Halo ${userName}, ada yang bisa saya bantu hari ini?`,
        entities,
      };
    } catch (error) {
      console.warn('[NLU Service] OpenRouter API error or timeout, falling back to heuristic:', error);
      return this.heuristicFallback(cleanText, userName, currentState);
    }
  }

  /**
   * Mengekstrak kata kunci pencarian dari kalimat percakapan alami bahasa Indonesia
   */
  public extractSearchKeyword(text: string): string {
    let clean = text.toLowerCase().trim();

    // 1. Bersihkan tanda baca di awal/akhir
    clean = clean.replace(/^[^\w]+|[^\w]+$/g, '');

    // 2. Bersihkan partikel akhir kalimat
    clean = clean.replace(/\s+(dong|deh|ya|min|sih|ngga|nggak|gak|ga|kah|nih|gan|bro|pak|bu|\?|\.)+$/i, '');
    clean = clean.replace(/[?!.]+$/g, '').trim();

    // 3. Bersihkan kata pengantar, awalan kata kerja, filler, kata hubung secara berulang
    const prefixRegex =
      /^(tolong|mohon|bisa|bisakah|coba|min|halo|hai|ada|apakah ada|apakah|punya|punya ngga|berikan|beri|kasih|kasih tau|beritahu|beri tahu|minta|tampilkan|tampilkanlah|jelaskan|terangkan|detail|rincian|keterangan|penjelasan|informasi|info|carikan|cari|searching|search|cek|lacak|lihat|liat|temukan|kan|in|dokumen|arsip|berkas|data|surat masuk|surat dinas|surat|jadwal|agenda|kegiatan|acara|tentang|perihal|mengenai|terkait|soal|dari|dengan topik|topik|hal)\s+/i;

    let previous = '';
    while (clean !== previous && prefixRegex.test(clean)) {
      previous = clean;
      const candidate = clean.replace(prefixRegex, '').trim();
      if (candidate.length >= 2) {
        clean = candidate;
      } else {
        break;
      }
    }

    // Bersihkan lagi jika masih tersisa kata hubung di awal seperti "tentang", "mengenai", dsb.
    clean = clean.replace(/^(tentang|mengenai|terkait|soal|hal|perihal)\s+/i, '').trim();

    return clean;
  }

  /**
   * Fallback cerdas berbasis aturan bahasa Indonesia ketika OpenRouter API offline atau key belum diisi
   */
  public heuristicFallback(text: string, userName: string, currentState: string = 'MAIN_MENU'): NluResult {
    const lower = text.toLowerCase().trim();

    // 1. Pembatalan
    const cancelPattern = /\b(batal|batalkan|batalin|cancel|gajadi|ga jadi|gak jadi|nggak jadi|ngga jadi|ndak jadi|gk jadi|tdk jadi|tidak jadi|ga usah|gak usah|ngga usah|nggak usah|skip|anulir|urung)\b/i;
    if (
      cancelPattern.test(lower) ||
      lower.startsWith('batal') ||
      lower.startsWith('gajadi') ||
      lower.startsWith('ga jadi')
    ) {
      return {
        intent: 'BATAL',
        confidence: 0.9,
        conversationalReply: `Baik ${userName}, proses sebelumnya telah dibatalkan.`,
        entities: {},
      };
    }

    // 2. Selesai
    const selesaiPattern = /\b(selesai|keluar|exit|stop|bye|cukup|sudah cukup)\b/i;
    if (
      selesaiPattern.test(lower) ||
      lower.includes('selesai') ||
      lower.startsWith('keluar') ||
      lower.includes('makasih cukup') ||
      lower.includes('terima kasih cukup') ||
      lower.includes('bye')
    ) {
      return {
        intent: 'SELESAI',
        confidence: 0.95,
        conversationalReply: `Sama-sama ${userName}! Senang bisa membantu urusan administrasi protokol Anda.`,
        entities: {},
      };
    }

    // 2b. State-Aware Sub-State Handling
    if (currentState === 'SURAT_MASUK_PILIH_JENIS') {
      let jenis: 'UND' | 'UNR' | 'PH' | 'AU' | 'WR' | 'LP' | 'TAP' | undefined;
      if (lower === '1' || lower === 'und' || (lower.includes('undangan') && !lower.includes('rapat'))) jenis = 'UND';
      else if (lower === '2' || lower === 'unr' || lower.includes('rapat')) jenis = 'UNR';
      else if (lower === '3' || lower === 'ph' || lower.includes('permohonan') || lower.includes('narasumber') || lower.includes('fasilitas')) jenis = 'PH';
      else if (lower === '4' || lower === 'au' || lower.includes('audiensi')) jenis = 'AU';
      else if (lower === '5' || lower === 'wr' || lower.includes('wawancara') || lower.includes('liputan')) jenis = 'WR';
      else if (lower === '6' || lower === 'lp' || lower.includes('laporan')) jenis = 'LP';
      else if (lower === '7' || lower === 'tap' || lower.includes('upacara') || lower.includes('protokol')) jenis = 'TAP';

      if (jenis) {
        return {
          intent: 'SUBMIT_STEP',
          confidence: 0.9,
          conversationalReply: `Baik ${userName}, saya catat jenis suratnya.`,
          entities: { jenisSurat: jenis },
        };
      }
    }

    if (currentState === 'SURAT_MASUK_KONFIRMASI_AGENDA') {
      if (
        lower === '1' ||
        lower === 'ya' ||
        lower === 'y' ||
        lower.includes('sesuai') ||
        lower.includes('benar') ||
        lower.includes('oke') ||
        lower.includes('lanjut') ||
        lower.includes('gunakan')
      ) {
        return {
          intent: 'SUBMIT_STEP',
          confidence: 0.9,
          conversationalReply: `Baik ${userName}, nomor agenda dikonfirmasi sesuai.`,
          entities: { agendaAction: 'CONFIRM' },
        };
      } else if (
        lower === '2' ||
        lower === 'tidak' ||
        lower === 't' ||
        lower.includes('manual') ||
        lower.includes('ubah') ||
        lower.includes('ganti')
      ) {
        return {
          intent: 'SUBMIT_STEP',
          confidence: 0.9,
          conversationalReply: `Silakan masukkan nomor agenda yang diinginkan:`,
          entities: { agendaAction: 'MANUAL' },
        };
      }
    }

    if (currentState === 'SURAT_MASUK_PILIH_TIPE') {
      let tipe: 'Biasa' | 'Rahasia' | 'Penting' | 'Tembusan' | undefined;
      if (lower === '1' || lower.includes('biasa')) tipe = 'Biasa';
      else if (lower === '2' || lower.includes('rahasia')) tipe = 'Rahasia';
      else if (lower === '3' || lower.includes('penting')) tipe = 'Penting';
      else if (lower === '4' || lower.includes('tembusan')) tipe = 'Tembusan';

      if (tipe) {
        return {
          intent: 'SUBMIT_STEP',
          confidence: 0.9,
          conversationalReply: `Baik ${userName}, klasifikasi surat diatur sebagai ${tipe}.`,
          entities: { tipeSurat: tipe },
        };
      }
    }

    if (currentState === 'SURAT_MASUK_REVIEW_DATA') {
      if (
        lower === '1' ||
        lower === 'ya' ||
        lower === 'iya' ||
        lower === 'y' ||
        lower === 'betul' ||
        lower === 'simpan' ||
        lower.includes('benar') ||
        lower.includes('sesuai') ||
        lower.includes('oke') ||
        lower.includes('lanjut') ||
        lower.includes('pas') ||
        lower.includes('sudah benar')
      ) {
        return {
          intent: 'SUBMIT_STEP',
          confidence: 0.9,
          conversationalReply: `Baik ${userName}, data surat telah dikonfirmasi untuk disimpan.`,
          entities: { reviewAction: 'CONFIRM' },
        };
      } else if (
        lower === '2' ||
        lower === 'salah' ||
        lower === 'tidak' ||
        lower === 't' ||
        lower.includes('koreksi') ||
        lower.includes('ubah') ||
        lower.includes('edit') ||
        lower.includes('ada yang salah') ||
        lower.includes('ganti')
      ) {
        return {
          intent: 'SUBMIT_STEP',
          confidence: 0.9,
          conversationalReply: `Silakan perbaiki data pada template berikut.`,
          entities: { reviewAction: 'KOREKSI' },
        };
      }
    }

    if (currentState === 'SURAT_MASUK_EDIT_TEMPLATE') {
      if (lower === 'batal' || lower === 'cancel') {
        return {
          intent: 'BATAL',
          confidence: 0.95,
          conversationalReply: `Baik ${userName}, registrasi surat telah dibatalkan.`,
          entities: {},
        };
      }
      return {
        intent: 'SUBMIT_STEP',
        confidence: 0.9,
        conversationalReply: `Menerapkan koreksi template data surat...`,
        entities: {},
      };
    }

    if (currentState === 'SURAT_MASUK_PILIH_FIELD_KOREKSI') {
      if (lower === '0' || lower.includes('selesai') || lower.includes('lanjut')) {
        return {
          intent: 'SUBMIT_STEP',
          confidence: 0.9,
          conversationalReply: `Koreksi selesai, melanjutkan ke langkah berikutnya.`,
          entities: { fieldToEdit: 'LANJUT' },
        };
      }
      let field: 'tanggalSurat' | 'nomorSurat' | 'subject' | 'asalSurat' | 'event' | 'picPengirim' | 'perihal' | undefined;
      if (lower === '1' || lower.includes('tanggal')) field = 'tanggalSurat';
      else if (lower === '2' || lower.includes('nomor')) field = 'nomorSurat';
      else if (lower === '3' || lower.includes('subject') || lower.includes('hal')) field = 'subject';
      else if (lower === '4' || lower.includes('asal') || lower.includes('instansi')) field = 'asalSurat';
      else if (lower === '5' || lower.includes('event') || lower.includes('acara')) field = 'event';
      else if (lower === '6' || lower.includes('pic') || lower.includes('kontak')) field = 'picPengirim';
      else if (lower === '7' || lower.includes('perihal')) field = 'perihal';

      if (field) {
        return {
          intent: 'SUBMIT_STEP',
          confidence: 0.9,
          conversationalReply: `Silakan masukkan data koreksi baru.`,
          entities: { fieldToEdit: field },
        };
      }
    }

    if (currentState === 'SURAT_MASUK_PILIH_ASAL_INSTANSI') {
      let instansi: 'Pemerintah' | 'Serikat Kerja' | 'Perusahaan' | 'Lainnya' | undefined;
      if (lower === '1' || lower.includes('pemerintah') || lower.includes('kementerian') || lower.includes('dinas') || lower.includes('pemda')) {
        instansi = 'Pemerintah';
      } else if (lower === '2' || lower.includes('serikat') || lower.includes('buruh') || lower.includes('pekerja')) {
        instansi = 'Serikat Kerja';
      } else if (lower === '3' || lower.includes('perusahaan') || lower.includes('pt') || lower.includes('cv') || lower.includes('swasta') || lower.includes('bumn')) {
        instansi = 'Perusahaan';
      } else if (lower === '4' || lower.includes('lain')) {
        instansi = 'Lainnya';
      }

      if (instansi) {
        return {
          intent: 'SUBMIT_STEP',
          confidence: 0.9,
          conversationalReply: `Kategori instansi pengirim dicatat: ${instansi}.`,
          entities: { instansiKategori: instansi },
        };
      }
    }

    if (currentState === 'SURAT_MASUK_REVIEW_PERIHAL_AI') {
      if (
        lower === '1' ||
        lower.includes('sesuai') ||
        lower.includes('lanjut') ||
        lower.includes('oke') ||
        lower.includes('bagus') ||
        lower.includes('pakai')
      ) {
        return {
          intent: 'SUBMIT_STEP',
          confidence: 0.9,
          conversationalReply: `Rekomendasi perihal disetujui.`,
          entities: { perihalAction: 'CONFIRM' },
        };
      } else if (
        lower === '2' ||
        lower.includes('manual') ||
        lower.includes('ubah') ||
        lower.includes('ganti') ||
        lower.includes('sendiri')
      ) {
        return {
          intent: 'SUBMIT_STEP',
          confidence: 0.9,
          conversationalReply: `Silakan ketikkan perihal surat yang diinginkan:`,
          entities: { perihalAction: 'MANUAL' },
        };
      }
    }

    if (currentState === 'SURAT_MASUK_FINAL_CONFIRM') {
      if (lower === '1' || lower.includes('simpan') || lower.includes('terbit') || lower.includes('oke') || lower.includes('ya')) {
        return {
          intent: 'SUBMIT_STEP',
          confidence: 0.9,
          conversationalReply: `Memproses penyimpanan dan penerbitan agenda surat...`,
          entities: { finalAction: 'SAVE' },
        };
      } else if (lower === '2' || lower.includes('batal') || lower.includes('gajadi')) {
        return {
          intent: 'BATAL',
          confidence: 0.9,
          conversationalReply: `Baik ${userName}, registrasi surat telah dibatalkan.`,
          entities: { finalAction: 'CANCEL' },
        };
      }
    }

    if (currentState === 'JADWAL_MENU') {
      const mentionsSurat = lower.includes('surat') || lower.includes('dokumen') || lower.includes('berkas') || lower.includes('arsip');
      if (!mentionsSurat && (lower === '1' || lower.includes('berikut') || lower.includes('terdekat'))) {
        return {
          intent: 'JADWAL_BERIKUTNYA',
          confidence: 0.9,
          conversationalReply: `Berikut jadwal kegiatan terdekat:`,
          entities: {},
        };
      }
      if (
        !mentionsSurat &&
        (lower === '2' ||
          lower.includes('mendatang') ||
          lower.includes('minggu') ||
          lower.includes('depan') ||
          lower.includes('kedepannya') ||
          lower.includes('ke depan') ||
          lower.includes('kedepan') ||
          lower.includes('selanjutnya') ||
          lower.includes('akan datang') ||
          lower.includes('akan ada') ||
          lower.includes('beberapa hari') ||
          lower.includes('pekan depan') ||
          lower.includes('minggu depan') ||
          lower.includes('waktu dekat') ||
          lower.includes('ke depannya'))
      ) {
        return {
          intent: 'JADWAL_MENDATANG',
          confidence: 0.9,
          conversationalReply: `Berikut agenda kegiatan mendatang:`,
          entities: {},
        };
      }
      if (!mentionsSurat && (lower === '3' || lower.includes('cari'))) {
        return {
          intent: 'JADWAL_CARI',
          confidence: 0.9,
          conversationalReply: `Silakan ketik kata kunci jadwal yang ingin dicari:`,
          entities: {},
        };
      }
    }

    // 3. Greeting
    const greetings = [
      'halo',
      'hi',
      'hai',
      'pagi',
      'selamat pagi',
      'siang',
      'selamat siang',
      'sore',
      'selamat sore',
      'malam',
      'selamat malam',
      'assalamualaikum',
      'ping',
      'menu',
      '/start',
      'start',
      'tes',
      'test',
    ];
    if (greetings.includes(lower) || lower.startsWith('halo') || lower.startsWith('hai')) {
      return {
        intent: 'GREETING',
        confidence: 0.9,
        conversationalReply: `Halo ${userName}! Ada yang bisa saya bantu hari ini? 😊`,
        entities: {},
      };
    }

    // 4. Surat Masuk (Registrasi / Input baru)
    const isSuratInput =
      !lower.includes('riwayat') &&
      !lower.includes('log') &&
      !lower.includes('lacak') &&
      !lower.includes('status') &&
      ((lower.includes('surat') &&
        (lower.includes('masuk') ||
          lower.includes('input') ||
          lower.includes('tambah') ||
          lower.includes('unggah') ||
          lower.includes('upload') ||
          lower.includes('daftar') ||
          lower.includes('registrasi') ||
          lower.includes('masukkin') ||
          lower.includes('masukin') ||
          lower.includes('bikin'))) ||
        lower.includes('masukkin surat') ||
        lower.includes('masukin surat') ||
        lower.includes('input surat'));

    if (isSuratInput) {
      return {
        intent: 'SURAT_MASUK',
        confidence: 0.85,
        conversationalReply: `Tentu bisa ${userName}! Saya bantu proses registrasi surat masuknya ya:`,
        entities: {},
      };
    }

    // 5. Deteksi Pencarian (CARI_UMUM vs CARI_SURAT vs JADWAL_CARI)
    const isAboutLetter =
      lower.includes('surat') ||
      lower.includes('dokumen') ||
      lower.includes('berkas') ||
      lower.includes('arsip');

    const isAboutJadwal =
      lower.includes('jadwal') ||
      lower.includes('agenda') ||
      lower.includes('kegiatan') ||
      lower.includes('mendatang') ||
      lower.includes('kedepannya') ||
      lower.includes('ke depan') ||
      lower.includes('kedepan') ||
      lower.includes('akan datang') ||
      lower.includes('akan ada') ||
      lower.includes('beberapa hari') ||
      lower.includes('pekan depan') ||
      lower.includes('minggu depan') ||
      lower.includes('waktu dekat') ||
      lower.includes('ke depannya') ||
      lower.includes('hari-hari ke depan') ||
      lower.includes('tanggal ke depan');

    // 5a. Pencarian Terpadu (CARI_UMUM):
    // Mendeteksi permintaan informasi/detail/pencarian baik dengan awalan maupun di dalam kalimat
    const isGeneralSearchVerb =
      lower.startsWith('cari') ||
      lower.startsWith('cek') ||
      lower.startsWith('info') ||
      lower.startsWith('lacak') ||
      lower.startsWith('temukan') ||
      lower.startsWith('searching') ||
      lower.startsWith('search') ||
      lower.startsWith('tentang') ||
      lower.startsWith('detail') ||
      lower.startsWith('rincian') ||
      lower.startsWith('berikan') ||
      lower.startsWith('beri ') ||
      lower.startsWith('kasih') ||
      lower.startsWith('jelaskan') ||
      lower.startsWith('terangkan') ||
      lower.startsWith('tampilkan') ||
      lower.startsWith('lihat') ||
      lower.startsWith('liat') ||
      lower.startsWith('minta') ||
      lower.includes('detail tentang') ||
      lower.includes('detail ') ||
      lower.includes('rincian ') ||
      lower.includes('info tentang') ||
      lower.includes('informasi tentang') ||
      lower.includes('ada apa tentang') ||
      lower.includes('apakah ada') ||
      lower.includes('tentang ') ||
      lower.includes('mengenai ') ||
      lower.includes('terkait ') ||
      lower.includes('soal ') ||
      lower.includes('kongres') ||
      lower.includes('seminar') ||
      lower.includes('rakor');

    const isHybridSearch =
      (isAboutLetter && isAboutJadwal) ||
      (!isAboutLetter && !isAboutJadwal && isGeneralSearchVerb && !lower.includes('disposisi') && !lower.includes('riwayat'));

    if (isHybridSearch) {
      const keyword = this.extractSearchKeyword(text);
      return {
        intent: 'CARI_UMUM',
        confidence: 0.85,
        conversationalReply: `Baik ${userName}, saya bantu carikan informasi mengenai "${keyword || text}" di agenda kegiatan maupun arsip surat masuk:`,
        entities: { keyword: keyword || undefined },
      };
    }

    // 5b. Riwayat Surat Masuk Terbaru (contoh: "carikan surat terbaru", "surat terbaru", "lihat surat masuk", "daftar surat")
    const isRiwayat =
      lower.includes('riwayat') ||
      lower.includes('log surat') ||
      lower.includes('daftar surat') ||
      lower === 'surat terbaru' ||
      lower === 'surat terakhir' ||
      lower === 'surat masuk terbaru' ||
      (isAboutLetter && (
        lower.includes('terbaru') ||
        lower.includes('terakhir') ||
        lower.includes('baru masuk') ||
        lower.includes('terkini') ||
        lower.includes('daftar') ||
        lower.includes('lihat surat') ||
        lower.includes('liat surat')
      ));

    if (isRiwayat) {
      return {
        intent: 'RIWAYAT',
        confidence: 0.95,
        conversationalReply: `Baik ${userName}, ini daftar riwayat surat masuk terbaru:`,
        entities: {},
      };
    }

    // 5c. Cari Surat (Eksplisit tentang surat/dokumen)
    const isExplicitCariSurat =
      isAboutLetter &&
      !isAboutJadwal &&
      !lower.includes('disposisi') &&
      !isRiwayat &&
      (
        lower.includes('cari surat') ||
        lower.includes('carikan surat') ||
        lower.includes('cek surat') ||
        lower.startsWith('cari ') ||
        lower.startsWith('carikan ') ||
        lower.startsWith('cek ') ||
        lower.includes('perihal') ||
        lower.includes('tentang') ||
        lower.includes('mengenai') ||
        lower.includes('terkait') ||
        lower.includes('soal') ||
        lower.includes('topik') ||
        lower.includes('undangan') ||
        lower.includes('rapat') ||
        lower.includes('rakor') ||
        lower.includes('audiensi') ||
        lower.includes('permohonan') ||
        lower.includes('wawancara') ||
        lower.includes('laporan') ||
        lower.includes('investigasi') ||
        lower.includes('upacara') ||
        lower.includes('k3') ||
        lower.includes('vokasi') ||
        lower.includes('buruh') ||
        lower.includes('phk') ||
        lower.includes('acara') ||
        lower.includes('kegiatan')
      );

    if (isExplicitCariSurat) {
      const keyword = this.extractSearchKeyword(text);
      return {
        intent: 'CARI_SURAT',
        confidence: 0.9,
        conversationalReply: `Baik ${userName}, saya bantu carikan dokumen suratnya:`,
        entities: { keyword: keyword || undefined },
      };
    }

    // 5d. Pencarian Umum / Hybrid (Tidak spesifik menyebut hanya surat atau hanya jadwal, atau menyebut keduanya)
    const isBothLetterAndJadwal = isAboutLetter && isAboutJadwal;
    const isNeitherLetterNorJadwal = !isAboutLetter && !isAboutJadwal;

    if (isBothLetterAndJadwal || isNeitherLetterNorJadwal) {
      const hasSearchIntent =
        lower.startsWith('cari ') ||
        lower.startsWith('carikan ') ||
        lower.startsWith('cek ') ||
        lower.startsWith('info ') ||
        lower.startsWith('informasi ') ||
        lower.startsWith('ada apa ') ||
        lower.includes('tentang ') ||
        lower.includes('mengenai ') ||
        lower.includes('terkait ') ||
        lower.includes('soal ') ||
        lower.includes('topik ') ||
        isBothLetterAndJadwal;

      if (hasSearchIntent && !lower.includes('disposisi') && !isRiwayat) {
        const keyword = this.extractSearchKeyword(text);
        if (keyword && keyword.length >= 2) {
          return {
            intent: 'CARI_UMUM',
            confidence: 0.9,
            conversationalReply: `Baik ${userName}, saya bantu carikan informasi surat dan agenda kegiatan terkait "${keyword}":`,
            entities: { keyword },
          };
        }
      }
    }

    // 6. Jadwal Kegiatan (Hanya dievaluasi jika bukan mengenai dokumen/surat)
    const hasIndoDate = extractDateFromText(text) !== null;
    const hasIndoRange = extractDateRangeFromText(text) !== null;
    if (
      !isAboutLetter &&
      (isAboutJadwal || hasIndoDate || hasIndoRange || lower.includes('kegiatan') || lower.includes('acara') || lower.includes('besok') || lower.includes('esok'))
    ) {
      // 6a. Cek apakah ada rentang hari spesifik (contoh: "berikan jadwal 2 hari kedepan", "3 hari ke depan", "5 hari kedepan", "seminggu kedepan", "dua minggu kedepan")
      const parsedRange = extractDateRangeFromText(text);
      if (parsedRange) {
        return {
          intent: 'JADWAL_RENTANG',
          confidence: 0.95,
          conversationalReply: `Baik ${userName}, ini agenda kegiatan protokol untuk ${parsedRange.label.toLowerCase()} (${parsedRange.formattedRange}):`,
          entities: {
            rentangHari: parsedRange.daysCount,
            rentangLabel: parsedRange.label,
          },
        };
      }

      // 6b. Cek apakah ada tanggal spesifik (contoh: "jadwal tanggal 18 september", "kirim jadwal 18 sep", "jadwal 23/09/2026")
      const parsedDate = extractDateFromText(text);
      if (parsedDate && !lower.includes('besok') && !lower.includes('esok') && !lower.includes('hari ini') && !lower.includes('lusa')) {
        return {
          intent: 'JADWAL_CARI',
          confidence: 0.95,
          conversationalReply: `Baik ${userName}, ini agenda kegiatan protokol untuk tanggal ${parsedDate.formattedIndo}:`,
          entities: { tanggal: parsedDate.dateStr },
        };
      }
      if (lower.includes('besok') || lower.includes('esok')) {
        return {
          intent: 'JADWAL_BESOK',
          confidence: 0.9,
          conversationalReply: `Baik ${userName}, ini agenda kegiatan protokol untuk besok:`,
          entities: {},
        };
      }
      if (lower.includes('hari ini')) {
        return {
          intent: 'JADWAL_HARI_INI',
          confidence: 0.85,
          conversationalReply: `Baik ${userName}, ini daftar agenda kegiatan protokol untuk hari ini:`,
          entities: {},
        };
      }
      if (lower.includes('berikutnya') || lower.includes('terdekat') || lower.includes('setelah ini') || lower.includes('setelah sekarang') || lower.includes('berikut ini') || lower.includes('selanjutnya')) {
        return {
          intent: 'JADWAL_BERIKUTNYA',
          confidence: 0.85,
          conversationalReply: `Baik ${userName}, ini agenda kegiatan terdekat berikutnya:`,
          entities: {},
        };
      }
      if (
        lower.includes('minggu ini') ||
        lower.includes('mendatang') ||
        lower.includes('7 hari') ||
        lower.includes('depan') ||
        lower.includes('kedepannya') ||
        lower.includes('ke depan') ||
        lower.includes('kedepan') ||
        lower.includes('selanjutnya') ||
        lower.includes('akan datang') ||
        lower.includes('akan ada') ||
        lower.includes('beberapa hari') ||
        lower.includes('pekan depan') ||
        lower.includes('minggu depan') ||
        lower.includes('waktu dekat') ||
        lower.includes('ke depannya') ||
        lower.includes('hari-hari ke depan') ||
        lower.includes('tanggal ke depan') ||
        lower.includes('ke depan ini')
      ) {
        return {
          intent: 'JADWAL_MENDATANG',
          confidence: 0.85,
          conversationalReply: `Baik ${userName}, ini rangkuman jadwal kegiatan protokol mendatang:`,
          entities: {},
        };
      }
      if (lower.includes('cari') || lower.includes('cek')) {
        const keywordMatch = lower.replace(/^(tolong|mohon|bisa)?\s*(cari|cek|liat)?\s*(jadwal|agenda|kegiatan)?\s*(tentang|mengenai)?\s*/i, '').trim();
        return {
          intent: 'JADWAL_CARI',
          confidence: 0.8,
          conversationalReply: `Baik ${userName}, saya bantu carikan agenda kegiatannya:`,
          entities: { keyword: keywordMatch || undefined },
        };
      }
      return {
        intent: 'JADWAL_HARI_INI',
        confidence: 0.7,
        conversationalReply: `Baik ${userName}, ini informasi jadwal kegiatan protokol:`,
        entities: {},
      };
    }

    // 7. Disposisi
    if (lower.includes('disposisi')) {
      const matches = text.match(/([A-Z0-9\-\/]{4,})/i);
      const nomor = matches && !matches[1].toLowerCase().includes('disposisi') ? matches[1] : undefined;
      return {
        intent: 'DISPOSISI',
        confidence: 0.85,
        conversationalReply: `Baik ${userName}, saya bantu pelacakan status disposisi suratnya:`,
        entities: { nomorSurat: nomor },
      };
    }

    // 8. Riwayat Surat
    if (lower.includes('riwayat') || (lower.includes('log') && lower.includes('surat')) || lower.includes('arsip')) {
      return {
        intent: 'RIWAYAT',
        confidence: 0.85,
        conversationalReply: `Baik ${userName}, berikut riwayat surat masuk yang tercatat:`,
        entities: {},
      };
    }

    // 9. Pertanyaan Identitas (CHITCHAT)
    if (lower.includes('siapa') || lower.includes('kamu siapa') || lower.includes('siapa kamu')) {
      return {
        intent: 'CHITCHAT',
        confidence: 0.9,
        conversationalReply: `Halo ${userName}! Saya adalah Asisten AI Protokol Kementerian Ketenagakerjaan (Kemnaker) RI. 😊`,
        entities: {},
      };
    }

    // 10. Bantuan
    if (
      lower.includes('bantuan') ||
      lower.includes('panduan') ||
      lower.includes('help') ||
      lower.includes('cara pakai') ||
      lower.includes('cara pake') ||
      lower.includes('bisa ngapain') ||
      lower.includes('bisa apa')
    ) {
      return {
        intent: 'BANTUAN',
        confidence: 0.85,
        conversationalReply: `Halo ${userName}, ini pusat bantuan dan panduan penggunaan chatbot protokol:`,
        entities: {},
      };
    }

    // 10. Deteksi kata kunci mandiri (misal: "vokasi", "k3", "bnn", "kunker", "amazon") yang bukan sapaan
    const isGreetingWord = /^(halo|hai|hi|hey|assalamu|pagi|siang|sore|malam|permisi|ping|p)\b/i.test(lower);
    const isThanksWord = /\b(makasih|terima kasih|thanks|syukron)\b/i.test(lower);
    const isIdentityQuery = /\b(kamu siapa|siapa kamu|namamu|kamu ini)\b/i.test(lower);

    if (!isGreetingWord && !isThanksWord && !isIdentityQuery && text.trim().length >= 2 && text.trim().length <= 50) {
      const keyword = this.extractSearchKeyword(text);
      if (keyword && keyword.length >= 2) {
        return {
          intent: 'CARI_UMUM',
          confidence: 0.85,
          conversationalReply: `Baik ${userName}, saya bantu carikan informasi surat dan agenda kegiatan terkait "${keyword}":`,
          entities: { keyword },
        };
      }
    }

    // 11. Chitchat / Percakapan Santai
    return {
      intent: 'CHITCHAT',
      confidence: 0.5,
      conversationalReply: `Halo ${userName}! Ada yang bisa saya bantu terkait persuratan atau jadwal kegiatan Protokol Kemnaker? 😊`,
      entities: {},
    };
  }
}

export const nluService = new NluService();
