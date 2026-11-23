import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

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

  // Konfigurasi Database Multi-Tenancy (Menaker & Wamen)
  DB_NAME_MENAKER: process.env.DB_NAME_MENAKER || process.env.DB_NAME || '',
  DB_NAME_WAMEN: process.env.DB_NAME_WAMEN || 'appprotowamen_db',
  DATABASE_URL_WAMEN:
    process.env.DATABASE_URL_WAMEN ||
    (process.env.DATABASE_URL &&
    (process.env.DATABASE_URL.includes('wamen') || process.env.DATABASE_URL.includes('appprotowamen'))
      ? process.env.DATABASE_URL
      : '') ||
    'postgresql://appproto_user:DmCOkBzYCCUO@localhost:5432/appprotowamen_db?schema=public',
  DB_HOST_WAMEN: process.env.DB_HOST_WAMEN || '127.0.0.1',
  DB_PORT_WAMEN: Number(process.env.DB_PORT_WAMEN || 5432),
  DB_USER_WAMEN: process.env.DB_USER_WAMEN || 'appproto_user',
  DB_PASSWORD_WAMEN: process.env.DB_PASSWORD_WAMEN || 'DmCOkBzYCCUO',
  DB_SCHEMA_WAMEN: process.env.DB_SCHEMA_WAMEN || 'public',

  // 1. Chat & NLU Intention (OpenRouter - Model Free Tanpa Biaya)
  CHAT_API_KEY: process.env.CHAT_API_KEY || process.env.OPENROUTER_API_KEY || '',
  CHAT_MODEL: process.env.CHAT_MODEL || process.env.OPENROUTER_MODEL || 'openrouter/free',

  // 2. Ekstraksi Dokumen PDF & Rekomendasi Perihal
  PDF_EXTRACTION_PROVIDER: process.env.PDF_EXTRACTION_PROVIDER || ((process.env.PDF_EXTRACTION_API_KEY || process.env.CHAT_API_KEY || process.env.OPENROUTER_API_KEY || '').startsWith('sk-') ? 'openrouter' : 'gemini'),
  PDF_EXTRACTION_API_KEY: process.env.PDF_EXTRACTION_API_KEY || process.env.GEMINI_API_KEY || '',
  PDF_EXTRACTION_MODEL: process.env.PDF_EXTRACTION_MODEL || 'google/gemini-2.5-flash',

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
  FILE_URL: process.env.FILE_URL || '',
  DISPOSITION_STORAGE_PATH: path.resolve(
    process.cwd(),
    process.env.DISPOSITION_STORAGE_PATH || './storage/dispositions'
  ),
  DISPOSITION_FILE_URL: process.env.DISPOSITION_FILE_URL || '',

  // Lokasi Penyimpanan Dokumen Files Root (Disediakan Server Wamen / Symlink)
  FILES_ROOT: process.env.FILES_ROOT || '',
  FILES_ROOT_WAMEN:
    process.env.FILES_ROOT_WAMEN ||
    process.env.FILES_ROOT ||
    '/home/gatsu51/app/v3-protokolwamen.gatsu51.com/files',

  // Penyimpanan Berkas & URL Khusus Agenda Wamen (Multi-Tenancy)
  UPLOAD_STORAGE_PATH_WAMEN: (() => {
    if (process.env.UPLOAD_STORAGE_PATH_WAMEN) {
      return path.resolve(process.cwd(), process.env.UPLOAD_STORAGE_PATH_WAMEN);
    }
    const root = process.env.FILES_ROOT_WAMEN || process.env.FILES_ROOT;
    if (root && fs.existsSync(path.join(root, 'letter'))) {
      return path.join(root, 'letter');
    }
    return path.resolve(process.cwd(), './storage/letters_wamen');
  })(),
  FILE_URL_WAMEN:
    process.env.FILE_URL_WAMEN || 'https://v3-protokolwamen.gatsu51.com/files/letter/',
  DISPOSITION_STORAGE_PATH_WAMEN: (() => {
    if (process.env.DISPOSITION_STORAGE_PATH_WAMEN) {
      return path.resolve(process.cwd(), process.env.DISPOSITION_STORAGE_PATH_WAMEN);
    }
    const root = process.env.FILES_ROOT_WAMEN || process.env.FILES_ROOT;
    if (root && fs.existsSync(path.join(root, 'disposition'))) {
      return path.join(root, 'disposition');
    }
    return path.resolve(process.cwd(), './storage/dispositions_wamen');
  })(),
  DISPOSITION_FILE_URL_WAMEN:
    process.env.DISPOSITION_FILE_URL_WAMEN || 'https://v3-protokolwamen.gatsu51.com/files/disposition/',

  // 3. Meta WhatsApp Cloud API Configuration
  META_VERIFY_TOKEN: process.env.META_VERIFY_TOKEN || '',
  META_WA_TOKEN: process.env.META_WA_TOKEN || '',
  META_PHONE_NUMBER_ID: process.env.META_PHONE_NUMBER_ID || '',
  META_PHONE_NUMBER_ID_MENAKER: process.env.META_PHONE_NUMBER_ID_MENAKER || process.env.META_PHONE_NUMBER_ID || '',
  META_PHONE_NUMBER_ID_WAMEN: process.env.META_PHONE_NUMBER_ID_WAMEN || process.env.META_WA_PHONE_NUMBER_ID_WAMEN || '',
  META_WEBHOOK_PORT: Number(process.env.META_WEBHOOK_PORT || process.env.PORT || 3000),
  WHATSAPP_PROVIDER: process.env.WHATSAPP_PROVIDER || 'baileys',
  META_AUTO_TUNNEL:
    process.env.META_AUTO_TUNNEL === 'true' ||
    (process.env.META_AUTO_TUNNEL !== 'false' && !process.env.PUBLIC_BASE_URL && !process.env.META_WEBHOOK_URL),
  PUBLIC_BASE_URL: (process.env.PUBLIC_BASE_URL || process.env.META_WEBHOOK_URL || '').replace(/\/+$/, ''),
};

// Pastikan direktori storage tersedia
if (!fs.existsSync(ENV.TEMP_STORAGE_PATH)) {
  try {
    fs.mkdirSync(ENV.TEMP_STORAGE_PATH, { recursive: true });
  } catch {}
}
if (!fs.existsSync(ENV.UPLOAD_STORAGE_PATH)) {
  try {
    fs.mkdirSync(ENV.UPLOAD_STORAGE_PATH, { recursive: true });
  } catch {}
}
if (!fs.existsSync(ENV.DISPOSITION_STORAGE_PATH)) {
  try {
    fs.mkdirSync(ENV.DISPOSITION_STORAGE_PATH, { recursive: true });
  } catch {}
}
if (!fs.existsSync(ENV.UPLOAD_STORAGE_PATH_WAMEN)) {
  try {
    fs.mkdirSync(ENV.UPLOAD_STORAGE_PATH_WAMEN, { recursive: true });
  } catch {}
}
if (!fs.existsSync(ENV.DISPOSITION_STORAGE_PATH_WAMEN)) {
  try {
    fs.mkdirSync(ENV.DISPOSITION_STORAGE_PATH_WAMEN, { recursive: true });
  } catch {}
}
