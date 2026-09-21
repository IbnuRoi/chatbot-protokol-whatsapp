import { messageRouter } from '../src/bot/messageRouter';
import { prisma } from '../src/database/prisma';
import { sessionService, BotState } from '../src/services/sessionService';
import { getResponseText } from '../src/bot/types';

const TEST_PHONE = '6283194046850'; // Arya (Admin)

async function runTests() {
  console.log('=====================================================');
  console.log('🧪 TESTING CONVERSATIONAL NLU & FLUID FLOWS');
  console.log('=====================================================\n');

  try {
    // 0. Reset session
    sessionService.deleteSession(TEST_PHONE);

    // TEST 1: Greeting ("halo min")
    console.log('--- TEST 1: Greeting ("halo min") ---');
    const res1 = await messageRouter.processMessage({
      senderNumber: TEST_PHONE,
      text: 'halo min',
    });
    if (!res1.text.toLowerCase().includes('halo')) {
      throw new Error('TEST 1 FAILED: Expected friendly greeting');
    }
    if (res1.buttons || res1.list) {
      throw new Error('TEST 1 FAILED: Response should not contain interactive buttons or list');
    }
    console.log('✅ TEST 1 PASSED: Pure conversational greeting bubble returned without interactive buttons/list\n');

    // TEST 2: Fluid Surat Masuk ("aku mau masukkin surat nih, bisa ngga?")
    console.log('--- TEST 2: Fluid Surat Masuk ("aku mau masukkin surat nih, bisa ngga?") ---');
    const res2 = await messageRouter.processMessage({
      senderNumber: TEST_PHONE,
      text: 'aku mau masukkin surat nih, bisa ngga?',
    });
    console.log('Bot Response 2:\n', getResponseText(res2));
    const session2 = sessionService.getSession(TEST_PHONE);
    if (session2?.state !== BotState.SURAT_MASUK_PILIH_JENIS) {
      throw new Error(`TEST 2 FAILED: Expected state SURAT_MASUK_PILIH_JENIS, got ${session2?.state}`);
    }
    // Verify no numbered list ("1.", "2.", etc.) in text prompt
    const res2Text = getResponseText(res2);
    if (res2Text.includes('1.') || res2Text.includes('2.')) {
      throw new Error('TEST 2 FAILED: Response still contains numbered list');
    }
    console.log('✅ TEST 2 PASSED: Fluid Surat Masuk recognized with clean AI bubble\n');

    // TEST 2b: Multi-step conversational without numbers ("undangan rapat" -> "sudah sesuai" -> "penting")
    console.log('--- TEST 2b: Conversational Selection ("undangan rapat" -> "sudah sesuai" -> "penting") ---');
    const res2b1 = await messageRouter.processMessage({
      senderNumber: TEST_PHONE,
      text: 'undangan rapat',
    });
    console.log('Bot Response 2b1:\n', getResponseText(res2b1));
    if (!getResponseText(res2b1).includes('Nomor Agenda yang digenerate sistem')) {
      throw new Error('TEST 2b FAILED: Expected agenda generation for "undangan rapat"');
    }

    const res2b2 = await messageRouter.processMessage({
      senderNumber: TEST_PHONE,
      text: 'sudah sesuai',
    });
    console.log('Bot Response 2b2:\n', getResponseText(res2b2));
    if (!getResponseText(res2b2).includes('Klasifikasi / Tipe Surat')) {
      throw new Error('TEST 2b FAILED: Expected tipe surat prompt for "sudah sesuai"');
    }

    const res2b3 = await messageRouter.processMessage({
      senderNumber: TEST_PHONE,
      text: 'penting',
    });
    console.log('Bot Response 2b3:\n', getResponseText(res2b3));
    if (!getResponseText(res2b3).includes('UNGGAH DOKUMEN SURAT (PDF)')) {
      throw new Error('TEST 2b FAILED: Expected PDF upload prompt for "penting"');
    }
    console.log('✅ TEST 2b PASSED: Multi-step conversational workflow without numbers succeeded!\n');

    // Reset back to main menu
    sessionService.resetSession(TEST_PHONE);

    // TEST 3: Conversational Jadwal Hari Ini ("ada agenda apa hari ini?")
    console.log('--- TEST 3: Jadwal Hari Ini ("ada agenda apa hari ini?") ---');
    const res3 = await messageRouter.processMessage({
      senderNumber: TEST_PHONE,
      text: 'ada agenda apa hari ini?',
    });
    console.log('Bot Response 3:\n', res3.text);
    if (!res3.text.toLowerCase().includes('jadwal kegiatan') && !res3.text.toLowerCase().includes('agenda')) {
      throw new Error('TEST 3 FAILED: Expected agenda response');
    }
    console.log('✅ TEST 3 PASSED: Conversational schedule request recognized\n');

    // Reset
    sessionService.resetSession(TEST_PHONE);

    // TEST 4: Conversational Jadwal Terdekat ("kegiatan terdekat apa?")
    console.log('--- TEST 4: Jadwal Terdekat ("kegiatan terdekat apa?") ---');
    const res4 = await messageRouter.processMessage({
      senderNumber: TEST_PHONE,
      text: 'kegiatan terdekat apa?',
    });
    console.log('Bot Response 4:\n', res4.text);
    if (!res4.text.toLowerCase().includes('kegiatan terdekat') && !res4.text.toLowerCase().includes('terdekat')) {
      throw new Error('TEST 4 FAILED: Expected next agenda response');
    }
    console.log('✅ TEST 4 PASSED: Nearest event recognized\n');

    // Reset
    sessionService.resetSession(TEST_PHONE);

    // TEST 5: Conversational Cari Surat ("ada surat tentang kunker?")
    console.log('--- TEST 5: Cari Surat ("cari surat tentang kemnaker") ---');
    const res5 = await messageRouter.processMessage({
      senderNumber: TEST_PHONE,
      text: 'cari surat tentang kemnaker',
    });
    console.log('Bot Response 5:\n', res5.text);
    if (!res5.text.toLowerCase().includes('pencarian surat') && !res5.text.toLowerCase().includes('hasil')) {
      throw new Error('TEST 5 FAILED: Expected letter search results');
    }
    console.log('✅ TEST 5 PASSED: Conversational letter search recognized\n');

    // Reset
    sessionService.resetSession(TEST_PHONE);

    // TEST 6: Conversational Chitchat ("kamu siapa?")
    console.log('--- TEST 6: Conversational Chitchat ("kamu siapa?") ---');
    const res6 = await messageRouter.processMessage({
      senderNumber: TEST_PHONE,
      text: 'kamu siapa?',
    });
    console.log('Bot Response 6:\n', res6.text);
    if (!res6.text.toLowerCase().includes('protokol') && !res6.text.toLowerCase().includes('asisten')) {
      throw new Error('TEST 6 FAILED: Expected polite response');
    }
    if (res6.buttons || res6.list) {
      throw new Error('TEST 6 FAILED: Response should not contain interactive buttons or list');
    }
    console.log('✅ TEST 6 PASSED: Chitchat handled gracefully as pure conversational bubble\n');

    // Reset
    sessionService.resetSession(TEST_PHONE);

    // TEST 7: Zero Regression for Direct Menu Numbers ("1")
    console.log('--- TEST 7: Zero Regression for Direct Numbers ("1") ---');
    const res7 = await messageRouter.processMessage({
      senderNumber: TEST_PHONE,
      text: '1',
    });
    const session7 = sessionService.getSession(TEST_PHONE);
    if (session7?.state !== BotState.SURAT_MASUK_PILIH_JENIS) {
      throw new Error(`TEST 7 FAILED: Expected state SURAT_MASUK_PILIH_JENIS, got ${session7?.state}`);
    }
    console.log('✅ TEST 7 PASSED: Direct numeric selection "1" still works instantaneously\n');

    // TEST 8: Selesai / Akhiri Sesi
    console.log('--- TEST 8: Selesai / Akhiri Sesi ("selesai makasih") ---');
    const res8 = await messageRouter.processMessage({
      senderNumber: TEST_PHONE,
      text: 'selesai makasih',
    });
    console.log('Bot Response 8:\n', getResponseText(res8));
    const session8 = sessionService.getSession(TEST_PHONE);
    if (session8) {
      throw new Error('TEST 8 FAILED: Session should have been deleted');
    }
    console.log('✅ TEST 8 PASSED: Session cleanly ended via conversational exit\n');

    // TEST 9: Pembatalan Alur ("gajadi deh")
    console.log('--- TEST 9: Pembatalan Alur ("gajadi deh") ---');
    // Start flow
    await messageRouter.processMessage({
      senderNumber: TEST_PHONE,
      text: 'mau masukin surat',
    });
    const session9Before = sessionService.getSession(TEST_PHONE);
    if (session9Before?.state !== BotState.SURAT_MASUK_PILIH_JENIS) {
      throw new Error(`TEST 9 setup failed: Expected state SURAT_MASUK_PILIH_JENIS, got ${session9Before?.state}`);
    }
    // Now user says "gajadi deh"
    const res9 = await messageRouter.processMessage({
      senderNumber: TEST_PHONE,
      text: 'gajadi deh',
    });
    console.log('Bot Response 9:\n', getResponseText(res9));
    const session9After = sessionService.getSession(TEST_PHONE);
    if (session9After?.state !== BotState.MAIN_MENU) {
      throw new Error(`TEST 9 FAILED: Expected state MAIN_MENU, got ${session9After?.state}`);
    }
    if (!getResponseText(res9).toLowerCase().includes('dibatalkan')) {
      throw new Error('TEST 9 FAILED: Response should mention "dibatalkan"');
    }
    console.log('✅ TEST 9 PASSED: Colloquial cancellation "gajadi deh" successfully cancelled the flow!\n');

    // TEST 10: Interupsi & Context Switch di Tengah Alur (Tanya jadwal saat alur surat aktif)
    console.log('--- TEST 10: Interupsi & Context Switch di Tengah Alur ---');
    await messageRouter.processMessage({
      senderNumber: TEST_PHONE,
      text: 'mau input surat undangan',
    });
    // Now user suddenly asks about schedule while waiting for agenda/PDF
    const res10 = await messageRouter.processMessage({
      senderNumber: TEST_PHONE,
      text: 'ada agenda apa hari ini?',
    });
    console.log('Bot Response 10:\n', getResponseText(res10));
    if (!getResponseText(res10).toLowerCase().includes('jadwal kegiatan') && !getResponseText(res10).toLowerCase().includes('agenda')) {
      throw new Error('TEST 10 FAILED: Expected context switch to schedule view');
    }
    console.log('✅ TEST 10 PASSED: Fluid context switching recognized and served immediately!\n');

    console.log('=====================================================');
    console.log('🎉 ALL CONVERSATIONAL NLU TESTS PASSED 100%!');
    console.log('=====================================================');
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runTests();
