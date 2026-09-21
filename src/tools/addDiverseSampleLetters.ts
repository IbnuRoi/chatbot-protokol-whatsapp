import { PrismaClient } from '@prisma/client';
import path from 'path';
import fs from 'fs';

const prisma = new PrismaClient();

async function main() {
  console.log('Menambahkan 10 surat sampel baru dengan variasi topik protokol...');

  // Cari user staf protokol untuk penginput
  let user = await prisma.users.findFirst({
    where: { deleted_at: null, role: 'PROTOKOL' },
  });

  if (!user) {
    user = await prisma.users.findFirst({ where: { deleted_at: null } });
  }

  if (!user) {
    console.error('Tidak ada user ditemukan di database.');
    return;
  }

  const privateStorage = path.resolve(process.cwd(), 'storage', 'private');
  if (!fs.existsSync(privateStorage)) {
    fs.mkdirSync(privateStorage, { recursive: true });
  }

  const sampleLetters = [
    {
      nomorAgenda: 'UNR/2026/09/0004',
      jenisSurat: 'UNR',
      tipeSurat: 'Penting',
      nomorSurat: 'B-305/SESMENKO/PMK/IX/2026',
      tanggalSurat: '2026-09-09',
      subject: 'Undangan Rapat Koordinasi Revitalisasi Pelatihan Vokasi',
      asalSurat: 'Kementerian Koordinator Bidang PMK',
      asalInstansi: 'Pemerintah',
      event: 'Rakor Revitalisasi Pendidikan & Pelatihan Vokasi Nasional',
      picPengirim: 'Biro Hukum & Persidangan Kemenko PMK (0811-3344-5566)',
      perihal: 'Undangan Rapat Koordinasi Revitalisasi Pendidikan Vokasi dan Pelatihan Kerja Terpadu 2026',
      fileName: 'UNR-2026-09-0004.pdf',
      fileSize: 280000,
      disposisiStatus: 'SUDAH_DISPOSISI',
      tujuanDisposisi: 'Dirjen Binalavotas',
      instruksi: 'Hadir mewakili Menteri dan laporkan hasil pembahasan revitalisasi vokasi.',
      catatan: 'Siapkan materi kesiapan BLK daerah.',
    },
    {
      nomorAgenda: 'UND/2026/09/0005',
      jenisSurat: 'UND',
      tipeSurat: 'Penting',
      nomorSurat: 'B-1120/SETNEG/D-3/IX/2026',
      tanggalSurat: '2026-09-08',
      subject: 'Undangan Sidang Kabinet Paripurna Pembahasan APBN Ketenagakerjaan',
      asalSurat: 'Kementerian Sekretariat Negara RI',
      asalInstansi: 'Pemerintah',
      event: 'Sidang Kabinet Paripurna RAPBN 2027',
      picPengirim: 'Sekretariat Kabinet (0812-4455-6677)',
      perihal: 'Undangan Sidang Kabinet Paripurna Pembahasan Prioritas RAPBN Ketenagakerjaan 2027',
      fileName: 'UND-2026-09-0005.pdf',
      fileSize: 340000,
      disposisiStatus: 'SUDAH_DISPOSISI',
      tujuanDisposisi: 'Sekretaris Jenderal',
      instruksi: 'Mendampingi Menaker RI dan menyiapkan pointers program kerja prioritas.',
      catatan: 'Konfirmasi kehadiran paling lambat 11 September 2026.',
    },
    {
      nomorAgenda: 'PH/2026/09/0006',
      jenisSurat: 'PH',
      tipeSurat: 'Biasa',
      nomorSurat: '092/IM-JAPAN/DIR/IX/2026',
      tanggalSurat: '2026-09-07',
      subject: 'Permohonan Fasilitasi Seleksi Pemagangan Kerja ke Jepang',
      asalSurat: 'International Manpower Development Organization, Japan (IM Japan)',
      asalInstansi: 'Perusahaan',
      event: 'Program Pemagangan Luar Negeri IM Japan Batch 2026/2027',
      picPengirim: 'Perwakilan IM Japan Jakarta (0813-1122-3344)',
      perihal: 'Permohonan Fasilitasi Seleksi dan Pembekalan Peserta Pemagangan Kerja ke Jepang Angkatan 340',
      fileName: 'PH-2026-09-0006.pdf',
      fileSize: 195000,
      disposisiStatus: 'BELUM_DISPOSISI',
      tujuanDisposisi: null,
      instruksi: null,
      catatan: null,
    },
    {
      nomorAgenda: 'AU/2026/09/0007',
      jenisSurat: 'AU',
      tipeSurat: 'Penting',
      nomorSurat: '078/DPP-KSPSI/IX/2026',
      tanggalSurat: '2026-09-06',
      subject: 'Permohonan Audiensi Pembahasan Kebijakan Upah Minimum 2027',
      asalSurat: 'Dewan Pimpinan Pusat KSPSI (Serikat Pekerja)',
      asalInstansi: 'Serikat Kerja',
      event: 'Konsultasi Kebijakan Upah Minimum Provinsi (UMP) 2027',
      picPengirim: 'Biro Advokasi DPP KSPSI (0812-7788-9900)',
      perihal: 'Permohonan Audiensi Pembahasan Sikap Serikat Buruh terhadap Penetapan Formula Upah Minimum 2027',
      fileName: 'AU-2026-09-0007.pdf',
      fileSize: 210000,
      disposisiStatus: 'SUDAH_DISPOSISI',
      tujuanDisposisi: 'Dirjen PHI dan Jamsos',
      instruksi: 'Agendakan pertemuan audiensi pimpinan serikat pekerja pada 14 September 2026.',
      catatan: 'Sertakan Dewan Pengupahan Nasional (Depenas).',
    },
    {
      nomorAgenda: 'LP/2026/09/0008',
      jenisSurat: 'LP',
      tipeSurat: 'Rahasia',
      nomorSurat: 'LAP-04/BINWASK3/WAS-NORMA/IX/2026',
      tanggalSurat: '2026-09-05',
      subject: 'Laporan Khusus Investigasi Kecelakaan Kerja di Cilegon',
      asalSurat: 'Direktorat Bina Pengawasan Ketenagakerjaan dan K3',
      asalInstansi: 'Pemerintah',
      event: 'Investigasi Insiden Ledakan Tangki Pabrik Kimia Kawasan Industri Cilegon',
      picPengirim: 'Tim Reaksi Cepat Pengawas K3 (0811-9988-1122)',
      perihal: 'Laporan Hasil Investigasi Khusus Kecelakaan Kerja dan Pelanggaran Norma K3 di Pabrik Cilegon',
      fileName: 'LP-2026-09-0008.pdf',
      fileSize: 450000,
      disposisiStatus: 'SUDAH_DISPOSISI',
      tujuanDisposisi: 'Menaker RI & Dirjen Binwasnaker',
      instruksi: 'Tindak lanjuti dengan penegakan hukum ketenagakerjaan dan berikan santunan korban.',
      catatan: 'Dokumen bersifat rahasia dinas internal.',
    },
    {
      nomorAgenda: 'WR/2026/09/0009',
      jenisSurat: 'WR',
      tipeSurat: 'Biasa',
      nomorSurat: '105/KOMPAS-TV/REDAKSI/IX/2026',
      tanggalSurat: '2026-09-04',
      subject: 'Permohonan Wawancara Eksklusif Menaker RI Transformasi PaskerID',
      asalSurat: 'Redaksi Berita Kompas TV Jakarta',
      asalInstansi: 'Perusahaan',
      event: 'Program Talkshow Khusus Bedah Lapangan Kerja Masa Depan',
      picPengirim: 'Produser Eksekutif Kompas TV (0812-6655-4433)',
      perihal: 'Permohonan Wawancara Eksklusif Menaker RI Topik Transformasi Pasar Kerja Digital PaskerID',
      fileName: 'WR-2026-09-0009.pdf',
      fileSize: 175000,
      disposisiStatus: 'BELUM_DISPOSISI',
      tujuanDisposisi: null,
      instruksi: null,
      catatan: null,
    },
    {
      nomorAgenda: 'TAP/2026/09/0010',
      jenisSurat: 'TAP',
      tipeSurat: 'Penting',
      nomorSurat: '012/PAN-HUT-KEMNAKER/IX/2026',
      tanggalSurat: '2026-09-03',
      subject: 'Tata Upacara Hari Bakti Ketenagakerjaan dan Satyalancana Karya Satya',
      asalSurat: 'Panitia Penyelenggara Hari Bakti Ketenagakerjaan',
      asalInstansi: 'Pemerintah',
      event: 'Upacara Peringatan Hari Bakti Ketenagakerjaan Kemnaker RI 2026',
      picPengirim: 'Subbagian Protokol Acara (0811-2233-9988)',
      perihal: 'Pengaturan Tata Upacara dan Protokoler Peringatan Hari Bakti Ketenagakerjaan 2026',
      fileName: 'TAP-2026-09-0010.pdf',
      fileSize: 310000,
      disposisiStatus: 'SUDAH_DISPOSISI',
      tujuanDisposisi: 'Biro Umum dan Protokol',
      instruksi: 'Siapkan gladi resik dan koordinasikan denah panggung utama pimpinan.',
      catatan: 'Gladi kotor dilaksanakan H-2 upacara.',
    },
    {
      nomorAgenda: 'PH/2026/09/0011',
      jenisSurat: 'PH',
      tipeSurat: 'Biasa',
      nomorSurat: '411/BLK-KOM/AL-FALAH/IX/2026',
      tanggalSurat: '2026-09-02',
      subject: 'Permohonan Verifikasi Bantuan Pembangunan BLK Komunitas',
      asalSurat: 'Yayasan Pendidikan dan Pondok Pesantren Al-Falah',
      asalInstansi: 'Lainnya',
      event: 'Bantuan Sarana Pelatihan Vokasi BLK Komunitas Kejuruan Multimedia',
      picPengirim: 'Pengurus Yayasan Al-Falah (0813-8877-1122)',
      perihal: 'Permohonan Verifikasi Kelayakan Bantuan Pembangunan Balai Latihan Kerja Komunitas (BLKK)',
      fileName: 'PH-2026-09-0011.pdf',
      fileSize: 225000,
      disposisiStatus: 'BELUM_DISPOSISI',
      tujuanDisposisi: null,
      instruksi: null,
      catatan: null,
    },
    {
      nomorAgenda: 'UND/2026/09/0012',
      jenisSurat: 'UND',
      tipeSurat: 'Penting',
      nomorSurat: 'ILO/DIR-ROAP/2026/09/22',
      tanggalSurat: '2026-09-01',
      subject: 'Undangan Keynote Speaker Forum Regional Green Jobs ILO',
      asalSurat: 'International Labour Organization (ILO) Kantor Regional Asia-Pasifik',
      asalInstansi: 'Lainnya',
      event: 'Asia-Pacific Regional Forum on Decent Work and Green Jobs Transition',
      picPengirim: 'Sekretariat ILO Jakarta (0811-1234-9988)',
      perihal: 'Undangan Sebagai Keynote Speaker Konferensi Regional Lapangan Kerja Hijau dan Transisi Berkeadilan',
      fileName: 'UND-2026-09-0012.pdf',
      fileSize: 390000,
      disposisiStatus: 'SUDAH_DISPOSISI',
      tujuanDisposisi: 'Biro Kerja Sama Luar Negeri (BKLN)',
      instruksi: 'Konfirmasikan kesediaan hadir secara hybrid dan susun draft sambutan Menaker.',
      catatan: 'Bahasa pengantar forum menggunakan Bahasa Inggris.',
    },
    {
      nomorAgenda: 'UNR/2026/09/0013',
      jenisSurat: 'UNR',
      tipeSurat: 'Penting',
      nomorSurat: '089/DPP-APINDO/KETUM/IX/2026',
      tanggalSurat: '2026-08-30',
      subject: 'Undangan Rapat Tripartit Nasional Pencegahan PHK Sektor Tekstil',
      asalSurat: 'Dewan Pengurus Nasional APINDO (Asosiasi Pengusaha Indonesia)',
      asalInstansi: 'Perusahaan',
      event: 'Rapat Konsolidasi Tripartit Mitigasi Dampak Geopolitik Global terhadap Industri Tekstil',
      picPengirim: 'Sekretariat APINDO Pusat (0812-3344-1122)',
      perihal: 'Undangan Rapat Konsolidasi Tripartit Pencegahan PHK Industri Padat Karya Tekstil dan Alas Kaki',
      fileName: 'UNR-2026-09-0013.pdf',
      fileSize: 260000,
      disposisiStatus: 'SUDAH_DISPOSISI',
      tujuanDisposisi: 'Dirjen PHI dan Jamsos',
      instruksi: 'Pimpin pertemuan tripartit bersama asosiasi pengusaha dan serikat buruh.',
      catatan: 'Siapkan resume regulasi insentif ketenagakerjaan.',
    },
  ];

  let addedCount = 0;

  for (const item of sampleLetters) {
    const pdfPath = path.join(privateStorage, item.fileName);
    if (!fs.existsSync(pdfPath)) {
      fs.writeFileSync(pdfPath, `%PDF-1.4 Sample document for ${item.nomorAgenda}`);
    }

    const existing = await prisma.letters.findFirst({
      where: { deleted_at: null, agenda_number: item.nomorAgenda },
    });

    if (existing) {
      await prisma.letters.update({
        where: { id: existing.id },
        data: {
          number_or_date: item.nomorSurat,
          regarding: item.perihal,
          title: item.subject,
          event: item.event,
          from: item.asalSurat,
          updated_at: new Date(),
        },
      });
      console.log(`[Update] Surat ${item.nomorAgenda} diperbarui.`);
    } else {
      const createdLetter = await prisma.letters.create({
        data: {
          agenda_number: item.nomorAgenda,
          letter_category_id: BigInt(2),
          letter_type_id: BigInt(1),
          number_or_date: item.nomorSurat,
          date: new Date(item.tanggalSurat),
          title: item.subject,
          from: item.asalSurat,
          from_type: item.asalInstansi,
          event: item.event,
          pic: item.picPengirim,
          regarding: item.perihal,
          file: pdfPath,
          user_id: user.id,
          created_at: new Date(),
          updated_at: new Date(),
        },
      });

      if (item.disposisiStatus === 'SUDAH_DISPOSISI') {
        await prisma.dispositions.create({
          data: {
            letter_id: createdLetter.id,
            status: 'Sudah Disposisi',
            date: new Date(),
            to: item.tujuanDisposisi || 'Dirjen',
            action: item.instruksi || 'Tindak lanjuti',
            note: item.catatan || '',
            created_at: new Date(),
            updated_at: new Date(),
          },
        });
      }

      console.log(`[Baru] Surat ${item.nomorAgenda} (${item.perihal.slice(0, 45)}...) ditambahkan.`);
      addedCount++;
    }
  }

  console.log(`Selesai! Berhasil menambahkan/memperbarui ${addedCount} surat sampel baru dengan variasi topik.`);
}

main()
  .catch((e) => {
    console.error('Error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
