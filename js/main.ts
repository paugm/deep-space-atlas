import type { Gameplay } from "./gameplay.ts";
import type { UI, UIActions } from "./ui.ts";
import type { World, WorldSystem } from "./world.ts";
import * as THREE from "three";

import { Sound, installAudioUnlockListeners } from "./audio.ts";
import {
  createBuiltinCommands,
  createCommandRegistry,
} from "./commands/index.ts";
import { HALF_WORLD, clamp, randomSeed } from "./config.ts";
import { computePetCompass } from "./fauna/compass.ts";
import { createFaunaSystem } from "./fauna/system.ts";
import { createGameplay } from "./gameplay.ts";
import { createPlanetSession, createPlanetStore, hexToSeed, seedToHex } from "./planet-save.ts";
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
import { createCrtPipeline } from "./crt.ts";
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

  const crt = createCrtPipeline(webglRenderer, scene, camera);
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
  const parkedShip = createParkedShip();
  const cinema = createCinema();

  let mode: Mode = "planet";
  let launchAscent: LaunchAscent | null = null;
  let loadChain: Promise<void> = Promise.resolve();
  let profileHydrated = false;

  function isPointerLocked(): boolean {
    return document.pointerLockElement === webglRenderer.domElement;
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
    onProfileOpen() {
      refreshProfileUi();
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

  async function openPlanetWorld(
    seed: number,
    options: { showStartOverlay: boolean } = { showStartOverlay: true },
  ): Promise<void> {
    spaceSystem.setActive(false);
    // Flush the outgoing planet (with live pose capture) before tearing down
    // session visuals that onBeforeFlush still needs.
    await profileSession.flush();
    if (worldSystem.current !== null) {
      await planetSession.flush();
    }
    faunaSystem.clear();
    roverSystem.clear();
    parkedShip.remove();
    await planetSession.open(seed, { skipFlush: true });
    const world = requireCurrentWorld();
    await faunaSystem.sync(world, planetSession.getPetEntity());
    await roverSystem.sync(world, planetSession.getRoverEntities());

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
    noteVisit(world);
    showWorldSummary(world);
    mode = "planet";
    Sound.setSpaceBed(false);
    Sound.setUnderwater(false);
    ui.setHudMode("planet");
    gameplay.setActive(true);
    if (options.showStartOverlay) ui.showOverlay("start");
  }

  function loadWorld(
    seed: number,
    options: { showStartOverlay: boolean } = { showStartOverlay: true },
  ): Promise<void> {
    loadChain = loadChain.then(() => openPlanetWorld(seed, options));
    return loadChain;
  }

  function enterSpace(seed: number): void {
    mode = "space";
    Sound.setUnderwater(false);
    Sound.setVehicle(null);
    Sound.setSpaceBed(true);
    Sound.travelWhoosh();
    gameplay.setActive(false);
    spaceSystem.enterNearSeed(seed);
    spaceSystem.setActive(true);
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
    await loadWorld(seed, { showStartOverlay: false });
    if (!isPointerLocked()) ui.showOverlay("start");
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
    worldSystem.dispose();
    enterSpace(seed);
    cinema.clear();
  }

  function persistRovers(): void {
    planetSession.recordRovers(roverSystem.getSaveEntities());
  }

  function requestBoardOrLaunch(): void {
    if (mode !== "planet" || !isPointerLocked()) return;

    if (roverSystem.isBoarded()) {
      const exit = roverSystem.disembark();
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
      ui.setRoverDriving(true);
      return;
    }

    const pose = gameplay.getPlayerPose();
    const distance = parkedShip.distanceTo(pose.x, pose.z);
    if (distance === null || distance > BOARD_RANGE) return;
    void beginLaunch();
  }

  function updatePetCompassHud(): void {
    const beacon = faunaSystem.getPetBeacon();
    if (beacon === null) {
      ui.setPetCompass(null);
      return;
    }
    const pose = gameplay.getPlayerPose();
    ui.setPetCompass(
      computePetCompass({
        playerX: pose.x,
        playerZ: pose.z,
        playerYaw: pose.yaw,
        petX: beacon.x,
        petZ: beacon.z,
        label: beacon.label,
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

  function applyProfileMute(): void {
    Sound.setMuted(profileSession.get().muted);
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
        await loadWorld(seed, { showStartOverlay: false });
        if (!isPointerLocked()) ui.showOverlay("start");
      },
      currentSeed: () => {
        const world = worldSystem.current;
        return world !== null ? world.seed >>> 0 : null;
      },
      // Command UI already notifies from the result message.
      toggleMute: () => toggleMuteAudio({ notify: false }),
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
    gameplay.loadInventory(snapshot.profile.inventory);
    if (resumeSeed !== null) {
      await openPlanetWorld(resumeSeed, { showStartOverlay: false });
    }
  }

  const actions: UIActions = {
    onPlay(): void {
      gameplay.requestPointerLock();
    },
    onToggleInventory(): void {
      gameplay.toggleInventory();
    },
    onToggleProfile(): void {
      gameplay.toggleProfile();
    },
    onDismissCommandBar(): void {
      gameplay.dismissCommandBar();
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
    onTravelToVisited(seedHex: string): void {
      const seed = hexToSeed(seedHex);
      if (seed === null) return;
      const current = worldSystem.current;
      if (current !== null && (current.seed >>> 0) === seed) {
        gameplay.toggleProfile();
        return;
      }
      Sound.resume();
      void loadWorld(seed, { showStartOverlay: false }).then(() => {
        if (!isPointerLocked()) ui.showOverlay("start");
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
            gameplay.loadInventory(profileSession.get().inventory);
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
            gameplay.loadInventory(profileSession.get().inventory);
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

  document.addEventListener("keydown", (event) => {
    if (event.target instanceof HTMLInputElement) return;
    if (event.code === "KeyE" && !event.repeat) requestBoardOrLaunch();
    if (event.code === "KeyM" && !event.repeat) toggleMuteAudio();
  });

  // Space-mode overlay bookkeeping: gameplay ignores lock while inactive.
  document.addEventListener("pointerlockchange", () => {
    if (mode === "space" && isPointerLocked()) ui.showPlaying();
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

  void profileSession.hydrate().then(() => {
    profileHydrated = true;
    applyProfileMute();
    gameplay.loadInventory(profileSession.get().inventory);
    const lastSeedHex = lastVisitedSeedHex(profileSession.get().visited);
    const resumeSeed =
      lastSeedHex !== null ? hexToSeed(lastSeedHex) : null;
    return loadWorld(resumeSeed ?? randomSeed());
  }).then(() => {
    ui.revealGameHud();
  });

  // Tab/page hide are the last reliable times to persist. Browsers routinely
  // kill async IndexedDB writes during beforeunload. Both events can fire for
  // one leave, and flush serializes overlapping callers.
  function persistOnLeave(): void {
    void planetSession.flush();
    void profileSession.flush();
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "hidden") return;
    persistOnLeave();
  });
  window.addEventListener("pagehide", persistOnLeave);

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
        updatePetCompassHud();
        updateBoardPrompt();
        crt.render(scene, camera, deltaTime);
        break;
      case "launch":
        // Input is locked; the cockpit ascent drives the camera skyward.
        launchAscent?.update(deltaTime);
        worldSystem.updateTerrain(camera.position);
        faunaSystem.update(deltaTime, gameplay.getPlayerPose());
        worldSystem.updateDayNight(time, camera.position.y);
        updatePetCompassHud();
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
