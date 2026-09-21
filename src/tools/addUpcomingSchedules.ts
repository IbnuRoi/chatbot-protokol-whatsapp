import { prisma } from '../database/prisma';

function getOffsetDateString(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export const upcomingSchedules = [
  {
    namaKegiatan: 'Rapat Koordinasi Teknis Tim Tanggap Darurat K3 Nasional',
    tanggalKegiatan: getOffsetDateString(1), // Besok (+1)
    waktuMulai: '14:00',
    waktuSelesai: '16:00',
    lokasi: 'Ruang Rapat Ditjen Binwasnaker & K3 Lt. 4, Kemnaker RI',
    pejabatHadir: 'Dirjen Binwasnaker & K3, Pejabat Pengawas K3',
    pic: 'Subdit Pengawasan Norma K3 (0812-7777-8888)',
  },
  {
    namaKegiatan: 'Rapat Pimpinan Terbatas (Rapim) Evaluasi Kinerja Penyerapan Tenaga Kerja Kuartal III',
    tanggalKegiatan: getOffsetDateString(4), // +4 hari (Senin)
    waktuMulai: '09:00',
    waktuSelesai: '11:30',
    lokasi: 'Ruang Rapat Menaker RI Lt. 2, Gedung Kemnaker',
    pejabatHadir: 'Menaker RI, Wakil Menteri Ketenagakerjaan, Pejabat Eselon I',
    pic: 'Subbagian Protokol Pimpinan (0811-1234-5678)',
  },
  {
    namaKegiatan: 'Audiensi Dewan Pimpinan Pusat Konfederasi Serikat Pekerja Seluruh Indonesia (KSPSI)',
    tanggalKegiatan: getOffsetDateString(4), // +4 hari (Senin)
    waktuMulai: '13:30',
    waktuSelesai: '15:30',
    lokasi: 'Ruang Rapat Sesjen Lt. 3, Gedung Kemnaker',
    pejabatHadir: 'Sekretaris Jenderal, Dirjen PHI dan Jamsos',
    pic: 'Biro Hubungan Masyarakat (0813-2222-3333)',
  },
  {
    namaKegiatan: 'Kunjungan Kerja Lapangan & Peninjauan Fasilitas Pelatihan Vokasi Otomotif Listrik',
    tanggalKegiatan: getOffsetDateString(6), // +6 hari (Rabu)
    waktuMulai: '08:00',
    waktuSelesai: '14:00',
    lokasi: 'Balai Pelatihan Vokasi dan Produktivitas (BPVP) Bandung, Jawa Barat',
    pejabatHadir: 'Menaker RI, Dirjen Binalavotas, Kepala BPVP Bandung',
    pic: 'Protokol Perjalanan Luar Kota (0812-9999-1111)',
  },
  {
    namaKegiatan: 'Penandatanganan Nota Kesepahaman (MoU) Penempatan Specified Skilled Worker (SSW) RI - Jepang',
    tanggalKegiatan: getOffsetDateString(7), // +7 hari (Tepat 1 Minggu)
    waktuMulai: '10:00',
    waktuSelesai: '12:00',
    lokasi: 'Ruang Tridharma Lt. 2, Gedung Kemnaker RI',
    pejabatHadir: 'Menaker RI, Duta Besar LBBP Jepang untuk Indonesia, Dirjen Binapenta',
    pic: 'Biro Kerja Sama Luar Negeri (0811-8888-9999)',
  },
  {
    namaKegiatan: 'Seminar Nasional Strategi Transformasi Digital Ketenagakerjaan & Pasker.ID',
    tanggalKegiatan: getOffsetDateString(7), // +7 hari (Tepat 1 Minggu)
    waktuMulai: '14:00',
    waktuSelesai: '16:30',
    lokasi: 'Hotel Bidakara Jakarta, Binakarna Hall',
    pejabatHadir: 'Wakil Menteri Ketenagakerjaan, Staf Ahli Menteri',
    pic: 'Pusat Pasar Kerja Kemnaker (0812-4444-5555)',
  },
  {
    namaKegiatan: 'Rapat Dengar Pendapat (RDP) Komisi IX DPR RI Terkait Kebijakan Ketenagakerjaan & Upah 2027',
    tanggalKegiatan: getOffsetDateString(8), // +8 hari (Jumat)
    waktuMulai: '09:00',
    waktuSelesai: '12:30',
    lokasi: 'Gedung Nusantara I DPR RI, Ruang Sidang Komisi IX',
    pejabatHadir: 'Menaker RI beserta Seluruh Pejabat Eselon I Kemnaker',
    pic: 'Bagian Hubungan Antar Lembaga (0813-8888-7777)',
  },
  {
    namaKegiatan: 'Audiensi Pengurus Dewan Pimpinan Pusat APINDO Terkait Iklim Investasi & Upah Minimum',
    tanggalKegiatan: getOffsetDateString(11), // +11 hari (Senin)
    waktuMulai: '09:30',
    waktuSelesai: '12:00',
    lokasi: 'Ruang Rapat Utama Kemnaker Lt. 2',
    pejabatHadir: 'Menaker RI, Dirjen PHI dan Jamsos, Dirjen Binwasnaker',
    pic: 'Sekretariat Depenas (0812-3333-4444)',
  },
  {
    namaKegiatan: 'Penganugerahan Penghargaan Keselamatan dan Kesehatan Kerja (K3) & Zero Accident Award 2026',
    tanggalKegiatan: getOffsetDateString(13), // +13 hari (Rabu)
    waktuMulai: '09:00',
    waktuSelesai: '12:30',
    lokasi: 'Hotel Bidakara Jakarta, Grand Ballroom Birawa',
    pejabatHadir: 'Menaker RI, Para Gubernur Penerima Penghargaan, Pimpinan BUMN/Swasta',
    pic: 'Direktorat Bina Pengujian K3 & Protokol Pusat (0811-5555-4444)',
  },
  {
    namaKegiatan: 'Upacara Pelantikan & Pengambilan Sumpah Jabatan Pejabat Fungsional Kemnaker RI',
    tanggalKegiatan: getOffsetDateString(14), // +14 hari (Tepat 2 Minggu)
    waktuMulai: '08:30',
    waktuSelesai: '11:00',
    lokasi: 'Aula Tridharma Lantai 2, Gedung Kemnaker RI',
    pejabatHadir: 'Sekretaris Jenderal Kemnaker RI, Kepala Biro Organisasi & SDMA',
    pic: 'Bagian Acara & Upacara Protokol (0812-1111-2222)',
  },
];

async function addSchedules() {
  console.log('🚀 Menambahkan jadwal kegiatan protokol kedepan (1 hingga 2 minggu)...');

  let addedCount = 0;
  for (const item of upcomingSchedules) {
    const [startHour, startMin] = item.waktuMulai.split(':').map(Number);
    const [endHour, endMin] = (item.waktuSelesai || '12:00').split(':').map(Number);
    const [y, m, d] = item.tanggalKegiatan.split('-').map(Number);

    // WIB = UTC+7
    const startTime = new Date(Date.UTC(y, m - 1, d, startHour - 7, startMin));
    const endTime = new Date(Date.UTC(y, m - 1, d, endHour - 7, endMin));

    const exists = await prisma.events.findFirst({
      where: {
        deleted_at: null,
        title: item.namaKegiatan,
      },
    });

    if (!exists) {
      await prisma.events.create({
        data: {
          title: item.namaKegiatan,
          event_time_start: startTime,
          event_time_finish: endTime,
          location: item.lokasi,
          pic_name: item.pic,
          created_at: new Date(),
          updated_at: new Date(),
        },
      });
      console.log(`✅ [${item.tanggalKegiatan}] ${item.waktuMulai} WIB - ${item.namaKegiatan}`);
      addedCount++;
    } else {
      console.log(`ℹ️ [Sudah Ada] [${item.tanggalKegiatan}] - ${item.namaKegiatan}`);
    }
  }

  console.log(`\n🎉 Selesai! ${addedCount} jadwal baru berhasil ditambahkan.`);
}

if (require.main === module) {
  addSchedules()
    .catch((err) => {
      console.error('❌ Gagal menambahkan jadwal:', err);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
