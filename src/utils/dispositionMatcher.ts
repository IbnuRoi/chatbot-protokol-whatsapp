/**
 * Utilitas Pencocokan Cerdas (Smart Fuzzy & Semantic Matcher)
 * untuk memetakan nama jabatan (positions) dan tindakan (actions) dari lembar disposisi
 * ke opsi resmi yang terdaftar di database sistem.
 */

export interface PositionCandidate {
  id: bigint | number;
  name: string;
  alias?: string | null;
}

export interface ActionCandidate {
  id: bigint | number;
  name: string;
}

/**
 * Kamus sinonim & akronim istilah birokrasi pemerintahan Kemnaker RI
 */
const ROLE_ACRONYM_MAP: Record<string, string> = {
  // Eselon & Pimpinan
  kabag: 'kepala bagian',
  kasubag: 'kepala subbagian',
  kasubbag: 'kepala subbagian',
  karo: 'kepala biro',
  kaur: 'kepala urusan',
  dirjen: 'direktur jenderal',
  ditjen: 'direktorat jenderal',
  sekjen: 'sekretaris jenderal',
  setjen: 'sekretariat jenderal',
  irjen: 'inspektur jenderal',
  itjen: 'inspektorat jenderal',
  sesditjen: 'sekretaris direktorat jenderal',
  sesitjen: 'sekretaris inspektorat jenderal',
  sesbadan: 'sekretaris badan',
  wamen: 'wakil menteri',
  menaker: 'menteri ketenagakerjaan',
  sam: 'staf ahli menteri',
  skm: 'staf khusus menteri',

  // Substansi & Unit Kerja
  tu: 'tata usaha',
  sdm: 'sumber daya manusia',
  humas: 'hubungan masyarakat',
  k3: 'keselamatan dan kesehatan kerja',
  phi: 'pembinaan hubungan industrial',
  jamsos: 'jaminan sosial',
  jamsostek: 'jaminan sosial',
  binapenta: 'pembinaan penempatan tenaga kerja',
  pkk: 'perluasan kesempatan kerja',
  binalavotas: 'pembinaan pelatihan vokasi',
  binalattas: 'pembinaan pelatihan dan produktivitas',
  binwasnaker: 'pembinaan pengawasan ketenagakerjaan',
  barenbang: 'badan perencanaan dan pengembangan',
  pusdatin: 'pusat data dan teknologi informasi',
  hukum: 'hukum',
  protokol: 'protokol',
  pimpinan: 'pimpinan',
  umum: 'umum',
  keuangan: 'keuangan',
};

/**
 * Normalisasi teks jabatan: memperluas singkatan (kabag -> kepala bagian, tu -> tata usaha),
 * membuang kata hubung, dan membersihkan tanda baca.
 */
export function normalizeRoleText(input: string): string {
  if (!input) return '';
  let str = input.toLowerCase();

  // Ganti simbol pemisah dengan spasi
  str = str.replace(/[&\/\\_\-\.,;:\(\)]/g, ' ');

  // Tokenisasi dan ekspansi akronim
  const words = str.split(/\s+/).filter(Boolean);
  const expanded: string[] = [];

  for (const w of words) {
    if (ROLE_ACRONYM_MAP[w]) {
      expanded.push(ROLE_ACRONYM_MAP[w]);
    } else {
      expanded.push(w);
    }
  }

  let result = expanded.join(' ');

  // Normalisasi stopwords & nama instansi
  result = result
    .replace(/\b(?:dan|atau|serta|pada|di|ke|untuk|terhadap|para)\b/g, ' ')
    .replace(/\b(?:republik indonesia|ri|indonesia)\b/g, ' ')
    .replace(/\b(?:kemenaker|kemnaker|kementerian ketenagakerjaan)\b/g, 'kementerian')
    .replace(/\s{2,}/g, ' ')
    .trim();

  return result;
}

/**
 * Ekstraksi token kata kunci unik berbobot
 */
export function extractRoleTokens(normalized: string): string[] {
  const stopwords = new Set(['yang', 'dengan', 'atas', 'dalam', 'ini', 'oleh']);
  const tokens = normalized
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 2 && !stopwords.has(w));
  return Array.from(new Set(tokens));
}

/**
 * Menghitung skor kecocokan antara dua array token kata kunci
 */
function scoreTokenMatch(targetTokens: string[], candidateTokens: string[]): number {
  if (targetTokens.length === 0 || candidateTokens.length === 0) return 0;

  let matched = 0;
  for (const tt of targetTokens) {
    // Exact token match
    if (candidateTokens.includes(tt)) {
      matched += 1.0;
      continue;
    }
    // Partial substring match for root words (misal: "protokol" <-> "protokoler")
    const partialMatch = candidateTokens.some(
      (ct) => (tt.length >= 4 && ct.includes(tt)) || (ct.length >= 4 && tt.includes(ct))
    );
    if (partialMatch) {
      matched += 0.85;
    }
  }

  const recall = matched / targetTokens.length;
  const precision = matched / candidateTokens.length;
  if (recall + precision === 0) return 0;

  // Dice F1-Score
  return (2 * recall * precision) / (recall + precision);
}

/**
 * Mencocokkan SATU nama jabatan yang diekstrak terhadap daftar kandidat database
 */
export function matchSinglePosition(
  target: string,
  candidates: PositionCandidate[]
): { candidate: PositionCandidate; score: number } | null {
  const cleanTarget = target.trim();
  if (!cleanTarget || candidates.length === 0) return null;

  const normTarget = normalizeRoleText(cleanTarget);
  const targetTokens = extractRoleTokens(normTarget);
  const targetCompact = normTarget.replace(/\s+/g, '');

  let bestCand: PositionCandidate | null = null;
  let bestScore = 0;

  for (const cand of candidates) {
    const normName = normalizeRoleText(cand.name);
    const nameTokens = extractRoleTokens(normName);
    const nameCompact = normName.replace(/\s+/g, '');

    const normAlias = cand.alias ? normalizeRoleText(cand.alias) : '';
    const aliasTokens = normAlias ? extractRoleTokens(normAlias) : [];
    const aliasCompact = normAlias.replace(/\s+/g, '');

    // 1. Direct compact match (100% match)
    if (nameCompact === targetCompact || aliasCompact === targetCompact) {
      return { candidate: cand, score: 1.0 };
    }

    // 2. Substring compact match
    if (nameCompact.includes(targetCompact) || targetCompact.includes(nameCompact)) {
      const compactScore =
        Math.min(nameCompact.length, targetCompact.length) /
        Math.max(nameCompact.length, targetCompact.length);
      if (compactScore > bestScore) {
        bestScore = compactScore;
        bestCand = cand;
      }
    }

    // 3. Token-based overlap scoring
    const allCandTokens = Array.from(new Set([...nameTokens, ...aliasTokens]));
    const tokenScore = scoreTokenMatch(targetTokens, allCandTokens);

    if (tokenScore > bestScore) {
      bestScore = tokenScore;
      bestCand = cand;
    }
  }

  // Ambang batas toleransi (0.35 sudah mencakup perbedaan kata sambung / format)
  if (bestScore >= 0.35 && bestCand) {
    return { candidate: bestCand, score: bestScore };
  }

  return null;
}

/**
 * Memecah dan mencocokkan seluruh daftar jabatan tujuan disposisi (diteruskanKepada)
 * Menghasilkan daftar kandidat unik yang cocok di database
 */
export function matchPositionsList(
  targets: string[],
  candidates: PositionCandidate[]
): PositionCandidate[] {
  if (!targets || targets.length === 0 || candidates.length === 0) return [];

  const matchedSet = new Map<string, PositionCandidate>();

  for (const rawTarget of targets) {
    if (!rawTarget || !rawTarget.trim()) continue;

    // Bersihkan nomor urut seperti "1. ", "2) ", dsb.
    const cleanRaw = rawTarget.replace(/^\s*(?:\d+[\.\)]|[-•*])\s*/, '').trim();

    // Pecah jika dalam satu string memuat koma atau titik koma (misal: "Sekjen, Dirjen Binapenta")
    const subTargets = cleanRaw
      .split(/[,;\n\r]+/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 3);

    for (const sub of subTargets) {
      const matchResult = matchSinglePosition(sub, candidates);
      if (matchResult) {
        const key = String(matchResult.candidate.id);
        if (!matchedSet.has(key)) {
          matchedSet.set(key, matchResult.candidate);
          console.log(
            `[DispositionMatcher] Jabatan "${sub}" cocok dengan ID: ${key} ("${matchResult.candidate.name}") [Skor: ${matchResult.score.toFixed(2)}]`
          );
        }
      } else {
        console.log(`[DispositionMatcher] Tidak ditemukan jabatan cocok untuk: "${sub}"`);
      }
    }
  }

  return Array.from(matchedSet.values());
}

/**
 * Sinonim untuk instruksi / arahan pimpinan
 */
const ACTION_SYNONYMS: Record<string, string[]> = {
  agendakan: ['agendakan', 'acara', 'acarakan', 'jadwalkan', 'masukkan agenda', 'agenda', 'hadirkan', 'atur jadwal'],
  acarakan: ['acarakan', 'agendakan', 'jadwalkan', 'agenda'],
  hadiri: ['hadiri', 'menghadiri', 'hadir', 'kehadiran'],
  wakili: ['wakili', 'mewakili', 'perwakilan', 'disposisi perwakilan'],
  tindaklanjuti: ['tindaklanjuti', 'tindak lanjuti', 'tindak lanjut', 'proses', 'selesaikan', 'lanjuti'],
  koordinasikan: ['koordinasikan', 'koordinasi', 'komunikasikan', 'hubungi'],
  siapkan: ['siapkan bahan', 'siapkan sambutan', 'siapkan materi', 'siapkan paparan', 'siapkan tanggapan', 'siapkan'],
  pelajari: ['pelajari', 'telaah', 'kaji', 'analisis', 'pelajari / telaah', 'pelajari telaah'],
  arsipkan: ['arsipkan', 'arsip', 'simpan', 'untuk diketahui', 'diketahui', 'file'],
};

/**
 * Mencocokkan daftar instruksi arahan pimpinan (arahanDisposisi)
 * Mendukung pemisahan garis miring (misal: "Agendakan / Acarakan")
 */
export function matchActionsList(
  targets: string[],
  candidates: ActionCandidate[]
): ActionCandidate[] {
  if (!targets || targets.length === 0 || candidates.length === 0) return [];

  const matchedSet = new Map<string, ActionCandidate>();

  for (const raw of targets) {
    if (!raw || !raw.trim()) continue;

    // Pecah berdasarkan garis miring (/), koma (,), titik koma (;), atau 'dan'/'atau'
    const parts = raw
      .split(/[\/,\n;&]+|\b(?:dan|atau)\b/i)
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length >= 3);

    for (const part of parts) {
      const cleanPart = part.replace(/[^a-z0-9]/g, '');

      // 1. Cek direct match atau substring match
      const directMatch = candidates.find((cand) => {
        const cName = cand.name.toLowerCase().replace(/[^a-z0-9]/g, '');
        return cName === cleanPart || cName.includes(cleanPart) || cleanPart.includes(cName);
      });

      if (directMatch) {
        matchedSet.set(String(directMatch.id), directMatch);
        console.log(`[DispositionMatcher] Arahan "${part}" cocok langsung dengan ID: ${directMatch.id} ("${directMatch.name}")`);
        continue;
      }

      // 2. Cek kamus sinonim tindakan
      let synonymMatch: ActionCandidate | undefined;
      for (const [keyRoot, synList] of Object.entries(ACTION_SYNONYMS)) {
        if (synList.some((syn) => cleanPart.includes(syn.replace(/[^a-z0-9]/g, '')))) {
          synonymMatch = candidates.find((cand) => {
            const cName = cand.name.toLowerCase().replace(/[^a-z0-9]/g, '');
            return synList.some((syn) => cName.includes(syn.replace(/[^a-z0-9]/g, '')));
          });
          if (synonymMatch) break;
        }
      }

      if (synonymMatch) {
        matchedSet.set(String(synonymMatch.id), synonymMatch);
        console.log(`[DispositionMatcher] Arahan "${part}" cocok via sinonim dengan ID: ${synonymMatch.id} ("${synonymMatch.name}")`);
      }
    }
  }

  return Array.from(matchedSet.values());
}
