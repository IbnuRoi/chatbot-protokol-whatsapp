import fs from 'fs';
import path from 'path';
import { ENV } from '../config/env';
import { ExtractedSuratData, ExtractedDisposisiData } from './sessionService';
import { NluResult, NluIntent, NluEntities } from './nluService';

export interface GatsuAiHealthResponse {
  status: string;
  uptime?: number;
  memory?: any;
  timestamp?: string;
  [key: string]: any;
}

export class GatsuAiClient {
  private baseUrl: string;
  private secretKey: string;
  private timeoutMs: number;

  constructor() {
    this.baseUrl = ENV.AI_SERVICE_URL;
    this.secretKey = ENV.AI_SERVICE_SECRET_KEY;
    this.timeoutMs = ENV.AI_SERVICE_TIMEOUT_MS;
  }

  private getHeaders(contentType?: string): Record<string, string> {
    const headers: Record<string, string> = {};
    if (this.secretKey) {
      headers['Authorization'] = `Bearer ${this.secretKey}`;
    }
    if (contentType) {
      headers['Content-Type'] = contentType;
    }
    return headers;
  }

  private detectMimeType(filePathOrName: string): string {
    const ext = path.extname(filePathOrName).toLowerCase();
    switch (ext) {
      case '.pdf':
        return 'application/pdf';
      case '.jpg':
      case '.jpeg':
        return 'image/jpeg';
      case '.png':
        return 'image/png';
      case '.webp':
        return 'image/webp';
      default:
        return 'application/octet-stream';
    }
  }

  /**
   * Health probe ke gatsu-ai-service (liveness / readiness)
   */
  public async checkHealth(): Promise<GatsuAiHealthResponse | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    try {
      const res = await fetch(`${this.baseUrl}/health`, {
        method: 'GET',
        signal: controller.signal,
      });

      if (!res.ok) {
        // Coba alternatif /api/v1/health
        const altRes = await fetch(`${this.baseUrl}/api/v1/health`, {
          method: 'GET',
          signal: controller.signal,
        });
        if (altRes.ok) {
          return (await altRes.json()) as GatsuAiHealthResponse;
        }
        return null;
      }

      return (await res.json()) as GatsuAiHealthResponse;
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Ekstraksi Surat Masuk (PDF Digital, PDF Scan, atau Foto)
   * Memanggil POST /api/v1/extract/letter
   */
  public async extractLetter(
    fileInput: string | Buffer,
    originalFileName?: string,
    explicitMimeType?: string
  ): Promise<ExtractedSuratData> {
    const fileName = originalFileName || (typeof fileInput === 'string' ? path.basename(fileInput) : 'document.pdf');
    const mimeType = explicitMimeType || this.detectMimeType(fileName);

    let fileBuffer: Buffer;
    if (typeof fileInput === 'string') {
      if (!fs.existsSync(fileInput)) {
        throw new Error(`File tidak ditemukan di path: ${fileInput}`);
      }
      fileBuffer = fs.readFileSync(fileInput);
    } else {
      fileBuffer = fileInput;
    }

    const formData = new FormData();
    const blob = new Blob([new Uint8Array(fileBuffer)], { type: mimeType });
    formData.append('file', blob, fileName);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      console.log(`[GatsuAiClient] Mengirim dokumen '${fileName}' (${fileBuffer.length} bytes) ke ${this.baseUrl}/api/v1/extract/letter...`);

      const response = await fetch(`${this.baseUrl}/api/v1/extract/letter`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: formData,
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`Gatsu AI Service HTTP ${response.status} ${response.statusText}: ${errorText.slice(0, 300)}`);
      }

      const jsonResponse: any = await response.json();
      const rawData = jsonResponse?.data || jsonResponse;

      console.log(`✅ [GatsuAiClient] Ekstraksi surat berhasil dari gatsu-ai-service! (Status: ${jsonResponse?.status || 'OK'})`);

      return this.mapToExtractedSuratData(rawData);
    } catch (err: any) {
      if (err.name === 'AbortError') {
        throw new Error(`Gatsu AI Service request timeout setelah ${this.timeoutMs}ms.`);
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Ekstraksi Lembar Disposisi
   * Memanggil POST /api/v1/extract/disposition
   */
  public async extractDisposition(
    fileInput: string | Buffer,
    originalFileName?: string,
    explicitMimeType?: string
  ): Promise<ExtractedDisposisiData> {
    const fileName = originalFileName || (typeof fileInput === 'string' ? path.basename(fileInput) : 'disposition.pdf');
    const mimeType = explicitMimeType || this.detectMimeType(fileName);

    let fileBuffer: Buffer;
    if (typeof fileInput === 'string') {
      if (!fs.existsSync(fileInput)) {
        throw new Error(`File tidak ditemukan di path: ${fileInput}`);
      }
      fileBuffer = fs.readFileSync(fileInput);
    } else {
      fileBuffer = fileInput;
    }

    const formData = new FormData();
    const blob = new Blob([new Uint8Array(fileBuffer)], { type: mimeType });
    formData.append('file', blob, fileName);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      console.log(`[GatsuAiClient] Mengirim berkas disposisi '${fileName}' ke ${this.baseUrl}/api/v1/extract/disposition...`);

      const response = await fetch(`${this.baseUrl}/api/v1/extract/disposition`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: formData,
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`Gatsu AI Service HTTP ${response.status} ${response.statusText}: ${errorText.slice(0, 300)}`);
      }

      const jsonResponse: any = await response.json();
      const rawData = jsonResponse?.data || jsonResponse;

      console.log(`✅ [GatsuAiClient] Ekstraksi lembar disposisi berhasil dari gatsu-ai-service!`);

      return this.mapToExtractedDisposisiData(rawData);
    } catch (err: any) {
      if (err.name === 'AbortError') {
        throw new Error(`Gatsu AI Service request timeout setelah ${this.timeoutMs}ms.`);
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * NLU & Analisis Intent
   * Memanggil POST /api/v1/nlu/analyze
   */
  public async analyzeNlu(text: string, sessionHistory?: string[]): Promise<NluResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
      const response = await fetch(`${this.baseUrl}/api/v1/nlu/analyze`, {
        method: 'POST',
        headers: this.getHeaders('application/json'),
        body: JSON.stringify({
          text,
          sessionHistory: sessionHistory || [],
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`Gatsu AI NLU HTTP ${response.status}: ${errorText.slice(0, 200)}`);
      }

      const jsonResponse: any = await response.json();
      const data = jsonResponse?.data || jsonResponse;

      return {
        intent: (data.intent || 'UNKNOWN') as NluIntent,
        confidence: typeof data.confidence === 'number' ? data.confidence : 0.9,
        conversationalReply: data.conversationalReply || data.reply || '',
        entities: (data.entities || {}) as NluEntities,
      };
    } catch (err: any) {
      if (err.name === 'AbortError') {
        throw new Error(`Gatsu AI NLU timeout setelah 10000ms.`);
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Tanya-jawab Asisten Protokol
   * Memanggil POST /api/v1/chat atau POST /chat
   */
  public async chat(message: string, sessionId?: string): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
      const response = await fetch(`${this.baseUrl}/api/v1/chat`, {
        method: 'POST',
        headers: this.getHeaders('application/json'),
        body: JSON.stringify({
          message,
          sessionId: sessionId || 'default_session',
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`Gatsu AI Chat HTTP ${response.status}: ${errorText.slice(0, 200)}`);
      }

      const jsonResponse: any = await response.json();
      return jsonResponse?.data?.reply || jsonResponse?.reply || jsonResponse?.message || '';
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Helper pemetaan payload gatsu-ai-service ke model ExtractedSuratData lokal
   */
  private mapToExtractedSuratData(raw: any): ExtractedSuratData {
    // Tangani camelCase maupun snake_case
    const tanggalSurat = raw.tanggalSurat || raw.tanggal_surat || '-';
    const nomorSurat = raw.nomorSurat || raw.nomor_surat || '-';
    const subject = raw.subject || raw.perihal || '-';
    const asalSurat = raw.asalSurat || raw.asal_surat || raw.instansi || '-';
    const event = raw.event || raw.namaAcara || raw.nama_acara || raw.namaKegiatan || '-';
    const picPengirim = raw.picPengirim || raw.pic_pengirim || raw.pic || '-';
    const perihal = raw.perihal || raw.subject || '-';

    return {
      tanggalSurat,
      nomorSurat,
      subject,
      asalSurat,
      event,
      picPengirim,
      perihal,
      kategoriSurat: raw.kategoriSurat || raw.kategori_surat,
      alasanKategori: raw.alasanKategori || raw.alasan_kategori,
      namaAcara: raw.namaAcara || raw.nama_acara || event,
      temaAcara: raw.temaAcara || raw.tema_acara,
      penyelenggara: raw.penyelenggara || asalSurat,
      sesiAcara: raw.sesiAcara || raw.sesi_acara,
      mempelai1: raw.mempelai1,
      mempelai2: raw.mempelai2,
      pokokBahasan: raw.pokokBahasan || raw.pokok_bahasan,
      rangkaUcapan: raw.rangkaUcapan || raw.rangka_ucapan,
      picName: raw.picName || raw.pic_name,
      picPhoneNumber: raw.picPhoneNumber || raw.pic_phone_number || raw.pic_phonenumber,
      dateEvent: raw.dateEvent || raw.date_event || raw.tanggalKegiatan || raw.tanggal_kegiatan,
      timeEvent: raw.timeEvent || raw.time_event || raw.waktuKegiatan || raw.waktu_kegiatan,
      placeEvent: raw.placeEvent || raw.place_event || raw.tempatKegiatan || raw.tempat_kegiatan || raw.lokasi,
    };
  }

  /**
   * Helper pemetaan payload gatsu-ai-service ke model ExtractedDisposisiData lokal
   */
  private mapToExtractedDisposisiData(raw: any): ExtractedDisposisiData {
    return {
      nomorAgenda: raw.nomorAgenda || raw.nomor_agenda || '-',
      nomorSurat: raw.nomorSurat || raw.nomor_surat || '-',
      tanggalSurat: raw.tanggalSurat || raw.tanggal_surat || '-',
      sifat: raw.sifat || 'Biasa',
      asalSurat: raw.asalSurat || raw.asal_surat || '-',
      perihal: raw.perihal || raw.subject || '-',
      tanggalAcara: raw.tanggalAcara || raw.tanggal_acara || raw.tanggalKegiatan || raw.tanggal_kegiatan,
      waktuAcara: raw.waktuAcara || raw.waktu_acara || raw.waktuKegiatan || raw.waktu_kegiatan,
      tempatAcara: raw.tempatAcara || raw.tempat_acara || raw.tempatKegiatan || raw.tempat_kegiatan,
      tanggalDisposisi: raw.tanggalDisposisi || raw.tanggal_disposisi || '-',
      pemberiDisposisi: raw.pemberiDisposisi || raw.pemberi_disposisi || '-',
      namaPemberiDisposisi: raw.namaPemberiDisposisi || raw.nama_pemberi_disposisi || '-',
      diteruskanKepada: Array.isArray(raw.diteruskanKepada)
        ? raw.diteruskanKepada
        : Array.isArray(raw.diteruskan_kepada)
        ? raw.diteruskan_kepada
        : [],
      arahanDisposisi: Array.isArray(raw.arahanDisposisi)
        ? raw.arahanDisposisi
        : Array.isArray(raw.arahan_disposisi)
        ? raw.arahan_disposisi
        : [],
      catatan: raw.catatan || '-',
    };
  }
}

export const gatsuAiClient = new GatsuAiClient();
