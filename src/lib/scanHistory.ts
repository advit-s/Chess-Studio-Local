import { canonicalizeImageOrder, type ScanOrientation } from './scanOrientation';

export type StoredScanImage = Blob | string;
export type ScanScoreKind = 'model-score' | 'unavailable';

export interface ScanFenOptions {
  turn: 'w' | 'b';
  castling: string;
  enPassant: string;
  halfmove: number;
  fullmove: number;
}

export interface ScannedPosition {
  version: 3;
  id: string;
  date: string;
  fingerprint: string;
  originalImage?: StoredScanImage;
  croppedImage?: StoredScanImage;
  recognizedGrid: string[];
  correctedGrid: string[];
  imageOrientation: ScanOrientation;
  viewOrientation: ScanOrientation;
  fenOptions: ScanFenOptions;
  detectedFen: string;
  correctedFen: string;
  modelScores: Array<number | null>;
  scoreMargins: Array<number | null>;
  scoreKind: ScanScoreKind;
  model?: { name: string; revision: string };
  correctionHistory?: string[][];
  notes: string;
}

export interface ScanStorageResult {
  success: boolean;
  error?: 'duplicate' | 'quota' | 'unavailable' | 'unknown';
  message?: string;
}

const DB_NAME = 'chess-studio-ocr-db';
const DB_VERSION = 3;
const STORE_NAME = 'scan-history';
const FINGERPRINT_INDEX = 'by-fingerprint';
const PIECES = new Set(['empty', 'wk', 'wq', 'wr', 'wb', 'wn', 'wp', 'bk', 'bq', 'br', 'bb', 'bn', 'bp']);

function safeImage(value: unknown): StoredScanImage | undefined {
  if (typeof Blob !== 'undefined' && value instanceof Blob && value.type.startsWith('image/')) return value;
  if (typeof value === 'string' && value.startsWith('data:image/')) return value;
  return undefined;
}

function validGrid(value: unknown): value is string[] {
  return Array.isArray(value) && value.length === 64 && value.every((piece) => typeof piece === 'string' && PIECES.has(piece));
}

function gridFromFen(fen: string): string[] {
  const rows = String(fen || '').trim().split(/\s+/)[0]?.split('/') ?? [];
  if (rows.length !== 8) return Array(64).fill('empty');
  const canonical: string[] = [];
  const pieceMap: Record<string, string> = {
    K: 'wk', Q: 'wq', R: 'wr', B: 'wb', N: 'wn', P: 'wp',
    k: 'bk', q: 'bq', r: 'br', b: 'bb', n: 'bn', p: 'bp',
  };
  for (const row of rows) {
    for (const character of row) {
      if (/^[1-8]$/.test(character)) canonical.push(...Array(Number(character)).fill('empty'));
      else if (pieceMap[character]) canonical.push(pieceMap[character]);
      else return Array(64).fill('empty');
    }
  }
  if (canonical.length !== 64) return Array(64).fill('empty');
  return canonical;
}

function fenOptions(fen: string): ScanFenOptions {
  const parts = String(fen || '').trim().split(/\s+/);
  return {
    turn: parts[1] === 'b' ? 'b' : 'w',
    castling: /^(-|K?Q?k?q?)$/.test(parts[2] || '') && parts[2] ? parts[2] : '-',
    enPassant: /^(-|[a-h][36])$/.test(parts[3] || '') ? parts[3] : '-',
    halfmove: Number.isInteger(Number(parts[4])) && Number(parts[4]) >= 0 ? Number(parts[4]) : 0,
    fullmove: Number.isInteger(Number(parts[5])) && Number(parts[5]) >= 1 ? Number(parts[5]) : 1,
  };
}

function scoreArray(value: unknown): Array<number | null> {
  if (!Array.isArray(value) || value.length !== 64) return Array(64).fill(null);
  return value.map((score) => typeof score === 'number' && Number.isFinite(score) && score >= 0 && score <= 1
    ? score
    : null);
}

function safeDate(value: unknown): string {
  if (typeof value === 'string' && Number.isFinite(Date.parse(value))) return new Date(value).toISOString();
  return new Date(0).toISOString();
}

export function migrateScanRecord(value: unknown): ScannedPosition {
  const input = value && typeof value === 'object' ? value as Record<string, any> : {};
  const legacyOrientation: ScanOrientation = input.orientation === 'black' ? 'black' : 'white';
  const imageOrientation: ScanOrientation = input.imageOrientation === 'black'
    ? 'black'
    : input.imageOrientation === 'white'
      ? 'white'
      : legacyOrientation;
  const viewOrientation: ScanOrientation = input.viewOrientation === 'black'
    ? 'black'
    : input.viewOrientation === 'white'
      ? 'white'
      : legacyOrientation;
  const legacyV2ImageOrder = input.version === 2 && legacyOrientation === 'black';
  const detectedFen = typeof input.detectedFen === 'string'
    ? input.detectedFen
    : '8/8/8/8/8/8/8/8 w - - 0 1';
  const correctedFen = typeof input.correctedFen === 'string' ? input.correctedFen : detectedFen;
  const recognizedGrid = validGrid(input.recognizedGrid)
    ? legacyV2ImageOrder
      ? canonicalizeImageOrder(input.recognizedGrid, 'black')
      : [...input.recognizedGrid]
    : gridFromFen(detectedFen);
  const correctedGrid = validGrid(input.correctedGrid)
    ? legacyV2ImageOrder
      ? canonicalizeImageOrder(input.correctedGrid, 'black')
      : [...input.correctedGrid]
    : gridFromFen(correctedFen);
  const storedScores = scoreArray(input.modelScores);
  const storedMargins = scoreArray(input.scoreMargins);
  const modelScores = legacyV2ImageOrder ? canonicalizeImageOrder(storedScores, 'black') : storedScores;
  const scoreMargins = legacyV2ImageOrder ? canonicalizeImageOrder(storedMargins, 'black') : storedMargins;
  const correctionHistory = Array.isArray(input.correctionHistory)
    ? input.correctionHistory.filter(validGrid).slice(-20).map((grid: string[]) => legacyV2ImageOrder
      ? canonicalizeImageOrder(grid, 'black')
      : [...grid])
    : undefined;

  return {
    version: 3,
    id: typeof input.id === 'string' && input.id ? input.id : `scan-${safeDate(input.date)}`,
    date: safeDate(input.date),
    fingerprint: typeof input.fingerprint === 'string' && input.fingerprint
      ? input.fingerprint
      : `legacy-${typeof input.id === 'string' ? input.id : safeDate(input.date)}`,
    originalImage: safeImage(input.originalImage),
    croppedImage: safeImage(input.croppedImage),
    recognizedGrid,
    correctedGrid,
    imageOrientation,
    viewOrientation,
    fenOptions: input.fenOptions && typeof input.fenOptions === 'object'
      ? {
          turn: input.fenOptions.turn === 'b' ? 'b' : 'w',
          castling: typeof input.fenOptions.castling === 'string' ? input.fenOptions.castling : '-',
          enPassant: typeof input.fenOptions.enPassant === 'string' ? input.fenOptions.enPassant : '-',
          halfmove: Number.isInteger(input.fenOptions.halfmove) && input.fenOptions.halfmove >= 0 ? input.fenOptions.halfmove : 0,
          fullmove: Number.isInteger(input.fenOptions.fullmove) && input.fenOptions.fullmove >= 1 ? input.fenOptions.fullmove : 1,
        }
      : fenOptions(correctedFen),
    detectedFen,
    correctedFen,
    modelScores,
    scoreMargins,
    scoreKind: input.scoreKind === 'model-score' && modelScores.some((score) => score !== null)
      ? 'model-score'
      : 'unavailable',
    model: input.model && typeof input.model.name === 'string' && typeof input.model.revision === 'string'
      ? { name: input.model.name, revision: input.model.revision }
      : undefined,
    correctionHistory,
    notes: typeof input.notes === 'string' ? input.notes.slice(0, 2_000) : '',
  };
}

export async function createScanFingerprint(
  croppedImage: Blob,
  correctedFen: string,
  orientation: ScanOrientation,
): Promise<string> {
  const imageBytes = new Uint8Array(await croppedImage.arrayBuffer());
  const metadata = new TextEncoder().encode(`\n${correctedFen.trim()}\n${orientation}`);
  const combined = new Uint8Array(imageBytes.length + metadata.length);
  combined.set(imageBytes);
  combined.set(metadata, imageBytes.length);
  const digest = await crypto.subtle.digest('SHA-256', combined);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function getDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is unavailable in this browser context.'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error || new Error('Could not open scan storage.'));
    request.onblocked = () => reject(new Error('Scan storage upgrade is blocked by another open tab.'));
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const db = request.result;
      const store = db.objectStoreNames.contains(STORE_NAME)
        ? request.transaction!.objectStore(STORE_NAME)
        : db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      if (!store.indexNames.contains(FINGERPRINT_INDEX)) {
        store.createIndex(FINGERPRINT_INDEX, 'fingerprint', { unique: false });
      }
    };
  });
}

function storageFailure(error: unknown): ScanStorageResult {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'QuotaExceededError') {
    return { success: false, error: 'quota', message: 'Browser storage quota was exceeded. Delete older scans or omit the original image.' };
  }
  if (/unavailable|blocked/i.test(error instanceof Error ? error.message : String(error))) {
    return { success: false, error: 'unavailable', message: error instanceof Error ? error.message : String(error) };
  }
  return { success: false, error: 'unknown', message: error instanceof Error ? error.message : 'Scan storage failed.' };
}

export async function loadScanHistory(): Promise<ScannedPosition[]> {
  const db = await getDB();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const request = transaction.objectStore(STORE_NAME).getAll();
      let records: unknown[] = [];
      request.onerror = () => reject(request.error || new Error('Could not read scan history.'));
      request.onsuccess = () => { records = request.result; };
      transaction.onerror = () => reject(transaction.error || new Error('Could not read scan history.'));
      transaction.oncomplete = () => {
        const migrated = records.map(migrateScanRecord);
        migrated.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
        resolve(migrated.slice(0, 50));
      };
    });
  } finally {
    db.close();
  }
}

export async function saveScan(scan: ScannedPosition): Promise<ScanStorageResult> {
  let db: IDBDatabase | undefined;
  try {
    db = await getDB();
    const duplicate = await new Promise<ScannedPosition | undefined>((resolve, reject) => {
      const transaction = db!.transaction(STORE_NAME, 'readonly');
      const request = transaction.objectStore(STORE_NAME).index(FINGERPRINT_INDEX).get(scan.fingerprint);
      request.onerror = () => reject(request.error || new Error('Duplicate scan check failed.'));
      request.onsuccess = () => resolve(request.result as ScannedPosition | undefined);
    });
    if (duplicate && duplicate.id !== scan.id) {
      return { success: false, error: 'duplicate', message: 'This corrected scan is already saved.' };
    }

    await new Promise<void>((resolve, reject) => {
      const transaction = db!.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).put(scan);
      transaction.onerror = () => reject(transaction.error || new Error('Could not save scan.'));
      transaction.onabort = () => reject(transaction.error || new Error('Saving the scan was aborted.'));
      transaction.oncomplete = () => resolve();
    });
    return { success: true };
  } catch (error) {
    return storageFailure(error);
  } finally {
    db?.close();
  }
}

async function mutateStore(operation: (store: IDBObjectStore) => void): Promise<ScanStorageResult> {
  let db: IDBDatabase | undefined;
  try {
    db = await getDB();
    await new Promise<void>((resolve, reject) => {
      const transaction = db!.transaction(STORE_NAME, 'readwrite');
      operation(transaction.objectStore(STORE_NAME));
      transaction.onerror = () => reject(transaction.error || new Error('Scan storage operation failed.'));
      transaction.onabort = () => reject(transaction.error || new Error('Scan storage operation was aborted.'));
      transaction.oncomplete = () => resolve();
    });
    return { success: true };
  } catch (error) {
    return storageFailure(error);
  } finally {
    db?.close();
  }
}

export function deleteScan(id: string): Promise<ScanStorageResult> {
  return mutateStore((store) => { store.delete(id); });
}

export function clearScanHistory(): Promise<ScanStorageResult> {
  return mutateStore((store) => { store.clear(); });
}
