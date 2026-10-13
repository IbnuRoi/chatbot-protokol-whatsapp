import { ensureDatabaseReady, closeDatabaseConnection } from '../database/connection';
import { syncDatabaseSequences } from '../database/sequenceSync';
import { prisma } from '../database/prisma';

async function main() {
  console.log('================================================================');
  console.log('🔧 UTILITY: SINKRONISASI ID SEQUENCE POSTGRESQL');
  console.log('   Menyinkronkan last_value sequence dengan MAX(id) di database');
  console.log('   Mencegah duplikasi ID antara Chatbot WhatsApp dan Website');
  console.log('================================================================');

  try {
    await ensureDatabaseReady();
    const results = await syncDatabaseSequences(undefined, false);

    console.log('----------------------------------------------------------------');
    console.log('Ringkasan Hasil Sinkronisasi:');
    for (const item of results) {
      console.log(`- Tabel ${item.table.padEnd(22)}: ${item.status.toUpperCase()} (MAX ID: ${item.maxId})`);
    }
    console.log('----------------------------------------------------------------');
    console.log('🎉 Semua sequence database berhasil disinkronkan!');
  } catch (err: any) {
    console.error('❌ Terjadi kesalahan saat sinkronisasi sequence:', err);
  } finally {
    await prisma.$disconnect();
    await closeDatabaseConnection();
    process.exit(0);
  }
}

main();
