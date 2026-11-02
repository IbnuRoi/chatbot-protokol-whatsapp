# 📑 Rencana Implementasi: Migrasi WhatsApp Cloud API (Meta) & Dual-Scope Agenda Wamen

Dokumen ini merangkum arsitektur, strategi teknis, dan rencana tahapan implementasi untuk:
1. **Migrasi dari pustaka WhatsApp Web Client (`@whiskeysockets/baileys`) ke WhatsApp Cloud API resmi (Meta for Developers)**.
2. **Pengembangan dukungan agenda Wakil Menteri (Wamen)** menggunakan arsitektur **Multi-Tenancy** tanpa menduplikasi kode project (*Zero Code Duplication*) dan hemat kapasitas server (*Resource Efficient*).

---

## 🏛️ 1. Arsitektur Sistem Baru

```mermaid
flowchart TD
    subgraph WhatsApp Channels
        UserA["Pengguna Chat Menaker"] --> MetaCloud["Meta Cloud API (Graph API)"]
        UserB["Pengguna Chat Wamen"] --> MetaCloud
    end

    subgraph Server Protokol Kemnaker (Single Instance)
        MetaCloud -->|"HTTP POST /webhook"| WebhookHandler["Webhook Controller (Express/Fastify)"]
        WebhookHandler --> ContextResolver["Scope & Tenant Resolver\n(Identifikasi Menaker vs Wamen)"]
        ContextResolver --> MessageRouter["MessageRouter (Core Business Logic)"]
        
        MessageRouter --> Handlers["Handlers:\n• SuratMasukHandler\n• JadwalHandler\n• DisposisiHandler\n• NluService"]
        
        Handlers --> DynamicPrisma["Dynamic Prisma Client / Database Manager"]
        Handlers --> MetaSender["Meta Graph API Client\n(POST /messages)"]
    end

    subgraph Database Infrastructure
        DynamicPrisma -->|"Scope: MENAKER"| DBMenaker[("Database Protokol Menaker")]
        DynamicPrisma -->|"Scope: WAMEN"| DBWamen[("Database Protokol Wamen")]
    end

    MetaSender -->|"Kirim Balasan Resmi"| MetaCloud
```

---

## 🚀 2. Rencana Migrasi ke WhatsApp Cloud API (Meta)

### 2.1. Keuntungan Migrasi
- **Bebas Sesi Terputus (No Re-auth / 401)**: Tidak ada isu QR code kedaluwarsa atau token enkripsi desinkronisasi (*Bad MAC*).
- **Infrastruktur Resmi & Stateless**: Berjalan di atas protokol HTTPS REST API dan Webhook standar Meta.
- **Dukungan Multi-Nomor**: 1 Akun Meta Business App dapat menampung banyak nomor telepon (misal: nomor Protokol Menaker dan nomor Protokol Wamen).

### 2.2. Roadmap Tahapan Pengerjaan

#### Tahap 1: Setup Akun & Kredensial Meta
1. Membuat Meta Business Account & Meta for Developers App (tipe *Business*).
2. Mendaftarkan nomor WhatsApp resmi Kemnaker dan verifikasi OTP.
3. Membuat **Permanent Access Token** via *System User* di Meta Business Manager (dengan permission `whatsapp_business_messaging` dan `whatsapp_business_management`).
4. Menyiapkan konfigurasi di `.env`:
   ```env
   WHATSAPP_PROVIDER="meta" # "meta" | "baileys" | "simulator"
   META_WA_TOKEN="EAAG..."
   META_WA_PHONE_NUMBER_ID_MENAKER="1234567890..."
   META_WA_PHONE_NUMBER_ID_WAMEN="0987654321..."
   META_WA_WABA_ID="1122334455..."
   META_WA_VERIFY_TOKEN="kemnaker_protokol_secure_webhook_token_2026"
   META_WA_WEBHOOK_PORT=3000
   ```

#### Tahap 2: Pembuatan Provider Layer (Adapter Pattern)
- Buat file `src/bot/providers/IWhatsAppProvider.ts` sebagai kontrak antarmuka:
  - `start(): Promise<void>`
  - `sendMessage(to: string, response: BotResponse, options?: any): Promise<void>`
  - `downloadMedia(mediaId: string): Promise<{ buffer: Buffer; fileName: string; mimeType: string }>`
- Buat `MetaCloudProvider.ts` yang mengimplementasikan `IWhatsAppProvider`.
- Pustaka `Baileys` tetap dapat dipertahankan sebagai opsi fallback pengembangan lokal melalui env switch (`WHATSAPP_PROVIDER=baileys`).

#### Tahap 3: Pembuatan Endpoint Webhook Server
- Buat server HTTP ringan (Express / Fastify / Node http) yang menangani:
  1. `GET /webhook`: Verifikasi webhook dari Meta (`hub.mode`, `hub.verify_token`, `hub.challenge`).
  2. `POST /webhook`: Menerima event pesan masuk dari pengguna WhatsApp.
- **Parsing Pesan Masuk**:
  - Teks biasa (`messages[0].text.body`).
  - Interaksi tombol / quick reply / list (`messages[0].interactive`).
  - Media gambar / PDF: Ambil `media_id`, download biner dari Graph API Meta, dan simpan ke `storage/temp/` via `pdfService` atau `imageService`.
- **Integrasi ke MessageRouter**:
  - Panggil `messageRouter.processMessage({ senderNumber, pushName, text, media, metadata })`.
  - Kembalikan HTTP `200 OK` segera ke Meta dalam < 3 detik.

#### Tahap 4: Pengiriman Pesan Keluar (Outbound Graph API)
- Mengirim pesan balasan menggunakan HTTP `POST https://graph.facebook.com/v21.0/{PHONE_NUMBER_ID}/messages` dengan Bearer Token.
- Mendukung pengiriman berurutan (*multiple bubble chats*) seperti fitur yang sudah berjalan saat ini.

---

## 👥 3. Rencana Dukungan Agenda Wamen (Multi-Tenancy)

### 3.1. Mengapa Menolak Ide Duplikasi Kode?
| Aspek | Duplikasi Kode (Copy-Paste) | Solusi Multi-Tenancy (1 Codebase) |
| :--- | :--- | :--- |
| **Penyimpanan Server** | ❌ Memakan disk 2x lipat (2x `node_modules`, 2x dist) | ✅ **100% Hemat (hanya 1 project)** |
| **Konsumsi RAM Server**| ❌ Boros 2x lipat (2 proses Node.js & 2 SSH tunnel) | ✅ **Hemat RAM (cukup 1 proses)** |
| **Pemeliharaan Kode**  | ❌ Rentan error & perbaikan harus diulang di 2 repo | ✅ **1x update berlaku untuk Menaker & Wamen** |
| **Dukungan Nomor WA**  | ❌ Kaku | ✅ **Bisa 2 nomor terpisah atau 1 nomor switchable** |

### 3.2. Pilihan Model Operasional

#### Pilihan A: 2 Nomor WhatsApp Berbeda (Nomor Menaker & Nomor Wamen)
- Di Meta Cloud API, 1 Meta Business App dapat memiliki lebih dari satu Phone Number ID.
- Saat pesan masuk via Webhook, Meta menyertakan `metadata.phone_number_id`:
  - Jika ID cocok dengan Menaker $\rightarrow$ Set database context ke **Database Menaker**.
  - Jika ID cocok dengan Wamen $\rightarrow$ Set database context ke **Database Wamen**.
- Pengguna berinteraksi dengan nomor bot yang berbeda sesuai kebutuhannya, namun di sisi server tetap ditangani oleh **1 program yang sama**.

#### Pilihan B: 1 Nomor WhatsApp Terpadu dengan Fitur Switch Scope
- Hanya menggunakan 1 nomor resmi WhatsApp Protokol Kemnaker.
- Pengguna dapat beralih ruang lingkup melalui menu bot:
  - Default: Agenda Menaker.
  - Pilihan Menu: `4. 🔄 Beralih ke Agenda WAKIL MENTERI`.
- Atribut scope tersimpan di `sessionService` pengguna.

### 3.3. Implementasi Teknis Dynamic Database Client
1. **Konfigurasi Lingkungan (`.env`)**:
   ```env
   # Database Protokol Menaker
   DB_NAME_MENAKER="pwa_protokol_menaker"
   
   # Database Protokol Wamen
   DB_NAME_WAMEN="pwa_protokol_wamen"
   ```
2. **Database Manager (`src/database/dbManager.ts`)**:
   ```ts
   export type ProtocolScope = 'MENAKER' | 'WAMEN';

   class DatabaseManager {
     private clients: Map<ProtocolScope, PrismaClient> = new Map();

     public getClient(scope: ProtocolScope = 'MENAKER'): PrismaClient {
       if (!this.clients.has(scope)) {
         const dbName = scope === 'WAMEN' ? ENV.DB_NAME_WAMEN : ENV.DB_NAME_MENAKER;
         const url = buildDatabaseUrl(dbName);
         this.clients.set(scope, new PrismaClient({ datasources: { db: { url } } }));
       }
       return this.clients.get(scope)!;
     }
   }
   export const dbManager = new DatabaseManager();
   ```
3. **Penyelarasan Services & Handlers**:
   - `jadwalService`, `suratService`, dan `disposisiHandler` menerima parameter opsional `scope: ProtocolScope`.
   - `sessionService` menyimpan `scope` aktif pengguna.

---

## 📅 4. Jadwal & Checklist Eksekusi (Ketika Siap Dijalankan)

- [ ] **Fase 1: Meta Setup**
  - [ ] Pendaftaran nomor telepon di Meta for Developers.
  - [ ] Pembuatan Permanent Token via System User.
- [ ] **Fase 2: Adapter & Webhook**
  - [ ] Pembuatan `MetaCloudProvider.ts`.
  - [ ] Pengujian Webhook GET (verifikasi challenge) & POST (terima pesan).
- [ ] **Fase 3: Multi-Tenancy Engine**
  - [ ] Pembuatan `dbManager.ts` (Dual Prisma Client).
  - [ ] Penambahan `scope` pada `UserSession` dan routing pesan.
- [ ] **Fase 4: Testing & Deployment**
  - [ ] Uji coba registrasi surat masuk untuk Menaker & Wamen.
  - [ ] Uji coba pencarian jadwal kegiatan untuk Menaker & Wamen.
  - [ ] Deployment ke server VPS produksi Kemnaker.

