/**
 * Per-planet persistence: versioned patch documents in IndexedDB (one row per
 * seed). Load path is always build(seed) then apply patch.
 *
 * Terrain stays sparse until enough cells change, then compacts to a base64
 * Float32 packed snapshot. Deposits are keyed by stable ids (type + quantized
 * XZ). contentRevision gates deposit patches when procedural placement changes
 * incompatibly.
 *
 * Portable backups of the whole campaign (planets + profile) live in
 * `js/game-save.ts` as `.deepspaceatlas` files, not per-planet exports.
 */

import type { DepositType } from "./config.ts";
import type { WorldSystem } from "./world.ts";
import type { CaveBrush } from "./world/caves.ts";
import { upsertPetEntity } from "./fauna/pet-entity.ts";
import {
  findPlayerEntity,
  upsertPlayerEntity,
} from "./player-entity.ts";
import {
  findParkedShipEntity,
  upsertParkedShipEntity,
} from "./space/parked-ship-entity.ts";
import { DEPOSIT_TYPES, VERTICES_PER_ROW } from "./config.ts";
import { PLANETS_STORE, idbRequest, openSaveDb } from "./save-db.ts";
import {
  appendCaveBrush,
  decodeCaveBrushes,
  encodeCaveBrushes,
  isValidCaveBrush,
} from "./world/caves.ts";

export const PLANET_SAVE_VERSION = 2;
/** Bump when deposit placement / identity rules change incompatibly. */
export const WORLD_CONTENT_REVISION = 3;

/** Compact sparse terrain once edited cells pass this share of the grid. */
const TERRAIN_COMPACT_RATIO = 0.12;
const SAVE_DEBOUNCE_MS = 400;

const VERTEX_COUNT = VERTICES_PER_ROW * VERTICES_PER_ROW;

export type PlanetEntityKind = "pet" | "player" | "parked-ship" | "rover";

export interface PlanetEntity {
  id: string;
  kind: PlanetEntityKind;
  x: number;
  y: number;
  z: number;
  yaw?: number;
  data?: Record<string, unknown>;
}

/**
 * Look up a singleton entity by kind (pet / player / parked-ship use kind as
 * id). Multi-instance kinds such as `rover` should use `list*` helpers instead.
 */
export function findPlanetEntity(
  document: Pick<PlanetDocument, "entities">,
  kind: PlanetEntityKind,
): PlanetEntity | null {
  for (const entity of document.entities) {
    if (entity.kind === kind && entity.id === kind) return entity;
  }
  return null;
}

export function upsertPlanetEntity(
  document: PlanetDocument,
  entity: PlanetEntity,
): void {
  document.entities = document.entities.filter(
    (entry) =>
      !(entry.kind === entity.kind && entry.id === entity.id),
  );
  document.entities.push(entity);
}

export type TerrainPatch =
  | {
      kind: "sparse";
      cells: Array<readonly [index: number, height: number]>;
    }
  | {
      kind: "packed";
      encoding: "f32le-b64";
      data: string;
      /**
       * Decoded heights kept alongside `data` after the first merge so
       * craters patch in place. Re-encoded into `data` at flush time.
       */
      heights?: Float32Array;
    };

export interface CavePatch {
  kind: "capsule-brushes";
  encoding: "i16le-20-b64";
  data: string;
  /** Decoded brushes stay live between digs and are re-encoded at flush. */
  brushes?: CaveBrush[];
}

export interface DepositPatchEntry {
  id: string;
  remaining: number;
}

export interface PlanetDocument {
  v: number;
  seed: string;
  checksum: string;
  contentRevision: number;
  terrain?: TerrainPatch;
  caves?: CavePatch;
  deposits?: Partial<Record<DepositType, DepositPatchEntry[]>>;
  entities: PlanetEntity[];
}

export interface TerrainHeightSample {
  index: number;
  height: number;
}

export interface PlanetSession {
  readonly seedHex: string;
  open(seed: number, options?: { skipFlush?: boolean }): Promise<PlanetDocument>;
  recordCave(brush: CaveBrush): void;
  recordDeposit(
    type: DepositType,
    index: number,
    remaining: number,
  ): void;
  recordPet(entity: PlanetEntity, options?: { schedule?: boolean }): void;
  getPetEntity(): PlanetEntity | null;
  recordPlayer(entity: PlanetEntity, options?: { schedule?: boolean }): void;
  getPlayerEntity(): PlanetEntity | null;
  recordParkedShip(
    entity: PlanetEntity,
    options?: { schedule?: boolean },
  ): void;
  getParkedShipEntity(): PlanetEntity | null;
  recordRovers(
    entities: readonly PlanetEntity[],
    options?: { schedule?: boolean },
  ): void;
  getRoverEntities(): PlanetEntity[];
  flush(): Promise<void>;
  /**
   * Stop auto-saves after leaving a planet (e.g. launch to space). Caller must
   * flush first while live capture sources are still available.
   */
  suspend(): void;
  /** Reactivate the in-memory document when a fallible replacement aborts. */
  resume(): void;
}

export interface PlanetStore {
  get(seedHex: string): Promise<PlanetDocument | null>;
  getAll(): Promise<PlanetDocument[]>;
  put(document: PlanetDocument): Promise<void>;
  isAvailable(): boolean;
}

export function seedToHex(seed: number): string {
  return (seed >>> 0).toString(16).toUpperCase().padStart(8, "0");
}

export function hexToSeed(hex: string): number | null {
  const text = hex.trim().toUpperCase();
  if (!/^[0-9A-F]{1,8}$/.test(text)) return null;
  return Number.parseInt(text, 16) >>> 0;
}

export function createEmptyPlanetDocument(seedHex: string): PlanetDocument {
  return sealPlanetDocument({
    v: PLANET_SAVE_VERSION,
    seed: seedHex,
    checksum: "",
    contentRevision: WORLD_CONTENT_REVISION,
    entities: [],
  });
}

/** FNV-1a over the document body excluding checksum. */
export function checksumPlanetDocument(
  document: Omit<PlanetDocument, "checksum"> & { checksum?: string },
): string {
  const { checksum: _ignored, ...body } = document;
  const payload = JSON.stringify(body);
  let hash = 0x811c9dc5;
  for (let index = 0; index < payload.length; index += 1) {
    hash ^= payload.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).toUpperCase().padStart(8, "0");
}

export function sealPlanetDocument(
  document: Omit<PlanetDocument, "checksum"> & { checksum?: string },
): PlanetDocument {
  const sealed: PlanetDocument = {
    v: PLANET_SAVE_VERSION,
    seed: document.seed,
    checksum: "",
    contentRevision: document.contentRevision,
    entities: document.entities,
  };
  if (document.terrain !== undefined) {
    // A packed patch whose heights were merged in place is re-encoded here
    // so the persisted base64 and the checksum always match the terrain.
    sealed.terrain = refreshPackedTerrain(document.terrain);
  }
  if (document.caves !== undefined) {
    sealed.caves = refreshCavePatch(document.caves);
  }
  if (document.deposits !== undefined) {
    sealed.deposits = document.deposits;
  }
  sealed.checksum = checksumPlanetDocument(sealed);
  return sealed;
}

function refreshPackedTerrain(patch: TerrainPatch): TerrainPatch {
  if (patch.kind !== "packed" || patch.heights === undefined) return patch;
  return {
    kind: "packed",
    encoding: "f32le-b64",
    data: packHeights(patch.heights),
  };
}

function refreshCavePatch(patch: CavePatch): CavePatch {
  if (patch.brushes === undefined) return patch;
  return {
    kind: "capsule-brushes",
    encoding: "i16le-20-b64",
    data: bytesToBase64(encodeCaveBrushes(patch.brushes)),
  };
}

export function parsePlanetDocument(raw: unknown): PlanetDocument | null {
  if (!isRecord(raw)) return null;
  if (raw.v !== 1 && raw.v !== PLANET_SAVE_VERSION) return null;
  const version = raw.v;
  if (version === 1 && raw.caves !== undefined) return null;
  if (typeof raw.seed !== "string" || hexToSeed(raw.seed) === null) {
    return null;
  }
  if (typeof raw.checksum !== "string") return null;
  if (!Array.isArray(raw.entities)) return null;
  if (
    typeof raw.contentRevision !== "number" ||
    !Number.isFinite(raw.contentRevision)
  ) {
    return null;
  }

  const normalizedSeed = raw.seed.toUpperCase().padStart(8, "0");
  const entities = raw.entities as PlanetEntity[];

  let terrain: TerrainPatch | undefined;
  if (raw.terrain !== undefined) {
    const parsed = parseTerrainPatch(raw.terrain);
    if (parsed === null) return null;
    terrain = parsed;
  }

  let caves: CavePatch | undefined;
  if (version === PLANET_SAVE_VERSION && raw.caves !== undefined) {
    const parsed = parseCavePatch(raw.caves);
    if (parsed === null) return null;
    caves = parsed;
  }

  let deposits: PlanetDocument["deposits"];
  if (raw.deposits !== undefined) {
    const parsed = parseDeposits(raw.deposits);
    if (parsed === null) return null;
    deposits = parsed;
  }

  const candidate: PlanetDocument = {
    v: version,
    seed: normalizedSeed,
    checksum: raw.checksum,
    contentRevision: raw.contentRevision,
    entities,
    ...(terrain !== undefined ? { terrain } : {}),
    ...(caves !== undefined ? { caves } : {}),
    ...(deposits !== undefined ? { deposits } : {}),
  };

  const expected = checksumPlanetDocument({
    v: version,
    seed: normalizedSeed,
    contentRevision: raw.contentRevision,
    entities,
    ...(terrain !== undefined ? { terrain } : {}),
    ...(caves !== undefined ? { caves } : {}),
    ...(deposits !== undefined ? { deposits } : {}),
  });
  if (expected !== raw.checksum) return null;
  if (version === PLANET_SAVE_VERSION) return candidate;

  // Version 1 had no cave volume. Resealing explicitly migrates its verified
  // height/deposit/entity patch without changing any procedural state.
  return sealPlanetDocument({
    ...candidate,
    v: PLANET_SAVE_VERSION,
    checksum: "",
  });
}

export function packHeights(heights: ArrayLike<number>): string {
  const bytes = new Uint8Array(heights.length * 4);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < heights.length; index += 1) {
    view.setFloat32(index * 4, heights[index]!, true);
  }
  return bytesToBase64(bytes);
}

export function unpackHeights(data: string): Float32Array | null {
  try {
    const bytes = base64ToBytes(data);
    if (bytes.length !== VERTEX_COUNT * 4) return null;
    const view = new DataView(
      bytes.buffer,
      bytes.byteOffset,
      bytes.byteLength,
    );
    const heights = new Float32Array(VERTEX_COUNT);
    for (let index = 0; index < VERTEX_COUNT; index += 1) {
      heights[index] = view.getFloat32(index * 4, true);
    }
    return heights;
  } catch {
    return null;
  }
}

export function terrainHeightsArray(
  patch: TerrainPatch,
): Float32Array | null {
  switch (patch.kind) {
    case "sparse":
      return null;
    case "packed": {
      if (patch.encoding !== "f32le-b64") return null;
      if (patch.heights !== undefined) return patch.heights;
      return unpackHeights(patch.data);
    }
    default: {
      const exhaustive: never = patch;
      void exhaustive;
      return null;
    }
  }
}

export function caveBrushesArray(patch: CavePatch): CaveBrush[] | null {
  if (patch.brushes !== undefined) return patch.brushes;
  if (
    patch.kind !== "capsule-brushes" ||
    patch.encoding !== "i16le-20-b64"
  ) {
    return null;
  }
  try {
    return decodeCaveBrushes(base64ToBytes(patch.data));
  } catch {
    return null;
  }
}

export function mergeCaveBrush(
  document: PlanetDocument,
  brush: CaveBrush,
): void {
  if (!isValidCaveBrush(brush)) return;
  const brushes =
    document.caves === undefined
      ? []
      : caveBrushesArray(document.caves);
  if (brushes === null) return;
  appendCaveBrush(brushes, brush);
  document.caves = {
    kind: "capsule-brushes",
    encoding: "i16le-20-b64",
    data: document.caves?.data ?? "",
    brushes,
  };
}

export function mergeTerrainSamples(
  document: PlanetDocument,
  samples: ReadonlyArray<TerrainHeightSample>,
): void {
  if (samples.length === 0) return;

  if (document.terrain?.kind === "packed") {
    // Patch the packed snapshot in place; the base64 is re-encoded once per
    // flush rather than on every crater batch.
    const heights = terrainHeightsArray(document.terrain);
    if (heights === null) return;
    for (const sample of samples) {
      if (sample.index < 0 || sample.index >= heights.length) continue;
      heights[sample.index] = sample.height;
    }
    document.terrain = {
      kind: "packed",
      encoding: "f32le-b64",
      data: document.terrain.data,
      heights,
    };
    return;
  }

  const cellMap = new Map<number, number>();
  if (document.terrain?.kind === "sparse") {
    for (const [index, height] of document.terrain.cells) {
      cellMap.set(index, height);
    }
  }

  for (const sample of samples) {
    if (sample.index < 0 || sample.index >= VERTEX_COUNT) continue;
    cellMap.set(sample.index, sample.height);
  }

  document.terrain = {
    kind: "sparse",
    cells: [...cellMap.entries()].map(
      ([index, height]) => [index, height] as const,
    ),
  };
}

/** Replace sparse terrain with a packed height snapshot from the live world. */
export function setFullTerrainFromHeights(
  document: PlanetDocument,
  heights: ArrayLike<number>,
): void {
  const snapshot =
    heights instanceof Float32Array ? heights : Float32Array.from(heights);
  // `data` is a placeholder. seal re-encodes it from `heights` before writing.
  document.terrain = {
    kind: "packed",
    encoding: "f32le-b64",
    data: "",
    heights: snapshot,
  };
}

export function shouldCompactTerrain(document: PlanetDocument): boolean {
  if (document.terrain?.kind !== "sparse") return false;
  return document.terrain.cells.length >= VERTEX_COUNT * TERRAIN_COMPACT_RATIO;
}

export function recordDepositRemaining(
  document: PlanetDocument,
  type: DepositType,
  id: string,
  remaining: number,
): void {
  const deposits = document.deposits ?? {};
  const previous = deposits[type] ?? [];
  const list: DepositPatchEntry[] = [];
  let replaced = false;
  for (const entry of previous) {
    if (entry.id === id) {
      list.push({ id, remaining });
      replaced = true;
    } else {
      list.push(entry);
    }
  }
  if (!replaced) list.push({ id, remaining });
  list.sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
  );
  deposits[type] = list;
  document.deposits = deposits;
}

export function createPlanetStore(): PlanetStore {
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

  async function get(seedHex: string): Promise<PlanetDocument | null> {
    if (!isAvailable()) return null;
    try {
      const database = await openDb();
      try {
        const raw = await idbRequest<unknown>(
          database
            .transaction(PLANETS_STORE, "readonly")
            .objectStore(PLANETS_STORE)
            .get(seedHex),
        );
        return parsePlanetDocument(raw);
      } finally {
        database.close();
      }
    } catch {
      return null;
    }
  }

  async function getAll(): Promise<PlanetDocument[]> {
    if (!isAvailable()) return [];
    try {
      const database = await openDb();
      try {
        const raw = await idbRequest<unknown[]>(
          database
            .transaction(PLANETS_STORE, "readonly")
            .objectStore(PLANETS_STORE)
            .getAll(),
        );
        const planets: PlanetDocument[] = [];
        for (const entry of raw) {
          const parsed = parsePlanetDocument(entry);
          if (parsed !== null) planets.push(parsed);
        }
        planets.sort((left, right) =>
          left.seed < right.seed ? -1 : left.seed > right.seed ? 1 : 0,
        );
        return planets;
      } finally {
        database.close();
      }
    } catch {
      return [];
    }
  }

  async function put(document: PlanetDocument): Promise<void> {
    if (!isAvailable()) return;
    const sealed = sealPlanetDocument(document);
    const database = await openDb();
    try {
      await idbRequest(
        database
          .transaction(PLANETS_STORE, "readwrite")
          .objectStore(PLANETS_STORE)
          .put(sealed),
      );
    } finally {
      database.close();
    }
  }

  return { get, getAll, put, isAvailable };
}

export function createPlanetSession(options: {
  worldSystem: WorldSystem;
  store?: PlanetStore;
  onStorageWarning?: (message: string) => void;
  /** Snapshot live player / ship into the active document before every write. */
  onBeforeFlush?: () => void;
}): PlanetSession {
  const store = options.store ?? createPlanetStore();
  let active = createEmptyPlanetDocument("00000000");
  let hasActivePlanet = false;
  let saveTimer: number | null = null;
  let writeChain: Promise<void> = Promise.resolve();
  let warnedMissingStore = false;

  function warnOnce(message: string): void {
    if (warnedMissingStore) return;
    warnedMissingStore = true;
    options.onStorageWarning?.(message);
  }

  function scheduleSave(): void {
    if (!hasActivePlanet) return;
    if (saveTimer !== null) window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      saveTimer = null;
      void flush();
    }, SAVE_DEBOUNCE_MS);
  }

  async function flush(): Promise<void> {
    if (!hasActivePlanet) return;
    if (saveTimer !== null) {
      window.clearTimeout(saveTimer);
      saveTimer = null;
    }

    // Serialize capture → seal → put so overlapping hide/save callers cannot
    // drop a write by racing the writeChain assignment.
    writeChain = writeChain.then(async () => {
      if (!hasActivePlanet) return;

      options.onBeforeFlush?.();

      const world = options.worldSystem.current;
      if (world !== null && shouldCompactTerrain(active)) {
        setFullTerrainFromHeights(active, world.heights);
      }
      active.contentRevision = WORLD_CONTENT_REVISION;

      const sealed = sealPlanetDocument(active);
      active = sealed;

      try {
        if (!store.isAvailable()) {
          warnOnce(
            "Auto-save unavailable here — use SAVE GAME for a portable backup.",
          );
          return;
        }
        await store.put(sealed);
      } catch {
        warnOnce(
          "Could not write planet auto-save. Use SAVE GAME for a backup.",
        );
      }
    });
    await writeChain;
  }

  async function open(
    seed: number,
    openOptions: { skipFlush?: boolean } = {},
  ): Promise<PlanetDocument> {
    if (openOptions.skipFlush !== true) {
      await flush();
    } else if (saveTimer !== null) {
      window.clearTimeout(saveTimer);
      saveTimer = null;
    }
    const seedHex = seedToHex(seed);
    const stored = await store.get(seedHex);
    active = stored ?? createEmptyPlanetDocument(seedHex);
    hasActivePlanet = true;

    await options.worldSystem.build(seed);
    await options.worldSystem.applyPlanetPatch(active);
    return active;
  }

  function recordCave(brush: CaveBrush): void {
    if (!hasActivePlanet) return;
    mergeCaveBrush(active, brush);
    scheduleSave();
  }

  function recordDeposit(
    type: DepositType,
    index: number,
    remaining: number,
  ): void {
    if (!hasActivePlanet) return;
    const world = options.worldSystem.current;
    const entry = world?.deposits[type].list[index];
    if (entry === undefined) return;
    recordDepositRemaining(active, type, entry.id, remaining);
    scheduleSave();
  }

  function recordPet(
    entity: PlanetEntity,
    writeOptions: { schedule?: boolean } = {},
  ): void {
    if (!hasActivePlanet) return;
    upsertPetEntity(active, entity);
    if (writeOptions.schedule !== false) scheduleSave();
  }

  function getPetEntity(): PlanetEntity | null {
    return findPlanetEntity(active, "pet");
  }

  function recordPlayer(
    entity: PlanetEntity,
    writeOptions: { schedule?: boolean } = {},
  ): void {
    if (!hasActivePlanet) return;
    upsertPlayerEntity(active, entity);
    if (writeOptions.schedule !== false) scheduleSave();
  }

  function getPlayerEntity(): PlanetEntity | null {
    return findPlayerEntity(active);
  }

  function recordParkedShip(
    entity: PlanetEntity,
    writeOptions: { schedule?: boolean } = {},
  ): void {
    if (!hasActivePlanet) return;
    upsertParkedShipEntity(active, entity);
    if (writeOptions.schedule !== false) scheduleSave();
  }

  function getParkedShipEntity(): PlanetEntity | null {
    return findParkedShipEntity(active);
  }

  function recordRovers(
    entities: readonly PlanetEntity[],
    writeOptions: { schedule?: boolean } = {},
  ): void {
    if (!hasActivePlanet) return;
    active.entities = active.entities.filter(
      (entry) => entry.kind !== "rover",
    );
    for (const entity of entities) {
      upsertPlanetEntity(active, entity);
    }
    if (writeOptions.schedule !== false) scheduleSave();
  }

  function getRoverEntities(): PlanetEntity[] {
    return active.entities.filter((entry) => entry.kind === "rover");
  }

  function suspend(): void {
    if (saveTimer !== null) {
      window.clearTimeout(saveTimer);
      saveTimer = null;
    }
    hasActivePlanet = false;
  }

  function resume(): void {
    hasActivePlanet = true;
  }

  return {
    get seedHex() {
      return active.seed;
    },
    open,
    recordCave,
    recordDeposit,
    recordPet,
    getPetEntity,
    recordPlayer,
    getPlayerEntity,
    recordParkedShip,
    getParkedShipEntity,
    recordRovers,
    getRoverEntities,
    flush,
    suspend,
    resume,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseTerrainPatch(raw: unknown): TerrainPatch | null {
  if (!isRecord(raw) || typeof raw.kind !== "string") return null;

  if (raw.kind === "sparse") {
    if (!Array.isArray(raw.cells)) return null;
    const cells: Array<readonly [number, number]> = [];
    for (const entry of raw.cells) {
      if (!Array.isArray(entry) || entry.length < 2) return null;
      const index = entry[0];
      const height = entry[1];
      if (typeof index !== "number" || typeof height !== "number") {
        return null;
      }
      if (!Number.isFinite(index) || !Number.isFinite(height)) return null;
      cells.push([index, height]);
    }
    return { kind: "sparse", cells };
  }

  if (raw.kind === "packed") {
    if (raw.encoding !== "f32le-b64" || typeof raw.data !== "string") {
      return null;
    }
    if (unpackHeights(raw.data) === null) return null;
    return { kind: "packed", encoding: "f32le-b64", data: raw.data };
  }

  return null;
}

function parseCavePatch(raw: unknown): CavePatch | null {
  if (!isRecord(raw)) return null;
  if (
    raw.kind !== "capsule-brushes" ||
    raw.encoding !== "i16le-20-b64" ||
    typeof raw.data !== "string"
  ) {
    return null;
  }
  try {
    if (decodeCaveBrushes(base64ToBytes(raw.data)) === null) return null;
  } catch {
    return null;
  }
  return {
    kind: "capsule-brushes",
    encoding: "i16le-20-b64",
    data: raw.data,
  };
}

function parseDeposits(
  raw: unknown,
): NonNullable<PlanetDocument["deposits"]> | null {
  if (!isRecord(raw)) return null;
  const deposits: NonNullable<PlanetDocument["deposits"]> = {};

  for (const type of DEPOSIT_TYPES) {
    const list = raw[type];
    if (list === undefined) continue;
    if (!Array.isArray(list)) return null;
    const parsed: DepositPatchEntry[] = [];
    for (const entry of list) {
      if (!isRecord(entry)) return null;
      if (
        typeof entry.remaining !== "number" ||
        !Number.isFinite(entry.remaining)
      ) {
        return null;
      }
      if (typeof entry.id !== "string" || entry.id.length === 0) return null;
      parsed.push({ id: entry.id, remaining: entry.remaining });
    }
    deposits[type] = parsed;
  }

  return deposits;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]!);
  }
  return btoa(binary);
}

function base64ToBytes(data: string): Uint8Array {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
