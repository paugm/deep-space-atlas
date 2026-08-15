import { describe, expect, it } from "vitest";

import { applySeedParam, parseSeedParam } from "../js/planet-url.ts";

describe("parseSeedParam", () => {
  it("reads a padded hex seed from a query string", () => {
    expect(parseSeedParam("?seed=DEADBEEF")).toBe(0xdeadbeef);
    expect(parseSeedParam("seed=00ff")).toBe(0xff);
    expect(parseSeedParam("?foo=1&seed=abcd")).toBe(0xabcd);
  });

  it("accepts lowercase and surrounding spaces after decode", () => {
    expect(parseSeedParam("?seed=deadbeef")).toBe(0xdeadbeef);
    expect(parseSeedParam("?seed=+ABCD+")).toBe(0xabcd);
  });

  it("returns null when seed is missing or invalid", () => {
    expect(parseSeedParam("")).toBeNull();
    expect(parseSeedParam("?")).toBeNull();
    expect(parseSeedParam("?foo=1")).toBeNull();
    expect(parseSeedParam("?seed=")).toBeNull();
    expect(parseSeedParam("?seed=GGGG")).toBeNull();
    expect(parseSeedParam("?seed=123456789")).toBeNull();
  });
});

describe("applySeedParam", () => {
  it("writes an 8-digit uppercase seed", () => {
    expect(applySeedParam("", 0xdeadbeef)).toBe("?seed=DEADBEEF");
    expect(applySeedParam("?", 0xff)).toBe("?seed=000000FF");
  });

  it("replaces an existing seed and keeps other params", () => {
    expect(applySeedParam("?seed=00FF", 1)).toBe("?seed=00000001");
    expect(applySeedParam("?foo=1&seed=AA", 0xbb)).toBe("?foo=1&seed=000000BB");
  });
});
