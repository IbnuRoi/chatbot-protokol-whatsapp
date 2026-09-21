import { sshTunnel } from '../database/sshTunnel';
import { ENV } from '../config/env';

async function main() {
  console.log('======================================================');
  console.log('🔒 STANDALONE SSH TUNNEL UNTUK DATABASE POSTGRESQL');
  console.log('======================================================\n');

  if (!ENV.SSH_HOST || !ENV.SSH_USER) {
    console.error('❌ Error: Kredensial SSH belum lengkap di .env!');
    console.error('Pastikan variabel SSH_HOST, SSH_PORT, SSH_USER, dan SSH_PASSWORD sudah terisi.');
    process.exit(1);
  }

  try {
    const { localPort } = await sshTunnel.start();

    console.log('\n------------------------------------------------------');
    console.log(`✅ Tunnel aktif di 127.0.0.1:${localPort}`);
    console.log(`➡️  Meneruskan ke remote PostgreSQL: ${ENV.DB_HOST}:${ENV.DB_PORT}`);
    console.log(`➡️  Database: ${ENV.DB_NAME} (Schema: ${ENV.DB_SCHEMA})`);
    console.log('------------------------------------------------------');
    console.log('\n💡 Anda sekarang dapat membuka terminal baru dan menjalankan:');
    console.log('   npm run db:studio');
    console.log('   atau menghubungkan GUI client (DBeaver/Navicat/TablePlus)');
    console.log('   Host: 127.0.0.1, Port: ' + localPort + ', User: ' + ENV.DB_USER + ', DB: ' + ENV.DB_NAME);
    console.log('\n(Tekan Ctrl + C di terminal ini untuk menutup tunnel)\n');

    // Jaga proses agar tetap hidup
    process.on('SIGINT', async () => {
      console.log('\nMenutup tunnel...');
      await sshTunnel.stop();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      await sshTunnel.stop();
      process.exit(0);
    });
  } catch (err: any) {
    console.error('❌ Gagal menjalankan SSH Tunnel:', err.message || err);
    process.exit(1);
  }
}

main().catch(console.error);
