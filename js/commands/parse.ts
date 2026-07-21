/**
 * Split a typed command line into a lowercase name and argument tokens.
 * Leading `/` is optional so `/travel` and `travel` parse the same way.
 */

export interface ParsedCommand {
  name: string;
  args: string[];
}

export function parseCommandLine(line: string): ParsedCommand | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;

  const parts = trimmed.split(/\s+/);
  const rawName = parts[0];
  if (rawName === undefined) return null;

  const name = (
    rawName.startsWith("/") ? rawName.slice(1) : rawName
  ).toLowerCase();
  if (name.length === 0) return null;

  return { name, args: parts.slice(1) };
}
