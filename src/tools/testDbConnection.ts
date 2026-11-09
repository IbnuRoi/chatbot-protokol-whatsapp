import { prisma } from '../database/prisma';
import { dbManager } from '../database/dbManager';
import { initDatabaseConnection, closeDatabaseConnection, getDatabaseUrl } from '../database/connection';
import { ENV } from '../config/env';

async function testConnection() {
  console.log('======================================================');
  console.log('🔍 PENGUJIAN KONEKSI DATABASE POSTGRESQL & PRISMA');
  console.log('======================================================\n');

  console.log('1. Parameter Konfigurasi Umum:');
  console.log(`   - SSH Tunnel Enabled : ${ENV.SSH_ENABLED ? 'YA' : 'TIDAK'}`);
  if (ENV.SSH_ENABLED) {
    console.log(`   - SSH Host           : ${ENV.SSH_USER}@${ENV.SSH_HOST}:${ENV.SSH_PORT}`);
    console.log(`   - SSH Password       : ${ENV.SSH_PASSWORD ? '********' : '(KOSONG)'}`);
    console.log(`   - Forwarding Port    : 127.0.0.1:${ENV.DB_LOCAL_PORT} -> ${ENV.DB_HOST}:${ENV.DB_PORT}`);
  } else {
    console.log(`   - Direct DB Host     : ${ENV.DB_HOST}:${ENV.DB_PORT}`);
  }
  console.log('');

  try {
    // 1. Inisialisasi koneksi (termasuk SSH Tunnel jika aktif)
    console.log('2. Membuka jalur koneksi SSH Tunnel...');
    await initDatabaseConnection();

    // ------------------------------------------------------------------------
    // PENGUJIAN 1: DATABASE MENAKER (Default)
    // ------------------------------------------------------------------------
    console.log('\n======================================================');
    console.log('🏛️ [1/2] MENGUJI KONEKSI DATABASE MENAKER');
    console.log('======================================================');
    console.log(`   - Target DB Name     : ${ENV.DB_NAME_MENAKER || ENV.DB_NAME}`);
    console.log(`   - Target Schema      : ${ENV.DB_SCHEMA || 'public'}`);
    console.log(`   - Resolved DB URL    : ${getDatabaseUrl('MENAKER').replace(/:([^:@]+)@/, ':****@')}`);

    try {
      const menakerRaw = await prisma.$queryRaw<any[]>`
        SELECT 
          NOW() as server_time,
          current_database() as db_name,
          current_schema() as active_schema,
          version() as pg_version;
      `;
      if (menakerRaw && menakerRaw.length > 0) {
        const row = menakerRaw[0];
        console.log('   ✅ Query diagnostik Menaker berhasil!');
        console.log(`   - Server Time   : ${row.server_time}`);
        console.log(`   - Current DB    : ${row.db_name}`);
        console.log(`   - Current Schema: ${row.active_schema}`);
      }

      const mUserCount = await prisma.users.count();
      const mLetterCount = await prisma.letters.count();
      const mEventCount = await prisma.events.count();
      console.log(`   - Data: ${mUserCount} users, ${mLetterCount} letters, ${mEventCount} events.`);
    } catch (e: any) {
      console.warn(`   ⚠️ Peringatan DB Menaker: ${e.message}`);
    }

    // ------------------------------------------------------------------------
    // PENGUJIAN 2: DATABASE WAMEN (Wakil Menteri)
    // ------------------------------------------------------------------------
    console.log('\n======================================================');
    console.log('🏛️ [2/2] MENGUJI KONEKSI DATABASE WAMEN');
    console.log('======================================================');
    console.log(`   - Target DB Name     : ${ENV.DB_NAME_WAMEN}`);
    console.log(`   - Target DB User     : ${ENV.DB_USER_WAMEN}`);
    console.log(`   - Resolved DB URL    : ${getDatabaseUrl('WAMEN').replace(/:([^:@]+)@/, ':****@')}`);
    console.log(`   - Files Root Wamen   : ${ENV.FILES_ROOT_WAMEN}`);
    console.log(`   - File URL Wamen     : ${ENV.FILE_URL_WAMEN}`);

    try {
      const wamenClient = dbManager.getClient('WAMEN');
      const wamenRaw = await wamenClient.$queryRaw<any[]>`
        SELECT 
          NOW() as server_time,
          current_database() as db_name,
          current_schema() as active_schema,
          version() as pg_version;
      `;
      if (wamenRaw && wamenRaw.length > 0) {
        const row = wamenRaw[0];
        console.log('   ✅ Query diagnostik Wamen berhasil!');
        console.log(`   - Server Time   : ${row.server_time}`);
        console.log(`   - Current DB    : ${row.db_name}`);
        console.log(`   - Current Schema: ${row.active_schema}`);
      }

      const wUserCount = await wamenClient.users.count();
      const wLetterCount = await wamenClient.letters.count();
      const wEventCount = await wamenClient.events.count();
      console.log(`   - Data: ${wUserCount} users, ${wLetterCount} letters, ${wEventCount} events.`);
    } catch (e: any) {
      console.warn(`   ⚠️ Peringatan DB Wamen: ${e.message}`);
    }

    console.log('\n======================================================');
    console.log('🎉 PENGUJIAN KONEKSI DATABASE BERHASIL SELESAI!');
    console.log('======================================================\n');
  } catch (err: any) {
    console.error('\n❌ KONEKSI DATABASE GAGAL:');
    console.error(err.message || err);
    console.log('\n💡 Saran perbaikan:');
    console.log('1. Pastikan data kredensial di file .env sudah sesuai.');
    console.log('2. Jika menggunakan SSH Tunnel, pastikan SSH_HOST, SSH_USER, dan SSH_PASSWORD valid.');
    console.log('3. Pastikan port SSH dan port database remote tidak diblokir oleh firewall server.');
  } finally {
    await dbManager.disconnectAll();
    await closeDatabaseConnection();
  }
}

testConnection().catch(console.error);
