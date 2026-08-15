# Credits

Third-party assets used by Deep Space Atlas. Game code is MIT (see
[`LICENSE`](LICENSE)). Update this file when media is added or replaced.

Several packs below are CC0. Attribution is not required for those, but I still
want to credit the people who made them.

---

## Cute Animated Monsters Pack

| | |
| --- | --- |
| **Author** | [Quaternius](https://quaternius.com/) |
| **Pack** | [Cute Animated Monsters Pack](https://quaternius.com/packs/cutemonsters.html) |
| **Mirror** | [Textured Cute Monster Pack on OpenGameArt](https://opengameart.org/content/textured-cute-monster-pack) |
| **License** | [CC0 1.0 Universal (Public Domain Dedication)](https://creativecommons.org/publicdomain/zero/1.0/) |
| **Used as** | Creature meshes under `assets/creatures/quaternius-cute-monsters/` |

Quaternius makes this pack available for personal and commercial use, and
OpenGameArt lists the upload under CC0.

Support the author: [Patreon](https://www.patreon.com/quaternius).

### Included files

The runtime files are self-contained `.glb` models with their mesh, skin,
animations, and albedo texture embedded. They came from the upstream FBX + PNG
pack and were converted for Three.js. See
`assets/creatures/quaternius-cute-monsters/README.md`.

This repository does not include the original Blender (`.blend`) sources or
duplicate OBJ/FBX copies. Only walker species used by the game are kept here
(Idle-only and flying-only upstream exports are omitted).

---

## Ultimate Space Kit (rovers)

| | |
| --- | --- |
| **Author** | [Quaternius](https://quaternius.com/) |
| **Pack** | [Ultimate Space Kit](https://quaternius.com/packs/ultimatespacekit.html) |
| **Models** | [Rover](https://poly.pizza/m/tzOLXetacM), [Round Rover](https://poly.pizza/m/ejdkcNgMpr), [Rover (variant)](https://poly.pizza/m/WRd1piJOfh) |
| **License** | [CC0 1.0 Universal (Public Domain Dedication)](https://creativecommons.org/publicdomain/zero/1.0/) |
| **Used as** | Wheeled planet vehicles under `assets/vehicles/quaternius-ultimate-space-kit/` |

Quaternius makes this pack available for personal and commercial use.

Support the author: [Patreon](https://www.patreon.com/quaternius).

### Included files

The runtime files are three self-contained `.glb` models downloaded from Poly
Pizza's Ultimate Space Kit exports. See
`assets/vehicles/quaternius-ultimate-space-kit/README.md`.

The rest of the Ultimate Space Kit and the original Blender / FBX sources are
not included.

---

## Spaceship by Liz Reddington

| | |
| --- | --- |
| **Author** | Liz Reddington |
| **Model** | [Spaceship on Poly Pizza](https://poly.pizza/m/6eRDOiTxvOo) |
| **License** | [Creative Commons Attribution (CC BY)](https://creativecommons.org/licenses/by/3.0/) |
| **Used as** | The survey vessel parked at spawn (board target for space travel), under `assets/ships/liz-reddington-spaceship/spaceship.glb` |

CC BY needs attribution, so leave this credit (and the README mention) in place
while the model ships with the game. The GLB is used as-is aside from runtime
scaling and placement.

---

## threejs-psx-shader (vendored)

| | |
| --- | --- |
| **Author** | [lferreira457](https://github.com/lferreira457) |
| **Project** | [threejs-psx-shader](https://github.com/lferreira457/threejs-psx-shader) |
| **License** | [MIT](https://github.com/lferreira457/threejs-psx-shader/blob/main/LICENSE) |
| **Used as** | Pixelation + CRT GLSL under `js/crt/` (wired by `js/crt.ts`) |

The upstream package still says "PSX" in its name. In this game we call the
look a CRT pipeline. Only the two effects we use are vendored; it is not an
npm dependency.

---

## Tone.js

| | |
| --- | --- |
| **Author** | [Yotam Mann](https://github.com/tambien) and contributors |
| **Project** | [Tone.js](https://tonejs.github.io/) |
| **License** | [MIT](https://github.com/Tonejs/Tone.js/blob/dev/LICENSE.md) |
| **Used as** | Seeded planet radio (`js/planet-radio-player.ts`) |

---

## Kenney audio packs

| | |
| --- | --- |
| **Author** | [Kenney](https://kenney.nl) ([@KenneyNL](https://twitter.com/KenneyNL)) |
| **Packs** | [Sci-fi Sounds](https://kenney.nl/assets/sci-fi-sounds), [Interface Sounds](https://kenney.nl/assets/interface-sounds), [Digital Audio](https://kenney.nl/assets/digital-audio), [Impact Sounds](https://kenney.nl/assets/impact-sounds), [Music Jingles](https://kenney.nl/assets/music-jingles) |
| **License** | [CC0 1.0 Universal (Public Domain Dedication)](https://creativecommons.org/publicdomain/zero/1.0/) |
| **Used as** | Curated `.ogg` one-shots and loops under `assets/audio/kenney/` (engines, thrusters, doors, UI, footsteps, mining hits, digital chimes, short jingles) |

Kenney makes these packs available for personal and commercial use.

Support the author: [Donate](https://kenney.nl/donate) · [Patreon](https://www.patreon.com/kenney).

### Included files

Only the subset the game loads is committed. See
`assets/audio/README.md` and `js/audio-catalog.ts` for the runtime map.

---

## rubberduck CC0 sci-fi + creature SFX

| | |
| --- | --- |
| **Author** | [rubberduck](https://opengameart.org/users/rubberduck) |
| **Packs** | [60 CC0 Sci-Fi SFX](https://opengameart.org/content/60-cc0-sci-fi-sfx), [80 CC0 creature SFX](https://opengameart.org/content/80-cc0-creature-sfx) |
| **License** | [CC0 1.0 Universal (Public Domain Dedication)](https://creativecommons.org/publicdomain/zero/1.0/) |
| **Used as** | Deep ambient / warp whoosh / terminal hum under `assets/audio/rubberduck/sci-fi/`; pet chirps, alien squeaks, and underwater burbles under `assets/audio/rubberduck/creatures/` |

OpenGameArt lists both uploads as CC0.

### Included files

The game includes renamed, selected files only: `ambient_deep.ogg`,
`warp_whoosh.ogg`, `terminal_hum.ogg`, and selected `cute_*`, `alien_*`,
`burble_*`, and `bug_*` clips. The full upstream zips are not included.

---

## Procedural / synthesized content

Terrain, rocks, flora, deposit meshes, planet proxies, the space cockpit,
canvas textures, and inventory icons are original to Deep Space Atlas.
Gameplay SFX and ambient beds use the third-party packs above.
