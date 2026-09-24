/**
 * Utilitas untuk penanganan akronim, singkatan, dan spesifisitas pencarian
 * untuk Surat Masuk dan Agenda Kegiatan Protokol Kemnaker RI.
 */

// Stop words bahasa Indonesia yang tidak bernilai spesifik dalam pencarian
export const INDONESIAN_STOP_WORDS = new Set<string>([
  'yang', 'di', 'ke', 'dari', 'dan', 'atau', 'ini', 'itu', 'pada', 'untuk',
  'dengan', 'tentang', 'mengenai', 'terkait', 'soal', 'hal', 'perihal',
  'adalah', 'yaitu', 'yakni', 'sebagai', 'oleh', 'atas', 'dalam', 'secara',
  'ada', 'apakah', 'bisa', 'tolong', 'mohon', 'coba', 'min', 'dong', 'deh',
  'surat', 'dokumen', 'berkas', 'arsip', 'data', 'cari', 'carikan', 'cek',
  'lacak', 'lihat', 'temukan', 'masuk', 'keluar', 'dinas', 'resmi', 'kami',
  'kita', 'saya', 'anda', 'bapak', 'ibu', 'acara', 'kegiatan', 'agenda',
  'jadwal', 'jadwalnya', 'tentang', 'terkait'
]);

// Kata-kata umum/kategori yang sering muncul bersamaan dengan entitas khusus
export const GENERIC_CATEGORY_WORDS = new Set<string>([
  'kongres', 'rapat', 'rakor', 'kegiatan', 'acara', 'agenda', 'audiensi',
  'permohonan', 'seminar', 'laporan', 'webinar', 'sosialisasi', 'workshop',
  'bimbingan', 'pelatihan', 'konferensi', 'pembukaan', 'penutupan', 'sambutan',
  'narasumber', 'speaker', 'keynote', 'tahunan', 'nasional', 'internasional',
  'tahun', 'tema', 'hari', 'bulan', 'jadwal', 'waktu', 'tempat', 'lokasi'
]);

// Kamus akronim/singkatan protokol & ketenagakerjaan Kemnaker RI
export const ACRONYM_DICTIONARY: Record<string, string[]> = {
  'k3': ['keselamatan dan kesehatan kerja', 'keselamatan kerja', 'kecelakaan kerja', 'binwasnaker'],
  'rakor': ['rapat koordinasi', 'koordinasi'],
  'rapim': ['rapat pimpinan'],
  'rakernas': ['rapat kerja nasional'],
  'klb': ['kongres luar biasa'],
  'bksti': ['badan kerjasama penyelenggara pendidikan tinggi teknik industri', 'teknik industri'],
  'sbni': ['serikat buruh nasionalis indonesia'],
  'amli': ['asosiasi mipa lptk indonesia'],
  'isf': ['indonesia sustainability forum', 'indonesia sustainability 360 forum'],
  'apff': ['asia pacific family forum'],
  'pqm': ['continuous improvement convention', 'continuous improvement', 'pqm consultant'],
  'bp2m': ['blok pelajar politik merdeka'],
  'sbsi': ['serikat buruh sejahtera independen'],
  'ksbsi': ['konfederasi serikat buruh sejahtera indonesia'],
  'fspmi': ['federasi serikat pekerja metal indonesia'],
  'kspsi': ['konfederasi serikat pekerja seluruh indonesia', 'serikat pekerja'],
  'kspn': ['konfederasi serikat pekerja nasional'],
  'spn': ['serikat pekerja nasional'],
  'apindo': ['asosiasi pengusaha indonesia', 'asosiasi pengusaha'],
  'bpjs': ['badan penyelenggara jaminan sosial', 'bpjs ketenagakerjaan'],
  'bp2mi': ['badan pelindungan pekerja migran indonesia', 'pekerja migran'],
  'pmi': ['pekerja migran indonesia', 'tenaga kerja indonesia', 'tki'],
  'bumn': ['badan usaha milik negara'],
  'ihcbs': ['indonesia human capital & beyond summit', 'human capital'],
  'gnik': ['gerakan nasional indonesia kompeten'],
  'icoie': ['international conference on industrial engineering'],
  'phk': ['pemutusan hubungan kerja'],
  'blkk': ['balai latihan kerja komunitas', 'blk komunitas'],
  'blk': ['balai latihan kerja', 'balai pelatihan vokasi', 'bpvp'],
  'bpvp': ['balai pelatihan vokasi dan produktivitas'],
  'bbpvp': ['balai besar pelatihan vokasi dan produktivitas'],
  'vokasi': ['pelatihan vokasi', 'pelatihan kerja', 'binalavotas'],
  'binalavotas': ['pembinaan pelatihan vokasi dan produktivitas', 'ditjen binalavotas'],
  'binwasnaker': ['pembinaan pengawasan ketenagakerjaan', 'ditjen binwasnaker'],
  'phi': ['hubungan industrial', 'pembinaan hubungan industrial', 'ditjen phi'],
  'phijstk': ['pembinaan hubungan industrial dan jaminan sosial tenaga kerja', 'phi dan jamsos'],
  'jamsos': ['jaminan sosial', 'jaminan sosial tenaga kerja', 'jamsostek'],
  'lks': ['lembaga kerja sama', 'lks tripartit', 'tripartit'],
  'thr': ['tunjangan hari raya'],
  'ump': ['upah minimum provinsi', 'upah minimum', 'pengupahan'],
  'umk': ['upah minimum kabupaten', 'upah minimum kota', 'upah minimum'],
  'kemnaker': ['kementerian ketenagakerjaan', 'kemenaker'],
  'menaker': ['menteri ketenagakerjaan'],
  'wamenaker': ['wakil menteri ketenagakerjaan'],
  'setneg': ['sekretariat negara', 'kemensetneg'],
  'marves': ['kemaritiman dan investasi', 'kemenko marves'],
  'pmk': ['pembangunan manusia dan kebudayaan', 'kemenko pmk'],
  'dpr': ['dewan perwakilan rakyat', 'komisi ix', 'parlemen'],
  'dpd': ['dewan perwakilan daerah'],
  'mou': ['memorandum of understanding', 'nota kesepahaman'],
  'pks': ['perjanjian kerja sama', 'partai keadilan sejahtera'],
  'skkni': ['standar kompetensi kerja nasional indonesia'],
  'bnsp': ['badan nasional sertifikasi profesi', 'sertifikasi profesi'],
  'ilo': ['international labour organization', 'organisasi perburuhan internasional'],
  'apjati': ['asosiasi perusahaan jasa tenaga kerja indonesia'],
  'aprindo': ['asosiasi pengusaha ritel indonesia'],
  'umkm': ['usaha mikro kecil dan menengah'],
  'tup': ['tata usaha pimpinan', 'bag tup'],
  'setjen': ['sekretariat jenderal', 'sekjen'],
  'itjen': ['inspektorat jenderal', 'irjen'],
  'ditjen': ['direktorat jenderal', 'dirjen'],
  'fgd': ['focus group discussion'],
  'unj': ['universitas negeri jakarta'],
  'ui': ['universitas indonesia'],
  'itb': ['institut teknologi bandung'],
  'ugm': ['universitas gadjah mada'],
  'kikes': ['kongres kikes'],
  'fpe': ['federasi pertambangan dan energi'],
  'fhukatan': ['federasi kehutanan'],
  'gaspermindo': ['gabungan serikat pekerja merdeka indonesia'],
  'iterati': ['ikatan teknisi dan teknolog rekayasa indonesia'],
  'iai': ['ikatan akuntan indonesia'],

  // Kementerian, Lembaga & Mitra Strategis
  'kemenkeu': ['kementerian keuangan', 'kemenkeu ri', 'menkeu'],
  'kemendagri': ['kementerian dalam negeri', 'mendagri'],
  'kemenperin': ['kementerian perindustrian', 'menperin'],
  'kemendag': ['kementerian perdagangan', 'mendag'],
  'kemenkes': ['kementerian kesehatan', 'menkes'],
  'kemendikbud': ['kementerian pendidikan', 'kemendikbudristek', 'pendidikan dan kebudayaan', 'mendikbud'],
  'kemenkumham': ['kementerian hukum dan ham', 'kemenkum', 'menkumham'],
  'kemenpanrb': ['kementerian pendayagunaan aparatur negara', 'kemenpan', 'panrb'],
  'kominfo': ['kementerian komunikasi dan informatika', 'komdigi', 'komunikasi dan digital', 'menkominfo'],
  'bappenas': ['badan perencanaan pembangunan nasional', 'kementerian ppn'],
  'bpk': ['badan pemeriksa keuangan'],
  'bpkp': ['badan pengawasan keuangan dan pembangunan'],
  'bkn': ['badan kepegawaian negara'],
  'lan': ['lembaga administrasi negara'],
  'bnn': ['badan narkotika nasional'],
  'paspampres': ['pasukan pengamanan presiden'],

  // Isu Protokol, Agenda & Ketenagakerjaan
  'kunker': ['kunjungan kerja', 'kunjungan lapangan', 'tinjau lapangan'],
  'audiensi': ['permohonan audiensi', 'menerima audiensi', 'silaturahmi'],
  'magang': ['pemagangan', 'maganghub', 'program magang', 'peserta magang'],
  'tka': ['tenaga kerja asing', 'penggunaan tenaga kerja asing', 'izin tka'],
  'umr': ['upah minimum regional', 'upah minimum', 'ump', 'umk', 'dewan pengupahan'],
  'sertijab': ['serah terima jabatan'],
  'pelantikan': ['pengambilan sumpah jabatan', 'pelantikan pejabat', 'pengukuhan'],
  'gladi': ['gladi resik', 'gladi bersih', 'gladi kotor', 'persiapan acara'],
  'bimtek': ['bimbingan teknis'],
  'tot': ['training of trainer', 'pelatihan pelatih'],
  'sosialisasi': ['penyuluhan', 'sosialisasi kebijakan'],
  'harlah': ['hari lahir', 'ulang tahun', 'milad', 'peringatan hari'],
  'milad': ['ulang tahun', 'hari jadi', 'harlah', 'anniversary'],
  'apel': ['apel pagi', 'apel kerja', 'upacara bendera'],
  'dpr-ri': ['dewan perwakilan rakyat', 'komisi ix', 'parlemen'],
  'komisi ix': ['komisi 9', 'komisi ix dpr ri', 'dpr ri'],
};

// Peta kebalikan (frasa kepanjangan -> singkatan)
const REVERSE_ACRONYM_MAP: Map<string, string[]> = new Map();
for (const [acronym, phrases] of Object.entries(ACRONYM_DICTIONARY)) {
  for (const phrase of phrases) {
    const key = phrase.toLowerCase().trim();
    const existing = REVERSE_ACRONYM_MAP.get(key) || [];
    existing.push(acronym);
    REVERSE_ACRONYM_MAP.set(key, existing);
  }
}

export interface SearchExpansionResult {
  rawQuery: string;
  cleanQuery: string;
  meaningfulTokens: string[];
  specificTokens: string[];
  expandedTerms: string[];
  hasSpecificAcronym: boolean;
}

/**
 * Mengekspansi kata kunci pencarian dengan singkatan dan kepanjangannya secara dua arah
 */
export function expandSearchTermsWithAcronyms(query: string): SearchExpansionResult {
  const cleanQuery = query.toLowerCase().trim();
  if (!cleanQuery) {
    return {
      rawQuery: query,
      cleanQuery: '',
      meaningfulTokens: [],
      specificTokens: [],
      expandedTerms: [],
      hasSpecificAcronym: false,
    };
  }

  // 1. Ekstraksi token kata kunci
  const rawTokens = cleanQuery
    .split(/[\s,./\\-]+/)
    .map((t) => t.replace(/[^\w]/g, ''))
    .filter((t) => t.length >= 2);

  let meaningfulTokens = rawTokens.filter((t) => !INDONESIAN_STOP_WORDS.has(t));
  if (meaningfulTokens.length === 0) {
    meaningfulTokens = rawTokens;
  }

  const expandedTerms = new Set<string>();
  expandedTerms.add(cleanQuery);

  const specificTokens: string[] = [];
  let hasSpecificAcronym = false;

  // 2. Analisis setiap token untuk ekspansi singkatan
  for (const token of meaningfulTokens) {
    expandedTerms.add(token);

    // Cek apakah token ada di kamus akronim langsung
    const syns = ACRONYM_DICTIONARY[token];
    if (syns) {
      syns.forEach((s) => {
        expandedTerms.add(s);
      });
      specificTokens.push(token);
      hasSpecificAcronym = true;
    } else {
      // Jika token bukan kata generik (seperti 'kongres', 'rapat'), tandai sebagai specificToken
      if (!GENERIC_CATEGORY_WORDS.has(token) && token.length >= 2) {
        specificTokens.push(token);
        // Token berupa singkatan huruf/angka (2-6 karakter seperti BKSTI, SBNI, AMLI)
        if (token.length <= 6 && !INDONESIAN_STOP_WORDS.has(token)) {
          hasSpecificAcronym = true;
        }
      }
    }
  }

  // 3. Cek apakah query kalimat penuh cocok dengan frasa kepanjangan (Reverse Lookup)
  for (const [phrase, acronyms] of REVERSE_ACRONYM_MAP.entries()) {
    if (cleanQuery.includes(phrase)) {
      acronyms.forEach((acr) => {
        expandedTerms.add(acr);
        specificTokens.push(acr);
        hasSpecificAcronym = true;
      });
    }
  }

  const termsArray = Array.from(expandedTerms).filter((t) => t.length >= 2);

  return {
    rawQuery: query,
    cleanQuery,
    meaningfulTokens,
    specificTokens,
    expandedTerms: termsArray,
    hasSpecificAcronym,
  };
}

/**
 * Menghitung skor relevansi presisi tinggi untuk teks target (perihal surat / nama kegiatan)
 * dengan prioritas khusus untuk kecocokan kata berdiri sendiri (word-boundary) pada singkatan/akronim.
 */
export function calculateRelevanceScore(
  expansion: SearchExpansionResult,
  targetText: string | null | undefined,
  metadataTexts: (string | null | undefined)[] = []
): { score: number; matchedAllSpecific: boolean; specificMatchesCount: number } {
  if (!targetText) {
    return { score: 0, matchedAllSpecific: false, specificMatchesCount: 0 };
  }

  const targetLower = targetText.toLowerCase();
  const allTexts = [targetLower, ...metadataTexts.map((m) => (m || '').toLowerCase())];
  const combinedText = allTexts.join(' ');

  let score = 0;
  const { cleanQuery, meaningfulTokens, specificTokens } = expansion;

  // 1. KECOCOKAN FRASA KALIMAT UTUH
  if (cleanQuery.length >= 3) {
    if (targetLower.includes(cleanQuery)) {
      score += 120;
    } else if (combinedText.includes(cleanQuery)) {
      score += 70;
    }
  }

  // 2. KECOCOKAN WORD-BOUNDARY UNTUK SETIAP TOKEN
  let matchedMeaningfulCount = 0;
  let specificMatchesCount = 0;

  for (const token of meaningfulTokens) {
    let tokenMatched = false;
    const isSpecific = specificTokens.includes(token);

    // Gunakan regex boundary \btoken\b untuk mencocokkan singkatan persis
    const boundaryRegex = new RegExp(`\\b${escapeRegExp(token)}\\b`, 'i');
    const isExactWordMatch = boundaryRegex.test(targetText);

    if (isExactWordMatch) {
      // Bonus besar jika cocok persis sebagai kata/singkatan mandiri (bukan cuma substring di tengah kata)
      score += isSpecific ? 90 : 40;
      tokenMatched = true;
    } else if (targetLower.includes(token)) {
      // Kecocokan substring standar
      score += isSpecific ? 50 : 25;
      tokenMatched = true;
    } else if (combinedText.includes(token)) {
      score += isSpecific ? 30 : 15;
      tokenMatched = true;
    }

    // Periksa juga sinonim/kepanjangan dari token jika ada
    if (!tokenMatched) {
      const syns = ACRONYM_DICTIONARY[token] || [];
      for (const syn of syns) {
        if (targetLower.includes(syn)) {
          score += 60;
          tokenMatched = true;
          break;
        } else if (combinedText.includes(syn)) {
          score += 35;
          tokenMatched = true;
          break;
        }
      }
    }

    if (tokenMatched) {
      matchedMeaningfulCount++;
      if (isSpecific) {
        specificMatchesCount++;
      }
    }
  }

  // 3. BONUS RASIO KELENGKAPAN CAKUPAN TOKEN (TOKEN COVERAGE)
  if (meaningfulTokens.length > 0) {
    const coverage = matchedMeaningfulCount / meaningfulTokens.length;
    if (coverage === 1.0) {
      score += 60; // Semua token pengguna cocok
    } else if (coverage >= 0.66) {
      score += 35;
    } else if (coverage >= 0.5) {
      score += 15;
    }
  }

  // 4. VERIFIKASI APAKAH SEMUA TOKEN SPESIFIK COCOK
  const matchedAllSpecific = specificTokens.length === 0 || specificMatchesCount >= specificTokens.length;

  return {
    score,
    matchedAllSpecific,
    specificMatchesCount,
  };
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
