# Game audio (runtime)

Deep Space Atlas ships a hand-picked set of `.ogg` samples. License and credit
details are in [`CREDITS.md`](../../CREDITS.md).

## Layout

| Path | Source |
| --- | --- |
| `kenney/` | [Kenney.nl](https://kenney.nl) CC0 packs (sci-fi, interface, digital, impact, jingles) |
| `rubberduck/` | OpenGameArt CC0 packs by rubberduck (sci-fi ambience + creature SFX) |

Only the files the game uses are committed. The full upstream zips are not.

## Runtime

`js/audio-catalog.ts` maps logical sample ids to Vite `?url` imports.
`js/audio.ts` decodes them into Web Audio buffers after the first unlock.
