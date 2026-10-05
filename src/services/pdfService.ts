import fs from 'fs';
import path from 'path';
import { PDFParse } from 'pdf-parse';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { PDFDocument, PageSizes } from 'pdf-lib';
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

  /**
   * Menggabungkan lembar disposisi (PDF / gambar) dengan berkas surat masuk asli.
   * Lembar disposisi diletakkan di halaman pertama (halaman 1),
   * diikuti seluruh halaman berkas surat masuk (halaman 2 dst).
   * Berkas hasil penggabungan disimpan ke folder storage/dispositions/.
   *
   * @param dispositionPath Path file lembar disposisi sementara (bisa PDF atau gambar JPG/PNG)
   * @param letterFileName Nama berkas surat masuk di folder storage/letters
   * @param finalDispositionFileName Nama berkas final yang akan disimpan di storage/dispositions
   * @returns Object berisi targetPath dan finalFileName (.pdf)
   */
  public async mergeDispositionWithLetterPdf(
    dispositionPath: string,
    letterFileName: string | null | undefined,
    finalDispositionFileName: string
  ): Promise<{ targetPath: string; finalFileName: string }> {
    const uploadDir = ENV.DISPOSITION_STORAGE_PATH;
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    // Pastikan berkas hasil penggabungan selalu berekstensi .pdf
    const cleanFinalFileName = finalDispositionFileName.replace(/\.[^.]+$/, '') + '.pdf';
    const targetPath = path.join(uploadDir, cleanFinalFileName);

    try {
      const mergedDoc = await PDFDocument.create();

      // 1. Masukkan Lembar Disposisi di Halaman Pertama (halaman 1, dst jika multi-halaman)
      if (fs.existsSync(dispositionPath)) {
        const dispExt = path.extname(dispositionPath).toLowerCase();
        if (dispExt === '.pdf') {
          try {
            const dispBuffer = fs.readFileSync(dispositionPath);
            const dispDoc = await PDFDocument.load(dispBuffer, { ignoreEncryption: true });
            const dispPages = await mergedDoc.copyPages(dispDoc, dispDoc.getPageIndices());
            dispPages.forEach((p) => mergedDoc.addPage(p));
            console.log(`[PdfService] Menambahkan ${dispPages.length} halaman lembar disposisi (PDF) di awal dokumen.`);
          } catch (dispPdfErr) {
            console.warn('[PdfService] Gagal membaca PDF disposisi langsung:', dispPdfErr);
          }
        } else {
          // Format Gambar (JPG, PNG, JPEG, WEBP, dll.)
          try {
            const img = await loadImage(dispositionPath);
            const canvas = createCanvas(img.width, img.height);
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            const jpgBuffer = canvas.toBuffer('image/jpeg', 90);

            const embeddedImage = await mergedDoc.embedJpg(jpgBuffer);
            const [a4Width, a4Height] = PageSizes.A4;
            const imgDims = embeddedImage.scaleToFit(a4Width - 20, a4Height - 20);

            const page = mergedDoc.addPage(PageSizes.A4);
            page.drawImage(embeddedImage, {
              x: (a4Width - imgDims.width) / 2,
              y: (a4Height - imgDims.height) / 2,
              width: imgDims.width,
              height: imgDims.height,
            });
            console.log(`[PdfService] Lembar disposisi berupa gambar berhasil dikonversi ke halaman 1 PDF A4.`);
          } catch (imgErr) {
            console.warn('[PdfService] Gagal me-render gambar disposisi ke PDF:', imgErr);
          }
        }
      } else {
        console.warn(`[PdfService] Berkas lembar disposisi tidak ditemukan pada path: ${dispositionPath}`);
      }

      // 2. Masukkan Seluruh Halaman Berkas Surat Masuk Asli (Halaman 2 dst)
      let letterFilePath: string | null = null;
      if (letterFileName && letterFileName !== '-' && letterFileName.trim().length > 0) {
        const candidatePaths = [
          path.join(ENV.UPLOAD_STORAGE_PATH, letterFileName),
          path.join(ENV.PRIVATE_STORAGE_PATH, letterFileName),
          path.join(process.cwd(), 'storage', 'letters', letterFileName),
          path.join(process.cwd(), 'storage', 'private', letterFileName),
        ];

        for (const cp of candidatePaths) {
          if (fs.existsSync(cp)) {
            letterFilePath = cp;
            break;
          }
        }
      }

      if (letterFilePath && fs.existsSync(letterFilePath)) {
        const letterExt = path.extname(letterFilePath).toLowerCase();
        if (letterExt === '.pdf') {
          try {
            const letterBuffer = fs.readFileSync(letterFilePath);
            const letterDoc = await PDFDocument.load(letterBuffer, { ignoreEncryption: true });
            const letterPages = await mergedDoc.copyPages(letterDoc, letterDoc.getPageIndices());
            letterPages.forEach((p) => mergedDoc.addPage(p));
            console.log(`[PdfService] Berhasil menyisipkan ${letterPages.length} halaman surat masuk ke dokumen gabungan.`);
          } catch (letterLoadErr) {
            console.warn(`[PdfService] Gagal memuat PDF surat (${letterFilePath}):`, letterLoadErr);
          }
        } else {
          // Jika berkas surat berupa gambar
          try {
            const img = await loadImage(letterFilePath);
            const canvas = createCanvas(img.width, img.height);
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            const jpgBuffer = canvas.toBuffer('image/jpeg', 90);

            const embeddedImage = await mergedDoc.embedJpg(jpgBuffer);
            const [a4Width, a4Height] = PageSizes.A4;
            const imgDims = embeddedImage.scaleToFit(a4Width - 20, a4Height - 20);

            const page = mergedDoc.addPage(PageSizes.A4);
            page.drawImage(embeddedImage, {
              x: (a4Width - imgDims.width) / 2,
              y: (a4Height - imgDims.height) / 2,
              width: imgDims.width,
              height: imgDims.height,
            });
            console.log(`[PdfService] Halaman gambar surat berhasil disisipkan ke PDF gabungan.`);
          } catch (imgSuratErr) {
            console.warn('[PdfService] Gagal menyisipkan gambar surat ke PDF:', imgSuratErr);
          }
        }
      } else {
        console.warn(`[PdfService] Berkas surat masuk (${letterFileName}) tidak ditemukan di lokal server. PDF hanya memuat lembar disposisi.`);
      }

      // Pastikan ada setidaknya 1 halaman jika kedua sumber kosong/gagal
      if (mergedDoc.getPageCount() === 0) {
        mergedDoc.addPage(PageSizes.A4);
      }

      // 3. Simpan PDF hasil penggabungan
      const mergedPdfBytes = await mergedDoc.save();
      fs.writeFileSync(targetPath, Buffer.from(mergedPdfBytes));
      console.log(`[PdfService] Dokumen gabungan disposisi & surat berhasil disimpan di: ${targetPath} (${mergedDoc.getPageCount()} halaman).`);

      // 4. Hapus file temporary lembar disposisi jika ada di temp folder
      if (dispositionPath !== targetPath && fs.existsSync(dispositionPath)) {
        this.deleteTempPdf(dispositionPath);
      }

      return {
        targetPath,
        finalFileName: cleanFinalFileName,
      };
    } catch (mergeErr: any) {
      console.error('[PdfService] Terjadi kesalahan saat menggabungkan disposisi dan surat:', mergeErr);
      // Fallback aman: jika merge gagal, pindahkan file asli disposisi menggunakan moveToDispositionStorage
      const fallbackPath = this.moveToDispositionStorage(dispositionPath, cleanFinalFileName);
      return {
        targetPath: fallbackPath,
        finalFileName: cleanFinalFileName,
      };
    }
  }
}

export const pdfService = new PdfService();
