# Deep Space Atlas developer guide

This is the working reference for the game. The public GitHub page is
[`README.md`](../README.md); contributor notes are in
[`CONTRIBUTING.md`](../CONTRIBUTING.md), slash commands are in
[`commands.md`](commands.md), gear is in [`gear.md`](gear.md), and field
blueprints are in [`blueprints.md`](blueprints.md).

When you change architecture, modules, saves, world generation, or workflows,
update this file too. If a feature count changes, update the root README spec
sheet as well.

Deep Space Atlas is a procedural first-person mining and exploration game built
with HTML, CSS, TypeScript, Three.js, and Vite. A 32-bit seed determines the
terrain, planet class, resources, name, spawn point, and fixed galaxy position
used in space flight. Asset licenses live in [`CREDITS.md`](../CREDITS.md).

## Dev commands

```sh
npm install
npm run dev          # http://localhost:5173 (not file://)
npm test             # or npm run test:watch
npm run typecheck
npm run build        # typecheck + tests, then multi-file dist/
npm run preview      # serve dist/ over HTTP (not file://)
```

Use Node 20.19+ or 22.12+. TypeScript is strict (`tsconfig.json`), and switches
over gameplay unions use exhaustive `never` checks. See `package.json` for
versions.

### Hosted play (GitHub Pages)

Pushes to `main` run
[`.github/workflows/deploy-pages.yml`](../.github/workflows/deploy-pages.yml):
`npm ci`, then `npm run build`, then deployment of the `dist/` artifact. Vite
uses `base: "./"`, which works at the site root.

Play URL: [https://deepspaceatlas.net/](https://deepspaceatlas.net/)
(custom domain on GitHub Pages; `www` optional). DNS and Pages custom-domain
setup happen once the repo is public. A `?seed=` query (8-digit hex, same as
`/travel`) opens that planet on boot and stays in sync after travel, land,
launch, and new game. Campaign cargo still lives in IndexedDB.

## Architecture

### Who owns what

| Area | Entry | Owns |
| --- | --- | --- |
| Config | `js/config.ts` | Math, seeded RNG/noise, tuning, materials/deposits (no Three/DOM) |
| Planet class | `js/world/planet-class.ts` | Weighted class table, surface/lighting/deposit scales (pure) |
| World | `js/world.ts` → `js/world/` | Build, heightfield + sparse cave volume, aim, carve, apply planet patch |
| Space | `js/space/` | Galaxy math, flight, proxies, scan/land, land/launch cinematics, parked ship |
| Gameplay | `js/gameplay.ts` | Player motion, mining, input, cargo; callbacks for saves |
| Collision | `js/collision.ts` | Capsule vs static sphere/AABB resolve (no physics engine) |
| Water | `js/water.ts` | Immersion + underwater fog helpers (pure) |
| Player entity | `js/player-entity.ts` | Saved commander pose helpers for planet `entities[]` |
| Fauna | `js/fauna/` | Wild walkers, tame/follow, pet entities |
| Vehicles | `js/vehicles/` | Seeded rovers, board/drive, rover entities |
| Planet save | `js/planet-save.ts` | Per-seed patches in IndexedDB |
| Planet URL | `js/planet-url.ts` | `?seed=` parse / serialize (pure) |
| Profile | `js/player-profile.ts` | Callsign, cargo, playtime, audio mute, gear, visits |
| Gear | `js/gear.ts` | Permanent upgrade catalog, costs, stacked modifiers (pure) |
| Blueprints | `js/blueprints.ts` | Placeable structure recipes and fabricate cost (pure) |
| Structures | `js/structures/` | Beacons and other field builds: place, mesh, entities |
| Campaign file | `js/game-save.ts` | Portable `.deepspaceatlas` |
| DB | `js/save-db.ts` | Shared IndexedDB open (`planets` + `profile`) |
| UI | `js/ui.ts` | DOM only; callbacks to `main.ts` |
| Commands | `js/commands/` | Slash-command parse + registry; host wired in `main.ts` |
| Audio | `js/audio.ts` · `js/audio-catalog.ts` · `js/audio-rules.ts` | Sample-backed SFX; Kenney / rubberduck CC0 under `assets/audio/`; `Sound` singleton; mute (**M** / `/mute`) |
| CRT | `js/crt.ts` | Shared post pipeline for planet and space |
| Main | `js/main.ts` | App entry: mode switch, frame loop, wiring |
| Markup / CSS | `index.html`, `styles.css` | Static structure and presentation |

`world.ts` only re-exports. The main world modules are `generate.ts`,
`terrain.ts`, `target.ts` / `spatial-index.ts`, `caves.ts` (the pure field,
collision, and brush codec), `cave-runtime.ts` (streaming), and
`cave-mesh.ts` + `cave-worker.ts` (mesh extraction in a worker).
`deposit-id.ts`, `deposit-geometry.ts`, `present.ts`, and `textures.ts` round
out the world side. `textures.ts` also owns radial glow and
`createStarPositions`, shared by the planet and space starfields.

Space math lives in `galaxy.ts`, `metadata.ts`, `proxy-geometry.ts`,
`flight.ts`, and `cinematic-math.ts` (transition timing curves). `system.ts`
runs it. `cockpit.ts` supplies canopy meshes for flight and launch,
`ship-model.ts` loads the shared survey-vessel GLB, `launch-ascent.ts` runs the
cockpit takeoff camera ride, and `cinema.ts` draws the black-fade overlay.

### Dependency direction

```text
config.ts
  ├── js/cargo-cost.ts · js/gear.ts · js/blueprints.ts · js/world/* · gameplay.ts · collision.ts · water.ts
  ├── planet-save.ts · js/planet-url.ts · player-profile.ts · game-save.ts · ui.ts · js/commands/*

audio.ts (+ catalog / rules) ──> gameplay.ts / js/space/* / cinema.ts
world.ts ───────> gameplay.ts · js/space/*   (re-export / types)
js/gear.ts ──> gameplay.ts · player-profile.ts · ui.ts · js/commands/*
js/blueprints.ts · js/structures/* ──> gameplay.ts · planet-save.ts · ui.ts · js/commands/*

planet-save.ts ──(type)──> world.ts
js/world/* ──(type)──> planet-save.ts
save-db.ts / game-save.ts ──> planet-save.ts · player-profile.ts
js/commands/* ──> planet-save.ts (seed parse only) · gear.ts · blueprints.ts

main.ts wires world · gameplay · space · structures · saves · ui · commands
ui.ts <── callbacks ── main.ts
```

World and UI never import one another. The planet session reaches the world
through the injected `worldSystem`.

### Opening a world (`main.ts`)

Boot prefers `?seed=` (`js/planet-url.ts`) over the last visited planet, then
a random seed. CONTINUE / LOAD / NEW GAME stay disabled with “GENERATING
TERRAIN…” until `open` finishes.

1. Flush the previous planet save (capturing the live player, ship, and pet)
   and profile when active. Suspend the planet session when leaving for space.
2. Load patch for seed from IndexedDB
3. `await build(seed)`. The heightfield fills in row chunks that yield to the
   frame loop (`fillHeightField` is async); RNG draw order is unchanged, so
   generation stays seed-deterministic
4. `await applyPlanetPatch`: apply legacy height edits in yielded batches, then
   apply deposits, index saved cave brushes, and initialize the cave worker
   without building every saved cave mesh.
5. Sync fauna and the pet. Sync rovers from `entities[]` or the seeded
   `roverPlan`; sync field structures from `entities[]`; place the parked ship
   from `entities[]` or its default pad.
6. Reset player and mining. Restore the saved pose when present, then cargo
   from the profile.
7. Record the visit on the profile.
8. Send metadata to the HUD and write `?seed=` into the address bar.
9. If the pointer is already locked (CONTINUE during generate, or a landing
   hand-off), resume play; otherwise show the start overlay.

### Modes and frame loop

The game modes are `planet | space | landing | launch`. One mode simulates and
renders on the shared CRT renderer each frame. Input is gated by
`gameplay.setActive` and `spaceSystem.setActive`.

On `planet`, update gameplay, fauna and the nav compass (nearest structure,
else pet), rover driving, and day/night (using camera Y underwater). Then handle
the aim, mine, and board prompt before rendering the planet.

On `space` and `landing`, fly, stream proxies, scan, and render space. Landing
freezes the camera while the hull leaves in third person. On `launch`, the
cockpit ascent drives the planet camera skyward. Fauna still updates, but input
is locked. `paused` freezes the camera while the environmental cycle keeps
running.

Delta is capped at 50 ms. Both transitions cut through a black fade
(`cinema.ts`; space itself is black). Hold and fade timing curves live in
`js/space/cinematic-math.ts`.

- **Land:** `beginApproach` hides the cockpit and freezes the camera at the
  land/crash POV. A clone of the survey-vessel GLB (`ship-model.ts`) flies from
  just ahead of the camera toward the planet on an ease-in curve, then shrinks
  away near touchdown. The game fades to black, calls `open(seed)`, and puts
  the parked ship at spawn.
- **Board:** `startLaunchAscent` removes the parked hull, parents the shared
  cockpit to the planet camera, and carries it up from the pad with accelerating
  altitude, nose-up pitch, and vertical rumble for about 1.6 s. It fades to
  black, disposes the world, and resumes space in cockpit control beside that
  seed's proxy (`entryPoseForSeed`: surface standoff
  `ENTRY_SURFACE_STANDOFF`, just outside `LAND_RANGE`).

### Planet motion, water, and collision

Player motion is custom, not driven by a physics engine:

- **Terrain:** untouched areas use the cheap heightfield snap
  (`heightAt` + `EYE_HEIGHT`). Near cave edits, the same eye-space capsule is
  resolved against the volumetric density field, including floors, walls, and
  ceilings; support normals drive grounding and velocity sliding.
- **Solids:** eye-space capsule (`PLAYER_RADIUS`) vs nearby rock spheres
  (from instance scales), idle rover AABBs, and the parked ship’s world AABB
  (`ParkedShip.getCollisionAabb`). Velocity slides off corrections.
- **Rovers:** each seed plans 0–2 Quaternius wheeled pads via an isolated RNG
  stream (`planRovers`, salt `0x70fe700e`). Look at a rover within
  `ROVER_BOARD_RANGE` (center-screen raycast) and **E** to board (faster
  grounded drive, seat camera, hull hidden); **E** again to exit and persist
  poses. `/spawn rover|roundrover|rovervariant` adds instances without removing
  others. Saved as multi `kind: "rover"` entities once moved or command-spawned.
- **Water / ice:** swimable `water` surfaces slow movement when the torso is
  below `waterLevel` (`WATER_MOVE_FACTOR` / `WATER_GRAVITY_FACTOR`; sprint off).
  The mesh is double-sided so the surface remains a ceiling underwater; eye
  depth tightens fog toward the water tint (`js/water.ts` + `present.ts`).
  Frozen Shelf uses a visual `ice` plane at the same height with no immersion.

`js/config.ts` holds the tuning. `tests/collision.test.ts` and
`tests/water.test.ts` cover the pure helpers.

### Volumetric cave terrain

The procedural world is still a 401² heightfield. Digging adds a sparse,
subtractive volume over it instead of voxelizing the whole 1000×1000 planet:

- A mining cycle writes one camera-aligned capsule (`CAVE_DIG_RADIUS` 1.6 m,
  nominal tunnel diameter 3.2 m). The segment overlaps the previous bite, so
  consecutive collinear strokes compact into one exact longer capsule.
- Only touched 20×20×20 m chunks exist. Density is sampled at 0.5 m:
  `max(y - heightAt(x,z), capsule clearances)`, where positive means air.
- `cave-worker.ts` runs one meshing job at a time and returns transferable
  position, normal, and color arrays. `cave-runtime.ts` combines revisions,
  rejects stale or non-resident results, and commits no more than one finished
  chunk per frame. A new brush enters collision and aim queries only after all
  affected mesh revisions are ready, so players cannot move through terrain
  that is still visible.
- Edited chunks stream near the camera (~68 m) and dispose beyond ~104 m.
  Save records stay indexed but consume no mesh/GPU memory while distant.
- When a dig meets the outer surface, all vertical chunks spanning that 20 m
  XZ tile are prepared first. The original heightfield tile is removed only
  after every replacement is ready, so loading never shows an incomplete hole.
- The replacement mesh samples surface colors and blends toward the crater
  palette below ground. Unsupported rocks, flora, and deposits are hidden
  locally. Cave state derives that result, so it is not saved separately.
- Terrain aim uses the same density field, so rays can hit cave floors,
  ceilings, and walls even below the original mountain surface.

The runtime does not save generated triangles. Meshes are deterministic caches
owned by `World.group`. Travel and launch terminate the worker, and normal
world disposal releases the GPU buffers. Browsers without Worker support use a
deferred one-job fallback; supported browsers keep meshing off the main thread.

### World API

`createWorldSystem(scene, renderer)` exposes `build`, `dispose`,
`updateDayNight(time, cameraY?)`, `updateTerrain(viewPosition)`, `getAimHit`,
`carveCave` (which returns the persisted capsule brush), async
`applyPlanetPatch`, `refreshDeposit`, and `current`. It does not touch the HUD
or player state.

## Saves and game state

### Saves

The game uses the IndexedDB database `deep-space-atlas`.

| Store | Key | Contents |
| --- | --- | --- |
| `planets` | seed hex | `PlanetDocument` patch |
| `profile` | `player` | `PlayerProfile` |

#### Planet patch (`v: 2`)

This holds legacy surface-height edits, compact cave brushes, and remaining
deposits by stable id (`type:qx:qz`). Its `entities[]`
also holds pets (`kind: "pet"`: species + last ground pose), the commander
(`kind: "player"`: x/y/z/yaw + pitch/fuel in `data`), the parked survey vessel
pad (`kind: "parked-ship"`: x/z/yaw), wheeled rovers (`kind: "rover"`:
unique id per instance, x/z/yaw + `data.roverKind`), and field structures
(`kind: "structure"`: unique id, x/z/yaw + `data.blueprintId`).

`PlanetEntity.kind` is the
`"pet" | "player" | "parked-ship" | "rover" | "structure"` union.
Singletons (`pet`, `player`, `parked-ship`) use the kind as their id. Rovers and
structures use stable ids such as `rover-0` / `structure-0`. The shared
accessors are `findPlanetEntity` and `upsertPlanetEntity`. Loading always runs
`build(seed)`, then async `applyPlanetPatch`; `main` then restores fauna,
rovers, structures, ship, and player from `entities[]`. When no rover is saved,
rovers come from the seeded `roverPlan`.

#### Surface encoding

v1 crater saves are still supported and migrate explicitly to v2. A sparse
patch stores `[index, height]` cells. A packed patch
keeps its decoded `Float32Array` in memory (`TerrainPatch.heights`) and
re-encodes base64 `data` once per flush in `sealPlanetDocument`. Flushes still
compact sparse data to packed data. Applying either form yields between bounded
height/normal batches, so an old heavily edited planet does not stall a frame.

#### Cave encoding

`CavePatch` uses `capsule-brushes` / `i16le-20-b64`: two
signed 16-bit endpoints plus a radius (14 bytes per record, 5 cm precision).
The decoded list stays in memory and re-encodes once per flush. Collinear,
overlapping strokes merge before storage. A per-chunk spatial index keeps field
queries and worker jobs local as the cave grows. Distant chunks parse and index
cheaply, but are not meshed during load.

Writes flush after a 400 ms debounce, when the player leaves a planet (travel
or launch), on pointer unlock (Standby / Escape / click-away), when opening
Cargo / Gear / Build / Profile / the command bar, every 45 s while the pointer is
locked in planet or space mode, and on `visibilitychange → hidden` plus
`pagehide`. Hide events are the last reliable times when closing a tab;
async IndexedDB writes started in `beforeunload` are killed. Every flush
calls `onBeforeFlush`, which snapshots the live player, pet, parked ship, and
present rover poses into the active document before sealing. After a launch,
the planet session calls `suspend()` so hide events do not rewrite a disposed
world. The next `open` uses `skipFlush` if the caller already flushed.

Unsupported surface props are recomputed from the cave field and do not appear
in planet patches. The space cockpit pose is not persisted.

#### Profile

The profile holds callsign, cargo, playtime, master audio mute, installed
gear, and visited planets. Mute is off by default, so sound is on;
**M** / `/mute` saves the choice here. Gear is permanent profile upgrades
(see [`gear.md`](gear.md)); **G** opens Gear. Field structures use **B** /
Build (see [`blueprints.md`](blueprints.md)). Cargo (**I**), Gear (**G**),
Build (**B**), and Profile (**P**) share a tab strip so you can jump between
them without closing. The profile lists companions (visited worlds with
`hasPet`) above the visited-planet index; pets remain planet-bound in
`entities[]`. The profile document version is `PLAYER_PROFILE_VERSION` (4).
Loading v1 adds `muted: false` and empty `gear`; loading v2 adds empty `gear`;
loading v3 migrates `builds` → `gear`.

#### Portable file (`.deepspaceatlas`, `v: 2`)

This contains a sealed profile, all planet patches, `lastSeed`, `savedAt`, and a
checksum. SAVE downloads the live campaign. LOAD replaces IndexedDB and opens
`lastSeed`. NEW GAME wipes IndexedDB and starts a random world. Planet and
profile replacement share one IndexedDB transaction. LOAD and NEW GAME retain a
sealed snapshot too, restoring it when installing or opening the replacement
world fails. There is no NEW WORLD button; use the ship or profile TRAVEL.

Planet v1 and campaign v1 documents are checksum-verified, migrated explicitly
to v2 in memory, and written as v2 at their next save. Unknown versions stay
rejected. If deposit placement or identity changes incompatibly, bump
`WORLD_CONTENT_REVISION` in `planet-save.ts`. Bump `PLANET_SAVE_VERSION`,
`PLAYER_PROFILE_VERSION`, or `GAME_SAVE_VERSION` when those shapes change.
Parsers reject unknown versions and bad checksums. There are no silent
migration shims.

### Mining

Hold extract on one target to fill a progress cycle. Retargeting or releasing
resets it. Cycle time and reach follow gear modifiers when upgrades are
installed (see [`gear.md`](gear.md)).

| Target | Yield |
| --- | --- |
| Terrain | Silicate + permanent directional cave bite (size follows dig modifiers) |
| Boulders | Silicate |
| Flora | Carbon |
| Deposits | Their material; shrink with remaining capacity; Resonance Tip adds +1 |
| Aetherite | High altitude only |

Look down to open a shaft; look into a slope or mountain to extend a tunnel.
Edits persist by seed. Coming back restores cave brushes, legacy craters, and
deposit capacity.

### Fauna

About one fifth of seeds get `hasFauna` and 1–3 wild walkers. Hold LMB on one
to tame it. A planet can have one pet. It walks toward you at a fixed pace
slower than player walk and never teleports. Its planet save stores its species
and last ground pose, then restores it with a short greeting on return.
Playtesters can force a random companion with `/adopt pet` (see
[`commands.md`](commands.md)); it fails if a pet is already present.

With a pet on the active world and no field structures, the top-center HUD
compass shows its species, range, and bearing relative to look yaw
(`js/fauna/compass.ts` + `#petCompass`). Profile (**P**) also lists companion
worlds under COMPANIONS. When any structure is present, the compass tracks the
nearest structure instead (see [`blueprints.md`](blueprints.md)).

### Field structures

Blueprints in **Build** (**B**) spend cargo to place structures on the active
planet. Survey beacons are markers; **tents** and **planet bases** are walk-in
hollow shells (door on the approach face). All use `kind: "structure"` entities
(`data.blueprintId`). Placement is ahead of the commander, with footprint
clearance and per-blueprint caps. Aiming at a structure shows its label.
Shelters resolve walls in local space and raise the ground plane to the floor
while you stand inside. See [`blueprints.md`](blueprints.md).

### Rovers

Each planet deterministically places 0–2 Quaternius Ultimate Space Kit rovers
(`rover`, `round-rover`, `rover-variant`) away from spawn. Aim at a rover within
about 10 m and press **E** to board (`ROVER_BOARD_RANGE` raycast;
`ROVER_DRIVE_SPEED` / `ROVER_SEAT_HEIGHT` in `js/config.ts`). Press **E** again
to exit, park, and write `entities[]`.

While driving, `body.rover-mode` shows the CSS cabin frame (`#roverCockpit`) and
drive hint bar, and hides the foot/jet hint and fuel chrome. Each hull has its
own Kenney circular-engine loop. Command spawns add vehicles; they never remove
existing ones. The assets are in
`assets/vehicles/quaternius-ultimate-space-kit/` (CC0; see
[`CREDITS.md`](../CREDITS.md)).

### Audio

`js/audio.ts` runs the sample bus. `js/audio-catalog.ts` lists the sounds, and
`js/audio-rules.ts` contains the pure mapping rules. Curated CC0 `.ogg` files
live under `assets/audio/`: Kenney sci-fi, interface, digital, impact, and
jingle sounds, plus rubberduck ambience and creature clips. See
[`CREDITS.md`](../CREDITS.md).

The mix has deep underwater ambience and burbles when the eye is submerged,
per-rover engine loops while mounted, and thruster loops in space and while
jetpacking. Space thruster gain and rate follow speed and boost; boosting also
adds a short whoosh punch. Mining gets a computer hum. Pets chirp and play a
bond jingle. The UI, scanner, launch, and landing have their own sounds too.

Buffers decode after the first unlock gesture. **M** / `/mute` sets master gain
to zero and saves the choice on the player profile for the next session. Sound
is on by default.

### Space

- **Galaxy:** a bijective 32-bit Feistel maps each seed to a cell in the 64³
  grid (16 km cells) and an offset. The mapping is stable, sequential seeds
  scatter, and each seed has its own proxy radius.
- **Streaming:** two tiers come from the ship cell's Moore neighborhood:
  - **Near** (interactive): ±1 cells, load at 12 km, unload at 14 km, cap 16.
    The departed planet stays pinned. These lit spheres are the only set used
    for scan, land, and crash.
  - **Horizon** (backdrop): ±4 cells, load at 56 km, unload at 64 km, cap 28.
    It excludes near shells. Low-poly Lambert discs, with a sun terminator
    rather than flat unlit candy, let distant bodies read as tiny planets
    without StandardMaterial cost. The camera far plane clears the unload
    sphere.
  - **Proxy look:** orbital colors darken and saturate the ground palette;
    oceans pull toward water. Each proxy clones a low-poly sphere, paints pole,
    temperate, and equator vertex bands, then adds a thin translucent atmosphere
    shell. Near shells use slightly metallic Standard materials. Ground terrain
    palettes stay as they are.
  - **Distance fade:** an opaque surface remains solid. A black tint shell
    outside the atmosphere falls from about 99% opacity at the horizon unload
    sphere to transparent inside 4 km, so distant planets are almost black
    until you close in.
- **Flight feel:** speed and boost drive the engine bed and thruster loops, FOV
  widening, vertical bob, and a tiny boost-only pitch shake. There is no lateral
  roll.
- **Land:** the reticle hits near proxy spheres. Below RANGE threshold, press
  **E** or contact the shell to start the third-person hull-departure cinematic,
  fade to black, then call `open(seed)`.
- **Parked ship:** a planet gets an `entities[]` entry when its ship is placed
  or moved, including `/spawn spaceship` and the first-visit default pad.
  `placeAt` restores it on open; otherwise it uses the default pad beside
  spawn. The space cockpit pose is not persisted. Entering space (launch or
  travel) places the ship beside the current seed's proxy — surface standoff
  `ENTRY_SURFACE_STANDOFF` (`LAND_RANGE + 280`) via `entryPoseForSeed` — or
  beside a random seed's proxy when starting fresh. The cockpit HUD shows a
  speed bar/readout (vs `BOOST_SPEED`) above the boost fuel gauge.

### World generation invariants

The world is about 1000×1000 (1 unit ≈ 1 m): 400×400 quads, 401² heights at
2.5 spacing. Major subsystems use independent RNG streams from the same seed.
Do not add unrelated random calls that shift the spawn, name, or deposits.

The first `mulberry32(seed)` draw picks a **planet class** from
`js/world/planet-class.ts`, weighted across Lush Paradise, Exotic, Ash Wastes,
Crystal Barrens, Rust Dunes, Frozen Shelf, Verdant Marsh, and Nightworld. A
class defines terrain amplitudes, fog, surface kind (`none` / swimable `water` /
visual `ice`), flora density, rock clusters, deposit count scales, lighting,
and foot-speed bias. Space scan metadata (`planetMetadata`) uses the same pick
and palette stream. Bump `WORLD_CONTENT_REVISION` if class placement rules
change deposit identity incompatibly.

Two surface-height readers have different jobs. `heightAt` is smooth bilinear
and drives the untouched-terrain fast path. Placement of rocks, flora, deposits,
and spawn uses `createGridHeightAt`, a nearest-vertex snap that avoids
interpolation cost. Both read the same `heights` field. Near edits, collision
and aiming use `CaveRuntime.densityAt`. Do not use `heightAt` to place or ground
actors in a cave: one XZ coordinate can have several surfaces.

## Testing

Vitest covers pure deterministic logic under `tests/`: config math, saves,
cave brush/chunk math, field raycasts, capsule collision, mesh extraction,
world helpers, space math, land/launch cinematic curves, fauna, vehicles,
commands, gear, blueprints / structures, planet entities, shareable `?seed=`
URLs, audio catalog and mapping helpers, and mute gain.

Do not build brittle mocks around Three.js, Web Audio graphs, the DOM, or all
of `main` / `gameplay` / `ui`. Pull out helpers when a rule needs coverage. Add
or update tests with every testable logic change. See
[`CONTRIBUTING.md`](../CONTRIBUTING.md).

## How to extend it

### Tuning

`js/config.ts` exports movement, mining, world size, and cave
chunk/cell/brush/streaming dimensions.

### Add a material

1. `MATERIALS` + `MATERIAL_ORDER`
2. If it is a deposit: `DEPOSIT_DEFINITIONS` + `createDepositGeometry()` in
   `js/world/deposit-geometry.ts`
3. Icon in `drawIcon()` (`ui.ts`)
4. Extraction behavior in `gameplay.ts`
5. Deposit material keys must match `MATERIALS` keys

### Add a planet class

1. Add an id + entry to `PLANET_CLASSES` in `js/world/planet-class.ts`
   (weight, biome amplitudes / fog, surface, flora, rocks, deposits, lighting,
   walk speed).
2. Add a `createPalette` branch in `js/world/generate.ts` for its look.
3. `planetMetadata` already uses `pickPlanetClass` + palette; keep that path
   working.
4. Cover selection / helpers in `tests/world-generate.test.ts`.
5. Bump `WORLD_CONTENT_REVISION` if deposit placement or identity changes.

### Add commander gear

See [`gear.md`](gear.md). Add the id to `GearId`, `GEAR_DEFINITIONS`, and
`GEAR_ORDER` in `js/gear.ts`, extend `GearEffect` / `resolveGearModifiers`
only when a new modifier kind is required, cover it in `tests/gear.test.ts`,
and keep the catalog table in `gear.md` current.

### Add a field blueprint

See [`blueprints.md`](blueprints.md). Add the id to `BlueprintId`,
`BLUEPRINT_DEFINITIONS`, and `BLUEPRINT_ORDER` in `js/blueprints.ts`, add a mesh
in `js/structures/mesh.ts`, cover it in `tests/blueprints.test.ts`, and keep
the catalog table in `blueprints.md` current.

### Add a UI panel

Put markup in `index.html`, styles in `styles.css`, and DOM work in `ui.ts`.
Expose callbacks; `main.ts` / `gameplay.ts` own state changes.

### Add a slash command

See [`docs/commands.md`](commands.md). Register a `CommandDefinition`. Extend
`CommandHost` only if the game needs a capability it does not have, wire the
host in `main.ts`, and cover parsing and dispatch with Vitest.

### Extend campaign saves

1. Bump the relevant version / `WORLD_CONTENT_REVISION`
2. Record new mutable planet state on `PlanetDocument` (prefer `entities[]` and
   stable ids over array indices)
3. Apply in `world.applyPlanetPatch` after `build(seed)`
4. Keep parsers strict
