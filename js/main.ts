import type { Gameplay } from "./gameplay.ts";
import type { UI, UIActions } from "./ui.ts";
import type { World, WorldSystem } from "./world.ts";
import * as THREE from "three";

import { Sound, installAudioUnlockListeners } from "./audio.ts";
import { BLUEPRINT_DEFINITIONS } from "./blueprints.ts";
import {
  createBuiltinCommands,
  createCommandRegistry,
} from "./commands/index.ts";
import { HALF_WORLD, VERTICES_PER_ROW, clamp, randomSeed } from "./config.ts";
import { createCrtPipeline, prefersReducedMotion } from "./crt.ts";
import { computePetCompass } from "./fauna/compass.ts";
import { FAUNA_DEFINITIONS } from "./fauna/species.ts";
import { createFaunaSystem } from "./fauna/system.ts";
import { createGameplay } from "./gameplay.ts";
import type { MinimapMarker } from "./minimap.ts";
import { planetRadioPatch } from "./planet-radio.ts";
import { PlanetRadio } from "./planet-radio-player.ts";
import { createPlanetSession, createPlanetStore, hexToSeed, seedToHex } from "./planet-save.ts";
import { applySeedParam, parseSeedParam } from "./planet-url.ts";
import {
  createEmptyPlayerProfile,
  createProfileSession,
  createProfileStore,
  lastVisitedSeedHex,
} from "./player-profile.ts";
import {
  buildGameDocument,
  downloadGameFile,
  installGameDocument,
  readGameFile,
  type GameDocument,
} from "./game-save.ts";
import { replaceCampaignData } from "./save-db.ts";
import {
  BOARD_RANGE,
  createCinema,
  createParkedShip,
  createParkedShipEntity,
  createSpaceSystem,
  parseParkedShipPose,
  startLaunchAscent,
  type LaunchAscent,
} from "./space/index.ts";
import {
  createPlayerEntity,
  parsePlayerSaveState,
} from "./player-entity.ts";
import { createUI } from "./ui.ts";
import {
  ROVER_BOARD_RANGE,
  createRoverSystem,
  type RoverKindId,
} from "./vehicles/index.ts";
import {
  STRUCTURE_AIM_RANGE,
  createStructureSystem,
} from "./structures/index.ts";
import { createWorldSystem } from "./world.ts";

declare global {
  interface Window {
    __booted?: boolean;
  }
}

/** Exactly one mode simulates and renders per frame. */
type Mode = "planet" | "space" | "landing" | "launch";

const ui: UI = createUI();
installAudioUnlockListeners();

/** Marks fatal startup and completed render frames for external watchdogs. */
function signalBooted(): void {
  window.__booted = true;
}

function createRenderer(): THREE.WebGLRenderer | null {
  try {
    // CRT pipeline wants aliased edges: no MSAA, lock pixel ratio to 1.
    const renderer = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: "high-performance",
    });
    if (!renderer.getContext()) throw new Error("No WebGL context");
    return renderer;
  } catch {
    ui.showFatal(
      "WEBGL UNAVAILABLE",
      "This browser or device could not create a WebGL context. Enable hardware acceleration or try a different browser.",
    );
    signalBooted();
    return null;
  }
}

function start(webglRenderer: THREE.WebGLRenderer): void {
  webglRenderer.setPixelRatio(1);
  webglRenderer.setSize(window.innerWidth, window.innerHeight);
  document.body.prepend(webglRenderer.domElement);

  const scene: THREE.Scene = new THREE.Scene();
  const camera: THREE.PerspectiveCamera = new THREE.PerspectiveCamera(
    70,
    window.innerWidth / window.innerHeight,
    0.1,
    1600,
  );
  camera.rotation.order = "YXZ";

  const crt = createCrtPipeline(webglRenderer, scene, camera, {
    reduceMotion: prefersReducedMotion(),
  });
  crt.setSize(window.innerWidth, window.innerHeight);

  const worldSystem: WorldSystem = createWorldSystem(
    scene,
    webglRenderer,
  );
  const planetStore = createPlanetStore();
  const profileStore = createProfileStore();

  /** Filled after gameplay / parkedShip exist; used by planet flush snapshots. */
  const livePlanetCapture: { run: (() => void) | null } = { run: null };

  const planetSession = createPlanetSession({
    worldSystem,
    store: planetStore,
    onStorageWarning(message) {
      ui.notify(message, "#d9efe8");
    },
    onBeforeFlush() {
      livePlanetCapture.run?.();
    },
  });
  const profileSession = createProfileSession({
    store: profileStore,
    onStorageWarning(message) {
      ui.notify(message, "#d9efe8");
    },
  });
  const faunaSystem = createFaunaSystem();
  const roverSystem = createRoverSystem();
  const structureSystem = createStructureSystem();
  const parkedShip = createParkedShip();
  const cinema = createCinema();

  let mode: Mode = "planet";
  let launchAscent: LaunchAscent | null = null;
  let loadChain: Promise<void> = Promise.resolve();
  let profileHydrated = false;
  let minimapVisible = false;
  let pendingPhoto = false;
  let radioSeed: number | null = null;

  /** Immediate planet + profile write (cancels pending debounced saves). */
  function persistNow(): void {
    if (!profileHydrated) return;
    void planetSession.flush();
    void profileSession.flush();
  }

  /**
   * Periodic safety net while the pointer is locked. Unlock, menus, and tab
   * hide also flush; this covers long sessions without those events.
   */
  const AUTOSAVE_HEARTBEAT_MS = 45_000;
  window.setInterval(() => {
    if (!profileHydrated) return;
    if (!isPointerLocked()) return;
    if (mode !== "planet" && mode !== "space") return;
    persistNow();
  }, AUTOSAVE_HEARTBEAT_MS);

  function isPointerLocked(): boolean {
    return document.pointerLockElement === webglRenderer.domElement;
  }

  function syncSeedUrl(seed: number): void {
    const nextSearch = applySeedParam(window.location.search, seed);
    if (window.location.search === nextSearch) return;
    const next = `${window.location.pathname}${nextSearch}${window.location.hash}`;
    window.history.replaceState(null, "", next);
  }

  function refreshProfileUi(): void {
    const current = worldSystem.current;
    ui.updateProfile(
      profileSession.getView(),
      current !== null ? seedToHex(current.seed) : null,
    );
  }

  function noteVisit(world: World): void {
    profileSession.recordVisit(
      seedToHex(world.seed),
      world.name,
      planetSession.getPetEntity() !== null,
    );
  }

  const gameplay: Gameplay = createGameplay({
    scene,
    camera,
    renderer: webglRenderer,
    worldSystem,
    ui,
    faunaSystem,
    structureSystem,
    getStaticColliders() {
      const hulls = roverSystem.getCollisionAabbs();
      const ship = parkedShip.getCollisionAabb();
      if (ship !== null) hulls.push(ship);
      return hulls;
    },
    onCaveCarved(brush) {
      planetSession.recordCave(brush);
    },
    onDepositChanged(type, index, remaining) {
      planetSession.recordDeposit(type, index, remaining);
    },
    onPetChanged(entity) {
      planetSession.recordPet(entity);
      const world = worldSystem.current;
      if (world !== null) {
        profileSession.setVisitedPet(seedToHex(world.seed), true);
      }
    },
    onInventoryChanged(inventory) {
      profileSession.setInventory(inventory);
    },
    onGearChanged(gear) {
      profileSession.setGear(gear);
    },
    onStructuresChanged() {
      planetSession.recordStructures(structureSystem.getSaveEntities());
    },
    onProfileOpen() {
      refreshProfileUi();
    },
    onPersistCheckpoint() {
      persistNow();
    },
    onCrewEnlisted(crew) {
      profileSession.setCrew(crew);
      const world = worldSystem.current;
      if (world !== null) {
        void faunaSystem.syncCrew(crew, seedToHex(world.seed), {
          x: gameplay.getPlayerPose().x,
          z: gameplay.getPlayerPose().z,
        });
      }
      refreshProfileUi();
    },
    currentSeedHex() {
      const world = worldSystem.current;
      return world !== null ? seedToHex(world.seed) : null;
    },
    currentWorldName() {
      return worldSystem.current?.name ?? "Unknown";
    },
    onUnderwater(active) {
      PlanetRadio.setDucked(active);
    },
  });

  livePlanetCapture.run = () => {
    if (worldSystem.current === null) return;
    planetSession.recordPlayer(
      createPlayerEntity(gameplay.getPlayerSaveState()),
      { schedule: false },
    );
    const shipPose = parkedShip.getPose();
    if (shipPose !== null) {
      planetSession.recordParkedShip(createParkedShipEntity(shipPose), {
        schedule: false,
      });
    }
    const petEntity = faunaSystem.getPetSaveEntity();
    if (petEntity !== null) {
      planetSession.recordPet(petEntity, { schedule: false });
    }
    // Persist rover pads only after the player has moved or spawned one
    // (save already has rover rows, or the boarded pose is live).
    if (
      planetSession.getRoverEntities().length > 0 ||
      roverSystem.isBoarded()
    ) {
      planetSession.recordRovers(roverSystem.getSaveEntities(), {
        schedule: false,
      });
    }
    planetSession.recordStructures(structureSystem.getSaveEntities(), {
      schedule: false,
    });
  };

  const spaceSystem = createSpaceSystem({
    renderer: webglRenderer,
    onScan(readout) {
      ui.setScanReadout(readout);
    },
    onPrompt(text) {
      if (mode === "space") ui.setPrompt(text);
    },
    onLandRequest(seed) {
      void beginLanding(seed);
    },
    onPause() {
      if (mode === "space") ui.showOverlay("paused");
    },
    onBoostFuel(fuel) {
      if (mode === "space" || mode === "landing") ui.setFuel(fuel);
    },
    onFlightSpeed(speed, boosting) {
      if (mode === "space" || mode === "landing" || mode === "launch") {
        ui.setFlightSpeed(speed, boosting);
      }
    },
  });

  function requireCurrentWorld(): World {
    const world = worldSystem.current;
    if (world === null) {
      throw new Error("Main requires an active world.");
    }
    return world;
  }

  function showWorldSummary(world: World): void {
    ui.setWorldSummary({
      seed: world.seed,
      name: world.name,
      biome: {
        label: world.hasFauna
          ? `${world.biome.label} · FAUNA`
          : world.biome.label,
      },
    });
  }

  async function openPlanetWorld(seed: number): Promise<void> {
    spaceSystem.setActive(false);
    ui.setSessionReady(false);
    // Flush the outgoing planet (with live pose capture) before tearing down
    // session visuals that onBeforeFlush still needs.
    await profileSession.flush();
    if (worldSystem.current !== null) {
      await planetSession.flush();
    }
    faunaSystem.clear();
    roverSystem.clear();
    structureSystem.clear();
    parkedShip.remove();
    await planetSession.open(seed, { skipFlush: true });
    const world = requireCurrentWorld();
    await faunaSystem.sync(world, planetSession.getPetEntity());
    await roverSystem.sync(world, planetSession.getRoverEntities());
    structureSystem.sync(world, planetSession.getStructureEntities());

    const savedShip = planetSession.getParkedShipEntity();
    const shipPose =
      savedShip !== null ? parseParkedShipPose(savedShip) : null;
    if (shipPose !== null) {
      await parkedShip.placeAt(
        scene,
        world,
        shipPose.x,
        shipPose.z,
        shipPose.yaw,
      );
    } else {
      await parkedShip.place(scene, world);
      const defaultPose = parkedShip.getPose();
      if (defaultPose !== null) {
        planetSession.recordParkedShip(createParkedShipEntity(defaultPose));
      }
    }

    gameplay.setMount(null);
    ui.setRoverDriving(false);
    gameplay.resetWorld();
    const savedPlayer = planetSession.getPlayerEntity();
    const playerPose =
      savedPlayer !== null ? parsePlayerSaveState(savedPlayer) : null;
    if (playerPose !== null) {
      gameplay.applySavedPose(playerPose);
    }

    gameplay.loadInventory(profileSession.get().inventory);
    gameplay.loadGear(profileSession.get().gear);
    await syncTravelingCrew();
    noteVisit(world);
    showWorldSummary(world);
    syncSeedUrl(world.seed);
    mode = "planet";
    Sound.setSpaceBed(false);
    Sound.setUnderwater(false);
    ui.setHudMode("planet");
    paintWorldMinimap();
    applyLookSensitivity();
    applyCrtComfort();
    gameplay.setActive(true);
    ui.setSessionReady(true);
    void startPlanetRadio();
    if (!isPointerLocked()) ui.showOverlay("start");
  }

  function loadWorld(seed: number): Promise<void> {
    loadChain = loadChain.then(() => openPlanetWorld(seed));
    return loadChain;
  }

  function enterSpace(seed: number): void {
    mode = "space";
    stopPlanetRadio();
    ui.setMinimapVisible(false);
    Sound.setUnderwater(false);
    Sound.setVehicle(null);
    Sound.setSpaceBed(true);
    Sound.travelWhoosh();
    gameplay.setActive(false);
    spaceSystem.enterNearSeed(seed);
    spaceSystem.setActive(true);
    applyLookSensitivity();
    syncSeedUrl(seed);
    ui.setHudMode("space");
    ui.setScanReadout(null);
    ui.showPlaying();
    gameplay.requestPointerLock();
  }

  /**
   * Space → planet: the hull detaches and dives at the planet in third
   * person, shrinking away, then a black fade hard-cuts into the world.
   */
  async function beginLanding(seed: number): Promise<void> {
    if (mode !== "space") return;
    mode = "landing";
    ui.setPrompt("");
    spaceSystem.beginApproach(seed);
    await cinema.playLand();
    spaceSystem.setActive(false);
    await loadWorld(seed);
    cinema.clear();
  }

  /**
   * Planet → space: ride the cockpit skyward from the pad with shake, fade
   * to black, dispose the world, and resume flight control in space.
   */
  async function beginLaunch(): Promise<void> {
    const world = requireCurrentWorld();
    const seed = world.seed;
    mode = "launch";
    gameplay.setActive(false);
    ui.setPrompt("");
    const passengerSpecies = faunaSystem.getPassengerSpecies();
    faunaSystem.setPassengerParent(null);
    const playerPose = gameplay.getPlayerPose();
    const pad = parkedShip.getPose() ?? {
      x: playerPose.x,
      z: playerPose.z,
      yaw: playerPose.yaw,
    };
    // The player is flying the vessel now; its pad entity stays in the save.
    parkedShip.remove();
    launchAscent = startLaunchAscent({
      scene,
      camera,
      x: pad.x,
      z: pad.z,
      yaw: pad.yaw,
      startY: world.heightAt(pad.x, pad.z) + 2.2,
    });
    await cinema.playLaunch();
    launchAscent.dispose();
    launchAscent = null;
    await Promise.all([planetSession.flush(), profileSession.flush()]);
    planetSession.suspend();
    faunaSystem.clear();
    roverSystem.clear();
    structureSystem.clear();
    worldSystem.dispose();
    enterSpace(seed);
    void spaceSystem.setPassengerSpecies(passengerSpecies);
    cinema.clear();
  }

  function persistRovers(): void {
    planetSession.recordRovers(roverSystem.getSaveEntities());
  }

  function requestBoardOrLaunch(): void {
    if (mode !== "planet" || !isPointerLocked()) return;

    if (roverSystem.isBoarded()) {
      faunaSystem.setPassengerParent(null);
      const exit = roverSystem.disembark();
      roverSystem.setHeadlights(false);
      Sound.dismountVehicle();
      gameplay.setMount(null);
      ui.setRoverDriving(false);
      if (exit !== null) {
        gameplay.exitRoverCabin({
          x: exit.standX,
          z: exit.standZ,
          yaw: exit.yaw,
          eyeHeight: exit.eyeHeight,
        });
      }
      persistRovers();
      return;
    }

    const aimedRover = roverSystem.aimedInRange(camera, ROVER_BOARD_RANGE);
    if (aimedRover !== null) {
      const cabin = roverSystem.board(aimedRover.id);
      if (cabin === null) return;
      Sound.boardVehicle();
      gameplay.enterRoverCabin({
        x: cabin.x,
        z: cabin.z,
        yaw: cabin.yaw,
        eyeHeight: cabin.eyeHeight,
      });
      gameplay.setMount({
        speed: cabin.speed,
        eyeHeight: cabin.eyeHeight,
        kind: cabin.kind,
      });
      roverSystem.setHeadlights(true);
      const boardedRoot = roverSystem.getBoardedRoot();
      if (boardedRoot !== null) {
        faunaSystem.setPassengerParent(boardedRoot);
      }
      ui.setRoverDriving(true);
      return;
    }

    const pose = gameplay.getPlayerPose();
    const distance = parkedShip.distanceTo(pose.x, pose.z);
    if (distance === null || distance > BOARD_RANGE) return;
    void beginLaunch();
  }

  function updateNavCompassHud(): void {
    const pose = gameplay.getPlayerPose();
    const structure = structureSystem.nearest(pose);
    if (structure !== null) {
      ui.setPetCompass(
        computePetCompass({
          playerX: pose.x,
          playerZ: pose.z,
          playerYaw: pose.yaw,
          petX: structure.x,
          petZ: structure.z,
          label: structure.label,
        }),
      );
      return;
    }
    const pet = faunaSystem.getCrewBeacon() ?? faunaSystem.getPetBeacon();
    if (pet === null) {
      ui.setPetCompass(null);
      return;
    }
    ui.setPetCompass(
      computePetCompass({
        playerX: pose.x,
        playerZ: pose.z,
        playerYaw: pose.yaw,
        petX: pet.x,
        petZ: pet.z,
        label: pet.label,
      }),
    );
  }

  function updateBoardPrompt(): void {
    if (!isPointerLocked()) {
      ui.setPrompt("");
      return;
    }
    if (roverSystem.isBoarded()) {
      ui.setPrompt("PRESS E — EXIT ROVER");
      return;
    }
    if (roverSystem.aimedInRange(camera, ROVER_BOARD_RANGE) !== null) {
      ui.setPrompt("PRESS E — BOARD ROVER");
      return;
    }
    const aimedStructure = structureSystem.aimedInRange(
      camera,
      STRUCTURE_AIM_RANGE,
    );
    if (aimedStructure !== null) {
      ui.setPrompt(
        `HOLD LMB — SALVAGE ${BLUEPRINT_DEFINITIONS[aimedStructure.blueprintId].label.toUpperCase()}`,
      );
      return;
    }
    const pose = gameplay.getPlayerPose();
    const distance = parkedShip.distanceTo(pose.x, pose.z);
    ui.setPrompt(
      distance !== null && distance <= BOARD_RANGE
        ? "PRESS E — BOARD SHIP"
        : "",
    );
  }

  async function spawnSpaceshipAhead(meters: number): Promise<void> {
    const world = requireCurrentWorld();
    const pose = gameplay.getPlayerPose();
    const x = clamp(
      pose.x - Math.sin(pose.yaw) * meters,
      -HALF_WORLD + 4,
      HALF_WORLD - 4,
    );
    const z = clamp(
      pose.z - Math.cos(pose.yaw) * meters,
      -HALF_WORLD + 4,
      HALF_WORLD - 4,
    );
    const yaw = Math.atan2(pose.x - x, pose.z - z);
    await parkedShip.placeAt(scene, world, x, z, yaw);
    planetSession.recordParkedShip(createParkedShipEntity({ x, z, yaw }));
  }

  async function spawnRoverAhead(
    kind: RoverKindId,
    meters: number,
  ): Promise<void> {
    const world = requireCurrentWorld();
    const pose = gameplay.getPlayerPose();
    await roverSystem.spawnAhead(
      world,
      kind,
      { x: pose.x, z: pose.z, yaw: pose.yaw },
      meters,
    );
    persistRovers();
  }

  function applyCrtComfort(): void {
    crt.setReduceMotion(
      prefersReducedMotion() || profileSession.get().reduceCrtMotion,
    );
  }

  function applyLookSensitivity(): void {
    const value = profileSession.get().lookSensitivity;
    gameplay.setLookSensitivity(value);
    spaceSystem.setLookSensitivity(value);
  }

  function applyProfileMute(): void {
    const muted = profileSession.get().muted;
    Sound.setMuted(muted);
    PlanetRadio.setMuted(muted);
  }

  function paintWorldMinimap(): void {
    const world = worldSystem.current;
    if (world === null) return;
    const water = world.palette.water;
    ui.paintMinimapTerrain({
      heights: world.heights,
      verticesPerRow: VERTICES_PER_ROW,
      minimumHeight: world.minimumHeight,
      maximumHeight: world.maximumHeight,
      palette: {
        low: [world.palette.low.r, world.palette.low.g, world.palette.low.b],
        mid: [world.palette.mid.r, world.palette.mid.g, world.palette.mid.b],
        high: [world.palette.high.r, world.palette.high.g, world.palette.high.b],
        peak: [
          world.palette.peak.r,
          world.palette.peak.g,
          world.palette.peak.b,
        ],
        ...(water !== undefined
          ? { water: [water.r, water.g, water.b] as const }
          : {}),
      },
      waterLevel: world.waterLevel,
      hasSurface: world.surfaceKind !== "none",
    });
    ui.setMinimapVisible(minimapVisible);
  }

  function updateMinimapMarkers(): void {
    if (!minimapVisible || mode !== "planet") return;
    const pose = gameplay.getPlayerPose();
    const markers: MinimapMarker[] = [
      { x: pose.x, z: pose.z, kind: "player", yaw: pose.yaw },
      ...structureSystem.footprints().map((entry) => ({
        x: entry.x,
        z: entry.z,
        kind: "structure" as const,
      })),
    ];
    const pet = faunaSystem.getPetBeacon();
    if (pet !== null) {
      markers.push({ x: pet.x, z: pet.z, kind: "pet" });
    }
    const crew = faunaSystem.getCrewBeacon();
    if (crew !== null) {
      markers.push({ x: crew.x, z: crew.z, kind: "crew" });
    }
    ui.setMinimapMarkers(markers, pose.yaw);
  }

  async function startPlanetRadio(): Promise<void> {
    const world = worldSystem.current;
    if (world === null) return;
    PlanetRadio.setMuted(profileSession.get().muted);
    if (radioSeed === world.seed) return;
    try {
      await PlanetRadio.start(
        planetRadioPatch(world.seed, world.planetClassId),
      );
      radioSeed = world.seed;
    } catch {
      radioSeed = null;
    }
  }

  function stopPlanetRadio(): void {
    radioSeed = null;
    PlanetRadio.setDucked(false);
    PlanetRadio.stop();
  }

  async function syncTravelingCrew(): Promise<void> {
    const world = worldSystem.current;
    if (world === null) return;
    const pose = gameplay.getPlayerPose();
    await faunaSystem.syncCrew(
      profileSession.get().crew,
      seedToHex(world.seed),
      { x: pose.x, z: pose.z },
    );
  }

  function enlistCrewFromPet():
    | { ok: true; label: string }
    | { ok: false; reason: "no-pet" | "no-world" } {
    const world = worldSystem.current;
    if (world === null || mode !== "planet") {
      return { ok: false, reason: "no-world" };
    }
    const crew = faunaSystem.enlistPet(seedToHex(world.seed), world.name);
    if (crew === null) return { ok: false, reason: "no-pet" };
    profileSession.setCrew(crew);
    void faunaSystem.syncCrew(crew, seedToHex(world.seed), {
      x: gameplay.getPlayerPose().x,
      z: gameplay.getPlayerPose().z,
    });
    refreshProfileUi();
    return { ok: true, label: FAUNA_DEFINITIONS[crew.species].label };
  }

  function releaseTravelingCrew():
    | { ok: true; stayedAsPet: boolean; label: string }
    | { ok: false; reason: "no-crew" } {
    const crew = profileSession.get().crew;
    if (crew === null) return { ok: false, reason: "no-crew" };
    const label = FAUNA_DEFINITIONS[crew.species].label;
    const petEntity = faunaSystem.releaseCrewAsPet();
    if (petEntity !== null) {
      planetSession.recordPet(petEntity);
      const world = worldSystem.current;
      if (world !== null) {
        profileSession.setVisitedPet(seedToHex(world.seed), true);
      }
    } else {
      faunaSystem.dismissCrewFollower();
    }
    profileSession.setCrew(null);
    refreshProfileUi();
    return { ok: true, stayedAsPet: petEntity !== null, label };
  }

  function toggleMuteAudio(options: { notify?: boolean } = {}): boolean {
    const muted = Sound.toggleMute();
    profileSession.setMuted(muted);
    Sound.uiClick();
    if (options.notify !== false) {
      ui.notify(muted ? "AUDIO MUTED" : "AUDIO RESTORED", "#7df0cf");
    }
    return muted;
  }

  const commands = createCommandRegistry(
    createBuiltinCommands({
      hasPlanetWorld: () => worldSystem.current !== null && mode === "planet",
      spawnSpaceshipAhead,
      spawnRoverAhead,
      async travelToSeed(seed) {
        await loadWorld(seed);
      },
      currentSeed: () => {
        const world = worldSystem.current;
        return world !== null ? world.seed >>> 0 : null;
      },
      // Command UI already notifies from the result message.
      toggleMute: () => toggleMuteAudio({ notify: false }),
      buildItem(token) {
        const result = gameplay.attemptFabricate(token, { free: true });
        if (result.ok) {
          return { ok: true as const, label: result.label };
        }
        if (result.reason === "unknown") {
          return { ok: false as const, reason: "unknown" as const };
        }
        return { ok: false as const, reason: result.reason };
      },
      installGear(token) {
        const result = gameplay.attemptInstallGear(token, { free: true });
        if (result.ok) {
          return { ok: true as const, label: result.label };
        }
        if (result.reason === "already-owned") {
          return { ok: false as const, reason: "already-owned" as const };
        }
        return { ok: false as const, reason: "unknown" as const };
      },
      async adoptPet() {
        if (worldSystem.current === null || mode !== "planet") {
          return { ok: false as const, reason: "no-world" as const };
        }
        const pose = gameplay.getPlayerPose();
        const result = await faunaSystem.adoptPet({
          x: pose.x,
          z: pose.z,
        });
        if (!result.ok) {
          return { ok: false as const, reason: result.reason };
        }
        planetSession.recordPet(result.entity);
        profileSession.setVisitedPet(
          seedToHex(worldSystem.current.seed),
          true,
        );
        Sound.petBond();
        return { ok: true as const, label: result.label };
      },
      enlistCrew() {
        return enlistCrewFromPet();
      },
      releaseCrew() {
        return releaseTravelingCrew();
      },
    }),
  );

  async function captureCampaignSnapshot(): Promise<GameDocument> {
    const world = worldSystem.current;
    const lastSeed =
      world !== null
        ? seedToHex(world.seed)
        : lastVisitedSeedHex(profileSession.get().visited) ?? "00000000";
    return buildGameDocument({
      lastSeed,
      profile: profileSession.get(),
      planetStore,
    });
  }

  async function restoreCampaignSnapshot(
    snapshot: GameDocument,
    resumeSeed: number | null,
  ): Promise<void> {
    planetSession.suspend();
    await installGameDocument({ document: snapshot });
    profileSession.adopt(snapshot.profile);
    applyProfileMute();
    applyLookSensitivity();
    applyCrtComfort();
    gameplay.loadInventory(snapshot.profile.inventory);
    gameplay.loadGear(snapshot.profile.gear);
    if (resumeSeed !== null) {
      await openPlanetWorld(resumeSeed);
    }
  }

  const actions: UIActions = {
    onPlay(): void {
      if (worldSystem.current === null) return;
      void PlanetRadio.prepare().then(() => {
        if (mode === "planet") void startPlanetRadio();
      });
      gameplay.requestPointerLock();
    },
    onToggleInventory(): void {
      gameplay.toggleInventory();
    },
    onToggleGearMenu(): void {
      gameplay.toggleGearMenu();
    },
    onToggleBuildMenu(): void {
      gameplay.toggleBuildMenu();
    },
    onToggleProfile(): void {
      gameplay.toggleProfile();
    },
    onOpenMenu(menu): void {
      gameplay.openMenu(menu);
    },
    onDismissCommandBar(): void {
      gameplay.dismissCommandBar();
    },
    onInstallGear(gearId): void {
      const result = gameplay.attemptInstallGear(gearId);
      if (result.ok) {
        Sound.uiClick();
        ui.notify(`INSTALLED · ${result.label.toUpperCase()}`, "#7df0cf");
        return;
      }
      Sound.uiError();
      switch (result.reason) {
        case "already-owned":
          ui.notify("ALREADY INSTALLED", "#ffb347");
          break;
        case "cannot-afford":
          ui.notify("INSUFFICIENT CARGO", "#ff6b6b");
          break;
        case "missing-prerequisite":
          ui.notify("PREREQUISITE MISSING", "#ffb347");
          break;
        case "unknown":
          ui.notify("UNKNOWN SCHEMATIC", "#ff6b6b");
          break;
        default: {
          const exhaustive: never = result.reason;
          throw new Error(`Unhandled gear reason: ${String(exhaustive)}`);
        }
      }
    },
    onFabricate(blueprintId): void {
      const result = gameplay.attemptFabricate(blueprintId);
      if (result.ok) {
        Sound.uiClick();
        ui.notify(`FABRICATED · ${result.label.toUpperCase()}`, "#7df0cf");
        gameplay.toggleBuildMenu();
        return;
      }
      Sound.uiError();
      switch (result.reason) {
        case "cannot-afford":
          ui.notify("INSUFFICIENT CARGO", "#ff6b6b");
          break;
        case "unknown":
        case "unknown-blueprint":
          ui.notify("UNKNOWN BLUEPRINT", "#ff6b6b");
          break;
        case "at-limit":
          ui.notify("PLANET LIMIT REACHED", "#ffb347");
          break;
        case "too-close":
          ui.notify("TOO CLOSE TO ANOTHER", "#ffb347");
          break;
        case "out-of-bounds":
          ui.notify("OUT OF BOUNDS", "#ffb347");
          break;
        case "too-steep":
          ui.notify("TERRAIN TOO STEEP", "#ffb347");
          break;
        case "no-world":
          ui.notify("NO PLANET UNDERFOOT", "#ff6b6b");
          break;
        default: {
          const exhaustive: never = result.reason;
          throw new Error(`Unhandled fabricate reason: ${String(exhaustive)}`);
        }
      }
    },
    onCommandSubmit(line: string): void {
      void commands.dispatch(line).then((result) => {
        ui.setCommandFeedback(
          result.message,
          result.ok ? "ok" : "error",
        );
        ui.notify(
          result.message,
          result.ok ? "#7df0cf" : "#ff6b6b",
        );
        if (result.ok) {
          gameplay.closeCommandBar();
        }
      });
    },
    onProfileRename(name: string): void {
      profileSession.setName(name);
      refreshProfileUi();
      ui.notify("CALLSIGN UPDATED", "#7df0cf");
    },
    onLookSensitivity(value: number): void {
      profileSession.setLookSensitivity(value);
      applyLookSensitivity();
    },
    onReduceCrtMotion(reduce: boolean): void {
      profileSession.setReduceCrtMotion(reduce);
      applyCrtComfort();
    },
    onCrewEnlist(): void {
      const result = enlistCrewFromPet();
      if (!result.ok) {
        switch (result.reason) {
          case "no-pet":
            ui.notify("NO COMPANION TO ENLIST", "#ffb347");
            break;
          case "no-world":
            ui.notify("NO PLANET UNDERFOOT", "#ffb347");
            break;
          default: {
            const exhaustive: never = result.reason;
            throw new Error(`Unhandled enlist: ${String(exhaustive)}`);
          }
        }
        Sound.uiError();
        return;
      }
      Sound.petBond();
      ui.notify(`CREW ENLISTED · ${result.label.toUpperCase()}`, "#7df0cf");
    },
    onCrewRelease(): void {
      const result = releaseTravelingCrew();
      if (!result.ok) {
        ui.notify("NO CREW ABOARD", "#ffb347");
        Sound.uiError();
        return;
      }
      ui.notify(
        result.stayedAsPet
          ? `CREW SETTLED · ${result.label.toUpperCase()}`
          : `CREW DISMISSED · ${result.label.toUpperCase()}`,
        "#7df0cf",
      );
    },
    onTravelToVisited(seedHex: string): void {
      const seed = hexToSeed(seedHex);
      if (seed === null) return;
      const current = worldSystem.current;
      if (current !== null && (current.seed >>> 0) === seed) {
        gameplay.toggleProfile();
        return;
      }
      Sound.resume();
      void loadWorld(seed).then(() => {
        ui.notify(`TRAVELING TO ${seedHex}`, "#7df0cf");
      });
    },
    onSaveGame(): void {
      loadChain = loadChain
        .then(async () => {
          await Promise.all([planetSession.flush(), profileSession.flush()]);
          const lastSeed =
            worldSystem.current !== null
              ? seedToHex(worldSystem.current.seed)
              : (lastVisitedSeedHex(profileSession.get().visited) ??
                "00000000");
          const document = await buildGameDocument({
            lastSeed,
            profile: profileSession.get(),
            planetStore,
          });
          downloadGameFile(document);
          ui.notify("GAME SAVED", "#7df0cf");
        })
        .catch((error: unknown) => {
          const message =
            error instanceof Error
              ? error.message
              : "Could not save game.";
          ui.notify(message.toUpperCase(), "#ff6b6b");
        });
    },
    onLoadGame(file: File): void {
      loadChain = loadChain
        .then(async () => {
          const document = await readGameFile(file);
          const previousSeed = worldSystem.current?.seed ?? null;
          await Promise.all([planetSession.flush(), profileSession.flush()]);
          const previousCampaign = await captureCampaignSnapshot();
          planetSession.suspend();
          try {
            await installGameDocument({ document });
            profileSession.adopt(document.profile);
            applyProfileMute();
            applyLookSensitivity();
            applyCrtComfort();
            gameplay.loadInventory(profileSession.get().inventory);
            gameplay.loadGear(profileSession.get().gear);
            const resumeSeed =
              hexToSeed(document.lastSeed) ??
              hexToSeed(
                lastVisitedSeedHex(document.profile.visited) ?? "",
              ) ??
              randomSeed();
            Sound.resume();
            await openPlanetWorld(resumeSeed);
            ui.notify("GAME LOADED", "#7df0cf");
          } catch (error) {
            try {
              await restoreCampaignSnapshot(previousCampaign, previousSeed);
            } catch {
              if (previousSeed !== null) planetSession.resume();
            }
            throw error;
          }
        })
        .catch((error: unknown) => {
          const message =
            error instanceof Error
              ? error.message
              : "Could not load game file.";
          ui.notify(message.toUpperCase(), "#ff6b6b");
        });
    },
    onNewGame(): void {
      const confirmed = window.confirm(
        "Start a new campaign? This erases all surveyed planets, cargo, and profile progress stored in this browser.",
      );
      if (!confirmed) return;
      Sound.resume();
      loadChain = loadChain
        .then(async () => {
          const previousSeed = worldSystem.current?.seed ?? null;
          await Promise.all([planetSession.flush(), profileSession.flush()]);
          const previousCampaign = await captureCampaignSnapshot();
          planetSession.suspend();
          try {
            const emptyProfile = createEmptyPlayerProfile();
            await replaceCampaignData({
              planets: [],
              profile: emptyProfile,
            });
            profileSession.adopt(emptyProfile);
            applyProfileMute();
            applyLookSensitivity();
            applyCrtComfort();
            gameplay.loadInventory(profileSession.get().inventory);
            gameplay.loadGear(profileSession.get().gear);
            await openPlanetWorld(randomSeed());
            ui.notify("NEW CAMPAIGN", "#7df0cf");
          } catch (error) {
            try {
              await restoreCampaignSnapshot(previousCampaign, previousSeed);
            } catch {
              if (previousSeed !== null) planetSession.resume();
            }
            throw error;
          }
        })
        .catch((error: unknown) => {
          const message =
            error instanceof Error
              ? error.message
              : "Could not start a new game.";
          ui.notify(message.toUpperCase(), "#ff6b6b");
        });
    },
  };
  ui.bindActions(actions);

  function toggleMinimap(): void {
    if (mode !== "planet") return;
    minimapVisible = !minimapVisible;
    ui.setMinimapVisible(minimapVisible);
  }

  function captureSurveyPhoto(): void {
    const world = worldSystem.current;
    if (world === null) return;
    const seedHex = seedToHex(world.seed);
    const shot = ui.capturePostcard(
      webglRenderer.domElement,
      world.name,
      seedHex,
    );
    if (shot === null) {
      ui.notify("PHOTO FAILED", "#ff6b6b");
      return;
    }
    profileSession.addPostcard({
      seed: seedHex,
      name: world.name,
      capturedAt: Date.now(),
      thumb: shot.thumb,
    });
    const link = document.createElement("a");
    link.href = shot.pngDataUrl;
    link.download = shot.filename;
    link.click();
    void (async () => {
      try {
        const blob = await (await fetch(shot.pngDataUrl)).blob();
        const file = new File([blob], shot.filename, { type: "image/png" });
        if (
          navigator.share !== undefined &&
          navigator.canShare?.({ files: [file] })
        ) {
          await navigator.share({
            files: [file],
            title: world.name,
            text: `Deep Space Atlas  ?seed=${seedHex}`,
          });
        }
      } catch {
        // Share cancel is fine; the PNG already downloaded.
      }
    })();
    ui.notify("POSTCARD STAMPED", "#7df0cf");
    refreshProfileUi();
  }

  function finishPendingPhoto(): void {
    if (!pendingPhoto) return;
    pendingPhoto = false;
    ui.setPhotoMode(true);
    crt.render(scene, camera, 0);
    captureSurveyPhoto();
    ui.setPhotoMode(false);
  }

  document.addEventListener("keydown", (event) => {
    if (event.target instanceof HTMLInputElement) return;
    if (event.code === "KeyE" && !event.repeat) requestBoardOrLaunch();
    if (event.code === "KeyM" && !event.repeat) toggleMuteAudio();
    if (event.code === "KeyN" && !event.repeat) toggleMinimap();
    if (event.code === "KeyF" && !event.repeat) {
      if (mode === "planet" && isPointerLocked()) pendingPhoto = true;
    }
  });

  // Space-mode overlay bookkeeping: gameplay ignores lock while inactive.
  // Any unlock (planet Escape/click-away or space pause) forces an autosave.
  document.addEventListener("pointerlockchange", () => {
    if (isPointerLocked()) {
      if (mode === "space") ui.showPlaying();
      if (mode === "planet") void startPlanetRadio();
      return;
    }
    persistNow();
  });
  document.addEventListener("pointerlockerror", () => {
    if (mode === "space") ui.showOverlay("paused");
  });

  const handleResize = (): void => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const aspect = width / height;
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
    spaceSystem.resize(aspect);
    webglRenderer.setSize(width, height);
    crt.setSize(width, height);
  };
  window.addEventListener("resize", handleResize);

  const motionQuery =
    typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-reduced-motion: reduce)")
      : null;
  motionQuery?.addEventListener("change", () => {
    applyCrtComfort();
  });

  void profileSession.hydrate().then(() => {
    profileHydrated = true;
    applyProfileMute();
    applyLookSensitivity();
    applyCrtComfort();
    gameplay.loadInventory(profileSession.get().inventory);
    gameplay.loadGear(profileSession.get().gear);
    const urlSeed = parseSeedParam(window.location.search);
    const lastSeedHex = lastVisitedSeedHex(profileSession.get().visited);
    const resumeSeed =
      urlSeed ??
      (lastSeedHex !== null ? hexToSeed(lastSeedHex) : null);
    return loadWorld(resumeSeed ?? randomSeed());
  }).then(() => {
    ui.revealGameHud();
  });

  // Tab/page hide are the last reliable times to persist. Browsers routinely
  // kill async IndexedDB writes during beforeunload. Both events can fire for
  // one leave, and flush serializes overlapping callers. Unlock, menus, and a
  // 45s heartbeat also call persistNow while the tab is alive.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "hidden") return;
    persistNow();
  });
  window.addEventListener("pagehide", persistNow);

  const timer = new THREE.Timer();
  timer.connect(document);
  const renderFrame = (timestamp?: number): void => {
    timer.update(timestamp);
    // Clamp frame delta so resumed tabs cannot jump the simulation.
    const deltaTime = Math.min(timer.getDelta(), 0.05);
    const time = timer.getElapsed();

    if (
      profileHydrated &&
      isPointerLocked() &&
      (mode === "planet" || mode === "space")
    ) {
      profileSession.addPlayTime(deltaTime * 1000);
    }

    switch (mode) {
      case "planet":
        worldSystem.updateTerrain(camera.position);
        gameplay.update(deltaTime, time);
        if (roverSystem.isBoarded()) {
          const pose = gameplay.getPlayerPose();
          roverSystem.updateBoarded({
            x: pose.x,
            z: pose.z,
            yaw: pose.yaw,
          });
        }
        faunaSystem.update(deltaTime, gameplay.getPlayerPose());
        worldSystem.updateDayNight(time, camera.position.y);
        updateNavCompassHud();
        updateBoardPrompt();
        updateMinimapMarkers();
        crt.render(scene, camera, deltaTime);
        finishPendingPhoto();
        break;
      case "launch":
        // Input is locked; the cockpit ascent drives the camera skyward.
        launchAscent?.update(deltaTime);
        worldSystem.updateTerrain(camera.position);
        faunaSystem.update(deltaTime, gameplay.getPlayerPose());
        worldSystem.updateDayNight(time, camera.position.y);
        updateNavCompassHud();
        crt.render(scene, camera, deltaTime);
        break;
      case "space":
      case "landing": {
        ui.setPetCompass(null);
        spaceSystem.update(deltaTime);
        const view = spaceSystem.getView();
        crt.render(view.scene, view.camera, deltaTime);
        break;
      }
      default: {
        const exhaustiveMode: never = mode;
        throw new Error(`Unknown mode: ${String(exhaustiveMode)}`);
      }
    }
    signalBooted();
  };
  webglRenderer.setAnimationLoop(renderFrame);
}

const renderer: THREE.WebGLRenderer | null = createRenderer();
if (renderer !== null) start(renderer);
