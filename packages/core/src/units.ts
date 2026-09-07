import type { UnitSystem } from "./models";

export const BOARD_FEET_CUBIC_INCHES = 144;
export const MILLIMETERS_PER_INCH = 25.4;

export function toInches(value: number, units: UnitSystem): number {
  return units === "mm" ? value / MILLIMETERS_PER_INCH : value;
}

export function fromInches(value: number, units: UnitSystem): number {
  return units === "mm" ? value * MILLIMETERS_PER_INCH : value;
}

export function boardFeet(lengthIn: number, widthIn: number, thicknessIn: number): number {
  return (lengthIn * widthIn * thicknessIn) / BOARD_FEET_CUBIC_INCHES;
}