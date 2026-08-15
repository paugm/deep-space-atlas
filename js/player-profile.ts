/**
 * Global player profile: callsign, cargo, playtime, mute, look sensitivity,
 * CRT comfort, traveling crew, survey postcards, gear, and visits.
 * Lives in the shared IndexedDB next to per-planet rows. Planet pets stay
 * planet-bound; crew travels on the profile.
 */

import type { GearId } from "./gear.ts";
import { cloneGear, isGearId } from "./gear.ts";
import type { Inventory } from "./config.ts";
import {
  LOOK_SENSITIVITY_DEFAULT,
  MATERIAL_ORDER,
  normalizeLookSensitivity,
} from "./config.ts";
import {
  isFaunaSpeciesId,
  type FaunaSpeciesId,
} from "./fauna/species.ts";
import {
  POSTCARD_MAX_COUNT,
  POSTCARD_THUMB_MAX_CHARS,
} from "./postcard.ts";
import {
  PROFILE_STORE,
  idbRequest,
  openSaveDb,
} from "./save-db.ts";

export const PLAYER_PROFILE_VERSION = 5;
/** Profiles sealed before mute preference was stored. */
export const PLAYER_PROFILE_VERSION_V1 = 1;
/** Profiles sealed before gear was stored. */
export const PLAYER_PROFILE_VERSION_V2 = 2;
/** Profiles sealed with `builds` (renamed to `gear` in v4). */
export const PLAYER_PROFILE_VERSION_V3 = 3;
/** Profiles sealed before look sensitivity, CRT comfort, crew, and postcards. */
export const PLAYER_PROFILE_VERSION_V4 = 4;
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

export interface CrewRecord {
  species: FaunaSpeciesId;
  homeSeed: string;
  homeName: string;
}

export interface SurveyPostcard {
  seed: string;
  name: string;
  capturedAt: number;
  /** Small JPEG data URL for the local atlas. */
  thumb: string;
}

export interface PlayerProfile {
  v: number;
  id: typeof PROFILE_DOCUMENT_ID;
  name: string;
  inventory: Inventory;
  playTimeMs: number;
  /** Master audio mute; false means sound is active. */
  muted: boolean;
  /** Permanently installed commander gear (profile-wide). */
  gear: GearId[];
  lookSensitivity: number;
  /** Extra CRT calming on top of prefers-reduced-motion. */
  reduceCrtMotion: boolean;
  crew: CrewRecord | null;
  postcards: SurveyPostcard[];
  visited: VisitedPlanet[];
  checksum: string;
}

export interface ProfileView {
  name: string;
  playTimeMs: number;
  inventory: Inventory;
  muted: boolean;
  gear: readonly GearId[];
  lookSensitivity: number;
  reduceCrtMotion: boolean;
  crew: CrewRecord | null;
  postcards: readonly SurveyPostcard[];
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
  setGear(gear: readonly GearId[]): void;
  setMuted(muted: boolean): void;
  setLookSensitivity(value: number): void;
  setReduceCrtMotion(reduce: boolean): void;
  setCrew(crew: CrewRecord | null): void;
  addPostcard(postcard: SurveyPostcard): void;
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

function parseGear(raw: unknown): GearId[] | null {
  if (!Array.isArray(raw)) return null;
  const gear: GearId[] = [];
  const seen = new Set<GearId>();
  for (const entry of raw) {
    if (!isGearId(entry) || seen.has(entry)) return null;
    seen.add(entry);
    gear.push(entry);
  }
  return gear;
}

function parseCrewRecord(raw: unknown): CrewRecord | null | undefined {
  if (raw === null) return null;
  if (!isRecord(raw)) return undefined;
  if (!isFaunaSpeciesId(raw.species)) return undefined;
  if (typeof raw.homeSeed !== "string" || !/^[0-9A-Fa-f]{1,8}$/.test(raw.homeSeed)) {
    return undefined;
  }
  if (typeof raw.homeName !== "string") return undefined;
  return {
    species: raw.species,
    homeSeed: raw.homeSeed.toUpperCase().padStart(8, "0"),
    homeName: raw.homeName.trim().slice(0, 64) || "Unknown",
  };
}

function parsePostcard(raw: unknown): SurveyPostcard | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.seed !== "string" || !/^[0-9A-Fa-f]{1,8}$/.test(raw.seed)) {
    return null;
  }
  if (typeof raw.name !== "string") return null;
  if (typeof raw.capturedAt !== "number" || !Number.isFinite(raw.capturedAt)) {
    return null;
  }
  if (typeof raw.thumb !== "string") return null;
  if (!raw.thumb.startsWith("data:image/")) return null;
  if (raw.thumb.length > POSTCARD_THUMB_MAX_CHARS) return null;
  return {
    seed: raw.seed.toUpperCase().padStart(8, "0"),
    name: raw.name.trim().slice(0, 64) || "Unknown",
    capturedAt: raw.capturedAt,
    thumb: raw.thumb,
  };
}

function parsePostcardList(raw: unknown): SurveyPostcard[] | null {
  if (!Array.isArray(raw)) return null;
  const postcards: SurveyPostcard[] = [];
  for (const entry of raw) {
    const parsed = parsePostcard(entry);
    if (parsed === null) return null;
    postcards.push(parsed);
    if (postcards.length >= POSTCARD_MAX_COUNT) break;
  }
  return postcards;
}

function cloneCrew(crew: CrewRecord | null): CrewRecord | null {
  if (crew === null) return null;
  return {
    species: crew.species,
    homeSeed: crew.homeSeed.toUpperCase().padStart(8, "0"),
    homeName: crew.homeName.trim().slice(0, 64) || "Unknown",
  };
}

function clonePostcards(
  postcards: readonly SurveyPostcard[],
): SurveyPostcard[] {
  return postcards.map((entry) => ({
    seed: entry.seed.toUpperCase().padStart(8, "0"),
    name: entry.name.trim().slice(0, 64) || "Unknown",
    capturedAt: entry.capturedAt,
    thumb: entry.thumb,
  }));
}

function fnv1aHex(payload: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < payload.length; index += 1) {
    hash ^= payload.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).toUpperCase().padStart(8, "0");
}

export type PlayerProfileDraft = Omit<
  PlayerProfile,
  | "checksum"
  | "lookSensitivity"
  | "reduceCrtMotion"
  | "crew"
  | "postcards"
  | "gear"
> & {
  gear?: GearId[];
  lookSensitivity?: number;
  reduceCrtMotion?: boolean;
  crew?: CrewRecord | null;
  postcards?: SurveyPostcard[];
  checksum?: string;
};

export function checksumPlayerProfile(
  document: Omit<PlayerProfile, "checksum"> & { checksum?: string },
): string {
  const { checksum: _ignored, ...body } = document;
  return fnv1aHex(JSON.stringify(body));
}

export function sealPlayerProfile(document: PlayerProfileDraft): PlayerProfile {
  const sealed: PlayerProfile = {
    v: PLAYER_PROFILE_VERSION,
    id: PROFILE_DOCUMENT_ID,
    name: normalizePlayerName(document.name),
    inventory: cloneInventory(document.inventory),
    playTimeMs: Math.max(0, Math.floor(document.playTimeMs)),
    muted: document.muted === true,
    gear: cloneGear(document.gear ?? []),
    lookSensitivity: normalizeLookSensitivity(
      document.lookSensitivity ?? LOOK_SENSITIVITY_DEFAULT,
    ),
    reduceCrtMotion: document.reduceCrtMotion === true,
    crew: cloneCrew(document.crew ?? null),
    postcards: clonePostcards(document.postcards ?? []),
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
    gear: [],
    lookSensitivity: LOOK_SENSITIVITY_DEFAULT,
    reduceCrtMotion: false,
    crew: null,
    postcards: [],
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

/** Checksum body for legacy v2 profiles (no gear field). */
function checksumPlayerProfileV2(document: {
  v: number;
  id: string;
  name: string;
  inventory: Inventory;
  playTimeMs: number;
  muted: boolean;
  visited: VisitedPlanet[];
}): string {
  return fnv1aHex(JSON.stringify(document));
}

/** Checksum body for legacy v3 profiles (`builds` instead of `gear`). */
function checksumPlayerProfileV3(document: {
  v: number;
  id: string;
  name: string;
  inventory: Inventory;
  playTimeMs: number;
  muted: boolean;
  builds: GearId[];
  visited: VisitedPlanet[];
}): string {
  return fnv1aHex(JSON.stringify(document));
}

/** Checksum body for legacy v4 profiles (no look/crew/postcard fields). */
function checksumPlayerProfileV4(document: {
  v: number;
  id: string;
  name: string;
  inventory: Inventory;
  playTimeMs: number;
  muted: boolean;
  gear: GearId[];
  visited: VisitedPlanet[];
}): string {
  return fnv1aHex(JSON.stringify(document));
}

function upgradeLegacyProfile(fields: {
  name: string;
  inventory: Inventory;
  playTimeMs: number;
  muted: boolean;
  gear: GearId[];
  visited: VisitedPlanet[];
}): PlayerProfile {
  return sealPlayerProfile({
    v: PLAYER_PROFILE_VERSION,
    id: PROFILE_DOCUMENT_ID,
    name: fields.name,
    inventory: fields.inventory,
    playTimeMs: fields.playTimeMs,
    muted: fields.muted,
    gear: fields.gear,
    lookSensitivity: LOOK_SENSITIVITY_DEFAULT,
    reduceCrtMotion: false,
    crew: null,
    postcards: [],
    visited: fields.visited,
  });
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
    return upgradeLegacyProfile({
      name,
      inventory,
      playTimeMs,
      muted: DEFAULT_AUDIO_MUTED,
      gear: [],
      visited,
    });
  }

  if (raw.v === PLAYER_PROFILE_VERSION_V2) {
    if (typeof raw.muted !== "boolean") return null;
    const expected = checksumPlayerProfileV2({
      v: PLAYER_PROFILE_VERSION_V2,
      id: PROFILE_DOCUMENT_ID,
      name,
      inventory,
      playTimeMs,
      muted: raw.muted,
      visited,
    });
    if (expected !== raw.checksum) return null;
    return upgradeLegacyProfile({
      name,
      inventory,
      playTimeMs,
      muted: raw.muted,
      gear: [],
      visited,
    });
  }

  if (raw.v === PLAYER_PROFILE_VERSION_V3) {
    if (typeof raw.muted !== "boolean") return null;
    const gear = parseGear(raw.builds);
    if (gear === null) return null;
    const expected = checksumPlayerProfileV3({
      v: PLAYER_PROFILE_VERSION_V3,
      id: PROFILE_DOCUMENT_ID,
      name,
      inventory,
      playTimeMs,
      muted: raw.muted,
      builds: gear,
      visited,
    });
    if (expected !== raw.checksum) return null;
    return upgradeLegacyProfile({
      name,
      inventory,
      playTimeMs,
      muted: raw.muted,
      gear,
      visited,
    });
  }

  if (raw.v === PLAYER_PROFILE_VERSION_V4) {
    if (typeof raw.muted !== "boolean") return null;
    const gear = parseGear(raw.gear);
    if (gear === null) return null;
    const expected = checksumPlayerProfileV4({
      v: PLAYER_PROFILE_VERSION_V4,
      id: PROFILE_DOCUMENT_ID,
      name,
      inventory,
      playTimeMs,
      muted: raw.muted,
      gear,
      visited,
    });
    if (expected !== raw.checksum) return null;
    return upgradeLegacyProfile({
      name,
      inventory,
      playTimeMs,
      muted: raw.muted,
      gear,
      visited,
    });
  }

  if (raw.v !== PLAYER_PROFILE_VERSION) return null;
  if (typeof raw.muted !== "boolean") return null;
  if (typeof raw.reduceCrtMotion !== "boolean") return null;
  const gear = parseGear(raw.gear);
  if (gear === null) return null;
  if (
    typeof raw.lookSensitivity !== "number" ||
    !Number.isFinite(raw.lookSensitivity)
  ) {
    return null;
  }
  const crew = parseCrewRecord(raw.crew);
  if (crew === undefined) return null;
  const postcards = parsePostcardList(raw.postcards);
  if (postcards === null) return null;

  const candidate: PlayerProfile = {
    v: PLAYER_PROFILE_VERSION,
    id: PROFILE_DOCUMENT_ID,
    name,
    inventory,
    playTimeMs,
    muted: raw.muted,
    gear,
    lookSensitivity: normalizeLookSensitivity(raw.lookSensitivity),
    reduceCrtMotion: raw.reduceCrtMotion,
    crew,
    postcards,
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
    gear: candidate.gear,
    lookSensitivity: candidate.lookSensitivity,
    reduceCrtMotion: candidate.reduceCrtMotion,
    crew: candidate.crew,
    postcards: candidate.postcards,
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
      gear: cloneGear(active.gear),
      lookSensitivity: active.lookSensitivity,
      reduceCrtMotion: active.reduceCrtMotion,
      crew: cloneCrew(active.crew),
      postcards: clonePostcards(active.postcards),
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

  function setLookSensitivity(value: number): void {
    const next = normalizeLookSensitivity(value);
    if (next === active.lookSensitivity) return;
    active = { ...active, lookSensitivity: next };
    scheduleSave();
  }

  function setReduceCrtMotion(reduce: boolean): void {
    if (active.reduceCrtMotion === reduce) return;
    active = { ...active, reduceCrtMotion: reduce };
    scheduleSave();
  }

  function setCrew(crew: CrewRecord | null): void {
    const next = cloneCrew(crew);
    const current = active.crew;
    if (next === null && current === null) return;
    if (
      next !== null &&
      current !== null &&
      next.species === current.species &&
      next.homeSeed === current.homeSeed &&
      next.homeName === current.homeName
    ) {
      return;
    }
    active = { ...active, crew: next };
    scheduleSave();
  }

  function addPostcard(postcard: SurveyPostcard): void {
    const parsed = parsePostcard(postcard);
    if (parsed === null) return;
    const next = [
      parsed,
      ...active.postcards.filter((entry) => entry.seed !== parsed.seed),
    ].slice(0, POSTCARD_MAX_COUNT);
    active = { ...active, postcards: next };
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

  function setGear(gear: readonly GearId[]): void {
    const next = cloneGear(gear);
    if (
      next.length === active.gear.length &&
      next.every((id, index) => id === active.gear[index])
    ) {
      return;
    }
    active = { ...active, gear: next };
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
    setGear,
    setMuted,
    setLookSensitivity,
    setReduceCrtMotion,
    setCrew,
    addPostcard,
    addPlayTime,
    recordVisit,
    setVisitedPet,
    flush,
  };
}
