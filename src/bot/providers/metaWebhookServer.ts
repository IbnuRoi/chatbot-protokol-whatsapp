import http from 'http';
import { URL } from 'url';
import path from 'path';
import { ENV } from '../../config/env';
import { messageRouter, IncomingMessagePayload } from '../messageRouter';
import { metaClient } from './metaClient';
import { pdfService } from '../../services/pdfService';
import { imageService } from '../../services/imageService';
import { cloudflaredTunnel } from './cloudflaredTunnel';
import { prisma } from '../../database/prisma';
import { getLetterFileUrl } from '../../utils/textHelper';

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
          const isGetOrHead = method === 'GET' || method === 'HEAD';
          const cleanPath = pathname.replace(/\/+$/, '') || '/';
          const hasMetaVerificationParams = Boolean(reqUrl.searchParams.get('hub.mode'));

          const isWebhookPath =
            cleanPath === '/webhook' ||
            cleanPath === '/webhook-chatbot' ||
            cleanPath.startsWith('/webhook') ||
            hasMetaVerificationParams;

          // 1. Health check endpoint (GET /) jika bukan permintaan verifikasi Meta
          if (
            isGetOrHead &&
            !hasMetaVerificationParams &&
            (cleanPath === '/' || cleanPath === '/health' || cleanPath === '/status')
          ) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
              method === 'HEAD'
                ? ''
                : JSON.stringify({
                    status: 'online',
                    service: 'Chatbot WhatsApp Protokol Kemnaker (Meta Cloud API Webhook)',
                    timestamp: new Date().toISOString(),
                  })
            );
            return;
          }

          // 2. Short URL Document Redirect (GET /s/:id atau /d/:id atau /surat/:id)
          const redirectMatch = pathname.match(/^\/(?:s|d|surat)\/([a-zA-Z0-9_.-]+)/i);
          if (isGetOrHead && redirectMatch) {
            const letterIdParam = redirectMatch[1].trim();
            console.log(`\n🔗 [Short Link Redirect] Menerima akses tautan berkas: ${pathname} (ID/Ref: ${letterIdParam})`);

            let targetFileName: string | null = null;

            // Jika parameter berupa angka (Letter ID)
            if (/^\d+$/.test(letterIdParam)) {
              try {
                const letter = await prisma.letters.findFirst({
                  where: { id: BigInt(letterIdParam) },
                  select: { id: true, file: true, agenda_number: true },
                });
                if (letter && letter.file) {
                  targetFileName = letter.file;
                }
              } catch (dbErr: any) {
                console.warn(`⚠️ [Short Link] Gagal mencari surat ID ${letterIdParam}: ${dbErr.message}`);
              }
            }

            // Jika belum ditemukan, coba cocokkan dengan agenda_number atau nama file langsung
            if (!targetFileName) {
              try {
                const letter = await prisma.letters.findFirst({
                  where: {
                    OR: [
                      { agenda_number: letterIdParam },
                      { file: { contains: letterIdParam } },
                    ],
                  },
                  select: { id: true, file: true },
                });
                if (letter && letter.file) {
                  targetFileName = letter.file;
                }
              } catch {}
            }

            // Jika tetap belum ditemukan tapi parameter berakhiran .pdf, anggap sebagai file langsung
            if (!targetFileName && letterIdParam.toLowerCase().endsWith('.pdf')) {
              targetFileName = letterIdParam;
            }

            if (targetFileName) {
              const fullFileUrl = getLetterFileUrl(targetFileName);
              if (fullFileUrl) {
                console.log(`➡️ [Short Link Redirect] Mengalihkan ke berkas asli: ${fullFileUrl}`);
                res.writeHead(302, {
                  'Location': fullFileUrl,
                  'Cache-Control': 'no-cache, no-store, must-revalidate',
                });
                res.end();
                return;
              }
            }

            // Fallback tampilan 404 jika berkas tidak ditemukan
            res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(`<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <title>Berkas Dokumen Protokol</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 80vh; margin: 0; background: #f8fafc; color: #1e293b; text-align: center; }
    .card { background: white; padding: 36px; border-radius: 12px; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1); max-width: 420px; margin: 16px; border: 1px solid #e2e8f0; }
    h2 { margin-top: 0; color: #e11d48; font-size: 1.25rem; }
    p { color: #64748b; font-size: 0.95rem; line-height: 1.5; }
  </style>
</head>
<body>
  <div class="card">
    <h2>Dokumen Tidak Ditemukan</h2>
    <p>Berkas surat yang Anda tuju belum dilampirkan atau telah diarsipkan dari sistem database protokol.</p>
  </div>
</body>
</html>`);
            return;
          }

          // 3. Verifikasi Webhook Meta (GET/HEAD /webhook, /webhook-chatbot, atau dengan parameter hub.mode)
          if (isGetOrHead && isWebhookPath) {
            const mode = reqUrl.searchParams.get('hub.mode');
            const token = reqUrl.searchParams.get('hub.verify_token');
            const challenge = reqUrl.searchParams.get('hub.challenge');

            console.log(`\n🔔 [Meta Webhook] Menerima permintaan verifikasi webhook dari Meta...`);
            console.log(`   • Method : ${method}`);
            console.log(`   • Path   : ${pathname}`);
            console.log(`   • Mode   : ${mode}`);
            console.log(`   • Token  : ${token}`);

            if (mode === 'subscribe' && token === ENV.META_VERIFY_TOKEN) {
              console.log(`✅ [Meta Webhook] Verifikasi webhook BERHASIL! Challenge dikembalikan ke Meta.`);
              res.writeHead(200, { 'Content-Type': 'text/plain' });
              res.end(method === 'HEAD' ? '' : (challenge || ''));
            } else {
              console.warn(`❌ [Meta Webhook] Verifikasi GAGAL: Token tidak cocok atau diakses tanpa token.`);
              res.writeHead(403, { 'Content-Type': 'text/plain' });
              res.end(method === 'HEAD' ? '' : 'Forbidden');
            }
            return;
          }

          // 3. Penerima Event Pesan Masuk Meta (POST /webhook, /webhook-chatbot, atau root jika di-proxy Nginx)
          if (method === 'POST' && (isWebhookPath || cleanPath === '/')) {
            let rawBody = '';
            req.on('data', (chunk) => {
              rawBody += chunk;
            });

            req.on('end', async () => {
              // Segera kembalikan respons HTTP 200 OK ke Meta dalam < 3 detik
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ status: 'EVENT_RECEIVED' }));

              console.log(`\n📥 [Meta Webhook] Menerima event POST dari Meta (${rawBody.length} bytes)...`);

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
          console.warn(`[Meta Webhook] 404 Not Found: ${method} "${pathname}" (cleanPath: "${cleanPath}")`);
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

      this.server.listen(this.port, async () => {
        console.log(`\n======================================================`);
        console.log(`🌐 META WHATSAPP WEBHOOK SERVER AKTIF!`);
        console.log(`   • Port Lokal    : ${this.port}`);
        console.log(`   • Endpoint Path : /webhook & /webhook-chatbot`);
        console.log(`   • Verify Token  : "${ENV.META_VERIFY_TOKEN}"`);
        console.log(`======================================================\n`);

        if (ENV.META_AUTO_TUNNEL) {
          await cloudflaredTunnel.start(this.port);
        }

        resolve();
      });
    });
  }

  /**
   * Menghentikan server webhook
   */
  public stop(): Promise<void> {
    return new Promise((resolve) => {
      cloudflaredTunnel.stop();
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
      console.warn(`[Meta Webhook] Mengabaikan event payload bukan whatsapp_business_account (object: "${payload?.object}")`);
      return;
    }

    const entries = payload.entry || [];
    for (const entry of entries) {
      const changes = entry.changes || [];
      for (const change of changes) {
        if (change.field !== 'messages') {
          console.log(`[Meta Webhook] Event change field: "${change.field}"`);
          continue;
        }

        const value = change.value;
        const metadata = value?.metadata; // Berisi phone_number_id & display_phone_number
        const contacts = value?.contacts || [];
        const messages = value?.messages || [];
        const statuses = value?.statuses || [];

        if (statuses.length > 0 && messages.length === 0) {
          const st = statuses[0];
          console.log(`ℹ️ [Meta Webhook] Status update: pesan ${st?.id} status: "${st?.status}"`);
          continue;
        }

        // Abaikan notifikasi status yang tidak memuat messages
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
            let btnId: string | undefined;
            let rowId: string | undefined;

            if (interactiveType === 'button_reply') {
              btnId = interactive.button_reply?.id;
              selectedText = btnId || interactive.button_reply?.title || '';
            } else if (interactiveType === 'list_reply') {
              rowId = interactive.list_reply?.id;
              selectedText = rowId || interactive.list_reply?.title || '';
            }

            routerPayload = {
              senderNumber,
              pushName,
              text: selectedText,
              buttonId: btnId,
              listRowId: rowId,
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
              // Jika ini adalah simulasi pesan uji coba (mock test) dari Meta Developer Dashboard
              const isMetaMockTest =
                senderNumber === '16315551181' ||
                metadata?.phone_number_id === '123456123';

              if (isMetaMockTest) {
                console.log(
                  `✅ [Meta Webhook] Simulasi pesan uji coba (Test Event) dari Meta Developer Dashboard BERHASIL diterima dan diproses!`
                );
                continue;
              }

              const botReply = await messageRouter.processMessage(routerPayload);
              const targetPhoneId =
                metadata?.phone_number_id && metadata.phone_number_id !== '123456123'
                  ? metadata.phone_number_id
                  : ENV.META_PHONE_NUMBER_ID;

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
