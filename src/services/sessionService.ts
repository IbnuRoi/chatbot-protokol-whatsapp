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

  // Alur Disposisi
  DISPOSISI_INPUT_NOMOR = 'DISPOSISI_INPUT_NOMOR',

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
}

export interface UserSession {
  whatsappNumber: string;
  userId: number;
  userName: string;
  userRole: string;
  state: BotState;
  lastActive: Date;
  draftSurat?: SuratDraftData;
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
    initialState: BotState = BotState.MAIN_MENU
  ): UserSession {
    const session: UserSession = {
      whatsappNumber,
      userId,
      userName,
      userRole,
      state: initialState,
      lastActive: new Date(),
    };
    this.sessions.set(whatsappNumber, session);
    return session;
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

  public resetSession(whatsappNumber: string): void {
    const session = this.sessions.get(whatsappNumber);
    if (session) {
      session.state = BotState.MAIN_MENU;
      session.draftSurat = undefined;
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
