import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ override: true });

export const ENV = {
  // Database & SSH Tunnel Configuration
  SSH_ENABLED: process.env.SSH_ENABLED === 'true',
  SSH_HOST: process.env.SSH_HOST || '',
  SSH_PORT: Number(process.env.SSH_PORT || 22),
  SSH_USER: process.env.SSH_USER || '',
  SSH_PASSWORD: process.env.SSH_PASSWORD || '',
  SSH_KEY_PATH: process.env.SSH_KEY_PATH || '',

  DB_HOST: process.env.DB_HOST || '127.0.0.1',
  DB_PORT: Number(process.env.DB_PORT || 5432),
  DB_USER: process.env.DB_USER || '',
  DB_PASSWORD: process.env.DB_PASSWORD || '',
  DB_NAME: process.env.DB_NAME || '',
  DB_SCHEMA: process.env.DB_SCHEMA || 'public',
  DB_LOCAL_PORT: Number(process.env.DB_LOCAL_PORT || 5433),

  DATABASE_URL: process.env.DATABASE_URL || '',
  DIRECT_URL: process.env.DIRECT_URL || '',

  // 1. Chat & NLU Intention (OpenRouter - Model Free Tanpa Biaya)
  CHAT_API_KEY: process.env.CHAT_API_KEY || process.env.OPENROUTER_API_KEY || '',
  CHAT_MODEL: process.env.CHAT_MODEL || process.env.OPENROUTER_MODEL || 'openrouter/free',

  // 2. Ekstraksi Dokumen PDF & Rekomendasi Perihal
  PDF_EXTRACTION_PROVIDER: process.env.PDF_EXTRACTION_PROVIDER || ((process.env.PDF_EXTRACTION_API_KEY || process.env.GEMINI_API_KEY || '').startsWith('sk-') ? 'openrouter' : 'gemini'),
  PDF_EXTRACTION_API_KEY: process.env.PDF_EXTRACTION_API_KEY || process.env.GEMINI_API_KEY || '',
  PDF_EXTRACTION_MODEL: process.env.PDF_EXTRACTION_MODEL || 'gemini-2.5-flash',

  // Backward compatibility aliases
  AI_PROVIDER: process.env.AI_PROVIDER || 'gemini',
  GEMINI_API_KEY: process.env.PDF_EXTRACTION_API_KEY || process.env.GEMINI_API_KEY || '',
  OPENROUTER_API_KEY: process.env.CHAT_API_KEY || process.env.OPENROUTER_API_KEY || '',
  OPENROUTER_MODEL: process.env.CHAT_MODEL || process.env.OPENROUTER_MODEL || 'openrouter/free',

  ADMIN_CONTACT: process.env.ADMIN_CONTACT || '0812-3456-7890 (Admin Tim IT Protokol)',
  TEMP_STORAGE_PATH: path.resolve(process.cwd(), process.env.TEMP_STORAGE_PATH || './storage/temp'),
  UPLOAD_STORAGE_PATH: path.resolve(
    process.cwd(),
    process.env.UPLOAD_STORAGE_PATH || process.env.PRIVATE_STORAGE_PATH || './storage/letters'
  ),
  PRIVATE_STORAGE_PATH: path.resolve(
    process.cwd(),
    process.env.UPLOAD_STORAGE_PATH || process.env.PRIVATE_STORAGE_PATH || './storage/letters'
  ),
  SESSION_TIMEOUT_MINUTES: 30,
  FILE_URL: process.env.FILE_URL || 'https://pwa-protokol.gatsu51.com/files/letter/',
};

// Pastikan direktori storage tersedia
import fs from 'fs';
if (!fs.existsSync(ENV.TEMP_STORAGE_PATH)) {
  fs.mkdirSync(ENV.TEMP_STORAGE_PATH, { recursive: true });
}
if (!fs.existsSync(ENV.UPLOAD_STORAGE_PATH)) {
  fs.mkdirSync(ENV.UPLOAD_STORAGE_PATH, { recursive: true });
}
