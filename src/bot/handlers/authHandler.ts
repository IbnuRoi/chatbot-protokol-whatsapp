import { prisma } from '../../database/prisma';
import { ENV } from '../../config/env';

export interface NormalizedUser {
  id: number;
  nama: string;
  whatsappNumber: string;
  role: string;
  isActive: boolean;
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
   * Validasi apakah nomor pengguna terdaftar dan memiliki akses aktif di tabel users (PostgreSQL DB)
   */
  public async authenticate(rawPhone: string, pushName?: string): Promise<{
    isAuthenticated: boolean;
    user: NormalizedUser | null;
    message: string | null;
  }> {
    const normalized = this.normalizePhoneNumber(rawPhone);
    const lastDigits = normalized.length >= 9 ? normalized.slice(-9) : normalized;

    console.log(`[Auth] Memeriksa akses nomor: "${rawPhone}" -> Normalisasi: "${normalized}" (PushName: "${pushName || '-'}")`);

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

    let dbUser = await prisma.users.findFirst({
      where: {
        OR: orConditions,
      },
    });

    // Fitur Auto-Link jika nama profil WhatsApp cocok dengan nama user yang terdaftar di database
    if (!dbUser && pushName && pushName.trim().length >= 2) {
      const pName = pushName.trim().toLowerCase();
      const allDbUsers = await prisma.users.findMany();

      const stopWords = new Set(['pak', 'ibu', 'mas', 'mba', 'bpk', 'admin', 'staf', 'protokol', 'dr', 'drs']);

      // Filter nama bersih (menghilangkan keterangan dalam kurung seperti "(Admin Protokol)")
      const candidate = allDbUsers.find((u) => {
        const cleanUName = (u.name || '').toLowerCase().replace(/\(.*?\)/g, '').trim();
        if (cleanUName.length >= 3 && (pName.includes(cleanUName) || cleanUName.includes(pName))) {
          return true;
        }
        // Pencocokan berbasis kata kunci (misal: "Acho" cocok dengan "Pak Acho", "Cinta" cocok dengan "Cintaquu")
        const uTokens = cleanUName.split(/[\s_-]+/).filter((t) => t.length >= 3 && !stopWords.has(t));
        const pTokens = pName.split(/[\s_-]+/).filter((t) => t.length >= 3 && !stopWords.has(t));
        return uTokens.some((ut) => pTokens.some((pt) => ut.includes(pt) || pt.includes(ut)));
      });

      if (candidate) {
        const isLid = rawPhone.includes('@lid') || (normalized.length >= 14 && !normalized.startsWith('628') && !normalized.startsWith('08'));
        console.log(`[Auth Auto-Link] Menautkan WhatsApp ${isLid ? 'LID' : 'Nomor'} ${normalized} secara otomatis ke pengguna database: "${candidate.name}" (PushName: "${pushName}")`);
        dbUser = await prisma.users.update({
          where: { id: candidate.id },
          data: isLid ? { device_id: normalized } : { phone_number: normalized },
        });
      }
    }

    if (!dbUser) {
      console.warn(`[Auth] Akses ditolak: Nomor "${rawPhone}" (Normalisasi: "${normalized}") tidak ditemukan di database.`);
      return {
        isAuthenticated: false,
        user: null,
        message:
          `⛔ *AKSES DITOLAK*\n\n` +
          `Nomor / ID WhatsApp Anda (*${normalized || rawPhone}*) tidak terdaftar dalam basis data sistem Administrasi Protokol Kemnaker.\n\n` +
          `Akses chatbot hanya diberikan kepada pengguna yang telah terdaftar di dalam basis data resmi.\n\n` +
          `Silakan hubungi administrator jika Anda memerlukan hak akses:\n` +
          `📞 *Administrator:* ${ENV.ADMIN_CONTACT}`,
      };
    }

    const normalizedUser: NormalizedUser = {
      id: Number(dbUser.id),
      nama: dbUser.name,
      whatsappNumber: dbUser.phone_number,
      role: (dbUser.role || 'PROTOKOL').trim().toUpperCase(),
      isActive: true,
    };

    console.log(`[Auth] Akses diberikan: "${normalizedUser.nama}" (Role: ${normalizedUser.role})`);

    return {
      isAuthenticated: true,
      user: normalizedUser,
      message: null,
    };
  }
}

export const authHandler = new AuthHandler();
