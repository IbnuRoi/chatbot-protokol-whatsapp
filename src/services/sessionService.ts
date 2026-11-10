import { ProtocolScope } from '../database/dbManager';

export { ProtocolScope };

export enum BotState {
  IDLE = 'IDLE',
  MAIN_MENU = 'MAIN_MENU',

  // Alur Surat Masuk
  SURAT_MASUK_PILIH_JENIS = 'SURAT_MASUK_PILIH_JENIS',
  SURAT_MASUK_KONFIRMASI_AGENDA = 'SURAT_MASUK_KONFIRMASI_AGENDA',
  SURAT_MASUK_INPUT_AGENDA_MANUAL = 'SURAT_MASUK_INPUT_AGENDA_MANUAL',
  SURAT_MASUK_PILIH_TIPE = 'SURAT_MASUK_PILIH_TIPE',
  SURAT_MASUK_UPLOAD_PDF = 'SURAT_MASUK_UPLOAD_PDF',
  SURAT_MASUK_REVIEW_DATA = 'SURAT_MASUK_REVIEW_DATA',
  SURAT_MASUK_EDIT_TEMPLATE = 'SURAT_MASUK_EDIT_TEMPLATE',
  SURAT_MASUK_PILIH_FIELD_KOREKSI = 'SURAT_MASUK_PILIH_FIELD_KOREKSI',
  SURAT_MASUK_INPUT_NILAI_KOREKSI = 'SURAT_MASUK_INPUT_NILAI_KOREKSI',
  SURAT_MASUK_PILIH_ASAL_INSTANSI = 'SURAT_MASUK_PILIH_ASAL_INSTANSI',
  SURAT_MASUK_REVIEW_PERIHAL_AI = 'SURAT_MASUK_REVIEW_PERIHAL_AI',
  SURAT_MASUK_INPUT_PERIHAL_MANUAL = 'SURAT_MASUK_INPUT_PERIHAL_MANUAL',
  SURAT_MASUK_FINAL_CONFIRM = 'SURAT_MASUK_FINAL_CONFIRM',

  // Alur Jadwal
  JADWAL_MENU = 'JADWAL_MENU',
  JADWAL_CARI_INPUT = 'JADWAL_CARI_INPUT',
  JADWAL_CARI_HASIL = 'JADWAL_CARI_HASIL',
  JADWAL_ARAHAN_INPUT_TEMPLATE = 'JADWAL_ARAHAN_INPUT_TEMPLATE',
  JADWAL_ARAHAN_REVIEW = 'JADWAL_ARAHAN_REVIEW',

  // Alur Disposisi
  DISPOSISI_INPUT_NOMOR = 'DISPOSISI_INPUT_NOMOR',
  DISPOSISI_UPLOAD_BERKAS = 'DISPOSISI_UPLOAD_BERKAS',
  DISPOSISI_REVIEW_DATA = 'DISPOSISI_REVIEW_DATA',
  DISPOSISI_EDIT_TEMPLATE = 'DISPOSISI_EDIT_TEMPLATE',
  DISPOSISI_EDIT_FIELD = 'DISPOSISI_EDIT_FIELD',
  DISPOSISI_INPUT_NILAI_KOREKSI = 'DISPOSISI_INPUT_NILAI_KOREKSI',
  DISPOSISI_INPUT_AGENDA_MANUAL = 'DISPOSISI_INPUT_AGENDA_MANUAL',
  DISPOSISI_SELESAI = 'DISPOSISI_SELESAI',

  // Alur Riwayat
  RIWAYAT_LIST = 'RIWAYAT_LIST',
  RIWAYAT_DETAIL = 'RIWAYAT_DETAIL',

  // Alur Pencarian Surat Berdasarkan Perihal
  CARI_SURAT_INPUT_KEYWORD = 'CARI_SURAT_INPUT_KEYWORD',
  CARI_SURAT_HASIL_LIST = 'CARI_SURAT_HASIL_LIST',
  CARI_SURAT_DETAIL = 'CARI_SURAT_DETAIL',

  // Alur Pencarian Terpadu (Hybrid Search Surat & Jadwal)
  SEARCH_HYBRID_HASIL = 'SEARCH_HYBRID_HASIL',

  // Alur Bantuan
  BANTUAN_MENU = 'BANTUAN_MENU',
}

export interface ExtractedSuratData {
  tanggalSurat: string;
  nomorSurat: string;
  subject: string;
  asalSurat: string;
  event: string;
  picPengirim: string;
  perihal: string;
  // Entitas klasifikasi kategori & perihal template
  kategoriSurat?: 'UND' | 'PH' | 'UNR' | 'WR' | 'AU' | 'TAP' | 'LP';
  alasanKategori?: string;
  namaAcara?: string;
  temaAcara?: string;
  penyelenggara?: string;
  sesiAcara?: string; // misal: "Sambutan", "Keynote Speech", "Arahan", "Narasumber"
  mempelai1?: string; // misal: "Anisa Rahmawati, S.E. (Putri Bapak H. Ahmad dan Ibu Hj. Siti)"
  mempelai2?: string; // misal: "Dimas Pratama, S.T. (Putra Bapak Ir. Bambang dan Ibu Sri)"
  pokokBahasan?: string; // untuk WR / AU
  rangkaUcapan?: string; // untuk TAP (misal: "Hari Ulang Tahun ke-75 PT Aneka Tambang Tbk")
  picName?: string;
  picPhoneNumber?: string;
  dateEvent?: string;
  timeEvent?: string;
  placeEvent?: string;
}

export interface SuratDraftData {
  jenisSurat?: string;
  nomorAgenda?: string;
  tipeSurat?: string;
  tempPdfPath?: string;
  tempPdfName?: string;
  finalFileName?: string;
  finalFileUrl?: string;
  fileSize?: number;
  extractedData?: ExtractedSuratData;
  fieldBeingEdited?: string;
  asalInstansi?: string;
  aiRecommendedPerihal?: string;
  finalPerihal?: string;
  finalSubject?: string;
}

export interface ExtractedDisposisiData {
  nomorAgenda: string;
  nomorSurat?: string;
  tanggalSurat?: string;
  sifat?: string;
  asalSurat?: string;
  perihal?: string;
  tanggalAcara?: string;
  waktuAcara?: string;
  tempatAcara?: string;
  tanggalDisposisi?: string;
  pemberiDisposisi?: string;
  namaPemberiDisposisi?: string;
  diteruskanKepada?: string[];
  arahanDisposisi?: string[];
  catatan?: string;
}

export interface DisposisiDraftData {
  tempFilePath?: string;
  tempFileName?: string;
  finalFileName?: string;
  finalFileUrl?: string;
  fileSize?: number;
  isImage?: boolean;
  extractedData?: ExtractedDisposisiData;
  matchedLetter?: {
    id: number;
    agendaNumber: string;
    from: string;
    subject: string;
    perihal: string;
    dateLetter?: string;
    file?: string;
  };
  fieldBeingEdited?: string;
  existingDispositionId?: number;
}

export interface JadwalArahanDraftData {
  namaKegiatan: string;
  tanggalKegiatan: string; // Tampilan atau string input
  tanggalIso?: string; // YYYY-MM-DD
  waktuMulai: string; // HH:mm
  waktuSelesai?: string | null; // HH:mm
  sampaiSelesai?: boolean;
  lokasi: string;
  pejabatHadir?: string;
  pic?: string;
  catatan?: string;
}

export interface UserSession {
  whatsappNumber: string;
  userId: number;
  userName: string;
  userRole: string;
  state: BotState;
  scope: ProtocolScope;
  allowedScopes?: ProtocolScope[];
  lastActive: Date;
  draftSurat?: SuratDraftData;
  draftDisposisi?: DisposisiDraftData;
  draftJadwalArahan?: JadwalArahanDraftData;
  riwayatPage?: number;
  selectedSuratId?: number;
  searchKeyword?: string;
  searchResults?: any[];
  jadwalSearchKeyword?: string;
  jadwalSearchResults?: any[];
}

class SessionService {
  private sessions: Map<string, UserSession> = new Map();
  private readonly TIMEOUT_MS = 30 * 60 * 1000; // 30 menit

  public getSession(whatsappNumber: string): UserSession | undefined {
    const session = this.sessions.get(whatsappNumber);
    if (!session) return undefined;

    // Cek expiry timeout
    const now = new Date();
    if (now.getTime() - session.lastActive.getTime() > this.TIMEOUT_MS) {
      this.resetSession(whatsappNumber);
      return undefined;
    }

    session.lastActive = now;
    return session;
  }

  public createSession(
    whatsappNumber: string,
    userId: number,
    userName: string,
    userRole: string,
    initialState: BotState = BotState.MAIN_MENU,
    scope: ProtocolScope = 'MENAKER',
    allowedScopes?: ProtocolScope[]
  ): UserSession {
    const session: UserSession = {
      whatsappNumber,
      userId,
      userName,
      userRole,
      state: initialState,
      scope: scope || 'MENAKER',
      allowedScopes: allowedScopes || [scope || 'MENAKER'],
      lastActive: new Date(),
    };
    this.sessions.set(whatsappNumber, session);
    return session;
  }

  public setScope(whatsappNumber: string, scope: ProtocolScope): void {
    const session = this.getSession(whatsappNumber);
    if (session) {
      if (!session.allowedScopes || session.allowedScopes.includes(scope)) {
        session.scope = scope;
        session.lastActive = new Date();
      } else {
        console.warn(`[Session] Penolakan pengalihan scope [${scope}] untuk nomor ${whatsappNumber} (Otorisasi: ${session.allowedScopes?.join(',')})`);
      }
    }
  }

  public setState(whatsappNumber: string, state: BotState): void {
    const session = this.getSession(whatsappNumber);
    if (session) {
      session.state = state;
      session.lastActive = new Date();
    }
  }

  public updateDraft(whatsappNumber: string, partialDraft: Partial<SuratDraftData>): void {
    const session = this.getSession(whatsappNumber);
    if (session) {
      session.draftSurat = {
        ...(session.draftSurat || {}),
        ...partialDraft,
      };
      session.lastActive = new Date();
    }
  }

  public clearDraft(whatsappNumber: string): void {
    const session = this.getSession(whatsappNumber);
    if (session) {
      session.draftSurat = undefined;
    }
  }

  public updateDisposisiDraft(whatsappNumber: string, partialDraft: Partial<DisposisiDraftData>): void {
    const session = this.getSession(whatsappNumber);
    if (session) {
      session.draftDisposisi = {
        ...(session.draftDisposisi || {}),
        ...partialDraft,
      };
      session.lastActive = new Date();
    }
  }

  public clearDisposisiDraft(whatsappNumber: string): void {
    const session = this.getSession(whatsappNumber);
    if (session) {
      session.draftDisposisi = undefined;
      session.selectedSuratId = undefined;
    }
  }

  public updateJadwalArahanDraft(whatsappNumber: string, partialDraft: Partial<JadwalArahanDraftData>): void {
    const session = this.getSession(whatsappNumber);
    if (session) {
      session.draftJadwalArahan = {
        ...(session.draftJadwalArahan || ({} as JadwalArahanDraftData)),
        ...partialDraft,
      };
      session.lastActive = new Date();
    }
  }

  public clearJadwalArahanDraft(whatsappNumber: string): void {
    const session = this.getSession(whatsappNumber);
    if (session) {
      session.draftJadwalArahan = undefined;
    }
  }

  public resetSession(whatsappNumber: string): void {
    const session = this.sessions.get(whatsappNumber);
    if (session) {
      session.state = BotState.MAIN_MENU;
      session.draftSurat = undefined;
      session.draftDisposisi = undefined;
      session.draftJadwalArahan = undefined;
      session.riwayatPage = 0;
      session.selectedSuratId = undefined;
      session.searchKeyword = undefined;
      session.searchResults = undefined;
      session.jadwalSearchKeyword = undefined;
      session.jadwalSearchResults = undefined;
      session.lastActive = new Date();
    }
  }

  public deleteSession(whatsappNumber: string): void {
    this.sessions.delete(whatsappNumber);
  }
}

export const sessionService = new SessionService();

/**
 * Memeriksa apakah sesi atau nomor WhatsApp pengguna memiliki otorisasi Akses Ganda (Menteri & Wamen)
 * Mencakup user Gufronation (082299294269), Ibnu (082124985997), atau user dengan allowedScopes > 1
 */
export function isDualScopeUser(sessionOrPhone?: UserSession | string | null): boolean {
  if (!sessionOrPhone) return false;
  if (typeof sessionOrPhone !== 'string' && sessionOrPhone.allowedScopes && sessionOrPhone.allowedScopes.length > 1) {
    return true;
  }
  const phone = typeof sessionOrPhone === 'string' ? sessionOrPhone : sessionOrPhone.whatsappNumber;
  const clean = (phone || '').replace(/\D/g, '');
  return clean.endsWith('82299294269') || clean.endsWith('82124985997');
}

// Alias kompatibilitas untuk kemudahan integrasi
export const isGufronation = isDualScopeUser;
