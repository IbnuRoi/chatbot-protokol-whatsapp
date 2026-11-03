import http from 'http';
import { URL } from 'url';
import path from 'path';
import { ENV } from '../../config/env';
import { messageRouter, IncomingMessagePayload } from '../messageRouter';
import { metaClient } from './metaClient';
import { pdfService } from '../../services/pdfService';
import { imageService } from '../../services/imageService';

export class MetaWebhookServer {
  private server: http.Server | null = null;
  private port: number = ENV.META_WEBHOOK_PORT || 3000;
  private processedMessageIds = new Set<string>();

  /**
   * Menjalankan server HTTP Webhook untuk menerima verifikasi dan pesan dari Meta WhatsApp Cloud API
   */
  public start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = http.createServer(async (req, res) => {
        try {
          const reqUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
          const pathname = reqUrl.pathname;
          const method = req.method?.toUpperCase();

          // 1. Health check endpoint (GET /)
          if (method === 'GET' && (pathname === '/' || pathname === '/health' || pathname === '/status')) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                status: 'online',
                service: 'Chatbot WhatsApp Protokol Kemnaker (Meta Cloud API Webhook)',
                timestamp: new Date().toISOString(),
              })
            );
            return;
          }

          const isWebhookPath =
            pathname === '/webhook' ||
            pathname === '/webhook-chatbot' ||
            pathname.startsWith('/webhook');

          // 2. Verifikasi Webhook Meta (GET /webhook atau /webhook-chatbot)
          if (method === 'GET' && isWebhookPath) {
            const mode = reqUrl.searchParams.get('hub.mode');
            const token = reqUrl.searchParams.get('hub.verify_token');
            const challenge = reqUrl.searchParams.get('hub.challenge');

            console.log(`\n🔔 [Meta Webhook] Menerima permintaan verifikasi webhook dari Meta...`);
            console.log(`   • Mode : ${mode}`);
            console.log(`   • Token: ${token}`);

            if (mode === 'subscribe' && token === ENV.META_VERIFY_TOKEN) {
              console.log(`✅ [Meta Webhook] Verifikasi webhook BERHASIL! Challenge dikembalikan ke Meta.`);
              res.writeHead(200, { 'Content-Type': 'text/plain' });
              res.end(challenge || '');
            } else {
              console.warn(`❌ [Meta Webhook] Verifikasi GAGAL: Token tidak cocok.`);
              res.writeHead(403, { 'Content-Type': 'text/plain' });
              res.end('Forbidden');
            }
            return;
          }

          // 3. Penerima Event Pesan Masuk Meta (POST /webhook atau /webhook-chatbot)
          if (method === 'POST' && isWebhookPath) {
            let rawBody = '';
            req.on('data', (chunk) => {
              rawBody += chunk;
            });

            req.on('end', async () => {
              // Segera kembalikan respons HTTP 200 OK ke Meta dalam < 3 detik
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ status: 'EVENT_RECEIVED' }));

              try {
                if (rawBody.trim()) {
                  const payload = JSON.parse(rawBody);
                  await this.handleIncomingWebhookPayload(payload);
                }
              } catch (parseErr) {
                console.error('[Meta Webhook] Gagal mem-parse JSON payload dari Meta:', parseErr);
              }
            });
            return;
          }

          // Endpoint lainnya tidak ditemukan (404)
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Not Found');
        } catch (serverErr: any) {
          console.error('[Meta Webhook] Internal server error:', serverErr);
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end('Internal Server Error');
          }
        }
      });

      this.server.listen(this.port, () => {
        console.log(`\n======================================================`);
        console.log(`🌐 META WHATSAPP WEBHOOK SERVER AKTIF!`);
        console.log(`   • Port Lokal    : ${this.port}`);
        console.log(`   • Endpoint Path : /webhook & /webhook-chatbot`);
        console.log(`   • Verify Token  : "${ENV.META_VERIFY_TOKEN}"`);
        console.log(`======================================================\n`);
        resolve();
      });
    });
  }

  /**
   * Menghentikan server webhook
   */
  public stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          console.log('[Meta Webhook] Server dihentikan.');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * Mengurai payload pesan masuk dari Meta Cloud API dan meneruskannya ke MessageRouter
   */
  private async handleIncomingWebhookPayload(payload: any): Promise<void> {
    if (payload.object !== 'whatsapp_business_account') {
      return;
    }

    const entries = payload.entry || [];
    for (const entry of entries) {
      const changes = entry.changes || [];
      for (const change of changes) {
        if (change.field !== 'messages') continue;

        const value = change.value;
        const metadata = value?.metadata; // Berisi phone_number_id & display_phone_number
        const contacts = value?.contacts || [];
        const messages = value?.messages || [];

        // Abaikan notifikasi status (delivered, read, sent) yang tidak memuat messages
        if (!messages || messages.length === 0) continue;

        const pushNameMap = new Map<string, string>();
        for (const c of contacts) {
          if (c.wa_id && c.profile?.name) {
            pushNameMap.set(c.wa_id, c.profile.name);
          }
        }

        for (const msg of messages) {
          const msgId = msg.id;
          if (msgId && this.processedMessageIds.has(msgId)) {
            continue; // Mencegah pesan duplikat diproses ulang
          }
          if (msgId) {
            this.processedMessageIds.add(msgId);
            if (this.processedMessageIds.size > 2000) {
              this.processedMessageIds.clear();
            }
          }

          const senderNumber = msg.from;
          const pushName = pushNameMap.get(senderNumber) || '';
          const msgType = msg.type;

          console.log(`\n📩 [Meta Inbound] Pesan baru dari ${senderNumber} ("${pushName}") | Tipe: ${msgType}`);

          let routerPayload: IncomingMessagePayload | null = null;

          // 1. Pesan Teks Biasa
          if (msgType === 'text') {
            const textContent = msg.text?.body || '';
            routerPayload = {
              senderNumber,
              pushName,
              text: textContent,
            };
          }
          // 2. Interaksi Tombol / Quick Reply / List
          else if (msgType === 'interactive') {
            const interactive = msg.interactive;
            const interactiveType = interactive?.type;
            let selectedText = '';

            if (interactiveType === 'button_reply') {
              selectedText = interactive.button_reply?.id || interactive.button_reply?.title || '';
            } else if (interactiveType === 'list_reply') {
              selectedText = interactive.list_reply?.id || interactive.list_reply?.title || '';
            }

            routerPayload = {
              senderNumber,
              pushName,
              text: selectedText,
            };
          }
          // 3. Tombol Template (Legacy button)
          else if (msgType === 'button') {
            const buttonText = msg.button?.payload || msg.button?.text || '';
            routerPayload = {
              senderNumber,
              pushName,
              text: buttonText,
            };
          }
          // 4. Pesan Gambar / Foto
          else if (msgType === 'image') {
            const imageInfo = msg.image;
            if (imageInfo?.id) {
              console.log(`📷 [Meta Inbound] Mengunduh foto surat dari Meta CDN (Media ID: ${imageInfo.id})...`);
              const downloaded = await metaClient.downloadMedia(imageInfo.id);
              if (downloaded) {
                const tempPath = imageService.saveTempImage(downloaded.buffer, downloaded.fileName);
                routerPayload = {
                  senderNumber,
                  pushName,
                  media: {
                    filePath: tempPath,
                    fileName: downloaded.fileName,
                    mimeType: downloaded.mimeType,
                    isImage: true,
                  },
                };
              }
            }
          }
          // 5. Pesan Dokumen (PDF atau Dokumen Gambar)
          else if (msgType === 'document') {
            const docInfo = msg.document;
            if (docInfo?.id) {
              const originalName = docInfo.filename || 'dokumen.pdf';
              console.log(`📄 [Meta Inbound] Mengunduh dokumen surat dari Meta CDN (${originalName})...`);
              const downloaded = await metaClient.downloadMedia(docInfo.id);
              if (downloaded) {
                const ext = path.extname(originalName).toLowerCase();
                const isImageDoc =
                  ['.jpg', '.jpeg', '.png', '.webp', '.bmp'].includes(ext) ||
                  Boolean(downloaded.mimeType && downloaded.mimeType.startsWith('image/'));

                let tempPath: string;
                if (isImageDoc) {
                  tempPath = imageService.saveTempImage(downloaded.buffer, originalName);
                } else {
                  tempPath = pdfService.saveTempPdf(downloaded.buffer, originalName);
                }

                routerPayload = {
                  senderNumber,
                  pushName,
                  media: {
                    filePath: tempPath,
                    fileName: originalName,
                    mimeType: downloaded.mimeType,
                    isImage: isImageDoc,
                  },
                };
              }
            }
          }

          // Proses melalui MessageRouter dan kirimkan respons balasan
          if (routerPayload) {
            try {
              const botReply = await messageRouter.processMessage(routerPayload);
              const targetPhoneId = metadata?.phone_number_id || ENV.META_PHONE_NUMBER_ID;
              await metaClient.sendMessage(senderNumber, botReply, targetPhoneId);
            } catch (err) {
              console.error(`❌ [Meta Webhook] Error saat memproses pesan dari ${senderNumber}:`, err);
            }
          }
        }
      }
    }
  }
}

export const metaWebhookServer = new MetaWebhookServer();
