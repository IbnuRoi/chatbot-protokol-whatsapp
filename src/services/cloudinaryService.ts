import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';
import fs from 'fs';
import path from 'path';
import { ENV } from '../config/env';

export interface CloudinaryUploadResult {
  success: boolean;
  secureUrl?: string;
  publicId?: string;
  format?: string;
  bytes?: number;
  errorMessage?: string;
}

export class CloudinaryService {
  private initialized = false;

  constructor() {
    this.init();
  }

  /**
   * Inisialisasi konfigurasi Cloudinary
   */
  public init(): void {
    if (ENV.CLOUDINARY_URL && ENV.CLOUDINARY_URL.trim() !== '') {
      cloudinary.config({
        cloudinary_url: ENV.CLOUDINARY_URL.trim(),
      });
      this.initialized = true;
    } else if (
      ENV.CLOUDINARY_CLOUD_NAME &&
      ENV.CLOUDINARY_CLOUD_NAME.trim() !== '' &&
      ENV.CLOUDINARY_API_KEY &&
      ENV.CLOUDINARY_API_KEY.trim() !== '' &&
      ENV.CLOUDINARY_API_SECRET &&
      ENV.CLOUDINARY_API_SECRET.trim() !== ''
    ) {
      cloudinary.config({
        cloud_name: ENV.CLOUDINARY_CLOUD_NAME.trim(),
        api_key: ENV.CLOUDINARY_API_KEY.trim(),
        api_secret: ENV.CLOUDINARY_API_SECRET.trim(),
        secure: true,
      });
      this.initialized = true;
    } else {
      this.initialized = false;
    }
  }

  /**
   * Cek apakah kredensial Cloudinary sudah terkonfigurasi
   */
  public isConfigured(): boolean {
    if (!this.initialized) {
      this.init();
    }
    return this.initialized;
  }

  /**
   * Unggah dokumen (PDF) ke Cloudinary
   * @param filePath Path fisik file di server lokal (temp)
   * @param targetFileName Nama berkas target (misal: 1789617404_6aab64fcf58c5.pdf)
   */
  public async uploadPdf(
    filePath: string,
    targetFileName: string
  ): Promise<CloudinaryUploadResult> {
    try {
      if (!this.isConfigured()) {
        return {
          success: false,
          errorMessage: 'Kredensial Cloudinary belum dikonfigurasi pada berkas .env.',
        };
      }

      if (!fs.existsSync(filePath)) {
        return {
          success: false,
          errorMessage: `Berkas tidak ditemukan: ${filePath}`,
        };
      }

      const cleanBaseName = path.basename(targetFileName);
      const ext = path.extname(cleanBaseName);
      const publicId = ext ? cleanBaseName.slice(0, -ext.length) : cleanBaseName;
      const folder = ENV.CLOUDINARY_FOLDER || 'letters';

      // Gunakan resource_type 'auto' agar berkas PDF memiliki preview visual (image/thumbnail) di dashboard Media Library
      // Sertakan mekanisme retry otomatis jika server Cloudinary sempat merespon 429 (kapasitas sibuk sesaat)
      let lastError: any = null;
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const result: UploadApiResponse = await cloudinary.uploader.upload(filePath, {
            folder,
            public_id: publicId,
            resource_type: 'auto',
            use_filename: false,
            unique_filename: false,
            overwrite: true,
          });

          return {
            success: true,
            secureUrl: result.secure_url,
            publicId: result.public_id,
            format: result.format,
            bytes: result.bytes,
          };
        } catch (uploadErr: any) {
          lastError = uploadErr;
          if (uploadErr?.http_code === 429 && attempt < 2) {
            console.warn('[CloudinaryService] Server Cloudinary sibuk (429), mencoba ulang otomatis dalam 3 detik...');
            await new Promise((resolve) => setTimeout(resolve, 3000));
            continue;
          }
          break;
        }
      }

      throw lastError;

    } catch (err: any) {
      console.error('[CloudinaryService] Error saat mengunggah file:', err);
      return {
        success: false,
        errorMessage: err.message || 'Gagal mengunggah berkas ke Cloudinary.',
      };
    }
  }
}

export const cloudinaryService = new CloudinaryService();
