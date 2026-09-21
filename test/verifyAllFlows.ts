import { messageRouter } from '../src/bot/messageRouter';
import { prisma } from '../src/database/prisma';
import { createSampleInvitationPdf } from '../src/bot/simulator';
import fs from 'fs';
import { getResponseText, BotResponse } from '../src/bot/types';

const toText = (r: BotResponse): string => getResponseText(r);

async function runVerification() {
  console.log('===========================================================');
  console.log('🧪 MEMULAI PENGUJIAN OTOMATIS SELURUH ALUR FLOWCHART BOT');
  console.log('===========================================================\n');

  const registeredPhone = '6281200001111'; // Ibnu (Staf Protokol)
  const unregisteredPhone = '6289999999999';

  // 1. Test Autentikasi Pengguna Tidak Terdaftar
  console.log('--- TEST 1: Autentikasi Pengguna Tidak Terdaftar ---');
  const resAuthDenied = toText(
    await messageRouter.processMessage({
      senderNumber: unregisteredPhone,
      text: 'halo',
    })
  );
  console.log('Output:\n', resAuthDenied);
  if (!resAuthDenied.includes('AKSES DITOLAK')) {
    throw new Error('Test 1 Gagal: Harus menampilkan akses ditolak.');
  }
  console.log('✅ Test 1 Lulus: Akses ditolak untuk nomor tak terdaftar.\n');

  // 2. Test Autentikasi Pengguna Terdaftar & Menu Utama
  console.log('--- TEST 2: Menu Utama Pengguna Terdaftar ---');
  const resMainMenu = toText(
    await messageRouter.processMessage({
      senderNumber: registeredPhone,
      text: 'menu',
    })
  );
  console.log('Output:\n', resMainMenu);
  if (!resMainMenu.includes('Surat Masuk')) {
    throw new Error('Test 2 Gagal: Harus menampilkan menu utama.');
  }
  console.log('✅ Test 2 Lulus: Menu utama berhasil dimuat.\n');

  // 3. Test Menu 2: Jadwal Kegiatan
  console.log('--- TEST 3: Alur Jadwal Kegiatan ---');
  const resJadwalMenu = toText(
    await messageRouter.processMessage({
      senderNumber: registeredPhone,
      text: '2',
    })
  );
  console.log('Output:\n', resJadwalMenu);
  if (!resJadwalMenu.includes('JADWAL KEGIATAN PROTOKOL HARI INI')) {
    throw new Error('Test 3.1 Gagal: Harus menampilkan jadwal hari ini.');
  }

  // Cek Jadwal Berikutnya
  const resJadwalNext = toText(
    await messageRouter.processMessage({
      senderNumber: registeredPhone,
      text: '1',
    })
  );
  console.log('Output Jadwal Berikutnya:\n', resJadwalNext);

  // Cek Jadwal Mendatang
  const resJadwalMendatang = toText(
    await messageRouter.processMessage({
      senderNumber: registeredPhone,
      text: '2',
    })
  );
  console.log('Output Jadwal Mendatang:\n', resJadwalMendatang);

  // Cek Fitur Cari Jadwal Kegiatan (Pilihan 3)
  const resPromptCariJadwal = toText(
    await messageRouter.processMessage({
      senderNumber: registeredPhone,
      text: '3',
    })
  );
  console.log('Output Prompt Cari Jadwal:\n', resPromptCariJadwal);
  if (!resPromptCariJadwal.includes('PENCARIAN JADWAL KEGIATAN')) {
    throw new Error('Test 3.2 Gagal: Prompt cari jadwal tidak muncul.');
  }

  // Cari dengan kata kunci umum: "rapat"
  const resCariJadwalRapat = toText(
    await messageRouter.processMessage({
      senderNumber: registeredPhone,
      text: 'rapat',
    })
  );
  console.log('Output Cari Jadwal "rapat":\n', resCariJadwalRapat);
  if (!resCariJadwalRapat.includes('HASIL PENCARIAN JADWAL KEGIATAN')) {
    throw new Error('Test 3.3 Gagal: Hasil pencarian jadwal rapat tidak muncul.');
  }

  // Cari dengan kalimat spesifik: "Focus Group Discussion Hubungan Industrial"
  await messageRouter.processMessage({ senderNumber: registeredPhone, text: '3' });
  const resCariJadwalKalimat = toText(
    await messageRouter.processMessage({
      senderNumber: registeredPhone,
      text: 'Focus Group Discussion Hubungan Industrial',
    })
  );
  console.log('Output Cari Jadwal Kalimat Spesifik:\n', resCariJadwalKalimat);
  if (!resCariJadwalKalimat.includes('Focus Group Discussion')) {
    throw new Error('Test 3.4 Gagal: Pencarian kalimat spesifik jadwal tidak menemukan kegiatan.');
  }

  // Cari dengan kata acak terpisah: "pelatihan vokasi"
  await messageRouter.processMessage({ senderNumber: registeredPhone, text: '3' });
  const resCariJadwalMulti = toText(
    await messageRouter.processMessage({
      senderNumber: registeredPhone,
      text: 'pelatihan vokasi',
    })
  );
  console.log('Output Cari Jadwal Multi Kata:\n', resCariJadwalMulti);
  if (!resCariJadwalMulti.includes('Pelatihan Vokasi')) {
    throw new Error('Test 3.5 Gagal: Pencarian multi-kata jadwal tidak menemukan kegiatan.');
  }

  // Kembali ke menu
  await messageRouter.processMessage({
    senderNumber: registeredPhone,
    text: '0',
  });
  console.log('✅ Test 3 Lulus: Menu Jadwal Kegiatan (Hari ini, Mendatang, dan Fitur Cari Jadwal Cerdas) berfungsi sempurna.\n');

  // 4. Test Menu 3: Status Disposisi
  console.log('--- TEST 4: Alur Status Disposisi ---');
  const resDispPrompt = toText(
    await messageRouter.processMessage({
      senderNumber: registeredPhone,
      text: '3',
    })
  );
  console.log('Output Prompt:\n', resDispPrompt);

  // 4.1 Cek Surat yang SUDAH DISPOSISI
  const resDispSudah = toText(
    await messageRouter.processMessage({
      senderNumber: registeredPhone,
      text: 'UND/2026/09/0001',
    })
  );
  console.log('Output Status Sudah Disposisi:\n', resDispSudah);
  if (!resDispSudah.includes('SUDAH DISPOSISI')) {
    throw new Error('Test 4.1 Gagal: Surat harusnya berstatus SUDAH DISPOSISI.');
  }

  // 4.2 Cek Surat yang BELUM DISPOSISI
  await messageRouter.processMessage({ senderNumber: registeredPhone, text: '3' });
  const resDispBelum = toText(
    await messageRouter.processMessage({
      senderNumber: registeredPhone,
      text: 'AU/2026/09/0002',
    })
  );
  console.log('Output Status Belum Disposisi:\n', resDispBelum);
  if (!resDispBelum.includes('BELUM DISPOSISI')) {
    throw new Error('Test 4.2 Gagal: Surat harusnya berstatus BELUM DISPOSISI.');
  }

  // 4.3 Cek Surat yang Tidak Ditemukan
  await messageRouter.processMessage({ senderNumber: registeredPhone, text: '3' });
  const resDispNotFound = toText(
    await messageRouter.processMessage({
      senderNumber: registeredPhone,
      text: 'NOMOR-PALSU-999',
    })
  );
  console.log('Output Surat Tidak Ditemukan:\n', resDispNotFound);
  if (!resDispNotFound.includes('Tidak Ditemukan')) {
    throw new Error('Test 4.3 Gagal: Harus menampilkan Surat Tidak Ditemukan.');
  }
  console.log('✅ Test 4 Lulus: Pengecekan Status Disposisi bekerja akurat.\n');

  // 5. Test Menu 4: Riwayat Surat & Detail
  console.log('--- TEST 5: Alur Riwayat Surat ---');
  const resRiwayat = toText(
    await messageRouter.processMessage({
      senderNumber: registeredPhone,
      text: '4',
    })
  );
  console.log('Output Riwayat:\n', resRiwayat);
  if (!resRiwayat.includes('RIWAYAT SURAT MASUK')) {
    throw new Error('Test 5 Gagal: Tampilan riwayat surat tidak muncul.');
  }

  // Pilih surat ke-1 untuk lihat detail
  const resDetail = toText(
    await messageRouter.processMessage({
      senderNumber: registeredPhone,
      text: '1',
    })
  );
  console.log('Output Detail Surat 1:\n', resDetail);
  if (!resDetail.includes('DETAIL SURAT MASUK')) {
    throw new Error('Test 5.1 Gagal: Detail surat harus tampil.');
  }

  // Kembali ke menu
  await messageRouter.processMessage({ senderNumber: registeredPhone, text: '0' });
  await messageRouter.processMessage({ senderNumber: registeredPhone, text: '0' });
  console.log('✅ Test 5 Lulus: Riwayat surat dan detail surat berhasil ditampilkan.\n');

  // 6. Test Menu 5: Cari Surat Masuk Berdasarkan Perihal
  console.log('--- TEST 6: Alur Pencarian Surat Berdasarkan Perihal ---');
  const resCariPrompt = toText(
    await messageRouter.processMessage({
      senderNumber: registeredPhone,
      text: '5',
    })
  );
  console.log('Output Prompt Cari Surat:\n', resCariPrompt);
  if (!resCariPrompt.includes('PENCARIAN SURAT MASUK (PERIHAL)')) {
    throw new Error('Test 6.1 Gagal: Prompt cari surat tidak muncul.');
  }

  // 6.1 Cari dengan kata kunci "rapat"
  const resCariHasil = toText(
    await messageRouter.processMessage({
      senderNumber: registeredPhone,
      text: 'rapat',
    })
  );
  console.log('Output Hasil Cari "rapat":\n', resCariHasil);
  if (!resCariHasil.includes('HASIL PENCARIAN SURAT')) {
    throw new Error('Test 6.2 Gagal: Hasil pencarian perihal tidak muncul.');
  }

  // 6.2 Pilih surat ke-1 dari hasil pencarian untuk lihat detail
  const resCariDetail = toText(
    await messageRouter.processMessage({
      senderNumber: registeredPhone,
      text: '1',
    })
  );
  console.log('Output Detail Surat Hasil Cari:\n', resCariDetail);
  if (!resCariDetail.includes('DETAIL SURAT MASUK (PENCARIAN)')) {
    throw new Error('Test 6.3 Gagal: Detail surat dari pencarian tidak muncul.');
  }

  // 6.3 Cek Rincian Disposisi dari hasil pencarian
  const resCariDisposisi = toText(
    await messageRouter.processMessage({
      senderNumber: registeredPhone,
      text: '1',
    })
  );
  console.log('Output Rincian Disposisi Hasil Cari:\n', resCariDisposisi);
  if (!resCariDisposisi.includes('RINCIAN DISPOSISI')) {
    throw new Error('Test 6.4 Gagal: Rincian disposisi tidak muncul.');
  }

  // 6.4 Kembali ke daftar hasil cari
  const resKembaliList = toText(
    await messageRouter.processMessage({
      senderNumber: registeredPhone,
      text: 'back_list',
    })
  );
  console.log('Output Kembali ke List Hasil Cari:\n', resKembaliList);
  if (!resKembaliList.includes('HASIL PENCARIAN SURAT')) {
    throw new Error('Test 6.5 Gagal: Gagal kembali ke daftar hasil pencarian.');
  }

  // 6.5 Test Pencarian yang Tidak Ditemukan
  await messageRouter.processMessage({ senderNumber: registeredPhone, text: '5' });
  const resCariNotFound = toText(
    await messageRouter.processMessage({
      senderNumber: registeredPhone,
      text: 'keyword_palsu_tidak_ada_999',
    })
  );
  console.log('Output Cari Tidak Ditemukan:\n', resCariNotFound);
  if (!resCariNotFound.includes('Tidak ditemukan surat masuk')) {
    throw new Error('Test 6.6 Gagal: Pesan tidak ditemukan harus muncul.');
  }

  await messageRouter.processMessage({ senderNumber: registeredPhone, text: 'menu' });
  console.log('✅ Test 6 Lulus: Fitur Pencarian Surat Berdasarkan Perihal berfungsi 100% sempurna!\n');

  // 7. Test Menu 6: Bantuan
  console.log('--- TEST 7: Alur Pusat Bantuan ---');
  const resBantuan = toText(
    await messageRouter.processMessage({
      senderNumber: registeredPhone,
      text: '6',
    })
  );
  console.log('Output Bantuan:\n', resBantuan);
  if (!resBantuan.includes('PUSAT BANTUAN')) {
    throw new Error('Test 7 Gagal: Menu bantuan tidak muncul.');
  }

  const resBantuanUpload = toText(
    await messageRouter.processMessage({
      senderNumber: registeredPhone,
      text: '6',
    })
  );
  console.log('Output Bantuan Upload PDF:\n', resBantuanUpload);
  await messageRouter.processMessage({ senderNumber: registeredPhone, text: '0' });
  console.log('✅ Test 7 Lulus: Menu Bantuan berfungsi lancar.\n');

  // 8. Test Menu 1: Surat Masuk (Lengkap dari Upload, OCR Ekstraksi, Koreksi, AI Perihal, Simpan DB)
  console.log('--- TEST 8: Alur Surat Masuk (Upload, OCR, Koreksi Field, AI Perihal, DB Simpan) ---');
  
  // 7.1 Pilih Menu 1
  const step1 = toText(await messageRouter.processMessage({ senderNumber: registeredPhone, text: '1' }));
  console.log('Step 1 (Pilih Jenis):\n', step1);

  // 7.2 Pilih Jenis UND (1)
  const step2 = toText(await messageRouter.processMessage({ senderNumber: registeredPhone, text: '1' }));
  console.log('Step 2 (Nomor Agenda Generated):\n', step2);
  if (!step2.includes('Nomor Agenda yang digenerate sistem')) {
    throw new Error('Test 7.2 Gagal: Agenda tidak tergenerate.');
  }

  // 7.3 Konfirmasi Agenda: 1 (Ya)
  const step3 = toText(await messageRouter.processMessage({ senderNumber: registeredPhone, text: '1' }));
  console.log('Step 3 (Pilih Tipe Surat):\n', step3);

  // 7.4 Pilih Tipe: 3 (Penting)
  const step4 = toText(await messageRouter.processMessage({ senderNumber: registeredPhone, text: '3' }));
  console.log('Step 4 (Minta Upload PDF):\n', step4);
  if (!step4.includes('UNGGAH DOKUMEN SURAT (PDF)')) {
    throw new Error('Test 7.4 Gagal: Instruksi upload PDF tidak muncul.');
  }

  // 7.5 Upload Berkas PDF Surat Simulasi
  const samplePdf = await createSampleInvitationPdf();
  const step5 = toText(
    await messageRouter.processMessage({
      senderNumber: registeredPhone,
      media: {
        filePath: samplePdf,
        fileName: 'undangan_rakor_pmk.pdf',
        mimeType: 'application/pdf',
      },
    })
  );
  console.log('Step 5 (Hasil Ekstraksi Dokumen):\n', step5);
  if (!step5.includes('HASIL EKSTRAKSI DOKUMEN')) {
    throw new Error('Test 7.5 Gagal: Hasil ekstraksi dokumen tidak muncul.');
  }

  // 7.6 Test Koreksi Data: Pilih 2 (Tidak / Koreksi)
  const step6 = toText(await messageRouter.processMessage({ senderNumber: registeredPhone, text: '2' }));
  console.log('Step 6 (Pilih Field Koreksi):\n', step6);

  // 7.7 Pilih Field 5 (Event/Acara)
  const step7 = toText(await messageRouter.processMessage({ senderNumber: registeredPhone, text: '5' }));
  console.log('Step 7 (Prompt Koreksi Field):\n', step7);

  // 7.8 Masukkan nilai koreksi baru
  const step8 = toText(
    await messageRouter.processMessage({
      senderNumber: registeredPhone,
      text: 'Rakor Revitalisasi Balai Pelatihan Vokasi Nasional 2026',
    })
  );
  console.log('Step 8 (Review Setelah Koreksi):\n', step8);
  if (!step8.includes('Rakor Revitalisasi Balai Pelatihan Vokasi Nasional 2026')) {
    throw new Error('Test 7.8 Gagal: Nilai field tidak terupdate.');
  }

  // 7.9 Setujui Data Ekstraksi: 1 (Ya) -> Pilih Asal Instansi
  const step9 = toText(await messageRouter.processMessage({ senderNumber: registeredPhone, text: '1' }));
  console.log('Step 9 (Pilih Asal Instansi):\n', step9);
  if (!step9.includes('Asal Instansi')) {
    throw new Error('Test 7.9 Gagal: Menu kategori instansi tidak muncul.');
  }

  // 7.10 Pilih Asal Instansi: 1 (Pemerintah) -> AI Rekomendasi Perihal
  const step10 = toText(await messageRouter.processMessage({ senderNumber: registeredPhone, text: '1' }));
  console.log('Step 10 (Rekomendasi Perihal AI):\n', step10);
  if (!step10.includes('REKOMENDASI PERIHAL RESMI')) {
    throw new Error('Test 7.10 Gagal: Rekomendasi perihal tidak muncul.');
  }

  // 7.11 Gunakan Rekomendasi AI: 1 (Ya) -> Konfirmasi Final
  const step11 = toText(await messageRouter.processMessage({ senderNumber: registeredPhone, text: '1' }));
  console.log('Step 11 (Konfirmasi Final):\n', step11);
  if (!step11.includes('KONFIRMASI FINAL REGISTRASI SURAT')) {
    throw new Error('Test 7.11 Gagal: Tampilan konfirmasi final tidak muncul.');
  }

  // 7.12 Simpan Final: 1 (Ya, Simpan)
  const step12 = toText(await messageRouter.processMessage({ senderNumber: registeredPhone, text: '1' }));
  console.log('Step 12 (Hasil Simpan Database):\n', step12);
  if (!step12.includes('REGISTRASI SURAT BERHASIL')) {
    throw new Error('Test 7.12 Gagal: Surat tidak tersimpan.');
  }
  console.log('✅ Test 8 Lulus: Seluruh alur registrasi Surat Masuk selesai dengan sukses!\n');

  // 9. Verifikasi Data Tersimpan di Database SQLite
  console.log('--- TEST 9: Verifikasi Integritas Database ---');
  const latestSurat = await prisma.suratMasuk.findFirst({
    orderBy: { id: 'desc' },
    include: {
      disposisi: true,
      userInput: true,
    },
  });

  if (!latestSurat) {
    throw new Error('Test 9 Gagal: Surat terbaru tidak ditemukan di database.');
  }

  console.log('Surat Terbaru di Database:');
  console.log(`- ID            : ${latestSurat.id}`);
  console.log(`- Nomor Agenda  : ${latestSurat.nomorAgenda}`);
  console.log(`- Nomor Surat   : ${latestSurat.nomorSurat}`);
  console.log(`- Pengirim      : ${latestSurat.asalSurat}`);
  console.log(`- Perihal       : ${latestSurat.perihal}`);
  console.log(`- File Path     : ${latestSurat.filePath}`);
  console.log(`- File Exists?  : ${fs.existsSync(latestSurat.filePath)}`);
  console.log(`- Disposisi     : ${latestSurat.disposisi?.status}`);
  console.log(`- Penginput     : ${latestSurat.userInput.nama}`);

  if (!fs.existsSync(latestSurat.filePath)) {
    throw new Error('Test 9 Gagal: Berkas PDF tidak ditemukan di private storage.');
  }

  console.log('\n===========================================================');
  console.log('🎉 SEMUA PENGUJIAN ALUR FLOWCHART BERHASIL 100% LULUS!');
  console.log('===========================================================');
}

runVerification()
  .catch((e) => {
    console.error('❌ Test execution error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
