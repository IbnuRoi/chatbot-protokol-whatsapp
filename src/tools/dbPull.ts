import { spawn } from 'child_process';
import { ensureDatabaseReady, closeDatabaseConnection } from '../database/connection';
import { ENV } from '../config/env';

function runCommand(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', shell: true });

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Perintah "${command} ${args.join(' ')}" keluar dengan kode status ${code}`));
      }
    });

    child.on('error', (err) => {
      reject(err);
    });
  });
}

async function main() {
  console.log('======================================================');
  console.log('📥 INTROSPEKSI SKEMA DATABASE KE PRISMA');
  console.log('======================================================\n');

  try {
    if (ENV.SSH_ENABLED) {
      console.log('🔒 [1/3] Mengaktifkan SSH Tunnel untuk introspeksi...');
      const info = await ensureDatabaseReady();
      console.log(`✅ Tunnel aktif di ${info.host}:${info.port} -> Remote DB: ${ENV.DB_NAME}\n`);
    }

    console.log('📥 [2/3] Mengambil skema tabel dari database (npx prisma db pull)...');
    await runCommand('npx', ['prisma', 'db', 'pull']);

    console.log('\n⚙️  [3/3] Memperbarui TypeScript Prisma Client (npx prisma generate)...');
    await runCommand('npx', ['prisma', 'generate']);

    console.log('\n======================================================');
    console.log('🎉 BERHASIL: File prisma/schema.prisma telah disinkronkan!');
    console.log('======================================================\n');
  } catch (err: any) {
    console.error('\n❌ Gagal melakukan introspeksi skema database:', err.message || err);
    process.exit(1);
  } finally {
    await closeDatabaseConnection();
  }
}

main().catch(console.error);
