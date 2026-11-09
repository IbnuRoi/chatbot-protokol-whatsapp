import { dbManager, ExtendedPrismaClient } from './dbManager';

/**
 * Instance default Prisma Client (Ruang Lingkup: MENAKER)
 * Dipertahankan untuk kompatibilitas penuh dengan kode dan script eksisting.
 */
export const prisma: ExtendedPrismaClient = dbManager.getClient('MENAKER');
