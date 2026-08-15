# Field blueprints

Players spend cargo to **fabricate** placeable structures on the active planet.
Blueprints are always available (no unlocks). Each placement spends materials
and writes a `kind: "structure"` entity on that planet’s save.

Cargo (**I**) stays materials-only. **Build** (**B**) lists blueprints and
costs. **Gear** (**G**) is separate: permanent commander upgrades (see
[`gear.md`](gear.md)). Cargo, Gear, Build, and Profile share a tab strip.

## Player flow

1. Gather materials into cargo.
2. Press **B** to open Build.
3. **BLUEPRINTS** lists every recipe with cost and how many are already on
   this planet.
4. FABRICATE spends cargo and plants the structure a few meters ahead of the
   commander, then closes the menu.
5. Aim at a placed structure and hold LMB to salvage it. Half of each cost
   line (rounded down) returns to cargo; a recipe of all 1s refunds nothing.
6. Leave and return: remaining structures restore with the planet patch.

Playtesters can skip cargo with `/build <token>` (see [`commands.md`](commands.md)).

## Architecture

```text
js/cargo-cost.ts         shared afford / deduct / add / salvageRefund helpers
js/blueprints.ts         catalog, tryFabricate (pure spend)
js/structures/placement.ts  validate spacing, limits, bounds (pure)
js/structures/entity.ts  PlanetEntity codec for kind: "structure"
js/structures/mesh.ts    procedural meshes
js/structures/system.ts  scene sync, place, aim, nearest, save snapshot
gameplay.ts              attemptFabricate (spend + place)
ui.ts + #buildOverlay    Build menu DOM
planet-save.ts           recordStructures / getStructureEntities
commands/builtins.ts     /build <token>
main.ts                  structureSystem + host.buildItem
```

| Concern | Owner |
| --- | --- |
| Recipe table | `BLUEPRINT_DEFINITIONS` / `BLUEPRINT_ORDER` in `js/blueprints.ts` |
| Cargo spend | `tryFabricate` |
| Placement rules | `validateStructurePlacement` |
| Runtime / save | `js/structures/*` + `planet-save` `entities[]` |
| Menu | `ui.updateBuildMenu` |

World and UI never invent blueprints. Add definitions in `blueprints.ts`, add
mesh + placement tuning, then wire through `structureSystem.place`.

## How to define a blueprint

1. Add an id to the `BlueprintId` union in `js/blueprints.ts`.
2. Add a `BlueprintDefinition` to `BLUEPRINT_DEFINITIONS` (cost, max per planet,
   min spacing).
3. Append the id to `BLUEPRINT_ORDER`.
4. Add a mesh branch in `js/structures/mesh.ts`.
5. Cover catalog, fabricate, and placement in `tests/blueprints.test.ts`.
6. Document the recipe here and update [`README.md`](README.md) controls /
   feature counts when player-facing.

`/build <token>` picks up new tokens via `blueprintDefinitionFromToken`.

### Placement rules

- Structures spawn `placeAhead` meters along look yaw (per blueprint).
- Instances may not overlap: sum of `footprintRadius` values, and same-kind
  `minSpacing`.
- At most `maxPerPlanet` of each blueprint on one world.
- Placement must stay inside the world rim (`STRUCTURE_EDGE_MARGIN`).
- Shelters also sample terrain across their oriented footprint (3×3 grid);
  when the height difference exceeds the layout's `maxTerrainDrop`, placement
  fails with `too-steep`.

### Save shape

Multi-instance entities:

```text
id: "structure-N"
kind: "structure"
x / z / yaw
data.blueprintId: BlueprintId
```

Height is restored from the heightfield on load (same pattern as rovers).

### Compass

When any structure exists on the active planet, the top-center HUD compass
tracks the **nearest** structure (label from the blueprint). If none are
placed, the compass falls back to the active pet companion.

## Current catalog

| Id / token | Cost | Limits | Effect |
| --- | --- | --- | --- |
| `beacon` | 25 Silicate, 15 Iron, 8 Copper | 8 / planet · radius 1 | Glowing survey marker; nearest structure drives the compass |
| `tent` | 12 Silicate, 18 Carbon, 4 Iron | 4 / planet · radius 2.8 | Expedition ridge tent: gabled canvas, rolled-open flaps, guy ropes, lantern |
| `planet-base` | 80 Silicate, 55 Iron, 30 Carbon, 22 Copper | 1 / planet · radius 4 | Hab module: porch deck + ramp, portholes, skylight dome, antenna, solar panel, bunk |

### Walk-in shelters

Tent and planet-base are hollow shells with a real door gap — you walk in.

- Layout recipe in `js/structures/shelter.ts` builds wall AABBs in **local**
  space (door on `+Z`, facing the commander who placed it). The shell includes
  jambs, a lintel, a below-floor sill, and a ceiling, plus walls extended
  `foundationDepth` below grade so slopes cannot be slipped under.
- The mesh renders the same wall list (clipped at ground level; the collision
  ceiling is replaced by each shelter's visible roof), so visuals and
  collision stay aligned.
- Capsule resolution transforms into local space, runs the existing AABB
  resolve, then transforms the correction back — door gaps stay open at any
  yaw (world AABBs would fatten and seal the entrance).
- **Curved terrain:** the floor sits on the *highest* terrain sample under the
  footprint (`sampleShelterGround`), and a solid plinth fills the gap below.
  Ground support is `max(terrain, floorY)` over the interior **and a porch
  pad** in front of the door, so you step up onto the porch and walk in level.
- Sites steeper than `maxTerrainDrop` across the footprint are rejected
  (`TERRAIN TOO STEEP`).
