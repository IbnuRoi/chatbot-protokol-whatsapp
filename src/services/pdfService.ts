import fs from 'fs';
import path from 'path';
import { PDFParse } from 'pdf-parse';
import { createCanvas } from '@napi-rs/canvas';
import { ENV } from '../config/env';

export interface PdfValidationResult {
  isValid: boolean;
  isSafe: boolean;
  errorMessage?: string;
  fileSize?: number;
  filePath?: string;
}

export class PdfService {
  private readonly MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB

  /**
   * Memeriksa validitas dan keamanan berkas PDF
   */
  public async validateAndScanPdf(filePath: string, originalFileName: string): Promise<PdfValidationResult> {
    try {
      if (!fs.existsSync(filePath)) {
        return { isValid: false, isSafe: false, errorMessage: 'Berkas tidak ditemukan pada server.' };
      }

      const stats = fs.statSync(filePath);
      const fileSize = stats.size;

      // 1. Cek ukuran file
      if (fileSize === 0) {
        return { isValid: false, isSafe: false, errorMessage: 'Berkas kosong (0 bytes).' };
      }

      if (fileSize > this.MAX_FILE_SIZE_BYTES) {
        return {
          isValid: false,
          isSafe: false,
          errorMessage: `Ukuran berkas melebihi batas maksimum 20 MB (Ukuran: ${(fileSize / 1024 / 1024).toFixed(1)} MB).`,
        };
      }

      // 2. Cek ekstensi
      const ext = path.extname(originalFileName).toLowerCase();
      if (ext !== '.pdf') {
        return { isValid: false, isSafe: false, errorMessage: 'Format berkas tidak didukung. Mohon kirimkan dokumen berformat PDF.' };
      }

      // 3. Cek Magic Bytes (%PDF-)
      const buffer = fs.readFileSync(filePath);
      const header = buffer.subarray(0, 5).toString('ascii');
      if (!header.startsWith('%PDF-')) {
        return { isValid: false, isSafe: false, errorMessage: 'Header berkas tidak valid sebagai dokumen PDF asli.' };
      }

      // 4. Security Scanning (Malware/Exploit check: /Launch, /JavaScript exploit signatures)
      const rawContent = buffer.toString('latin1');
      const suspiciousPatterns = ['/Launch', '/EmbeddedFiles', '/RichMedia', '/JavaScript'];
      for (const pattern of suspiciousPatterns) {
        if (rawContent.includes(pattern)) {
          console.warn(`[Security Alert] Ditemukan pola mencurigakan (${pattern}) pada PDF: ${originalFileName}`);
          // Untuk amannya, kita tandai sebagai peringatan / tolak jika berisi launch executable
          if (pattern === '/Launch') {
            return {
              isValid: true,
              isSafe: false,
              errorMessage: 'Berkas PDF ditolak karena terdeteksi mengandung skrip eksekusi (/Launch) yang berisiko.',
            };
          }
        }
      }

      return {
        isValid: true,
        isSafe: true,
        fileSize,
        filePath,
      };
    } catch (err: any) {
      console.error('Error validating PDF:', err);
      return {
        isValid: false,
        isSafe: false,
        errorMessage: `Gagal memproses validasi berkas: ${err.message}`,
      };
    }
  }

  /**
   * Ekstraksi teks dari dokumen PDF menggunakan pdf-parse
   */
  public async extractText(filePath: string): Promise<string> {
    try {
      const buffer = fs.readFileSync(filePath);
      const parser = new PDFParse({ data: buffer });
      await (parser as any).load();
      const result = await parser.getText();
      const text = result?.text || '';
      return text.trim();
    } catch (err: any) {
      console.error('Error extracting text from PDF:', err);
      return '';
    }
  }

  /**
   * Menyimpan buffer file ke storage sementara (temp)
   */
  public saveTempPdf(buffer: Buffer, originalFileName: string): string {
    const timestamp = Date.now();
    const cleanName = originalFileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const tempFileName = `temp_${timestamp}_${cleanName}`;
    const targetPath = path.join(ENV.TEMP_STORAGE_PATH, tempFileName);
    fs.writeFileSync(targetPath, buffer);
    return targetPath;
  }

  /**
   * Menghapus berkas sementara jika proses batal atau setelah dipindahkan
   */
  public deleteTempPdf(filePath: string): void {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (e) {
      console.error('Gagal menghapus temp PDF:', e);
    }
  }

  /**
   * Memindahkan file dari temp ke storage upload (folder lokal / symlink server)
   */
  public moveToUploadStorage(tempFilePath: string, finalFileName: string): string {
    const uploadDir = ENV.UPLOAD_STORAGE_PATH;
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    const targetPath = path.join(uploadDir, finalFileName);
    if (tempFilePath === targetPath && fs.existsSync(targetPath)) {
      return targetPath;
    }
    if (fs.existsSync(targetPath)) {
      if (fs.existsSync(tempFilePath)) {
        this.deleteTempPdf(tempFilePath);
      }
      return targetPath;
    }
    if (fs.existsSync(tempFilePath)) {
      fs.copyFileSync(tempFilePath, targetPath);
      this.deleteTempPdf(tempFilePath);
    }
    return targetPath;
  }

  /**
   * Memindahkan file lembar disposisi dari temp ke storage disposisi (folder lokal / symlink server)
   */
  public moveToDispositionStorage(tempFilePath: string, finalFileName: string): string {
    const uploadDir = ENV.DISPOSITION_STORAGE_PATH;
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    const targetPath = path.join(uploadDir, finalFileName);
    if (tempFilePath === targetPath && fs.existsSync(targetPath)) {
      return targetPath;
    }
    if (fs.existsSync(targetPath)) {
      if (fs.existsSync(tempFilePath)) {
        this.deleteTempPdf(tempFilePath);
      }
      return targetPath;
    }
    if (fs.existsSync(tempFilePath)) {
      fs.copyFileSync(tempFilePath, targetPath);
      this.deleteTempPdf(tempFilePath);
    }
    return targetPath;
  }

  /**
   * Alias backward-compatible untuk memindahkan file ke storage upload
   */
  public moveToPrivateStorage(tempFilePath: string, finalFileName: string): string {
    return this.moveToUploadStorage(tempFilePath, finalFileName);
  }

  /**
   * Mendeteksi apakah berkas PDF merupakan PDF hasil scan kamera/alat scanner
   * (tidak memiliki layer teks digital yang memadai, melainkan halaman berupa gambar bitmap)
   */
  public async isScannedPdf(filePath: string, text?: string): Promise<boolean> {
    try {
      let rawText = text;
      if (rawText === undefined) {
        rawText = await this.extractText(filePath);
      }
      if (!rawText || !rawText.trim()) return true;

      // Bersihkan dekorasi penomoran halaman dan spasi/karakter whitespace
      const clean = rawText
        .replace(/--\s*\d+\s+of\s+\d+\s*--/gi, '')
        .replace(/page\s*\d+\s*(?:of|\/)\s*\d+/gi, '')
        .replace(/halaman\s*\d+\s*(?:dari|\/)\s*\d+/gi, '')
        .replace(/[\r\n\t\s]+/g, ' ')
        .trim();

      const alphaWords = clean.match(/[a-zA-Z0-9]{2,}/g) || [];

      // Dokumen PDF hasil scan biasanya tidak memiliki teks sama sekali (< 40 karakter atau < 8 kata)
      return clean.length < 40 || alphaWords.length < 8;
    } catch (e) {
      console.error('Error checking if PDF is scanned:', e);
      return false;
    }
  }

  /**
   * Me-render halaman-halaman berkas PDF menjadi berkas gambar JPEG beresolusi tinggi
   * untuk dianalisis oleh Multimodal Vision AI.
   *
   * @param filePath Path berkas PDF
   * @param maxPages Jumlah halaman maksimum yang di-render (default: 2)
   * @param scale Resolusi render (default: 1.5 untuk teks tajam dan jelas)
   */
  public async renderPdfPagesToImages(filePath: string, maxPages = 4, scale = 1.5): Promise<string[]> {
    const renderedPaths: string[] = [];
    try {
      if (!fs.existsSync(filePath)) return [];

      const buffer = fs.readFileSync(filePath);
      const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs').catch(() => import('pdfjs-dist'));

      const doc = await pdfjs.getDocument({
        data: new Uint8Array(buffer),
        useSystemFonts: true,
        disableFontFace: true,
      }).promise;

      const totalPages = doc.numPages || 1;
      const pagesToRender = Math.min(totalPages, maxPages);
      const timestamp = Date.now();
      const baseName = path.basename(filePath, path.extname(filePath)).replace(/[^a-zA-Z0-9_-]/g, '_');

      for (let i = 1; i <= pagesToRender; i++) {
        try {
          const page = await doc.getPage(i);
          const viewport = page.getViewport({ scale });
          const canvas = createCanvas(Math.floor(viewport.width), Math.floor(viewport.height));
          const ctx = canvas.getContext('2d');

          await page.render({
            canvasContext: ctx as any,
            viewport,
          }).promise;

          const imgBuffer = canvas.toBuffer('image/jpeg', 85);
          const tempImgName = `temp_scan_${timestamp}_${baseName}_p${i}.jpg`;
          const tempImgPath = path.join(ENV.TEMP_STORAGE_PATH, tempImgName);
          fs.writeFileSync(tempImgPath, imgBuffer);
          renderedPaths.push(tempImgPath);
        } catch (pageErr) {
          console.warn(`[PdfService] Gagal me-render halaman ${i} dari PDF:`, pageErr);
        }
      }
    } catch (err) {
      console.error('[PdfService] Gagal me-render halaman PDF ke gambar:', err);
    }
    return renderedPaths;
  }

  /**
   * Menghapus berkas gambar sementara hasil render PDF
   */
  public cleanupRenderedPages(imagePaths: string[]): void {
    if (!Array.isArray(imagePaths)) return;
    for (const imgPath of imagePaths) {
      try {
        if (fs.existsSync(imgPath)) {
          fs.unlinkSync(imgPath);
        }
      } catch (err) {
        console.warn(`[PdfService] Gagal menghapus file render sementara (${imgPath}):`, err);
      }
    }
  }
}

export const pdfService = new PdfService();
