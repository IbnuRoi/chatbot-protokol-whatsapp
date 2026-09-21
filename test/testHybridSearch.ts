import { messageRouter } from '../src/bot/messageRouter';
import { prisma } from '../src/database/prisma';
import { sessionService, BotState } from '../src/services/sessionService';
import { getResponseText } from '../src/bot/types';

const TEST_PHONE = '6281200001111'; // Staf Protokol (Ibnu)

async function runHybridTests() {
  console.log('=====================================================');
  console.log('🧪 TESTING HYBRID SEARCH (JADWAL & SURAT MASUK)');
  console.log('=====================================================\n');

  try {
    // TEST 1: Non-specific query with matches in BOTH ("cari tentang vokasi")
    console.log('--- TEST 1: Query with matches in BOTH ("cari tentang vokasi") ---');
    sessionService.resetSession(TEST_PHONE);

    const res1 = await messageRouter.processMessage({
      senderNumber: TEST_PHONE,
      text: 'cari tentang vokasi',
    });

    const res1Text = getResponseText(res1);
    console.log('Response 1:\n', res1Text);

    const session1 = sessionService.getSession(TEST_PHONE);
    if (session1?.state !== BotState.SEARCH_HYBRID_HASIL) {
      throw new Error(`TEST 1 FAILED: Expected state SEARCH_HYBRID_HASIL, got ${session1?.state}`);
    }

    if (!res1Text.includes('AGENDA KEGIATAN PROTOKOL') || !res1Text.includes('ARSIP SURAT MASUK')) {
      throw new Error('TEST 1 FAILED: Expected both AGENDA and SURAT sections in a single bubble');
    }

    if (!res1Text.includes('Tanggal Pelaksanaan')) {
      throw new Error('TEST 1 FAILED: Expected Tanggal Pelaksanaan in schedule section');
    }

    console.log('✅ TEST 1 PASSED: Single chat bubble contains BOTH Jadwal & Surat with formatted dates!\n');

    // TEST 2: Inspecting detail from hybrid search ("surat 1")
    console.log('--- TEST 2: Selecting letter from hybrid list ("surat 1") ---');
    const res2 = await messageRouter.processMessage({
      senderNumber: TEST_PHONE,
      text: 'surat 1',
    });

    const res2Text = getResponseText(res2);
    console.log('Response 2:\n', res2Text);

    const session2 = sessionService.getSession(TEST_PHONE);
    if (session2?.state !== BotState.CARI_SURAT_DETAIL) {
      throw new Error(`TEST 2 FAILED: Expected state CARI_SURAT_DETAIL, got ${session2?.state}`);
    }

    if (!res2Text.includes('DETAIL SURAT MASUK')) {
      throw new Error('TEST 2 FAILED: Expected letter detail view');
    }

    console.log('✅ TEST 2 PASSED: Letter detail opened successfully from hybrid list!\n');

    // TEST 3: Another query matching both ("ada apa tentang apindo?")
    console.log('--- TEST 3: Query matching both ("ada apa tentang apindo?") ---');
    sessionService.resetSession(TEST_PHONE);

    const res3 = await messageRouter.processMessage({
      senderNumber: TEST_PHONE,
      text: 'ada apa tentang apindo?',
    });

    const res3Text = getResponseText(res3);
    console.log('Response 3:\n', res3Text);

    if (!res3Text.includes('AGENDA KEGIATAN PROTOKOL') || !res3Text.includes('ARSIP SURAT MASUK')) {
      throw new Error('TEST 3 FAILED: Expected both AGENDA and SURAT for APINDO');
    }

    console.log('✅ TEST 3 PASSED: APINDO hybrid search returned both in one bubble!\n');

    // TEST 4: Query matching both ("info k3")
    console.log('--- TEST 4: Query matching both ("info k3") ---');
    sessionService.resetSession(TEST_PHONE);

    const res4 = await messageRouter.processMessage({
      senderNumber: TEST_PHONE,
      text: 'info k3',
    });

    const res4Text = getResponseText(res4);
    console.log('Response 4:\n', res4Text);

    if (!res4Text.includes('AGENDA KEGIATAN PROTOKOL') || !res4Text.includes('ARSIP SURAT MASUK')) {
      throw new Error('TEST 4 FAILED: Expected both AGENDA and SURAT for K3');
    }

    console.log('✅ TEST 4 PASSED: K3 hybrid search returned both in one bubble!\n');

    // TEST 5: Query where ONLY Jadwal exists ("cek rapim")
    console.log('--- TEST 5: Query where ONLY Jadwal exists ("cek rapim") ---');
    sessionService.resetSession(TEST_PHONE);

    const res5 = await messageRouter.processMessage({
      senderNumber: TEST_PHONE,
      text: 'cek rapim',
    });

    const res5Text = getResponseText(res5);
    console.log('Response 5:\n', res5Text);

    const session5 = sessionService.getSession(TEST_PHONE);
    if (session5?.state !== BotState.JADWAL_CARI_HASIL) {
      throw new Error(`TEST 5 FAILED: Expected state JADWAL_CARI_HASIL, got ${session5?.state}`);
    }

    if (res5Text.includes('ARSIP SURAT MASUK')) {
      throw new Error('TEST 5 FAILED: Should not contain surat section when no surat matched');
    }

    console.log('✅ TEST 5 PASSED: Only Jadwal matched and displayed properly!\n');

    // TEST 6: Query where ONLY Surat exists ("laporan investigasi khusus cilegon")
    console.log('--- TEST 6: Query where ONLY Surat exists ("laporan investigasi khusus cilegon") ---');
    sessionService.resetSession(TEST_PHONE);

    const res6 = await messageRouter.processMessage({
      senderNumber: TEST_PHONE,
      text: 'laporan investigasi khusus cilegon',
    });

    const res6Text = getResponseText(res6);
    console.log('Response 6:\n', res6Text);

    const session6 = sessionService.getSession(TEST_PHONE);
    if (session6?.state !== BotState.CARI_SURAT_HASIL_LIST) {
      throw new Error(`TEST 6 FAILED: Expected state CARI_SURAT_HASIL_LIST, got ${session6?.state}`);
    }

    if (res6Text.includes('AGENDA KEGIATAN PROTOKOL')) {
      throw new Error('TEST 6 FAILED: Should not contain jadwal section when no jadwal matched');
    }

    console.log('✅ TEST 6 PASSED: Only Surat matched and displayed properly!\n');

    // TEST 7: Dedicated Menu 5 Search (Menu 5 -> "vokasi" should be SURAT ONLY)
    console.log('--- TEST 7: Dedicated Menu 5 Search (Must stay Surat Only) ---');
    sessionService.resetSession(TEST_PHONE);

    // Enter Menu 5
    await messageRouter.processMessage({
      senderNumber: TEST_PHONE,
      text: '5',
    });

    // Enter keyword "vokasi"
    const res7 = await messageRouter.processMessage({
      senderNumber: TEST_PHONE,
      text: 'vokasi',
    });

    const res7Text = getResponseText(res7);
    console.log('Response 7:\n', res7Text);

    const session7 = sessionService.getSession(TEST_PHONE);
    if (session7?.state !== BotState.CARI_SURAT_HASIL_LIST) {
      throw new Error(`TEST 7 FAILED: Expected state CARI_SURAT_HASIL_LIST, got ${session7?.state}`);
    }

    if (res7Text.includes('AGENDA KEGIATAN PROTOKOL')) {
      throw new Error('TEST 7 FAILED: Menu 5 search should never show agenda kegiatan');
    }

    console.log('✅ TEST 7 PASSED: Dedicated Menu 5 search is strictly Surat Only!\n');

    // TEST 8: Dedicated Menu 2 -> 3 Search (Menu 2 -> 3 -> "vokasi" should be JADWAL ONLY)
    console.log('--- TEST 8: Dedicated Menu 2 -> 3 Search (Must stay Jadwal Only) ---');
    sessionService.resetSession(TEST_PHONE);

    // Enter Menu 2
    await messageRouter.processMessage({
      senderNumber: TEST_PHONE,
      text: '2',
    });

    // Enter Option 3 (Cari Jadwal)
    await messageRouter.processMessage({
      senderNumber: TEST_PHONE,
      text: '3',
    });

    // Enter keyword "vokasi"
    const res8 = await messageRouter.processMessage({
      senderNumber: TEST_PHONE,
      text: 'vokasi',
    });

    const res8Text = getResponseText(res8);
    console.log('Response 8:\n', res8Text);

    const session8 = sessionService.getSession(TEST_PHONE);
    if (session8?.state !== BotState.JADWAL_CARI_HASIL) {
      throw new Error(`TEST 8 FAILED: Expected state JADWAL_CARI_HASIL, got ${session8?.state}`);
    }

    if (res8Text.includes('ARSIP SURAT MASUK')) {
      throw new Error('TEST 8 FAILED: Menu 2->3 search should never show surat masuk');
    }

    console.log('✅ TEST 8 PASSED: Dedicated Menu 2->3 search is strictly Jadwal Only!\n');

    console.log('=====================================================');
    console.log('🎉 ALL HYBRID SEARCH TESTS PASSED 100%!');
    console.log('=====================================================');
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runHybridTests();
