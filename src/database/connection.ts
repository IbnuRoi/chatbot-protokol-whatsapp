import { ENV } from '../config/env';
import { sshTunnel } from './sshTunnel';

export interface DatabaseConnectionInfo {
  isTunnel: boolean;
  host: string;
  port: number;
  database: string;
  schema: string;
  user: string;
  url: string;
}

/**
 * Membangun URL koneksi PostgreSQL dinamis berdasarkan konfigurasi ENV.
 * Mengarahkan koneksi ke PostgreSQL lokal via SSH Tunnel atau Direct host.
 */
export function getDatabaseUrl(): string {
  const user = encodeURIComponent(ENV.DB_USER || 'postgres');
  const password = encodeURIComponent(ENV.DB_PASSWORD || '');
  const dbName = ENV.DB_NAME || 'postgres';
  const schema = ENV.DB_SCHEMA || 'public';

  // 1. Mode SSH Tunnel (Forwarding 127.0.0.1:localPort ke Remote PostgreSQL)
  if (ENV.SSH_ENABLED) {
    const localPort = sshTunnel.isRunning() ? sshTunnel.getLocalPort() : (ENV.DB_LOCAL_PORT || 5433);
    return `postgresql://${user}:${password}@127.0.0.1:${localPort}/${dbName}?schema=${schema}&sslmode=prefer`;
  }

  // 2. Mode Direct PostgreSQL
  if (ENV.DB_HOST && ENV.DB_USER && ENV.DB_NAME) {
    const host = ENV.DB_HOST;
    const port = ENV.DB_PORT || 5432;
    return `postgresql://${user}:${password}@${host}:${port}/${dbName}?schema=${schema}&sslmode=prefer`;
  }

  // 3. Gunakan DATABASE_URL jika ditentukan secara eksplisit
  if (ENV.DATABASE_URL) {
    return ENV.DATABASE_URL;
  }

  return `postgresql://${user}:${password}@127.0.0.1:${ENV.DB_LOCAL_PORT || 5433}/${dbName}?schema=${schema}&sslmode=prefer`;
}

/**
 * Memastikan koneksi database siap (termasuk mengaktifkan SSH Tunnel jika diperlukan)
 */
export async function ensureDatabaseReady(): Promise<DatabaseConnectionInfo> {
  let isTunnel = false;
  let activePort = ENV.DB_PORT || 5432;
  let activeHost = ENV.DB_HOST || '127.0.0.1';

  if (ENV.SSH_ENABLED) {
    if (!sshTunnel.isRunning()) {
      const tunnel = await sshTunnel.start();
      activePort = tunnel.localPort;
    } else {
      activePort = sshTunnel.getLocalPort();
    }
    activeHost = '127.0.0.1';
    isTunnel = true;
  }

  const url = getDatabaseUrl();

  return {
    isTunnel,
    host: activeHost,
    port: activePort,
    database: ENV.DB_NAME || 'default',
    schema: ENV.DB_SCHEMA || 'public',
    user: ENV.DB_USER || 'default',
    url,
  };
}

/**
 * Inisialisasi koneksi database saat aplikasi pertama kali boot
 */
export async function initDatabaseConnection(): Promise<DatabaseConnectionInfo> {
  console.log('\n🐘 [Database] Menginisialisasi koneksi database PostgreSQL...');
  
  if (ENV.SSH_ENABLED) {
    console.log(`🔒 [Database] Mode SSH Tunnel: AKTIF`);
    console.log(`   - SSH Host: ${ENV.SSH_USER}@${ENV.SSH_HOST}:${ENV.SSH_PORT}`);
    console.log(`   - Remote DB: ${ENV.DB_HOST}:${ENV.DB_PORT}`);
    console.log(`   - Local Port: 127.0.0.1:${ENV.DB_LOCAL_PORT}`);
  } else {
    console.log(`🌐 [Database] Mode Koneksi: DIRECT`);
    console.log(`   - Host: ${ENV.DB_HOST}:${ENV.DB_PORT}`);
  }

  console.log(`   - Database: ${ENV.DB_NAME || '(dari DATABASE_URL)'}`);
  console.log(`   - Schema: ${ENV.DB_SCHEMA || 'public'}`);

  const info = await ensureDatabaseReady();
  console.log('✅ [Database] Koneksi database siap digunakan oleh Prisma ORM.\n');
  return info;
}

/**
 * Menutup koneksi database dan SSH Tunnel dengan bersih
 */
export async function closeDatabaseConnection(): Promise<void> {
  if (ENV.SSH_ENABLED && sshTunnel.isRunning()) {
    await sshTunnel.stop();
  }
}
