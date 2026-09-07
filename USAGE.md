# Usage & Instructions

> **Status: pre-alpha, built toward the spec.** Phase 1 (tracking) is live in the app; the Phase 2 optimization engine ships in `packages/core`. The spec below is the contract being implemented. The repo is a pnpm workspace (`packages/core` pure TS + `apps/mobile` Expo). The tool is one app with four views; no CLI.

## Installation

Prereqs: Node 20.19+, pnpm 12+ (install with `corepack enable pnpm` or `npm i -g pnpm`).

```sh
pnpm install        # from the repo root
```

For the mobile app on a real device, install Expo Go (SDK 57) from the app store, or use a development build via EAS.

## Running it

```sh
cd apps/mobile
pnpm start          # Expo dev server; press i / a / w for iOS / Android / web
```

- Web export (also validates the bundling pipeline): `pnpm exec expo export -p web`
- Core unit tests (pure TS, run anywhere): `pnpm test` from the repo root
- Core typecheck across packages: `pnpm -r typecheck` from the repo root


## Planned input formats

### Cut list (CSV)

`cutlist.csv`:

```csv
part,quantity,length,width,thickness,grain
shelf,2,36,10,1,lengthwise
side,2,28,12,1,along_width
leg,4,24,2.5,2.5,no_matter
```

- Units are inches by default; a config option switches to metric (mm).
- `grain`: `lengthwise`, `along_width`, or `no_matter`.

### Stock (CSV)

`stock.csv`:

```csv
type,name,length,width,thickness,qty,price
board,walnut 4/4,96,7,1,2,24.00
sheet,baltic birch,96,48,0.75,1,60.00
scrap,cherry cutout,20,8,1,1,0
```

- `type`: `board` (sold by board-ft, width/thickness matter) or `sheet`.
- The tool computes board-ft for `board` entries and reports usage against it.

## Interface

The whole tool is one app organized into four views. No command line needed.

- **Part List** — enter/edit parts (description, quantity, dimensions, grain, wood type, cost per board-foot). Rows add/remove freely and persist on-device; per-part and total board-ft and price roll up automatically. **Export CSV** (share sheet on iOS/Android, download on web) writes the cut list including wood type and $/bd-ft columns.
- **Stock** — enter/edit boards and sheets (type, name, dimensions, qty, price, wood type, $/bd-ft). Rows add/remove freely and persist; totals show board-ft, value by $/bd-ft, and purchase price.
- **Layout** — runs the optimizer on your live Part List/Stock and draws an interactive diagram of every board and sheet: parts in color (tap for details), saw-kerf gaps between parts, and offcut (waste) regions shaded. Table-saw and band-saw kerf settings at the top (both default 1/8", persisted) feed the optimizer; the band-saw kerf is what governs resaw cuts when a thick board is split into thinner layers. Summary shows parts placed, board-ft bought/used/waste, sheet waste, and any planed/resawn boards.
- **Photo → Parts** — **Mode B (part extraction, live)**: take a photo with the camera or choose one from your library, drag a box around each visible part to identify it, then tap a box to enter its name and dimensions (L×W×T, qty, grain) — board-ft updates per part and in total. **Send traced parts to Part List** appends them to your parts (they flow instantly into the Layout view). Optional scale reference and Mode A ("what did it cost") are still planned.

## Photo mode walkthrough

1. Open the **Photo → Parts** view on your phone, take or upload a photo.

2. Drag a box around each visible part — drag from any corner/direction. Tap a box to select it: drag the top bar to move it, or pull any of the four corner dots independently to trace angled edges (parts don't have to be rectangles). Each traced part appears in the **Traced parts** list on the page, where its name, dimensions (L×W×T), quantity, and grain are edited inline — board-ft updates per part and in total. Tap a row to re-select/find its box on the photo.

3. Dimensions are entered manually from your measurements (a scale reference that derives real dims from box proportions is planned). Board-ft is computed per part and in total.

4. **Send traced parts to Part List** appends them; they appear in the Part List and Layout views immediately.

5. Future: automated boundary detection (ML) pre-fills the traced boxes; the manual trace remains the fallback. The photo pipeline keeps this separation so the UI doesn't change. Mode A ("what did this cost me, roughly") remains planned.

## Optimization engine

`packages/core/src/nesting.ts` — pure TS, Vitest-tested. `optimizeCutList({ parts, stock, kerf, resawKerf? })` matches parts to stock by thickness, expands quantities, and returns per-stock layouts (placed parts with real coordinates + offcut regions), unplaced parts, and waste stats.

- **Sheets** use maximal-rectangles packing. Every part is inflated by `kerf` on all sides inside a sheet inflated by one kerf, so adjacent parts keep a physical saw gap. Grain rules: `lengthwise` runs the part's length along the sheet's grain, `along_width` runs it across (rotates 90°), `no_matter` takes whichever fits. Sheets are never planed or resawn.
- **Boards** (and `scrap`) are strip stock: parts are ripped into lanes across the board's width and crosscut within a lane; kerf applies between lanes and between crosscuts. A lane's width is set by its first piece; narrower parts can join. Boards are a fallback target for sheet-type parts and vice-versa when a matching thickness is available.
- **Planing & resawing**: exact-thickness boards get first pick; boards thicker than a part can be **planed down** (one thinner layer, the thickness difference becomes waste) or **resawn** into `K = ⌊(T + k) / (t + k)⌋` layers of thickness `t` (each resaw cut loses one `k` of kerf). Layers behave like separate boards of the same footprint; the physical board's board-feet is still counted once. Thickest parts are served first, so a board is committed to a single part-thickness. `resawKerf` defaults to `kerf`.
- **Units**: dimensions and kerf are inches in the core math; the app's unit setting is applied at the edges.

Run `pnpm test` from the repo root for the placement test suite (packing, rotation, kerf separation, no-overlap invariant, overflow fallback, waste arithmetic, planing & resaw layer math).

## Planned outputs

- **Cut list**: quantities, dims, stock assignment, and per-part board-ft. *(live: board-ft & price roll up in the app; export CSV exists)*
- **Summary**: stock purchased vs. used, total board-ft, and waste percentage. *(live under the Layout view)*
- **Layout**: visual board/sheet diagram with kerf and offcut regions marked. *(live — tap parts for details)*

## Roadmap

1. Tracking (MVP) → 2. Optimization → 3. Visualization → 4. Photo modes → 5. ML auto-detection. Phases 1–3 are done; Phase 4 Mode B (manual part tracing from a photo) is live, Mode A and the ML pre-fill remain.

## Contributing

The project is not yet implemented. Feature requests, hardware notes, or real-world test cut lists are welcome — open an issue or attach sample photos.

See [README.md](README.md) for the vision and tech decisions.