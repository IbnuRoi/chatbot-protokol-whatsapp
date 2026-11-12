import { dbManager, ProtocolScope } from '../../database/dbManager';
import { ENV } from '../../config/env';

export interface NormalizedUser {
  id: number;
  nama: string;
  whatsappNumber: string;
  role: string;
  isActive: boolean;
  scope: ProtocolScope;
  allowedScopes: ProtocolScope[];
}

interface ScopeQueryResult {
  users: any[];
  failed: boolean;
}

export class AuthHandler {
  /**
   * Normalisasi nomor telepon ke format standar (contoh: 6281564899515)
   * Membersihkan domain JID (@s.whatsapp.net), device ID (:0, :1), dan karakter non-digit
   */
  public normalizePhoneNumber(phone: string): string {
    if (!phone) return '';
    // 1. Buang domain JID (@s.whatsapp.net, @lid, dll)
    let clean = phone.split('@')[0];
    // 2. Buang device ID jika ada (contoh: 6281564899515:0 -> 6281564899515)
    clean = clean.split(':')[0];
    // 3. Buang seluruh karakter non-angka
    clean = clean.replace(/[^0-9]/g, '');

    // 4. Standarisasi awalan untuk nomor telepon seluler Indonesia
    if (clean.startsWith('0062')) {
      clean = '62' + clean.slice(4);
    }
    if (clean.startsWith('6208')) {
      clean = '628' + clean.slice(4);
    } else if (clean.startsWith('08')) {
      clean = '628' + clean.slice(2);
    } else if (clean.startsWith('8') && clean.length >= 9 && clean.length <= 13) {
      clean = '628' + clean.slice(1);
    }
    return clean;
  }

  /**
   * Memastikan string digit adalah nomor telepon asli (bukan placeholder seperti 1, 0800, 12345678)
   */
  private isValidPhoneNumber(normalized: string): boolean {
    if (!normalized || normalized.length < 10 || normalized.length > 15) {
      return false;
    }
    if (/^(0+|1234567890?|0123456789)$/.test(normalized)) {
      return false;
    }
    return true;
  }

  /**
   * Memeriksa apakah pengirim menggunakan WhatsApp Privacy LID (bukan nomor telepon MSISDN)
   */
  private isLidIdentifier(rawPhone: string, normalized: string): boolean {
    return (
      rawPhone.includes('@lid') ||
      (normalized.length >= 14 && !normalized.startsWith('628') && !normalized.startsWith('08'))
    );
  }

  /**
   * Mengambil seluruh pengguna aktif (deleted_at === null) pada scope database tertentu
   */
  private async fetchActiveUsers(scope: ProtocolScope): Promise<ScopeQueryResult> {
    try {
      const client = dbManager.getClient(scope);
      const users = await client.users.findMany({
        where: { deleted_at: null },
        orderBy: { id: 'asc' },
      });
      return { users, failed: false };
    } catch (err: any) {
      console.error(`❌ [Auth] Gagal memeriksa tabel users pada scope [${scope}]: ${err?.message || err}`);
      return { users: [], failed: true };
    }
  }

  /**
   * Mencocokkan user aktif dari daftar berdasarkan nomor ter-normalisasi (mengabaikan spasi/tanda hubung) atau device_id
   */
  private matchActiveUser(users: any[], rawPhone: string, normalized: string): any | null {
    const isLid = this.isLidIdentifier(rawPhone, normalized);

    // 1. Cocokkan berdasarkan nomor HP ter-normalisasi (menangani format +62 813-xxxx-xxxx, 08xx, 628xx)
    if (!isLid && this.isValidPhoneNumber(normalized)) {
      const byPhone = users.find((u) => {
        const dbPhoneNorm = this.normalizePhoneNumber(u.phone_number || '');
        return this.isValidPhoneNumber(dbPhoneNorm) && dbPhoneNorm === normalized;
      });
      if (byPhone) return byPhone;
    }

    // 2. Cocokkan berdasarkan device_id (untuk Baileys LID atau ID perangkat eksplisit, abaikan FCM token)
    const rawTrimmed = (rawPhone || '').trim();
    const rawDeviceClean = rawTrimmed.split('@')[0].split(':')[0].trim();
    const byDevice = users.find((u) => {
      const dbDev = (u.device_id || '').trim();
      if (!dbDev || dbDev.toLowerCase() === 'null' || dbDev.includes(':')) {
        return false;
      }
      return (
        dbDev === rawTrimmed ||
        (rawDeviceClean !== '' && dbDev === rawDeviceClean) ||
        (normalized !== '' && dbDev === normalized)
      );
    });

    return byDevice || null;
  }

  /**
   * Auto-Link konservatif KHUSUS WhatsApp LID (@lid) jika kandidat unik cocok ketat berdasarkan nama penuh/kata utuh
   */
  private async tryAutoLinkLid(
    scope: ProtocolScope,
    users: any[],
    rawPhone: string,
    normalized: string,
    pushName?: string
  ): Promise<any | null> {
    if (!this.isLidIdentifier(rawPhone, normalized) || !normalized) return null;
    if (!pushName || pushName.trim().length < 3) return null;

    const pName = pushName.trim().toLowerCase().replace(/\s+/g, ' ');
    const stopWords = new Set(['pak', 'ibu', 'mas', 'mba', 'bpk', 'admin', 'staf', 'protokol', 'dr', 'drs']);
    const pTokens = pName.split(/[\s_-]+/).filter((t) => t.length >= 3 && !stopWords.has(t));

    const candidates = users.filter((u) => {
      // Hanya izinkan auto-link ke akun yang memiliki nomor telepon valid dan belum memiliki LID numerik lain
      const dbPhoneNorm = this.normalizePhoneNumber(u.phone_number || '');
      if (!this.isValidPhoneNumber(dbPhoneNorm)) return false;

      const existingDev = (u.device_id || '').trim();
      const hasOtherLid =
        existingDev !== '' &&
        existingDev.toLowerCase() !== 'null' &&
        !existingDev.includes(':') &&
        /^[0-9]{10,}$/.test(existingDev) &&
        existingDev !== normalized;
      if (hasOtherLid) return false;

      const cleanUName = String(u.name || '').toLowerCase().replace(/\(.*?\)/g, '').replace(/\s+/g, ' ').trim();
      if (!cleanUName) return false;
      if (cleanUName === pName) return true;

      const uTokens = cleanUName.split(/[\s_-]+/).filter((t: string) => t.length >= 3 && !stopWords.has(t));
      if (uTokens.length === 0 || pTokens.length === 0) return false;

      const exactTokenMatches = uTokens.filter((ut: string) => pTokens.includes(ut));
      return exactTokenMatches.length >= Math.min(2, uTokens.length);
    });

    // Hanya tautkan jika kandidat tepat satu (tidak ambigu)
    if (candidates.length !== 1) return null;

    const candidate = candidates[0];
    try {
      const client = dbManager.getClient(scope);
      console.log(`[Auth Auto-Link ${scope}] Menautkan WhatsApp LID ${normalized} ke pengguna aktif: "${candidate.name}" (PushName: "${pushName}")`);
      return await client.users.update({
        where: { id: candidate.id },
        data: {
          device_id: normalized,
          updated_at: new Date(),
        },
      });
    } catch (err: any) {
      console.warn(`⚠️ [Auth Auto-Link ${scope}] Gagal memperbarui device_id: ${err?.message || err}`);
      return null;
    }
  }

  /**
   * Validasi otomatis hak akses nomor pengguna.
   * Mendeteksi secara mandiri apakah nomor terdaftar di Database Menteri, Database Wamen, atau Keduanya.
   */
  public async authenticate(
    rawPhone: string,
    pushName?: string,
    preferredScope?: ProtocolScope
  ): Promise<{
    isAuthenticated: boolean;
    user: NormalizedUser | null;
    message: string | null;
    scope: ProtocolScope;
  }> {
    const normalized = this.normalizePhoneNumber(rawPhone);
    const hasWamenDb = Boolean(ENV.DB_NAME_WAMEN || ENV.DATABASE_URL_WAMEN);

    console.log(`[Auth] Memeriksa akses nomor: "${rawPhone}" -> Normalisasi: "${normalized}" (PushName: "${pushName || '-'}", PreferredScope: ${preferredScope || 'AUTO'})`);

    // 1. Ambil user aktif dari Database Menaker dan (jika dikonfigurasi) Database Wamen
    const menakerRes = await this.fetchActiveUsers('MENAKER');
    const wamenRes = hasWamenDb ? await this.fetchActiveUsers('WAMEN') : { users: [], failed: false };

    let userMenaker = this.matchActiveUser(menakerRes.users, rawPhone, normalized);
    let userWamen = hasWamenDb ? this.matchActiveUser(wamenRes.users, rawPhone, normalized) : null;

    // 2. Jika cocok lewat Baileys LID di salah satu DB, cocokan juga ke DB lainnya memakai nomor HP aslinya
    if (userMenaker && !userWamen && hasWamenDb) {
      const menakerPhone = this.normalizePhoneNumber(userMenaker.phone_number || '');
      if (this.isValidPhoneNumber(menakerPhone)) {
        userWamen = this.matchActiveUser(wamenRes.users, menakerPhone, menakerPhone);
      }
    } else if (userWamen && !userMenaker) {
      const wamenPhone = this.normalizePhoneNumber(userWamen.phone_number || '');
      if (this.isValidPhoneNumber(wamenPhone)) {
        userMenaker = this.matchActiveUser(menakerRes.users, wamenPhone, wamenPhone);
      }
    }

    // 3. Fallback Auto-Link konservatif khusus untuk WhatsApp LID (@lid) jika belum cocok sama sekali
    if (!userMenaker && !userWamen) {
      userMenaker = await this.tryAutoLinkLid('MENAKER', menakerRes.users, rawPhone, normalized, pushName);
      if (!userMenaker && hasWamenDb) {
        userWamen = await this.tryAutoLinkLid('WAMEN', wamenRes.users, rawPhone, normalized, pushName);
      }
      if (userMenaker && hasWamenDb) {
        const menakerPhone = this.normalizePhoneNumber(userMenaker.phone_number || '');
        if (this.isValidPhoneNumber(menakerPhone)) {
          userWamen = this.matchActiveUser(wamenRes.users, menakerPhone, menakerPhone);
        }
      } else if (userWamen && !userMenaker) {
        const wamenPhone = this.normalizePhoneNumber(userWamen.phone_number || '');
        if (this.isValidPhoneNumber(wamenPhone)) {
          userMenaker = this.matchActiveUser(menakerRes.users, wamenPhone, wamenPhone);
        }
      }
    }

    const allowedScopes: ProtocolScope[] = [];
    if (userMenaker) allowedScopes.push('MENAKER');
    if (userWamen) allowedScopes.push('WAMEN');

    // 4. Tangani error koneksi DB sebelum memutuskan bahwa nomor tidak terdaftar
    if (allowedScopes.length === 0 && (menakerRes.failed || (hasWamenDb && wamenRes.failed))) {
      console.error(`⚠️ [Auth] Gagal memverifikasi nomor "${rawPhone}" karena kendala koneksi database.`);
      return {
        isAuthenticated: false,
        user: null,
        message:
          `⚠️ *KENDALA KONEKSI SISTEM*\n\n` +
          `Maaf, sistem saat ini mengalami gangguan sementara saat memverifikasi akun Anda ke basis data.\n\n` +
          `Silakan coba kirim pesan kembali beberapa saat lagi atau hubungi administrator:\n` +
          `📞 *Administrator:* ${ENV.ADMIN_CONTACT}`,
        scope: preferredScope || 'MENAKER',
      };
    }

    // 5. Jika nomor memang tidak ditemukan di kedua database aktif -> Tolak akses
    if (allowedScopes.length === 0) {
      console.warn(`[Auth] Akses ditolak: Nomor "${rawPhone}" (Normalisasi: "${normalized}") tidak terdaftar di database Menaker maupun Wamen.`);
      return {
        isAuthenticated: false,
        user: null,
        message:
          `⛔ *AKSES DITOLAK*\n\n` +
          `Nomor / ID WhatsApp Anda (*${normalized || rawPhone}*) tidak terdaftar dalam basis data sistem Administrasi Protokol Kemnaker.\n\n` +
          `Akses chatbot hanya diberikan kepada staf dan pejabat yang telah terdaftar di dalam basis data resmi.\n\n` +
          `Silakan hubungi administrator jika Anda memerlukan hak akses:\n` +
          `📞 *Administrator:* ${ENV.ADMIN_CONTACT}`,
        scope: preferredScope || 'MENAKER',
      };
    }

    // 6. Tentukan ruang lingkup aktif secara otomatis
    let activeScope: ProtocolScope;
    let activeDbUser: any;

    if (allowedScopes.length === 1) {
      // Kasus Ideal: Pengguna hanya terdaftar di salah satu database (Menteri saja atau Wamen saja)
      activeScope = allowedScopes[0];
      activeDbUser = activeScope === 'WAMEN' ? userWamen : userMenaker;
      console.log(`[Auth Otomatis] Pengguna terdeteksi eksklusif pada ruang lingkup [${activeScope}]`);
    } else {
      // Kasus Khusus: Pengguna terdaftar di kedua database (Administrator / Pimpinan Bersama)
      activeScope = preferredScope && allowedScopes.includes(preferredScope) ? preferredScope : 'MENAKER';
      activeDbUser = activeScope === 'WAMEN' ? userWamen : userMenaker;
      console.log(`[Auth Otomatis] Pengguna terdaftar di KEDUA database (Menaker & Wamen). Menggunakan [${activeScope}]`);
    }

    const normalizedUser: NormalizedUser = {
      id: Number(activeDbUser.id),
      nama: activeDbUser.name,
      whatsappNumber: this.normalizePhoneNumber(activeDbUser.phone_number || '') || normalized,
      role: (activeDbUser.role || 'PROTOKOL').trim().toUpperCase(),
      isActive: true,
      scope: activeScope,
      allowedScopes,
    };

    console.log(`[Auth] Akses diberikan [${activeScope}]: "${normalizedUser.nama}" (Role: ${normalizedUser.role}, Allowed: [${allowedScopes.join(',')}])`);
    return {
      isAuthenticated: true,
      user: normalizedUser,
      message: null,
      scope: activeScope,
    };
  }
}

export const authHandler = new AuthHandler();
