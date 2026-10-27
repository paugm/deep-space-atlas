# Contributing

Thanks for wanting to help with Deep Space Atlas.

## Run locally

```sh
npm install
npm run dev
```

Open the URL Vite prints (usually <http://localhost:5173>). Do not open
`index.html` via `file://`.

| Command | Purpose |
| --- | --- |
| `npm test` | Run the unit suite once |
| `npm run test:watch` | Watch mode while iterating |
| `npm run typecheck` | Strict TypeScript check |
| `npm run build` | Typecheck, test, then write `dist/` |
| `npm run preview` | Serve `dist/` over HTTP |

Needs Node.js 22.12+, 24, or 26+.

## Where to look

- [`docs/README.md`](docs/README.md): architecture, modules, saves, generation,
  and how systems fit together. Prefer this over the root README when changing
  the game.
- [`docs/commands.md`](docs/commands.md): slash-command registry (dev /
  playtest only; not advertised in player UI).
- [`CREDITS.md`](CREDITS.md): third-party media and licenses.

## Docs

If you change features, controls, architecture, build steps, saves, or file
layout, update [`docs/README.md`](docs/README.md) in the same change. Update the
root [`README.md`](README.md) only when the public overview, install steps, or
player control summary would otherwise be wrong.

## Tests

If new behavior can be tested without a browser or WebGL, add a test under
`tests/`. Pure helpers are the best targets: seed math, save validation, and
deterministic world rules. Do not add brittle Three.js, Web Audio, or DOM mocks
just to raise coverage.

## Code style

- Keep imports at the top of the file.
- On switches over unions or enums, handle every case (use a `never` check in
  `default` so new variants fail at compile time).
- Prefer clear current design over leftover shims, unused flags, or parallel
  old/new paths.
