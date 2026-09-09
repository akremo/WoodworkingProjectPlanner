import { describe, expect, it } from "vitest";
import type { Part, Stock } from "./models";
import { applyPartEdits, applyPartMoves, applyPartRotations, canPlacePartOnStock, layoutUsed, layoutViolations, layoutWaste, nestBoards, nestSheets, optimizeCutList, recomputeOffcuts, resawLayers, type Offcut, type PlacedPart, type StockLayout } from "./nesting";

function part(name: string, length: number, width: number, thickness: number, overrides: Partial<Part> = {}): Part {
  return { id: name, name, quantity: 1, length, width, thickness, grain: "no_matter", woodType: "", costPerBdFt: 0, ...overrides };
}

function board(name: string, length: number, width: number, thickness: number, overrides: Partial<Stock> = {}): Stock {
  return { id: name, type: "board", name, length, width, thickness, qty: 1, price: 0, woodType: "", costPerBdFt: 0, ...overrides };
}

function sheet(name: string, length: number, width: number, thickness: number, overrides: Partial<Stock> = {}): Stock {
  return { id: name, type: "sheet", name, length, width, thickness, qty: 1, price: 0, woodType: "", costPerBdFt: 0, ...overrides };
}

function layoutFixture(stock: Stock, parts: PlacedPart[]): StockLayout {
  return { stockId: `${stock.id}#1`, stock, parts, offcuts: [], sourceMode: "exact", sourceStock: stock, sourceLayers: 1, usedPercent: 0 };
}

function placed(partId: string, name: string, x: number, y: number, width: number, height: number, overrides: Partial<PlacedPart> = {}): PlacedPart {
  return { partId, partName: name, stockId: `${name}#1`, x, y, width, height, rotated: false, grain: "no_matter" as const, thickness: 0.75, ...overrides };
}

function assertNoOverlapsOrOutOfBounds(layouts: StockLayout[], kerf: number): void {
  for (const layout of layouts) {
    const { stock, parts } = layout;
    for (const a of parts) {
      expect(a.x).toBeGreaterThanOrEqual(0);
      expect(a.y).toBeGreaterThanOrEqual(0);
      expect(a.x + a.width).toBeLessThanOrEqual(stock.length + 1e-9);
      expect(a.y + a.height).toBeLessThanOrEqual(stock.width + 1e-9);
    }
    for (let i = 0; i < parts.length; i++) {
      for (let j = i + 1; j < parts.length; j++) {
        const a = parts[i];
        const b = parts[j];
        const overlapX = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
        const overlapY = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
        if (overlapX > 1e-9 && overlapY > 1e-9) {
          expect.fail(`parts overlap on ${layout.stockId}: ${a.partName} vs ${b.partName}`);
        }
      }
    }
    void kerf;
  }
}

function assertKerfSeparation(layouts: StockLayout[], kerf: number): void {
  for (const layout of layouts) {
    const parts: PlacedPart[] = layout.parts;
    for (let i = 0; i < parts.length; i++) {
      for (let j = i + 1; j < parts.length; j++) {
        const a = parts[i];
        const b = parts[j];
        const overlapX = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
        const overlapY = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
        if (overlapX > 1e-9 && overlapY > 1e-9) {
          expect.fail(`parts overlap on ${layout.stockId}: ${a.partName} vs ${b.partName}`);
        }
        if (overlapX > 1e-9 && overlapY <= 1e-9) {
          const gap = Math.abs(b.y - (a.y + a.height)) || Math.abs(a.y - (b.y + b.height));
          expect(gap).toBeGreaterThanOrEqual(kerf - 1e-9);
        }
        if (overlapY > 1e-9 && overlapX <= 1e-9) {
          const gap = Math.abs(b.x - (a.x + a.width)) || Math.abs(a.x - (b.x + b.width));
          expect(gap).toBeGreaterThanOrEqual(kerf - 1e-9);
        }
      }
    }
  }
}

describe("nestSheets", () => {
  it("packs identical panels into one sheet", () => {
    const { layouts, leftover } = nestSheets([part("p1", 12, 12, 0.75), part("p2", 12, 12, 0.75)], [sheet("ply", 96, 48, 0.75)], 0.125);
    expect(leftover).toHaveLength(0);
    expect(layouts[0].parts).toHaveLength(2);
  });

  it("respects lengthwise grain (no rotation) and along_width grain (rotates)", () => {
    const { layouts, leftover } = nestSheets(
      [part("a", 60, 30, 0.75, { grain: "lengthwise" }), part("b", 40, 24, 0.75, { grain: "along_width" })],
      [sheet("ply", 96, 48, 0.75)],
      0,
    );
    expect(leftover).toHaveLength(0);
    const a = layouts[0].parts.find((p) => p.partId === "a");
    const b = layouts[0].parts.find((p) => p.partId === "b");
    expect(a?.rotated).toBe(false);
    expect(a?.width).toBe(60);
    expect(b?.rotated).toBe(true);
    expect(b?.width).toBe(24);
    expect(b?.height).toBe(40);
  });

  it("keeps a kerf gap between adjacent parts", () => {
    const { layouts } = nestSheets([part("p1", 20, 20, 0.75), part("p2", 20, 20, 0.75)], [sheet("ply", 60, 48, 0.75)], 0.25);
    assertKerfSeparation(layouts, 0.25);
  });

  it("does not place a part that is too large", () => {
    const { layouts, leftover } = nestSheets([part("big", 100, 100, 0.75)], [sheet("ply", 96, 48, 0.75)], 0.125);
    expect(leftover).toHaveLength(1);
    expect(layouts[0].parts).toHaveLength(0);
  });
});

describe("nestBoards", () => {
  it("rips lanes across a board and crosscuts within a lane", () => {
    const { layouts, leftover } = nestBoards(
      [part("a1", 24, 2.5, 1), part("a2", 24, 2.5, 1), part("c", 18, 2, 1)],
      [board("walnut", 96, 5.5, 1)],
      0.125,
    );
    expect(leftover).toHaveLength(0);
    const placed = layouts[0].parts;
    expect(placed).toHaveLength(3);
    assertNoOverlapsOrOutOfBounds(layouts, 0.125);
  });

  it("starts a second lane with kerf between lanes", () => {
    const { layouts } = nestBoards(
      [part("a", 24, 2.5, 1), part("b", 20, 2, 1)],
      [board("oak", 96, 7, 1)],
      0.125,
    );
    const placed = layouts[0].parts;
    expect(placed).toHaveLength(2);
    const a = placed.find((p) => p.partId === "a")!;
    const b = placed.find((p) => p.partId === "b")!;
    expect(Math.abs(b.x - (a.x + a.width)) || Math.abs(a.x - (b.x + b.width))).toBeGreaterThanOrEqual(0.125 - 1e-9);
  });

  it("reports parts that cannot fit in any lane", () => {
    const { layouts, leftover } = nestBoards(
      [part("a", 24, 5.5, 1), part("b", 24, 6, 1)],
      [board("walnut", 96, 5.5, 1)],
      0.125,
    );
    expect(layouts[0].parts).toHaveLength(1);
    expect(leftover).toHaveLength(1);
    expect(leftover[0].name).toBe("b");
  });

  it("never places a part longer than the board (no overhang)", () => {
    const { layouts, leftover } = nestBoards(
      [part("long", 70, 4, 0.75), part("ok", 24, 4, 0.75)],
      [board("short", 60, 8, 0.75)],
      0.125,
    );
    expect(layouts[0].parts).toHaveLength(1);
    expect(layouts[0].parts[0].partId).toBe("ok");
    assertNoOverlapsOrOutOfBounds(layouts, 0.125);
    expect(leftover).toHaveLength(1);
    expect(leftover[0].name).toBe("long");
  });

  it("rotates a part to use leftover length in an existing lane", () => {
    const { layouts, leftover } = nestBoards(
      [part("wide", 54, 10, 0.75), part("cross", 9, 4, 0.75)],
      [board("b", 60, 10, 0.75)],
      0.125,
    );
    expect(leftover).toHaveLength(0);
    const wide = layouts[0].parts.find((p) => p.partId === "wide")!;
    const cross = layouts[0].parts.find((p) => p.partId === "cross")!;
    // 54″ rip leaves 5.5″ (kerf-adjusted); the 9×4 overturns to 4×9 to fit it.
    expect(wide.rotated).toBe(false);
    expect(cross.rotated).toBe(true);
    expect(cross.width).toBe(4);
    expect(cross.x).toBeCloseTo(54.125, 6);
    expect(cross.y).toBe(0);
    assertNoOverlapsOrOutOfBounds(layouts, 0.125);
  });
});

describe("optimizeCutList", () => {
  it("matches parts to boards and sheets by thickness", () => {
    const { layouts, unplaced, stats } = optimizeCutList({
      parts: [part("ap1", 24, 2.5, 1), part("ap2", 24, 2.5, 1), part("sp1", 24, 12, 0.75)],
      stock: [board("walnut", 96, 5.5, 1), sheet("ply", 96, 48, 0.75)],
      kerf: 0.125,
    });
    expect(unplaced).toHaveLength(0);
    expect(stats.partsPlaced).toBe(3);
    const boardLayout = layouts.find((l) => l.stock.type === "board")!;
    const sheetLayout = layouts.find((l) => l.stock.type === "sheet")!;
    expect(boardLayout.parts).toHaveLength(2);
    expect(sheetLayout.parts).toHaveLength(1);
    assertNoOverlapsOrOutOfBounds(layouts, 0.125);
  });

  it("expands quantities of parts and stock", () => {
    const { layouts, stats } = optimizeCutList({
      parts: [part("leg", 30, 2.5, 1, { quantity: 4, grain: "lengthwise" })],
      stock: [board("oak", 96, 5.5, 1, { qty: 2 })],
      kerf: 0,
    });
    expect(stats.partsPlaced).toBe(4);
    const placed = layouts.flatMap((l) => l.parts);
    expect(placed).toHaveLength(4);
    expect(new Set(placed.map((p) => p.stockId)).size).toBeGreaterThan(0);
    assertNoOverlapsOrOutOfBounds(layouts, 0);
  });

  it("computes board-foot usage and waste", () => {
    const { stats } = optimizeCutList({
      parts: [part("p1", 24, 2.5, 1), part("p2", 20, 2.5, 1)],
      stock: [board("walnut", 96, 5.5, 1)],
      kerf: 0,
    });
    const bought = (96 * 5.5 * 1) / 144;
    const used = (24 * 2.5 * 1 + 20 * 2.5 * 1) / 144;
    expect(stats.board.boughtBdFt).toBeCloseTo(bought, 6);
    expect(stats.board.usedBdFt).toBeCloseTo(used, 6);
    expect(stats.board.wasteBdFt).toBeCloseTo(bought - used, 6);
  });

  it("marks parts with no matching stock thickness as unplaced", () => {
    const { layouts, unplaced } = optimizeCutList({
      parts: [part("dado", 24, 3, 1.5)],
      stock: [board("walnut", 96, 5.5, 1)],
    });
    expect(layouts).toHaveLength(1);
    expect(layouts[0].parts).toHaveLength(0);
    expect(unplaced).toHaveLength(1);
    expect(unplaced[0].reason).toBe("no_stock");
  });

  it("sends board overflow parts to a matching sheet as fallback", () => {
    const { layouts, stats } = optimizeCutList({
      parts: [part("wide", 40, 10, 0.75)],
      stock: [board("spruce", 96, 5.5, 0.75), sheet("ply", 96, 48, 0.75)],
      kerf: 0,
    });
    expect(stats.partsPlaced).toBe(1);
    const onSheet = layouts.find((l) => l.stock.type === "sheet")!;
    expect(onSheet.parts).toHaveLength(1);
  });

  it("rejects invalid kerf", () => {
    expect(() => optimizeCutList({ parts: [], stock: [], kerf: -1 })).toThrow(RangeError);
  });

  it("excludes fully unused stock from bought totals and waste", () => {
    const { layouts, stats } = optimizeCutList({
      parts: [part("sp1", 12, 8, 0.75)],
      stock: [sheet("ply", 96, 48, 0.75), sheet("extra", 96, 48, 0.75), board("oak", 96, 5.5, 1)],
      kerf: 0,
    });
    const usedSheet = layouts.find((l) => l.stock.name === "ply")!;
    const unusedSheet = layouts.find((l) => l.stock.name === "extra")!;
    const unusedBoard = layouts.find((l) => l.stock.type === "board")!;
    expect(usedSheet.parts).toHaveLength(1);
    expect(unusedSheet.parts).toHaveLength(0);
    expect(unusedBoard.parts).toHaveLength(0);
    // Only the sheet that received parts counts toward total/waste.
    expect(stats.sheet.totalArea).toBeCloseTo(96 * 48, 6);
    expect(stats.sheet.usedArea).toBeCloseTo(12 * 8, 6);
    expect(stats.sheet.wastePercent).toBeCloseTo((1 - (12 * 8) / (96 * 48)) * 100, 6);
    expect(stats.board.boughtBdFt).toBe(0);
    expect(stats.board.wasteBdFt).toBe(0);
  });
});

describe("resawLayers", () => {
  it("counts exact match as one layer and rejects thinner stock", () => {
    expect(resawLayers(0.75, 0.75, 0.125)).toBe(1);
    expect(resawLayers(1, 0.75, 0.125)).toBe(1);
    expect(resawLayers(0.5, 0.75, 0.125)).toBe(0);
  });

  it("accounts for resaw kerf between layers", () => {
    expect(resawLayers(2, 0.75, 0.125)).toBe(2);
    expect(resawLayers(4, 1, 0.1)).toBe(3);
    expect(resawLayers(4, 1, 0.9)).toBe(2);
  });
});

describe("optimizeCutList planing & resawing", () => {
  it("planes a thick board down for thinner parts (one layer)", () => {
    const { layouts, stats, unplaced } = optimizeCutList({
      parts: [part("skid", 24, 2.5, 0.75)],
      stock: [board("big", 48, 4.5, 1)],
      kerf: 0.125,
    });
    expect(unplaced).toHaveLength(0);
    expect(stats.partsPlaced).toBe(1);
    expect(stats.plane.boardsPlaned).toBe(1);
    const layout = layouts[0];
    expect(layout.sourceMode).toBe("plane");
    expect(layout.sourceLayers).toBe(1);
    expect(layout.stock.thickness).toBe(0.75);
    expect(layout.sourceStock.thickness).toBe(1);
    // bought bd-ft is the physical (1") board, once.
    expect(stats.board.boughtBdFt).toBeCloseTo((48 * 4.5 * 1) / 144, 6);
    assertNoOverlapsOrOutOfBounds(layouts, 0.125);
  });

  it("resaaws a 2″ board into two ¾″ layers", () => {
    const { layouts, stats, unplaced } = optimizeCutList({
      parts: [part("p1", 24, 2.5, 0.75), part("p2", 24, 2.5, 0.75)],
      stock: [board("big", 48, 4.5, 2)],
      kerf: 0.125,
    });
    expect(unplaced).toHaveLength(0);
    expect(stats.partsPlaced).toBe(2);
    expect(stats.resaw.boardsResawn).toBe(1);
    expect(stats.resaw.layersCreated).toBe(2);
    const resawn = layouts.filter((l) => l.sourceMode === "resaw");
    expect(resawn).toHaveLength(2);
    expect(resawn[0].sourceLayers).toBe(2);
    expect(resawn[0].stock.thickness).toBe(0.75);
    expect(resawn[0].sourceStock.thickness).toBe(2);
    // physical board counted once even though it produced two layers.
    expect(stats.board.boughtBdFt).toBeCloseTo((48 * 4.5 * 2) / 144, 6);
    // each ¾″ layer only holds a 24×2.5 rip: its leftover is that layer's waste
    // (the resawn board itself is not wasted).
    const layer = (48 * 4.5 * 0.75) / 144;
    const partFoot = (24 * 2.5 * 0.75) / 144;
    expect(stats.board.wasteBdFt).toBeCloseTo(2 * (layer - partFoot), 6);
    assertNoOverlapsOrOutOfBounds(layouts, 0.125);
  });

  it("attributes waste only to the resaw layer that has pieces on it", () => {
    const { stats } = optimizeCutList({
      parts: [part("big1", 48, 4.5, 0.75), part("half", 24, 4.5, 0.75)],
      stock: [board("big", 48, 4.5, 2)],
      kerf: 0,
    });
    // 2″ board resawn into two ¾″ layers: one full, one half — waste is the
    // leftover on the half layer only, not the idle remainder of the source.
    const layer = (48 * 4.5 * 0.75) / 144;
    expect(stats.board.boughtBdFt).toBeCloseTo((48 * 4.5 * 2) / 144, 6);
    expect(stats.board.wasteBdFt).toBeCloseTo(layer / 2, 6);
    expect(stats.board.wastePercent).toBeCloseTo((layer / 2 / ((48 * 4.5 * 2) / 144)) * 100, 6);
  });

  it("resaw kerf changes how many layers a board yields", () => {
    const parts = [part("a", 24, 2.5, 1), part("b", 24, 2.5, 1), part("c", 24, 2.5, 1)];
    const stock = [board("big", 48, 4.5, 4)];
    const thin = optimizeCutList({ parts, stock, kerf: 0.125, resawKerf: 0.1 });
    expect(thin.stats.partsPlaced).toBe(3);
    expect(thin.stats.resaw.layersCreated).toBe(3);
    const fat = optimizeCutList({ parts, stock, kerf: 0.125, resawKerf: 1.5 });
    expect(fat.stats.partsPlaced).toBe(2);
    expect(fat.stats.resaw.layersCreated).toBe(2);
  });

  it("commits a board to the thickest part bucket first", () => {
    const { unplaced } = optimizeCutList({
      parts: [part("thick", 24, 2.5, 1), part("thin", 24, 2.5, 0.75)],
      stock: [board("sixqtr", 48, 4.5, 1.5)],
      kerf: 0.125,
    });
    // 6/4 only planes to one 1″ layer (or one ¾″ layer); first-come wins.
    expect(unplaced).toHaveLength(1);
    expect(unplaced[0].partName).toBe("thin");
    expect(unplaced[0].reason).toBe("no_stock");
  });
});

describe("StockLayout.usedPercent", () => {
  it("reports a sheet's consumed area as a percentage", () => {
    const { layouts } = nestSheets([part("p", 24, 12, 0.75)], [sheet("ply", 96, 48, 0.75)], 0.125);
    const used = (24 * 12) / (96 * 48) * 100;
    expect(layouts[0].usedPercent).toBeCloseTo(used, 6);
  });

  it("reports an exact board's consumed board-feet as a percentage", () => {
    const { layouts } = nestBoards([part("p", 24, 2.5, 1)], [board("walnut", 96, 5.5, 1)], 0.125);
    const used = (24 * 2.5 * 1) / (96 * 5.5 * 1) * 100;
    expect(layouts[0].usedPercent).toBeCloseTo(used, 6);
  });

  it("reports a resawn layer's utilization against the layer itself", () => {
    const { layouts } = optimizeCutList({
      parts: [part("p1", 48, 4.5, 0.75), part("p2", 48, 4.5, 0.75)],
      stock: [board("big", 48, 4.5, 2)],
      kerf: 0.125,
    });
    const resawn = layouts.filter((l) => l.sourceMode === "resaw");
    expect(resawn).toHaveLength(2);
    for (const l of resawn) {
      expect(l.sourceStock.thickness).toBe(2);
      // A full ¾″ layer is 100% of that layer — a resawn board is not waste.
      expect(l.usedPercent).toBeCloseTo(100, 6);
    }
  });

  it("reports 0 for stock boards that no part lands on", () => {
    const { layouts } = optimizeCutList({
      parts: [part("p", 24, 2.5, 1)],
      stock: [board("used", 96, 5.5, 1), board("spare", 96, 5.5, 1)],
      kerf: 0.125,
    });
    const spare = layouts.find((l) => l.stock.name === "spare")!;
    expect(spare.parts).toHaveLength(0);
    expect(spare.usedPercent).toBe(0);
  });

  it("counts overlapping parts once (union footprint)", () => {
    const { layouts } = nestSheets([part("a", 24, 24, 0.75), part("b", 24, 24, 0.75)], [sheet("ply", 48, 48, 0.75)], 0);
    layouts[0].parts = [{ ...layouts[0].parts[0], x: 0, y: 0 }, { ...layouts[0].parts[1], x: 0, y: 0 }];
    const overlapped = applyPartMoves(layouts[0], { [layouts[0].parts[1].partId]: { x: 0, y: 0 } });
    expect(overlapped.usedPercent).toBeCloseTo((24 * 24) / (48 * 48) * 100, 6);
  });
});

describe("applyPartMoves", () => {
  it("moves a part and recomputes usedPercent", () => {
    const { layouts } = nestSheets([part("a", 24, 24, 0.75)], [sheet("ply", 96, 48, 0.75)], 0.125);
    const moved = applyPartMoves(layouts[0], { [layouts[0].parts[0].partId]: { x: 60, y: 30 } });
    expect(moved).not.toBe(layouts[0]);
    expect(moved.parts[0].x).toBe(60);
    expect(moved.parts[0].y).toBe(30);
    expect(moved.usedPercent).toBeCloseTo((24 * 24) / (96 * 48) * 100, 6);
  });

  it("returns the same layout when no moves apply", () => {
    const { layouts } = nestSheets([part("a", 24, 24, 0.75)], [sheet("ply", 96, 48, 0.75)], 0.125);
    expect(applyPartMoves(layouts[0], {})).toBe(layouts[0]);
  });
});

describe("layoutUsed", () => {
  it("reports area consumed for sheets", () => {
    const { layouts } = nestSheets([part("a", 24, 24, 0.75)], [sheet("ply", 96, 48, 0.75)], 0.125);
    expect(layoutUsed(layouts[0]).area).toBeCloseTo(24 * 24, 6);
    expect(layoutUsed(layouts[0]).bdFt).toBe(0);
  });

  it("reports board-ft consumed against the physical resawn board", () => {
    const { layouts } = optimizeCutList({
      parts: [part("p1", 48, 4.5, 0.75), part("p2", 48, 4.5, 0.75)],
      stock: [board("big", 48, 4.5, 2)],
      kerf: 0.125,
    });
    const resawn = layouts.find((l) => l.sourceMode === "resaw")!;
    const { bdFt } = layoutUsed(resawn);
    expect(bdFt).toBeCloseTo(48 * 4.5 * 0.75 / 144, 6);
  });

  it("shrinks when parts are moved to overlap", () => {
    const { layouts } = nestSheets([part("a", 24, 24, 0.75), part("b", 24, 24, 0.75)], [sheet("ply", 96, 48, 0.75)], 0.125);
    const base = layoutUsed(layouts[0]).area;
    const stacked = applyPartMoves(layouts[0], { [layouts[0].parts[1].partId]: { x: 0, y: 0 } });
    expect(layoutUsed(stacked).area).toBeCloseTo(24 * 24, 6);
    expect(layoutUsed(stacked).area).toBeLessThan(base);
  });
});

describe("layoutWaste", () => {
  it("reports leftover board-feet of an exact board", () => {
    const { layouts } = nestBoards([part("p", 24, 2.5, 1)], [board("walnut", 96, 5.5, 1)], 0.125);
    const w = layoutWaste(layouts[0]);
    expect(w.bdFt).toBeCloseTo((96 * 5.5 * 1 - 24 * 2.5 * 1) / 144, 6);
    expect(w.area).toBe(0);
  });

  it("counts zero waste for a fully consumed resawn layer", () => {
    const { layouts } = optimizeCutList({
      parts: [part("p", 48, 4.5, 0.75)],
      stock: [board("big", 48, 4.5, 2)],
      kerf: 0.125,
    });
    const layer = layouts.find((l) => l.sourceMode === "resaw")!;
    expect(layoutWaste(layer).bdFt).toBeCloseTo(0, 6);
  });

  it("keeps a planed board's waste against the physical source (plane loss counts)", () => {
    const { layouts } = optimizeCutList({
      parts: [part("skid", 24, 2.5, 0.75)],
      stock: [board("big", 48, 4.5, 1)],
      kerf: 0.125,
    });
    const planed = layouts[0];
    const w = layoutWaste(planed);
    expect(w.bdFt).toBeCloseTo((48 * 4.5 * 1 - 24 * 2.5 * 0.75) / 144, 6);
  });

  it("reports leftover area for sheets", () => {
    const { layouts } = nestSheets([part("p", 24, 12, 0.75)], [sheet("ply", 96, 48, 0.75)], 0.125);
    const w = layoutWaste(layouts[0]);
    expect(w.area).toBeCloseTo(96 * 48 - 24 * 12, 6);
    expect(w.bdFt).toBe(0);
  });
});

describe("nesting efficiency", () => {
  it("drops trailing empty resaw layers so no empty layer cards appear", () => {
    const { layouts, stats, unplaced } = optimizeCutList({
      parts: [part("single", 24, 2.5, 0.75)],
      stock: [board("big", 48, 4.5, 4)],
      kerf: 0.125,
    });
    expect(unplaced).toHaveLength(0);
    expect(stats.partsPlaced).toBe(1);
    expect(stats.resaw.boardsResawn).toBe(1);
    expect(stats.resaw.layersCreated).toBe(1);
    expect(layouts).toHaveLength(1);
    expect(layouts[0].sourceMode).toBe("resaw");
    expect(layouts[0].parts).toHaveLength(1);
    expect(layouts[0].sourceLayers).toBe(1);
  });

  it("keeps an untouched board available for a thinner thickness bucket", () => {
    const { layouts, stats, unplaced } = optimizeCutList({
      parts: [part("thick", 24, 2.5, 1.5), part("thin", 24, 2.5, 0.75)],
      stock: [board("one", 48, 4.5, 1.5), board("two", 48, 4.5, 1.5)],
      kerf: 0.125,
    });
    expect(unplaced).toHaveLength(0);
    expect(stats.partsPlaced).toBe(2);
    const exact = layouts.find((l) => l.sourceMode === "exact")!;
    const planed = layouts.find((l) => l.sourceMode === "plane")!;
    expect(exact.parts[0].partName).toBe("thick");
    expect(planed.parts[0].partName).toBe("thin");
    expect(planed.sourceStock.thickness).toBe(1.5);
    // both committed boards received parts — no empty board cards.
    expect(layouts.every((l) => l.parts.length > 0)).toBe(true);
    assertNoOverlapsOrOutOfBounds(layouts, 0.125);
  });

  it("crosscuts select the fullest lane (least end waste), not just the first", () => {
    const { layouts, leftover } = nestBoards(
      [
        part("a", 25, 5, 1),
        part("d", 24, 6, 1),
        part("b", 24, 6, 1),
        part("c", 24, 5, 1),
        part("f", 9, 6, 1),
        part("g", 2, 4, 1),
      ],
      [board("board", 60, 12, 1)],
      0.125,
    );
    expect(leftover).toHaveLength(0);
    const g = layouts[0].parts.find((p) => p.partId === "g")!;
    // Lane 2 is fuller (used 57.25″ vs lane 1's 49.125″) so the 2″ probe lands
    // there, leaving lane 1's 10.875″ intact instead of burning it on a sliver.
    expect(g.x).toBeCloseTo(57.375, 6);
    expect(g.y).toBeCloseTo(5.125, 6);
  });

  it("never leaves a free region overlapping a placed part on a sheet", () => {
    const { layouts, leftover } = nestSheets(
      [part("p1", 12, 12, 0.75), part("p2", 18, 9, 0.75), part("p3", 30, 6, 0.75), part("p4", 10, 14, 0.75), part("p5", 8, 8, 0.75)],
      [sheet("ply", 96, 48, 0.75)],
      0.125,
    );
    expect(leftover).toHaveLength(0);
    expect(layouts[0].parts).toHaveLength(5);
    const { parts, offcuts } = layouts[0];
    for (const o of offcuts) {
      for (const p of parts) {
        const ox = Math.max(0, Math.min(o.x + o.width, p.x + p.width) - Math.max(o.x, p.x));
        const oy = Math.max(0, Math.min(o.y + o.height, p.y + p.height) - Math.max(o.y, p.y));
        expect(Math.min(ox, oy)).toBeLessThanOrEqual(1e-9);
      }
    }
    assertNoOverlapsOrOutOfBounds(layouts, 0.125);
  });
});

describe("layoutViolations", () => {
  it("flags a part pushed off the stock edge", () => {
    const { layouts } = nestSheets([part("a", 24, 24, 0.75)], [sheet("ply", 96, 48, 0.75)], 0.125);
    const moved = applyPartMoves(layouts[0], { [layouts[0].parts[0].partId]: { x: 90, y: 40 } });
    const v = layoutViolations(moved, 0.125);
    expect(v[layouts[0].parts[0].partId]).toContain("out_of_bounds");
  });

  it("flags two parts dropped on the same spot", () => {
    const { layouts } = nestSheets(
      [part("a", 24, 24, 0.75), part("b", 24, 24, 0.75)],
      [sheet("ply", 96, 48, 0.75)],
      0.125,
    );
    const stacked = applyPartMoves(layouts[0], { [layouts[0].parts[1].partId]: { x: 0, y: 0 } });
    const v = layoutViolations(stacked, 0.125);
    expect(v[layouts[0].parts[0].partId]).toContain("overlap");
    expect(v[layouts[0].parts[1].partId]).toContain("overlap");
  });

  it("flags two parts too close for the kerf", () => {
    const stock = sheet("ply", 96, 48, 0.75, { qty: 1 });
    const layout = layoutFixture(stock, [
      placed("a#1", "a", 0, 0, 12, 12),
      placed("b#1", "b", 12.05, 0, 12, 12),
    ]);
    const v = layoutViolations(layout, 0.125);
    expect(v["a#1"]).toContain("kerf");
    expect(v["b#1"]).toContain("kerf");
  });

  it("reports no violations for a clean nested layout", () => {
    const { layouts } = nestSheets(
      [part("a", 24, 24, 0.75), part("b", 24, 24, 0.75)],
      [sheet("ply", 96, 48, 0.75)],
      0.125,
    );
    expect(layoutViolations(layouts[0], 0.125)).toEqual({});
  });

  it("flags a lengthwise part that was rotated", () => {
    const stock = sheet("ply", 96, 48, 0.75, { qty: 1 });
    const layout = layoutFixture(stock, [placed("a#1", "a", 0, 0, 12, 24, { rotated: true, grain: "lengthwise" as const })]);
    const v = layoutViolations(layout, 0.125);
    expect(v["a#1"]).toContain("grain");
  });

  it("flags an along-width part that was un-rotated", () => {
    const stock = sheet("ply", 96, 48, 0.75, { qty: 1 });
    const layout = layoutFixture(stock, [placed("a#1", "a", 0, 0, 12, 24, { grain: "along_width" as const })]);
    const v = layoutViolations(layout, 0.125);
    expect(v["a#1"]).toContain("grain");
  });
});

describe("applyPartRotations", () => {
  it("swaps a part's footprint around its center and toggles rotated", () => {
    const stock = sheet("ply", 96, 48, 0.75, { qty: 1 });
    const layout = layoutFixture(stock, [placed("a#1", "a", 10, 10, 24, 12)]);
    const rotated = applyPartRotations(layout, { "a#1": true });
    const p = rotated.parts[0];
    expect(p.rotated).toBe(true);
    expect(p.width).toBe(12);
    expect(p.height).toBe(24);
    // center stays put
    expect(p.x + p.width / 2).toBeCloseTo(22, 6);
    expect(p.y + p.height / 2).toBeCloseTo(16, 6);
  });

  it("rotates back to the original orientation and restores dims", () => {
    const stock = sheet("ply", 96, 48, 0.75, { qty: 1 });
    const layout = applyPartRotations(layoutFixture(stock, [placed("a#1", "a", 10, 10, 24, 12)]), { "a#1": false });
    const p = layout.parts[0];
    expect(p.rotated).toBe(false);
    expect(p.width).toBe(24);
    expect(p.height).toBe(12);
  });

  it("clamps a rotated part back inside the stock and rotates cleanly back", () => {
    const stock = sheet("ply", 96, 48, 0.75, { qty: 1 });
    const orig = placed("a#1", "a", 70, 10, 24, 12);
    const rotated = applyPartRotations(layoutFixture(stock, [orig]), { "a#1": true });
    const p = rotated.parts[0];
    expect(p.width).toBe(12);
    expect(p.height).toBe(24);
    expect(p.x + p.width).toBeLessThanOrEqual(96 + 1e-9);
    expect(p.y + p.height).toBeLessThanOrEqual(48 + 1e-9);
    expect(applyPartRotations(rotated, { "a#1": false }).parts[0]).toEqual(orig);
  });

  it("leaves a grain-locked part untouched", () => {
    const stock = sheet("ply", 96, 48, 0.75, { qty: 1 });
    const layout = layoutFixture(stock, [placed("a#1", "a", 10, 10, 24, 12, { grain: "lengthwise" as const })]);
    expect(applyPartRotations(layout, { "a#1": true })).toBe(layout);
  });

  it("recomputes usedPercent after rotating", () => {
    const { layouts } = nestSheets([part("a", 24, 12, 0.75)], [sheet("ply", 96, 48, 0.75)], 0.125);
    const rotated = applyPartRotations(layouts[0], { [layouts[0].parts[0].partId]: true });
    expect(rotated.usedPercent).toBeCloseTo(layouts[0].usedPercent, 6);
  });
});

describe("canPlacePartOnStock", () => {
  it("matches board thickness exactly", () => {
    const p = placed("a#1", "a", 0, 0, 12, 12, { thickness: 1 });
    expect(canPlacePartOnStock(p, board("walnut", 96, 5.5, 1))).toBe(true);
    expect(canPlacePartOnStock(p, board("maple", 96, 5.5, 0.75))).toBe(false);
  });

  it("matches sheet thickness exactly", () => {
    const p = placed("a#1", "a", 0, 0, 12, 12, { thickness: 0.75 });
    expect(canPlacePartOnStock(p, sheet("ply", 96, 48, 0.75))).toBe(true);
    expect(canPlacePartOnStock(p, sheet("mdf", 96, 48, 0.5))).toBe(false);
  });
});

describe("applyPartEdits", () => {
  it("moves and rotates a part in place", () => {
    const { layouts } = nestSheets([part("a", 24, 12, 0.75)], [sheet("ply", 96, 48, 0.75)], 0.125);
    const id = layouts[0].parts[0].partId;
    const edited = applyPartEdits(layouts, { [id]: { x: 40, y: 20, rotated: true } });
    const p = edited[0].parts[0];
    expect(p.x).toBe(40);
    expect(p.y).toBe(20);
    expect(p.rotated).toBe(true);
    expect(p.width).toBe(12);
    expect(p.height).toBe(24);
  });

  it("relocates a part to another sheet of matching thickness", () => {
    const s1 = sheet("ply", 96, 48, 0.75);
    const s2 = sheet("baltic", 96, 48, 0.75);
    const { layouts } = nestSheets([part("a", 24, 24, 0.75)], [s1, s2], 0.125);
    const src = layouts[0];
    const dst = layouts[1];
    const id = src.parts[0].partId;
    const edited = applyPartEdits(layouts, { [id]: { stockId: dst.stockId, x: 10, y: 10 } });
    expect(edited[0].parts.find((p) => p.partId === id)).toBeUndefined();
    const moved = edited[1].parts.find((p) => p.partId === id);
    expect(moved).toBeDefined();
    expect(moved!.x).toBe(10);
    expect(moved!.y).toBe(10);
    expect(moved!.stockId).toBe(dst.stockId);
    expect(edited[0].usedPercent).toBe(0);
    expect(edited[1].usedPercent).toBeCloseTo((24 * 24) / (96 * 48) * 100, 6);
    // An emptied board clears out — no ghost offcuts left behind.
    expect(edited[0].offcuts).toEqual([{ x: 0, y: 0, width: s1.length, height: s1.width }]);
    // The destination's offcuts no longer cover the placed footprint.
    const offArea = (os: Offcut[]) => os.reduce((sum, o) => sum + o.width * o.height, 0);
    expect(offArea(edited[1].offcuts)).toBeCloseTo(96 * 48 - 24 * 24, 6);
  });

  it("ignores edits for parts that no longer exist", () => {
    const { layouts } = nestSheets([part("a", 24, 24, 0.75)], [sheet("ply", 96, 48, 0.75)], 0.125);
    const edited = applyPartEdits(layouts, { ghost: { x: 0, y: 0 } });
    expect(edited[0].parts).toHaveLength(layouts[0].parts.length);
    expect(edited[0]).toEqual(layouts[0]);
  });
});

describe("recomputeOffcuts", () => {
  it("tracks the union area of placed footprints after moves", () => {
    const stock = sheet("ply", 96, 48, 0.75);
    const mk = (x: number, y: number): PlacedPart => placed("a#1", "a", x, y, 24, 12, { stockId: "ply#1" });
    const offArea = (os: Offcut[]) => os.reduce((sum, o) => sum + o.width * o.height, 0);
    expect(offArea(recomputeOffcuts(stock, [mk(0, 0)]))).toBeCloseTo(96 * 48 - 24 * 12, 6);
    // After moving to a corner far away, the entire original corner is free again.
    const moved = recomputeOffcuts(stock, [mk(60, 30)]);
    expect(offArea(moved)).toBeCloseTo(96 * 48 - 24 * 12, 6);
    expect(moved.some((o) => o.x === 0 && o.y === 0 && o.width >= 24 && o.height >= 12)).toBe(true);
  });

  it("returns the full sheet for an emptied board", () => {
    const stock = sheet("ply", 96, 48, 0.75);
    expect(recomputeOffcuts(stock, [])).toEqual([{ x: 0, y: 0, width: 96, height: 48 }]);
  });
});