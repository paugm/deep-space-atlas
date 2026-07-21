import { describe, expect, it } from "vitest";

import { mulberry32 } from "../js/config.ts";
import {
  CELLS_PER_AXIS,
  CRASH_STANDOFF,
  GALAXY_HALF,
  HORIZON_LOAD_RADIUS,
  HORIZON_UNLOAD_RADIUS,
  LOAD_RADIUS,
  MAX_HORIZON_PROXIES,
  MAX_LOADED_PROXIES,
  PROXY_FULL_VISIBILITY_RADIUS,
  PROXY_MIN_RADIUS,
  PROXY_RADIUS_SPAN,
  PROXY_VISIBILITY_FLOOR,
  SLOTS_PER_CELL,
  candidateSeedsForCell,
  cellContaining,
  cellOfSeed,
  distanceBetween,
  ENTRY_SURFACE_STANDOFF,
  entryPoseForSeed,
  entryStandoffForRadius,
  feistelForward,
  feistelInverse,
  findCrashLanding,
  horizonProxiesNear,
  LAND_RANGE,
  pickProxy,
  poseForward,
  proxiesNear,
  proxyDarkOverlayOpacity,
  proxyDistanceVisibility,
  proxyRadius,
  seedPosition,
  surfaceRange,
  type Vec3,
} from "../js/space/galaxy.ts";
import {
  planetMetadata,
  spaceProxyAtmosphereColor,
  spaceProxyBandColors,
  spaceProxySurfaceColor,
} from "../js/space/metadata.ts";
import {
  spaceProxyColorAtLatitude,
  type ProxyBandColors,
} from "../js/space/proxy-geometry.ts";
import {
  BOOST_SPEED,
  CRUISE_SPEED,
  flightCameraShake,
  flightEffectIntensity,
  flightSpeedBarRatio,
  formatFlightSpeed,
  initialCruiseVelocity,
  integrateFlight,
  stepBoostFuel,
} from "../js/space/flight.ts";
import {
  createPalette,
  createPlanetName,
  pickPlanetClass,
} from "../js/world.ts";
import * as THREE from "three";

const SAMPLE_SEEDS = [
  0x00000000, 0x00000001, 0x00000002, 0xdeadbeef, 0xcafebabe,
  0x7fffffff, 0xffffffff, 0x12345678, 0x0badf00d, 0x5eed5eed,
] as const;

describe("feistel scramble", () => {
  it("is a bijection on 32-bit values", () => {
    for (const seed of SAMPLE_SEEDS) {
      expect(feistelInverse(feistelForward(seed))).toBe(seed >>> 0);
    }
  });

  it("scatters sequential seeds into unrelated cells", () => {
    const cells = new Set(
      [0, 1, 2, 3, 4, 5, 6, 7].map((seed) => {
        const cell = cellOfSeed(seed);
        return `${cell.x},${cell.y},${cell.z}`;
      }),
    );
    // Eight sequential seeds should not collapse onto a line of cells.
    expect(cells.size).toBeGreaterThan(4);
  });
});

describe("seedPosition", () => {
  it("is stable and stays inside the galaxy volume", () => {
    for (const seed of SAMPLE_SEEDS) {
      const first = seedPosition(seed);
      const second = seedPosition(seed);
      expect(second).toEqual(first);
      for (const axis of [first.x, first.y, first.z]) {
        expect(Math.abs(axis)).toBeLessThanOrEqual(GALAXY_HALF);
      }
    }
  });

  it("places each seed inside its own cell", () => {
    for (const seed of SAMPLE_SEEDS) {
      expect(cellContaining(seedPosition(seed))).toEqual(
        cellOfSeed(seed),
      );
    }
  });
});

describe("proxyRadius", () => {
  it("is stable, bounded, and varied across seeds", () => {
    const radii = SAMPLE_SEEDS.map((seed) => {
      const radius = proxyRadius(seed);
      expect(radius).toBe(proxyRadius(seed));
      expect(radius).toBeGreaterThanOrEqual(PROXY_MIN_RADIUS);
      expect(radius).toBeLessThanOrEqual(
        PROXY_MIN_RADIUS + PROXY_RADIUS_SPAN,
      );
      return Math.round(radius);
    });
    expect(new Set(radii).size).toBeGreaterThan(5);
  });
});

describe("candidateSeedsForCell", () => {
  it("returns deterministic members that map back to the cell", () => {
    const cell = { x: 12, y: 40, z: 7 };
    const first = candidateSeedsForCell(cell);
    expect(candidateSeedsForCell(cell)).toEqual(first);
    expect(first).toHaveLength(SLOTS_PER_CELL);
    for (const seed of first) {
      expect(cellOfSeed(seed)).toEqual(cell);
    }
  });

  it("gives distinct seeds to distinct cells", () => {
    const seen = new Set<number>();
    for (let x = 0; x < 4; x += 1) {
      for (const seed of candidateSeedsForCell({ x, y: 1, z: 2 })) {
        expect(seen.has(seed)).toBe(false);
        seen.add(seed);
      }
    }
  });
});

describe("proxiesNear", () => {
  const pose: Vec3 = { x: 1234, y: -8000, z: 45000 };

  it("is stable and bounded for a fixed position", () => {
    const first = proxiesNear(pose);
    expect(proxiesNear(pose)).toEqual(first);
    expect(first.length).toBeLessThanOrEqual(MAX_LOADED_PROXIES);
    for (const proxy of first) {
      expect(
        distanceBetween(pose, proxy.position),
      ).toBeLessThanOrEqual(LOAD_RADIUS);
    }
  });

  it("always includes pinned seeds even outside the load radius", () => {
    const farSeed = 0xdeadbeef;
    const nearPole: Vec3 = { x: -GALAXY_HALF + 1, y: 0, z: 0 };
    const withPin = proxiesNear(nearPole, [farSeed]);
    expect(
      withPin.some((proxy) => proxy.seed === farSeed >>> 0),
    ).toBe(true);
  });

  it("respects cell bounds at the galaxy edge", () => {
    const corner: Vec3 = {
      x: -GALAXY_HALF,
      y: -GALAXY_HALF,
      z: -GALAXY_HALF,
    };
    expect(() => proxiesNear(corner)).not.toThrow();
  });
});

describe("horizonProxiesNear", () => {
  const pose: Vec3 = { x: 1234, y: -8000, z: 45000 };

  it("is stable, capped, and stays inside the horizon sphere", () => {
    const near = proxiesNear(pose);
    const exclude = near.map((proxy) => proxy.seed);
    const first = horizonProxiesNear(pose, exclude);
    expect(horizonProxiesNear(pose, exclude)).toEqual(first);
    expect(first.length).toBeLessThanOrEqual(MAX_HORIZON_PROXIES);
    for (const proxy of first) {
      expect(exclude).not.toContain(proxy.seed);
      expect(
        distanceBetween(pose, proxy.position),
      ).toBeLessThanOrEqual(HORIZON_LOAD_RADIUS);
    }
  });

  it("surfaces bodies beyond the interactive load radius", () => {
    const near = proxiesNear(pose);
    const horizon = horizonProxiesNear(
      pose,
      near.map((proxy) => proxy.seed),
    );
    expect(horizon.length).toBeGreaterThan(0);
    expect(
      horizon.some(
        (proxy) => distanceBetween(pose, proxy.position) > LOAD_RADIUS,
      ),
    ).toBe(true);
  });

  it("respects cell bounds at the galaxy edge", () => {
    const corner: Vec3 = {
      x: -GALAXY_HALF,
      y: -GALAXY_HALF,
      z: -GALAXY_HALF,
    };
    expect(() => horizonProxiesNear(corner)).not.toThrow();
  });
});

describe("proxyDistanceVisibility", () => {
  it("stays full nearby and dims toward the horizon floor", () => {
    expect(proxyDistanceVisibility(0)).toBe(1);
    expect(proxyDistanceVisibility(PROXY_FULL_VISIBILITY_RADIUS)).toBe(1);
    expect(
      proxyDistanceVisibility(HORIZON_UNLOAD_RADIUS),
    ).toBeCloseTo(PROXY_VISIBILITY_FLOOR, 5);
    const mid = proxyDistanceVisibility(
      (PROXY_FULL_VISIBILITY_RADIUS + HORIZON_UNLOAD_RADIUS) / 2,
    );
    expect(mid).toBeGreaterThan(PROXY_VISIBILITY_FLOOR);
    expect(mid).toBeLessThan(1);
    expect(proxyDistanceVisibility(8000)).toBeGreaterThan(
      proxyDistanceVisibility(40000),
    );
  });

  it("maps visibility onto a black overlay that clears as you approach", () => {
    expect(proxyDarkOverlayOpacity(1)).toBe(0);
    expect(proxyDarkOverlayOpacity(PROXY_VISIBILITY_FLOOR)).toBeCloseTo(
      0.99,
      5,
    );
    expect(proxyDarkOverlayOpacity(0.5)).toBeGreaterThan(
      proxyDarkOverlayOpacity(0.9),
    );
    expect(proxyDarkOverlayOpacity(0.5)).toBeLessThan(0.99);
  });
});

describe("surfaceRange", () => {
  it("falls monotonically along a straight approach path", () => {
    const seed = 0xcafebabe;
    const proxy = {
      seed,
      position: seedPosition(seed),
      radius: proxyRadius(seed),
    };
    const start = entryPoseForSeed(seed).position;
    let previous = Number.POSITIVE_INFINITY;
    for (let step = 0; step <= 10; step += 1) {
      const t = step / 10;
      const range = surfaceRange(
        {
          x: start.x + (proxy.position.x - start.x) * t,
          y: start.y + (proxy.position.y - start.y) * t,
          z: start.z + (proxy.position.z - start.z) * t,
        },
        proxy,
      );
      expect(range).toBeLessThanOrEqual(previous);
      previous = range;
    }
    expect(previous).toBe(0);
  });
});

describe("entryPoseForSeed", () => {
  it("faces the seed's proxy and keeps it inside the load radius", () => {
    for (const seed of SAMPLE_SEEDS) {
      const pose = entryPoseForSeed(seed);
      const planet = seedPosition(seed);
      const forward = poseForward(pose);
      const toPlanet = {
        x: planet.x - pose.position.x,
        y: planet.y - pose.position.y,
        z: planet.z - pose.position.z,
      };
      const length = Math.hypot(toPlanet.x, toPlanet.y, toPlanet.z);
      const alignment =
        (forward.x * toPlanet.x +
          forward.y * toPlanet.y +
          forward.z * toPlanet.z) /
        length;
      expect(alignment).toBeGreaterThan(0.999);
      expect(length).toBeLessThanOrEqual(LOAD_RADIUS);
      // The pinned stream must contain the body the ship spawns beside.
      const proxies = proxiesNear(pose.position, [seed]);
      expect(
        proxies.some((proxy) => proxy.seed === seed >>> 0),
      ).toBe(true);
    }
  });

  it("spawns just outside land range beside the body", () => {
    for (const seed of SAMPLE_SEEDS) {
      const pose = entryPoseForSeed(seed);
      const proxy = {
        seed,
        position: seedPosition(seed),
        radius: proxyRadius(seed),
      };
      expect(entryStandoffForRadius(proxy.radius)).toBe(
        proxy.radius + ENTRY_SURFACE_STANDOFF,
      );
      const range = surfaceRange(pose.position, proxy);
      expect(range).toBeCloseTo(ENTRY_SURFACE_STANDOFF, 5);
      expect(range).toBeGreaterThan(LAND_RANGE);
    }
  });
});

describe("pickProxy", () => {
  const proxy = {
    seed: 1,
    position: { x: 0, y: 0, z: -5000 },
    radius: 400,
  };

  it("hits a proxy the ray points at and misses otherwise", () => {
    const origin: Vec3 = { x: 0, y: 0, z: 0 };
    const toward: Vec3 = { x: 0, y: 0, z: -1 };
    const away: Vec3 = { x: 0, y: 0, z: 1 };
    expect(pickProxy(origin, toward, [proxy])?.seed).toBe(1);
    expect(pickProxy(origin, away, [proxy])).toBeNull();
  });

  it("prefers the nearest of two overlapping targets", () => {
    const far = {
      seed: 2,
      position: { x: 0, y: 0, z: -9000 },
      radius: 900,
    };
    const hit = pickProxy(
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: -1 },
      [far, proxy],
    );
    expect(hit?.seed).toBe(1);
  });
});

describe("planetMetadata", () => {
  it("matches the ground-generation class pick and naming stream", () => {
    for (const seed of SAMPLE_SEEDS) {
      const metadata = planetMetadata(seed);
      const expectedClass = pickPlanetClass(mulberry32(seed >>> 0));
      expect(metadata.planetClassId).toBe(expectedClass.id);
      expect(metadata.biomeLabel).toBe(expectedClass.label);
      expect(metadata.hasLiquidWater).toBe(
        expectedClass.surface === "water",
      );
      expect(metadata.name).toBe(
        createPlanetName(mulberry32((seed >>> 0) ^ 0x27d4eb2f)),
      );
      expect(metadata.seedHex).toMatch(/^[0-9A-F]{8}$/);
      expect(metadata.surfaceColor).toMatch(/^#[0-9a-f]{6}$/);
      expect(metadata.atmosphereColor).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("is deterministic", () => {
    expect(planetMetadata(0xdeadbeef)).toEqual(
      planetMetadata(0xdeadbeef),
    );
  });

  it("remaps ground pastels into darker orbital proxy colors", () => {
    for (const seed of SAMPLE_SEEDS) {
      const random = mulberry32(seed >>> 0);
      const planetClass = pickPlanetClass(random);
      const palette = createPalette(random, planetClass);
      const surface = spaceProxySurfaceColor(palette);
      const atmosphere = spaceProxyAtmosphereColor(palette);
      const surfaceHsl = { h: 0, s: 0, l: 0 };
      const atmosphereHsl = { h: 0, s: 0, l: 0 };
      surface.getHSL(surfaceHsl);
      atmosphere.getHSL(atmosphereHsl);
      expect(surfaceHsl.l).toBeLessThanOrEqual(0.34);
      expect(atmosphereHsl.l).toBeLessThanOrEqual(0.36);
      // Soft sky washes should not survive as proxy atmosphere.
      expect(atmosphereHsl.l).toBeLessThan(0.55);
    }
  });

  it("exposes distinct latitude band colors for vertex painting", () => {
    for (const seed of SAMPLE_SEEDS) {
      const metadata = planetMetadata(seed);
      expect(metadata.bandPoleColor).toMatch(/^#[0-9a-f]{6}$/);
      expect(metadata.bandTemperateColor).toBe(metadata.surfaceColor);
      expect(metadata.bandEquatorColor).toMatch(/^#[0-9a-f]{6}$/);
      const random = mulberry32(seed >>> 0);
      const planetClass = pickPlanetClass(random);
      const bands = spaceProxyBandColors(createPalette(random, planetClass));
      expect(bands.pole.equals(bands.equator)).toBe(false);
    }
  });
});

describe("spaceProxyColorAtLatitude", () => {
  const bands: ProxyBandColors = {
    pole: new THREE.Color("#c8d4e8"),
    temperate: new THREE.Color("#3a5a28"),
    equator: new THREE.Color("#1a4060"),
  };

  it("returns equator at the equator and pole at the poles", () => {
    expect(spaceProxyColorAtLatitude(0, bands).getHexString()).toBe(
      bands.equator.getHexString(),
    );
    expect(spaceProxyColorAtLatitude(1, bands).getHexString()).toBe(
      bands.pole.getHexString(),
    );
    expect(spaceProxyColorAtLatitude(-1, bands).getHexString()).toBe(
      bands.pole.getHexString(),
    );
  });

  it("blends through temperate latitudes", () => {
    const mid = spaceProxyColorAtLatitude(0.42, bands);
    expect(mid.getHexString()).toBe(bands.temperate.getHexString());
  });
});

describe("cellOfSeed", () => {
  it("stays inside the cell grid for extreme seeds", () => {
    for (const seed of SAMPLE_SEEDS) {
      const cell = cellOfSeed(seed);
      for (const axis of [cell.x, cell.y, cell.z]) {
        expect(axis).toBeGreaterThanOrEqual(0);
        expect(axis).toBeLessThan(CELLS_PER_AXIS);
      }
    }
  });
});

describe("findCrashLanding", () => {
  const proxy = {
    seed: 1,
    position: { x: 0, y: 0, z: 0 },
    radius: 500,
  };

  it("returns null when the path stays clear of the shell", () => {
    expect(
      findCrashLanding(
        { x: 0, y: 0, z: 3000 },
        { x: 0, y: 0, z: 2500 },
        [proxy],
      ),
    ).toBeNull();
  });

  it("contacts just outside the surface before penetration", () => {
    const hit = findCrashLanding(
      { x: 0, y: 0, z: 2000 },
      { x: 0, y: 0, z: 0 },
      [proxy],
    );
    expect(hit).not.toBeNull();
    expect(hit!.proxy.seed).toBe(1);
    const range = surfaceRange(hit!.contact, proxy);
    expect(range).toBeCloseTo(CRASH_STANDOFF, 5);
  });

  it("catches tunneling paths that jump past the center", () => {
    const hit = findCrashLanding(
      { x: 0, y: 0, z: 2000 },
      { x: 0, y: 0, z: -2000 },
      [proxy],
    );
    expect(hit).not.toBeNull();
    expect(hit!.contact.z).toBeGreaterThan(0);
    expect(surfaceRange(hit!.contact, proxy)).toBeCloseTo(CRASH_STANDOFF, 5);
  });

  it("pushes out when already inside the safe shell", () => {
    const hit = findCrashLanding(
      { x: 0, y: 0, z: 100 },
      { x: 0, y: 0, z: 50 },
      [proxy],
    );
    expect(hit).not.toBeNull();
    expect(surfaceRange(hit!.contact, proxy)).toBeCloseTo(CRASH_STANDOFF, 5);
  });
});

describe("integrateFlight", () => {
  const axes = {
    forward: { x: 0, y: 0, z: -1 },
    right: { x: 1, y: 0, z: 0 },
  };

  it("formats cockpit speed readouts against boost peak", () => {
    expect(formatFlightSpeed(0)).toBe("0");
    expect(formatFlightSpeed(219.6)).toBe("220");
    expect(formatFlightSpeed(-3)).toBe("0");
    expect(flightSpeedBarRatio(0)).toBe(0);
    expect(flightSpeedBarRatio(CRUISE_SPEED)).toBeCloseTo(
      CRUISE_SPEED / BOOST_SPEED,
      5,
    );
    expect(flightSpeedBarRatio(BOOST_SPEED)).toBe(1);
    expect(flightSpeedBarRatio(BOOST_SPEED * 2)).toBe(1);
  });

  it("coasts forward with no thrust keys held", () => {
    const step = integrateFlight({
      velocity: { vx: 0, vy: 0, vz: 0 },
      axes,
      input: {
        forward: false,
        back: false,
        left: false,
        right: false,
        up: false,
        boost: false,
      },
      deltaTime: 0.05,
    });
    expect(step.velocity.vz).toBeLessThan(0);
    expect(step.speed).toBeGreaterThan(0);
    expect(step.thrustIntensity).toBeGreaterThan(0);
  });

  it("accelerates harder with W than idle cruise alone", () => {
    const idle = integrateFlight({
      velocity: { vx: 0, vy: 0, vz: 0 },
      axes,
      input: {
        forward: false,
        back: false,
        left: false,
        right: false,
        up: false,
        boost: false,
      },
      deltaTime: 0.1,
    });
    const thrust = integrateFlight({
      velocity: { vx: 0, vy: 0, vz: 0 },
      axes,
      input: {
        forward: true,
        back: false,
        left: false,
        right: false,
        up: false,
        boost: false,
      },
      deltaTime: 0.1,
    });
    expect(thrust.speed).toBeGreaterThan(idle.speed);
  });

  it("damps lateral slip faster than forward motion", () => {
    const step = integrateFlight({
      velocity: { vx: 800, vy: 0, vz: -800 },
      axes,
      input: {
        forward: false,
        back: false,
        left: false,
        right: false,
        up: false,
        boost: false,
      },
      deltaTime: 0.5,
    });
    expect(Math.abs(step.velocity.vx)).toBeLessThan(
      Math.abs(step.velocity.vz),
    );
  });

  it("respects the cruise and boost speed caps", () => {
    let state = { vx: 0, vy: 0, vz: 0 };
    for (let index = 0; index < 120; index += 1) {
      const step = integrateFlight({
        velocity: state,
        axes,
        input: {
          forward: true,
          back: false,
          left: false,
          right: false,
          up: false,
          boost: false,
        },
        deltaTime: 0.05,
      });
      state = step.velocity;
    }
    expect(Math.hypot(state.vx, state.vy, state.vz)).toBeLessThanOrEqual(
      CRUISE_SPEED + 1e-6,
    );

    for (let index = 0; index < 120; index += 1) {
      const step = integrateFlight({
        velocity: state,
        axes,
        input: {
          forward: true,
          back: false,
          left: false,
          right: false,
          up: false,
          boost: true,
        },
        deltaTime: 0.05,
      });
      state = step.velocity;
    }
    expect(Math.hypot(state.vx, state.vy, state.vz)).toBeLessThanOrEqual(
      BOOST_SPEED + 1e-6,
    );
  });

  it("seeds an initial cruise along the nose", () => {
    const cruise = initialCruiseVelocity(axes);
    expect(cruise.vz).toBeLessThan(0);
    expect(Math.hypot(cruise.vx, cruise.vy, cruise.vz)).toBeCloseTo(
      CRUISE_SPEED * 0.7,
      5,
    );
  });

  it("maps speed and thrust into a bounded effect intensity", () => {
    expect(flightEffectIntensity(0, 0)).toBe(0);
    expect(flightEffectIntensity(1, 1)).toBeLessThanOrEqual(1);
    expect(flightEffectIntensity(0.5, 0.5)).toBeGreaterThan(0.4);
  });

  it("shakes harder while boosting without lateral roll", () => {
    const cruise = flightCameraShake({
      intensity: 0.8,
      phase: 1.2,
      boosting: false,
    });
    const boost = flightCameraShake({
      intensity: 0.8,
      phase: 1.2,
      boosting: true,
    });
    expect(Math.abs(boost.pitchJitter)).toBeGreaterThan(
      Math.abs(cruise.pitchJitter),
    );
    expect(Math.abs(boost.bobY)).toBeGreaterThan(0);
  });
});

describe("stepBoostFuel", () => {
  it("burns while boosting and refuses boost at empty", () => {
    let fuel = 1;
    const burned = stepBoostFuel({
      fuel,
      wantsBoost: true,
      deltaTime: 1,
      burnSeconds: 2,
      rechargeSeconds: 4,
    });
    expect(burned.boosting).toBe(true);
    expect(burned.fuel).toBeCloseTo(0.5, 5);

    const empty = stepBoostFuel({
      fuel: 0,
      wantsBoost: true,
      deltaTime: 0.1,
      burnSeconds: 2,
      rechargeSeconds: 4,
    });
    expect(empty.boosting).toBe(false);
    expect(empty.fuel).toBeGreaterThan(0);
  });

  it("recharges when boost is released", () => {
    const step = stepBoostFuel({
      fuel: 0.2,
      wantsBoost: false,
      deltaTime: 1,
      burnSeconds: 2,
      rechargeSeconds: 4,
    });
    expect(step.boosting).toBe(false);
    expect(step.fuel).toBeCloseTo(0.45, 5);
  });
});
