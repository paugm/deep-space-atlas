# Fabricator builds

Players spend cargo to install permanent gear. Builds live on the **player
profile** (not per-planet), stack their modifiers, and travel with the
commander across worlds and campaign saves.

Cargo (**I**) stays materials-only. The **Build Bay** (**B**) is where recipes
and installed gear are shown. Cargo, Build, and Profile share a tab strip so
you can move between them without closing.

## Player flow

1. Gather materials into cargo.
2. Press **B** to open the Build Bay.
3. **AVAILABLE** lists recipes you do not own yet (costs, prerequisites, BUILD).
4. **INSTALLED** lists gear already on the profile.
5. BUILD spends cargo once; the id is stored forever on that profile.

Playtesters can skip cargo with `/build <token>` or install the full catalog
with `/gimme everything` (see [`commands.md`](commands.md)). That installs the
same profile entry and applies the same modifiers.

## Architecture

```text
js/builds.ts          catalog, costs, tryBuild, resolveBuildModifiers
player-profile.ts     profile.builds: BuildId[]  (v3+)
gameplay.ts           applies modifiers (jetpack, mining, dig, mobility, rover)
ui.ts + #buildOverlay Build Bay DOM
commands/builtins.ts  /build <token> · /gimme everything
main.ts               profile sync + host.buildItem
```

| Concern | Owner |
| --- | --- |
| Recipe table | `BUILD_DEFINITIONS` / `BUILD_ORDER` in `js/builds.ts` |
| Purchase rules | `tryBuild` (afford, prerequisites, already owned) |
| Live stats | `resolveBuildModifiers(builds)` → `BuildModifiers` |
| Persistence | `PlayerProfile.builds`, sealed with the profile checksum |
| Menu | `ui.updateBuildMenu` from gameplay inventory + builds |

World and UI never invent recipes. Add definitions in `builds.ts`, then wire
effects only through `resolveBuildModifiers` and the gameplay/world call sites
that read those modifiers.

## How to define a build

1. Add an id to the `BuildId` union in `js/builds.ts`.
2. Add a `BuildDefinition` to `BUILD_DEFINITIONS`:

```ts
"example-coil": {
  id: "example-coil",
  token: "example-coil",   // /build example-coil
  label: "Example Coil",
  blurb: "Short player-facing effect.",
  category: "jetpack",     // or "extractor"
  cost: { iron: 20, copper: 5 },
  requires: ["thruster-coil-i"], // optional
  effects: [
    { kind: "jetBurnMult", value: 1.1 },
  ],
},
```

3. Append the id to `BUILD_ORDER` (menu + docs order).
4. Prefer an existing `BuildEffect` kind. If you need a new kind, extend the
   `BuildEffect` union, handle it in `resolveBuildModifiers` with an exhaustive
   `never` default, and apply the resulting field in gameplay (or world) where
   the base constant was used.
5. Cover costs / prerequisites / modifiers in `tests/builds.test.ts`.
6. Document the recipe in this file’s catalog table and mention the system in
   [`README.md`](README.md) if architecture or controls change.
7. `/build <token>` picks up new tokens automatically via
   `buildDefinitionFromToken` — no per-item command registration.

### Effect kinds

| Kind | Stacking | Applies to |
| --- | --- | --- |
| `jetBurnMult` | multiply | Jetpack burn duration |
| `jetRechargeMult` | multiply | Jetpack recharge duration |
| `jetMaxSpeedAdd` | add | Max vertical jetpack speed |
| `miningTimeMult` | multiply | Extractor cycle length |
| `miningRangeAdd` | add | Aim / dig reach (meters) |
| `digScale` | multiply | Cave brush radius and length |
| `depositYieldBonus` | add | Extra deposit units per cycle |
| `footSpeedMult` | multiply | Walk and sprint speed |
| `jumpMult` | multiply | Jump impulse |
| `waterMoveMult` | multiply | Swim / water move factor (higher = less slowdown) |
| `waterDragMult` | multiply | Underwater vertical drag (lower = less drag) |
| `roverSpeedMult` | multiply | Wheeled rover drive speed |

Multipliers start at `1` and multiply across owned builds. Dig scale multiplies
both radius and length from `CAVE_DIG_*` bases.

### Prerequisites

`requires` lists build ids that must already be installed for a **paid** Build
Bay purchase. `/build` with `free: true` skips cost and prerequisites so
playtesters can force a single upgrade.

### Profile version

Installed builds are `PLAYER_PROFILE_VERSION` **3**. Loading v1 or v2 profiles
upgrades in memory with `builds: []`. Unknown build ids fail parse (strict).

## Current catalog

### Jetpack

| Id / token | Cost | Effect |
| --- | --- | --- |
| `thruster-coil-i` | 40 Silicate, 20 Iron, 8 Carbon | Burn ×1.25 |
| `thruster-coil-ii` | 200 Silicate, 100 Iron, 40 Carbon, 15 Copper | Requires I; burn ×1.28, max speed +2 |
| `capacitor-lattice` | 60 Iron, 30 Carbon, 20 Copper | Recharge ×0.64 |
| `aether-lift-core` | 80 Copper, 12 Aetherite | Max speed +4 |

### Extractor / cave dig

| Id / token | Cost | Effect |
| --- | --- | --- |
| `focus-lens-i` | 30 Silicate, 25 Iron, 10 Copper | Mining time ×0.69 |
| `focus-lens-ii` | 150 Silicate, 120 Iron, 50 Copper, 8 Aetherite | Requires I; time ×0.64, range +4 |
| `bore-widener-i` | 50 Silicate, 40 Iron, 20 Carbon | Dig scale ×1.15 |
| `bore-widener-ii` | 250 Silicate, 180 Iron, 80 Carbon, 25 Copper | Requires I; dig scale ×1.17 |
| `resonance-tip` | 40 Carbon, 30 Copper, 6 Aetherite | Deposit yield +1 |
| `long-arm-emitter` | 70 Iron, 40 Copper, 10 Aetherite | Range +7 m |

### On-foot mobility

| Id / token | Cost | Effect |
| --- | --- | --- |
| `servo-boots` | 40 Silicate, 30 Iron, 15 Carbon | Walk/sprint ×1.12 |
| `hydro-seal-suit` | 50 Carbon, 25 Copper, 10 Iron | Water move ×1.35, drag ×0.7 |
| `mass-dampers` | 35 Iron, 20 Copper | Jump ×1.15 |

### Rover

| Id / token | Cost | Effect |
| --- | --- | --- |
| `drive-kit-i` | 60 Iron, 40 Silicate, 20 Copper | Rover speed ×1.24 |
