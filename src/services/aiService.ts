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
  let penyelenggara = (data.penyelenggara || '').trim();
  if (!penyelenggara || penyelenggara === '-') {
    // Jika penyelenggara tidak diisi, periksa apakah asalSurat mengandung instansi atau hanya nama individu
    if (data.asalSurat && !data.asalSurat.includes(' - ')) {
      penyelenggara = data.asalSurat.trim();
    } else {
      penyelenggara = 'Penyelenggara';
    }
  }
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

/**
 * Memformat dan merapikan kolom Asal Surat:
 * Format WAJIB: "Nama Pengirim - Jabatan" (nama individu/pejabat yang bertanda tangan di paling bawah, bukan instansi)
 */
export function formatAsalSurat(raw: string, fallbackJabatan?: string): string {
  if (!raw || raw.trim() === '-' || raw.trim() === '') return '-';
  let clean = raw.trim().replace(/^[\*•\-\s]+/, '');

  // Jika sudah berformat "Nama - Jabatan"
  if (clean.includes(' - ')) {
    const parts = clean.split(' - ');
    const name = parts[0].trim();
    const jabatan = parts.slice(1).join(' - ').trim();
    if (name && jabatan) {
      return `${name} - ${jabatan}`.slice(0, 220);
    }
  }

  // Jika dipisah dengan koma dan jabatan terdeteksi
  const commaJabatanMatch = clean.match(
    /^([^,]+),\s*(Menteri|Wakil Menteri|Sekretaris|Direktur|Kepala|Ketua|Rektor|Dekan|Pimpinan|Deputi|Manager|General Manager|Presiden|Bupati|Walikota|Gubernur|Koordinator|Kuasa)(.*)$/i
  );
  if (commaJabatanMatch) {
    return `${commaJabatanMatch[1].trim()} - ${commaJabatanMatch[2]}${commaJabatanMatch[3]}`.trim().slice(0, 220);
  }

  // Jika ada fallbackJabatan dan belum ada strip
  if (fallbackJabatan && fallbackJabatan !== '-' && !clean.includes(' - ')) {
    return `${clean} - ${fallbackJabatan}`.slice(0, 220);
  }

  return clean.slice(0, 220);
}

/**
 * Menghasilkan ringkasan padat untuk kolom Subject (maksimal 200 karakter)
 * yang diringkas secara cerdas dari Perihal resmi yang telah di-generate sebelumnya.
 */
export function generateSubjectSummary(perihal: string, data?: Partial<ExtractedSuratData>): string {
  if (!perihal || perihal === '-') return '-';

  const kat = (data?.kategoriSurat || '').toUpperCase();
  const namaAcara = (data?.namaAcara || '').trim();
  const penyelenggara = (data?.penyelenggara || '').trim();

  let summary = '';

  switch (kat) {
    case 'UND': {
      if (namaAcara) {
        summary = `Undangan Menghadiri ${namaAcara}`;
        if (penyelenggara && (summary + ` - ${penyelenggara}`).length <= 190) {
          summary += ` - ${penyelenggara}`;
        }
      }
      break;
    }
    case 'PH': {
      const sesi = data?.sesiAcara && data.sesiAcara !== '-' ? data.sesiAcara.trim() : 'Sambutan dan Arahan';
      if (namaAcara) {
        summary = `Permohonan ${sesi} pada ${namaAcara}`;
        if (penyelenggara && (summary + ` - ${penyelenggara}`).length <= 190) {
          summary += ` - ${penyelenggara}`;
        }
      }
      break;
    }
    case 'UNR': {
      const m1 = (data?.mempelai1 || '').replace(/\s*\(.*?\)/g, '').trim();
      const m2 = (data?.mempelai2 || '').replace(/\s*\(.*?\)/g, '').trim();
      if (m1 && m2) {
        summary = `Undangan Pernikahan ${m1} dengan ${m2}`;
      } else {
        summary = perihal.replace(/\s*\(Putr[ai][^\)]+\)/gi, '').trim();
      }
      break;
    }
    case 'AU': {
      const pokok = data?.pokokBahasan && data.pokokBahasan !== '-' ? data.pokokBahasan.trim() : '';
      if (penyelenggara && pokok) {
        summary = `Audiensi ${penyelenggara} terkait ${pokok}`;
      } else if (penyelenggara) {
        summary = `Permohonan Audiensi dari ${penyelenggara}`;
      }
      break;
    }
    case 'WR': {
      const pokok = data?.pokokBahasan && data.pokokBahasan !== '-' ? data.pokokBahasan.trim() : '';
      if (penyelenggara && pokok) {
        summary = `Wawancara ${penyelenggara} terkait ${pokok}`;
      } else if (penyelenggara) {
        summary = `Permohonan Wawancara dari ${penyelenggara}`;
      }
      break;
    }
    case 'TAP': {
      const rangka = data?.rangkaUcapan && data.rangkaUcapan !== '-' ? data.rangkaUcapan.trim() : '';
      if (rangka) {
        summary = `Video Ucapan dalam rangka ${rangka}`;
      }
      break;
    }
    default:
      break;
  }

  // Jika formula kategori di atas belum menghasilkan summary, buat dari perihal dengan memotong frasa tema berlebih
  if (!summary) {
    summary = perihal
      .replace(/\s+dengan tema\s+"[^"]+"/i, '')
      .replace(/\s+dengan tema\s+[^\s,]+/i, '')
      .trim();
  }

  // Bersihkan spasi ganda
  summary = summary.replace(/\s+/g, ' ').trim();

  // Pastikan maksimal 200 karakter
  if (summary.length > 200) {
    summary = summary.slice(0, 197).trim() + '...';
  }

  return summary || perihal.slice(0, 200);
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
   - "namaPengirim": "nama lengkap orang/pejabat pengirim yang menandatangani surat di bagian paling bawah surat beserta gelarnya jika ada (CONTOH: 'Dr. Ir. Rudy Salahuddin, MEM' atau 'Budi Santoso, S.E.'). BUKAN instansi!"
   - "jabatanPengirim": "jabatan resmi orang/pejabat yang menandatangani surat di bagian paling bawah surat (CONTOH: 'Deputi Bidang Koordinasi Ekonomi Digital' atau 'Direktur Utama' atau 'Ketua Umum'). BUKAN instansi!"
   - "asalSurat": "gabungan nama pengirim yang bertanda tangan di paling bawah dan jabatannya dengan format 'Nama Pengirim - Jabatan' (CONTOH: 'Dr. Ir. Rudy Salahuddin, MEM - Deputi Bidang Koordinasi Ekonomi Digital' atau 'Budi Santoso - Direktur Utama'). ATURAN MUTLAK: Isi asal surat BUKAN instansi pengirim, melainkan NAMA PENGIRIM YANG BERTANDA TANGAN DI PALING BAWAH dengan format 'Nama Pengirim - Jabatan'!"
   - "penyelenggara": "nama lembaga/instansi/organisasi pengirim atau penyelenggara acara dari KOP SURAT teratas atau stempel resmi (CONTOH: 'Kementerian Koordinator Bidang Perekonomian' atau 'PT Telekomunikasi Indonesia Tbk' atau 'Institut Pertanian Bogor')"
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

          // Format asalSurat: WAJIB nama pengirim yang bertanda tangan di paling bawah: "Nama Pengirim - Jabatan" (bukan instansi)
          let finalAsalSurat = (parsed.asalSurat || '').trim();
          const namaPengirim = (parsed.namaPengirim || '').trim();
          const jabatanPengirim = (parsed.jabatanPengirim || '').trim();

          if (namaPengirim && jabatanPengirim && !finalAsalSurat.includes(' - ')) {
            finalAsalSurat = `${namaPengirim} - ${jabatanPengirim}`;
          } else if (!finalAsalSurat || finalAsalSurat === '-') {
            if (namaPengirim && jabatanPengirim) {
              finalAsalSurat = `${namaPengirim} - ${jabatanPengirim}`;
            } else if (namaPengirim) {
              finalAsalSurat = `${namaPengirim} - Pengirim`;
            } else {
              finalAsalSurat = '-';
            }
          }
          finalAsalSurat = formatAsalSurat(finalAsalSurat, jabatanPengirim);

          const extractedPenyelenggara = (parsed.penyelenggara || '').trim();

          const extracted: ExtractedSuratData = {
            kategoriSurat: kategori,
            alasanKategori: parsed.alasanKategori || '',
            tanggalSurat: parsed.tanggalSurat || this.getTodayFormatted(),
            nomorSurat: parsed.nomorSurat || '-',
            subject: cleanAcara || parsed.subject || 'Surat Masuk',
            asalSurat: finalAsalSurat,
            event: cleanAcara,
            picPengirim: parsed.picPengirim || '-',
            namaAcara: cleanAcara,
            temaAcara: parsed.temaAcara && parsed.temaAcara !== '-' ? parsed.temaAcara : undefined,
            penyelenggara: extractedPenyelenggara && extractedPenyelenggara !== '-' ? extractedPenyelenggara : 'Instansi Terkait',
            sesiAcara: parsed.sesiAcara && parsed.sesiAcara !== '-' ? parsed.sesiAcara : undefined,
            mempelai1: parsed.mempelai1 && parsed.mempelai1 !== '-' ? parsed.mempelai1 : undefined,
            mempelai2: parsed.mempelai2 && parsed.mempelai2 !== '-' ? parsed.mempelai2 : undefined,
            pokokBahasan: parsed.pokokBahasan && parsed.pokokBahasan !== '-' ? parsed.pokokBahasan : undefined,
            rangkaUcapan: parsed.rangkaUcapan && parsed.rangkaUcapan !== '-' ? parsed.rangkaUcapan : undefined,
            perihal: '', // Akan diformat di bawah
          };

          // Format perihal secara ketat mengikuti formula template resmi berdasarkan kategori
          extracted.perihal = formatPerihalByTemplate(extracted);
          // Kolom subject merupakan ringkasan dari isi perihal yang telah digenerate (maks 200 karakter)
          extracted.subject = generateSubjectSummary(extracted.perihal, extracted);
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

    // 5. Cari instansi pengirim pada kop surat untuk penyelenggara
    const instansiMatch = text.match(
      /(?:Kementerian|Direktorat|Dinas|Badan|PT|CV|Dewan|Pengurus|Sekretariat)\s+[A-Za-z0-9\s,.-]+/i
    );
    const penyelenggara = instansiMatch ? instansiMatch[0].trim().split('\n')[0].slice(0, 60) : 'Instansi Terkait';

    // 6. Cari nama pengirim & jabatan yang bertanda tangan di paling bawah surat (Asal Surat: Nama - Jabatan)
    let namaPengirim = '';
    let jabatanPengirim = '';

    const allLines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
    let endIdx = allLines.length;
    for (let i = 0; i < allLines.length; i++) {
      if (/^tembusan\s*[:.]/i.test(allLines[i])) {
        endIdx = i;
        break;
      }
    }

    // Ambil maksimal 25 baris terakhir sebelum tembusan / akhir dokumen
    const signatureLines = allLines.slice(Math.max(0, endIdx - 25), endIdx);

    let nameIdx = -1;
    // Cari baris NIP terlebih dahulu (baris tepat sebelum NIP adalah nama penandatangan)
    for (let i = 0; i < signatureLines.length; i++) {
      const line = signatureLines[i];
      if (/^NIP[\s.:0-9\-]+/i.test(line) && i > 0) {
        const candidateName = signatureLines[i - 1].replace(/[\(\)]/g, '').trim();
        if (candidateName.length >= 3 && !/^(?:ttd|tanda\s+tangan)$/i.test(candidateName)) {
          namaPengirim = candidateName;
          nameIdx = i - 1;
          break;
        }
      }
    }

    // Jika belum ketemu nama dari NIP, cari baris yang mengandung gelar atau nama orang bertanda tangan
    if (!namaPengirim) {
      for (let i = signatureLines.length - 1; i >= 0; i--) {
        const line = signatureLines[i].replace(/[\(\)]/g, '').trim();
        if (/^(?:ttd|tanda\s+tangan|hormat\s+kami|wassalamu|demikian|atas\s+perhatian|catatan|lampiran)/i.test(line)) continue;
        if (/^(?:jalan|jl\.|gedung|telp|fax|email|website|www\.)/i.test(line)) continue;
        if (/^NIP[\s.:0-9\-]+/i.test(line)) continue;

        const hasTitle = /(?:Prof\.|Dr\.|Drs\.|Ir\.|H\.|Hj\.)\s+[A-Z]/i.test(line) ||
          /,\s*(?:S\.[A-Z]+|M\.[A-Z]+|Ph\.D|M\.B\.A|MEM|M\.Si|M\.M|S\.E|S\.H|S\.T|S\.Sos|Sp\.)/i.test(line);
        const isAllCapsName = /^[A-Z\s.,'-]{4,45}$/.test(line) && !/^(?:KEMENTERIAN|DIREKTORAT|DEWAN|SEKRETARIAT|REPUBLIK|INDONESIA|UNIVERSITAS|PEMERINTAH)/i.test(line);

        if (hasTitle || isAllCapsName) {
          namaPengirim = line;
          nameIdx = i;
          break;
        }
      }
    }

    // Cari jabatan penandatangan:
    // Paling akurat adalah baris tepat di sekitar namaPengirim (1-4 baris di atas nama, atau 1-2 baris di bawah)
    const isInstitution = (l: string) =>
      /^(?:kementerian|pemerintah|universitas|institut|politeknik|pt\b|cv\b|yayasan|direktorat\s+jenderal\s+[a-z]+|badan\s+[a-z]+|dinas\s+[a-z]+)/i.test(l);

    const jabatanRegex = /(?:Menteri|Wakil Menteri|Sekretaris Jenderal|Sekjen|Direktur Jenderal|Dirjen|Direktur Utama|Direktur|Kepala Badan|Kepala Dinas|Kepala Biro|Kepala Bagian|Kepala|Ketua Umum|Ketua Panitia|Ketua|Rektor|Dekan|Presiden Direktur|General Manager|Manager|Pimpinan|Deputi|Bupati|Walikota|Gubernur|Koordinator|Kuasa Direksi)/i;

    if (nameIdx !== -1) {
      // 1. Cek baris di ATAS namaPengirim (biasanya ada 'ttd' di antaranya)
      for (let offset = 1; offset <= 4; offset++) {
        const checkIdx = nameIdx - offset;
        if (checkIdx < 0) break;
        const line = signatureLines[checkIdx];
        if (jabatanRegex.test(line) && !isInstitution(line)) {
          let fullJabatan = line.replace(/^(?:a\.n\.|plt\.|pj\.)\s*/i, '').trim();
          // Cek jika baris tepat di bawahnya adalah kelanjutan jabatan (sebelum 'ttd')
          if (checkIdx + 1 < nameIdx) {
            const nextL = signatureLines[checkIdx + 1];
            if (!/^(?:ttd|tanda|hormat|nip)/i.test(nextL) && !jabatanRegex.test(nextL) && nextL.length < 60) {
              fullJabatan += ` ${nextL}`;
            }
          }
          jabatanPengirim = fullJabatan;
          break;
        }
      }

      // 2. Jika tidak ada di atas nama, cek baris di BAWAH namaPengirim (seperti: Budi Santoso \n Direktur Utama)
      if (!jabatanPengirim) {
        for (let offset = 1; offset <= 3; offset++) {
          const checkIdx = nameIdx + offset;
          if (checkIdx >= signatureLines.length) break;
          const line = signatureLines[checkIdx];
          if (jabatanRegex.test(line) && !isInstitution(line)) {
            jabatanPengirim = line.replace(/^(?:a\.n\.|plt\.|pj\.)\s*/i, '').trim();
            break;
          }
        }
      }
    }

    // Jika belum ketemu di sekitar nama, scan dari bawah ke atas pada signatureLines
    if (!jabatanPengirim) {
      for (let i = signatureLines.length - 1; i >= 0; i--) {
        const line = signatureLines[i];
        if (jabatanRegex.test(line) && line !== namaPengirim && !isInstitution(line)) {
          jabatanPengirim = line.replace(/^(?:a\.n\.|plt\.|pj\.)\s*/i, '').trim();
          break;
        }
      }
    }

    // Susun format WAJIB: "Nama Pengirim - Jabatan"
    let asalSurat = '-';
    if (namaPengirim && jabatanPengirim) {
      asalSurat = `${namaPengirim} - ${jabatanPengirim}`;
    } else if (namaPengirim) {
      asalSurat = `${namaPengirim} - Pengirim`;
    } else if (jabatanPengirim) {
      asalSurat = `Pengirim - ${jabatanPengirim}`;
    } else {
      asalSurat = `Pimpinan - ${penyelenggara}`;
    }
    asalSurat = formatAsalSurat(asalSurat);

    // 7. Cari PIC / kontak
    const hpMatch = text.match(/(?:08\d{2}[- ]?\d{4}[- ]?\d{3,4}|\+62\d{2}[- ]?\d{4}[- ]?\d{3,4})/);
    const picPengirim = hpMatch ? `Kontak: ${hpMatch[0]}` : '-';

    // 8. Cari nama acara
    const eventMatch = text.match(
      /(?:Rapat|Audiensi|Seminar|Sosialisasi|Upacara|Lokakarya|Kunjungan|FGD|Bimtek|Kongres|Konferensi)\s+[A-Za-z0-9\s,.-]+/i
    );
    const rawEvent = eventMatch ? eventMatch[0].trim().split('\n')[0].slice(0, 60) : subject;
    const cleanEventName = rawEvent
      .replace(/^(?:permohonan|undangan|surat)\s+(?:memberikan|menghadiri|kehadiran|resmi)?\s*/i, '')
      .replace(/^(?:keynote speech|sambutan|arahan)?\s*(?:pada|dalam rangka)?\s*(?:kegiatan|acara|pembukaan)?\s*/i, '')
      .trim() || rawEvent;

    // 9. Cari tema jika ada
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
      penyelenggara,
      sesiAcara,
      perihal: '',
    };

    // Format perihal berdasarkan template resmi
    data.perihal = formatPerihalByTemplate(data);
    // Kolom subject merupakan ringkasan dari isi perihal (maks 200 karakter)
    data.subject = generateSubjectSummary(data.perihal, data);
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
