import { PrismaClient } from '@prisma/client';
import path from 'path';
import fs from 'fs';

const prisma = new PrismaClient();

function getTodayDateString(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getOffsetDateString(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function main() {
  console.log('Seeding initial data for WhatsApp Protocol Chatbot...');

  // 1. Clear existing data
  await prisma.auditLog.deleteMany({});
  await prisma.disposisiSurat.deleteMany({});
  await prisma.jadwalKegiatan.deleteMany({});
  await prisma.suratMasuk.deleteMany({});
  await prisma.user.deleteMany({});

  // 2. Seed Whitelist Users
  const admin = await prisma.user.create({
    data: {
      whatsappNumber: '6281234567890',
      nama: 'Ahmad Faisal (Admin Protokol)',
      role: 'ADMIN',
      jabatan: 'Koordinator Subbagian Protokol',
      isActive: true,
    },
  });

  const pimpinan = await prisma.user.create({
    data: {
      whatsappNumber: '6281198765432',
      nama: 'Bpk. Sekretaris Jenderal',
      role: 'PIMPINAN',
      jabatan: 'Sekretaris Jenderal Kemnaker',
      isActive: true,
    },
  });

  const staf = await prisma.user.create({
    data: {
      whatsappNumber: '6281200001111',
      nama: 'Ibnu (Staf Protokol)',
      role: 'PROTOKOL',
      jabatan: 'Pengadministrasi Surat & Jadwal',
      isActive: true,
    },
  });

  console.log('Whitelisted users created: 3 users');

  // 3. Create sample dummy PDF files in private storage
  const privateStorage = path.resolve(process.cwd(), 'storage', 'private');
  if (!fs.existsSync(privateStorage)) {
    fs.mkdirSync(privateStorage, { recursive: true });
  }

  const samplePdfPath1 = path.join(privateStorage, 'UND-2026-09-0001.pdf');
  const samplePdfPath2 = path.join(privateStorage, 'AU-2026-09-0002.pdf');
  const samplePdfPath3 = path.join(privateStorage, 'PH-2026-09-0003.pdf');

  if (!fs.existsSync(samplePdfPath1)) fs.writeFileSync(samplePdfPath1, '%PDF-1.4 sample content');
  if (!fs.existsSync(samplePdfPath2)) fs.writeFileSync(samplePdfPath2, '%PDF-1.4 sample content');
  if (!fs.existsSync(samplePdfPath3)) fs.writeFileSync(samplePdfPath3, '%PDF-1.4 sample content');

  // 4. Seed Surat Masuk & Disposisi
  const surat1 = await prisma.suratMasuk.create({
    data: {
      nomorAgenda: 'UND/2026/09/0001',
      jenisSurat: 'UND',
      tipeSurat: 'Penting',
      nomorSurat: 'B-104/MENKO/MARVES/IX/2026',
      tanggalSurat: getTodayDateString(),
      subject: 'Undangan Rapat Koordinasi Tingkat Menteri tentang Kebijakan Ketenagakerjaan',
      asalSurat: 'Kemenko Bidang Kemaritiman dan Investasi',
      asalInstansi: 'Pemerintah',
      event: 'Rakor Kebijakan Investasi & Tenaga Kerja',
      picPengirim: 'Humas Kemenko Marves (0811-2233-4455)',
      perihal: 'Rapat Koordinasi Tingkat Menteri Kebijakan Tenaga Kerja Maritim',
      filePath: samplePdfPath1,
      fileName: 'UND-2026-09-0001.pdf',
      fileSize: 245000,
      userInputId: staf.id,
      disposisi: {
        create: {
          status: 'SUDAH_DISPOSISI',
          tanggalDisposisi: new Date(),
          tujuanDisposisi: 'Dirjen Binapenta & PKK',
          instruksi: 'Hadir mewakili Menteri dan laporkan hasil rakor.',
          catatan: 'Siapkan data penempatan tenaga kerja tahun 2026.',
        },
      },
    },
  });

  const surat2 = await prisma.suratMasuk.create({
    data: {
      nomorAgenda: 'AU/2026/09/0002',
      jenisSurat: 'AU',
      tipeSurat: 'Biasa',
      nomorSurat: '045/DPP-SPN/IX/2026',
      tanggalSurat: getOffsetDateString(-1),
      subject: 'Permohonan Audiensi Pengurus Serikat Pekerja Nasional',
      asalSurat: 'Dewan Pimpinan Pusat SPN',
      asalInstansi: 'Serikat Kerja',
      event: 'Audiensi Kesejahteraan Buruh & Upah Minimum',
      picPengirim: 'Sekjen DPP SPN (0813-9988-7766)',
      perihal: 'Permohonan Audiensi Pembahasan Kebijakan Pengupahan',
      filePath: samplePdfPath2,
      fileName: 'AU-2026-09-0002.pdf',
      fileSize: 180000,
      userInputId: staf.id,
      disposisi: {
        create: {
          status: 'BELUM_DISPOSISI',
        },
      },
    },
  });

  const surat3 = await prisma.suratMasuk.create({
    data: {
      nomorAgenda: 'PH/2026/09/0003',
      jenisSurat: 'PH',
      tipeSurat: 'Penting',
      nomorSurat: 'ASTRA/HRD-K3/IX/2026/098',
      tanggalSurat: getOffsetDateString(-2),
      subject: 'Permohonan Narasumber Sosialisasi Penerapan Norma K3 Nasional',
      asalSurat: 'PT Astra International Tbk',
      asalInstansi: 'Perusahaan',
      event: 'Bulan K3 Nasional PT Astra International',
      picPengirim: 'Bpk. Hendra Wijaya (0812-8877-6655)',
      perihal: 'Narasumber Sosialisasi Norma K3 Nasional Astra',
      filePath: samplePdfPath3,
      fileName: 'PH-2026-09-0003.pdf',
      fileSize: 310000,
      userInputId: staf.id,
      disposisi: {
        create: {
          status: 'SUDAH_DISPOSISI',
          tanggalDisposisi: new Date(Date.now() - 86400000),
          tujuanDisposisi: 'Direktur Bina Pengujian K3',
          instruksi: 'Tugaskan Subkoordinator Pengawas K3 sebagai narasumber.',
          catatan: 'Materi sosialisasi dikoordinasikan terlebih dahulu.',
        },
      },
    },
  });

  const createDummyPdf = (fileName: string) => {
    const p = path.join(privateStorage, fileName);
    if (!fs.existsSync(p)) fs.writeFileSync(p, `%PDF-1.4 sample content for ${fileName}`);
    return p;
  };

  await prisma.suratMasuk.create({
    data: {
      nomorAgenda: 'UNR/2026/09/0004',
      jenisSurat: 'UNR',
      tipeSurat: 'Penting',
      nomorSurat: 'B-305/SESMENKO/PMK/IX/2026',
      tanggalSurat: getOffsetDateString(-1),
      subject: 'Undangan Rapat Koordinasi Revitalisasi Pelatihan Vokasi',
      asalSurat: 'Kementerian Koordinator Bidang PMK',
      asalInstansi: 'Pemerintah',
      event: 'Rakor Revitalisasi Pendidikan & Pelatihan Vokasi Nasional',
      picPengirim: 'Biro Hukum & Persidangan Kemenko PMK (0811-3344-5566)',
      perihal: 'Undangan Rapat Koordinasi Revitalisasi Pendidikan Vokasi dan Pelatihan Kerja Terpadu 2026',
      filePath: createDummyPdf('UNR-2026-09-0004.pdf'),
      fileName: 'UNR-2026-09-0004.pdf',
      fileSize: 280000,
      userInputId: staf.id,
      disposisi: {
        create: {
          status: 'SUDAH_DISPOSISI',
          tanggalDisposisi: new Date(),
          tujuanDisposisi: 'Dirjen Binalavotas',
          instruksi: 'Hadir mewakili Menteri dan laporkan hasil pembahasan revitalisasi vokasi.',
          catatan: 'Siapkan materi kesiapan BLK daerah.',
        },
      },
    },
  });

  await prisma.suratMasuk.create({
    data: {
      nomorAgenda: 'UND/2026/09/0005',
      jenisSurat: 'UND',
      tipeSurat: 'Penting',
      nomorSurat: 'B-1120/SETNEG/D-3/IX/2026',
      tanggalSurat: getOffsetDateString(-2),
      subject: 'Undangan Sidang Kabinet Paripurna Pembahasan APBN Ketenagakerjaan',
      asalSurat: 'Kementerian Sekretariat Negara RI',
      asalInstansi: 'Pemerintah',
      event: 'Sidang Kabinet Paripurna RAPBN 2027',
      picPengirim: 'Sekretariat Kabinet (0812-4455-6677)',
      perihal: 'Undangan Sidang Kabinet Paripurna Pembahasan Prioritas RAPBN Ketenagakerjaan 2027',
      filePath: createDummyPdf('UND-2026-09-0005.pdf'),
      fileName: 'UND-2026-09-0005.pdf',
      fileSize: 340000,
      userInputId: staf.id,
      disposisi: {
        create: {
          status: 'SUDAH_DISPOSISI',
          tanggalDisposisi: new Date(),
          tujuanDisposisi: 'Sekretaris Jenderal',
          instruksi: 'Mendampingi Menaker RI dan menyiapkan pointers program kerja prioritas.',
          catatan: 'Konfirmasi kehadiran paling lambat 11 September 2026.',
        },
      },
    },
  });

  await prisma.suratMasuk.create({
    data: {
      nomorAgenda: 'PH/2026/09/0006',
      jenisSurat: 'PH',
      tipeSurat: 'Biasa',
      nomorSurat: '092/IM-JAPAN/DIR/IX/2026',
      tanggalSurat: getOffsetDateString(-3),
      subject: 'Permohonan Fasilitasi Seleksi Pemagangan Kerja ke Jepang',
      asalSurat: 'International Manpower Development Organization, Japan (IM Japan)',
      asalInstansi: 'Perusahaan',
      event: 'Program Pemagangan Luar Negeri IM Japan Batch 2026/2027',
      picPengirim: 'Perwakilan IM Japan Jakarta (0813-1122-3344)',
      perihal: 'Permohonan Fasilitasi Seleksi dan Pembekalan Peserta Pemagangan Kerja ke Jepang Angkatan 340',
      filePath: createDummyPdf('PH-2026-09-0006.pdf'),
      fileName: 'PH-2026-09-0006.pdf',
      fileSize: 195000,
      userInputId: staf.id,
      disposisi: {
        create: {
          status: 'BELUM_DISPOSISI',
        },
      },
    },
  });

  await prisma.suratMasuk.create({
    data: {
      nomorAgenda: 'AU/2026/09/0007',
      jenisSurat: 'AU',
      tipeSurat: 'Penting',
      nomorSurat: '078/DPP-KSPSI/IX/2026',
      tanggalSurat: getOffsetDateString(-4),
      subject: 'Permohonan Audiensi Pembahasan Kebijakan Upah Minimum 2027',
      asalSurat: 'Dewan Pimpinan Pusat KSPSI (Serikat Pekerja)',
      asalInstansi: 'Serikat Kerja',
      event: 'Konsultasi Kebijakan Upah Minimum Provinsi (UMP) 2027',
      picPengirim: 'Biro Advokasi DPP KSPSI (0812-7788-9900)',
      perihal: 'Permohonan Audiensi Pembahasan Sikap Serikat Buruh terhadap Penetapan Formula Upah Minimum 2027',
      filePath: createDummyPdf('AU-2026-09-0007.pdf'),
      fileName: 'AU-2026-09-0007.pdf',
      fileSize: 210000,
      userInputId: staf.id,
      disposisi: {
        create: {
          status: 'SUDAH_DISPOSISI',
          tanggalDisposisi: new Date(),
          tujuanDisposisi: 'Dirjen PHI dan Jamsos',
          instruksi: 'Agendakan pertemuan audiensi pimpinan serikat pekerja pada 14 September 2026.',
          catatan: 'Sertakan Dewan Pengupahan Nasional (Depenas).',
        },
      },
    },
  });

  await prisma.suratMasuk.create({
    data: {
      nomorAgenda: 'LP/2026/09/0008',
      jenisSurat: 'LP',
      tipeSurat: 'Rahasia',
      nomorSurat: 'LAP-04/BINWASK3/WAS-NORMA/IX/2026',
      tanggalSurat: getOffsetDateString(-5),
      subject: 'Laporan Khusus Investigasi Kecelakaan Kerja di Cilegon',
      asalSurat: 'Direktorat Bina Pengawasan Ketenagakerjaan dan K3',
      asalInstansi: 'Pemerintah',
      event: 'Investigasi Insiden Ledakan Tangki Pabrik Kimia Kawasan Industri Cilegon',
      picPengirim: 'Tim Reaksi Cepat Pengawas K3 (0811-9988-1122)',
      perihal: 'Laporan Hasil Investigasi Khusus Kecelakaan Kerja dan Pelanggaran Norma K3 di Pabrik Cilegon',
      filePath: createDummyPdf('LP-2026-09-0008.pdf'),
      fileName: 'LP-2026-09-0008.pdf',
      fileSize: 450000,
      userInputId: staf.id,
      disposisi: {
        create: {
          status: 'SUDAH_DISPOSISI',
          tanggalDisposisi: new Date(),
          tujuanDisposisi: 'Menaker RI & Dirjen Binwasnaker',
          instruksi: 'Tindak lanjuti dengan penegakan hukum ketenagakerjaan dan berikan santunan korban.',
          catatan: 'Dokumen bersifat rahasia dinas internal.',
        },
      },
    },
  });

  await prisma.suratMasuk.create({
    data: {
      nomorAgenda: 'WR/2026/09/0009',
      jenisSurat: 'WR',
      tipeSurat: 'Biasa',
      nomorSurat: '105/KOMPAS-TV/REDAKSI/IX/2026',
      tanggalSurat: getOffsetDateString(-6),
      subject: 'Permohonan Wawancara Eksklusif Menaker RI Transformasi PaskerID',
      asalSurat: 'Redaksi Berita Kompas TV Jakarta',
      asalInstansi: 'Perusahaan',
      event: 'Program Talkshow Khusus Bedah Lapangan Kerja Masa Depan',
      picPengirim: 'Produser Eksekutif Kompas TV (0812-6655-4433)',
      perihal: 'Permohonan Wawancara Eksklusif Menaker RI Topik Transformasi Pasar Kerja Digital PaskerID',
      filePath: createDummyPdf('WR-2026-09-0009.pdf'),
      fileName: 'WR-2026-09-0009.pdf',
      fileSize: 175000,
      userInputId: staf.id,
      disposisi: {
        create: {
          status: 'BELUM_DISPOSISI',
        },
      },
    },
  });

  await prisma.suratMasuk.create({
    data: {
      nomorAgenda: 'TAP/2026/09/0010',
      jenisSurat: 'TAP',
      tipeSurat: 'Penting',
      nomorSurat: '012/PAN-HUT-KEMNAKER/IX/2026',
      tanggalSurat: getOffsetDateString(-7),
      subject: 'Tata Upacara Hari Bakti Ketenagakerjaan dan Satyalancana Karya Satya',
      asalSurat: 'Panitia Penyelenggara Hari Bakti Ketenagakerjaan',
      asalInstansi: 'Pemerintah',
      event: 'Upacara Peringatan Hari Bakti Ketenagakerjaan Kemnaker RI 2026',
      picPengirim: 'Subbagian Protokol Acara (0811-2233-9988)',
      perihal: 'Pengaturan Tata Upacara dan Protokoler Peringatan Hari Bakti Ketenagakerjaan 2026',
      filePath: createDummyPdf('TAP-2026-09-0010.pdf'),
      fileName: 'TAP-2026-09-0010.pdf',
      fileSize: 310000,
      userInputId: staf.id,
      disposisi: {
        create: {
          status: 'SUDAH_DISPOSISI',
          tanggalDisposisi: new Date(),
          tujuanDisposisi: 'Biro Umum dan Protokol',
          instruksi: 'Siapkan gladi resik dan koordinasikan denah panggung utama pimpinan.',
          catatan: 'Gladi kotor dilaksanakan H-2 upacara.',
        },
      },
    },
  });

  await prisma.suratMasuk.create({
    data: {
      nomorAgenda: 'PH/2026/09/0011',
      jenisSurat: 'PH',
      tipeSurat: 'Biasa',
      nomorSurat: '411/BLK-KOM/AL-FALAH/IX/2026',
      tanggalSurat: getOffsetDateString(-8),
      subject: 'Permohonan Verifikasi Bantuan Pembangunan BLK Komunitas',
      asalSurat: 'Yayasan Pendidikan dan Pondok Pesantren Al-Falah',
      asalInstansi: 'Lainnya',
      event: 'Bantuan Sarana Pelatihan Vokasi BLK Komunitas Kejuruan Multimedia',
      picPengirim: 'Pengurus Yayasan Al-Falah (0813-8877-1122)',
      perihal: 'Permohonan Verifikasi Kelayakan Bantuan Pembangunan Balai Latihan Kerja Komunitas (BLKK)',
      filePath: createDummyPdf('PH-2026-09-0011.pdf'),
      fileName: 'PH-2026-09-0011.pdf',
      fileSize: 225000,
      userInputId: staf.id,
      disposisi: {
        create: {
          status: 'BELUM_DISPOSISI',
        },
      },
    },
  });

  await prisma.suratMasuk.create({
    data: {
      nomorAgenda: 'UND/2026/09/0012',
      jenisSurat: 'UND',
      tipeSurat: 'Penting',
      nomorSurat: 'ILO/DIR-ROAP/2026/09/22',
      tanggalSurat: getOffsetDateString(-9),
      subject: 'Undangan Keynote Speaker Forum Regional Green Jobs ILO',
      asalSurat: 'International Labour Organization (ILO) Kantor Regional Asia-Pasifik',
      asalInstansi: 'Lainnya',
      event: 'Asia-Pacific Regional Forum on Decent Work and Green Jobs Transition',
      picPengirim: 'Sekretariat ILO Jakarta (0811-1234-9988)',
      perihal: 'Undangan Sebagai Keynote Speaker Konferensi Regional Lapangan Kerja Hijau dan Transisi Berkeadilan',
      filePath: createDummyPdf('UND-2026-09-0012.pdf'),
      fileName: 'UND-2026-09-0012.pdf',
      fileSize: 390000,
      userInputId: staf.id,
      disposisi: {
        create: {
          status: 'SUDAH_DISPOSISI',
          tanggalDisposisi: new Date(),
          tujuanDisposisi: 'Biro Kerja Sama Luar Negeri (BKLN)',
          instruksi: 'Konfirmasikan kesediaan hadir secara hybrid dan susun draft sambutan Menaker.',
          catatan: 'Bahasa pengantar forum menggunakan Bahasa Inggris.',
        },
      },
    },
  });

  await prisma.suratMasuk.create({
    data: {
      nomorAgenda: 'UNR/2026/09/0013',
      jenisSurat: 'UNR',
      tipeSurat: 'Penting',
      nomorSurat: '089/DPP-APINDO/KETUM/IX/2026',
      tanggalSurat: getOffsetDateString(-11),
      subject: 'Undangan Rapat Tripartit Nasional Pencegahan PHK Sektor Tekstil',
      asalSurat: 'Dewan Pengurus Nasional APINDO (Asosiasi Pengusaha Indonesia)',
      asalInstansi: 'Perusahaan',
      event: 'Rapat Konsolidasi Tripartit Mitigasi Dampak Geopolitik Global terhadap Industri Tekstil',
      picPengirim: 'Sekretariat APINDO Pusat (0812-3344-1122)',
      perihal: 'Undangan Rapat Konsolidasi Tripartit Pencegahan PHK Industri Padat Karya Tekstil dan Alas Kaki',
      filePath: createDummyPdf('UNR-2026-09-0013.pdf'),
      fileName: 'UNR-2026-09-0013.pdf',
      fileSize: 260000,
      userInputId: staf.id,
      disposisi: {
        create: {
          status: 'SUDAH_DISPOSISI',
          tanggalDisposisi: new Date(),
          tujuanDisposisi: 'Dirjen PHI dan Jamsos',
          instruksi: 'Pimpin pertemuan tripartit bersama asosiasi pengusaha dan serikat buruh.',
          catatan: 'Siapkan resume regulasi insentif ketenagakerjaan.',
        },
      },
    },
  });

  console.log('Sample Surat & Disposisi created: 13 entries');

  // 5. Seed Jadwal Kegiatan (Hari ini & Mendatang)
  const todayStr = getTodayDateString();
  const tomorrowStr = getOffsetDateString(1);
  const next2DaysStr = getOffsetDateString(2);

  await prisma.jadwalKegiatan.createMany({
    data: [
      {
        namaKegiatan: 'Rapat Koordinasi Nasional Ketenagakerjaan',
        tanggalKegiatan: todayStr,
        waktuMulai: '09:00',
        waktuSelesai: '11:00',
        lokasi: 'Ruang Tridharma Lt. 2, Gedung Kemnaker RI',
        pejabatHadir: 'Menaker RI, Pejabat Eselon I',
        pic: 'Subbagian Acara (0812-1111-2222)',
        suratId: surat1.id,
      },
      {
        namaKegiatan: 'Audiensi Dewan Pengupahan Nasional (Depenas)',
        tanggalKegiatan: todayStr,
        waktuMulai: '11:30',
        waktuSelesai: '13:00',
        lokasi: 'Ruang Rapat Sesjen Lt. 3',
        pejabatHadir: 'Sekretaris Jenderal, Dirjen PHI dan Jamsos',
        pic: 'Sekretariat Depenas (0812-3333-4444)',
      },
      {
        namaKegiatan: 'Kunjungan Kerja dan Peninjauan Balai Latihan Kerja',
        tanggalKegiatan: todayStr,
        waktuMulai: '14:00',
        waktuSelesai: '16:30',
        lokasi: 'BBPVP Jakarta Timur (Pasar Rebo)',
        pejabatHadir: 'Wakil Menteri Ketenagakerjaan',
        pic: 'Protokol Wamen (0812-5555-6666)',
      },
      {
        namaKegiatan: 'Jamuan Makan Malam Delegasi ILO (International Labour Organization)',
        tanggalKegiatan: todayStr,
        waktuMulai: '19:30',
        waktuSelesai: '21:30',
        lokasi: 'Hotel Indonesia Kempinski, Bali Room',
        pejabatHadir: 'Menaker RI & Kepala Perwakilan ILO Indonesia',
        pic: 'Biro Kerja Sama Luar Negeri',
      },
      // Jadwal Mendatang
      {
        namaKegiatan: 'Upacara Pembukaan Pelatihan Vokasi Berbasis Kompetensi Batch 3',
        tanggalKegiatan: tomorrowStr,
        waktuMulai: '08:30',
        waktuSelesai: '10:30',
        lokasi: 'Aula Utama Kementerian Ketenagakerjaan',
        pejabatHadir: 'Dirjen Binalavotas',
        pic: 'Pusat Pasar Kerja',
      },
      {
        namaKegiatan: 'Focus Group Discussion Hubungan Industrial Pancasila',
        tanggalKegiatan: next2DaysStr,
        waktuMulai: '10:00',
        waktuSelesai: '15:00',
        lokasi: 'Gedung B Lt. 5, Kemnaker RI',
        pejabatHadir: 'Direktur Bina Kelembagaan Hubungan Industrial',
        pic: 'Direktorat Hubungan Industrial',
      },
      // Jadwal 1 Minggu - 2 Minggu Mendatang
      {
        namaKegiatan: 'Rapat Koordinasi Teknis Tim Tanggap Darurat K3 Nasional',
        tanggalKegiatan: getOffsetDateString(1),
        waktuMulai: '14:00',
        waktuSelesai: '16:00',
        lokasi: 'Ruang Rapat Ditjen Binwasnaker & K3 Lt. 4, Kemnaker RI',
        pejabatHadir: 'Dirjen Binwasnaker & K3, Pejabat Pengawas K3',
        pic: 'Subdit Pengawasan Norma K3 (0812-7777-8888)',
      },
      {
        namaKegiatan: 'Rapat Pimpinan Terbatas (Rapim) Evaluasi Kinerja Penyerapan Tenaga Kerja Kuartal III',
        tanggalKegiatan: getOffsetDateString(4),
        waktuMulai: '09:00',
        waktuSelesai: '11:30',
        lokasi: 'Ruang Rapat Menaker RI Lt. 2, Gedung Kemnaker',
        pejabatHadir: 'Menaker RI, Wakil Menteri Ketenagakerjaan, Pejabat Eselon I',
        pic: 'Subbagian Protokol Pimpinan (0811-1234-5678)',
      },
      {
        namaKegiatan: 'Audiensi Dewan Pimpinan Pusat Konfederasi Serikat Pekerja Seluruh Indonesia (KSPSI)',
        tanggalKegiatan: getOffsetDateString(4),
        waktuMulai: '13:30',
        waktuSelesai: '15:30',
        lokasi: 'Ruang Rapat Sesjen Lt. 3, Gedung Kemnaker',
        pejabatHadir: 'Sekretaris Jenderal, Dirjen PHI dan Jamsos',
        pic: 'Biro Hubungan Masyarakat (0813-2222-3333)',
      },
      {
        namaKegiatan: 'Kunjungan Kerja Lapangan & Peninjauan Fasilitas Pelatihan Vokasi Otomotif Listrik',
        tanggalKegiatan: getOffsetDateString(6),
        waktuMulai: '08:00',
        waktuSelesai: '14:00',
        lokasi: 'Balai Pelatihan Vokasi dan Produktivitas (BPVP) Bandung, Jawa Barat',
        pejabatHadir: 'Menaker RI, Dirjen Binalavotas, Kepala BPVP Bandung',
        pic: 'Protokol Perjalanan Luar Kota (0812-9999-1111)',
      },
      {
        namaKegiatan: 'Penandatanganan Nota Kesepahaman (MoU) Penempatan Specified Skilled Worker (SSW) RI - Jepang',
        tanggalKegiatan: getOffsetDateString(7),
        waktuMulai: '10:00',
        waktuSelesai: '12:00',
        lokasi: 'Ruang Tridharma Lt. 2, Gedung Kemnaker RI',
        pejabatHadir: 'Menaker RI, Duta Besar LBBP Jepang untuk Indonesia, Dirjen Binapenta',
        pic: 'Biro Kerja Sama Luar Negeri (0811-8888-9999)',
      },
      {
        namaKegiatan: 'Seminar Nasional Strategi Transformasi Digital Ketenagakerjaan & Pasker.ID',
        tanggalKegiatan: getOffsetDateString(7),
        waktuMulai: '14:00',
        waktuSelesai: '16:30',
        lokasi: 'Hotel Bidakara Jakarta, Binakarna Hall',
        pejabatHadir: 'Wakil Menteri Ketenagakerjaan, Staf Ahli Menteri',
        pic: 'Pusat Pasar Kerja Kemnaker (0812-4444-5555)',
      },
      {
        namaKegiatan: 'Rapat Dengar Pendapat (RDP) Komisi IX DPR RI Terkait Kebijakan Ketenagakerjaan & Upah 2027',
        tanggalKegiatan: getOffsetDateString(8),
        waktuMulai: '09:00',
        waktuSelesai: '12:30',
        lokasi: 'Gedung Nusantara I DPR RI, Ruang Sidang Komisi IX',
        pejabatHadir: 'Menaker RI beserta Seluruh Pejabat Eselon I Kemnaker',
        pic: 'Bagian Hubungan Antar Lembaga (0813-8888-7777)',
      },
      {
        namaKegiatan: 'Audiensi Pengurus Dewan Pimpinan Pusat APINDO Terkait Iklim Investasi & Upah Minimum',
        tanggalKegiatan: getOffsetDateString(11),
        waktuMulai: '09:30',
        waktuSelesai: '12:00',
        lokasi: 'Ruang Rapat Utama Kemnaker Lt. 2',
        pejabatHadir: 'Menaker RI, Dirjen PHI dan Jamsos, Dirjen Binwasnaker',
        pic: 'Sekretariat Depenas (0812-3333-4444)',
      },
      {
        namaKegiatan: 'Penganugerahan Penghargaan Keselamatan dan Kesehatan Kerja (K3) & Zero Accident Award 2026',
        tanggalKegiatan: getOffsetDateString(13),
        waktuMulai: '09:00',
        waktuSelesai: '12:30',
        lokasi: 'Hotel Bidakara Jakarta, Grand Ballroom Birawa',
        pejabatHadir: 'Menaker RI, Para Gubernur Penerima Penghargaan, Pimpinan BUMN/Swasta',
        pic: 'Direktorat Bina Pengujian K3 & Protokol Pusat (0811-5555-4444)',
      },
      {
        namaKegiatan: 'Upacara Pelantikan & Pengambilan Sumpah Jabatan Pejabat Fungsional Kemnaker RI',
        tanggalKegiatan: getOffsetDateString(14),
        waktuMulai: '08:30',
        waktuSelesai: '11:00',
        lokasi: 'Aula Tridharma Lantai 2, Gedung Kemnaker RI',
        pejabatHadir: 'Sekretaris Jenderal Kemnaker RI, Kepala Biro Organisasi & SDMA',
        pic: 'Bagian Acara & Upacara Protokol (0812-1111-2222)',
      },
    ],
  });

  console.log('Sample Jadwal Kegiatan created: 16 entries');
  console.log('Database seeding finished successfully!');
}

main()
  .catch((e) => {
    console.error('Error seeding data:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
