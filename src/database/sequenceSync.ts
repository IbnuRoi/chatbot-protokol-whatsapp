import { prisma } from './prisma';

export interface SequenceSyncResult {
  table: string;
  column: string;
  seqName: string | null;
  maxId: bigint;
  status: 'synced' | 'no_sequence' | 'error';
  message?: string;
}

/**
 * Daftar tabel utama yang memiliki primary key auto-increment
 * dan digunakan secara bersamaan oleh Website (Web Dashboard) dan Chatbot WhatsApp.
 */
export const CRITICAL_SYNC_TABLES = [
  'letters',
  'events',
  'event_letters',
  'dispositions',
  'disposition_positions',
  'disposition_actions',
  'activity_log',
  'users',
];

/**
 * Mendapatkan nama sequence PostgreSQL untuk suatu tabel dan kolom
 */
async function resolveSequenceName(tableName: string, columnName: string = 'id'): Promise<string | null> {
  // 1. Coba pg_get_serial_sequence dengan berbagai format nama tabel
  const patterns = [
    `SELECT pg_get_serial_sequence('${tableName}', '${columnName}') as seq`,
    `SELECT pg_get_serial_sequence('public.${tableName}', '${columnName}') as seq`,
    `SELECT pg_get_serial_sequence('"${tableName}"', '${columnName}') as seq`,
    `SELECT pg_get_serial_sequence('public."${tableName}"', '${columnName}') as seq`,
  ];

  for (const query of patterns) {
    try {
      const res: any[] = await prisma.$queryRawUnsafe(query);
      if (res && res[0] && res[0].seq) {
        return res[0].seq;
      }
    } catch {
      // Lanjut ke percobaan berikutnya
    }
  }

  // 2. Coba periksa default value dari information_schema.columns (misal: nextval('letters_id_seq'::regclass))
  try {
    const colDefRes: any[] = await prisma.$queryRawUnsafe(`
      SELECT column_default 
      FROM information_schema.columns 
      WHERE table_schema = 'public' 
        AND table_name = '${tableName}' 
        AND column_name = '${columnName}'
      LIMIT 1
    `);
    const defaultVal: string = colDefRes[0]?.column_default || '';
    const match = defaultVal.match(/nextval\('([^']+)'/i);
    if (match && match[1]) {
      return match[1];
    }
  } catch {
    // Abaikan jika gagal query information_schema
  }

  // 3. Coba cari nama sequence dari pg_class yang cocok dengan pola nama tabel
  try {
    const pgClassRes: any[] = await prisma.$queryRawUnsafe(`
      SELECT relname 
      FROM pg_class 
      WHERE relkind = 'S' 
        AND (relname = '${tableName}_${columnName}_seq' OR relname = '${tableName}_id_seq')
      LIMIT 1
    `);
    if (pgClassRes[0]?.relname) {
      return `public."${pgClassRes[0].relname}"`;
    }
  } catch {
    // Abaikan jika gagal
  }

  return null;
}

/**
 * Menyinkronkan PostgreSQL sequence untuk sebuah tabel ke nilai MAX(id) terkini.
 * Ini memastikan bahwa panggilan nextval() berikutnya (baik dari Website maupun Chatbot)
 * akan selalu menghasilkan ID yang unik dan tidak bentrok (MAX(id) + 1).
 */
export async function syncTableSequence(
  tableName: string,
  columnName: string = 'id'
): Promise<SequenceSyncResult> {
  try {
    // 1. Cari nama sequence
    const seqName = await resolveSequenceName(tableName, columnName);

    // 2. Dapatkan MAX(id) dari data yang ada di tabel
    const maxRes: any[] = await prisma.$queryRawUnsafe(
      `SELECT COALESCE(MAX("${columnName}"), 0) as max_id FROM "${tableName}"`
    );
    const maxId = BigInt(maxRes[0]?.max_id || 0);

    if (!seqName) {
      return {
        table: tableName,
        column: columnName,
        seqName: null,
        maxId,
        status: 'no_sequence',
        message: 'Sequence tidak ditemukan pada kolom ini',
      };
    }

    // 3. Setval sequence ke MAX(id) jika ada data, atau 1 jika kosong (is_called false)
    if (maxId > BigInt(0)) {
      await prisma.$queryRawUnsafe(`SELECT setval('${seqName}', ${maxId.toString()}, true)`);
    } else {
      await prisma.$queryRawUnsafe(`SELECT setval('${seqName}', 1, false)`);
    }

    return {
      table: tableName,
      column: columnName,
      seqName,
      maxId,
      status: 'synced',
      message: `Sequence ${seqName} berhasil disinkronkan ke MAX(id): ${maxId.toString()}`,
    };
  } catch (err: any) {
    return {
      table: tableName,
      column: columnName,
      seqName: null,
      maxId: BigInt(0),
      status: 'error',
      message: err.message,
    };
  }
}

/**
 * Menyinkronkan semua sequence tabel penting di PostgreSQL.
 * Dapat dipanggil saat startup aplikasi atau via perintah CLI.
 */
export async function syncDatabaseSequences(
  tables: string[] = CRITICAL_SYNC_TABLES,
  silent: boolean = false
): Promise<SequenceSyncResult[]> {
  const results: SequenceSyncResult[] = [];

  if (!silent) {
    console.log('\n🔄 [SequenceSync] Memeriksa dan menyinkronkan sequence ID PostgreSQL...');
  }

  for (const table of tables) {
    const res = await syncTableSequence(table, 'id');
    results.push(res);

    if (!silent) {
      if (res.status === 'synced') {
        console.log(`   ✅ [${table}] ${res.seqName} -> MAX(id): ${res.maxId.toString()} (Nextval: ${(res.maxId + 1n).toString()})`);
      } else if (res.status === 'no_sequence') {
        console.log(`   ⚠️ [${table}] Sequence tidak terdeteksi (MAX(id): ${res.maxId.toString()})`);
      } else {
        console.warn(`   ❌ [${table}] Gagal sinkronisasi sequence: ${res.message}`);
      }
    }
  }

  if (!silent) {
    console.log('✅ [SequenceSync] Sinkronisasi sequence PostgreSQL selesai. Chatbot & Website tersinkronisasi.\n');
  }

  return results;
}

/**
 * Mendeteksi apakah error database merupakan error pelanggaran unique constraint / duplikasi ID
 */
export function isDuplicateKeyError(err: any): boolean {
  if (!err) return false;
  const msg = (err.message || '').toLowerCase();
  const code = (err.code || '').toString();
  return (
    code === 'P2002' || // Prisma unique constraint violation
    code === '23505' || // PostgreSQL unique_violation
    msg.includes('unique constraint') ||
    msg.includes('duplicate key') ||
    msg.includes('already exists')
  );
}
