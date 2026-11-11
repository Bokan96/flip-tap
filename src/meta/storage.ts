/**
 * JSON storage on top of localStorage. Tests (and browsers with storage disabled) can swap in
 * another backend; failures never throw, progress just lasts for the session.
 */
export interface StorageBackend {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function memoryStorage(): StorageBackend {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
}

let backend: StorageBackend = (() => {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch {
    /* access denied */
  }
  return memoryStorage();
})();

export function setStorageBackend(b: StorageBackend): void {
  backend = b;
}

export function readRaw(key: string): string | null {
  try {
    return backend.getItem(key);
  } catch {
    return null;
  }
}

export function readJson<T>(key: string): T | null {
  const raw = readRaw(key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function writeJson(key: string, value: unknown): void {
  try {
    backend.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or unavailable */
  }
}

export function removeKey(key: string): void {
  try {
    backend.removeItem(key);
  } catch {
    /* ignore */
  }
}
