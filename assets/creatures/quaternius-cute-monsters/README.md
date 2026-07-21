# Quaternius Cute Animated Monsters (runtime)

These `.glb` creatures power pets and fauna in Deep Space Atlas.

## License and credit

- **Author:** Quaternius
- **License:** CC0 1.0 (public domain dedication)
- **Upstream:** https://quaternius.com/packs/cutemonsters.html
- **Mirror:** https://opengameart.org/content/textured-cute-monster-pack

Full project credit lives in [`CREDITS.md`](../../../CREDITS.md).

## Layout

| Path | Role |
| --- | --- |
| `*.glb` | One file per creature: mesh, skeleton, animations, albedo |
| `manifest.json` | Stable ids, filenames, animation clip names, byte sizes |
| `README.md` | This file |

Filenames are kebab-case (`green-demon.glb`). `manifest.json` maps each id to
the upstream Quaternius name (`GreenDemon`).

Only walker species with `Idle` + `Walk` are kept (see `js/fauna/species.ts`).
Idle-only upstream exports and flying-only models are omitted from this tree.

## Regenerating from upstream

To rebuild the GLBs from a fresh Quaternius zip:

1. Download `cute_animated_monsters_-_aug_2020.zip` from OpenGameArt (or the
   Quaternius site).
2. Extract it and run `tools/convert-quaternius-cute-monsters.mjs`.
3. The converter skips Idle-only and flying-only species. Refresh
   `manifest.json` after a successful run.

## Runtime loading

`js/fauna/system.ts` loads GLBs with Three.js `GLTFLoader` + `AnimationMixer`.
Vite emits them as hashed files under `dist/assets/` in the production build.
