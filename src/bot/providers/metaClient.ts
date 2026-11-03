import { ENV } from '../../config/env';
import { BotResponse } from '../types';

export class MetaClient {
  private baseUrl = 'https://graph.facebook.com/v21.0';

  /**
   * Mengambil token akses Meta yang bersih.
   * Dilengkapi proteksi otomatis jika token di .env tanpa sengaja tertempel berkali-kali ("EAA...ZDZDEAA...").
   */
  private getCleanToken(): string {
    let token = (ENV.META_WA_TOKEN || '').trim();
    if (token.includes('ZDZDEAA') || (token.match(/EAA/g) || []).length > 1) {
      const tokens = token.split(/(?=EAA)/g).map((t) => t.trim()).filter((t) => t.startsWith('EAA'));
      if (tokens.length > 0) {
        token = tokens[tokens.length - 1];
        console.warn(
          `⚠️ [Meta Client] Terdeteksi token tertempel ganda (${tokens.length}x) di .env. Otomatis menggunakan token paling akhir.`
        );
      }
    }
    return token;
  }

  /**
   * Mengirim balasan pesan teks ke nomor WhatsApp melalui Meta Graph API.
   * Mendukung pengiriman multiple bubble chat secara berurutan.
   */
  public async sendMessage(
    to: string,
    response: BotResponse,
    phoneNumberId?: string
  ): Promise<boolean> {
    const token = this.getCleanToken();
    const phoneId = phoneNumberId || ENV.META_PHONE_NUMBER_ID;

    if (!token || !phoneId) {
      console.warn(
        '⚠️ [Meta Client] Tidak dapat mengirim pesan: META_WA_TOKEN atau META_PHONE_NUMBER_ID belum diatur di .env.'
      );
      return false;
    }

    // Normalisasi nomor penerima (hilangkan karakter non-digit dan pastikan awalan negara misal 62)
    let cleanTo = to.replace(/\D/g, '');
    if (cleanTo.startsWith('08')) {
      cleanTo = '628' + cleanTo.slice(2);
    }

    // Ekstraksi teks balasan (single bubble atau multi bubble)
    let messageList: string[] = [];
    if (typeof response === 'string') {
      messageList = [response];
    } else if (Array.isArray(response)) {
      messageList = response;
    } else if (response.messages && response.messages.length > 0) {
      messageList = response.messages;
    } else if (response.text) {
      messageList = [response.text];
    }

    let success = true;
    for (let i = 0; i < messageList.length; i++) {
      const textToSend = messageList[i];
      if (!textToSend || !textToSend.trim()) continue;

      try {
        const url = `${this.baseUrl}/${phoneId}/messages`;
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: cleanTo,
            type: 'text',
            text: {
              preview_url: false,
              body: textToSend,
            },
          }),
        });

        const data: any = await res.json();
        if (!res.ok) {
          console.error(
            `❌ [Meta Client Outbound] Gagal mengirim pesan (${i + 1}/${messageList.length}) ke ${cleanTo}:`,
            data?.error?.message || data
          );
          success = false;
        } else {
          console.log(
            `📤 [Meta Client Outbound] Berhasil mengirim pesan (${i + 1}/${messageList.length}) ke: ${cleanTo} (Message ID: ${data?.messages?.[0]?.id || '-'})`
          );
        }
      } catch (err: any) {
        console.error(`❌ [Meta Client Outbound] Network error saat kirim ke ${cleanTo}:`, err.message || err);
        success = false;
      }

      // Beri jeda kecil (250ms) antar bubble agar terkirim teratur ke WhatsApp
      if (i < messageList.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }

    return success;
  }

  /**
   * Mengunduh berkas media (gambar atau dokumen PDF) dari server Meta CDN menggunakan media ID
   */
  public async downloadMedia(mediaId: string): Promise<{ buffer: Buffer; fileName: string; mimeType: string } | null> {
    const token = this.getCleanToken();
    if (!token) {
      console.warn('⚠️ [Meta Client] Tidak dapat mengunduh media: META_WA_TOKEN belum diatur.');
      return null;
    }

    try {
      // 1. Ambil direct download URL dari media metadata
      const metaRes = await fetch(`${this.baseUrl}/${mediaId}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!metaRes.ok) {
        const errData = await metaRes.text();
        console.error(`❌ [Meta Client] Gagal mendapatkan URL media (${mediaId}):`, errData);
        return null;
      }

      const metaData: any = await metaRes.json();
      const downloadUrl = metaData.url;
      const mimeType = metaData.mime_type || 'application/octet-stream';

      if (!downloadUrl) {
        console.error(`❌ [Meta Client] Download URL kosong untuk media ID: ${mediaId}`);
        return null;
      }

      // 2. Unduh konten biner berkas dari CDN Meta
      const fileRes = await fetch(downloadUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!fileRes.ok) {
        console.error(`❌ [Meta Client] Gagal mengunduh biner berkas dari Meta CDN (${fileRes.status})`);
        return null;
      }

      const arrayBuffer = await fileRes.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      // Tentukan ekstensi berkas
      let ext = '.bin';
      if (mimeType.includes('pdf')) ext = '.pdf';
      else if (mimeType.includes('jpeg') || mimeType.includes('jpg')) ext = '.jpg';
      else if (mimeType.includes('png')) ext = '.png';
      else if (mimeType.includes('webp')) ext = '.webp';

      const fileName = `meta_media_${Date.now()}${ext}`;

      return {
        buffer,
        fileName,
        mimeType,
      };
    } catch (err: any) {
      console.error(`❌ [Meta Client] Error mengunduh media ${mediaId}:`, err.message || err);
      return null;
    }
  }
}

export const metaClient = new MetaClient();

