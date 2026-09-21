import { prisma } from '../database/prisma';
import { authHandler } from '../bot/handlers/authHandler';

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.log('Penggunaan: npm run user:add <nomor_wa_atau_lid> <nama_pengguna> [role] [jabatan]');
    console.log('Contoh: npm run user:add 08123456789 "Budi Santoso" PROTOKOL "Staf Acara"');
    console.log('Contoh LID: npm run user:add 125142948642944 "Regina" PROTOKOL');
    process.exit(1);
  }

  const rawInput = args[0];
  const nama = args[1];
  const role = (args[2] || 'PROTOKOL').toUpperCase();
  const jabatan = args[3] || 'Staf Protokol';

  const normalized = authHandler.normalizePhoneNumber(rawInput);
  const isLid = rawInput.length >= 14 && !rawInput.startsWith('08') && !rawInput.startsWith('62');

  // Cek apakah user sudah ada berdasarkan nama atau nomor atau LID di tabel users
  const existingUser = await prisma.users.findFirst({
    where: {
      deleted_at: null,
      OR: [
        { phone_number: normalized },
        { phone_number: rawInput },
        { device_id: normalized },
        { device_id: rawInput },
        { name: { equals: nama, mode: 'insensitive' } },
      ],
    },
  });

  let user;
  if (existingUser) {
    user = await prisma.users.update({
      where: { id: existingUser.id },
      data: {
        name: nama,
        role,
        updated_at: new Date(),
        deleted_at: null,
        ...(isLid ? { device_id: normalized } : { phone_number: normalized }),
      },
    });
  } else {
    // Buat user baru di tabel users
    const cleanName = nama.toLowerCase().replace(/[^a-z0-9]/g, '') || 'user';
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const email = `${cleanName}_${randomSuffix}@kemnaker.go.id`;

    user = await prisma.users.create({
      data: {
        name: nama,
        email,
        password: '$2y$10$wK1k6s9JmFm00q7qY.0g6eT9EHz3U2FvYv6eWvYk4F4yR8gR7q9i.',
        role,
        phone_number: isLid ? '-' : normalized,
        device_id: isLid ? normalized : null,
        created_at: new Date(),
        updated_at: new Date(),
      },
    });
  }

  console.log(`\n✅ Berhasil mendaftarkan/memperbarui pengguna WhatsApp:`);
  console.log(`- Nomor WA : ${user.phone_number}`);
  console.log(`- LID      : ${user.device_id || '-'}`);
  console.log(`- Nama     : ${user.name}`);
  console.log(`- Role     : ${user.role}`);
  console.log(`- Status   : AKTIF (Dapat mengakses bot)\n`);
}

main()
  .catch((e) => {
    console.error('Gagal menambahkan user:', e);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
