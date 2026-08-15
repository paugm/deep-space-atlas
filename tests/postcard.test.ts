import { describe, expect, it } from "vitest";

import {
  postcardCaption,
  postcardFilename,
  postcardShareText,
} from "../js/postcard.ts";

describe("postcardCaption", () => {
  it("uppercases the planet name and pads the seed", () => {
    expect(postcardCaption("kepler reach", "ab")).toBe(
      "KEPLER REACH  ·  000000AB",
    );
  });
});

describe("postcardFilename", () => {
  it("builds a dated atlas filename", () => {
    expect(postcardFilename("deadbeef", Date.parse("2026-08-15T12:00:00Z"))).toBe(
      "atlas-DEADBEEF-20260815.png",
    );
  });
});

describe("postcardShareText", () => {
  it("includes the caption and a seed query", () => {
    expect(postcardShareText("Ash Spire", "cafe")).toContain("?seed=0000CAFE");
  });
});
