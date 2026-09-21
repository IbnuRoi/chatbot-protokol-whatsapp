import { prisma } from '../database/prisma';
import { authHandler } from '../bot/handlers/authHandler';

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.log('Penggunaan: npm run user:delete <nomor_wa_atau_id>');
    console.log('Contoh: npm run user:delete 082299294269');
    process.exit(1);
  }

  const rawPhone = args[0];
  const normalized = authHandler.normalizePhoneNumber(rawPhone);

  const res = await prisma.users.updateMany({
    where: {
      deleted_at: null,
      OR: [
        { phone_number: normalized },
        { phone_number: rawPhone },
        { device_id: normalized },
        { device_id: rawPhone },
      ],
    },
    data: {
      deleted_at: new Date(),
    },
  });

  if (res.count > 0) {
    console.log(`\n✅ Berhasil menghapus ${res.count} pengguna dengan nomor: ${rawPhone} (${normalized})\n`);
  } else {
    console.log(`\n⚠️ Tidak ditemukan pengguna dengan nomor: ${rawPhone}\n`);
  }
}

main()
  .catch((e) => {
    console.error('Gagal menghapus user:', e);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
