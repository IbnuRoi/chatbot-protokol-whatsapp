import { messageRouter } from '../src/bot/messageRouter';
import { prisma } from '../src/database/prisma';
import { sessionService } from '../src/services/sessionService';

async function run() {
  const testPhone = '6281200001111'; // Staf Protokol (Ibnu)

  console.log('========================================================');
  console.log('🧪 TEST 1: User types sentence "surat undangan acara rakor"');
  console.log('========================================================');
  sessionService.resetSession(testPhone);

  const res1 = await messageRouter.processMessage({
    senderNumber: testPhone,
    text: 'surat undangan acara rakor',
  });

  console.log('Bot Response Text:\n', typeof res1 === 'string' ? res1 : res1.text);

  console.log('\n========================================================');
  console.log('🧪 TEST 2: Consecutive selection or search in CARI_SURAT_HASIL_LIST');
  console.log('========================================================');
  // Pilih surat nomor 1
  const res2 = await messageRouter.processMessage({
    senderNumber: testPhone,
    text: '1',
  });
  console.log('Bot Detail Response:\n', typeof res2 === 'string' ? res2 : res2.text);

  console.log('\n========================================================');
  console.log('🧪 TEST 3: User searches another sentence "dokumen terkait kecelakaan kerja pabrik cilegon"');
  console.log('========================================================');
  sessionService.resetSession(testPhone);

  const res3 = await messageRouter.processMessage({
    senderNumber: testPhone,
    text: 'dokumen terkait kecelakaan kerja pabrik cilegon',
  });
  console.log('Bot Response Text:\n', typeof res3 === 'string' ? res3 : res3.text);

  console.log('\n========================================================');
  console.log('🧪 TEST 4: User searches with acronyms "surat rakor phk apindo"');
  console.log('========================================================');
  sessionService.resetSession(testPhone);

  const res4 = await messageRouter.processMessage({
    senderNumber: testPhone,
    text: 'surat rakor phk apindo',
  });
  console.log('Bot Response Text:\n', typeof res4 === 'string' ? res4 : res4.text);
}

run()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
