import { PrismaClient } from '@prisma/client';
import { getDatabaseUrl, ensureDatabaseReady, ProtocolScope } from './connection';
import { ENV } from '../config/env';

export { ProtocolScope };

/**
 * Membuat Prisma Client dengan query extension untuk auto-reconnect dan SSH Tunnel readiness
 */
function createExtendedClient(url: string, scope: ProtocolScope) {
  const baseClient = new PrismaClient({
    datasources: { db: { url } },
    log: process.env.NODE_ENV === 'development' ? ['query', 'warn'] : ['warn'],
  });

  return baseClient.$extends({
    query: {
      $allModels: {
        async $allOperations({ operation, model, args, query }) {
          if (ENV.SSH_ENABLED) {
            await ensureDatabaseReady();
          }

          const maxRetries = 2;
          let lastError: any;
          for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
              return await query(args);
            } catch (error: any) {
              lastError = error;
              const msg = (error?.message || '').toLowerCase();
              const isConnectionError =
                msg.includes('closed') ||
                msg.includes('connection') ||
                msg.includes('reach database') ||
                msg.includes('p1001') ||
                msg.includes('p1017') ||
                msg.includes('kind: closed');

              if (isConnectionError && attempt < maxRetries) {
                console.warn(
                  `⚠️ [Database ${scope}] Koneksi terputus/idle timeout (${operation} pada ${model}). Menyambung ulang (percobaan ke-${attempt + 1})...`
                );
                await new Promise((resolve) => setTimeout(resolve, 600 * attempt));
                continue;
              }
              throw error;
            }
          }
          throw lastError;
        },
      },
    },
  });
}

export type ExtendedPrismaClient = ReturnType<typeof createExtendedClient>;

class DatabaseManager {
  private clients: Map<ProtocolScope, ExtendedPrismaClient> = new Map();

  /**
   * Mengambil instance Prisma Client dinamis berdasarkan ruang lingkup (MENAKER / WAMEN).
   * Masing-masing ruang lingkup menggunakan koneksi yang di-cache secara efisien.
   */
  public getClient(scope: ProtocolScope = 'MENAKER'): ExtendedPrismaClient {
    const targetScope: ProtocolScope = scope === 'WAMEN' ? 'WAMEN' : 'MENAKER';
    let client = this.clients.get(targetScope);

    if (!client) {
      const url = getDatabaseUrl(targetScope);
      client = createExtendedClient(url, targetScope);
      this.clients.set(targetScope, client);
      console.log(`🐘 [DatabaseManager] Menginisialisasi Prisma Client untuk scope: [${targetScope}]`);
    }

    return client;
  }

  /**
   * Path folder penyimpanan dokumen upload surat sesuai ruang lingkup
   */
  public getUploadStoragePath(scope: ProtocolScope = 'MENAKER'): string {
    return scope === 'WAMEN' ? ENV.UPLOAD_STORAGE_PATH_WAMEN : ENV.UPLOAD_STORAGE_PATH;
  }

  /**
   * Path folder penyimpanan berkas disposisi sesuai ruang lingkup
   */
  public getDispositionStoragePath(scope: ProtocolScope = 'MENAKER'): string {
    return scope === 'WAMEN' ? ENV.DISPOSITION_STORAGE_PATH_WAMEN : ENV.DISPOSITION_STORAGE_PATH;
  }

  /**
   * Base URL publik untuk mengakses berkas surat sesuai ruang lingkup
   */
  public getFileUrl(scope: ProtocolScope = 'MENAKER'): string {
    return scope === 'WAMEN' ? (ENV.FILE_URL_WAMEN || ENV.FILE_URL) : ENV.FILE_URL;
  }

  /**
   * Base URL publik untuk mengakses berkas disposisi sesuai ruang lingkup
   */
  public getDispositionFileUrl(scope: ProtocolScope = 'MENAKER'): string {
    return scope === 'WAMEN'
      ? (ENV.DISPOSITION_FILE_URL_WAMEN || ENV.DISPOSITION_FILE_URL)
      : ENV.DISPOSITION_FILE_URL;
  }

  /**
   * Menutup seluruh koneksi Prisma Client
   */
  public async disconnectAll(): Promise<void> {
    for (const [scope, client] of this.clients.entries()) {
      try {
        await client.$disconnect();
        console.log(`🔌 [DatabaseManager] Prisma Client [${scope}] berhasil diputuskan.`);
      } catch (err: any) {
        console.warn(`⚠️ [DatabaseManager] Gagal memutuskan Prisma Client [${scope}]:`, err?.message || err);
      }
    }
    this.clients.clear();
  }
}

export const dbManager = new DatabaseManager();

