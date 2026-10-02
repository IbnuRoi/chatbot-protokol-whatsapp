import fs from 'fs';
import path from 'path';
import { ENV } from '../config/env';
import { pdfService } from './pdfService';

export interface ImageValidationResult {
  isValid: boolean;
  isSafe: boolean;
  errorMessage?: string;
  fileSize?: number;
  filePath?: string;
  mimeType?: string;
}

export class ImageService {
  private readonly MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB

  private readonly SUPPORTED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp']);

  /**
   * Memeriksa validitas dan keamanan berkas gambar
   */
  public async validateAndScanImage(filePath: string, originalFileName: string): Promise<ImageValidationResult> {
    try {
      if (!fs.existsSync(filePath)) {
        return { isValid: false, isSafe: false, errorMessage: 'Berkas gambar tidak ditemukan pada server.' };
      }

      const stats = fs.statSync(filePath);
      const fileSize = stats.size;

      // 1. Cek ukuran file
      if (fileSize === 0) {
        return { isValid: false, isSafe: false, errorMessage: 'Berkas gambar kosong (0 bytes).' };
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
      if (!this.SUPPORTED_EXTENSIONS.has(ext)) {
        return {
          isValid: false,
          isSafe: false,
          errorMessage: 'Format gambar tidak didukung. Mohon kirimkan gambar berformat JPG, JPEG, PNG, atau WEBP.',
        };
      }

      // 3. Cek Magic Bytes
      const buffer = fs.readFileSync(filePath);
      const mimeType = this.detectImageMimeType(buffer, ext);
      if (!mimeType) {
        return {
          isValid: false,
          isSafe: false,
          errorMessage: 'Header berkas tidak valid sebagai gambar asli (corrupted atau format tidak sesuai).',
        };
      }

      return {
        isValid: true,
        isSafe: true,
        fileSize,
        filePath,
        mimeType,
      };
    } catch (err: any) {
      console.error('[ImageService] Error validating image:', err);
      return {
        isValid: false,
        isSafe: false,
        errorMessage: `Gagal memvalidasi berkas gambar: ${err.message}`,
      };
    }
  }

  /**
   * Mendeteksi MIME type dari magic bytes gambar
   */
  public detectImageMimeType(buffer: Buffer, fallbackExt?: string): string | null {
    if (buffer.length < 4) return null;

    // JPEG: FF D8 FF
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
      return 'image/jpeg';
    }

    // PNG: 89 50 4E 47 (0x89 'P' 'N' 'G')
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
      return 'image/png';
    }

    // WEBP: RIFF .... WEBP
    if (
      buffer.length >= 12 &&
      buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buffer.subarray(8, 12).toString('ascii') === 'WEBP'
    ) {
      return 'image/webp';
    }

    // BMP: 42 4D ('BM')
    if (buffer[0] === 0x42 && buffer[1] === 0x4d) {
      return 'image/bmp';
    }

    // Fallback ekstensi jika file valid namun header non-standar
    if (fallbackExt) {
      const extClean = fallbackExt.toLowerCase();
      if (extClean === '.jpg' || extClean === '.jpeg') return 'image/jpeg';
      if (extClean === '.png') return 'image/png';
      if (extClean === '.webp') return 'image/webp';
      if (extClean === '.bmp') return 'image/bmp';
    }

    return null;
  }

  /**
   * Menyimpan buffer gambar ke storage sementara (temp)
   */
  public saveTempImage(buffer: Buffer, originalFileName: string): string {
    const timestamp = Date.now();
    const cleanName = originalFileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const tempFileName = `temp_img_${timestamp}_${cleanName}`;
    const targetPath = path.join(ENV.TEMP_STORAGE_PATH, tempFileName);
    fs.writeFileSync(targetPath, buffer);
    return targetPath;
  }

  /**
   * Menghapus gambar sementara jika proses batal atau setelah dipindahkan
   */
  public deleteTempImage(filePath: string): void {
    pdfService.deleteTempPdf(filePath);
  }

  /**
   * Memindahkan gambar dari temp ke storage upload permanen
   */
  public moveToUploadStorage(tempFilePath: string, finalFileName: string): string {
    return pdfService.moveToUploadStorage(tempFilePath, finalFileName);
  }
}

export const imageService = new ImageService();
