import { prisma } from '../database/prisma';
import { initDatabaseConnection, closeDatabaseConnection } from '../database/connection';
import { ENV } from '../config/env';

async function testConnection() {
  console.log('======================================================');
  console.log('🔍 PENGUJIAN KONEKSI DATABASE POSTGRESQL & PRISMA');
  console.log('======================================================\n');

  console.log('1. Parameter Konfigurasi:');
  console.log(`   - SSH Tunnel Enabled : ${ENV.SSH_ENABLED ? 'YA' : 'TIDAK'}`);
  if (ENV.SSH_ENABLED) {
    console.log(`   - SSH Host           : ${ENV.SSH_USER}@${ENV.SSH_HOST}:${ENV.SSH_PORT}`);
    console.log(`   - SSH Password       : ${ENV.SSH_PASSWORD ? '********' : '(KOSONG)'}`);
    console.log(`   - Forwarding Port    : 127.0.0.1:${ENV.DB_LOCAL_PORT} -> ${ENV.DB_HOST}:${ENV.DB_PORT}`);
  } else {
    console.log(`   - Direct DB Host     : ${ENV.DB_HOST}:${ENV.DB_PORT}`);
  }
  console.log(`   - Database User      : ${ENV.DB_USER || '(belum disetel)'}`);
  console.log(`   - Database Name      : ${ENV.DB_NAME || '(belum disetel)'}`);
  console.log(`   - Database Schema    : ${ENV.DB_SCHEMA || 'public'}`);
  console.log('');

  try {
    // 1. Inisialisasi koneksi (termasuk SSH Tunnel jika aktif)
    console.log('2. Membuka jalur koneksi...');
    const connInfo = await initDatabaseConnection();

    // 2. Eksekusi query diagnostik raw ke PostgreSQL
    console.log('3. Mengirim query pengujian ke PostgreSQL (Raw SQL)...');
    const rawResult = await prisma.$queryRaw<any[]>`
      SELECT 
        NOW() as server_time,
        current_database() as db_name,
        current_schema() as active_schema,
        version() as pg_version;
    `;

    console.log('   ✅ Query diagnostik berhasil dieksekusi!');
    if (rawResult && rawResult.length > 0) {
      const row = rawResult[0];
      console.log(`   - Server Time   : ${row.server_time}`);
      console.log(`   - Current DB    : ${row.db_name}`);
      console.log(`   - Current Schema: ${row.active_schema}`);
      console.log(`   - PG Version    : ${String(row.pg_version).split(' on ')[0]}`);
    }

    // 3. Verifikasi Prisma Model ORM
    console.log('\n4. Memverifikasi pembacaan tabel via Prisma ORM:');
    try {
      const userCount = await prisma.users.count();
      console.log(`   - Tabel 'users'   : ${userCount} baris data ditemukan.`);
    } catch (e: any) {
      console.warn(`   ⚠️ Tabel 'users': Gagal diakses (${e.message})`);
    }

    try {
      const letterCount = await prisma.letters.count();
      console.log(`   - Tabel 'letters' : ${letterCount} baris data ditemukan.`);
    } catch (e: any) {
      console.warn(`   ⚠️ Tabel 'letters': Gagal diakses (${e.message})`);
    }

    try {
      const eventCount = await prisma.events.count();
      console.log(`   - Tabel 'events'  : ${eventCount} baris data ditemukan.`);
    } catch (e: any) {
      console.warn(`   ⚠️ Tabel 'events': Gagal diakses (${e.message})`);
    }

    console.log('\n======================================================');
    console.log('🎉 SELURUH KONEKSI DATABASE POSTGRESQL & PRISMA BERHASIL!');
    console.log('======================================================\n');
  } catch (err: any) {
    console.error('\n❌ KONEKSI DATABASE GAGAL:');
    console.error(err.message || err);
    console.log('\n💡 Saran perbaikan:');
    console.log('1. Pastikan data kredensial di file .env sudah sesuai.');
    console.log('2. Jika menggunakan SSH Tunnel, pastikan SSH_HOST, SSH_USER, dan SSH_PASSWORD valid.');
    console.log('3. Pastikan port SSH dan port database remote tidak diblokir oleh firewall server.');
  } finally {
    await prisma.$disconnect();
    await closeDatabaseConnection();
  }
}

testConnection().catch(console.error);
