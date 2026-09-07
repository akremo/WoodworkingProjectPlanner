import type { Grain, Part, Stock, StockType } from "./models";
import { GRAINS, STOCK_TYPES } from "./models";

export class CsvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CsvError";
  }
}

function parseRow(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      cells.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  cells.push(current.trim());
  return cells;
}

function splitLines(text: string): string[] {
  return text.split(/\r?\n/).filter((line) => line.trim().length > 0);
}

function requireColumns(cells: string[], expected: string[], row: number): void {
  if (cells.length !== expected.length) {
    throw new CsvError(`Row ${row + 1}: expected ${expected.length} columns, got ${cells.length}.`);
  }
}

function parseNumber(value: string, field: string, row: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new CsvError(`Row ${row + 1}: "${field}" is not a number ("${value}").`);
  }
  return n;
}

export function parseCutListCsv(text: string, units: "in" | "mm" = "in"): Part[] {
  const lines = splitLines(text);
  if (lines.length === 0) throw new CsvError("Empty cut list: no data rows.");
  const header = parseRow(lines[0]);
  requireColumns(header, ["part", "quantity", "length", "width", "thickness", "grain"], 0);

  const parts: Part[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseRow(lines[i]);
    requireColumns(cells, header, i);
    const [name, quantity, length, width, thickness, grain] = cells;
    if (!GRAINS.includes(grain as Grain)) {
      throw new CsvError(`Row ${i + 1}: unknown grain "${grain}" (expected ${GRAINS.join(", ")}).`);
    }
    parts.push({
      id: `${name}-${i}`,
      name,
      quantity: parseNumber(quantity, "quantity", i),
      length: parseNumber(length, "length", i),
      width: parseNumber(width, "width", i),
      thickness: parseNumber(thickness, "thickness", i),
      grain: grain as Grain,
      woodType: "",
      costPerBdFt: 0,
    });
  }
  return parts;
}

export function serializeCutListCsv(parts: Part[]): string {
  const header = ["part", "quantity", "length", "width", "thickness", "grain"];
  const rows = parts.map((p) =>
    [p.name, String(p.quantity), String(p.length), String(p.width), String(p.thickness), p.grain]
      .map(escapeCsv)
      .join(","),
  );
  return [header.join(","), ...rows].join("\n");
}

export function serializePartsExportCsv(parts: Part[]): string {
  const header = ["part", "quantity", "length", "width", "thickness", "grain", "wood_type", "cost_per_bd_ft"];
  const rows = parts.map((p) =>
    [p.name, String(p.quantity), String(p.length), String(p.width), String(p.thickness), p.grain, p.woodType, String(p.costPerBdFt)]
      .map(escapeCsv)
      .join(","),
  );
  return [header.join(","), ...rows].join("\n");
}

export function parseStockCsv(text: string): Stock[] {
  const lines = splitLines(text);
  if (lines.length === 0) throw new CsvError("Empty stock list: no data rows.");
  const header = parseRow(lines[0]);
  requireColumns(header, ["type", "name", "length", "width", "thickness", "qty", "price"], 0);

  const stock: Stock[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseRow(lines[i]);
    requireColumns(cells, header, i);
    const [type, name, length, width, thickness, qty, price] = cells;
    if (!STOCK_TYPES.includes(type as StockType)) {
      throw new CsvError(`Row ${i + 1}: unknown type "${type}" (expected ${STOCK_TYPES.join(", ")}).`);
    }
    stock.push({
      id: `${name}-${i}`,
      type: type as StockType,
      name,
      length: parseNumber(length, "length", i),
      width: parseNumber(width, "width", i),
      thickness: parseNumber(thickness, "thickness", i),
      qty: parseNumber(qty, "qty", i),
      price: parseNumber(price, "price", i),
      woodType: "",
      costPerBdFt: 0,
    });
  }
  return stock;
}

export function serializeStockCsv(stock: Stock[]): string {
  const header = ["type", "name", "length", "width", "thickness", "qty", "price"];
  const rows = stock.map((s) =>
    [s.type, s.name, String(s.length), String(s.width), String(s.thickness), String(s.qty), String(s.price)]
      .map(escapeCsv)
      .join(","),
  );
  return [header.join(","), ...rows].join("\n");
}

function escapeCsv(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}