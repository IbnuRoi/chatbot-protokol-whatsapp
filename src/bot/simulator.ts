import readline from 'readline';
import path from 'path';
import fs from 'fs';
import { messageRouter } from './messageRouter';
import { pdfService } from '../services/pdfService';
import { prisma } from '../database/prisma';
import { BotResponse } from './types';

import { generateValidTestPdf } from '../tools/generateSamplePdf';

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
  console.log('  /upload <path_pdf>   -> Mengirimkan file PDF kustom dari komputer');
  console.log('  /user <nomor_wa>     -> Ganti nomor WhatsApp pengirim');
  console.log('  /users               -> Tampilkan daftar nomor whitelist');
  console.log('  /exit                -> Keluar dari simulator');
  console.log('================================================================\n');

  let currentPhone = '082299294269'; // Gufronation (Terdaftar di Database)

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const printBotReply = (reply: BotResponse) => {
    const text = typeof reply === 'string' ? reply : reply.text;
    console.log(`\n🤖 [BOT]:\n${text}\n`);
  };

  // Kirim salam pembuka otomatis
  const initialGreeting = await messageRouter.processMessage({
    senderNumber: currentPhone,
    text: 'menu',
  });
  printBotReply(initialGreeting);

  const promptUser = () => {
    rl.question(`👤 [${currentPhone}] > `, async (input) => {
      const trimmed = input.trim();

      if (trimmed === '/exit') {
        console.log('Keluar dari simulator.');
        rl.close();
        await prisma.$disconnect();
        process.exit(0);
      }

      if (trimmed === '/users') {
        const users = await prisma.users.findMany({
          where: { deleted_at: null },
          select: { id: true, name: true, phone_number: true, device_id: true, role: true },
          orderBy: { id: 'asc' },
        });
        console.log('\n📋 Daftar User Terdaftar:');
        users.forEach((u) => {
          const identifier = u.phone_number && u.phone_number !== '-' ? u.phone_number : (u.device_id || '-');
          console.log(`- ${identifier} | ${u.name} | Role: ${u.role || 'PROTOKOL'}`);
        });
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
        let pdfPath = '';
        let fileName = 'undangan_resmi_pmk.pdf';

        if (trimmed === '/upload') {
          pdfPath = await createSampleInvitationPdf();
        } else {
          let rawPath = trimmed.replace(/^\/upload\s+/i, '').trim();
          // Hapus tanda kutip jika user copy-as-path di Windows ("C:\path\file.pdf")
          rawPath = rawPath.replace(/^["']|["']$/g, '').trim();
          pdfPath = path.isAbsolute(rawPath) ? rawPath : path.resolve(process.cwd(), rawPath);
          fileName = path.basename(pdfPath);
        }

        if (!fs.existsSync(pdfPath)) {
          console.log(`❌ Berkas tidak ditemukan: ${pdfPath}`);
          console.log(`💡 Tips: Pastikan path file benar. Anda bisa drag & drop file ke terminal atau klik kanan > Copy as Path.`);
          promptUser();
          return;
        }

        // Salin ke temp storage
        const buffer = fs.readFileSync(pdfPath);
        const savedTempPath = pdfService.saveTempPdf(buffer, fileName);

        console.log(`📤 Mengirim berkas PDF: ${fileName} (${buffer.length} bytes)...`);
        const reply = await messageRouter.processMessage({
          senderNumber: currentPhone,
          media: {
            filePath: savedTempPath,
            fileName,
            mimeType: 'application/pdf',
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
