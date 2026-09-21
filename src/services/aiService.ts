import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';
import { ENV } from '../config/env';
import { ExtractedSuratData } from './sessionService';

export class AiService {
  private genAiClient: GoogleGenAI | null = null;
  private openAiClient: OpenAI | null = null;

  constructor() {
    this.initClients();
  }

  private initClients(): void {
    const apiKey = (ENV.PDF_EXTRACTION_API_KEY || ENV.GEMINI_API_KEY || '').trim();
    if (!apiKey) return;

    const provider = (ENV.PDF_EXTRACTION_PROVIDER || '').toLowerCase();

    if (provider === 'openrouter' || apiKey.startsWith('sk-')) {
      this.openAiClient = new OpenAI({
        baseURL: 'https://openrouter.ai/api/v1',
        apiKey,
        timeout: 25000,
        defaultHeaders: {
          'HTTP-Referer': 'https://kemnaker.go.id',
          'X-Title': 'Kemnaker Protokol PDF Extractor',
        },
      });
    } else {
      this.genAiClient = new GoogleGenAI({ apiKey });
    }
  }

  /**
   * Ekstraksi metadata surat dari teks dokumen
   */
  public async extractSuratData(pdfText: string, originalFileName?: string): Promise<ExtractedSuratData> {
    return this.extractDocumentMetadata(pdfText, originalFileName);
  }

  public async extractDocumentMetadata(pdfText: string, originalFileName?: string): Promise<ExtractedSuratData> {
    const model = ENV.PDF_EXTRACTION_MODEL || 'gemini-2.5-flash';

    // 1. Coba ekstraksi menggunakan AI jika API key tersedia
    if ((this.genAiClient || this.openAiClient) && pdfText.trim().length > 20) {
      try {
        const prompt = `Anda adalah asisten AI Protokol Kementerian Ketenagakerjaan (Kemnaker) yang bertugas mengekstrak data dari dokumen surat resmi.
Analisis teks surat berikut dan ekstrak entitas ke dalam format JSON murni tanpa markdown formatting (tanpa \`\`\`json):
{
  "tanggalSurat": "tanggal surat (contoh: 8 September 2026 atau YYYY-MM-DD)",
  "nomorSurat": "nomor registrasi surat resmi",
  "subject": "pokok isi / judul / hal surat",
  "asalSurat": "nama instansi, organisasi, atau pejabat pengirim surat",
  "event": "nama acara/kegiatan yang disebutkan di dalam surat jika ada (atau '-' jika tidak ada)",
  "picPengirim": "nama PIC dan kontak telepon/email pengirim jika ada (atau '-' jika tidak ada)",
  "perihal": "ringkasan perihal surat resmi yang ringkas dan padat"
}

TEKS SURAT:
${pdfText.slice(0, 5000)}
`;

        let rawText = '';
        if (this.openAiClient) {
          const res = await this.openAiClient.chat.completions.create({
            model,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.1,
            max_tokens: 1000,
          });
          rawText = res.choices?.[0]?.message?.content || '';
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
          return {
            tanggalSurat: parsed.tanggalSurat || this.getTodayFormatted(),
            nomorSurat: parsed.nomorSurat || '-',
            subject: parsed.subject || 'Surat Masuk',
            asalSurat: parsed.asalSurat || '-',
            event: parsed.event || '-',
            picPengirim: parsed.picPengirim || '-',
            perihal: parsed.perihal || parsed.subject || '-',
          };
        }
      } catch (err) {
        console.warn(`[AiService] Ekstraksi via AI (${model}) gagal, menggunakan fallback parser:`, err);
      }
    }

    // 2. Fallback Rule-Based Parser (Jika AI Key kosong atau offline)
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
    const model = ENV.PDF_EXTRACTION_MODEL || 'gemini-2.5-flash';

    if (this.genAiClient || this.openAiClient) {
      try {
        const prompt = `Anda adalah ahli protokol kemnaker. Buatkan rumusan "Perihal" resmi, singkat, dan baku (maksimal 15 kata) untuk surat dinas dengan informasi berikut:
- Pengirim: ${context.asalSurat}
- Subjek/Hal: ${context.subject}
- Agenda/Event: ${context.event || '-'}

Hanya balas dengan satu kalimat perihal saja tanpa tanda kutip atau penjelasan tambahan.`;

        let perihal = '';
        if (this.openAiClient) {
          const res = await this.openAiClient.chat.completions.create({
            model,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.1,
            max_tokens: 150,
          });
          perihal = (res.choices?.[0]?.message?.content || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
        } else if (this.genAiClient) {
          const response = await this.genAiClient.models.generateContent({
            model,
            contents: prompt,
          });
          perihal = (response.text || '').trim();
        }

        if (perihal) {
          perihal = perihal.replace(/^["']|["']$/g, '').trim();
          return perihal;
        }
      } catch (err) {
        console.warn(`[AiService] Rekomendasi perihal AI (${model}) gagal, menggunakan format baku:`, err);
      }
    }

    // Fallback format baku
    if (context.event && context.event !== '-') {
      return `${context.subject} pada ${context.event} (${context.asalSurat})`;
    }
    return `${context.subject} dari ${context.asalSurat}`;
  }

  /**
   * Ekstraksi berbasis aturan regex/heuristik untuk dokumen teks
   */
  private fallbackRuleBasedExtraction(text: string, fileName?: string): ExtractedSuratData {
    // Cari nomor surat
    const nomorMatch = text.match(/(?:Nomor|No|NOMOR|NO)\s*[:.]\s*([A-Za-z0-9\/\.\-_ ]+)/i);
    const nomorSurat = nomorMatch ? nomorMatch[1].split('\n')[0].trim() : (fileName ? `REF-${fileName.replace('.pdf', '')}` : 'B-001/REG/2026');

    // Cari tanggal surat
    const tanggalMatch = text.match(/(\d{1,2}\s+(?:Januari|Februari|Maret|April|Mei|Juni|Juli|Agustus|September|Oktober|November|Desember|Jan|Feb|Mar|Apr|Mei|Jun|Jul|Ags|Sep|Okt|Nov|Des)\s+\d{4})/i);
    const tanggalSurat = tanggalMatch ? tanggalMatch[1].trim() : this.getTodayFormatted();

    // Cari hal/perihal
    const halMatch = text.match(/(?:Hal|Perihal|HAL|PERIHAL)\s*[:.]\s*([^\n]+)/i);
    const subject = halMatch ? halMatch[1].trim() : 'Surat Dinas / Undangan Acara';

    // Cari pengirim / instansi
    const instansiMatch = text.match(/(?:Kementerian|Direktorat|Dinas|Badan|PT|CV|Dewan|Pengurus|Sekretariat)\s+[A-Za-z0-9\s,.-]+/i);
    const asalSurat = instansiMatch ? instansiMatch[0].trim().split('\n')[0].slice(0, 60) : 'Instansi Pengirim';

    // Cari PIC / kontak
    const hpMatch = text.match(/(?:08\d{2}[- ]?\d{4}[- ]?\d{3,4}|\+62\d{2}[- ]?\d{4}[- ]?\d{3,4})/);
    const picPengirim = hpMatch ? `Kontak: ${hpMatch[0]}` : '-';

    // Cari nama acara jika ada
    const eventMatch = text.match(/(?:Rapat|Audiensi|Seminar|Sosialisasi|Upacara|Lokakarya|Kunjungan|FGD|Bimtek)\s+[A-Za-z0-9\s,.-]+/i);
    const event = eventMatch ? eventMatch[0].trim().split('\n')[0].slice(0, 50) : '-';

    return {
      tanggalSurat,
      nomorSurat,
      subject,
      asalSurat,
      event,
      picPengirim,
      perihal: subject,
    };
  }

  private getTodayFormatted(): string {
    const now = new Date();
    const months = [
      'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
      'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
    ];
    return `${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear()}`;
  }
}

export const aiService = new AiService();
