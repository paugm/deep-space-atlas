/**
 * Portable campaign save: one `.deepspaceatlas` file holds the player profile
 * and every surveyed planet patch. IndexedDB remains the live autosave vault;
 * SAVE GAME / LOAD GAME copy that vault to and from disk (load replaces).
 */

import type { PlanetDocument, PlanetStore } from "./planet-save.ts";
import {
  hexToSeed,
  parsePlanetDocument,
  sealPlanetDocument,
} from "./planet-save.ts";
import type { PlayerProfile } from "./player-profile.ts";
import {
  parsePlayerProfile,
  sealPlayerProfile,
} from "./player-profile.ts";
import { replaceCampaignData } from "./save-db.ts";

export const GAME_SAVE_VERSION = 2;
export const GAME_FILE_EXTENSION = "deepspaceatlas";

export interface GameDocument {
  v: number;
  savedAt: number;
  lastSeed: string;
  profile: PlayerProfile;
  planets: PlanetDocument[];
  checksum: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** FNV-1a over the document body excluding checksum. */
export function checksumGameDocument(
  document: Omit<GameDocument, "checksum"> & { checksum?: string },
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

export function sealGameDocument(
  document: Omit<GameDocument, "checksum"> & { checksum?: string },
): GameDocument {
  const planets = document.planets
    .map((planet) => sealPlanetDocument(planet))
    .sort((left, right) =>
      left.seed < right.seed ? -1 : left.seed > right.seed ? 1 : 0,
    );
  const sealed: GameDocument = {
    v: GAME_SAVE_VERSION,
    savedAt: Math.floor(document.savedAt),
    lastSeed: document.lastSeed.toUpperCase().padStart(8, "0"),
    profile: sealPlayerProfile(document.profile),
    planets,
    checksum: "",
  };
  sealed.checksum = checksumGameDocument(sealed);
  return sealed;
}

export function parseGameDocument(raw: unknown): GameDocument | null {
  if (!isRecord(raw)) return null;
  if (raw.v !== 1 && raw.v !== GAME_SAVE_VERSION) return null;
  const version = raw.v;
  if (typeof raw.checksum !== "string") return null;
  if (typeof raw.savedAt !== "number" || !Number.isFinite(raw.savedAt)) {
    return null;
  }
  if (typeof raw.lastSeed !== "string" || hexToSeed(raw.lastSeed) === null) {
    return null;
  }
  if (!Array.isArray(raw.planets)) return null;

  const profile = parsePlayerProfile(raw.profile);
  if (profile === null) return null;

  const planets: PlanetDocument[] = [];
  const seen = new Set<string>();
  for (const entry of raw.planets) {
    const planet = parsePlanetDocument(entry);
    if (planet === null) return null;
    if (seen.has(planet.seed)) return null;
    seen.add(planet.seed);
    planets.push(planet);
  }
  planets.sort((left, right) =>
    left.seed < right.seed ? -1 : left.seed > right.seed ? 1 : 0,
  );

  const lastSeed = raw.lastSeed.toUpperCase().padStart(8, "0");
  const candidate: GameDocument = {
    v: version,
    savedAt: Math.floor(raw.savedAt),
    lastSeed,
    profile,
    planets,
    checksum: raw.checksum,
  };

  const expected =
    version === 1
      ? checksumGameDocument({
          v: 1,
          savedAt: candidate.savedAt,
          lastSeed: candidate.lastSeed,
          profile: raw.profile as PlayerProfile,
          planets: raw.planets as PlanetDocument[],
        })
      : checksumGameDocument({
          v: candidate.v,
          savedAt: candidate.savedAt,
          lastSeed: candidate.lastSeed,
          profile: candidate.profile,
          planets: candidate.planets,
        });
  if (expected !== raw.checksum) return null;
  if (version === GAME_SAVE_VERSION) return candidate;
  return sealGameDocument({
    ...candidate,
    v: GAME_SAVE_VERSION,
    checksum: "",
  });
}

export function downloadGameFile(document: GameDocument): void {
  const sealed = sealGameDocument(document);
  const json = `${JSON.stringify(sealed)}\n`;
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = globalThis.document.createElement("a");
  anchor.href = url;
  const stamp = new Date(sealed.savedAt)
    .toISOString()
    .slice(0, 10)
    .replaceAll("-", "");
  anchor.download = `atlas-${stamp}.${GAME_FILE_EXTENSION}`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function readGameFile(file: File): Promise<GameDocument> {
  const text = await file.text();
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    throw new Error("Game file is not valid JSON.");
  }
  const document = parseGameDocument(raw);
  if (document === null) {
    throw new Error("Game file failed validation or checksum.");
  }
  return document;
}

export async function buildGameDocument(options: {
  lastSeed: string;
  profile: PlayerProfile;
  planetStore: PlanetStore;
}): Promise<GameDocument> {
  const planets = await options.planetStore.getAll();
  return sealGameDocument({
    v: GAME_SAVE_VERSION,
    savedAt: Date.now(),
    lastSeed: options.lastSeed,
    profile: options.profile,
    planets,
  });
}

/** Wipe IndexedDB campaign data and install the loaded document. */
export async function installGameDocument(options: {
  document: GameDocument;
}): Promise<void> {
  const sealed = sealGameDocument(options.document);
  await replaceCampaignData({
    planets: sealed.planets,
    profile: sealed.profile,
  });
}
