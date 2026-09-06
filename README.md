# CutListPlannerAndVisualizer

> Plan, optimize, and visualize cut lists for woodworking — from an idea or a photo.

**Status: pre-alpha / specification only.** No code has been written yet. This document describes the intended design and roadmap. See [USAGE.md](USAGE.md) for the intended workflow and instructions.

## Motivation

Every woodworker knows the problem: scattered notes, parts left unplanned, and lumber that ends up as offcuts nobody remembers. This tool aims to answer three questions before you touch a saw:

1. **How much stock do I need?** (and what does it cost in board-ft?)
2. **What is the least-waste way to cut it?**
3. **What did that finished project actually consume?**

## Features

- **Cut-list tracking** — catalog parts: description, quantity, dimensions, grain direction, and which stock they come from.
- **Waste optimization** — computes low-waste layouts for two kinds of stock:
  - **Rough lumber** sold by the board-foot (L × W × T).
  - **Sheet goods** (plywood, MDF, panel stock) laid out on rectangular panels.
- **Cut visualization** — an interactive on-screen layout of boards/sheets showing each part, the saw kerf, and the leftover waste.
- **Photo → board-ft estimation** with two modes:
  - **Mode A — "what did it cost"**: import a photo of a finished project and get a board-ft estimate of what it consumed.
  - **Mode B — part extraction**: load a photo, annotate part boundaries on screen (plus an optional scale reference), and derive a part list with board-ft. Uses NiceGUI's built-in image annotation.
  - Designed so a future ML step can detect part boundaries automatically, plugging in without rewriting Mode B.

## How it works

Everything lives in one web app; there are no separate CLI commands.

1. **Catalog parts** — enter your cut list in the web UI (or start from Mode B photo annotation).
2. **Add stock** — list the boards and sheets you have or plan to buy.
3. **Optimize** — the tool places parts onto stock, minimizing waste and honoring grain direction and kerf.
4. **Visualize** — review the interactive layout on screen and export it with cuts and dimensions labeled.
5. **Estimate (photos)** — snap a photo of an existing project with your phone and let the tool estimate its board-ft consumption.

## Roadmap

| Phase | Scope | Status |
|-------|-------|--------|
| 1 | Cut-list & stock tracking (plain Python data model, NiceGUI web UI, CSV in/out) | planned |
| 2 | Optimization engine (board-ft nester + sheet nester, kerf & grain aware) | planned |
| 3 | Interactive visualization (layout diagrams on screen) | planned |
| 4 | Photo modes A & B (semi-automatic annotation) | planned |
| 5 | Automatic part detection via ML (plugs into Mode B) | future |

## Tech

Python 3.11+ with **NiceGUI** — a pure-Python web UI, no JavaScript. The app runs in any browser, including on a phone, and is entirely Python under the hood.

Future ML work stays Python-side (OpenCV/torch), so model changes never touch the UI.

## Decision history

- **NiceGUI over Flet / JS frameworks.** Flet (Flutter-backed) offers touch-native widgets and mobile packaging, but weaker image annotation and needs a Mac for iOS builds. A JavaScript framework (e.g. React/Vue) gives the best raw canvas UX but splits the project across two languages. NiceGUI keeps a single Python stack while covering phone browsers, photo annotation, and interactive visualization.
- **Web UI over CLI.** A command-line tool can't capture photos or trace parts at the workbench. The CLI idea was dropped in favor of a mobile-responsive web interface as the only interface.

See [USAGE.md](USAGE.md) for installation and usage.