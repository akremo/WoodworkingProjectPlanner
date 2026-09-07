# CutListPlannerAndVisualizer

> Plan, optimize, and visualize cut lists for woodworking — from an idea or a photo.

**Status: pre-alpha, built toward the spec.** Phase 1 (cut-list & stock tracking) is live in the mobile app; the Phase 2 optimization engine ships in `packages/core` with tests. The roadmap below is the contract being built toward. See [USAGE.md](USAGE.md) for instructions.

## Motivation

Every woodworker knows the problem: scattered notes, parts left unplanned, and lumber that ends up as offcuts nobody remembers. This tool aims to answer three questions before you touch a saw:

1. **How much stock do I need?** (and what does it cost in board-ft?)
2. **What is the least-waste way to cut it?**
3. **What did that finished project actually consume?**

## Features

- **Cut-list tracking** — catalog parts: description, quantity, dimensions, grain direction, wood type, and cost per board-foot. **Live in the app**: editable rows, device-persisted, CSV export.
- **Waste optimization** — placement engine in `packages/core`:
  - **Sheet goods** (plywood, MDF, panel stock): 2D maxrects packing with kerf margins.
  - **Rough lumber** sold by the board-foot (L × W × T): rip-and-crosscut lane packing.
  - Both are kerf- and grain-aware (see [USAGE.md](USAGE.md#optimization-engine)). The UI wiring lands with Phase 3 visualization.
- **Cut visualization** — interactive on-screen layout of boards/sheets showing each part (tap for details), the saw kerf (the gaps between parts), and the leftover waste (offcuts shaded). Live against your Part List/Stock with a kerf setting. Panel/board rendering on screen; export with labeled cuts is a Phase 3 refinement.
- **Photo → board-ft estimation**:
  - **Mode B — part extraction**: *(live)* take or upload a photo, drag a box around each part to identify it, then trace angled edges by pulling each corner dot independently (parts don't have to be rectangles), and edit each part's dimensions (name, L×W×T, qty, grain) inline with running board-ft. One tap sends the traced parts to the Part List.
  - Designed so a future ML step can detect part boundaries automatically, plugging in without rewriting Mode B. Mode A ("what did it cost") is still planned.

## How it works

Everything lives in one app; there are no separate CLI commands.

1. **Catalog parts** — enter your cut list in the UI (or start from Mode B photo annotation).
2. **Add stock** — list the boards and sheets you have or plan to buy.
3. **Optimize** — the optimizer (`optimizeCutList` in `packages/core`) places parts onto stock, minimizing waste and honoring grain direction and kerf.
4. **Visualize** — the Layout view renders the result live: tappable part diagrams, kerf gaps, shaded offcuts, and waste summary.
5. **Estimate (photos)** — snap a photo of a finished project; Mode B traces parts into the Part List, and Mode A will estimate board-ft consumption.

## Roadmap

| Phase | Scope                                                                    | Status      |
| ----- | ------------------------------------------------------------------------ | ----------- |
| 1     | Cut-list & stock tracking (CSV in/out)                                   | complete    |
| 2     | Optimization engine (board-ft nester + sheet nester, kerf & grain aware) | complete    |
| 3     | Interactive visualization (layout diagrams on screen)                    | complete    |
| 4     | Photo modes A & B (semi-automatic annotation)                            | in progress |
| 5     | Automatic part detection via ML (plugs into Mode B)                      | future      |

## Tech

Monorepo (pnpm workspaces, `nodeLinker: hoisted`):

- `packages/core` — pure TypeScript, no React Native/Expo imports. Domain models, CSV in/out, units + board-ft math, cutting nesters (`nesting.ts`: sheet maxrects + board rip/crosscut, kerf & grain aware, planing & resawing of boards into thinner layers), photo math. Tested with Vitest (runs on the host).
- `apps/mobile` — Expo SDK 57 + Expo Router + NativeWind v4 (Tailwind). One UI, four views (`src/app/{index,stock,layout,photo}.tsx`). Part List and Stock are live editors persisted via AsyncStorage (`usePersistedState`, shared in-memory store → real-time cross-tab updates); CSV export via expo-file-system + expo-sharing (share sheet on native, download on web); photo tracing via expo-image-picker. Rendering/annotation canvas via react-native-skia (planned with the ML/photo-refinement phases). Camera, file picker, and image picker via Expo modules.
- `apps/desktop` — Tauri 2 shell hosting the mobile app's `expo export -p web` output (`apps/mobile/dist`) for native Linux/Windows/macOS installers. `src-tauri/tauri.conf.json` points `frontendDist` at the web export; `pnpm build:desktop` re-exports the web bundle then builds `.deb`/`.rpm`/`.AppImage`.

## Building

### Prerequisites

- **Node ≥ 20** and **pnpm ≥ 12** (lockfile is `pnpm-lock.yaml`; do not use npm/yarn).
- **Rust toolchain** (only for the desktop app) — install via [rustup](https://rustup.rs/):
  ```sh
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
  ```
- **Linux (Fedora) system libs** for Tauri (desktop only) — Debian/Ubuntu equivalents exist; see the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/):
  ```sh
  sudo dnf install webkit2gtk4.1-devel librsvg2-devel libappindicator-gtk3-devel gtk3-devel openssl-devel patchelf
  ```

### Install & verify

```sh
pnpm install           # workspace deps (hoisted node_modules)
pnpm test              # Vitest suite in packages/core (30 tests)
pnpm -r typecheck      # core + app type checks
```

### Mobile app (Expo)

```sh
cd apps/mobile
pnpm start       # Metro dev server → scan the QR to run on a device
pnpm android     # or Launch Android emulator
```

### Desktop app (Tauri)

```sh
pnpm dev:desktop     # re-export the web bundle, open the Tauri dev window
pnpm build:desktop   # re-export the web bundle, build release + installers
```

Release artifacts land in `apps/desktop/src-tauri/target/release/bundle/`:

- `deb/CutList Planner_*.deb` and `rpm/CutList Planner-*.rpm` — Linux installers
- `appimage/CutList Planner_*.AppImage` — portable Linux app (bundling needs FUSE on the display; deb/rpm build fine headless)
- `cutlist-planner-desktop` — the raw binary

The desktop app is a native shell around the mobile web export: `pnpm build:desktop` re-runs `expo export -p web` into `apps/mobile/dist`, which `src-tauri/tauri.conf.json` (`frontendDist`) points at.

## Decision history

- **One app, no CLI** (per spec): mobile + desktop share a single UI codebase and the pure-TS core.
- **Mobile-native first** (chosen over PWA): Expo targets iOS/Android; the same UI's web export is later wrapped by Tauri for Windows/Linux desktop.
- **Core shared across platforms**: all math lives in `packages/core` (environment-agnostic, Vitest-tested); the app is a thin consumer. Keeps the future ML photo step pluggable per spec.
- **pnpm 12 hard constraints**: `nodeLinker: hoisted` + `allowBuilds` (esbuild) in `pnpm-workspace.yaml`. Changing anything there = regenerate lockfile/node_modules.
- **NativeWind pinned**: `react-native-css-interop@0.2.6` kept as a direct dep, version-locked to NativeWind's requirement, because pnpm-laid-out Metro resolution needs it resolvable from the app.
- **Nester modeling**: sheets use effective part sizes inflated by kerf inside a sheet inflated by one kerf (adjacent parts always keep a saw-kerf gap); boards are treated as strip stock ripped into lanes (minimum rip width set by the first piece in the lane) and crosscut inside a lane. Constants/tuning live in `packages/core/src/nesting.ts`.

See [USAGE.md](USAGE.md) for installation and usage.