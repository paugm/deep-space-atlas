import * as THREE from "three";

import { Sound } from "../audio.ts";
import { clamp, mulberry32 } from "../config.ts";
import { createStarPositions } from "../world/textures.ts";
import { landingShipState } from "./cinematic-math.ts";
import { buildCockpit } from "./cockpit.ts";
import {
  HORIZON_UNLOAD_RADIUS,
  LAND_RANGE,
  UNLOAD_RADIUS,
  distanceBetween,
  entryPoseForSeed,
  findCrashLanding,
  horizonProxiesNear,
  pickProxy,
  poseForward,
  proxiesNear,
  proxyDarkOverlayOpacity,
  proxyDistanceVisibility,
  surfaceRange,
  type PlanetProxySpec,
  type ShipPose,
} from "./galaxy.ts";
import {
  flightCameraShake,
  flightEffectIntensity,
  initialCruiseVelocity,
  integrateFlight,
  stepBoostFuel,
} from "./flight.ts";
import { planetMetadata, proxyBandsFromMetadata } from "./metadata.ts";
import { paintLatitudeVertexColors } from "./proxy-geometry.ts";
import { createShipModel, loadShipTemplate } from "./ship-model.ts";

/** How far ahead of the camera the hull materializes when it detaches. */
const DEPARTURE_AHEAD = 6;
/** Drop below eye level so the player looks over the departing hull. */
const DEPARTURE_DROP = 1.4;
/** Minimum third-person travel so even shell crashes read as a dive. */
const DEPARTURE_MIN_DISTANCE = 60;
const LOOK_SENSITIVITY = 0.0022;
const STARFIELD_RADIUS = 26000;
const STAR_COUNT = 1600;
const BASE_FOV = 72;
const MAX_FOV = 90;
/** Camera far plane must clear the horizon unload sphere. */
const CAMERA_FAR = Math.max(STARFIELD_RADIUS * 2, HORIZON_UNLOAD_RADIUS + 8000);
/** Black tint shell sits outside the atmosphere so distance fade covers both. */
const ATMOSPHERE_SCALE = 1.055;
const DARK_OVERLAY_SCALE = 1.075;
const ATMOSPHERE_OPACITY = 0.2;

export interface ScanReadout {
  name: string;
  seedHex: string;
  biomeLabel: string;
  range: number;
  canLand: boolean;
}

export interface SpaceSystemDependencies {
  renderer: THREE.WebGLRenderer;
  onScan(readout: ScanReadout | null): void;
  onPrompt(text: string): void;
  /** Landing intent; main owns the cinematic. */
  onLandRequest(seed: number): void;
  onPause(): void;
  /** Shared HUD fuel ratio (0..1). */
  onBoostFuel?(fuel: number): void;
}

export interface SpaceSystem {
  enterNearSeed(seed: number): void;
  setActive(active: boolean): void;
  /** Cinematic-only landing autopilot. */
  beginApproach(seed: number): void;
  update(deltaTime: number): void;
  /** Scene + camera for the shared post pipeline. */
  getView(): {
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
  };
  resize(aspect: number): void;
  getLastSeed(): number | null;
}

interface LoadedNearProxy {
  tier: "near";
  spec: PlanetProxySpec;
  mesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>;
  atmosphere: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  /** Black tint shell; opacity rises with distance (surface stays opaque). */
  overlay: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
}

interface LoadedHorizonProxy {
  tier: "horizon";
  spec: PlanetProxySpec;
  /** Lit so the sun casts a terminator (MeshBasic read as flat candy). */
  mesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshLambertMaterial>;
  atmosphere: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  overlay: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
}

type LoadedProxy = LoadedNearProxy | LoadedHorizonProxy;

function buildStarfield(): THREE.Points<
  THREE.BufferGeometry,
  THREE.PointsMaterial
> {
  const random = mulberry32(0x57a125);
  const positions = createStarPositions(random, STAR_COUNT, STARFIELD_RADIUS);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(positions, 3),
  );
  const stars = new THREE.Points(
    geometry,
    new THREE.PointsMaterial({
      color: 0xdfe8ff,
      size: 1.7,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    }),
  );
  stars.frustumCulled = false;
  return stars;
}

export function createSpaceSystem({
  renderer,
  onScan,
  onPrompt,
  onLandRequest,
  onPause,
  onBoostFuel,
}: SpaceSystemDependencies): SpaceSystem {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#02050a");
  const camera = new THREE.PerspectiveCamera(
    72,
    window.innerWidth / window.innerHeight,
    0.1,
    CAMERA_FAR,
  );
  camera.rotation.order = "YXZ";
  scene.add(camera);
  const cockpit = buildCockpit();
  camera.add(cockpit);

  const stars = buildStarfield();
  scene.add(stars);
  scene.add(new THREE.AmbientLight(0xffffff, 0.22));
  const sunLight = new THREE.DirectionalLight("#fff3dd", 2.4);
  sunLight.position.set(0.7, 0.5, 0.35);
  scene.add(sunLight);

  const nearSurfaceTemplate = new THREE.SphereGeometry(1, 48, 28);
  const horizonSurfaceTemplate = new THREE.SphereGeometry(1, 16, 12);
  /** Shared unit sphere for atmosphere + dark shells (no per-body vertex data). */
  const shellGeometry = new THREE.SphereGeometry(1, 16, 12);
  const loadedNear = new Map<number, LoadedNearProxy>();
  const loadedHorizon = new Map<number, LoadedHorizonProxy>();

  const pose: ShipPose = {
    position: { x: 0, y: 0, z: 0 },
    yaw: 0,
    pitch: 0,
  };
  const velocity = new THREE.Vector3();
  const keys: Record<string, boolean | undefined> = {};

  /** Detached hull used by the landing hold. */
  interface Departure {
    root: THREE.Group | null;
    from: THREE.Vector3;
    direction: THREE.Vector3;
    distance: number;
    elapsedMs: number;
  }

  let active = false;
  let lastSeed: number | null = null;
  let approachTarget: PlanetProxySpec | null = null;
  let departure: Departure | null = null;
  let targetSeed: number | null = null;
  let landReady = false;
  let effectIntensity = 0;
  let effectBoosting = false;
  let shakePhase = 0;
  let landingRequested = false;
  let boostFuel = 1;
  let wasBoosting = false;

  /** Drives cockpit FOV and rumble. */
  function setFlightEffects(intensity: number, boosting = false): void {
    effectIntensity = intensity;
    effectBoosting = boosting;
  }

  function clearFlightEffects(): void {
    setFlightEffects(0, false);
  }

  function isPointerLocked(): boolean {
    return document.pointerLockElement === renderer.domElement;
  }

  function clearInput(): void {
    for (const code of Object.keys(keys)) keys[code] = false;
    Sound.jetOff();
    wasBoosting = false;
  }

  function disposeProxy(entry: LoadedProxy): void {
    scene.remove(entry.mesh);
    scene.remove(entry.atmosphere);
    scene.remove(entry.overlay);
    entry.mesh.geometry.dispose();
    entry.mesh.material.dispose();
    entry.atmosphere.material.dispose();
    entry.overlay.material.dispose();
  }

  function createDarkOverlay(
    radius: number,
    position: { x: number; y: number; z: number },
  ): THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial> {
    const overlay = new THREE.Mesh(
      shellGeometry,
      new THREE.MeshBasicMaterial({
        color: 0x000000,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      }),
    );
    overlay.position.set(position.x, position.y, position.z);
    overlay.scale.setScalar(radius * DARK_OVERLAY_SCALE);
    overlay.renderOrder = 2;
    return overlay;
  }

  function createAtmosphereShell(
    radius: number,
    position: { x: number; y: number; z: number },
    atmosphereColor: string,
  ): THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial> {
    const atmosphere = new THREE.Mesh(
      shellGeometry,
      new THREE.MeshBasicMaterial({
        color: atmosphereColor,
        transparent: true,
        opacity: ATMOSPHERE_OPACITY,
        depthWrite: false,
        side: THREE.FrontSide,
      }),
    );
    atmosphere.position.set(position.x, position.y, position.z);
    atmosphere.scale.setScalar(radius * ATMOSPHERE_SCALE);
    atmosphere.renderOrder = 1;
    return atmosphere;
  }

  function createBandedSurfaceGeometry(
    template: THREE.SphereGeometry,
    metadata: ReturnType<typeof planetMetadata>,
  ): THREE.SphereGeometry {
    const geometry = template.clone();
    paintLatitudeVertexColors(geometry, proxyBandsFromMetadata(metadata));
    return geometry;
  }

  function syncProxies(): void {
    const pinned = lastSeed === null ? [] : [lastSeed];
    const desiredNear = proxiesNear(pose.position, pinned);
    const nearSeeds = desiredNear.map((proxy) => proxy.seed);
    const desiredNearSet = new Set(nearSeeds);
    // Exclude desired + hysteresis-held near shells so discs never double up.
    const horizonExclude = [...desiredNearSet, ...loadedNear.keys()];
    const desiredHorizon = horizonProxiesNear(pose.position, horizonExclude);
    const desiredHorizonSet = new Set(
      desiredHorizon.map((proxy) => proxy.seed),
    );

    for (const [seed, entry] of loadedNear) {
      const distance = distanceBetween(pose.position, entry.spec.position);
      // Hysteresis: keep just-out-of-range bodies until UNLOAD_RADIUS.
      if (!desiredNearSet.has(seed) && distance > UNLOAD_RADIUS) {
        disposeProxy(entry);
        loadedNear.delete(seed);
      }
    }

    for (const [seed, entry] of loadedHorizon) {
      const distance = distanceBetween(pose.position, entry.spec.position);
      if (
        desiredNearSet.has(seed) ||
        (!desiredHorizonSet.has(seed) && distance > HORIZON_UNLOAD_RADIUS)
      ) {
        disposeProxy(entry);
        loadedHorizon.delete(seed);
      }
    }

    for (const spec of desiredNear) {
      if (loadedNear.has(spec.seed)) continue;
      // Promote: drop the cheap disc before spawning the interactive shell.
      const horizon = loadedHorizon.get(spec.seed);
      if (horizon) {
        disposeProxy(horizon);
        loadedHorizon.delete(spec.seed);
      }
      const metadata = planetMetadata(spec.seed);
      const mesh = new THREE.Mesh(
        createBandedSurfaceGeometry(nearSurfaceTemplate, metadata),
        new THREE.MeshStandardMaterial({
          color: 0xffffff,
          vertexColors: true,
          emissive: metadata.atmosphereColor,
          emissiveIntensity: 0.06,
          roughness: 0.78,
          metalness: 0.06,
        }),
      );
      mesh.position.set(spec.position.x, spec.position.y, spec.position.z);
      mesh.scale.setScalar(spec.radius);
      const atmosphere = createAtmosphereShell(
        spec.radius,
        spec.position,
        metadata.atmosphereColor,
      );
      const overlay = createDarkOverlay(spec.radius, spec.position);
      scene.add(mesh);
      scene.add(atmosphere);
      scene.add(overlay);
      loadedNear.set(spec.seed, {
        tier: "near",
        spec,
        mesh,
        atmosphere,
        overlay,
      });
    }

    for (const spec of desiredHorizon) {
      if (loadedHorizon.has(spec.seed) || loadedNear.has(spec.seed)) continue;
      const metadata = planetMetadata(spec.seed);
      const mesh = new THREE.Mesh(
        createBandedSurfaceGeometry(horizonSurfaceTemplate, metadata),
        new THREE.MeshLambertMaterial({
          color: 0xffffff,
          vertexColors: true,
          emissive: metadata.atmosphereColor,
          emissiveIntensity: 0.04,
        }),
      );
      mesh.position.set(spec.position.x, spec.position.y, spec.position.z);
      mesh.scale.setScalar(spec.radius);
      const atmosphere = createAtmosphereShell(
        spec.radius,
        spec.position,
        metadata.atmosphereColor,
      );
      const overlay = createDarkOverlay(spec.radius, spec.position);
      scene.add(mesh);
      scene.add(atmosphere);
      scene.add(overlay);
      loadedHorizon.set(spec.seed, {
        tier: "horizon",
        spec,
        mesh,
        atmosphere,
        overlay,
      });
    }
  }

  function updateProxyAppearance(scannedSeed: number | null): void {
    for (const entry of loadedNear.values()) {
      const visibility = proxyDistanceVisibility(
        distanceBetween(pose.position, entry.spec.position),
      );
      entry.overlay.material.opacity = proxyDarkOverlayOpacity(visibility);
      entry.mesh.material.emissiveIntensity =
        scannedSeed !== null && entry.spec.seed === scannedSeed ? 0.28 : 0.06;
    }

    for (const entry of loadedHorizon.values()) {
      const visibility = proxyDistanceVisibility(
        distanceBetween(pose.position, entry.spec.position),
      );
      entry.overlay.material.opacity = proxyDarkOverlayOpacity(visibility);
    }
  }

  function placeShip(nextPose: ShipPose): void {
    pose.position = { ...nextPose.position };
    pose.yaw = nextPose.yaw;
    pose.pitch = nextPose.pitch;
    const forward = poseForward(pose);
    const cruise = initialCruiseVelocity({
      forward,
      right: {
        x: Math.cos(pose.yaw),
        y: 0,
        z: -Math.sin(pose.yaw),
      },
    });
    velocity.set(cruise.vx, cruise.vy, cruise.vz);
    approachTarget = null;
    clearDeparture();
    targetSeed = null;
    landReady = false;
    landingRequested = false;
    boostFuel = 1;
    onBoostFuel?.(1);
    wasBoosting = false;
    clearFlightEffects();
    syncProxies();
  }

  function enterNearSeed(seed: number): void {
    lastSeed = seed >>> 0;
    placeShip(entryPoseForSeed(lastSeed));
  }

  function clearDeparture(): void {
    if (departure?.root != null) scene.remove(departure.root);
    departure = null;
    cockpit.visible = true;
  }

  /** Freeze the camera while the detached hull completes the landing hold. */
  function startDeparture(target: PlanetProxySpec): void {
    cockpit.visible = false;
    const eye = new THREE.Vector3(
      pose.position.x,
      pose.position.y,
      pose.position.z,
    );
    const toCenter = new THREE.Vector3(
      target.position.x,
      target.position.y,
      target.position.z,
    ).sub(eye);
    const centerDistance = toCenter.length();
    const direction =
      centerDistance < 1e-6
        ? new THREE.Vector3(0, 0, -1).applyEuler(camera.rotation)
        : toCenter.divideScalar(centerDistance);
    const from = eye
      .clone()
      .addScaledVector(direction, DEPARTURE_AHEAD)
      .add(new THREE.Vector3(0, -DEPARTURE_DROP, 0));
    const state: Departure = {
      root: null,
      from,
      direction,
      distance: Math.max(
        centerDistance - target.radius - DEPARTURE_AHEAD,
        DEPARTURE_MIN_DISTANCE,
      ),
      elapsedMs: 0,
    };
    departure = state;
    // The template is warm (the parked ship loaded it), so the hull appears
    // on the first frames of the hold; a stale resolve is simply dropped.
    void loadShipTemplate().then((source) => {
      if (departure !== state) return;
      const { model, centerOffset } = createShipModel(source);
      model.position.copy(centerOffset);
      const root = new THREE.Group();
      root.add(model);
      root.position.copy(state.from);
      root.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 0, 1),
        state.direction,
      );
      // The shortest-arc alignment leaves the hull belly-up on dive angles;
      // roll half a turn around the nose axis so it flies right side up.
      root.rotateZ(Math.PI);
      scene.add(root);
      state.root = root;
    });
  }

  function beginApproach(seed: number): void {
    const entry = loadedNear.get(seed >>> 0);
    approachTarget = entry?.spec ?? null;
    landingRequested = true;
    // Keep the current camera view. Snapping yaw/pitch toward the planet center
    // caused a visible "jump".
    velocity.set(0, 0, 0);
    clearInput();
    onPrompt("");
    if (approachTarget !== null) startDeparture(approachTarget);
  }

  function updateDeparture(deltaTime: number): void {
    if (departure === null) return;
    departure.elapsedMs += deltaTime * 1000;
    const state = landingShipState(departure.elapsedMs, departure.distance);
    const root = departure.root;
    if (root === null) return;
    root.position
      .copy(departure.from)
      .addScaledVector(departure.direction, state.distance);
    root.scale.setScalar(Math.max(state.scale, 0.001));
    root.visible = state.scale > 0.001;
  }

  function updateFlight(deltaTime: number): void {
    if (approachTarget !== null) {
      // Camera holds still; the detached hull carries the motion.
      velocity.set(0, 0, 0);
      updateDeparture(deltaTime);
      setFlightEffects(0.3, false);
      shakePhase += deltaTime * 10;
      Sound.setSpaceFlight(0.2, 0.15, false);
    } else if (isPointerLocked()) {
      const forward = poseForward(pose);
      const right = {
        x: Math.cos(pose.yaw),
        y: 0,
        z: -Math.sin(pose.yaw),
      };
      const wantsBoost = Boolean(keys.ShiftLeft || keys.ShiftRight);
      const fuelStep = stepBoostFuel({
        fuel: boostFuel,
        wantsBoost,
        deltaTime,
      });
      boostFuel = fuelStep.fuel;
      onBoostFuel?.(boostFuel);

      if (fuelStep.boosting && !wasBoosting) {
        Sound.boostPunch();
      }
      wasBoosting = fuelStep.boosting;

      const input = {
        forward: Boolean(keys.KeyW || keys.ArrowUp),
        back: Boolean(keys.KeyS || keys.ArrowDown),
        left: Boolean(keys.KeyA || keys.ArrowLeft),
        right: Boolean(keys.KeyD || keys.ArrowRight),
        up: Boolean(keys.Space),
        boost: wantsBoost,
      };
      const step = integrateFlight({
        velocity: {
          vx: velocity.x,
          vy: velocity.y,
          vz: velocity.z,
        },
        axes: { forward, right },
        input,
        deltaTime,
        boosting: fuelStep.boosting,
      });
      velocity.set(step.velocity.vx, step.velocity.vy, step.velocity.vz);

      Sound.setSpaceFlight(
        step.speedRatio,
        step.thrustIntensity,
        fuelStep.boosting,
      );

      const intensity = flightEffectIntensity(
        step.speedRatio,
        step.thrustIntensity,
        fuelStep.boosting,
      );
      setFlightEffects(intensity, fuelStep.boosting);
      shakePhase += deltaTime * (10 + intensity * 22 + (fuelStep.boosting ? 10 : 0));
    } else {
      clearFlightEffects();
      wasBoosting = false;
      Sound.setSpaceFlight(0, 0, false);
      Sound.jetOff();
    }

    const previous = {
      x: pose.position.x,
      y: pose.position.y,
      z: pose.position.z,
    };
    pose.position.x += velocity.x * deltaTime;
    pose.position.y += velocity.y * deltaTime;
    pose.position.z += velocity.z * deltaTime;

    // Crash-land before the ship can tunnel through a near proxy shell.
    if (approachTarget === null && active && !landingRequested) {
      const specs = [...loadedNear.values()].map((entry) => entry.spec);
      const crash = findCrashLanding(previous, pose.position, specs);
      if (crash !== null) {
        pose.position = { ...crash.contact };
        velocity.set(0, 0, 0);
        landingRequested = true;
        clearInput();
        onLandRequest(crash.proxy.seed);
      }
    }
  }

  function updateScan(): void {
    if (approachTarget !== null) {
      onScan(null);
      return;
    }
    const forward = poseForward(pose);
    const specs = [...loadedNear.values()].map((entry) => entry.spec);
    const hit = pickProxy(pose.position, forward, specs);

    if (hit === null) {
      targetSeed = null;
      landReady = false;
      onScan(null);
      onPrompt("");
      return;
    }

    if (hit.seed !== targetSeed) {
      targetSeed = hit.seed;
      Sound.scanPing();
    }
    const metadata = planetMetadata(hit.seed);
    const range = surfaceRange(pose.position, hit);
    landReady = range < LAND_RANGE;
    onScan({
      name: metadata.name,
      seedHex: metadata.seedHex,
      biomeLabel: metadata.biomeLabel,
      range,
      canLand: landReady,
    });
    onPrompt(landReady ? "PRESS E — LAND" : "");
  }

  function update(deltaTime: number): void {
    if (!active) return;
    updateFlight(deltaTime);
    updateScan();
    stars.position.set(
      pose.position.x,
      pose.position.y,
      pose.position.z,
    );
    const shake = flightCameraShake({
      intensity: effectIntensity,
      phase: shakePhase,
      boosting: effectBoosting,
    });
    camera.position.set(
      pose.position.x,
      pose.position.y + shake.bobY,
      pose.position.z,
    );
    camera.rotation.set(pose.pitch + shake.pitchJitter, pose.yaw, 0);

    const targetFov = BASE_FOV + (MAX_FOV - BASE_FOV) * effectIntensity;
    if (Math.abs(camera.fov - targetFov) > 0.05) {
      camera.fov += (targetFov - camera.fov) * Math.min(1, deltaTime * 6);
      camera.updateProjectionMatrix();
    }
    syncProxies();
    updateProxyAppearance(approachTarget !== null ? null : targetSeed);
  }

  function getView(): {
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
  } {
    return { scene, camera };
  }

  function resize(aspect: number): void {
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
  }

  function setActive(nextActive: boolean): void {
    if (active === nextActive) return;
    active = nextActive;
    clearInput();
    if (!active) {
      onScan(null);
      onPrompt("");
      approachTarget = null;
      clearDeparture();
      landingRequested = false;
      clearFlightEffects();
      camera.fov = BASE_FOV;
      camera.updateProjectionMatrix();
    }
  }

  function handleMouseMove(event: MouseEvent): void {
    if (!active || approachTarget !== null || !isPointerLocked()) return;
    pose.yaw -= event.movementX * LOOK_SENSITIVITY;
    pose.pitch = clamp(
      pose.pitch - event.movementY * LOOK_SENSITIVITY,
      -1.5,
      1.5,
    );
  }

  function handleKeyDown(event: KeyboardEvent): void {
    if (!active || event.target instanceof HTMLInputElement) return;
    if (event.code === "Space") event.preventDefault();
    keys[event.code] = true;
    if (
      event.code === "KeyE" &&
      !event.repeat &&
      landReady &&
      targetSeed !== null &&
      approachTarget === null &&
      isPointerLocked()
    ) {
      onLandRequest(targetSeed);
    }
  }

  function handleKeyUp(event: KeyboardEvent): void {
    keys[event.code] = false;
  }

  function handlePointerLockChange(): void {
    if (!active) return;
    if (!isPointerLocked()) {
      clearInput();
      onPause();
    }
  }

  document.addEventListener("mousemove", handleMouseMove);
  document.addEventListener("keydown", handleKeyDown);
  document.addEventListener("keyup", handleKeyUp);
  document.addEventListener(
    "pointerlockchange",
    handlePointerLockChange,
  );
  window.addEventListener("blur", clearInput);

  return {
    enterNearSeed,
    setActive,
    beginApproach,
    update,
    getView,
    resize,
    getLastSeed(): number | null {
      return lastSeed;
    },
  };
}