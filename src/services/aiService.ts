import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';
import { ENV } from '../config/env';
import { ExtractedSuratData } from './sessionService';

/**
 * Memformat rumusan Perihal resmi sesuai formula template resmi berdasarkan kategori surat:
 * - UND - Undangan Menghadiri (Nama Acara) dengan tema (Tema Acara) yang diselenggarakan oleh (Penyelenggara)
 * - PH - Permohonan Memberikan (Sesi Acara(Sambutan/Keynote Speech/Arahan dll) pada kegiatan (Nama Acara) dengan tema (Tema Acara) yang diselenggarakan oleh (Penyelenggara)
 * - UNR - Undangan Menghadiri Pernikahan (Nama Mempelai) (Putri Bapak … dan Ibu …) dengan (Nama Mempelai) (Putri Bapak … dan Ibu …)
 * - WR, AU - Permohonan Wawancara/Audiensi dari (Nama Instansi) terkait (Pokok Bahasan)
 * - TAP - Permohonan Memberikan Video Ucapan dalam rangka ….
 */
export function formatPerihalByTemplate(data: Partial<ExtractedSuratData>): string {
  const kat = (data.kategoriSurat || 'UND').toUpperCase();
  const namaAcara = (data.namaAcara || data.event || data.subject || 'Kegiatan').trim();
  const penyelenggara = (data.penyelenggara || data.asalSurat || 'Penyelenggara').trim();
  const rawTema = data.temaAcara && data.temaAcara !== '-' ? data.temaAcara.trim() : '';

  // Bersihkan tema jika hanya mengulang nama acara
  const tema = rawTema && rawTema.toLowerCase() !== namaAcara.toLowerCase() ? rawTema : '';

  switch (kat) {
    case 'UND': {
      // Template: Undangan Menghadiri (Nama Acara) dengan tema (Tema Acara) yang diselenggarakan oleh (Penyelenggara)
      if (tema) {
        return `Undangan Menghadiri ${namaAcara} dengan tema "${tema}" yang diselenggarakan oleh ${penyelenggara}`;
      }
      return `Undangan Menghadiri ${namaAcara} yang diselenggarakan oleh ${penyelenggara}`;
    }

    case 'PH': {
      // Template: Permohonan Memberikan (Sesi Acara(Sambutan/Keynote Speech/Arahan dll) pada kegiatan (Nama Acara) dengan tema (Tema Acara) yang diselenggarakan oleh (Penyelenggara)
      const sesi = data.sesiAcara && data.sesiAcara !== '-' ? data.sesiAcara.trim() : 'Sambutan dan Arahan';
      if (tema) {
        return `Permohonan Memberikan ${sesi} pada kegiatan ${namaAcara} dengan tema "${tema}" yang diselenggarakan oleh ${penyelenggara}`;
      }
      return `Permohonan Memberikan ${sesi} pada kegiatan ${namaAcara} yang diselenggarakan oleh ${penyelenggara}`;
    }

    case 'UNR': {
      // Template: Undangan Menghadiri Pernikahan (Nama Mempelai) (Putri Bapak … dan Ibu …) dengan (Nama Mempelai) (Putri Bapak … dan Ibu …)
      const m1 = data.mempelai1 && data.mempelai1 !== '-' ? data.mempelai1.trim() : '';
      const m2 = data.mempelai2 && data.mempelai2 !== '-' ? data.mempelai2.trim() : '';
      if (m1 && m2) {
        return `Undangan Menghadiri Pernikahan ${m1} dengan ${m2}`;
      } else if (m1 || m2) {
        return `Undangan Menghadiri Pernikahan ${m1 || m2}`;
      }
      return `Undangan Menghadiri Pernikahan ${namaAcara}`;
    }

    case 'WR': {
      // Template: Permohonan Wawancara dari (Nama Instansi) terkait (Pokok Bahasan)
      const pokok = data.pokokBahasan && data.pokokBahasan !== '-' ? data.pokokBahasan.trim() : (data.subject || 'Isu Terkini Ketenagakerjaan');
      return `Permohonan Wawancara dari ${penyelenggara} terkait ${pokok}`;
    }

    case 'AU': {
      // Template: Permohonan Audiensi dari (Nama Instansi) terkait (Pokok Bahasan)
      const pokok = data.pokokBahasan && data.pokokBahasan !== '-' ? data.pokokBahasan.trim() : (data.subject || 'Silaturahmi dan Pembahasan Isu Ketenagakerjaan');
      return `Permohonan Audiensi dari ${penyelenggara} terkait ${pokok}`;
    }

    case 'TAP': {
      // Template: Permohonan Memberikan Video Ucapan dalam rangka ….
      const rangka = data.rangkaUcapan && data.rangkaUcapan !== '-' ? data.rangkaUcapan.trim() : (namaAcara || 'Peringatan');
      return `Permohonan Memberikan Video Ucapan dalam rangka ${rangka}`;
    }

    case 'LP': {
      const judul = namaAcara || data.subject || 'Pelaksanaan Kegiatan';
      return `Laporan ${judul} dari ${penyelenggara}`;
    }

    default: {
      return `Surat dari ${penyelenggara} terkait ${namaAcara}`;
    }
  }
}

export class AiService {
  private genAiClient: GoogleGenAI | null = null;
  private openAiClient: OpenAI | null = null;

  constructor() {
    this.initClients();
  }

  private initClients(): void {
    const pdfKey = (ENV.PDF_EXTRACTION_API_KEY || ENV.GEMINI_API_KEY || '').trim();
    const chatKey = (ENV.CHAT_API_KEY || ENV.OPENROUTER_API_KEY || '').trim();
    const apiKey = pdfKey || chatKey;

    if (!apiKey) return;

    const provider = (ENV.PDF_EXTRACTION_PROVIDER || '').toLowerCase();

    // Jika pengguna mengisi GEMINI_API_KEY / PDF_EXTRACTION_API_KEY dengan key Google Gemini (bukan sk-) dan provider 'gemini'
    if (pdfKey && !pdfKey.startsWith('sk-') && provider === 'gemini') {
      this.genAiClient = new GoogleGenAI({ apiKey: pdfKey });
    } else {
      // Menggunakan OpenRouter (baik key gratis CHAT_API_KEY maupun key berbayar yang dimasukkan ke PDF_EXTRACTION_API_KEY / OPENROUTER_API_KEY)
      this.openAiClient = new OpenAI({
        baseURL: 'https://openrouter.ai/api/v1',
        apiKey,
        timeout: 45000,
        defaultHeaders: {
          'HTTP-Referer': 'https://kemnaker.go.id',
          'X-Title': 'Kemnaker Protokol PDF Extractor',
        },
      });
    }
  }

  /**
   * Ekstraksi metadata surat dari teks dokumen
   */
  public async extractSuratData(pdfText: string, originalFileName?: string): Promise<ExtractedSuratData> {
    return this.extractDocumentMetadata(pdfText, originalFileName);
  }

  public async extractDocumentMetadata(pdfText: string, originalFileName?: string): Promise<ExtractedSuratData> {
    const isUsingOpenRouter = Boolean(this.openAiClient);
    let model = 'openrouter/free';

    if (isUsingOpenRouter) {
      // Jika pengguna memasukkan API key OpenRouter berbayar ke PDF_EXTRACTION_API_KEY atau OPENROUTER_API_KEY
      if (ENV.PDF_EXTRACTION_API_KEY && ENV.PDF_EXTRACTION_API_KEY.startsWith('sk-')) {
        // Jika model disetel khusus (misal google/gemini-2.5-flash, openai/gpt-4o-mini, dll), gunakan model tersebut
        model = ENV.PDF_EXTRACTION_MODEL && !ENV.PDF_EXTRACTION_MODEL.startsWith('gemini-')
          ? ENV.PDF_EXTRACTION_MODEL
          : (ENV.PDF_EXTRACTION_MODEL ? `google/${ENV.PDF_EXTRACTION_MODEL}` : 'google/gemini-2.5-flash');
      } else if (ENV.PDF_EXTRACTION_PROVIDER === 'openrouter' && ENV.PDF_EXTRACTION_MODEL) {
        model = ENV.PDF_EXTRACTION_MODEL;
      } else {
        model = ENV.CHAT_MODEL || 'openrouter/free';
      }
    } else {
      model = ENV.PDF_EXTRACTION_MODEL || 'gemini-2.5-flash';
    }

    // 1. Ekstraksi cerdas menggunakan AI
    if ((this.genAiClient || this.openAiClient) && pdfText.trim().length > 20) {
      try {
        const prompt = `Anda adalah asisten AI Protokol Kementerian Ketenagakerjaan (Kemnaker) yang ahli dalam menganalisis dokumen surat dinas masuk.

TUGAS UTAMA:
1. Pahami isi keseluruhan teks dokumen surat resmi berikut.
2. Tentukan KATEGORI SURAT (kategoriSurat) secara akurat dari salah satu kode berikut:
   - "UND" : Undangan Menghadiri acara/rapat/seminar/konferensi/FGD/diskusi/lokakarya/dies natalis/peringatan umum (BUKAN pernikahan, BUKAN meminta pimpinan memberi sambutan/speech khusus).
   - "PH"  : Permohonan Hadir yang meminta Menteri / Pimpinan Kemnaker untuk MEMBERIKAN SAMBUTAN, KEYNOTE SPEECH, ARAHAN, MEMBUKA ACARA, atau menjadi NARASUMBER / PEMBICARA.
   - "UNR" : Undangan Pernikahan (akad nikah, resepsi pernikahan, walimah, ngunduh mantu).
   - "AU"  : Permohonan Audiensi / Silaturahmi resmi / Tatap muka / Kunjungan kehormatan dari instansi, organisasi, atau serikat pekerja.
   - "WR"  : Permohonan Wawancara / Peliputan khusus dari media / pers / jurnalis.
   - "TAP" : Permohonan pembuatan atau rekaman Video Ucapan (selamat ulang tahun, harlah, milad, perayaan hari jadi).
   - "LP"  : Dokumen Laporan (laporan kegiatan, laporan pelaksanaan, pertanggungjawaban).

3. Aturan ekstraksi entitas secara presisi:
   - "kategoriSurat": "UND" | "PH" | "UNR" | "WR" | "AU" | "TAP" | "LP"
   - "alasanKategori": "penjelasan singkat mengapa dokumen masuk kategori ini"
   - "nomorSurat": "nomor registrasi surat dinas resmi (CONTOH: 'HM.4.6/189/D.IV.M.EKON/09/2026' atau 'B-102/DIR/IX/2026'). SANGAT PENTING: JANGAN mengambil nomor jalan/alamat pengirim/penerima (seperti 'No. 2-4' atau 'Kav. 51')!"
   - "tanggalSurat": "tanggal surat dibuat dalam bahasa Indonesia (misal: '15 September 2026')"
   - "asalSurat": "nama instansi/lembaga/organisasi PENGIRIM surat (lihat dari KOP SURAT teratas atau tanda tangan pengirim di akhir surat). PENTING: JANGAN mengambil nama penerima (misal 'Yth. Menteri Ketenagakerjaan') sebagai asal surat!"
   - "penyelenggara": "nama lembaga penyelenggara acara (jika sama dengan pengirim, isi nama instansi pengirim)"
   - "namaAcara": "nama murni acara/kegiatan saja (CONTOH: 'Forum Koordinasi Ketenagakerjaan Nasional 2026' atau 'Seminar Nasional Vokasi'). HAPUS kata pembuka seperti 'Permohonan Keynote Speech pada Pembukaan' atau 'Undangan Menghadiri'!"
   - "temaAcara": "tema spesifik acara jika ada tertulis (misal: 'Transformasi Tenaga Kerja Menuju Indonesia Emas 2045', atau '-' jika tidak ada tema)"
   - "sesiAcara": "khusus kategori PH, peran/sesi yang dimohonkan kepada Menteri / Pimpinan Kemnaker (misal: 'Keynote Speech', 'Sambutan dan Arahan', 'Membuka Acara', 'Narasumber', atau '-')"
   - "mempelai1": "jika UNR, nama mempelai 1 dan orang tua (misal: 'Anisa Rahmawati (Putri Bapak Ahmad dan Ibu Siti)', atau '-')"
   - "mempelai2": "jika UNR, nama mempelai 2 dan orang tua (misal: 'Dimas Pratama (Putra Bapak Bambang dan Ibu Sri)', atau '-')"
   - "pokokBahasan": "jika WR/AU, pokok bahasan audiensi atau wawancara (atau '-')"
   - "rangkaUcapan": "jika TAP, rangka pembuatan video ucapan (misal: 'Hari Ulang Tahun ke-75 PT Aneka Tambang Tbk', atau '-')"
   - "picPengirim": "nama PIC dan kontak telepon / email jika ada (atau '-')"

KEMBALIKAN OUTPUT HANYA DALAM FORMAT JSON VALID TANPA MARKDOWN (\`\`\`json) DAN TANPA PENJELASAN LAIN:

TEKS SURAT:
${pdfText.slice(0, 6000)}
`;

        let rawText = '';
        if (this.openAiClient) {
          const res = await this.openAiClient.chat.completions.create({
            model,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.1,
            max_tokens: 2500,
          });
          rawText = res.choices?.[0]?.message?.content || '';
          if (!rawText && (res.choices?.[0]?.message as any)?.reasoning) {
            rawText = (res.choices?.[0]?.message as any).reasoning;
          }
        } else if (this.genAiClient) {
          const res = await this.genAiClient.models.generateContent({
            model,
            contents: prompt,
          });
          rawText = res.text || '';
        }

        const clean = rawText.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
        const cleanJson = clean.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
        const jsonMatch = cleanJson.match(/\{[\s\S]*\}/);

        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);

          const kategori: 'UND' | 'PH' | 'UNR' | 'WR' | 'AU' | 'TAP' | 'LP' =
            parsed.kategoriSurat && ['UND', 'PH', 'UNR', 'WR', 'AU', 'TAP', 'LP'].includes(parsed.kategoriSurat)
              ? parsed.kategoriSurat
              : 'UND';

          // Bersihkan nama acara dari kata pengantar seperti "Permohonan ... pada"
          const rawAcara = (parsed.namaAcara || parsed.event || '-').trim();
          const cleanAcara = rawAcara
            .replace(/^(?:permohonan|undangan|surat)\s+(?:memberikan|menghadiri|kehadiran|resmi)?\s*/i, '')
            .replace(/^(?:keynote speech|sambutan|arahan)?\s*(?:pada|dalam rangka)?\s*(?:kegiatan|acara|pembukaan)?\s*/i, '')
            .trim() || rawAcara;

          const extracted: ExtractedSuratData = {
            kategoriSurat: kategori,
            alasanKategori: parsed.alasanKategori || '',
            tanggalSurat: parsed.tanggalSurat || this.getTodayFormatted(),
            nomorSurat: parsed.nomorSurat || '-',
            subject: cleanAcara || parsed.subject || 'Surat Masuk',
            asalSurat: parsed.asalSurat || '-',
            event: cleanAcara,
            picPengirim: parsed.picPengirim || '-',
            namaAcara: cleanAcara,
            temaAcara: parsed.temaAcara && parsed.temaAcara !== '-' ? parsed.temaAcara : undefined,
            penyelenggara: parsed.penyelenggara || parsed.asalSurat || '-',
            sesiAcara: parsed.sesiAcara && parsed.sesiAcara !== '-' ? parsed.sesiAcara : undefined,
            mempelai1: parsed.mempelai1 && parsed.mempelai1 !== '-' ? parsed.mempelai1 : undefined,
            mempelai2: parsed.mempelai2 && parsed.mempelai2 !== '-' ? parsed.mempelai2 : undefined,
            pokokBahasan: parsed.pokokBahasan && parsed.pokokBahasan !== '-' ? parsed.pokokBahasan : undefined,
            rangkaUcapan: parsed.rangkaUcapan && parsed.rangkaUcapan !== '-' ? parsed.rangkaUcapan : undefined,
            perihal: '', // Akan diformat di bawah
          };

          // Format perihal secara ketat mengikuti formula template resmi berdasarkan kategori
          extracted.perihal = formatPerihalByTemplate(extracted);
          // Samakan isi dari acara seperti yang ada di perihal, templatenya sama
          extracted.event = extracted.perihal;

          return extracted;
        }
      } catch (err) {
        console.warn(`[AiService] Ekstraksi cerdas AI (${model}) gagal, menggunakan fallback parser:`, err);
      }
    }

    // 2. Fallback Rule-Based Parser (Jika AI Key kosong atau respons tidak sesuai)
    return this.fallbackRuleBasedExtraction(pdfText, originalFileName);
  }

  /**
   * Rekomendasi perihal standar birokrasi berdasarkan konteks surat
   */
  public async generatePerihalRecommendation(context: {
    subject: string;
    asalSurat: string;
    event?: string;
    fullText?: string;
  }): Promise<string> {
    return formatPerihalByTemplate({
      kategoriSurat: 'UND',
      namaAcara: context.event || context.subject,
      penyelenggara: context.asalSurat,
      asalSurat: context.asalSurat,
      subject: context.subject,
    });
  }

  /**
   * Ekstraksi berbasis aturan regex/heuristik jika AI offline
   */
  private fallbackRuleBasedExtraction(text: string, fileName?: string): ExtractedSuratData {
    const lower = text.toLowerCase();

    // 1. Deteksi Kategori berbasis kata kunci
    let kategoriSurat: 'UND' | 'PH' | 'UNR' | 'WR' | 'AU' | 'TAP' | 'LP' = 'UND';
    let sesiAcara: string | undefined;

    if (/pernikahan|akad nikah|resepsi pernikahan|walimatul/i.test(lower)) {
      kategoriSurat = 'UNR';
    } else if (/video ucapan|ucapan video|rekaman ucapan/i.test(lower)) {
      kategoriSurat = 'TAP';
    } else if (/wawancara|peliputan media|liputan pers/i.test(lower)) {
      kategoriSurat = 'WR';
    } else if (/audiensi|silaturahmi|kunjungan kehormatan|tatap muka/i.test(lower)) {
      kategoriSurat = 'AU';
    } else if (/keynote speech|memberikan arahan|sambutan|narasumber|pembicara|membuka acara/i.test(lower)) {
      kategoriSurat = 'PH';
      if (/keynote speech/i.test(lower)) {
        sesiAcara = 'Keynote Speech';
      } else if (/narasumber|pembicara/i.test(lower)) {
        sesiAcara = 'Narasumber';
      } else if (/arahan/i.test(lower)) {
        sesiAcara = 'Arahan';
      } else {
        sesiAcara = 'Sambutan dan Arahan';
      }
    } else if (/laporan kegiatan|laporan pertanggungjawaban|laporan hasil/i.test(lower)) {
      kategoriSurat = 'LP';
    } else {
      kategoriSurat = 'UND';
    }

    // 2. Cari nomor surat (hindari nomor jalan / alamat seperti Jl. ... No. 2-4)
    const lines = text.split('\n');
    let nomorSurat = '-';
    for (const line of lines) {
      const trimmed = line.trim();
      if (/^(?:jalan|jl\.|kav\.|gedung|lantai)/i.test(trimmed)) continue;
      const m = trimmed.match(/(?:nomor|no)\s*[:.]\s*([A-Za-z0-9\/\.\-_ ]+)/i);
      if (m && m[1]) {
        const candidate = m[1].trim();
        // Nomor surat resmi biasanya memiliki slash atau minimal 4 karakter dan bukan hanya rentang digit alamat (seperti 2-4)
        if (candidate.includes('/') || (candidate.length >= 4 && !/^\d+\s*-\s*\d+$/.test(candidate))) {
          nomorSurat = candidate;
          break;
        }
      }
    }
    if (nomorSurat === '-' && fileName) {
      nomorSurat = `REF-${fileName.replace('.pdf', '')}`;
    }

    // 3. Cari tanggal surat
    const tanggalMatch = text.match(
      /(\d{1,2}\s+(?:Januari|Februari|Maret|April|Mei|Juni|Juli|Agustus|September|Oktober|November|Desember|Jan|Feb|Mar|Apr|Mei|Jun|Jul|Ags|Sep|Okt|Nov|Des)\s+\d{4})/i
    );
    const tanggalSurat = tanggalMatch ? tanggalMatch[1].trim() : this.getTodayFormatted();

    // 4. Cari hal/perihal
    const halMatch = text.match(/(?:Hal|Perihal|HAL|PERIHAL)\s*[:.]\s*([^\n]+)/i);
    const subject = halMatch ? halMatch[1].trim() : 'Surat Dinas / Undangan Acara';

    // 5. Cari pengirim / instansi
    const instansiMatch = text.match(
      /(?:Kementerian|Direktorat|Dinas|Badan|PT|CV|Dewan|Pengurus|Sekretariat)\s+[A-Za-z0-9\s,.-]+/i
    );
    const asalSurat = instansiMatch ? instansiMatch[0].trim().split('\n')[0].slice(0, 60) : 'Instansi Pengirim';

    // 6. Cari PIC / kontak
    const hpMatch = text.match(/(?:08\d{2}[- ]?\d{4}[- ]?\d{3,4}|\+62\d{2}[- ]?\d{4}[- ]?\d{3,4})/);
    const picPengirim = hpMatch ? `Kontak: ${hpMatch[0]}` : '-';

    // 7. Cari nama acara
    const eventMatch = text.match(
      /(?:Rapat|Audiensi|Seminar|Sosialisasi|Upacara|Lokakarya|Kunjungan|FGD|Bimtek|Kongres|Konferensi)\s+[A-Za-z0-9\s,.-]+/i
    );
    const rawEvent = eventMatch ? eventMatch[0].trim().split('\n')[0].slice(0, 60) : subject;
    const cleanEventName = rawEvent
      .replace(/^(?:permohonan|undangan|surat)\s+(?:memberikan|menghadiri|kehadiran|resmi)?\s*/i, '')
      .replace(/^(?:keynote speech|sambutan|arahan)?\s*(?:pada|dalam rangka)?\s*(?:kegiatan|acara|pembukaan)?\s*/i, '')
      .trim() || rawEvent;

    // 8. Cari tema jika ada
    const temaMatch = text.match(/(?:tema|bertema)\s*[:"']\s*([^"'\n]+)/i);
    const temaAcara = temaMatch ? temaMatch[1].trim() : undefined;

    const data: ExtractedSuratData = {
      kategoriSurat,
      tanggalSurat,
      nomorSurat,
      subject: cleanEventName,
      asalSurat,
      event: cleanEventName,
      picPengirim,
      namaAcara: cleanEventName,
      temaAcara,
      penyelenggara: asalSurat,
      sesiAcara,
      perihal: '',
    };

    // Format perihal berdasarkan template resmi
    data.perihal = formatPerihalByTemplate(data);
    // Samakan isi dari acara seperti yang ada di perihal, templatenya sama
    data.event = data.perihal;
    return data;
  }

  private getTodayFormatted(): string {
    const now = new Date();
    const months = [
      'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
      'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
    ];
    return `${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear()}`;
  }
}

export const aiService = new AiService();
