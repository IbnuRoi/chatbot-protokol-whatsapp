import { whatsappClient } from './bot/whatsappClient';
import { runInteractiveSimulator } from './bot/simulator';
import { initDatabaseConnection } from './database/connection';
import { metaWebhookServer } from './bot/providers/metaWebhookServer';
import { ENV } from './config/env';

async function main() {
  const args = process.argv.slice(2);
  const isSimulator = args.includes('--simulate') || args.includes('-s');
  const isMeta = args.includes('--meta') || ENV.WHATSAPP_PROVIDER === 'meta';

  console.log('======================================================');
  console.log('🏛️  SISTEM CHATBOT WHATSAPP ADMINISTRASI PROTOKOL');
  console.log('    Kementerian Ketenagakerjaan Republik Indonesia');
  console.log('======================================================');

  // Inisialisasi koneksi database & SSH Tunnel jika diaktifkan
  try {
    await initDatabaseConnection();
  } catch (dbErr: any) {
    console.warn(`⚠️ [Database] Peringatan: Inisialisasi awal database gagal (${dbErr?.message || dbErr}).`);
    console.warn('   Sistem tetap melanjutkan startup agar Webhook/Simulator tetap aktif.');
    console.warn('   Koneksi database akan dicoba ulang secara otomatis saat query diperlukan.\n');
  }

  if (isSimulator) {
    console.log('Mode: SIMULATOR TERMINAL (Testing Lokal)\n');
    await runInteractiveSimulator();
  } else if (isMeta) {
    console.log('Mode: META WHATSAPP CLOUD API (Webhook Server)\n');
    await metaWebhookServer.start();
  } else {
    console.log('Mode: WHATSAPP CLIENT (Baileys Multi-Device QR)\n');
    console.log('💡 Tip: Untuk menjalankan simulator interaktif di terminal tanpa scan QR:');
    console.log('   npm run simulate\n');
    console.log('💡 Tip: Untuk menjalankan mode Meta WhatsApp Cloud API Webhook:');
    console.log('   npm run meta:webhook\n');
    await whatsappClient.start();
  }
}

main().catch((err) => {
  console.error('Fatal error in application:', err);
  process.exit(1);
});
