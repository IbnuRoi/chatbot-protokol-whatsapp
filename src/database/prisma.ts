import { PrismaClient } from '@prisma/client';
import { getDatabaseUrl, ensureDatabaseReady } from './connection';
import { ENV } from '../config/env';

// URL dinamis dari connection manager (mendukung SSH Tunnel & direct PostgreSQL)
const dynamicUrl = getDatabaseUrl();

const basePrisma = new PrismaClient({
  datasources: dynamicUrl ? { db: { url: dynamicUrl } } : undefined,
  log: process.env.NODE_ENV === 'development' ? ['query', 'warn'] : ['warn'],
});

export const prisma = basePrisma.$extends({
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
                `⚠️ [Database] Koneksi terputus/idle timeout (${operation} pada ${model}). Menyambung ulang (percobaan ke-${attempt + 1})...`
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

