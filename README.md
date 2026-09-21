# Sistem Chatbot WhatsApp Administrasi Protokol

Sistem Chatbot WhatsApp otomatis berbasis **Node.js (TypeScript)** dan **Prisma ORM (SQLite)** yang dirancang untuk kebutuhan **Administrasi Protokol Kementerian Ketenagakerjaan (Kemnaker)**.

Sistem ini mengimplementasikan alur lengkap sesuai dokumen flowchart resmi:
1. **Autentikasi & Otorisasi Pengguna (Whitelist WhatsApp)**
2. **Menu 1: Surat Masuk & Registrasi Dokumen PDF**:
   - Pemilihan Jenis Surat (`UND`, `UNR`, `PH`, `AU`, `WR`, `LP`, `TAP`)
   - Auto-generate Nomor Agenda (atau input manual)
   - Pemilihan Tipe Surat (`Biasa`, `Rahasia`, `Penting`, `Tembusan`)
   - Unggah Dokumen PDF (Validasi format, ukuran, dan scanning keamanan)
   - Ekstraksi Teks Dokumen & AI OCR (Google Gemini AI / Fallback Regex)
   - Konfirmasi & Koreksi Data Ekstraksi secara interaktif
   - Pemilihan Kategori Asal Instansi (`Pemerintah`, `Serikat Kerja`, `Perusahaan`, `Lainnya`)
   - Rekomendasi Rumusan Perihal Resmi oleh AI
   - Konfirmasi Akhir & Transaksi Database Atomik (Penyimpanan metadata, pemindahan file ke private storage, dan audit log)
3. **Menu 2: Jadwal Kegiatan Protokol**:
   - Menampilkan agenda hari ini yang diurutkan berdasarkan waktu server
   - Pencarian 1 kegiatan terdekat berikutnya yang belum terlaksana
   - Menampilkan agenda protokol beberapa hari ke depan (mendatang)
4. **Menu 3: Pelacakan Status Disposisi**:
   - Pencarian berdasarkan Nomor Agenda atau Nomor Surat
   - Menampilkan status: **SUDAH DISPOSISI** (lengkap dengan tanggal, tujuan pejabat, instruksi, dan catatan) atau **BELUM DISPOSISI**
5. **Menu 4: Riwayat Surat Masuk**:
   - Daftar surat masuk terpaginasi (5 surat per halaman)
   - Tampilan rincian lengkap surat dan akses cepat status disposisi
6. **Menu 5: Pusat Bantuan & Panduan**:
   - Panduan lengkap seluruh fitur, cara upload PDF, dan navigasi bot

---

## 🛠️ Persyaratan Sistem

- **Node.js**: Versi 18+ (Rekomendasi v20 atau v24 LTS)
- **NPM**: Bawaan Node.js
- **OS**: Windows / Linux / macOS

---

## 🚀 Panduan Memulai Cepat

### 1. Konfigurasi Lingkungan (`.env`)

Salin berkas `.env.example` menjadi `.env` (sudah otomatis dibuatkan):
```env
DATABASE_URL="file:./dev.db"

# 1. Chat NLU & Intention Understanding (OpenRouter - Model Free)
CHAT_API_KEY="sk-or-v1-..."      # API Key OpenRouter
CHAT_MODEL="openrouter/free"     # Model gratis (default: openrouter/free)

# 2. Ekstraksi Dokumen PDF & Rekomendasi Perihal
PDF_EXTRACTION_PROVIDER="gemini" # Provider: "gemini" atau "openrouter"
PDF_EXTRACTION_API_KEY=""        # API Key untuk ekstraksi (opsional, jika kosong menggunakan parser regex lokal)
PDF_EXTRACTION_MODEL="gemini-2.5-flash"

ADMIN_CONTACT="0812-3456-7890 (Admin Tim IT Protokol)"
TEMP_STORAGE_PATH="./storage/temp"
PRIVATE_STORAGE_PATH="./storage/private"
```

### 2. Inisialisasi Database & Seeder Data Awal

Jalankan perintah ini untuk membuat tabel dan mengisi data awal (pengguna terdaftar, surat contoh, dan jadwal kegiatan):
```bash
npm run db:push
npm run db:seed
```

Pengguna awal yang telah terdaftar dalam seed:
- `6281200001111` : Ibnu (Staf Protokol) - *Akun default simulator*
- `6281234567890` : Ahmad Faisal (Admin Protokol)
- `6281198765432` : Bpk. Sekretaris Jenderal (Pimpinan)

---

## 🎮 Cara Menjalankan

### Opsi A: Menguji via Simulator Terminal (Rekomendasi Awal)
Anda dapat menguji dan mencoba seluruh fitur, alur menu, serta simulasi pengunggahan PDF secara langsung di terminal tanpa harus memindai QR WhatsApp:

```bash
npm run simulate
```

**Perintah praktis dalam Simulator:**
- `/upload` : Mengirim berkas PDF simulasi undangan resmi Kemnaker
- `/upload <path_file.pdf>` : Mengirim berkas PDF asli dari laptop Anda
- `/user <nomor_wa>` : Mengganti pengirim (contoh: uji nomor tidak terdaftar `6289999999`)
- `/users` : Melihat daftar nomor yang terdaftar di whitelist
- `/exit` : Menutup simulator

---

### Opsi B: Menghubungkan ke WhatsApp Asli (Baileys QR Scan)
Untuk menjalankan bot WhatsApp secara langsung:

```bash
npm start
```

1. Terminal akan menampilkan **QR Code**.
2. Buka aplikasi WhatsApp di ponsel Anda > **Perangkat Tertaut (Linked Devices)** > **Tautkan Perangkat**.
3. Pindai (scan) QR code pada terminal.
4. Bot siap melayani pesan masuk dari nomor-nomor yang sudah terdaftar di whitelist.

---

## 🧪 Menjalankan Tes Otomatis

Untuk memastikan seluruh 8 alur logika flowchart berfungsi dengan benar (autentikasi, upload PDF, OCR, koreksi data, AI perihal, jadwal, disposisi, riwayat):

```bash
npx tsx test/verifyAllFlows.ts
```

---

## 📁 Struktur Proyek

```
├── prisma/
│   ├── schema.prisma          # Skema database relasional Prisma (SQLite)
│   └── seed.ts                # Seeder data pengguna, surat, disposisi, dan jadwal
├── src/
│   ├── config/
│   │   └── env.ts             # Pengaturan lingkungan & path penyimpanan
│   ├── database/
│   │   └── prisma.ts          # Singleton Prisma Client
│   ├── services/
│   │   ├── aiService.ts       # Ekstraksi metadata & rekomendasi perihal (Gemini AI + Regex)
│   │   ├── pdfService.ts      # Validasi keamanan PDF (%PDF-, exploit scan) & parser teks
│   │   ├── sessionService.ts  # State machine multi-langkah per nomor WA
│   │   ├── suratService.ts    # Transaksi database atomik registrasi surat & riwayat
│   │   ├── jadwalService.ts   # Filter jadwal hari ini & mendatang
│   │   └── disposisiService.ts# Pelacakan status disposisi surat
│   ├── bot/
│   │   ├── handlers/
│   │   │   ├── authHandler.ts       # Autentikasi whitelist nomor
│   │   │   ├── menuHandler.ts       # Tampilan & navigasi Menu Utama
│   │   │   ├── suratMasukHandler.ts # Alur percakapan Surat Masuk & upload PDF
│   │   │   ├── jadwalHandler.ts     # Alur Jadwal Kegiatan
│   │   │   ├── disposisiHandler.ts  # Alur Status Disposisi
│   │   │   ├── riwayatHandler.ts    # Alur Riwayat Surat (Paginasi 5 surat)
│   │   │   └── bantuanHandler.ts    # Pusat Bantuan
│   │   ├── messageRouter.ts   # Router pengirim pesan ke handler sesuai state
│   │   ├── whatsappClient.ts  # Integrasi Baileys & QR Code WhatsApp
│   │   └── simulator.ts       # Interactive CLI simulator
│   └── index.ts               # Entry point aplikasi
├── storage/
│   ├── temp/                  # Folder berkas sementara saat upload
│   └── private/               # Folder penyimpanan permanen surat PDF
├── test/
│   └── verifyAllFlows.ts      # Pengujian otomatis end-to-end semua fitur
└── README.md
```
