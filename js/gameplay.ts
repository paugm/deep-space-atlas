import type {
  DepositType,
  Inventory,
  MaterialId,
} from "./config.ts";
import type { UI } from "./ui.ts";
import type { AimHit, World, WorldSystem } from "./world.ts";
import * as THREE from "three";

import { Sound } from "./audio.ts";
import type { BuildId, BuildModifiers, TryBuildReason } from "./builds.ts";
import {
  resolveBuildModifiers,
  tryBuild,
} from "./builds.ts";
import {
  type SolidCollider,
  resolveCapsuleAgainstSolids,
  slideVelocityFromCorrection,
} from "./collision.ts";
import {
  DEPOSIT_DEFINITIONS,
  EYE_HEIGHT,
  GRAVITY,
  HALF_WORLD,
  JET_ACCELERATION,
  MATERIAL_ORDER,
  MATERIALS,
  PLAYER_COLLISION_QUERY_RADIUS,
  PLAYER_RADIUS,
  ROCK_COLLIDER_RADIUS_FACTOR,
  ROVER_DRIVE_SPEED,
  WATER_DEPTH_FOR_FULL_FOG,
  WATER_GRAVITY_FACTOR,
  clamp,
  lerp,
} from "./config.ts";
import { sampleWaterImmersion } from "./water.ts";
import { TAME_TIME } from "./fauna/motion.ts";
import {
  FAUNA_DEFINITIONS,
  isFaunaSpeciesId,
} from "./fauna/species.ts";
import type { FaunaSystem } from "./fauna/system.ts";
import type { PlanetEntity } from "./planet-save.ts";
import type { RoverKindId } from "./vehicles/kinds.ts";
import { createRadialTexture } from "./world.ts";
import type { CaveBrush } from "./world/caves.ts";
import { cloneInventory } from "./player-profile.ts";

const UP = new THREE.Vector3(0, 1, 0);

interface PlayerState {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  yaw: number;
  pitch: number;
  grounded: boolean;
  bobPhase: number;
  stepDistance: number;
  fuel: number;
}

type KeyboardState = Record<string, boolean | undefined>;

type MiningKey =
  | "terrain"
  | `rock:${number}`
  | `flora:${number}`
  | `deposit:${DepositType}:${number}`
  | `fauna:${string}`;

interface HitInfo {
  label: string;
  material: MaterialId;
}

export interface Gameplay {
  requestPointerLock(): void;
  resetWorld(): void;
  /** Saved pose is in eye-space. */
  applySavedPose(state: {
    x: number;
    y: number;
    z: number;
    yaw: number;
    pitch: number;
    fuel: number;
  }): void;
  /** Updates cargo without notifying UI. */
  loadInventory(next: Inventory): void;
  /** Updates installed builds and refreshes modifiers. */
  loadBuilds(next: readonly BuildId[]): void;
  /**
   * Install a fabricator build. Menu builds spend cargo; `free` skips cost
   * (slash command). Returns false when the install is rejected.
   */
  attemptBuild(
    buildId: string,
    options?: { free?: boolean },
  ): { ok: true; label: string } | { ok: false; reason: TryBuildReason };
  toggleInventory(): void;
  toggleBuildMenu(): void;
  toggleProfile(): void;
  toggleCommandBar(): void;
  closeCommandBar(): void;
  dismissCommandBar(): void;
  update(deltaTime: number, time: number): void;
  getPlayerPose(): { x: number; y: number; z: number; yaw: number };
  getPlayerSaveState(): {
    x: number;
    y: number;
    z: number;
    yaw: number;
    pitch: number;
    fuel: number;
  };
  /** Ignore input and pointer-lock reactions while another mode is live. */
  setActive(active: boolean): void;
  /** Null restores on-foot locomotion. */
  setMount(
    mount: {
      speed: number;
      eyeHeight: number;
      kind: RoverKindId;
    } | null,
  ): void;
  isMounted(): boolean;
  enterRoverCabin(pose: {
    x: number;
    z: number;
    yaw: number;
    eyeHeight: number;
  }): void;
  exitRoverCabin(pose: {
    x: number;
    z: number;
    yaw: number;
    eyeHeight: number;
  }): void;
}

export interface MountState {
  speed: number;
  eyeHeight: number;
  kind: RoverKindId;
}

export interface GameplayDependencies {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  worldSystem: WorldSystem;
  ui: UI;
  faunaSystem: FaunaSystem;
  /** Static obstacles outside terrain collision. */
  getStaticColliders?: () => readonly SolidCollider[];
  onCaveCarved?: (brush: CaveBrush) => void;
  onDepositChanged?: (
    type: DepositType,
    index: number,
    remaining: number,
  ) => void;
  onPetChanged?: (entity: PlanetEntity) => void;
  onInventoryChanged?: (inventory: Inventory) => void;
  onBuildsChanged?: (builds: readonly BuildId[]) => void;
  onProfileOpen?: () => void;
}

/**
 * Own transient player state while WorldSystem handles world mutations and UI
 * receives render-ready state snapshots.
 */
export function createGameplay({
  scene,
  camera,
  renderer,
  worldSystem,
  ui,
  faunaSystem,
  getStaticColliders,
  onCaveCarved,
  onDepositChanged,
  onPetChanged,
  onInventoryChanged,
  onBuildsChanged,
  onProfileOpen,
}: GameplayDependencies): Gameplay {
  const player: PlayerState = {
    position: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    yaw: 0,
    pitch: 0,
    grounded: false,
    bobPhase: 0,
    stepDistance: 0,
    fuel: 1,
  };
  let mount: MountState | null = null;
  let eyeWasSubmerged = false;
  let swimStrokeDistance = 0;
  let petChirpCooldown = 4;
  const collisionMatrix = new THREE.Matrix4();
  const collisionPosition = new THREE.Vector3();
  const collisionScale = new THREE.Vector3();
  const rockSolids: SolidCollider[] = [];
  const inventory: Inventory = {
    silicate: 0,
    iron: 0,
    carbon: 0,
    copper: 0,
    crystal: 0,
  };
  let builds: BuildId[] = [];
  let modifiers: BuildModifiers = resolveBuildModifiers(builds);
  const keys: KeyboardState = {};

  let active = true;
  let locked = false;
  let inventoryOpen = false;
  let buildMenuOpen = false;
  let profileOpen = false;
  let commandBarOpen = false;
  let started = false;
  let miningHeld = false;
  let miningProgress = 0;
  let miningKey: MiningKey | null = null;

  const vector1 = new THREE.Vector3();
  const vector2 = new THREE.Vector3();
  const vector3 = new THREE.Vector3();

  const beamGeometry: THREE.CylinderGeometry =
    new THREE.CylinderGeometry(0.5, 1, 1, 6, 1, true);
  beamGeometry.translate(0, 0.5, 0);
  const beamMaterial: THREE.MeshBasicMaterial =
    new THREE.MeshBasicMaterial({
      color: "#7df0cf",
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
  const beam: THREE.Mesh<
    THREE.CylinderGeometry,
    THREE.MeshBasicMaterial
  > = new THREE.Mesh(beamGeometry, beamMaterial);
  beam.visible = false;
  beam.frustumCulled = false;
  scene.add(beam);

  const impactMaterial: THREE.SpriteMaterial =
    new THREE.SpriteMaterial({
      map: createRadialTexture(
        "rgba(255,255,255,1)",
        "rgba(255,255,255,0.35)",
      ),
      color: "#7df0cf",
      transparent: true,
      opacity: 0.75,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
  const impact: THREE.Sprite = new THREE.Sprite(impactMaterial);
  impact.visible = false;
  impact.frustumCulled = false;
  scene.add(impact);

  const impactLight: THREE.PointLight = new THREE.PointLight(
    "#7df0cf",
    0,
    10,
    2,
  );
  scene.add(impactLight);

  /** Reset/build ordering guarantees gameplay methods have an active world. */
  function requireWorld(): NonNullable<WorldSystem["current"]> {
    const world = worldSystem.current;
    if (world === null) {
      throw new Error("Gameplay requires an active world.");
    }
    return world;
  }

  function requireDepositEntry(type: DepositType, index: number) {
    const entry = requireWorld().deposits[type].list[index];
    if (entry === undefined) {
      throw new Error(`Deposit ${type}:${index} does not exist.`);
    }
    return entry;
  }

  function clearHeldInput(): void {
    miningHeld = false;
    for (const code of Object.keys(keys)) keys[code] = false;
    Sound.jetOff();
  }

  function resetWorld(): void {
    const world = requireWorld();

    mount = null;
    eyeWasSubmerged = false;
    swimStrokeDistance = 0;
    petChirpCooldown = 4;
    Sound.setVehicle(null);
    Sound.setUnderwater(false);
    Sound.setSpaceBed(false);
    player.position
      .copy(world.spawn)
      .addScaledVector(UP, EYE_HEIGHT);
    player.velocity.set(0, 0, 0);
    player.fuel = 1;
    player.yaw = world.random() * Math.PI * 2;
    player.pitch = -0.05;
    player.grounded = false;
    player.bobPhase = 0;
    player.stepDistance = 0;

    started = false;
    inventoryOpen = false;
    buildMenuOpen = false;
    profileOpen = false;
    commandBarOpen = false;
    miningProgress = 0;
    miningKey = null;
    clearHeldInput();
    ui.setMiningProgress(0);
    ui.setTargetLabel("");
    ui.setFuel(1);
    ui.setInventoryVisible(false);
    ui.setBuildMenuVisible(false);
    ui.setProfileVisible(false);
    ui.setCommandBarVisible(false);
    ui.updateInventoryViews(inventory);
  }

  function applySavedPose(state: {
    x: number;
    y: number;
    z: number;
    yaw: number;
    pitch: number;
    fuel: number;
  }): void {
    player.position.set(state.x, state.y, state.z);
    player.velocity.set(0, 0, 0);
    player.yaw = state.yaw;
    player.pitch = clamp(state.pitch, -1.55, 1.55);
    player.fuel = clamp(state.fuel, 0, 1);
    player.grounded = false;
    player.bobPhase = 0;
    player.stepDistance = 0;
    ui.setFuel(player.fuel);
  }

  function loadInventory(next: Inventory): void {
    for (const materialId of MATERIAL_ORDER) {
      inventory[materialId] = next[materialId];
    }
    ui.updateInventoryViews(inventory);
  }

  function loadBuilds(next: readonly BuildId[]): void {
    builds = [...next];
    modifiers = resolveBuildModifiers(builds);
  }

  function refreshBuildMenu(): void {
    ui.updateBuildMenu({
      inventory: cloneInventory(inventory),
      builds,
    });
  }

  function attemptBuild(
    buildId: string,
    options: { free?: boolean } = {},
  ): { ok: true; label: string } | { ok: false; reason: TryBuildReason } {
    const result = tryBuild(buildId, inventory, builds, options);
    if (!result.ok) {
      return { ok: false, reason: result.reason };
    }
    for (const materialId of MATERIAL_ORDER) {
      inventory[materialId] = result.inventory[materialId];
    }
    builds = result.builds;
    modifiers = resolveBuildModifiers(builds);
    ui.updateInventoryViews(inventory);
    onInventoryChanged?.(cloneInventory(inventory));
    onBuildsChanged?.(builds);
    if (buildMenuOpen) refreshBuildMenu();
    return { ok: true, label: result.definition.label };
  }

  function anyOverlayOpen(): boolean {
    return inventoryOpen || buildMenuOpen || profileOpen || commandBarOpen;
  }

  function closeOverlays(): void {
    inventoryOpen = false;
    buildMenuOpen = false;
    profileOpen = false;
    commandBarOpen = false;
    ui.setInventoryVisible(false);
    ui.setBuildMenuVisible(false);
    ui.setProfileVisible(false);
    ui.setCommandBarVisible(false);
  }

  function showPointerLockFailure(): void {
    if (!anyOverlayOpen()) {
      ui.showOverlay(started ? "paused" : "start");
    }
  }

  function requestPointerLock(): void {
    Sound.resume();
    let requestResult: unknown;
    try {
      requestResult = renderer.domElement.requestPointerLock({
        unadjustedMovement: true,
      });
    } catch {
      requestResult = renderer.domElement.requestPointerLock();
    }

    // Older browsers return void while current browsers return a promise.
    void Promise.resolve(requestResult).catch(showPointerLockFailure);
  }

  /**
   * Open one overlay (or none). Mutually exclusive with inventory / build /
   * profile / command bar. Opening exits pointer lock. Closing with resume
   * re-locks; Escape closes to Standby without re-locking.
   */
  function setOverlay(
    next: "none" | "inventory" | "build" | "profile" | "command",
    options: { resume?: boolean } = {},
  ): void {
    const wasOpen = anyOverlayOpen();
    const resume = options.resume !== false;
    const willOpen = next !== "none";

    inventoryOpen = next === "inventory";
    buildMenuOpen = next === "build";
    profileOpen = next === "profile";
    commandBarOpen = next === "command";

    if (inventoryOpen) ui.updateInventory(inventory);
    if (buildMenuOpen) refreshBuildMenu();
    if (profileOpen) onProfileOpen?.();

    ui.setInventoryVisible(inventoryOpen);
    ui.setBuildMenuVisible(buildMenuOpen);
    ui.setProfileVisible(profileOpen);
    ui.setCommandBarVisible(commandBarOpen);

    if (willOpen && !wasOpen) Sound.uiOpen();
    if (!willOpen && wasOpen) Sound.uiClose();

    if (next !== "none") {
      if (locked) document.exitPointerLock();
      return;
    }
    if (!wasOpen) return;
    if (resume) {
      requestPointerLock();
      return;
    }
    ui.showOverlay(started ? "paused" : "start");
  }

  function toggleInventory(): void {
    if (!started) return;
    setOverlay(inventoryOpen ? "none" : "inventory");
  }

  function toggleBuildMenu(): void {
    if (!started) return;
    setOverlay(buildMenuOpen ? "none" : "build");
  }

  function toggleProfile(): void {
    if (!started) return;
    setOverlay(profileOpen ? "none" : "profile");
  }

  function toggleCommandBar(): void {
    if (!started) return;
    setOverlay(commandBarOpen ? "none" : "command");
  }

  function closeCommandBar(): void {
    if (!commandBarOpen) return;
    setOverlay("none", { resume: true });
  }

  /** Escape leaves Standby; do not re-lock. */
  function dismissCommandBar(): void {
    if (!commandBarOpen) return;
    setOverlay("none", { resume: false });
  }

  function collectNearbySolids(world: World): SolidCollider[] {
    rockSolids.length = 0;
    const candidates = world.aimIndex.query(
      player.position.x,
      player.position.z,
      PLAYER_COLLISION_QUERY_RADIUS,
    );
    for (const candidate of candidates) {
      if (candidate.kind !== "rock") continue;
      world.rocks.getMatrixAt(candidate.index, collisionMatrix);
      collisionPosition.setFromMatrixPosition(collisionMatrix);
      collisionScale.setFromMatrixScale(collisionMatrix);
      const radius =
        Math.max(
          collisionScale.x,
          collisionScale.y,
          collisionScale.z,
        ) * ROCK_COLLIDER_RADIUS_FACTOR;
      rockSolids.push({
        kind: "sphere",
        x: collisionPosition.x,
        y: collisionPosition.y,
        z: collisionPosition.z,
        radius,
      });
    }
    const extras = getStaticColliders?.() ?? [];
    if (extras.length === 0) return rockSolids;
    return rockSolids.concat(extras);
  }

  function updatePlayer(deltaTime: number): void {
    const world = requireWorld();
    const eyeHeight = mount?.eyeHeight ?? EYE_HEIGHT;
    let localX = 0;
    let localZ = 0;
    if (keys.KeyW || keys.ArrowUp) localZ -= 1;
    if (keys.KeyS || keys.ArrowDown) localZ += 1;
    if (keys.KeyA || keys.ArrowLeft) localX -= 1;
    if (keys.KeyD || keys.ArrowRight) localX += 1;

    const immersion =
      world.surfaceKind === "water"
        ? sampleWaterImmersion(
            player.position.y,
            eyeHeight,
            world.waterLevel,
          )
        : null;
    const inWater = immersion?.bodyInWater ?? false;
    const eyeSubmerged = immersion?.eyeSubmerged ?? false;
    if (eyeSubmerged !== eyeWasSubmerged) {
      eyeWasSubmerged = eyeSubmerged;
      if (eyeSubmerged) {
        const strength = clamp(
          (immersion?.eyeDepth ?? 0) / WATER_DEPTH_FOR_FULL_FOG,
          0.35,
          1,
        );
        Sound.setUnderwater(true, strength);
        Sound.swimStroke();
      } else {
        Sound.setUnderwater(false);
      }
    } else if (eyeSubmerged && immersion) {
      Sound.setUnderwater(
        true,
        clamp(immersion.eyeDepth / WATER_DEPTH_FOR_FULL_FOG, 0.35, 1),
      );
    }

    const wantsSprint =
      mount === null &&
      (keys.ShiftLeft || keys.ShiftRight) &&
      localZ < 0 &&
      !inWater;
    const terrainSpeed = inWater
      ? modifiers.waterMoveFactor
      : world.walkSpeedFactor;
    const mountSpeed =
      mount === null
        ? 0
        : mount.speed * (modifiers.roverDriveSpeed / ROVER_DRIVE_SPEED);
    const speed =
      mount !== null
        ? mountSpeed * (inWater ? modifiers.waterMoveFactor : 1)
        : wantsSprint
          ? modifiers.sprintSpeed * world.walkSpeedFactor
          : modifiers.walkSpeed * terrainSpeed;
    const inputLength = Math.hypot(localX, localZ);
    let targetX = 0;
    let targetZ = 0;

    if (inputLength > 0) {
      localX /= inputLength;
      localZ /= inputLength;
      const sine = Math.sin(player.yaw);
      const cosine = Math.cos(player.yaw);
      targetX = (localX * cosine + localZ * sine) * speed;
      targetZ = (-localX * sine + localZ * cosine) * speed;
    }

    // Smooth input and forces before integration, then resolve solids + ground.
    const smoothing = 1 - Math.exp(-12 * deltaTime);
    player.velocity.x = lerp(
      player.velocity.x,
      targetX,
      smoothing,
    );
    player.velocity.z = lerp(
      player.velocity.z,
      targetZ,
      smoothing,
    );

    if (mount !== null) {
      // Rovers stay grounded, with no jump or jet while driving.
      Sound.jetOff();
      player.velocity.y = 0;
      player.grounded = true;
    } else {
      const gravity = GRAVITY * (inWater ? WATER_GRAVITY_FACTOR : 1);
      player.velocity.y -= gravity * deltaTime;
      if (inWater) {
        const drag = 1 - Math.exp(-modifiers.waterVerticalDrag * deltaTime);
        player.velocity.y = lerp(player.velocity.y, 0, drag);
      }

      if (player.grounded && keys.Space) {
        player.velocity.y = modifiers.jumpVelocity * (inWater ? 0.65 : 1);
        player.grounded = false;
      }

      if (!player.grounded && keys.Space && player.fuel > 0) {
        player.velocity.y = Math.min(
          player.velocity.y + JET_ACCELERATION * deltaTime,
          modifiers.jetMaxVerticalSpeed,
        );
        player.fuel = Math.max(
          0,
          player.fuel - deltaTime / modifiers.jetBurnSeconds,
        );
        Sound.jetOn();
      } else {
        Sound.jetOff();
        if (player.grounded) {
          player.fuel = Math.min(
            1,
            player.fuel + deltaTime / modifiers.jetRechargeSeconds,
          );
        }
      }
    }

    player.position.x = clamp(
      player.position.x + player.velocity.x * deltaTime,
      -HALF_WORLD + 4,
      HALF_WORLD - 4,
    );
    player.position.z = clamp(
      player.position.z + player.velocity.z * deltaTime,
      -HALF_WORLD + 4,
      HALF_WORLD - 4,
    );
    if (mount === null) {
      player.position.y += player.velocity.y * deltaTime;
    }

    const solids = collectNearbySolids(world);
    const resolved = resolveCapsuleAgainstSolids(
      {
        x: player.position.x,
        y: player.position.y,
        z: player.position.z,
        radius: PLAYER_RADIUS,
        eyeHeight,
      },
      solids,
    );
    player.position.set(resolved.x, resolved.y, resolved.z);
    const slid = slideVelocityFromCorrection(
      player.velocity.x,
      player.velocity.y,
      player.velocity.z,
      resolved.correctionX,
      resolved.correctionY,
      resolved.correctionZ,
    );
    player.velocity.set(slid.x, slid.y, slid.z);

    if (mount !== null) {
      const ground =
        world.heightAt(player.position.x, player.position.z) + eyeHeight;
      player.position.y = ground;
      player.velocity.y = 0;
      player.grounded = true;
    } else if (
      world.caves?.isNearEdit(
        player.position.x,
        player.position.y,
        player.position.z,
        eyeHeight + PLAYER_RADIUS,
      )
    ) {
      const wasGrounded = player.grounded;
      const impactVelocityY = player.velocity.y;
      const terrainResolved = world.caves.resolveCapsule({
        x: player.position.x,
        y: player.position.y,
        z: player.position.z,
        radius: PLAYER_RADIUS,
        eyeHeight,
      });
      player.position.set(
        terrainResolved.x,
        terrainResolved.y,
        terrainResolved.z,
      );
      const terrainSlide = slideVelocityFromCorrection(
        player.velocity.x,
        player.velocity.y,
        player.velocity.z,
        terrainResolved.correctionX,
        terrainResolved.correctionY,
        terrainResolved.correctionZ,
      );
      player.velocity.set(
        terrainSlide.x,
        terrainSlide.y,
        terrainSlide.z,
      );
      player.grounded = terrainResolved.grounded;
      if (player.grounded) {
        if (!wasGrounded && impactVelocityY < -9) Sound.thud();
        player.velocity.y = 0;
      }
    } else {
      const ground =
        world.heightAt(player.position.x, player.position.z) + eyeHeight;
      const wasGrounded = player.grounded;
      if (player.position.y <= ground) {
        if (!wasGrounded && player.velocity.y < -9) Sound.thud();
        player.position.y = ground;
        player.velocity.y = 0;
        player.grounded = true;
      } else if (player.position.y > ground + 0.02) {
        player.grounded = false;
      }
    }

    const horizontalSpeed = Math.hypot(
      player.velocity.x,
      player.velocity.z,
    );

    if (mount !== null) {
      const driveRatio = clamp(horizontalSpeed / mount.speed, 0, 1);
      Sound.setVehicle(mount.kind, driveRatio);
    }

    if (mount === null && eyeSubmerged && horizontalSpeed > 0.6) {
      swimStrokeDistance += horizontalSpeed * deltaTime;
      if (swimStrokeDistance > 2.8) {
        swimStrokeDistance = 0;
        Sound.swimStroke();
      }
    } else if (
      mount === null &&
      player.grounded &&
      horizontalSpeed > 1
    ) {
      player.stepDistance += horizontalSpeed * deltaTime;
      const stride = wantsSprint ? 3.4 : 2.5;
      if (player.stepDistance > stride) {
        player.stepDistance = 0;
        Sound.step(inWater ? "wet" : "dry");
      }
      player.bobPhase += horizontalSpeed * deltaTime * 1.7;
    }

    if (faunaSystem.hasPet()) {
      petChirpCooldown -= deltaTime;
      if (petChirpCooldown <= 0) {
        petChirpCooldown = 7 + Math.random() * 8;
        Sound.petChirp();
      }
    }

    const bob =
      mount === null && player.grounded
        ? Math.sin(player.bobPhase) *
          0.05 *
          Math.min(horizontalSpeed / modifiers.walkSpeed, 1)
        : 0;
    camera.position.set(
      player.position.x,
      player.position.y + bob,
      player.position.z,
    );
    camera.rotation.set(player.pitch, player.yaw, 0);

    const targetFieldOfView =
      mount !== null ? 68 : wantsSprint ? 77 : 70;
    if (Math.abs(camera.fov - targetFieldOfView) > 0.05) {
      camera.fov = lerp(
        camera.fov,
        targetFieldOfView,
        1 - Math.exp(-8 * deltaTime),
      );
      camera.updateProjectionMatrix();
    }
  }

  function getHitKey(hit: AimHit): MiningKey {
    switch (hit.kind) {
      case "terrain":
        return "terrain";
      case "rock":
        return `rock:${hit.index}`;
      case "flora":
        return `flora:${hit.index}`;
      case "deposit":
        return `deposit:${hit.type}:${hit.index}`;
      case "fauna":
        return `fauna:${hit.creatureId}`;
      default: {
        const exhaustiveHit: never = hit;
        throw new Error(`Unknown aim hit: ${String(exhaustiveHit)}`);
      }
    }
  }

  function getHitInfo(hit: AimHit): HitInfo {
    switch (hit.kind) {
      case "terrain":
        return {
          label: "REGOLITH · SILICATE",
          material: "silicate",
        };
      case "rock":
        return {
          label: "BOULDER · SILICATE",
          material: "silicate",
        };
      case "flora":
        return { label: "FLORA · CARBON", material: "carbon" };
      case "deposit": {
        const remaining = requireDepositEntry(
          hit.type,
          hit.index,
        ).remaining;
        return {
          label:
            `${DEPOSIT_DEFINITIONS[hit.type].label} · ` +
            `${remaining} UNITS`,
          material: hit.type,
        };
      }
      case "fauna": {
        const speciesLabel =
          FAUNA_DEFINITIONS[hit.species].label.toUpperCase();
        if (hit.role === "pet") {
          return {
            label: `YOUR COMPANION · ${speciesLabel}`,
            material: "silicate",
          };
        }
        return {
          label: `WILD ${speciesLabel} · HOLD TO TAME`,
          material: "crystal",
        };
      }
      default: {
        const exhaustiveHit: never = hit;
        throw new Error(`Unknown aim hit: ${String(exhaustiveHit)}`);
      }
    }
  }

  function addResource(materialId: MaterialId, amount: number): void {
    inventory[materialId] += amount;
    ui.updateInventoryViews(inventory);
    onInventoryChanged?.(inventory);
    ui.notify(
      `+${amount} ${MATERIALS[materialId].label}`,
      MATERIALS[materialId].color,
    );
  }

  function completeExtraction(hit: AimHit): void {
    switch (hit.kind) {
      case "deposit": {
        const entry = requireDepositEntry(hit.type, hit.index);
        const amount = Math.min(
          2 + modifiers.depositYieldBonus,
          entry.remaining,
        );
        entry.remaining -= amount;
        worldSystem.refreshDeposit(hit.type, hit.index);
        onDepositChanged?.(hit.type, hit.index, entry.remaining);
        addResource(hit.type, amount);
        Sound.chime(DEPOSIT_DEFINITIONS[hit.type].chime);
        Sound.harvestFanfare();
        return;
      }
      case "rock":
        addResource("silicate", 1);
        Sound.chime(520);
        Sound.harvestFanfare();
        return;
      case "flora":
        addResource("carbon", 1);
        Sound.chime(392);
        Sound.oddity();
        return;
      case "terrain": {
        camera.getWorldDirection(vector1);
        const brush = worldSystem.carveCave(hit.point, vector1, {
          radius: modifiers.digRadius,
          length: modifiers.digLength,
        });
        if (brush === null) return;
        addResource("silicate", 2);
        onCaveCarved?.(brush);
        Sound.chime(494);
        return;
      }
      case "fauna":
        return;
      default: {
        const exhaustiveHit: never = hit;
        throw new Error(`Unknown aim hit: ${String(exhaustiveHit)}`);
      }
    }
  }

  function hideMiningEffects(): void {
    miningProgress = 0;
    miningKey = null;
    beam.visible = false;
    impact.visible = false;
    impactLight.intensity = 0;
    Sound.humOff();
  }

  function completeTame(creatureId: string): void {
    const result = faunaSystem.tryTame(creatureId);
    if (!result.ok) {
      if (result.reason === "has-pet") {
        ui.notify("ALREADY HAVE A COMPANION", "#ffb347");
        Sound.uiError();
      }
      return;
    }
    onPetChanged?.(result.entity);
    const rawSpecies = result.entity.data?.species;
    const speciesLabel = isFaunaSpeciesId(rawSpecies)
      ? FAUNA_DEFINITIONS[rawSpecies].label
      : "Creature";
    ui.notify(`COMPANION BONDED · ${speciesLabel.toUpperCase()}`, "#7df0cf");
    Sound.petBond();
    petChirpCooldown = 2;
  }

  function setMount(
    next: {
      speed: number;
      eyeHeight: number;
      kind: RoverKindId;
    } | null,
  ): void {
    mount = next;
    if (mount !== null) {
      player.velocity.set(0, 0, 0);
      player.grounded = true;
      miningHeld = false;
      miningProgress = 0;
      miningKey = null;
      hideMiningEffects();
      ui.setMiningProgress(0);
      Sound.jetOff();
      Sound.setVehicle(mount.kind, 0);
    } else {
      Sound.setVehicle(null);
    }
  }

  function isMounted(): boolean {
    return mount !== null;
  }

  function enterRoverCabin(pose: {
    x: number;
    z: number;
    yaw: number;
    eyeHeight: number;
  }): void {
    const world = requireWorld();
    player.position.set(
      pose.x,
      world.heightAt(pose.x, pose.z) + pose.eyeHeight,
      pose.z,
    );
    player.yaw = pose.yaw;
    player.velocity.set(0, 0, 0);
    player.grounded = true;
    camera.position.copy(player.position);
    camera.rotation.set(player.pitch, player.yaw, 0);
  }

  function exitRoverCabin(pose: {
    x: number;
    z: number;
    yaw: number;
    eyeHeight: number;
  }): void {
    const world = requireWorld();
    const x = clamp(pose.x, -HALF_WORLD + 4, HALF_WORLD - 4);
    const z = clamp(pose.z, -HALF_WORLD + 4, HALF_WORLD - 4);
    player.position.set(x, world.heightAt(x, z) + pose.eyeHeight, z);
    player.yaw = pose.yaw;
    player.velocity.set(0, 0, 0);
    player.grounded = true;
    camera.position.copy(player.position);
    camera.rotation.set(player.pitch, player.yaw, 0);
  }

  function updateMining(deltaTime: number, time: number): void {
    if (mount !== null) {
      hideMiningEffects();
      ui.setMiningProgress(0);
      ui.setTargetLabel("");
      return;
    }
    const hit =
      locked && started
        ? worldSystem.getAimHit(camera, modifiers.miningRange)
        : null;
    if (hit === null) {
      ui.setTargetLabel("");
      hideMiningEffects();
      ui.setMiningProgress(miningProgress);
      return;
    }

    const info = getHitInfo(hit);
    ui.setTargetLabel(info.label);
    if (!miningHeld || !locked) {
      hideMiningEffects();
      ui.setMiningProgress(miningProgress);
      return;
    }

    // Mining progress continues only while the discriminated target is stable.
    const targetKey = getHitKey(hit);
    if (targetKey !== miningKey) {
      miningKey = targetKey;
      miningProgress = 0;
    }

    if (hit.kind === "fauna") {
      beam.visible = false;
      impact.visible = false;
      impactLight.intensity = 0;
      if (hit.role === "pet") {
        miningProgress = 0;
        miningKey = null;
        Sound.humOff();
        ui.setMiningProgress(0);
        return;
      }
      if (faunaSystem.hasPet()) {
        ui.setTargetLabel("ALREADY HAVE A COMPANION");
        miningProgress = 0;
        miningKey = null;
        Sound.humOff();
        ui.setMiningProgress(0);
        return;
      }
      miningProgress += deltaTime / TAME_TIME;
      Sound.humOn();
      Sound.setHumProgress(Math.min(miningProgress, 1));
      if (miningProgress >= 1) {
        completeTame(hit.creatureId);
        miningProgress = 0;
        miningKey = null;
        Sound.humOff();
      }
      ui.setMiningProgress(miningProgress);
      return;
    }

    miningProgress += deltaTime / modifiers.miningTime;
    Sound.humOn();
    Sound.setHumProgress(Math.min(miningProgress, 1));

    const color = MATERIALS[info.material].color;
    beamMaterial.color.set(color);
    impactMaterial.color.set(color);
    impactLight.color.set(color);

    camera.updateMatrixWorld();
    vector1.set(0.42, -0.36, -0.55).applyMatrix4(camera.matrixWorld);
    vector2.copy(hit.point);
    vector3.subVectors(vector2, vector1);
    const distance = vector3.length();
    const direction = vector3.normalize();
    beam.position.copy(vector1);
    beam.quaternion.setFromUnitVectors(UP, direction);
    const radius = 0.035 + 0.014 * Math.sin(time * 42);
    beam.scale.set(radius, distance, radius);
    beam.visible = true;

    impact.position.copy(vector2);
    impact.scale.setScalar(0.42 + 0.12 * Math.sin(time * 27));
    impact.visible = true;
    impactLight.position.copy(vector2).addScaledVector(direction, -0.5);
    impactLight.intensity = 4;

    if (miningProgress >= 1) {
      completeExtraction(hit);
      miningProgress = 0;
      miningKey = null;
    }
    ui.setMiningProgress(miningProgress);
  }

  function update(deltaTime: number, time: number): void {
    const world = worldSystem.current;
    if (world === null) return;

    if (locked && started) {
      updatePlayer(deltaTime);
    } else if (!started) {
      const angle = time * 0.05;
      const radius = 46;
      camera.position.set(
        world.spawn.x + Math.cos(angle) * radius,
        world.spawn.y + EYE_HEIGHT + 22,
        world.spawn.z + Math.sin(angle) * radius,
      );
      camera.lookAt(
        world.spawn.x,
        world.spawn.y + EYE_HEIGHT + 2,
        world.spawn.z,
      );
    }

    updateMining(deltaTime, time);
    ui.setFuel(player.fuel);
  }

  // Pointer-lock events decide whether the game is playing or paused.
  function handlePointerLockChange(): void {
    locked = document.pointerLockElement === renderer.domElement;
    if (!active) return;
    if (locked) {
      started = true;
      closeOverlays();
      ui.showPlaying();
      return;
    }

    clearHeldInput();
    if (!anyOverlayOpen()) {
      ui.showOverlay(started ? "paused" : "start");
    }
  }

  function handlePointerLockError(): void {
    if (active) showPointerLockFailure();
  }

  function handleMouseMove(event: MouseEvent): void {
    if (!active || !locked) return;
    player.yaw -= event.movementX * 0.0022;
    player.pitch = clamp(
      player.pitch - event.movementY * 0.0022,
      -1.55,
      1.55,
    );
  }

  function handleMouseDown(event: MouseEvent): void {
    if (active && locked && event.button === 0) miningHeld = true;
  }

  function handleMouseUp(event: MouseEvent): void {
    if (event.button === 0) miningHeld = false;
  }

  function handleContextMenu(event: MouseEvent): void {
    event.preventDefault();
  }

  function handleKeyDown(event: KeyboardEvent): void {
    if (!active) return;
    if (event.target instanceof HTMLInputElement) {
      if (event.code === "Escape" && anyOverlayOpen() && !event.repeat) {
        if (commandBarOpen) dismissCommandBar();
        else setOverlay("none", { resume: false });
      }
      return;
    }
    if (event.code === "Space") event.preventDefault();
    keys[event.code] = true;
    if (event.code === "KeyI" && !event.repeat) toggleInventory();
    if (event.code === "KeyB" && !event.repeat) toggleBuildMenu();
    if (event.code === "KeyP" && !event.repeat) toggleProfile();
    if (event.code === "Enter" && !event.repeat) {
      event.preventDefault();
      toggleCommandBar();
    }
    if (event.code === "Escape" && anyOverlayOpen()) {
      if (commandBarOpen) dismissCommandBar();
      else setOverlay("none", { resume: false });
    }
  }

  function handleKeyUp(event: KeyboardEvent): void {
    keys[event.code] = false;
  }

  document.addEventListener(
    "pointerlockchange",
    handlePointerLockChange,
  );
  document.addEventListener(
    "pointerlockerror",
    handlePointerLockError,
  );
  document.addEventListener("mousemove", handleMouseMove);
  document.addEventListener("mousedown", handleMouseDown);
  document.addEventListener("mouseup", handleMouseUp);
  document.addEventListener("contextmenu", handleContextMenu);
  document.addEventListener("keydown", handleKeyDown);
  document.addEventListener("keyup", handleKeyUp);
  window.addEventListener("blur", clearHeldInput);

  function getPlayerPose(): {
    x: number;
    y: number;
    z: number;
    yaw: number;
  } {
    return {
      x: player.position.x,
      y: player.position.y,
      z: player.position.z,
      yaw: player.yaw,
    };
  }

  function getPlayerSaveState(): {
    x: number;
    y: number;
    z: number;
    yaw: number;
    pitch: number;
    fuel: number;
  } {
    return {
      x: player.position.x,
      y: player.position.y,
      z: player.position.z,
      yaw: player.yaw,
      pitch: player.pitch,
      fuel: player.fuel,
    };
  }

  function setActive(nextActive: boolean): void {
    if (active === nextActive) return;
    active = nextActive;
    if (!active) {
      clearHeldInput();
      hideMiningEffects();
      ui.setMiningProgress(0);
      ui.setTargetLabel("");
      return;
    }
    // A retained pointer lock (landing hand-off) resumes play directly.
    if (locked) {
      started = true;
      closeOverlays();
      ui.showPlaying();
    }
  }

  return {
    requestPointerLock,
    resetWorld,
    applySavedPose,
    loadInventory,
    loadBuilds,
    attemptBuild,
    toggleInventory,
    toggleBuildMenu,
    toggleProfile,
    toggleCommandBar,
    closeCommandBar,
    dismissCommandBar,
    update,
    getPlayerPose,
    getPlayerSaveState,
    setActive,
    setMount,
    isMounted,
    enterRoverCabin,
    exitRoverCabin,
  };
}
