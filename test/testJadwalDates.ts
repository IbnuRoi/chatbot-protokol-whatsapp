import { messageRouter } from '../src/bot/messageRouter';
import { getResponseText } from '../src/bot/types';

const TEST_PHONE = '6283194046850';

async function test() {
  console.log('=====================================================');
  console.log('--- 1. JADWAL HARI INI ---');
  let r = await messageRouter.processMessage({ senderNumber: TEST_PHONE, text: 'ada agenda apa hari ini?' });
  console.log(getResponseText(r));

  console.log('\n=====================================================');
  console.log('--- 2. JADWAL BESOK ---');
  r = await messageRouter.processMessage({ senderNumber: TEST_PHONE, text: 'besok ada acara apa min?' });
  console.log(getResponseText(r));

  console.log('\n=====================================================');
  console.log('--- 3. JADWAL TERDEKAT ---');
  r = await messageRouter.processMessage({ senderNumber: TEST_PHONE, text: 'kegiatan terdekat apa?' });
  console.log(getResponseText(r));

  console.log('\n=====================================================');
  console.log('--- 4. JADWAL MENDATANG ---');
  r = await messageRouter.processMessage({ senderNumber: TEST_PHONE, text: 'jadwal mendatang' });
  console.log(getResponseText(r));

  console.log('\n=====================================================');
  console.log('--- 5. PENCARIAN JADWAL SPESIFIK (rakor) ---');
  r = await messageRouter.processMessage({ senderNumber: TEST_PHONE, text: 'cari jadwal rakor' });
  console.log(getResponseText(r));
}

test().catch(console.error);
