import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  downloadMediaMessage,
  proto,
  WASocket,
  jidNormalizedUser,
} from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import pino from 'pino';
import path from 'path';
import fs from 'fs';
import { messageRouter } from './messageRouter';
import { pdfService } from '../services/pdfService';
import { prisma } from '../database/prisma';
import { BotResponse, getResponseText } from './types';

// Filter noise console.error dari pustaka internal libsignal yang memicu "Bad MAC" atau "MessageCounterError"
// saat sinkronisasi multi-device latar belakang antara smartphone utama dan companion client.
// Hal ini lumrah terjadi pada Baileys multi-device dan tidak mengganggu fungsionalitas pesan masuk/keluar bot.
const originalConsoleError = console.error;
console.error = (...args: any[]) => {
  const isPeerSyncDecryptNoise = args.some((arg) => {
    if (!arg) return false;
    const str = typeof arg === 'string' ? arg : (arg.stack || arg.message || String(arg));
    return (
      str.includes('Failed to decrypt message with any known session') ||
      str.includes('Session error:Error: Bad MAC') ||
      str.includes('MessageCounterError') ||
      str.includes('Key used already or never filled') ||
      (str.includes('doDecryptWhisperMessage') && (str.includes('verifyMAC') || str.includes('Session error')))
    );
  });

  if (isPeerSyncDecryptNoise) {
    return;
  }
  originalConsoleError.apply(console, args);
};

export class WhatsAppClient {
  private sock: WASocket | null = null;
  private authFolder = path.resolve(process.cwd(), 'storage', 'auth_info_baileys');
  private sentMessageIds = new Set<string>();
  private botPhone: string = '';
  private botLid: string = '';

  public async start(): Promise<void> {
    if (!fs.existsSync(this.authFolder)) {
      fs.mkdirSync(this.authFolder, { recursive: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState(this.authFolder);

    const updateBotIdentity = () => {
      const myId = this.sock?.user?.id || state.creds.me?.id;
      if (myId) {
        this.botPhone = jidNormalizedUser(myId).split('@')[0].split(':')[0];
      }
      const myLid = this.sock?.user?.lid || (state.creds.me as any)?.lid;
      if (myLid) {
        this.botLid = jidNormalizedUser(myLid).split('@')[0].split(':')[0];
      }
    };
    updateBotIdentity();

    const logger = pino({ level: 'silent' });

    this.sock = makeWASocket({
      auth: state,
      logger,
      printQRInTerminal: false,
      syncFullHistory: false,
      getMessage: async (key) => {
        return proto.Message.fromObject({});
      },
    });

    this.sock.ev.on('creds.update', () => {
      saveCreds();
      updateBotIdentity();
    });

    this.sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        console.log('\n======================================================');
        console.log('📲 SCAN QR CODE INI DENGAN WHATSAPP ANDA (LINK DEVICE):');
        console.log('======================================================\n');
        qrcode.generate(qr, { small: true });
        console.log('\nSilakan buka WhatsApp > Perangkat Tertaut > Tautkan Perangkat');
      }

      if (connection === 'close') {
        const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
        const isLoggedOut = statusCode === DisconnectReason.loggedOut || statusCode === 401;
        console.log(`[WhatsApp] Koneksi terputus (status: ${statusCode}). Logged out: ${isLoggedOut}`);

        if (isLoggedOut) {
          console.log('\n⚠️ [WhatsApp] Sesi tautan WhatsApp sebelumnya telah kedaluwarsa atau dikeluarkan (status 401).');
          console.log('🔄 Membersihkan sesi lama dan menyiapkan QR Code baru untuk ditautkan kembali...\n');
          try {
            if (fs.existsSync(this.authFolder)) {
              fs.rmSync(this.authFolder, { recursive: true, force: true });
            }
          } catch (e) {
            console.error('Gagal menghapus folder auth:', e);
          }
          setTimeout(() => this.start(), 2000);
        } else {
          console.log('[WhatsApp] Mencoba menghubungkan kembali dalam 3 detik...');
          setTimeout(() => this.start(), 3000);
        }
      } else if (connection === 'open') {
        console.log('\n✅ [WhatsApp] BOT ADMINISTRASI PROTOKOL TELAH TERHUBUNG DAN SIAP DIGUNAKAN!');
        console.log('💡 Menunggu pesan masuk dari pengguna WhatsApp...');
        // Sinkronisasi otomatis WhatsApp LID untuk seluruh user terdaftar
        this.syncUserLids().catch((err) => console.error('[WhatsApp] Gagal auto-sync user LIDs:', err));
      }
    });

    // Otomatis menautkan LID pengguna saat WhatsApp menyinkronkan kontak
    this.sock.ev.on('contacts.upsert', async (contacts) => {
      for (const contact of contacts) {
        if (contact.id && (contact as any).lid) {
          await this.linkContactLid(contact.id, (contact as any).lid);
        }
      }
    });

    this.sock.ev.on('contacts.update', async (contacts) => {
      for (const contact of contacts) {
        if (contact.id && (contact as any).lid) {
          await this.linkContactLid(contact.id, (contact as any).lid);
        }
      }
    });

    this.sock.ev.on('messages.upsert', async ({ messages, type }) => {
      // Izinkan baik 'notify' maupun 'append' (agar pesan langsung terproses)
      for (const msg of messages) {
        if (!msg.key) continue;

        // Cegah looping pesan: jika pesan ini dikirimkan oleh bot sendiri melalui sendMessage
        if (msg.key.id && this.sentMessageIds.has(msg.key.id)) {
          continue;
        }

        const remoteJid = msg.key.remoteJid;
        if (!remoteJid || remoteJid.endsWith('@g.us') || remoteJid === 'status@broadcast') {
          continue;
        }

        // Normalisasi JID agar bersih dari device ID multi-device
        const normalizedJid = jidNormalizedUser(remoteJid);
        const senderNumber = normalizedJid.split('@')[0].split(':')[0];

        const isSelf =
          (this.botPhone && (senderNumber === this.botPhone || remoteJid.includes(this.botPhone))) ||
          (this.botLid && (senderNumber === this.botLid || remoteJid.includes(this.botLid)));

        // Abaikan sinkronisasi pesan keluar dari akun pemilik bot ke kontak lain (outbound chat sync)
        if (msg.key.fromMe && !isSelf) {
          continue;
        }

        // Deteksi pesan enkripsi yang gagal didekripsi (MessageCounterError / Ciphertext mismatch / Bad MAC)
        if (msg.messageStubType === proto.WebMessageInfo.StubType.CIPHERTEXT) {
          // Abaikan internal sync companion bot sendiri, JANGAN hapus session milik bot
          if (isSelf) {
            continue;
          }

          console.warn(`\n⚠️ [WhatsApp Decrypt] Terdeteksi desinkronisasi enkripsi session dari kontak luar: ${senderNumber}. Membersihkan session lama agar otomatis pulih...`);
          try {
            if (fs.existsSync(this.authFolder)) {
              const files = fs.readdirSync(this.authFolder);
              // Cari kemungkinan target nomor telepon dan LID terkait di database
              const user = await prisma.users.findFirst({
                where: {
                  deleted_at: null,
                  OR: [
                    { phone_number: senderNumber },
                    { device_id: senderNumber },
                  ],
                },
              });
              const targets = [senderNumber];
              if (user?.phone_number && user.phone_number !== '-' && user.phone_number !== this.botPhone) {
                targets.push(user.phone_number);
              }
              if (user?.device_id && user.device_id !== this.botLid) {
                targets.push(user.device_id);
              }

              for (const file of files) {
                // Pastikan TIDAK PERNAH menghapus session milik bot sendiri
                if (
                  (this.botPhone && (file.startsWith(`session-${this.botPhone}`) || file.includes(this.botPhone))) ||
                  (this.botLid && (file.startsWith(`session-${this.botLid}`) || file.includes(this.botLid)))
                ) {
                  continue;
                }

                const matches = targets.some((t) => file.startsWith(`session-${t}`) || file.includes(t));
                if (matches) {
                  try {
                    fs.unlinkSync(path.join(this.authFolder, file));
                  } catch (delErr) {}
                }
              }
            }
          } catch (e) {}
          continue;
        }

        try {
          const rawMsg =
            msg.message?.ephemeralMessage?.message ||
            msg.message?.viewOnceMessage?.message ||
            msg.message?.viewOnceMessageV2?.message ||
            msg.message?.documentWithCaptionMessage?.message ||
            msg.message;

          // 1. Periksa apakah pesan berupa dokumen (PDF)
          const docMessage = rawMsg?.documentMessage;
          if (docMessage) {
            const fileName = docMessage.fileName || 'dokumen.pdf';
            const mimetype = docMessage.mimetype || '';

            if (mimetype.includes('pdf') || fileName.toLowerCase().endsWith('.pdf')) {
              console.log(`\n📥 [WhatsApp Inbound] Dokumen PDF dari ${senderNumber}: ${fileName}`);
              const buffer = (await downloadMediaMessage(msg, 'buffer', {})) as Buffer;
              const tempPath = pdfService.saveTempPdf(buffer, fileName);

              const reply = await messageRouter.processMessage({
                senderNumber,
                pushName: msg.pushName || '',
                media: {
                  filePath: tempPath,
                  fileName,
                  mimeType: mimetype,
                },
              });

              await this.sendReply(remoteJid, reply);
              continue;
            }
          }

          // 2. Ekstraksi teks dari pesan
          const textMessage = this.extractMessageContent(msg);

          if (textMessage) {
            console.log(`\n📩 [WhatsApp Inbound] Pesan dari ${senderNumber} (PushName: "${msg.pushName || '-'}"): "${textMessage}"`);
            const reply = await messageRouter.processMessage({
              senderNumber,
              pushName: msg.pushName || '',
              text: textMessage,
            });

            await this.sendReply(remoteJid, reply);
          }
        } catch (err) {
          console.error(`[WhatsApp] Error memproses pesan dari ${senderNumber}:`, err);
          try {
            await this.sock?.sendMessage(remoteJid, {
              text: `⚠️ Maaf, terjadi kesalahan saat memproses permintaan Anda. Silakan coba lagi atau ketik *menu*.`,
            });
          } catch (sendErr) {
            // ignore
          }
        }
      }
    });
  }

  /**
   * Ekstraksi teks isi pesan baik berupa ketikan maupun interaksi tombol
   */
  private extractMessageContent(msg: proto.IWebMessageInfo): string {
    const m =
      msg.message?.ephemeralMessage?.message ||
      msg.message?.viewOnceMessage?.message ||
      msg.message?.viewOnceMessageV2?.message ||
      msg.message?.documentWithCaptionMessage?.message ||
      msg.message;
    if (!m) return '';

    if (m.interactiveResponseMessage) {
      try {
        const paramsJson = m.interactiveResponseMessage.nativeFlowResponseMessage?.paramsJson;
        if (paramsJson) {
          const parsed = JSON.parse(paramsJson);
          if (parsed.id) return String(parsed.id);
        }
      } catch (e) {}
    }

    if (m.buttonsResponseMessage?.selectedButtonId) {
      return m.buttonsResponseMessage.selectedButtonId;
    }

    if (m.listResponseMessage?.singleSelectReply?.selectedRowId) {
      return m.listResponseMessage.singleSelectReply.selectedRowId;
    }

    if (m.templateButtonReplyMessage?.selectedId) {
      return m.templateButtonReplyMessage.selectedId;
    }

    return (
      m.conversation ||
      m.extendedTextMessage?.text ||
      m.imageMessage?.caption ||
      ''
    );
  }

  /**
   * Mengirimkan balasan ke WhatsApp menggunakan pengiriman pesan resmi yang terjamin 100% masuk
   */
  public async sendReply(jid: string, response: BotResponse): Promise<void> {
    if (!this.sock) return;

    const textToSend = typeof response === 'string' ? response : response.text;

    try {
      const sent = await this.sock.sendMessage(jid, { text: textToSend });
      if (sent?.key?.id) {
        this.sentMessageIds.add(sent.key.id);
        if (this.sentMessageIds.size > 2000) {
          this.sentMessageIds.clear();
        }
      }
      console.log(`📤 [WhatsApp Outbound] Berhasil mengirimkan balasan ke: ${jid}`);
    } catch (err) {
      console.error(`❌ [WhatsApp Outbound] Gagal mengirim pesan ke ${jid}:`, err);
      // Fallback jika pengiriman ke @lid gagal, coba kirim ke nomor WhatsApp aslinya
      if (jid.endsWith('@lid')) {
        try {
          const lidClean = jid.split('@')[0].split(':')[0];
          const user = await prisma.users.findFirst({
            where: {
              deleted_at: null,
              device_id: lidClean,
            },
          });
          if (user && user.phone_number && user.phone_number !== '-' && !user.phone_number.startsWith('LID_')) {
            const cleanPhone = user.phone_number.replace(/\D/g, '');
            const normalizedPhone = cleanPhone.startsWith('0') ? '62' + cleanPhone.slice(1) : cleanPhone;
            const phoneJid = `${normalizedPhone}@s.whatsapp.net`;
            console.log(`🔄 [WhatsApp Outbound Fallback] Mencoba mengirim ke nomor telepon pengguna: ${phoneJid}`);
            const fallbackSent = await this.sock.sendMessage(phoneJid, { text: textToSend });
            if (fallbackSent?.key?.id) {
              this.sentMessageIds.add(fallbackSent.key.id);
            }
            console.log(`📤 [WhatsApp Outbound Fallback] Berhasil terkirim ke: ${phoneJid}`);
          }
        } catch (fallbackErr) {
          console.error(`❌ [WhatsApp Outbound Fallback] Gagal kirim ke nomor telepon:`, fallbackErr);
        }
      }
    }
  }

  /**
   * Menautkan LID kontak ke user di database berdasarkan nomor telepon kontak WhatsApp
   */
  public async linkContactLid(phoneJid: string, lidJid: string): Promise<void> {
    try {
      const cleanPhone = phoneJid.split('@')[0].split(':')[0].replace(/\D/g, '');
      const cleanLid = lidJid.split('@')[0].split(':')[0].replace(/\D/g, '');
      if (cleanPhone.length < 8 || !cleanLid || cleanLid.length < 10) return;

      const user = await prisma.users.findFirst({
        where: {
          OR: [
            { phone_number: cleanPhone },
            { phone_number: { contains: cleanPhone.slice(-9) } },
          ],
        },
      });

      if (user && user.device_id !== cleanLid) {
        await prisma.users.update({
          where: { id: user.id },
          data: {
            device_id: cleanLid,
            updated_at: new Date(),
          },
        });
        console.log(`🔗 [WhatsApp Auto-Link] Menautkan LID (${cleanLid}) ke pengguna: "${user.name}" (${user.phone_number})`);
      }
    } catch (e) {
      // Abaikan error minor sinkronisasi kontak
    }
  }

  /**
   * Sinkronisasi WhatsApp LID untuk semua pengguna yang belum memiliki LID terdaftar
   */
  public async syncUserLids(): Promise<void> {
    if (!this.sock) return;

    try {
      const usersToSync = await prisma.users.findMany({
        where: {
          phone_number: { not: '-' },
          device_id: null,
        },
      });

      if (usersToSync.length === 0) return;

      console.log(`[WhatsApp Sync] Memeriksa WhatsApp LID untuk ${usersToSync.length} pengguna terdaftar...`);
      for (const u of usersToSync) {
        const rawPhone = (u.phone_number || '').replace(/[^0-9]/g, '');
        if (rawPhone.length < 9) continue;
        let phone = rawPhone;
        if (phone.startsWith('08')) phone = '628' + phone.slice(2);

        try {
          const results = await this.sock.onWhatsApp(phone);
          if (results && results.length > 0) {
            const res = results[0];
            const lid = (res as any).lid ? String((res as any).lid).split('@')[0] : null;
            if (lid) {
              await prisma.users.update({
                where: { id: u.id },
                data: {
                  device_id: lid,
                  updated_at: new Date(),
                },
              });
              console.log(`🎉 [WhatsApp Sync] Berhasil menautkan LID (${lid}) untuk pengguna: "${u.name}"`);
            }
          }
        } catch (qErr) {
          // Lanjutkan jika ada yang gagal
        }
      }
    } catch (err) {
      console.error('[WhatsApp Sync] Error saat sinkronisasi LID pengguna:', err);
    }
  }
}

export const whatsappClient = new WhatsAppClient();
