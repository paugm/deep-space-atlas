/**
 * Survey postcard filenames and captions. Canvas stamping stays in the UI.
 */

export function postcardCaption(name: string, seedHex: string): string {
  const planet = name.trim().toUpperCase() || "UNKNOWN";
  const seed = seedHex.trim().toUpperCase().padStart(8, "0");
  return `${planet}  ·  ${seed}`;
}

export function postcardFilename(seedHex: string, capturedAt: number): string {
  const seed = seedHex.trim().toUpperCase().padStart(8, "0");
  const stamp = Number.isFinite(capturedAt)
    ? new Date(capturedAt).toISOString().slice(0, 10).replaceAll("-", "")
    : "survey";
  return `atlas-${seed}-${stamp}.png`;
}

export function postcardShareText(name: string, seedHex: string): string {
  return `${postcardCaption(name, seedHex)}\n?seed=${seedHex.trim().toUpperCase().padStart(8, "0")}`;
}

export const POSTCARD_THUMB_MAX_CHARS = 80_000;
export const POSTCARD_MAX_COUNT = 12;
