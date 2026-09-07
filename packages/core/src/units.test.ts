import { describe, expect, it } from "vitest";
import { boardFeet } from "./units";

describe("boardFeet", () => {
  it("computes board-feet from inch dimensions", () => {
    expect(boardFeet(96, 7, 1)).toBeCloseTo(4.6666667, 6);
    expect(boardFeet(24, 2.5, 2.5)).toBeCloseTo(1.0416667, 6);
  });
});