# Usage & Instructions

> **Status: pre-alpha / specification only.** Nothing here is implemented yet. This file describes the intended install steps, input formats, interface, and output — the contract that the tool will implement.

## Planned installation

Requires Python 3.11+.

```bash
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt    # deps include: nicegui, image handling, visualization
```

Intended dependency areas (final list not yet chosen): NiceGUI for the web UI, image loading/annotation support, and layout rendering for the visualizer.

## Running it

Launch the web app:

```bash
cutplan
```

Open `http://localhost:8080` in a desktop browser. To use it on a phone, run it with the host bind or make sure both devices are on the same network, then open `http://<your-computer-ip>:8080` in the phone's browser.

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

## Web interface

The whole tool is one web app organized into four views. No command line needed.

- **Cut List** — enter/edit parts (description, quantity, dimensions, grain, stock assignment); import/export via CSV.
- **Stock** — manage boards and sheets (type, name, dimensions, qty, price).
- **Layout** — run the optimizer and review the interactive board/sheet diagrams, showing each part, kerf, and offcut (waste) regions.
- **Photo → Board-Ft** — two modes:
  - **Mode A ("what did it cost")**: upload photos of a finished project, answer a couple of material-depth questions, and get an approximate total board-ft.
  - **Mode B (part extraction)**: upload a photo, trace each visible part on screen, optionally set a scale reference, and export a proper cut list — ready to feed back into the Cut List view.

## Photo mode walkthrough

1. Open the **Photo → Board-Ft** view on your phone, take or upload a photo.

2. **Mode A**: point at photos of the finished project. The tool asks for material-depth assumptions and reports approximate total board-ft. Intended for "what did this cost me, roughly."

3. **Mode B**: draw a box around each visible part on the photo (and optionally a scale reference, e.g. a taped-on ruler), tag it, and export a cut list with board-ft. Works **unscaled** if no reference is given, using the drawn proportions against assumed thickness.

4. Future: automated boundary detection (ML) pre-fills the traced boxes; the manual trace remains the fallback. The photo pipeline keeps this separation so the UI doesn't change.

## Planned outputs

- **Cut list**: quantities, dims, stock assignment, and per-part board-ft.
- **Summary**: stock purchased vs. used, total board-ft, and waste percentage.
- **Layout**: visual board/sheet diagram with kerf and offcut regions marked.

## Roadmap

1. Tracking (MVP) → 2. Optimization → 3. Visualization → 4. Photo modes → 5. ML auto-detection.

## Contributing

The project is not yet implemented. Feature requests, hardware notes, or real-world test cut lists are welcome — open an issue or attach sample photos.

See [README.md](README.md) for the vision and tech decisions.