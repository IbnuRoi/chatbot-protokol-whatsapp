import { ENV } from '../../config/env';
import { BotResponse, BotReplyOptions, BotReplyButton, BotReplyList } from '../types';

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
   * Helper internal untuk memecah teks panjang (> 1024 karakter) agar mematuhi batasan resmi Meta
   * untuk pesan interaktif. Teks awal dikirim sebagai bubble teks biasa, dan potongan akhir
   * (<= 1000 karakter) ditempatkan ke dalam body pesan interaktif.
   */
  private splitTextForInteractive(fullText: string, maxLen: number = 1000): { preTexts: string[]; interactiveText: string } {
    const trimmed = (fullText || '').trim();
    if (trimmed.length <= maxLen) {
      return { preTexts: [], interactiveText: trimmed };
    }

    const preTexts: string[] = [];
    let remaining = trimmed;

    while (remaining.length > maxLen) {
      // Cari titik pemecah terbaik (paragraf ganda \n\n atau baris baru \n)
      let splitIdx = remaining.lastIndexOf('\n\n', maxLen);
      if (splitIdx === -1 || splitIdx < 300) {
        splitIdx = remaining.lastIndexOf('\n', maxLen);
      }
      if (splitIdx === -1 || splitIdx < 300) {
        splitIdx = remaining.lastIndexOf(' ', maxLen);
      }
      if (splitIdx === -1) {
        splitIdx = maxLen;
      }

      const chunk = remaining.slice(0, splitIdx).trim();
      if (chunk) preTexts.push(chunk);
      remaining = remaining.slice(splitIdx).trim();
    }

    return {
      preTexts,
      interactiveText: remaining || trimmed.slice(-maxLen),
    };
  }

  /**
   * Mengirim satu bubble teks biasa ke Meta WhatsApp Cloud API
   */
  public async sendRawTextMessage(
    to: string,
    text: string,
    phoneId: string,
    token: string
  ): Promise<boolean> {
    if (!text || !text.trim()) return true;

    try {
      const url = `${this.baseUrl}/${phoneId}/messages`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to,
          type: 'text',
          text: {
            preview_url: false,
            body: text,
          },
        }),
      });

      const data: any = await res.json();
      if (!res.ok) {
        console.error(`❌ [Meta Client Outbound] Gagal kirim pesan teks ke ${to}:`, data?.error?.message || data);
        return false;
      }

      console.log(`📤 [Meta Client Outbound] Berhasil kirim teks ke ${to} (Message ID: ${data?.messages?.[0]?.id || '-'})`);
      return true;
    } catch (err: any) {
      console.error(`❌ [Meta Client Outbound] Network error kirim teks ke ${to}:`, err.message || err);
      return false;
    }
  }

  /**
   * Mengirim pesan interaktif dengan Quick Reply Buttons (maksimal 3 tombol)
   * Dilengkapi fallback otomatis ke teks biasa jika gagal / ditolak Meta.
   */
  public async sendInteractiveButtons(
    to: string,
    reply: BotReplyOptions,
    phoneId: string,
    token: string
  ): Promise<boolean> {
    if (!reply.buttons || reply.buttons.length === 0) {
      return this.sendFallbackText(to, reply, phoneId, token);
    }

    // Tentukan body teks interaktif dan pre-bubble jika teks panjang
    let bodyCandidate = reply.text || '';
    const preBubbles: string[] = [];

    if (reply.messages && reply.messages.length > 1) {
      preBubbles.push(...reply.messages.slice(0, -1));
      bodyCandidate = reply.messages[reply.messages.length - 1];
    }

    const { preTexts, interactiveText } = this.splitTextForInteractive(bodyCandidate, 1000);
    preBubbles.push(...preTexts);

    // Kirim bubble teks pendahulu terlebih dahulu
    for (const pre of preBubbles) {
      await this.sendRawTextMessage(to, pre, phoneId, token);
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    // Susun tombol Meta (maks 3 tombol, title maks 20 karakter)
    const validButtons = reply.buttons.slice(0, 3).map((btn, idx) => ({
      type: 'reply' as const,
      reply: {
        id: (btn.id || `btn_${idx + 1}`).trim().slice(0, 256),
        title: (btn.text || `Pilihan ${idx + 1}`).trim().slice(0, 20),
      },
    }));

    const interactivePayload: any = {
      type: 'button',
      body: {
        text: interactiveText || 'Silakan pilih tindakan berikut:',
      },
      action: {
        buttons: validButtons,
      },
    };

    if (reply.headerTitle && reply.headerTitle.trim()) {
      interactivePayload.header = {
        type: 'text',
        text: reply.headerTitle.trim().slice(0, 60),
      };
    }

    if (reply.footerText && reply.footerText.trim()) {
      interactivePayload.footer = {
        text: reply.footerText.trim().slice(0, 60),
      };
    }

    try {
      const url = `${this.baseUrl}/${phoneId}/messages`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to,
          type: 'interactive',
          interactive: interactivePayload,
        }),
      });

      const data: any = await res.json();
      if (!res.ok) {
        console.warn(
          `⚠️ [Meta Client] Gagal mengirim tombol interaktif (${data?.error?.message || JSON.stringify(data)}). Melakukan fallback ke teks biasa...`
        );
        return this.sendFallbackText(to, reply, phoneId, token);
      }

      console.log(`🔘 [Meta Client Outbound] Berhasil kirim pesan tombol interaktif (${validButtons.length} tombol) ke: ${to}`);
      return true;
    } catch (err: any) {
      console.error(`❌ [Meta Client] Error network kirim tombol interaktif:`, err.message || err);
      return this.sendFallbackText(to, reply, phoneId, token);
    }
  }

  /**
   * Mengirim pesan interaktif dengan List Menu (Bottom-sheet pilihan hingga 10 item)
   * Dilengkapi fallback otomatis ke teks biasa jika gagal / ditolak Meta.
   */
  public async sendInteractiveList(
    to: string,
    reply: BotReplyOptions,
    phoneId: string,
    token: string
  ): Promise<boolean> {
    if (!reply.list || !reply.list.sections || reply.list.sections.length === 0) {
      return this.sendFallbackText(to, reply, phoneId, token);
    }

    let bodyCandidate = reply.text || '';
    const preBubbles: string[] = [];

    if (reply.messages && reply.messages.length > 1) {
      preBubbles.push(...reply.messages.slice(0, -1));
      bodyCandidate = reply.messages[reply.messages.length - 1];
    }

    const { preTexts, interactiveText } = this.splitTextForInteractive(bodyCandidate, 1000);
    preBubbles.push(...preTexts);

    for (const pre of preBubbles) {
      await this.sendRawTextMessage(to, pre, phoneId, token);
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    // Susun section dan row list (maks 10 baris total, title maks 24 karakter, desc maks 72)
    let totalRows = 0;
    const formattedSections = [];

    for (const sec of reply.list.sections) {
      if (totalRows >= 10) break;
      const rows = [];
      for (const row of sec.rows) {
        if (totalRows >= 10) break;
        rows.push({
          id: (row.id || `row_${totalRows + 1}`).trim().slice(0, 200),
          title: (row.title || `Opsi ${totalRows + 1}`).trim().slice(0, 24),
          ...(row.description ? { description: row.description.trim().slice(0, 72) } : {}),
        });
        totalRows++;
      }
      if (rows.length > 0) {
        formattedSections.push({
          title: (sec.title || 'Pilihan Menu').trim().slice(0, 24),
          rows,
        });
      }
    }

    const interactivePayload: any = {
      type: 'list',
      body: {
        text: interactiveText || 'Silakan pilih dari menu di bawah ini:',
      },
      action: {
        button: (reply.list.buttonTitle || 'Buka Menu').trim().slice(0, 20),
        sections: formattedSections,
      },
    };

    if (reply.headerTitle && reply.headerTitle.trim()) {
      interactivePayload.header = {
        type: 'text',
        text: reply.headerTitle.trim().slice(0, 60),
      };
    }

    if (reply.footerText && reply.footerText.trim()) {
      interactivePayload.footer = {
        text: reply.footerText.trim().slice(0, 60),
      };
    }

    try {
      const url = `${this.baseUrl}/${phoneId}/messages`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to,
          type: 'interactive',
          interactive: interactivePayload,
        }),
      });

      const data: any = await res.json();
      if (!res.ok) {
        console.warn(
          `⚠️ [Meta Client] Gagal mengirim list interaktif (${data?.error?.message || JSON.stringify(data)}). Melakukan fallback ke teks biasa...`
        );
        return this.sendFallbackText(to, reply, phoneId, token);
      }

      console.log(`📋 [Meta Client Outbound] Berhasil kirim pesan List Menu interaktif (${totalRows} baris) ke: ${to}`);
      return true;
    } catch (err: any) {
      console.error(`❌ [Meta Client] Error network kirim list interaktif:`, err.message || err);
      return this.sendFallbackText(to, reply, phoneId, token);
    }
  }

  /**
   * Mengirim fallback ke teks biasa jika pengiriman pesan interaktif gagal
   */
  private async sendFallbackText(
    to: string,
    reply: BotReplyOptions,
    phoneId: string,
    token: string
  ): Promise<boolean> {
    let messageList: string[] = [];
    if (reply.messages && reply.messages.length > 0) {
      messageList = reply.messages;
    } else if (reply.text) {
      messageList = [reply.text];
    }

    let success = true;
    for (let i = 0; i < messageList.length; i++) {
      const ok = await this.sendRawTextMessage(to, messageList[i], phoneId, token);
      if (!ok) success = false;
      if (i < messageList.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    return success;
  }

  /**
   * Mengirim balasan pesan ke nomor WhatsApp melalui Meta Graph API.
   * Mendeteksi otomatis apakah respons berupa teks, tombol Quick Reply, atau List Menu interaktif.
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

    // 1. Pesan Interaktif: List Menu
    if (typeof response === 'object' && !Array.isArray(response) && response.list) {
      return this.sendInteractiveList(cleanTo, response, phoneId, token);
    }

    // 2. Pesan Interaktif: Quick Reply Buttons
    if (
      typeof response === 'object' &&
      !Array.isArray(response) &&
      response.buttons &&
      response.buttons.length > 0
    ) {
      return this.sendInteractiveButtons(cleanTo, response, phoneId, token);
    }

    // 3. Pesan Teks Biasa (mendukung multiple bubble)
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

      const ok = await this.sendRawTextMessage(cleanTo, textToSend, phoneId, token);
      if (!ok) success = false;

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

