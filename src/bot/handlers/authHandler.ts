import { prisma } from '../../database/prisma';
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
    if (clean.startsWith('08')) {
      clean = '628' + clean.slice(2);
    } else if (clean.startsWith('8') && clean.length <= 13) {
      clean = '628' + clean.slice(1);
    }
    return clean;
  }

  /**
   * Mencari kecocokan user di database scope tertentu
   */
  private async findUserInScope(
    scope: ProtocolScope,
    orConditions: any[],
    rawPhone: string,
    normalized: string,
    pushName?: string
  ): Promise<any | null> {
    try {
      const client = dbManager.getClient(scope);
      let dbUser = await client.users.findFirst({
        where: { OR: orConditions },
      });

      // Fitur Auto-Link jika nama profil WhatsApp cocok dengan nama user yang terdaftar di database
      if (!dbUser && pushName && pushName.trim().length >= 2) {
        const pName = pushName.trim().toLowerCase();
        const allDbUsers = await client.users.findMany();

        const stopWords = new Set(['pak', 'ibu', 'mas', 'mba', 'bpk', 'admin', 'staf', 'protokol', 'dr', 'drs']);

        const candidate = allDbUsers.find((u) => {
          const cleanUName = (u.name || '').toLowerCase().replace(/\(.*?\)/g, '').trim();
          if (cleanUName.length >= 3 && (pName.includes(cleanUName) || cleanUName.includes(pName))) {
            return true;
          }
          const uTokens = cleanUName.split(/[\s_-]+/).filter((t) => t.length >= 3 && !stopWords.has(t));
          const pTokens = pName.split(/[\s_-]+/).filter((t) => t.length >= 3 && !stopWords.has(t));
          return uTokens.some((ut) => pTokens.some((pt) => ut.includes(pt) || pt.includes(ut)));
        });

        if (candidate) {
          const isLid = rawPhone.includes('@lid') || (normalized.length >= 14 && !normalized.startsWith('628') && !normalized.startsWith('08'));
          console.log(`[Auth Auto-Link ${scope}] Menautkan WhatsApp ${isLid ? 'LID' : 'Nomor'} ${normalized} secara otomatis ke pengguna database: "${candidate.name}" (PushName: "${pushName}")`);
          dbUser = await client.users.update({
            where: { id: candidate.id },
            data: isLid ? { device_id: normalized } : { phone_number: normalized },
          });
        }
      }

      return dbUser;
    } catch (err: any) {
      console.warn(`⚠️ [Auth] Gagal memeriksa tabel users pada scope [${scope}]: ${err?.message || err}`);
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
    const lastDigits = normalized.length >= 9 ? normalized.slice(-9) : normalized;

    console.log(`[Auth] Memeriksa akses nomor: "${rawPhone}" -> Normalisasi: "${normalized}" (PushName: "${pushName || '-'}", PreferredScope: ${preferredScope || 'AUTO'})`);

    const orConditions: any[] = [
      { phone_number: normalized },
      { device_id: normalized },
      { device_id: rawPhone },
      { phone_number: '0' + (normalized.startsWith('62') ? normalized.slice(2) : normalized) },
      { phone_number: '+' + normalized },
    ];
    if (lastDigits.length >= 8) {
      orConditions.push({ phone_number: { contains: lastDigits } });
    }

    // 1. Periksa keberadaan akun di Database Menaker
    const userMenaker = await this.findUserInScope('MENAKER', orConditions, rawPhone, normalized, pushName);

    // 2. Periksa keberadaan akun di Database Wamen
    let userWamen: any = null;
    if (ENV.DB_NAME_WAMEN || ENV.DATABASE_URL_WAMEN) {
      userWamen = await this.findUserInScope('WAMEN', orConditions, rawPhone, normalized, pushName);
    }

    const allowedScopes: ProtocolScope[] = [];
    if (userMenaker) allowedScopes.push('MENAKER');
    if (userWamen) allowedScopes.push('WAMEN');

    // 3. Jika nomor tidak ditemukan di kedua database -> Tolak akses
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

    // 4. Tentukan ruang lingkup aktif secara otomatis
    let activeScope: ProtocolScope;
    let activeDbUser: any;

    if (allowedScopes.length === 1) {
      // Kasus Ideal: Pengguna hanya terdaftar di salah satu database (Menteri saja atau Wamen saja)
      activeScope = allowedScopes[0];
      activeDbUser = activeScope === 'WAMEN' ? userWamen : userMenaker;
      console.log(`[Auth Otomatis] Pengguna terdeteksi eksklusif pada ruang lingkup [${activeScope}]`);
    } else {
      // Kasus Khusus: Pengguna terdaftar di kedua database (Administrator / Pimpinan Bersama)
      activeScope = (preferredScope && allowedScopes.includes(preferredScope)) ? preferredScope : 'MENAKER';
      activeDbUser = activeScope === 'WAMEN' ? userWamen : userMenaker;
      console.log(`[Auth Otomatis] Pengguna terdaftar di KEDUA database (Menaker & Wamen). Menggunakan [${activeScope}]`);
    }

    const normalizedUser: NormalizedUser = {
      id: Number(activeDbUser.id),
      nama: activeDbUser.name,
      whatsappNumber: activeDbUser.phone_number || normalized,
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
