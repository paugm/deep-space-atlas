# Command system

Slash commands are a small parser, registry, and host-callback layer for
developers and playtesters. Keep them out of the player UI, public README, and
start-screen controls. Press Enter to open the bar; players will not see an
in-game hint for it.

## Using the command bar

1. While pointer-locked on a planet, press **Enter** to open the bar. This
   releases the lock, like cargo and profile screens.
2. Type a command such as `/travel DEADBEEF`, then press **Enter** again.
3. The HUD shows the result. A successful command closes the bar and resumes
   play with pointer lock.
4. Press **Escape** to close the bar and open **Standby**. It does not re-lock
   the pointer.

Commands work only in planet mode. Spawn commands need a loaded world. Travel
uses the same loading route as profile TRAVEL. Unknown or incomplete input gets
a short rejection message, never a list of commands.

## Built-in commands

| Command | Effect |
| --- | --- |
| `/spawn spaceship` | Remove any parked survey vessel, place one ~10 m ahead of the player (facing the player). Board with **E** as usual. |
| `/spawn rover` | Spawn an extra Quaternius rover ~8 m ahead (keeps existing rovers). |
| `/spawn roundrover` | Spawn an extra Round Rover ahead. |
| `/spawn rovervariant` | Spawn an extra Rover variant ahead. |
| `/travel <seed>` | Instant-travel to a planet by 32-bit hex seed (1–8 hex digits). Invalid tokens show a cryptic lattice message instead of traveling. |
| `/mute` | Toggle master audio (SFX + ambient) and save the preference on the player profile. Same as the **M** key. Sound is on by default. |
| `/build <token>` | Fabricate a field structure without spending cargo (same effect as Build). Tokens match blueprint ids such as `beacon`. Requires a loaded planet. |
| `/gear <token>` | Install commander gear without spending cargo (same effect as Gear). Tokens match recipe ids such as `thruster-coil-i`. Already-owned or unknown tokens are rejected. |
| `/gimme everything` | Install every gear recipe without spending cargo. Idempotent if some or all are already owned. |
| `/adopt pet` | Spawn a random companion pet near the player. Fails with an error if this planet already has a pet. Requires a loaded planet. |

Leading `/` is optional. Names are case-insensitive.

## How it is wired

```text
Enter key ──► gameplay.toggleCommandBar()
                    │
                    ▼
              ui.setCommandBarVisible
                    │
Submit ──────► ui.onCommandSubmit(line)
                    │
                    ▼
         commands.dispatch(line)     js/commands/
                    │
         ┌──────────┴──────────┐
         parseCommandLine      lookup by name
         └──────────┬──────────┘
                    ▼
              command.run(args, ctx)
                    │
                    ▼
         CommandHost (wired in main.ts)
           · spawnSpaceshipAhead
           · spawnRoverAhead
           · travelToSeed / loadWorld
           · toggleMute
           · buildItem
           · installGear
           · adoptPet
```

| Module | Role |
| --- | --- |
| `js/commands/parse.ts` | Pure line → `{ name, args }` |
| `js/commands/registry.ts` | Register definitions, `dispatch`, `list` |
| `js/commands/builtins.ts` | `/spawn`, `/travel`, `/mute`, `/build`, `/gear`, `/gimme`, `/adopt` + `CommandHost` |
| `js/commands/index.ts` | Public re-exports |
| `js/main.ts` | Implements `CommandHost`, binds UI submit |
| `js/gameplay.ts` | Enter / Escape / pointer-lock overlay state |
| `js/ui.ts` + `#cmdOverlay` | DOM only |

Keep Three.js, saves, and mode switching out of the registry. Commands call
host methods. `main.ts` owns the parked ship, `loadWorld`, and game mode.

## Add a command

1. Start with a pure definition in `js/commands/builtins.ts` (or a sibling
   module) that only uses `CommandHost`, `hexToSeed`, and similar helpers.
2. Extend `CommandHost` in `builtins.ts` if the command needs a new game
   capability, then implement it once in `main.ts`.
3. Add the definition to `createBuiltinCommands`' return array.
4. Add tests in `tests/commands.test.ts` for parse rules, usage errors, and
   host call expectations. Do not mock Three.js or the DOM.
5. Update this table and `docs/README.md` when the command set changes. Do not
   list commands in the public root `README.md` or `index.html` control hints.

### Definition shape

```ts
const example: CommandDefinition = {
  name: "example",
  aliases: ["ex"],          // optional
  usage: "/example <arg>",  // developer docs / registry list only
  description: "One-line help text",
  async run(args) {
    if (args.length !== 1) {
      return { ok: false, message: "INCOMPLETE SIGNAL" };
    }
    await host.doSomething(args[0]!);
    return {
      ok: true,
      message: "DONE",
    };
  },
};
```

`dispatch` always returns a `CommandResult`. Failures leave the bar open so the
line can be corrected; `main.ts` closes the bar after any successful result.
Do not surface command catalogs or usage cheat-sheets in failure text.

### Seed arguments

Use `hexToSeed` and `seedToHex` from `js/planet-save.ts`. There should be one
seed parser. Invalid hex can return a clear or atmospheric message; travel uses
`UNKNOWN_SEED_MESSAGE`.

### Placement / world mutations

- Parked ship: `ParkedShip.placeAt(scene, world, x, z, yaw)` (also used by
  default `place` at spawn). Pose is stored in the planet patch as
  `kind: "parked-ship"` and restored on open.
- Rovers: `RoverSystem.spawnAhead(world, kind, from, meters)` adds an instance;
  poses are stored as multi `kind: "rover"` entities when spawned or after exit.
- Opening another planet: `loadWorld(seed, { showStartOverlay: false })` via
  the host, same as profile travel.

## Non-goals

- Not a full terminal (no scrollback, shells, or xterm.js).
- Not available in space cockpit mode (planet gameplay owns the Enter binding).
- Not persisted (the bar is UI chrome only).
