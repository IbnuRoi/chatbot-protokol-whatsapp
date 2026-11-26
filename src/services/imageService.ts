import fs from 'fs';
import path from 'path';
import { createCanvas, loadImage } from '@napi-rs/canvas';
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

  /**
   * Membersihkan noda abu-abu tipis (seperti sisa pensil yang dihapus, debu scan, dan bayangan tipis)
   * sambil mempertahankan dan mempertajam tinta pulpen berwarna maupun tinta cetak/hitam pekat.
   */
  public async prepareDispositionVisionCrops(pageImagePath: string): Promise<{
    cropPaths: string[];
    tempFilesToCleanup: string[];
  }> {
    const tempFilesToCleanup: string[] = [];
    if (!fs.existsSync(pageImagePath)) {
      return { cropPaths: [], tempFilesToCleanup };
    }

    try {
      const img = await loadImage(pageImagePath);
      const width = img.width;
      const height = img.height;
      const canvas = createCanvas(width, height);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0);

      const imageData = ctx.getImageData(0, 0, width, height);
      const data = imageData.data;
      const rawData = new Uint8ClampedArray(data);

      // 1. Estimasi background kertas lokal (grid 48x48 px) agar tahan bayangan foto HP
      const cellSize = 48;
      const gridW = Math.max(1, Math.ceil(width / cellSize));
      const gridH = Math.max(1, Math.ceil(height / cellSize));
      const gridBg = new Float32Array(gridW * gridH);

      for (let gy = 0; gy < gridH; gy++) {
        const y0 = gy * cellSize;
        const y1 = Math.min(height, y0 + cellSize);
        for (let gx = 0; gx < gridW; gx++) {
          const x0 = gx * cellSize;
          const x1 = Math.min(width, x0 + cellSize);
          const lums: number[] = [];
          for (let y = y0; y < y1; y += 3) {
            for (let x = x0; x < x1; x += 3) {
              const i = (y * width + x) * 4;
              const l = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
              lums.push(l);
            }
          }
          lums.sort((a, b) => a - b);
          const p85 = lums.length > 0 ? lums[Math.min(lums.length - 1, Math.floor(lums.length * 0.85))] : 250;
          gridBg[gy * gridW + gx] = Math.max(200, Math.min(255, p85));
        }
      }

      // 2. Identifikasi inti tinta kuat (1 = hitam/cetak pekat, 2 = tinta pulpen berwarna)
      const totalPx = width * height;
      const coreMask = new Uint8Array(totalPx);

      for (let y = 0; y < height; y++) {
        const gy = Math.min(gridH - 1, Math.floor(y / cellSize));
        for (let x = 0; x < width; x++) {
          const gx = Math.min(gridW - 1, Math.floor(x / cellSize));
          const bg = gridBg[gy * gridW + gx];
          const pIdx = y * width + x;
          const idx = pIdx * 4;
          const r = data[idx];
          const g = data[idx + 1];
          const b = data[idx + 2];
          const lum = 0.299 * r + 0.587 * g + 0.114 * b;
          const chroma = Math.max(r, g, b) - Math.min(r, g, b);
          const diff = bg - lum;

          if (chroma >= 18 && diff >= 26) {
            coreMask[pIdx] = 2; // Tinta pulpen berwarna (biru/merah/ungu)
          } else if (diff >= 98) {
            coreMask[pIdx] = 1; // Tinta hitam tegas atau garis cetak / teks
          }
        }
      }

      // 3. Pertahankan piksel tepi 1px di sekitar inti tinta & putihkan noda abu-abu terisolasi (sisa pensil dihapus)
      const cleaned = new Uint8ClampedArray(data);
      for (let y = 0; y < height; y++) {
        const gy = Math.min(gridH - 1, Math.floor(y / cellSize));
        for (let x = 0; x < width; x++) {
          const gx = Math.min(gridW - 1, Math.floor(x / cellSize));
          const bg = gridBg[gy * gridW + gx];
          const pIdx = y * width + x;
          const idx = pIdx * 4;
          const c = coreMask[pIdx];

          if (c === 2) {
            // Tajamkan tinta pulpen berwarna agar sangat kontras
            cleaned[idx] = Math.max(0, Math.round(data[idx] * 0.68));
            cleaned[idx + 1] = Math.max(0, Math.round(data[idx + 1] * 0.72));
            cleaned[idx + 2] = Math.max(0, Math.round(data[idx + 2] * 0.90));
            cleaned[idx + 3] = 255;
            continue;
          }

          if (c === 1) {
            cleaned[idx + 3] = 255;
            continue;
          }

          const r = data[idx];
          const g = data[idx + 1];
          const b = data[idx + 2];
          const lum = 0.299 * r + 0.587 * g + 0.114 * b;
          const chroma = Math.max(r, g, b) - Math.min(r, g, b);
          const diff = bg - lum;

          let nearCore = false;
          if (diff >= 55 || chroma >= 14) {
            for (let dy = -1; dy <= 1 && !nearCore; dy++) {
              const ny = y + dy;
              if (ny < 0 || ny >= height) continue;
              for (let dx = -1; dx <= 1; dx++) {
                if (dx === 0 && dy === 0) continue;
                const nx = x + dx;
                if (nx < 0 || nx >= width) continue;
                if (coreMask[ny * width + nx] > 0) {
                  nearCore = true;
                  break;
                }
              }
            }
          }

          if (!nearCore) {
            // Hapus total noda abu-abu samar / sisa pensil dihapus ke putih murni
            cleaned[idx] = 255;
            cleaned[idx + 1] = 255;
            cleaned[idx + 2] = 255;
          }
          cleaned[idx + 3] = 255;
        }
      }

      imageData.data.set(cleaned);
      ctx.putImageData(imageData, 0, 0);

      // 4. Verifikasi piksel per kotak centang [ ] pada formulir standar (anti-ekor menyilang & anti-halusinasi kotak kosong)
      if (height > width * 1.15) {
        this.annotateVerifiedInkBoxes(ctx, rawData, cleaned, width, height);
      }

      const timestamp = Date.now();
      const baseName = path.basename(pageImagePath, path.extname(pageImagePath)).replace(/[^a-zA-Z0-9_-]/g, '_');

      const saveCrop = (rx: number, ry: number, rw: number, rh: number, suffix: string): string => {
        const cx = Math.max(0, Math.floor(rx));
        const cy = Math.max(0, Math.floor(ry));
        const cw = Math.max(10, Math.min(width - cx, Math.floor(rw)));
        const ch = Math.max(10, Math.min(height - cy, Math.floor(rh)));
        const cropCanvas = createCanvas(cw, ch);
        const cropCtx = cropCanvas.getContext('2d');
        cropCtx.drawImage(canvas, cx, cy, cw, ch, 0, 0, cw, ch);
        const outPath = path.join(ENV.TEMP_STORAGE_PATH, `temp_disp_clean_${timestamp}_${baseName}_${suffix}.png`);
        fs.writeFileSync(outPath, cropCanvas.toBuffer('image/png'));
        tempFilesToCleanup.push(outPath);
        return outPath;
      };

      // Gunakan 5 crop terpisah resolusi tinggi lossless PNG agar kolom kiri/kanan tidak saling bocor
      if (height > width * 1.15) {
        const cropHeader = saveCrop(0, 0, width, height * 0.38, 'c1_header');
        const cropLeft = saveCrop(0, height * 0.28, width * 0.495, height * 0.32, 'c2_left');
        const cropRight = saveCrop(width * 0.485, height * 0.28, width * 0.515, height * 0.32, 'c3_right');
        const cropActions = saveCrop(0, height * 0.55, width * 0.51, height * 0.41, 'c4_actions');
        const cropNotes = saveCrop(width * 0.49, height * 0.53, width * 0.51, height * 0.46, 'c5_notes');
        return {
          cropPaths: [cropHeader, cropLeft, cropRight, cropActions, cropNotes],
          tempFilesToCleanup,
        };
      }

      const fullClean = saveCrop(0, 0, width, height, 'full');
      return {
        cropPaths: [fullClean],
        tempFilesToCleanup,
      };
    } catch (err) {
      console.warn('[ImageService] Gagal menyiapkan crop pembersih lembar disposisi:', err);
      return { cropPaths: [pageImagePath], tempFilesToCleanup };
    }
  }

  /**
   * Mendeteksi kotak centang [ ] pada gambar asli (sebelum pembersihan garis tipis) lalu mengukur
   * kepadatan tinta pulpen pada bagian tengah-dalam kotak di piksel yang sudah dibersihkan dari sisa pensil.
   * Memberi penanda titik hijau (●) di margin kiri kotak yang benar-benar berisi tinta di dalamnya.
   */
  private annotateVerifiedInkBoxes(
    ctx: any,
    rawData: Uint8ClampedArray,
    cleanedData: Uint8ClampedArray,
    width: number,
    height: number
  ): void {
    const minW = Math.max(24, Math.floor(width * 0.032));
    const maxW = Math.max(40, Math.floor(width * 0.052));
    const minH = Math.max(12, Math.floor(width * 0.0145));
    const maxH = Math.max(20, Math.floor(width * 0.0235));

    const isRawLine = (x: number, y: number): boolean => {
      if (x < 0 || x >= width || y < 0 || y >= height) return false;
      const i = (y * width + x) * 4;
      return 0.299 * rawData[i] + 0.587 * rawData[i + 1] + 0.114 * rawData[i + 2] < 224;
    };

    const isCleanInk = (x: number, y: number): boolean => {
      if (x < 0 || x >= width || y < 0 || y >= height) return false;
      const i = (y * width + x) * 4;
      const r = cleanedData[i];
      const g = cleanedData[i + 1];
      const b = cleanedData[i + 2];
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      const chroma = Math.max(r, g, b) - Math.min(r, g, b);
      return (chroma >= 18 && lum < 230) || lum < 140;
    };

    const regions = [
      // Sifat kotak atas (Rahasia, Penting/Segera, Biasa, Tembusan)
      { name: 'SIFAT', x0: Math.floor(width * 0.03), x1: Math.floor(width * 0.85), y0: Math.floor(height * 0.08), y1: Math.floor(height * 0.15), filterModeX: false },
      // Diteruskan Kepada (Kolom Kiri)
      { name: 'L_DIT', x0: Math.floor(width * 0.03), x1: Math.floor(width * 0.105), y0: Math.floor(height * 0.30), y1: Math.floor(height * 0.575), filterModeX: true },
      // Diteruskan Kepada (Kolom Kanan)
      { name: 'R_DIT', x0: Math.floor(width * 0.48), x1: Math.floor(width * 0.57), y0: Math.floor(height * 0.30), y1: Math.floor(height * 0.575), filterModeX: true },
      // Lajur Disposisi (Kolom Kiri)
      { name: 'LAJUR', x0: Math.floor(width * 0.03), x1: Math.floor(width * 0.105), y0: Math.floor(height * 0.575), y1: Math.floor(height * 0.935), filterModeX: true },
    ];

    const detected: Array<{ x: number; y: number; w: number; h: number }> = [];

    for (const reg of regions) {
      const regBoxes: Array<{ x: number; y: number; w: number; h: number }> = [];
      for (let y = reg.y0; y < reg.y1 - maxH; y++) {
        let runStart = -1;
        for (let x = reg.x0; x <= reg.x1; x++) {
          const hit = isRawLine(x, y) || isRawLine(x, y + 1);
          if (hit && runStart === -1) runStart = x;
          if ((!hit || x === reg.x1) && runStart !== -1) {
            const runLen = x - runStart;
            if (runLen >= minW && runLen <= maxW) {
              for (let bh = minH; bh <= maxH; bh++) {
                const by = y + bh;
                if (by >= height - 2) break;
                let bHits = 0;
                for (let bx = runStart + 2; bx <= runStart + runLen - 2; bx++) {
                  if (
                    isRawLine(bx, by) ||
                    isRawLine(bx, by - 1) ||
                    isRawLine(bx, by + 1) ||
                    isRawLine(bx, by - 2) ||
                    isRawLine(bx, by + 2)
                  ) {
                    bHits++;
                  }
                }
                if (bHits / (runLen - 4) > 0.72) {
                  let lHits = 0;
                  let rHits = 0;
                  for (let vy = y + 2; vy <= by - 2; vy++) {
                    if (
                      isRawLine(runStart, vy) ||
                      isRawLine(runStart + 1, vy) ||
                      isRawLine(runStart - 1, vy) ||
                      isRawLine(runStart + 2, vy) ||
                      isRawLine(runStart - 2, vy)
                    ) {
                      lHits++;
                    }
                    if (
                      isRawLine(runStart + runLen - 1, vy) ||
                      isRawLine(runStart + runLen - 2, vy) ||
                      isRawLine(runStart + runLen, vy) ||
                      isRawLine(runStart + runLen - 3, vy) ||
                      isRawLine(runStart + runLen + 1, vy)
                    ) {
                      rHits++;
                    }
                  }
                  if (lHits / (bh - 4) >= 0.45 && rHits / (bh - 4) >= 0.45) {
                    // Tolak kotak semu yang melintasi garis pembatas horizontal di tengah (toleran kemiringan ±1px)
                    let hasMidHorizLine = false;
                    for (let my = y + 4; my <= by - 4; my++) {
                      let mH = 0;
                      for (let bx = runStart + 3; bx <= runStart + runLen - 3; bx++) {
                        if (isRawLine(bx, my) || isRawLine(bx, my - 1) || isRawLine(bx, my + 1)) mH++;
                      }
                      if (mH / (runLen - 6) > 0.72) {
                        hasMidHorizLine = true;
                        break;
                      }
                    }
                    if (!hasMidHorizLine && !regBoxes.some((b) => y < b.y + b.h + 2 && Math.abs(b.x - runStart) < 20)) {
                      regBoxes.push({ x: runStart, y, w: runLen, h: bh });
                    }
                    break;
                  }
                }
              }
            }
            runStart = -1;
          }
        }
      }

      if (reg.filterModeX && regBoxes.length > 0) {
        const buckets: Record<number, number> = {};
        for (const c of regBoxes) {
          const bk = Math.round(c.x / 8) * 8;
          buckets[bk] = (buckets[bk] || 0) + 1;
        }
        const modeX = Number(Object.entries(buckets).sort((a, b) => b[1] - a[1])[0][0]);
        detected.push(...regBoxes.filter((c) => Math.abs(c.x - modeX) <= 14));
      } else {
        detected.push(...regBoxes);
      }
    }

    const radius = Math.max(4, Math.round(width * 0.0042));
    for (const box of detected) {
      const padX = Math.max(5, Math.floor(box.w * 0.16));
      const padY = Math.max(4, Math.floor(box.h * 0.18));
      let total = 0;
      let ink = 0;
      let midTotal = 0;
      let midInk = 0;

      for (let iy = box.y + padY; iy <= box.y + box.h - padY; iy++) {
        for (let ix = box.x + padX; ix <= box.x + box.w - padX; ix++) {
          total++;
          const has = isCleanInk(ix, iy);
          if (has) ink++;
          // Zona inti tengah (20%..84% lebar, 16%..78% tinggi): menolak ekor garis dari kotak bawah, tapi tetap menangkap ✔ yang agak ke kanan
          if (
            ix >= box.x + Math.floor(box.w * 0.20) &&
            ix <= box.x + Math.floor(box.w * 0.84) &&
            iy >= box.y + Math.floor(box.h * 0.16) &&
            iy <= box.y + Math.floor(box.h * 0.78)
          ) {
            midTotal++;
            if (has) midInk++;
          }
        }
      }

      const inkPct = (ink / Math.max(1, total)) * 100;
      const midPct = (midInk / Math.max(1, midTotal)) * 100;

      if (inkPct >= 10 && midPct >= 8) {
        const dotX = Math.max(radius + 2, box.x - radius * 2 - 4);
        const dotY = Math.round(box.y + box.h / 2);
        ctx.fillStyle = '#00C853';
        ctx.beginPath();
        ctx.arc(dotX, dotY, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

export const imageService = new ImageService();
