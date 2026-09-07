import { describe, expect, it } from "vitest";
import type { Part, Stock } from "./models";
import { nestBoards, nestSheets, optimizeCutList, resawLayers, type PlacedPart, type StockLayout } from "./nesting";

function part(name: string, length: number, width: number, thickness: number, overrides: Partial<Part> = {}): Part {
  return { id: name, name, quantity: 1, length, width, thickness, grain: "no_matter", woodType: "", costPerBdFt: 0, ...overrides };
}

function board(name: string, length: number, width: number, thickness: number, overrides: Partial<Stock> = {}): Stock {
  return { id: name, type: "board", name, length, width, thickness, qty: 1, price: 0, woodType: "", costPerBdFt: 0, ...overrides };
}

function sheet(name: string, length: number, width: number, thickness: number, overrides: Partial<Stock> = {}): Stock {
  return { id: name, type: "sheet", name, length, width, thickness, qty: 1, price: 0, woodType: "", costPerBdFt: 0, ...overrides };
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
    assertNoOverlapsOrOutOfBounds(layouts, 0.125);
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