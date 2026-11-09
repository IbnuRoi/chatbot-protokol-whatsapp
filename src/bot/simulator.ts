import readline from 'readline';
import path from 'path';
import fs from 'fs';
import { messageRouter } from './messageRouter';
import { pdfService } from '../services/pdfService';
import { imageService } from '../services/imageService';
import { prisma } from '../database/prisma';
import { BotResponse } from './types';

import { generateValidTestPdf } from '../tools/generateSamplePdf';
import { dbManager } from '../database/dbManager';
import { sessionService } from '../services/sessionService';

export async function createSampleInvitationPdf(): Promise<string> {
  // Membuat berkas PDF dummy resmi untuk pengujian simulasi
  const tempDir = path.resolve(process.cwd(), 'storage', 'temp');
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

  const sampleFile = path.join(tempDir, 'contoh_undangan_resmi.pdf');
  const pdfBuffer = generateValidTestPdf();
  fs.writeFileSync(sampleFile, pdfBuffer);
  return sampleFile;
}

export async function runInteractiveSimulator() {
  console.log('================================================================');
  console.log('🤖 SIMULATOR TERMINAL CHATBOT WHATSAPP ADMINISTRASI PROTOKOL');
  console.log('================================================================');
  console.log('Perintah Tambahan Simulator:');
  console.log('  /upload              -> Simulasi mengirim file PDF surat resmi');
  console.log('  /upload <path_file>  -> Mengirimkan berkas PDF atau Gambar (JPG/PNG) dari komputer');
  console.log('  /upload_disposisi    -> Buka alur unggah lembar disposisi');
  console.log('  /user <nomor_wa>     -> Ganti nomor pengirim (otomatis mendeteksi Menteri vs Wamen)');
  console.log('  /users [wamen]       -> Tampilkan daftar user terdaftar (Menaker atau Wamen)');
  console.log('  /exit                -> Keluar dari simulator');
  console.log('================================================================\n');

  let currentPhone = '082299294269'; // Gufronation (Terdaftar di Database)

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const printBotReply = (reply: BotResponse) => {
    let msgs: string[] = [];
    if (typeof reply === 'string') {
      msgs = [reply];
    } else if (Array.isArray(reply)) {
      msgs = reply;
    } else if (reply.messages && reply.messages.length > 0) {
      msgs = reply.messages;
    } else if (reply.text) {
      msgs = [reply.text];
    }

    for (const text of msgs) {
      console.log(`\n🤖 [BOT]:\n${text}\n`);
    }

    if (typeof reply === 'object' && !Array.isArray(reply)) {
      if (reply.buttons && reply.buttons.length > 0) {
        console.log('🔘 [Tombol Quick Reply Meta (Sentuh di HP / Ketik di Terminal)]:');
        reply.buttons.forEach((b, idx) => {
          console.log(`   [${idx + 1}] ${b.text}  --> (Ketik: ${b.id})`);
        });
        console.log('');
      }

      if (reply.list) {
        console.log(`📋 [List Menu Meta: ${reply.list.buttonTitle}]:`);
        reply.list.sections.forEach((sec) => {
          console.log(`   📂 ${sec.title}`);
          sec.rows.forEach((r) => {
            console.log(`      • ${r.title} (ID: ${r.id})${r.description ? ` - ${r.description}` : ''}`);
          });
        });
        console.log('');
      }
    }
  };

  // Kirim salam pembuka otomatis
  const initialGreeting = await messageRouter.processMessage({
    senderNumber: currentPhone,
    text: 'menu',
  });
  printBotReply(initialGreeting);

  const promptUser = () => {
    const session = sessionService.getSession(currentPhone);
    const scopeLabel = session?.scope || 'MENAKER';
    rl.question(`👤 [${currentPhone} | ${scopeLabel}] > `, async (input) => {
      const trimmed = input.trim();

      if (trimmed === '/exit') {
        console.log('Keluar dari simulator.');
        rl.close();
        await dbManager.disconnectAll();
        process.exit(0);
      }

      if (trimmed.startsWith('/users')) {
        const targetScope = trimmed.includes('wamen') ? 'WAMEN' : 'MENAKER';
        try {
          const client = dbManager.getClient(targetScope);
          const users = await client.users.findMany({
            where: { deleted_at: null },
            select: { id: true, name: true, phone_number: true, device_id: true, role: true },
            orderBy: { id: 'asc' },
          });
          console.log(`\n📋 Daftar User Terdaftar [Scope: ${targetScope}]:`);
          if (users.length === 0) {
            console.log('   (Belum ada user yang terdaftar di database ini)');
          } else {
            users.forEach((u) => {
              const identifier = u.phone_number && u.phone_number !== '-' ? u.phone_number : (u.device_id || '-');
              console.log(`- ${identifier} | ${u.name} | Role: ${u.role || 'PROTOKOL'}`);
            });
          }
        } catch (err: any) {
          console.error(`❌ Gagal mengambil daftar user ${targetScope}:`, err?.message || err);
        }
        console.log('');
        promptUser();
        return;
      }

      if (trimmed.startsWith('/user ')) {
        currentPhone = trimmed.replace('/user ', '').trim();
        console.log(`🔄 Pengirim diganti menjadi: ${currentPhone}`);
        promptUser();
        return;
      }

      if (trimmed === '/upload' || trimmed.startsWith('/upload ')) {
        let filePath = '';
        let fileName = 'undangan_resmi_pmk.pdf';

        if (trimmed === '/upload') {
          filePath = await createSampleInvitationPdf();
        } else {
          let rawPath = trimmed.replace(/^\/upload\s+/i, '').trim();
          // Hapus tanda kutip jika user copy-as-path di Windows ("C:\path\file.pdf")
          rawPath = rawPath.replace(/^["']|["']$/g, '').trim();
          filePath = path.isAbsolute(rawPath) ? rawPath : path.resolve(process.cwd(), rawPath);
          fileName = path.basename(filePath);
        }

        if (!fs.existsSync(filePath)) {
          console.log(`❌ Berkas tidak ditemukan: ${filePath}`);
          console.log(`💡 Tips: Pastikan path file benar. Anda bisa drag & drop file ke terminal atau klik kanan > Copy as Path.`);
          promptUser();
          return;
        }

        const ext = path.extname(fileName).toLowerCase();
        const isImage = ['.jpg', '.jpeg', '.png', '.webp', '.bmp'].includes(ext);

        // Salin ke temp storage
        const buffer = fs.readFileSync(filePath);
        const savedTempPath = isImage
          ? imageService.saveTempImage(buffer, fileName)
          : pdfService.saveTempPdf(buffer, fileName);

        const mimeType = isImage ? (imageService.detectImageMimeType(buffer, ext) || 'image/jpeg') : 'application/pdf';

        console.log(`📤 Mengirim berkas ${isImage ? 'Gambar' : 'PDF'}: ${fileName} (${buffer.length} bytes)...`);
        const reply = await messageRouter.processMessage({
          senderNumber: currentPhone,
          media: {
            filePath: savedTempPath,
            fileName,
            mimeType,
            isImage,
          },
        });
        printBotReply(reply);
        promptUser();
        return;
      }

      // Pesan teks biasa
      const reply = await messageRouter.processMessage({
        senderNumber: currentPhone,
        text: trimmed,
      });

      printBotReply(reply);
      promptUser();
    });
  };

  promptUser();
}

// Jalankan jika file dieksekusi langsung
if (require.main === module) {
  runInteractiveSimulator().catch((err) => {
    console.error('Simulator error:', err);
  });
}
