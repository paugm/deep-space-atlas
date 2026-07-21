/**
 * Global player profile: callsign, cargo, playtime, mute preference, and
 * visited-planet index. Lives in the shared IndexedDB next to per-planet rows
 * and not inside planet patches. Pets stay planet-bound; visited entries only
 * cache hasPet for UI.
 */

import type { Inventory } from "./config.ts";
import { MATERIAL_ORDER } from "./config.ts";
import {
  PROFILE_STORE,
  idbRequest,
  openSaveDb,
} from "./save-db.ts";

export const PLAYER_PROFILE_VERSION = 2;
/** Profiles sealed before mute preference was stored. */
export const PLAYER_PROFILE_VERSION_V1 = 1;
export const PROFILE_DOCUMENT_ID = "player";
export const DEFAULT_PLAYER_NAME = "Explorer";
export const MAX_PLAYER_NAME_LENGTH = 24;
/** Sound is active unless the player has muted. */
export const DEFAULT_AUDIO_MUTED = false;

const SAVE_DEBOUNCE_MS = 400;
/** Persist playtime at least this often while it is accumulating. */
const PLAYTIME_SAVE_INTERVAL_MS = 5000;

export interface VisitedPlanet {
  seed: string;
  name: string;
  firstVisitedAt: number;
  lastVisitedAt: number;
  hasPet: boolean;
}

export interface PlayerProfile {
  v: number;
  id: typeof PROFILE_DOCUMENT_ID;
  name: string;
  inventory: Inventory;
  playTimeMs: number;
  /** Master audio mute; false means sound is active. */
  muted: boolean;
  visited: VisitedPlanet[];
  checksum: string;
}

export interface ProfileView {
  name: string;
  playTimeMs: number;
  inventory: Inventory;
  muted: boolean;
  visited: readonly VisitedPlanet[];
}

export interface ProfileStore {
  get(): Promise<PlayerProfile | null>;
  put(document: PlayerProfile): Promise<void>;
  isAvailable(): boolean;
}

export interface ProfileSession {
  get(): PlayerProfile;
  getView(): ProfileView;
  hydrate(): Promise<void>;
  /** Replace in-memory state from a loaded campaign (does not write). */
  adopt(profile: PlayerProfile): void;
  setName(name: string): void;
  setInventory(inventory: Inventory): void;
  setMuted(muted: boolean): void;
  addPlayTime(deltaMs: number): void;
  recordVisit(seed: string, name: string, hasPet: boolean): void;
  setVisitedPet(seed: string, hasPet: boolean): void;
  flush(): Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createEmptyInventory(): Inventory {
  const inventory = {} as Inventory;
  for (const materialId of MATERIAL_ORDER) {
    inventory[materialId] = 0;
  }
  return inventory;
}

export function cloneInventory(inventory: Inventory): Inventory {
  const next = createEmptyInventory();
  for (const materialId of MATERIAL_ORDER) {
    next[materialId] = inventory[materialId];
  }
  return next;
}

export function normalizePlayerName(raw: string): string {
  const trimmed = raw.trim().replace(/\s+/g, " ");
  if (trimmed.length === 0) return DEFAULT_PLAYER_NAME;
  return trimmed.slice(0, MAX_PLAYER_NAME_LENGTH);
}

export function formatPlayTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${minutes.toString().padStart(2, "0")}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
  }
  return `${seconds}s`;
}

/**
 * Resume seed from the most recently visited planet, or null when the
 * profile has no visit history yet.
 */
export function lastVisitedSeedHex(
  visited: readonly VisitedPlanet[],
): string | null {
  const latest = visited[0];
  return latest === undefined ? null : latest.seed;
}

function parseInventory(raw: unknown): Inventory | null {
  if (!isRecord(raw)) return null;
  const inventory = createEmptyInventory();
  for (const materialId of MATERIAL_ORDER) {
    const value = raw[materialId];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      return null;
    }
    inventory[materialId] = Math.floor(value);
  }
  return inventory;
}

function parseVisitedPlanet(raw: unknown): VisitedPlanet | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.seed !== "string" || !/^[0-9A-Fa-f]{1,8}$/.test(raw.seed)) {
    return null;
  }
  if (typeof raw.name !== "string") return null;
  if (
    typeof raw.firstVisitedAt !== "number" ||
    !Number.isFinite(raw.firstVisitedAt)
  ) {
    return null;
  }
  if (
    typeof raw.lastVisitedAt !== "number" ||
    !Number.isFinite(raw.lastVisitedAt)
  ) {
    return null;
  }
  if (typeof raw.hasPet !== "boolean") return null;
  return {
    seed: raw.seed.toUpperCase().padStart(8, "0"),
    name: raw.name.trim().slice(0, 64) || "Unknown",
    firstVisitedAt: raw.firstVisitedAt,
    lastVisitedAt: raw.lastVisitedAt,
    hasPet: raw.hasPet,
  };
}

function parseVisitedList(raw: unknown): VisitedPlanet[] | null {
  if (!Array.isArray(raw)) return null;
  const visited: VisitedPlanet[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const parsed = parseVisitedPlanet(entry);
    if (parsed === null) return null;
    if (seen.has(parsed.seed)) continue;
    seen.add(parsed.seed);
    visited.push(parsed);
  }
  visited.sort((a, b) => b.lastVisitedAt - a.lastVisitedAt);
  return visited;
}

function fnv1aHex(payload: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < payload.length; index += 1) {
    hash ^= payload.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).toUpperCase().padStart(8, "0");
}

/** FNV-1a over the document body excluding checksum. */
export function checksumPlayerProfile(
  document: Omit<PlayerProfile, "checksum"> & { checksum?: string },
): string {
  const { checksum: _ignored, ...body } = document;
  return fnv1aHex(JSON.stringify(body));
}

export function sealPlayerProfile(
  document: Omit<PlayerProfile, "checksum"> & { checksum?: string },
): PlayerProfile {
  const sealed: PlayerProfile = {
    v: PLAYER_PROFILE_VERSION,
    id: PROFILE_DOCUMENT_ID,
    name: normalizePlayerName(document.name),
    inventory: cloneInventory(document.inventory),
    playTimeMs: Math.max(0, Math.floor(document.playTimeMs)),
    muted: document.muted === true,
    visited: document.visited.map((entry) => ({ ...entry })),
    checksum: "",
  };
  sealed.checksum = checksumPlayerProfile(sealed);
  return sealed;
}

export function createEmptyPlayerProfile(): PlayerProfile {
  return sealPlayerProfile({
    v: PLAYER_PROFILE_VERSION,
    id: PROFILE_DOCUMENT_ID,
    name: DEFAULT_PLAYER_NAME,
    inventory: createEmptyInventory(),
    playTimeMs: 0,
    muted: DEFAULT_AUDIO_MUTED,
    visited: [],
  });
}

/** Checksum body for legacy v1 profiles (no mute field). */
function checksumPlayerProfileV1(document: {
  v: number;
  id: string;
  name: string;
  inventory: Inventory;
  playTimeMs: number;
  visited: VisitedPlanet[];
}): string {
  return fnv1aHex(JSON.stringify(document));
}

export function parsePlayerProfile(raw: unknown): PlayerProfile | null {
  if (!isRecord(raw)) return null;
  if (raw.id !== PROFILE_DOCUMENT_ID) return null;
  if (typeof raw.name !== "string") return null;
  if (typeof raw.checksum !== "string") return null;
  if (typeof raw.playTimeMs !== "number" || !Number.isFinite(raw.playTimeMs)) {
    return null;
  }

  const inventory = parseInventory(raw.inventory);
  if (inventory === null) return null;
  const visited = parseVisitedList(raw.visited);
  if (visited === null) return null;

  const name = normalizePlayerName(raw.name);
  const playTimeMs = Math.max(0, Math.floor(raw.playTimeMs));

  if (raw.v === PLAYER_PROFILE_VERSION_V1) {
    const expected = checksumPlayerProfileV1({
      v: PLAYER_PROFILE_VERSION_V1,
      id: PROFILE_DOCUMENT_ID,
      name,
      inventory,
      playTimeMs,
      visited,
    });
    if (expected !== raw.checksum) return null;
    // Upgrade in memory; next flush seals as v2 with muted default (sound on).
    return sealPlayerProfile({
      v: PLAYER_PROFILE_VERSION,
      id: PROFILE_DOCUMENT_ID,
      name,
      inventory,
      playTimeMs,
      muted: DEFAULT_AUDIO_MUTED,
      visited,
    });
  }

  if (raw.v !== PLAYER_PROFILE_VERSION) return null;
  if (typeof raw.muted !== "boolean") return null;

  const candidate: PlayerProfile = {
    v: PLAYER_PROFILE_VERSION,
    id: PROFILE_DOCUMENT_ID,
    name,
    inventory,
    playTimeMs,
    muted: raw.muted,
    visited,
    checksum: raw.checksum,
  };

  const expected = checksumPlayerProfile({
    v: candidate.v,
    id: candidate.id,
    name: candidate.name,
    inventory: candidate.inventory,
    playTimeMs: candidate.playTimeMs,
    muted: candidate.muted,
    visited: candidate.visited,
  });
  if (expected !== raw.checksum) return null;
  return candidate;
}

export function createProfileStore(): ProfileStore {
  let available: boolean | null = null;

  function isAvailable(): boolean {
    if (available !== null) return available;
    available = typeof indexedDB !== "undefined" && indexedDB !== null;
    return available;
  }

  function markUnavailable(): void {
    available = false;
  }

  async function openDb(): Promise<IDBDatabase> {
    try {
      return await openSaveDb();
    } catch (error) {
      markUnavailable();
      throw error;
    }
  }

  async function get(): Promise<PlayerProfile | null> {
    if (!isAvailable()) return null;
    try {
      const database = await openDb();
      try {
        const raw = await idbRequest<unknown>(
          database
            .transaction(PROFILE_STORE, "readonly")
            .objectStore(PROFILE_STORE)
            .get(PROFILE_DOCUMENT_ID),
        );
        return parsePlayerProfile(raw);
      } finally {
        database.close();
      }
    } catch {
      return null;
    }
  }

  async function put(document: PlayerProfile): Promise<void> {
    if (!isAvailable()) return;
    const sealed = sealPlayerProfile(document);
    const database = await openDb();
    try {
      await idbRequest(
        database
          .transaction(PROFILE_STORE, "readwrite")
          .objectStore(PROFILE_STORE)
          .put(sealed),
      );
    } finally {
      database.close();
    }
  }

  return { get, put, isAvailable };
}

export function createProfileSession(options: {
  store?: ProfileStore;
  onStorageWarning?: (message: string) => void;
} = {}): ProfileSession {
  const store = options.store ?? createProfileStore();
  let active = createEmptyPlayerProfile();
  let hydrated = false;
  let saveTimer: number | null = null;
  let writeChain: Promise<void> = Promise.resolve();
  let warnedMissingStore = false;
  let playTimeSavedAt = 0;

  function warnOnce(message: string): void {
    if (warnedMissingStore) return;
    warnedMissingStore = true;
    options.onStorageWarning?.(message);
  }

  function scheduleSave(): void {
    if (!hydrated) return;
    if (saveTimer !== null) window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      saveTimer = null;
      void flush();
    }, SAVE_DEBOUNCE_MS);
  }

  async function flush(): Promise<void> {
    if (!hydrated) return;
    if (saveTimer !== null) {
      window.clearTimeout(saveTimer);
      saveTimer = null;
    }

    writeChain = writeChain.then(async () => {
      if (!hydrated) return;
      const sealed = sealPlayerProfile(active);
      active = sealed;
      playTimeSavedAt = sealed.playTimeMs;
      try {
        if (!store.isAvailable()) {
          warnOnce(
            "Profile auto-save unavailable here — progress stays in this session only.",
          );
          return;
        }
        await store.put(sealed);
      } catch {
        warnOnce("Could not write player profile.");
      }
    });
    await writeChain;
  }

  async function hydrate(): Promise<void> {
    const stored = await store.get();
    active = stored ?? createEmptyPlayerProfile();
    hydrated = true;
    playTimeSavedAt = active.playTimeMs;
  }

  function adopt(profile: PlayerProfile): void {
    active = sealPlayerProfile(profile);
    hydrated = true;
    playTimeSavedAt = active.playTimeMs;
  }

  function get(): PlayerProfile {
    return active;
  }

  function getView(): ProfileView {
    return {
      name: active.name,
      playTimeMs: active.playTimeMs,
      inventory: cloneInventory(active.inventory),
      muted: active.muted,
      visited: active.visited.map((entry) => ({ ...entry })),
    };
  }

  function setName(name: string): void {
    const next = normalizePlayerName(name);
    if (next === active.name) return;
    active = { ...active, name: next };
    scheduleSave();
  }

  function setMuted(muted: boolean): void {
    if (active.muted === muted) return;
    active = { ...active, muted };
    scheduleSave();
  }

  function setInventory(inventory: Inventory): void {
    let unchanged = true;
    for (const materialId of MATERIAL_ORDER) {
      if (active.inventory[materialId] !== inventory[materialId]) {
        unchanged = false;
        break;
      }
    }
    if (unchanged) return;
    active = {
      ...active,
      inventory: cloneInventory(inventory),
    };
    scheduleSave();
  }

  function addPlayTime(deltaMs: number): void {
    if (!(deltaMs > 0)) return;
    active = {
      ...active,
      playTimeMs: active.playTimeMs + deltaMs,
    };
    if (active.playTimeMs - playTimeSavedAt >= PLAYTIME_SAVE_INTERVAL_MS) {
      scheduleSave();
    }
  }

  function recordVisit(seed: string, name: string, hasPet: boolean): void {
    const seedHex = seed.toUpperCase().padStart(8, "0");
    const now = Date.now();
    const existingIndex = active.visited.findIndex(
      (entry) => entry.seed === seedHex,
    );
    const nextVisited = active.visited.map((entry) => ({ ...entry }));
    if (existingIndex >= 0) {
      const existing = nextVisited[existingIndex]!;
      nextVisited[existingIndex] = {
        ...existing,
        name: name.trim().slice(0, 64) || existing.name,
        lastVisitedAt: now,
        hasPet,
      };
    } else {
      nextVisited.push({
        seed: seedHex,
        name: name.trim().slice(0, 64) || "Unknown",
        firstVisitedAt: now,
        lastVisitedAt: now,
        hasPet,
      });
    }
    nextVisited.sort((a, b) => b.lastVisitedAt - a.lastVisitedAt);
    active = { ...active, visited: nextVisited };
    scheduleSave();
  }

  function setVisitedPet(seed: string, hasPet: boolean): void {
    const seedHex = seed.toUpperCase().padStart(8, "0");
    const index = active.visited.findIndex((entry) => entry.seed === seedHex);
    if (index < 0) return;
    const existing = active.visited[index]!;
    if (existing.hasPet === hasPet) return;
    const nextVisited = active.visited.map((entry) => ({ ...entry }));
    nextVisited[index] = { ...existing, hasPet };
    active = { ...active, visited: nextVisited };
    scheduleSave();
  }

  return {
    get,
    getView,
    hydrate,
    adopt,
    setName,
    setInventory,
    setMuted,
    addPlayTime,
    recordVisit,
    setVisitedPet,
    flush,
  };
}
