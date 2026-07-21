import { describe, expect, it } from "vitest";

import { SAMPLE_IDS, SAMPLE_URLS } from "../js/audio-catalog.ts";
import { MASTER_GAIN, masterGainForMute } from "../js/audio.ts";
import {
  chimeSampleForFrequency,
  footstepSample,
  miningHumGain,
  petChirpSample,
  pickFromPool,
  swimStrokeSample,
  thrusterLoopGain,
  thrusterLoopRate,
  underwaterBedGain,
  vehicleEngineGain,
  vehicleEngineRate,
  vehicleEngineSample,
  spaceBedGain,
  spaceBedRate,
} from "../js/audio-rules.ts";

describe("masterGainForMute", () => {
  it("zeros the bus when muted and restores the default level otherwise", () => {
    expect(masterGainForMute(true)).toBe(0);
    expect(masterGainForMute(false)).toBe(MASTER_GAIN);
    expect(MASTER_GAIN).toBeGreaterThan(0);
  });
});

describe("audio catalog", () => {
  it("exposes a non-empty sample map with matching id list", () => {
    expect(SAMPLE_IDS.length).toBeGreaterThan(40);
    expect(SAMPLE_IDS).toHaveLength(Object.keys(SAMPLE_URLS).length);
    for (const id of SAMPLE_IDS) {
      expect(SAMPLE_URLS[id]).toMatch(/\.ogg/);
    }
  });
});

describe("audio rules", () => {
  it("picks pool entries within bounds", () => {
    expect(pickFromPool(["a", "b", "c"], 0)).toBe("a");
    expect(pickFromPool(["a", "b", "c"], 0.5)).toBe("b");
    expect(pickFromPool(["a", "b", "c"], 0.999)).toBe("c");
  });

  it("maps footstep surfaces to distinct pools", () => {
    expect(footstepSample("dry", 0)).toMatch(/footstepConcrete|Concrete/i);
    expect(footstepSample("wet", 0.9)).toMatch(/snow|slime/i);
    expect(footstepSample("soft", 0)).toMatch(/grass/i);
  });

  it("maps chime frequencies onto digital one-shots", () => {
    expect(chimeSampleForFrequency(350)).toBe("pepSound1");
    expect(chimeSampleForFrequency(500)).toBe("pepSound3");
    expect(chimeSampleForFrequency(660)).toBe("confirmation1");
    expect(chimeSampleForFrequency(740)).toBe("confirmation2");
    expect(chimeSampleForFrequency(900)).toBe("powerUp4");
  });

  it("gives each rover kind its own engine loop", () => {
    expect(vehicleEngineSample("rover")).toBe("engineCircular0");
    expect(vehicleEngineSample("round-rover")).toBe("engineCircular1");
    expect(vehicleEngineSample("rover-variant")).toBe("engineCircular2");
  });

  it("ramps vehicle / mining / underwater / thruster / space-bed gains", () => {
    expect(vehicleEngineGain(0)).toBeLessThan(vehicleEngineGain(1));
    expect(vehicleEngineRate(0)).toBeLessThan(vehicleEngineRate(1));
    expect(miningHumGain(0)).toBeLessThan(miningHumGain(1));
    expect(underwaterBedGain(0)).toBe(0);
    expect(underwaterBedGain(1)).toBeGreaterThan(0);
    expect(thrusterLoopGain(0)).toBe(0);
    expect(thrusterLoopGain(1)).toBeGreaterThan(0);
    expect(thrusterLoopRate(0)).toBeLessThan(thrusterLoopRate(1));
    expect(spaceBedGain(0)).toBeLessThan(spaceBedGain(1));
    expect(spaceBedGain(1, true)).toBeGreaterThan(spaceBedGain(1, false));
    expect(spaceBedRate(0)).toBeLessThan(spaceBedRate(1, true));
  });

  it("returns pet and swim samples from curated pools", () => {
    expect(petChirpSample(0.1)).toMatch(/cute|bug|alien/i);
    expect(swimStrokeSample(0.2)).toMatch(/slime|burble/i);
  });
});
