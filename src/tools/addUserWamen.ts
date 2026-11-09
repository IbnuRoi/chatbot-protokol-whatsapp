import { dbManager } from '../database/dbManager';
import { authHandler } from '../bot/handlers/authHandler';
import { syncTableSequence } from '../database/sequenceSync';
import { ensureDatabaseReady, closeDatabaseConnection } from '../database/connection';
import { ENV } from '../config/env';

async function main() {
  const args = process.argv.slice(2);
  const emailInput = args[0] || 'ibnu@gmail.com';
  const phoneInput = args[1] || '085715378645';
  const nameInput = args[2] || 'Muhammad Ibnu Haudiroihan';
  const roleInput = (args[3] || 'PROTOKOL').toUpperCase();

  console.log('======================================================');
  console.log('👤 PENDAFTARAN USER BARU DATABASE WAMEN (WAKIL MENTERI)');
  console.log('======================================================\n');
  console.log('Parameter Input:');
  console.log(`- Nama Lengkap : ${nameInput}`);
  console.log(`- Email        : ${emailInput}`);
  console.log(`- Nomor WA     : ${phoneInput}`);
  console.log(`- Role         : ${roleInput}`);
  console.log(`- Target DB    : ${ENV.DB_NAME_WAMEN || 'appprotowamen_db'}`);
  console.log('');

  // 1. Pastikan koneksi & SSH tunnel siap
  if (ENV.SSH_ENABLED) {
    console.log('1. Membuka jalur SSH Tunnel ke database remote...');
    await ensureDatabaseReady();
  }

  const client = dbManager.getClient('WAMEN');

  // 2. Normalisasi nomor telepon
  const normalized = authHandler.normalizePhoneNumber(phoneInput);
  console.log(`2. Normalisasi Nomor: "${phoneInput}" -> "${normalized}"`);

  // 3. Sinkronisasi sequence tabel users sebelum memeriksa / menyisipkan
  try {
    await syncTableSequence('users', 'id', client);
  } catch (seqErr: any) {
    console.warn('⚠️ Catatan sinkronisasi sequence:', seqErr?.message || seqErr);
  }

  // 4. Periksa apakah user sudah ada
  console.log('3. Memeriksa keberadaan user di tabel users WAMEN...');
  const existingUser = await client.users.findFirst({
    where: {
      OR: [
        { email: emailInput },
        { phone_number: normalized },
        { phone_number: phoneInput },
        { phone_number: '0' + (normalized.startsWith('62') ? normalized.slice(2) : normalized) },
        { name: { equals: nameInput, mode: 'insensitive' } },
      ],
    },
  });

  let savedUser: any;
  if (existingUser) {
    console.log(`   ℹ️ User ditemukan dengan ID #${existingUser.id}. Memperbarui data...`);
    savedUser = await client.users.update({
      where: { id: existingUser.id },
      data: {
        name: nameInput,
        email: emailInput,
        phone_number: normalized,
        role: roleInput,
        deleted_at: null,
        updated_at: new Date(),
      },
    });
    console.log('   ✅ Data user berhasil diperbarui.');
  } else {
    console.log('   ℹ️ User belum terdaftar. Menambahkan user baru...');
    // Password bcrypt standar website: "password"
    const defaultPasswordHash = '$2y$10$wK1k6s9JmFm00q7qY.0g6eT9EHz3U2FvYv6eWvYk4F4yR8gR7q9i.';

    savedUser = await client.users.create({
      data: {
        name: nameInput,
        email: emailInput,
        password: defaultPasswordHash,
        role: roleInput,
        phone_number: normalized,
        created_at: new Date(),
        updated_at: new Date(),
        deleted_at: null,
      },
    });
    console.log(`   ✅ User baru berhasil disimpan dengan ID #${savedUser.id}.`);
  }

  // 5. Sinkronisasi sequence kembali setelah insert
  try {
    await syncTableSequence('users', 'id', client);
  } catch {}

  console.log('\n======================================================');
  console.log('🎉 PENGGUNA BERHASIL DIDAFTARKAN KE DATABASE WAMEN!');
  console.log('======================================================');
  console.log(`- ID Database : ${savedUser.id}`);
  console.log(`- Nama        : ${savedUser.name}`);
  console.log(`- Email       : ${savedUser.email}`);
  console.log(`- Nomor WA    : ${savedUser.phone_number}`);
  console.log(`- Role        : ${savedUser.role}`);
  console.log(`- Scope       : WAMEN (Wakil Menteri)`);
  console.log('======================================================\n');
}

main()
  .catch((err) => {
    console.error('\n❌ Gagal menambahkan user ke database Wamen:', err);
    process.exit(1);
  })
  .finally(async () => {
    await dbManager.disconnectAll();
    await closeDatabaseConnection();
  });
