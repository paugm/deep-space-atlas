#!/usr/bin/env node
/**
 * Rebuild assets/creatures/quaternius-cute-monsters/*.glb from the upstream
 * Quaternius / OpenGameArt zip (FBX + Textures/).
 *
 * Prerequisites:
 *   - FBX2glTF on PATH, or pass --fbx2gltf /path/to/FBX2glTF
 *     (npm package `fbx2gltf` ships Darwin/Linux/Windows binaries)
 *   - npm install @gltf-transform/core @gltf-transform/extensions
 *     (dev-only; not required for the game itself)
 *
 * Usage:
 *   node tools/convert-quaternius-cute-monsters.mjs \
 *     /path/to/Cute\ Animated\ Monsters\ -\ Aug\ 2020 \
 *     [--out assets/creatures/quaternius-cute-monsters] \
 *     [--fbx2gltf /path/to/FBX2glTF]
 *
 * Upstream (CC0): https://quaternius.com/packs/cutemonsters.html
 * Credit: CREDITS.md
 */

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

/** Idle-only or flying-only upstream species the game does not ship. */
const SKIP_SOURCE_NAMES = new Set([
  "Bat",
  "Bee",
  "Chicken",
  "Cthulhu",
  "Mushroom",
  "Penguin",
  "Pig",
  "YellowDragon",
]);

function parseArgs(argv) {
  const args = { src: null, out: null, fbx2gltf: "FBX2glTF" };
  const rest = [...argv];
  while (rest.length) {
    const token = rest.shift();
    if (token === "--out") args.out = rest.shift();
    else if (token === "--fbx2gltf") args.fbx2gltf = rest.shift();
    else if (token && !token.startsWith("-") && !args.src) args.src = token;
    else {
      console.error("Unknown argument:", token);
      process.exit(1);
    }
  }
  if (!args.src) {
    console.error("Usage: node tools/convert-quaternius-cute-monsters.mjs <extracted-pack-dir>");
    process.exit(1);
  }
  args.src = resolve(args.src);
  args.out = resolve(args.out ?? join(repoRoot, "assets/creatures/quaternius-cute-monsters"));
  return args;
}

function loadGltfTransform() {
  try {
    return {
      NodeIO: require("@gltf-transform/core").NodeIO,
      ALL_EXTENSIONS: require("@gltf-transform/extensions").ALL_EXTENSIONS,
    };
  } catch {
    console.error(
      "Missing @gltf-transform/core and @gltf-transform/extensions.\n" +
        "Install them temporarily: npm install -D @gltf-transform/core @gltf-transform/extensions",
    );
    process.exit(1);
  }
}

function toId(sourceName) {
  return sourceName
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .replace(/_/g, "-")
    .toLowerCase();
}

const args = parseArgs(process.argv.slice(2));
const fbxDir = join(args.src, "FBX");
const texDir = join(args.src, "Textures");
if (!existsSync(fbxDir) || !existsSync(texDir)) {
  console.error("Expected FBX/ and Textures/ under", args.src);
  process.exit(1);
}

const probe = spawnSync(args.fbx2gltf, ["--version"], { encoding: "utf8" });
if (probe.error || probe.status !== 0) {
  console.error("FBX2glTF not runnable as:", args.fbx2gltf);
  process.exit(1);
}

const { NodeIO, ALL_EXTENSIONS } = loadGltfTransform();
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
mkdirSync(args.out, { recursive: true });
const tmpDir = join(args.out, ".tmp-convert");
mkdirSync(tmpDir, { recursive: true });

const species = readdirSync(fbxDir)
  .filter((name) => name.endsWith(".fbx"))
  .map((name) => basename(name, ".fbx"))
  .filter((sourceName) => !SKIP_SOURCE_NAMES.has(sourceName))
  .sort();

const manifest = [];

for (const sourceName of species) {
  const fbx = join(fbxDir, `${sourceName}.fbx`);
  const tex = join(texDir, `${sourceName}_Texture.png`);
  if (!existsSync(tex)) {
    console.error("Missing texture:", tex);
    process.exit(1);
  }

  const tmpBase = join(tmpDir, sourceName);
  const converted = spawnSync(
    args.fbx2gltf,
    ["--binary", "-i", fbx, "-o", tmpBase],
    { encoding: "utf8" },
  );
  if (converted.status !== 0) {
    console.error(converted.stderr || converted.stdout);
    process.exit(1);
  }

  const document = await io.read(`${tmpBase}.glb`);
  const texture = document
    .createTexture(`${sourceName}_Texture`)
    .setMimeType("image/png")
    .setImage(readFileSync(tex));

  for (const material of document.getRoot().listMaterials()) {
    material.setBaseColorTexture(texture);
    material.setMetallicFactor(0);
    material.setRoughnessFactor(0.85);
  }

  const id = toId(sourceName);
  const file = `${id}.glb`;
  const outPath = join(args.out, file);
  await io.write(outPath, document);

  const animations = document
    .getRoot()
    .listAnimations()
    .map((clip) => clip.getName().replace(/^MonsterArmature\|/, ""));
  const bytes = readFileSync(outPath).byteLength;
  console.log(`${file}  ${bytes} B  [${animations.join(", ")}]`);
  manifest.push({ id, sourceName, file, animations, bytes });
}

writeFileSync(join(args.out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log("Wrote", manifest.length, "GLBs + manifest.json →", args.out);
