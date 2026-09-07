export type Grain = "lengthwise" | "along_width" | "no_matter";

export const GRAINS: readonly Grain[] = ["lengthwise", "along_width", "no_matter"];

export type StockType = "board" | "sheet" | "scrap";

export const STOCK_TYPES: readonly StockType[] = ["board", "sheet", "scrap"];

export type UnitSystem = "in" | "mm";

export interface Part {
  id: string;
  name: string;
  quantity: number;
  length: number;
  width: number;
  thickness: number;
  grain: Grain;
  woodType: string;
  costPerBdFt: number;
}

export interface Stock {
  id: string;
  type: StockType;
  name: string;
  length: number;
  width: number;
  thickness: number;
  qty: number;
  price: number;
  woodType: string;
  costPerBdFt: number;
}

export interface CutList {
  units: UnitSystem;
  parts: Part[];
  stock: Stock[];
  kerf: number;
}