import { describe, expect, it } from "vitest";
import { CsvError, parseCutListCsv, parseStockCsv, serializeCutListCsv, serializePartsExportCsv, serializeStockCsv } from "./csv";

const CUTLIST_SAMPLE = `part,quantity,length,width,thickness,grain
shelf,2,36,10,1,lengthwise
side,2,28,12,1,along_width
leg,4,24,2.5,2.5,no_matter`;

const STOCK_SAMPLE = `type,name,length,width,thickness,qty,price
board,walnut 4/4,96,7,1,2,24.00
sheet,baltic birch,96,48,0.75,1,60.00
scrap,cherry cutout,20,8,1,1,0`;

describe("parseCutListCsv", () => {
  it("parses the USAGE.md sample", () => {
    const parts = parseCutListCsv(CUTLIST_SAMPLE);
    expect(parts).toHaveLength(3);
    expect(parts[0]).toMatchObject({
      name: "shelf",
      quantity: 2,
      length: 36,
      width: 10,
      thickness: 1,
      grain: "lengthwise",
    });
    expect(parts[2]).toMatchObject({ name: "leg", quantity: 4, length: 24, width: 2.5, thickness: 2.5, grain: "no_matter" });
  });

  it("rejects unknown grain values", () => {
    const bad = CUTLIST_SAMPLE.replace("no_matter", "diagonal");
    expect(() => parseCutListCsv(bad)).toThrow(CsvError);
  });

  it("rejects wrong column counts", () => {
    expect(() => parseCutListCsv("part,quantity,length,width,thickness,grain\nshelf,2,36,10,1")).toThrow(CsvError);
  });

  it("rejects non-numeric dimensions", () => {
    expect(() => parseCutListCsv(CUTLIST_SAMPLE.replace("36", "long"))).toThrow(CsvError);
  });

  it("serializes back to an equivalent CSV", () => {
    const parts = parseCutListCsv(CUTLIST_SAMPLE);
    const roundTrip = parseCutListCsv(serializeCutListCsv(parts));
    expect(roundTrip.map(({ name, quantity, length, width, thickness, grain }) => ({ name, quantity, length, width, thickness, grain }))).toEqual(
      parts.map(({ name, quantity, length, width, thickness, grain }) => ({ name, quantity, length, width, thickness, grain })),
    );
  });

  it("quotes names containing commas", () => {
    const text = serializeCutListCsv([{ id: "x", name: "shelf, lower", quantity: 1, length: 10, width: 5, thickness: 1, grain: "lengthwise", woodType: "", costPerBdFt: 0 }]);
    expect(text).toContain('"shelf, lower"');
    expect(parseCutListCsv(text)[0].name).toBe("shelf, lower");
  });

  it("exports parts with wood and cost columns", () => {
    const text = serializePartsExportCsv([
      { id: "x", name: "shelf, lower", quantity: 1, length: 10, width: 5, thickness: 1, grain: "lengthwise", woodType: "walnut", costPerBdFt: 12.5 },
      { id: "y", name: "leg", quantity: 4, length: 24, width: 2, thickness: 2, grain: "no_matter", woodType: "", costPerBdFt: 0 },
    ]);
    expect(text.split("\n")[0]).toBe("part,quantity,length,width,thickness,grain,wood_type,cost_per_bd_ft");
    expect(text).toContain('"shelf, lower",1,10,5,1,lengthwise,walnut,12.5');
    expect(text).toContain("leg,4,24,2,2,no_matter,,0");
  });
});

describe("parseStockCsv", () => {
  it("parses the USAGE.md sample", () => {
    const stock = parseStockCsv(STOCK_SAMPLE);
    expect(stock).toHaveLength(3);
    expect(stock[0]).toMatchObject({ type: "board", name: "walnut 4/4", length: 96, width: 7, thickness: 1, qty: 2, price: 24 });
    expect(stock[1]).toMatchObject({ type: "sheet", name: "baltic birch", length: 96, width: 48, thickness: 0.75, qty: 1, price: 60 });
    expect(stock[2]).toMatchObject({ type: "scrap", name: "cherry cutout", length: 20, width: 8, thickness: 1, qty: 1, price: 0 });
  });

  it("rejects unknown stock types", () => {
    const bad = STOCK_SAMPLE.replace("board,walnut", "log,walnut");
    expect(() => parseStockCsv(bad)).toThrow(CsvError);
  });

  it("round-trips serialize then parse", () => {
    const stock = parseStockCsv(STOCK_SAMPLE);
    const roundTrip = parseStockCsv(serializeStockCsv(stock));
    expect(roundTrip).toEqual(stock);
  });
});