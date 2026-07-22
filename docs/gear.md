# Commander gear

Players spend cargo to install permanent upgrades. Gear lives on the **player
profile** (not per-planet), stacks modifiers, and travels with the commander
across worlds and campaign saves.

Cargo (**I**) stays materials-only. **Gear** (**G**) is where upgrade recipes
and installed loadout are shown. **Build** (**B**) is separate: field
blueprints for placeable structures (see [`blueprints.md`](blueprints.md)).
Cargo, Gear, Build, and Profile share a tab strip.

## Player flow

1. Gather materials into cargo.
2. Press **G** to open Gear.
3. **AVAILABLE** lists recipes you do not own yet (costs, prerequisites, INSTALL).
4. **INSTALLED** lists gear already on the profile.
5. INSTALL spends cargo once; the id is stored forever on that profile.

Playtesters can skip cargo with `/gear <token>` or install the full catalog
with `/gimme everything` (see [`commands.md`](commands.md)).

## Architecture

```text
js/cargo-cost.ts      shared afford / deduct / format cost helpers
js/gear.ts            catalog, tryInstallGear, resolveGearModifiers
player-profile.ts     profile.gear: GearId[]  (v4+)
gameplay.ts           applies modifiers (jetpack, mining, dig, mobility, rover)
ui.ts + #gearOverlay  Gear menu DOM
commands/builtins.ts  /gear <token> · /gimme everything
main.ts               profile sync + host.installGear
```

| Concern | Owner |
| --- | --- |
| Recipe table | `GEAR_DEFINITIONS` / `GEAR_ORDER` in `js/gear.ts` |
| Purchase rules | `tryInstallGear` (afford, prerequisites, already owned) |
| Live stats | `resolveGearModifiers(gear)` → `GearModifiers` |
| Persistence | `PlayerProfile.gear`, sealed with the profile checksum |
| Menu | `ui.updateGearMenu` from gameplay inventory + gear |

World and UI never invent recipes. Add definitions in `gear.ts`, then wire
effects only through `resolveGearModifiers` and the gameplay call sites that
read those modifiers.

## How to define gear

1. Add an id to the `GearId` union in `js/gear.ts`.
2. Add a `GearDefinition` to `GEAR_DEFINITIONS`:

```ts
"example-coil": {
  id: "example-coil",
  token: "example-coil",   // /gear example-coil
  label: "Example Coil",
  blurb: "Short player-facing effect.",
  category: "jetpack",
  cost: { iron: 20, copper: 5 },
  requires: ["thruster-coil-i"], // optional
  effects: [
    { kind: "jetBurnMult", value: 1.1 },
  ],
},
```

3. Append the id to `GEAR_ORDER` (menu + docs order).
4. Prefer an existing `GearEffect` kind. If you need a new kind, extend the
   `GearEffect` union, handle it in `resolveGearModifiers` with an exhaustive
   `never` default, and apply the resulting field in gameplay where the base
   constant was used.
5. Cover costs / prerequisites / modifiers in `tests/gear.test.ts`.
6. Document the recipe in this file’s catalog table and mention the system in
   [`README.md`](README.md) if architecture or controls change.
7. `/gear <token>` picks up new tokens automatically via
   `gearDefinitionFromToken` — no per-item command registration.

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

Multipliers start at `1` and multiply across owned gear. Dig scale multiplies
both radius and length from `CAVE_DIG_*` bases.

### Prerequisites

`requires` lists gear ids that must already be installed for a **paid** Gear
menu purchase. `/gear` with `free: true` skips cost and prerequisites so
playtesters can force a single upgrade.

### Profile version

Installed gear is `PLAYER_PROFILE_VERSION` **4** (`gear`). Loading v1 or v2
profiles upgrades in memory with `gear: []`. Loading v3 profiles migrates the
legacy `builds` field to `gear`. Unknown gear ids fail parse (strict).

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
