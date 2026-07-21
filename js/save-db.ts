/**
 * Shared IndexedDB handle for planet rows and the global player profile.
 * Bump DB_VERSION when adding stores; onupgradeneeded is idempotent.
 */

export const DB_NAME = "deep-space-atlas";
export const DB_VERSION = 2;
export const PLANETS_STORE = "planets";
export const PROFILE_STORE = "profile";

export function openSaveDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (error) {
      reject(error);
      return;
    }
    request.onerror = () => {
      reject(request.error ?? new Error("IndexedDB open failed"));
    };
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(PLANETS_STORE)) {
        database.createObjectStore(PLANETS_STORE, { keyPath: "seed" });
      }
      if (!database.objectStoreNames.contains(PROFILE_STORE)) {
        database.createObjectStore(PROFILE_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
}

export function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

/**
 * Replace both campaign stores in one transaction. Portable LOAD and NEW GAME
 * must not leave half-installed profile/planet state if any request fails.
 */
export async function replaceCampaignData(options: {
  planets: readonly unknown[];
  profile: unknown;
}): Promise<void> {
  const database = await openSaveDb();
  try {
    const transaction = database.transaction(
      [PLANETS_STORE, PROFILE_STORE],
      "readwrite",
    );
    const planets = transaction.objectStore(PLANETS_STORE);
    const profile = transaction.objectStore(PROFILE_STORE);
    const requests: Array<Promise<unknown>> = [
      idbRequest(planets.clear()),
      idbRequest(profile.clear()),
    ];
    for (const document of options.planets) {
      requests.push(idbRequest(planets.put(document)));
    }
    requests.push(idbRequest(profile.put(options.profile)));
    await Promise.all(requests);
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error("Campaign write failed"));
      transaction.onabort = () =>
        reject(transaction.error ?? new Error("Campaign write aborted"));
    });
  } finally {
    database.close();
  }
}
