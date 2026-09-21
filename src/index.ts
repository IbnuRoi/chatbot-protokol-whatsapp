import { whatsappClient } from './bot/whatsappClient';
import { runInteractiveSimulator } from './bot/simulator';
import { initDatabaseConnection } from './database/connection';

async function main() {
  const args = process.argv.slice(2);
  const isSimulator = args.includes('--simulate') || args.includes('-s');

  console.log('======================================================');
  console.log('🏛️  SISTEM CHATBOT WHATSAPP ADMINISTRASI PROTOKOL');
  console.log('    Kementerian Ketenagakerjaan Republik Indonesia');
  console.log('======================================================');

  // Inisialisasi koneksi database & SSH Tunnel jika diaktifkan
  await initDatabaseConnection();

  if (isSimulator) {
    console.log('Mode: SIMULATOR TERMINAL (Testing Lokal)\n');
    await runInteractiveSimulator();
  } else {
    console.log('Mode: WHATSAPP CLIENT (Baileys Multi-Device QR)\n');
    console.log('💡 Tip: Untuk menjalankan simulator interaktif di terminal tanpa scan QR:');
    console.log('   npm run simulate\n');
    await whatsappClient.start();
  }
}

main().catch((err) => {
  console.error('Fatal error in application:', err);
  process.exit(1);
});
