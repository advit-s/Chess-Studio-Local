export interface ScannedPosition {
  id: string;
  date: string;
  originalImage?: string; // base64 representation
  croppedImage?: string; // base64 representation
  detectedFen: string;
  correctedFen: string;
  confidence: number;
  notes: string;
}

const DB_NAME = 'chess-studio-ocr-db';
const DB_VERSION = 1;
const STORE_NAME = 'scan-history';

function getDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
  });
}

export async function loadScanHistory(): Promise<ScannedPosition[]> {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const results = request.result as ScannedPosition[];
        results.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        resolve(results.slice(0, 50));
      };
    });
  } catch (error) {
    console.error('Failed to load scan history', error);
    return [];
  }
}

export async function saveScan(scan: ScannedPosition): Promise<boolean> {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(scan);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(true);
    });
  } catch (error) {
    console.error('Failed to save scan', error);
    return false;
  }
}

export async function deleteScan(id: string): Promise<boolean> {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(id);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(true);
    });
  } catch (error) {
    console.error('Failed to delete scan', error);
    return false;
  }
}

export async function clearScanHistory(): Promise<boolean> {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.clear();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(true);
    });
  } catch (error) {
    console.error('Failed to clear scan history', error);
    return false;
  }
}
