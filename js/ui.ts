import type { Inventory, MaterialId } from "./config.ts";
import type { GearId } from "./gear.ts";
import {
  GEAR_DEFINITIONS,
  GEAR_ORDER,
  canAffordCost,
  formatCargoCost,
  missingPrerequisites,
} from "./gear.ts";
import type { BlueprintId } from "./blueprints.ts";
import {
  BLUEPRINT_DEFINITIONS,
  BLUEPRINT_ORDER,
} from "./blueprints.ts";
import type { ProfileView } from "./player-profile.ts";
import {
  LOOK_SENSITIVITY_DEFAULT,
  MATERIAL_ORDER,
  MATERIALS,
  MINING_RING_CIRCUMFERENCE,
  clamp,
} from "./config.ts";
import {
  formatPetDistance,
  type PetCompassReading,
} from "./fauna/compass.ts";
import { FAUNA_DEFINITIONS } from "./fauna/species.ts";
import {
  formatFlightSpeed,
  flightSpeedBarRatio,
} from "./space/flight.ts";
import {
  MAX_PLAYER_NAME_LENGTH,
  formatPlayTime,
} from "./player-profile.ts";
import {
  POSTCARD_THUMB_MAX_CHARS,
  postcardCaption,
  postcardFilename,
} from "./postcard.ts";
import {
  MINIMAP_SIZE,
  fillMinimapPixels,
  worldToMapPixel,
  type MinimapMarker,
  type MinimapPaletteRgb,
} from "./minimap.ts";

/** UI callbacks signal user intent and never return application state. */
export interface UIActions {
  onPlay: () => void;
  onToggleInventory: () => void;
  onToggleGearMenu: () => void;
  onToggleBuildMenu: () => void;
  onToggleProfile: () => void;
  onOpenMenu: (menu: "inventory" | "gear" | "build" | "profile") => void;
  onDismissCommandBar: () => void;
  onCommandSubmit: (line: string) => void;
  onInstallGear: (gearId: GearId) => void;
  onFabricate: (blueprintId: BlueprintId) => void;
  onProfileRename: (name: string) => void;
  onLookSensitivity: (value: number) => void;
  onReduceCrtMotion: (reduce: boolean) => void;
  onCrewEnlist: () => void;
  onCrewRelease: () => void;
  onTravelToVisited: (seedHex: string) => void;
  onSaveGame: () => void;
  onLoadGame: (file: File) => void;
  onNewGame: () => void;
}

export interface GearMenuView {
  inventory: Inventory;
  gear: readonly GearId[];
}

export interface BuildMenuView {
  inventory: Inventory;
  structures: readonly { blueprintId: BlueprintId }[];
}

export interface WorldSummary {
  seed: number;
  name: string;
  biome: {
    label: string;
  };
}

export interface ScanSummary {
  name: string;
  seedHex: string;
  biomeLabel: string;
  range: number;
}

export type HudMode = "planet" | "space";

export interface UI {
  bindActions(actions: UIActions): void;
  notify(text: string, color: string): void;
  setFuel(fuel: number): void;
  setFlightSpeed(speed: number, boosting: boolean): void;
  setInventoryVisible(visible: boolean): void;
  setGearMenuVisible(visible: boolean): void;
  setBuildMenuVisible(visible: boolean): void;
  setProfileVisible(visible: boolean): void;
  setCommandBarVisible(visible: boolean): void;
  setCommandFeedback(
    text: string,
    tone: "ok" | "error" | "neutral",
  ): void;
  updateProfile(view: ProfileView, currentSeedHex: string | null): void;
  updateGearMenu(view: GearMenuView): void;
  updateBuildMenu(view: BuildMenuView): void;
  setMiningProgress(progress: number): void;
  setTargetLabel(label: string): void;
  setWorldSummary(world: WorldSummary): void;
  setScanReadout(scan: ScanSummary | null): void;
  setPrompt(text: string): void;
  setPetCompass(reading: PetCompassReading | null): void;
  setHudMode(mode: HudMode): void;
  /** Planet rover cabin chrome + drive hint bar (hides foot/jet hints). */
  setRoverDriving(active: boolean): void;
  setMinimapVisible(visible: boolean): void;
  paintMinimapTerrain(options: {
    heights: ArrayLike<number>;
    verticesPerRow: number;
    minimumHeight: number;
    maximumHeight: number;
    palette: MinimapPaletteRgb;
    waterLevel: number;
    hasSurface: boolean;
  }): void;
  setMinimapMarkers(
    markers: readonly MinimapMarker[],
    playerYaw: number,
  ): void;
  setPhotoMode(active: boolean): void;
  capturePostcard(
    source: HTMLCanvasElement,
    name: string,
    seedHex: string,
  ): { pngDataUrl: string; thumb: string; filename: string } | null;
  showFatal(title: string, message: string): void;
  showOverlay(mode: "start" | "paused"): void;
  showPlaying(): void;
  /**
   * CONTINUE / LOAD / NEW GAME stay off until a planet exists. Generation
   * also restores the "GENERATING TERRAIN…" subtitle.
   */
  setSessionReady(ready: boolean): void;
  updateInventory(inventory: Inventory): void;
  updateInventoryViews(inventory: Inventory): void;
  revealGameHud(): void;
}

interface ElementConstructor<T extends Element> {
  new (): T;
}

/** Required DOM nodes are an invariant, so lookup failures abort UI creation. */
function byId<T extends Element>(
  id: string,
  elementConstructor: ElementConstructor<T>,
): T {
  const element = document.getElementById(id);
  if (element === null) {
    throw new Error(`Required element #${id} is missing.`);
  }
  if (!(element instanceof elementConstructor)) {
    throw new Error(`Required element #${id} has an unexpected type.`);
  }
  return element;
}

type Point = readonly [x: number, y: number];

export function createUI(): UI {
  const elements = {
    errorOverlay: byId("errOverlay", HTMLDivElement),
    errorTitle: byId("errTitle", HTMLHeadingElement),
    errorMessage: byId("errMsg", HTMLParagraphElement),
    startOverlay: byId("startOverlay", HTMLDivElement),
    startTitle: byId("startTitle", HTMLHeadingElement),
    startSubtitle: byId("startSub", HTMLDivElement),
    playButton: byId("btnPlay", HTMLButtonElement),
    saveGameButton: byId("btnSaveGame", HTMLButtonElement),
    loadGameButton: byId("btnLoadGame", HTMLButtonElement),
    newGameButton: byId("btnNewGame", HTMLButtonElement),
    gameFileInput: byId("gameFileInput", HTMLInputElement),
    inventoryOverlay: byId("invOverlay", HTMLDivElement),
    inventoryClose: byId("invClose", HTMLButtonElement),
    inventoryGrid: byId("invGrid", HTMLDivElement),
    buildOverlay: byId("buildOverlay", HTMLDivElement),
    buildClose: byId("buildClose", HTMLButtonElement),
    buildRecipes: byId("buildRecipes", HTMLDivElement),
    gearOverlay: byId("gearOverlay", HTMLDivElement),
    gearClose: byId("gearClose", HTMLButtonElement),
    gearRecipes: byId("gearRecipes", HTMLDivElement),
    gearInstalled: byId("gearInstalled", HTMLDivElement),
    gearInstalledEmpty: byId("gearInstalledEmpty", HTMLParagraphElement),
    profileOverlay: byId("profileOverlay", HTMLDivElement),
    profileClose: byId("profileClose", HTMLButtonElement),
    profileName: byId("profileName", HTMLInputElement),
    profileNameSave: byId("profileNameSave", HTMLButtonElement),
    profilePlayTime: byId("profilePlayTime", HTMLSpanElement),
    profileLook: byId("profileLook", HTMLInputElement),
    profileLookValue: byId("profileLookValue", HTMLSpanElement),
    profileReduceCrt: byId("profileReduceCrt", HTMLInputElement),
    profileCrew: byId("profileCrew", HTMLDivElement),
    profileCrewEmpty: byId("profileCrewEmpty", HTMLParagraphElement),
    profileAtlas: byId("profileAtlas", HTMLDivElement),
    profileAtlasEmpty: byId("profileAtlasEmpty", HTMLParagraphElement),
    profileVisited: byId("profileVisited", HTMLDivElement),
    profileVisitedEmpty: byId("profileVisitedEmpty", HTMLParagraphElement),
    profilePets: byId("profilePets", HTMLDivElement),
    profilePetsEmpty: byId("profilePetsEmpty", HTMLParagraphElement),
    commandOverlay: byId("cmdOverlay", HTMLDivElement),
    commandInput: byId("cmdInput", HTMLInputElement),
    commandFeedback: byId("cmdFeedback", HTMLDivElement),
    hud: byId("hud", HTMLDivElement),
    hudBoxTitle: byId("hudBoxTitle", HTMLDivElement),
    hudSeed: byId("hudSeed", HTMLSpanElement),
    hudPlanet: byId("hudPlanet", HTMLDivElement),
    hudClass: byId("hudClass", HTMLSpanElement),
    hudRangeRow: byId("hudRangeRow", HTMLDivElement),
    hudRange: byId("hudRange", HTMLSpanElement),
    promptBar: byId("promptBar", HTMLDivElement),
    petCompass: byId("petCompass", HTMLDivElement),
    petCompassArrow: byId("petCompassArrow", SVGSVGElement),
    petCompassLabel: byId("petCompassLabel", HTMLSpanElement),
    petCompassRange: byId("petCompassRange", HTMLSpanElement),
    chips: byId("chips", HTMLDivElement),
    reticle: byId("reticle", HTMLDivElement),
    ring: byId("ringFg", SVGCircleElement),
    targetLabel: byId("targetLabel", HTMLDivElement),
    fuelFill: byId("fuelFill", HTMLDivElement),
    fuelLabel: byId("fuelLabel", HTMLSpanElement),
    speedFill: byId("speedFill", HTMLDivElement),
    speedValue: byId("speedValue", HTMLSpanElement),
    notifications: byId("notifs", HTMLDivElement),
    roverCockpit: byId("roverCockpit", HTMLDivElement),
    navMapWrap: byId("navMapWrap", HTMLDivElement),
    navMap: byId("navMap", HTMLCanvasElement),
  };

  let lastTargetLabel = "";
  let lastFuelPercentage = -1;
  let lastSpeedKey = "";
  let lastPrompt = "";
  let lastPetCompassKey = "";
  let boundActions: UIActions | null = null;
  /** Blocks RESUME click-through right after pointer lock exits onto the button. */
  let playButtonArmed = true;
  let playButtonArmTimer: number | null = null;

  function armPlayButtonSoon(delayMs = 450): void {
    playButtonArmed = false;
    if (playButtonArmTimer !== null) window.clearTimeout(playButtonArmTimer);
    playButtonArmTimer = window.setTimeout(() => {
      playButtonArmed = true;
      playButtonArmTimer = null;
    }, delayMs);
  }

  function shade(hex: string, factor: number): string {
    const value = Number.parseInt(hex.slice(1), 16);
    const red = clamp(Math.round(((value >> 16) & 255) * factor), 0, 255);
    const green = clamp(Math.round(((value >> 8) & 255) * factor), 0, 255);
    const blue = clamp(Math.round((value & 255) * factor), 0, 255);
    return `rgb(${red},${green},${blue})`;
  }

  function drawIcon(
    canvas: HTMLCanvasElement,
    materialId: MaterialId,
  ): void {
    const context = canvas.getContext("2d");
    if (context === null) {
      throw new Error("Canvas 2D context is unavailable.");
    }

    const color = MATERIALS[materialId].color;
    const size = 44;
    canvas.width = size;
    canvas.height = size;
    context.clearRect(0, 0, size, size);

    const polygon = (points: readonly Point[], fill: string): void => {
      const [firstPoint, ...remainingPoints] = points;
      if (firstPoint === undefined) {
        throw new Error("Cannot draw an empty polygon.");
      }

      context.beginPath();
      context.moveTo(firstPoint[0], firstPoint[1]);
      for (const point of remainingPoints) {
        context.lineTo(point[0], point[1]);
      }
      context.closePath();
      context.fillStyle = fill;
      context.fill();
    };

    switch (materialId) {
      case "silicate":
        polygon(
          [
            [10, 36],
            [16, 14],
            [22, 36],
          ],
          shade(color, 0.85),
        );
        polygon(
          [
            [20, 38],
            [27, 10],
            [34, 38],
          ],
          color,
        );
        polygon(
          [
            [30, 36],
            [35, 20],
            [39, 36],
          ],
          shade(color, 1.15),
        );
        break;
      case "iron": {
        const blob = (
          x: number,
          y: number,
          radius: number,
          fill: string,
        ): void => {
          context.beginPath();
          context.arc(x, y, radius, 0, 7);
          context.fillStyle = fill;
          context.fill();
        };
        blob(16, 28, 9, shade(color, 0.8));
        blob(28, 30, 8, color);
        blob(23, 18, 7, shade(color, 1.2));
        break;
      }
      case "carbon":
        polygon(
          [
            [22, 6],
            [32, 22],
            [22, 38],
            [12, 22],
          ],
          color,
        );
        polygon(
          [
            [22, 6],
            [32, 22],
            [22, 22],
          ],
          shade(color, 1.9),
        );
        polygon(
          [
            [22, 22],
            [22, 38],
            [12, 22],
          ],
          shade(color, 0.6),
        );
        break;
      case "copper":
        polygon(
          [
            [22, 8],
            [34, 15],
            [34, 29],
            [22, 36],
            [10, 29],
            [10, 15],
          ],
          color,
        );
        polygon(
          [
            [22, 8],
            [34, 15],
            [22, 22],
            [10, 15],
          ],
          shade(color, 1.3),
        );
        break;
      case "crystal":
        context.shadowColor = color;
        context.shadowBlur = 8;
        polygon(
          [
            [16, 40],
            [20, 8],
            [24, 40],
          ],
          color,
        );
        polygon(
          [
            [26, 40],
            [31, 16],
            [34, 40],
          ],
          shade(color, 1.25),
        );
        context.shadowBlur = 0;
        break;
      default: {
        const exhaustiveMaterial: never = materialId;
        throw new Error(`Unknown material: ${exhaustiveMaterial}`);
      }
    }
  }

  interface MaterialSlot {
    slot: HTMLDivElement;
    quantity: HTMLDivElement;
  }

  const inventorySlots = new Map<MaterialId, MaterialSlot>();
  const chipQuantities = new Map<MaterialId, HTMLElement>();
  let chipTotalQuantity: HTMLElement | null = null;
  let lastInventoryTotal = -1;

  function buildInventory(): void {
    elements.inventoryGrid.replaceChildren();

    for (const materialId of MATERIAL_ORDER) {
      const slot = document.createElement("div");
      slot.className = "slot zero";

      const canvas = document.createElement("canvas");
      drawIcon(canvas, materialId);

      const name = document.createElement("div");
      name.className = "nm";
      name.textContent = MATERIALS[materialId].label;

      const quantity = document.createElement("div");
      quantity.className = "qty";
      quantity.textContent = "0";

      slot.append(canvas, name, quantity);
      elements.inventoryGrid.append(slot);
      inventorySlots.set(materialId, { slot, quantity });
    }

    for (let index = 0; index < 3; index += 1) {
      const slot = document.createElement("div");
      slot.className = "slot empty";
      const name = document.createElement("div");
      name.className = "nm empty-label";
      name.textContent = "EMPTY";
      slot.append(name);
      elements.inventoryGrid.append(slot);
    }
  }

  /** Chips are built once; extraction ticks only rewrite changed counts. */
  function buildResourceHud(): void {
    const fragment = document.createDocumentFragment();

    for (const materialId of MATERIAL_ORDER) {
      const chip = document.createElement("div");
      chip.className = "chip";

      const name = document.createElement("span");
      name.className = "nm";
      const marker = document.createElement("span");
      marker.className = "dot";
      marker.style.background = MATERIALS[materialId].color;
      name.append(marker, MATERIALS[materialId].label.toUpperCase());

      const quantity = document.createElement("b");
      quantity.textContent = "0";
      chip.append(name, quantity);
      fragment.append(chip);
      chipQuantities.set(materialId, quantity);
    }

    const totalChip = document.createElement("div");
    totalChip.className = "chip total";
    const totalName = document.createElement("span");
    totalName.className = "nm";
    totalName.textContent = "TOTAL";
    const totalValue = document.createElement("b");
    totalValue.textContent = "0";
    totalChip.append(totalName, totalValue);
    fragment.append(totalChip);
    chipTotalQuantity = totalValue;
    elements.chips.replaceChildren(fragment);
  }

  function updateInventory(inventory: Inventory): void {
    for (const materialId of MATERIAL_ORDER) {
      const entry = inventorySlots.get(materialId);
      if (entry === undefined) {
        throw new Error(`Inventory slot for ${materialId} is missing.`);
      }
      const text = String(inventory[materialId]);
      if (entry.quantity.textContent !== text) {
        entry.quantity.textContent = text;
      }
      entry.slot.classList.toggle("zero", inventory[materialId] === 0);
    }
  }

  function updateResourceHud(inventory: Inventory): void {
    let total = 0;
    for (const materialId of MATERIAL_ORDER) {
      total += inventory[materialId];
      const quantity = chipQuantities.get(materialId);
      if (quantity === undefined) {
        throw new Error(`HUD chip for ${materialId} is missing.`);
      }
      const text = String(inventory[materialId]);
      if (quantity.textContent !== text) quantity.textContent = text;
    }
    if (total === lastInventoryTotal) return;
    lastInventoryTotal = total;
    if (chipTotalQuantity !== null) {
      chipTotalQuantity.textContent = String(total);
    }
  }

  /** Render one inventory snapshot into both the cargo panel and HUD. */
  function updateInventoryViews(inventory: Inventory): void {
    updateInventory(inventory);
    updateResourceHud(inventory);
  }

  function setWorldSummary(world: WorldSummary): void {
    const seedHex = world.seed
      .toString(16)
      .toUpperCase()
      .padStart(8, "0");
    elements.hudSeed.textContent = seedHex;
    elements.hudPlanet.textContent = world.name.toUpperCase();
    elements.hudClass.textContent = world.biome.label;
    elements.startSubtitle.textContent =
      `${world.name.toUpperCase()} · SEED ${seedHex} · ${world.biome.label}`;
  }

  function setScanReadout(scan: ScanSummary | null): void {
    if (scan === null) {
      elements.hudPlanet.textContent = "—";
      elements.hudSeed.textContent = "—";
      elements.hudClass.textContent = "—";
      elements.hudRange.textContent = "—";
      return;
    }
    elements.hudPlanet.textContent = scan.name.toUpperCase();
    elements.hudSeed.textContent = scan.seedHex;
    elements.hudClass.textContent = scan.biomeLabel;
    elements.hudRange.textContent = `${Math.round(scan.range)} U`;
  }

  function setPrompt(text: string): void {
    if (text === lastPrompt) return;
    lastPrompt = text;
    elements.promptBar.textContent = text;
    elements.promptBar.classList.toggle("hidden", text === "");
  }

  function setPetCompass(reading: PetCompassReading | null): void {
    if (reading === null) {
      if (lastPetCompassKey === "") return;
      lastPetCompassKey = "";
      elements.petCompass.classList.add("hidden");
      return;
    }

    const rangeText = formatPetDistance(reading.distance);
    const key = `${reading.label}|${rangeText}|${reading.bearing.toFixed(2)}`;
    if (key === lastPetCompassKey) return;
    lastPetCompassKey = key;

    elements.petCompass.classList.remove("hidden");
    elements.petCompassLabel.textContent = reading.label;
    elements.petCompassRange.textContent = rangeText;
    const degrees = (reading.bearing * 180) / Math.PI;
    elements.petCompassArrow.style.transform =
      `rotateX(48deg) rotateZ(${degrees.toFixed(1)}deg)`;
  }

  function setHudMode(mode: HudMode): void {
    document.body.classList.toggle("space-mode", mode === "space");
    if (mode === "space") setRoverDriving(false);
    elements.hudBoxTitle.textContent =
      mode === "space" ? "SCAN TARGET" : "SURVEY TARGET";
    elements.fuelLabel.textContent = mode === "space" ? "BOOST" : "FUEL";
    elements.hudRangeRow.hidden = mode !== "space";
    setPrompt("");
    if (mode === "space") setPetCompass(null);
    if (mode !== "space") setFlightSpeed(0, false);
  }

  function setRoverDriving(active: boolean): void {
    document.body.classList.toggle("rover-mode", active);
    elements.roverCockpit.setAttribute(
      "aria-hidden",
      active ? "false" : "true",
    );
  }

  let minimapTerrain: ImageData | null = null;

  function setMinimapVisible(visible: boolean): void {
    elements.navMapWrap.classList.toggle("hidden", !visible);
    elements.navMapWrap.setAttribute(
      "aria-hidden",
      visible ? "false" : "true",
    );
  }

  function paintMinimapTerrain(options: {
    heights: ArrayLike<number>;
    verticesPerRow: number;
    minimumHeight: number;
    maximumHeight: number;
    palette: MinimapPaletteRgb;
    waterLevel: number;
    hasSurface: boolean;
  }): void {
    const context = elements.navMap.getContext("2d");
    if (context === null) return;
    const image = context.createImageData(MINIMAP_SIZE, MINIMAP_SIZE);
    fillMinimapPixels(image.data, {
      heights: options.heights,
      verticesPerRow: options.verticesPerRow,
      minimumHeight: options.minimumHeight,
      maximumHeight: options.maximumHeight,
      palette: options.palette,
      mapSize: MINIMAP_SIZE,
      waterLevel: options.waterLevel,
      surfaceKind: options.hasSurface ? "water" : "none",
    });
    context.putImageData(image, 0, 0);
    minimapTerrain = context.getImageData(0, 0, MINIMAP_SIZE, MINIMAP_SIZE);
  }

  function setMinimapMarkers(
    markers: readonly MinimapMarker[],
    playerYaw: number,
  ): void {
    const context = elements.navMap.getContext("2d");
    if (context === null || minimapTerrain === null) return;
    context.putImageData(minimapTerrain, 0, 0);
    for (const marker of markers) {
      const pixel = worldToMapPixel(marker.x, marker.z, MINIMAP_SIZE);
      switch (marker.kind) {
        case "structure":
          context.fillStyle = "#ffb347";
          context.fillRect(pixel.x - 1, pixel.y - 1, 3, 3);
          break;
        case "pet":
          context.fillStyle = "#7df0cf";
          context.beginPath();
          context.arc(pixel.x + 0.5, pixel.y + 0.5, 2, 0, Math.PI * 2);
          context.fill();
          break;
        case "crew":
          context.fillStyle = "#b8fff0";
          context.beginPath();
          context.arc(pixel.x + 0.5, pixel.y + 0.5, 2.4, 0, Math.PI * 2);
          context.fill();
          break;
        case "player": {
          context.save();
          context.translate(pixel.x + 0.5, pixel.y + 0.5);
          context.rotate(-playerYaw);
          context.fillStyle = "#ffffff";
          context.beginPath();
          context.moveTo(0, -5);
          context.lineTo(3.2, 4);
          context.lineTo(0, 2);
          context.lineTo(-3.2, 4);
          context.closePath();
          context.fill();
          context.restore();
          break;
        }
        default: {
          const exhaustive: never = marker.kind;
          throw new Error(`Unknown minimap marker: ${String(exhaustive)}`);
        }
      }
    }
  }

  function setPhotoMode(active: boolean): void {
    document.body.classList.toggle("photo-mode", active);
  }

  function capturePostcard(
    source: HTMLCanvasElement,
    name: string,
    seedHex: string,
  ): { pngDataUrl: string; thumb: string; filename: string } | null {
    const caption = postcardCaption(name, seedHex);
    const canvas = document.createElement("canvas");
    canvas.width = source.width;
    canvas.height = source.height;
    const context = canvas.getContext("2d");
    if (context === null) return null;
    context.drawImage(source, 0, 0);
    const barHeight = Math.max(36, Math.round(canvas.height * 0.07));
    context.fillStyle = "rgba(4, 10, 12, 0.68)";
    context.fillRect(0, canvas.height - barHeight, canvas.width, barHeight);
    context.fillStyle = "#7df0cf";
    context.font = `600 ${Math.max(14, Math.round(barHeight * 0.42))}px ${
      getComputedStyle(document.body).fontFamily
    }`;
    context.fillText(caption, 16, canvas.height - barHeight * 0.35);
    const pngDataUrl = canvas.toDataURL("image/png");
    const thumb = document.createElement("canvas");
    thumb.width = 320;
    thumb.height = 180;
    const thumbContext = thumb.getContext("2d");
    if (thumbContext === null) return null;
    thumbContext.drawImage(canvas, 0, 0, thumb.width, thumb.height);
    let quality = 0.62;
    let thumbUrl = thumb.toDataURL("image/jpeg", quality);
    while (thumbUrl.length > POSTCARD_THUMB_MAX_CHARS && quality > 0.24) {
      quality -= 0.12;
      thumbUrl = thumb.toDataURL("image/jpeg", quality);
    }
    if (thumbUrl.length > POSTCARD_THUMB_MAX_CHARS) return null;
    return {
      pngDataUrl,
      thumb: thumbUrl,
      filename: postcardFilename(seedHex, Date.now()),
    };
  }

  function setSessionReady(ready: boolean): void {
    elements.playButton.disabled = !ready;
    elements.loadGameButton.disabled = !ready;
    elements.newGameButton.disabled = !ready;
    elements.startOverlay.setAttribute("aria-busy", ready ? "false" : "true");
    if (!ready) {
      elements.startSubtitle.textContent = "GENERATING TERRAIN…";
    }
  }

  function showOverlay(mode: "start" | "paused"): void {
    switch (mode) {
      case "start":
        elements.startTitle.textContent = "Deep Space Atlas";
        elements.playButton.textContent = "CONTINUE";
        elements.saveGameButton.classList.add("hidden");
        break;
      case "paused":
        elements.startTitle.textContent = "STANDBY";
        elements.playButton.textContent = "RESUME";
        elements.saveGameButton.classList.remove("hidden");
        // Cursor often reappears over RESUME after Escape exits pointer lock;
        // ignore the trailing click/mouseup so Standby stays put.
        armPlayButtonSoon();
        break;
      default: {
        const exhaustiveMode: never = mode;
        throw new Error(`Unknown overlay mode: ${exhaustiveMode}`);
      }
    }
    elements.startOverlay.classList.remove("hidden");
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  }

  function hideCommanderMenusExcept(
    keep: "inventory" | "gear" | "build" | "profile" | "command" | "none",
  ): void {
    if (keep !== "inventory") {
      elements.inventoryOverlay.classList.add("hidden");
    }
    if (keep !== "gear") elements.gearOverlay.classList.add("hidden");
    if (keep !== "build") elements.buildOverlay.classList.add("hidden");
    if (keep !== "profile") elements.profileOverlay.classList.add("hidden");
    if (keep !== "command") elements.commandOverlay.classList.add("hidden");
    if (keep !== "none") elements.startOverlay.classList.add("hidden");
  }

  function setInventoryVisible(visible: boolean): void {
    elements.inventoryOverlay.classList.toggle("hidden", !visible);
    if (visible) hideCommanderMenusExcept("inventory");
  }

  function setGearMenuVisible(visible: boolean): void {
    elements.gearOverlay.classList.toggle("hidden", !visible);
    if (visible) hideCommanderMenusExcept("gear");
  }

  function setBuildMenuVisible(visible: boolean): void {
    elements.buildOverlay.classList.toggle("hidden", !visible);
    if (visible) hideCommanderMenusExcept("build");
  }

  function setProfileVisible(visible: boolean): void {
    elements.profileOverlay.classList.toggle("hidden", !visible);
    if (visible) hideCommanderMenusExcept("profile");
  }

  function setCommandBarVisible(visible: boolean): void {
    elements.commandOverlay.classList.toggle("hidden", !visible);
    if (visible) {
      hideCommanderMenusExcept("command");
      elements.commandInput.value = "";
      setCommandFeedback("", "neutral");
      queueMicrotask(() => elements.commandInput.focus());
      return;
    }
    elements.commandInput.blur();
  }

  function setCommandFeedback(
    text: string,
    tone: "ok" | "error" | "neutral",
  ): void {
    elements.commandFeedback.textContent = text;
    elements.commandFeedback.classList.toggle("ok", tone === "ok");
    elements.commandFeedback.classList.toggle("error", tone === "error");
  }

  function updateGearMenu(view: GearMenuView): void {
    const owned = new Set(view.gear);
    elements.gearRecipes.replaceChildren();
    elements.gearInstalled.replaceChildren();

    for (const gearId of GEAR_ORDER) {
      const definition = GEAR_DEFINITIONS[gearId];
      if (owned.has(gearId)) continue;

      const missing = missingPrerequisites(definition, view.gear);
      const affordable = canAffordCost(definition.cost, view.inventory);
      const locked = missing.length > 0;
      const card = document.createElement("div");
      card.className = locked ? "recipe-card locked" : "recipe-card";

      const main = document.createElement("div");
      main.className = "recipe-card-main";

      const label = document.createElement("div");
      label.className = "recipe-card-label";
      label.textContent = definition.label;

      const blurb = document.createElement("div");
      blurb.className = "recipe-card-blurb";
      blurb.textContent = definition.blurb;

      const meta = document.createElement("div");
      meta.className =
        !locked && affordable ? "recipe-card-meta ready" : "recipe-card-meta";
      if (locked) {
        const names = missing
          .map((id) => GEAR_DEFINITIONS[id].label)
          .join(", ");
        meta.textContent = `Requires ${names}`;
      } else {
        meta.textContent = formatCargoCost(definition.cost);
      }

      main.append(label, blurb, meta);

      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "INSTALL";
      button.disabled = locked || !affordable;
      button.addEventListener("click", () => {
        boundActions?.onInstallGear(gearId);
      });

      card.append(main, button);
      elements.gearRecipes.append(card);
    }

    const installedIds = GEAR_ORDER.filter((id) => owned.has(id));
    const hasInstalled = installedIds.length > 0;
    elements.gearInstalledEmpty.classList.toggle("hidden", hasInstalled);
    elements.gearInstalled.classList.toggle("hidden", !hasInstalled);

    for (const gearId of installedIds) {
      const definition = GEAR_DEFINITIONS[gearId];
      const card = document.createElement("div");
      card.className = "recipe-card installed";

      const main = document.createElement("div");
      main.className = "recipe-card-main";

      const label = document.createElement("div");
      label.className = "recipe-card-label";
      label.textContent = definition.label;

      const blurb = document.createElement("div");
      blurb.className = "recipe-card-blurb";
      blurb.textContent = definition.blurb;

      const meta = document.createElement("div");
      meta.className = "recipe-card-meta ready";
      meta.textContent = "Installed";

      main.append(label, blurb, meta);
      card.append(main);
      elements.gearInstalled.append(card);
    }
  }

  function updateBuildMenu(view: BuildMenuView): void {
    elements.buildRecipes.replaceChildren();

    const placedByBlueprint = new Map<BlueprintId, number>();
    for (const entry of view.structures) {
      placedByBlueprint.set(
        entry.blueprintId,
        (placedByBlueprint.get(entry.blueprintId) ?? 0) + 1,
      );
    }

    for (const blueprintId of BLUEPRINT_ORDER) {
      const definition = BLUEPRINT_DEFINITIONS[blueprintId];
      const affordable = canAffordCost(definition.cost, view.inventory);
      const placed = placedByBlueprint.get(blueprintId) ?? 0;
      const atLimit = placed >= definition.maxPerPlanet;
      const card = document.createElement("div");
      card.className = atLimit ? "recipe-card locked" : "recipe-card";

      const main = document.createElement("div");
      main.className = "recipe-card-main";

      const label = document.createElement("div");
      label.className = "recipe-card-label";
      label.textContent = definition.label;

      const blurb = document.createElement("div");
      blurb.className = "recipe-card-blurb";
      blurb.textContent = definition.blurb;

      const meta = document.createElement("div");
      meta.className =
        !atLimit && affordable ? "recipe-card-meta ready" : "recipe-card-meta";
      if (atLimit) {
        meta.textContent = `Planet limit ${placed}/${definition.maxPerPlanet}`;
      } else {
        meta.textContent = `${formatCargoCost(definition.cost)} · ${placed}/${definition.maxPerPlanet} on planet`;
      }

      main.append(label, blurb, meta);

      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "FABRICATE";
      button.disabled = atLimit || !affordable;
      button.addEventListener("click", () => {
        boundActions?.onFabricate(blueprintId);
      });

      card.append(main, button);
      elements.buildRecipes.append(card);
    }
  }

  function updateProfile(
    view: ProfileView,
    currentSeedHex: string | null,
  ): void {
    if (document.activeElement !== elements.profileName) {
      elements.profileName.value = view.name;
    }
    elements.profileName.maxLength = MAX_PLAYER_NAME_LENGTH;
    elements.profilePlayTime.textContent = formatPlayTime(view.playTimeMs);
    elements.profileLook.value = String(view.lookSensitivity);
    elements.profileLookValue.textContent = view.lookSensitivity.toFixed(2);
    elements.profileReduceCrt.checked = view.reduceCrtMotion;

    const hasCrew = view.crew !== null;
    elements.profileCrewEmpty.classList.toggle("hidden", hasCrew);
    elements.profileCrew.classList.remove("hidden");
    elements.profileCrew.replaceChildren();
    if (view.crew !== null) {
      const row = document.createElement("div");
      row.className = "profile-crew-row";
      const meta = document.createElement("div");
      meta.className = "profile-crew-meta";
      const title = document.createElement("div");
      title.className = "profile-pet-name";
      title.textContent =
        FAUNA_DEFINITIONS[view.crew.species].label.toUpperCase();
      const detail = document.createElement("div");
      detail.className = "profile-pet-detail";
      detail.textContent = `${view.crew.homeName.toUpperCase()} · ${view.crew.homeSeed}`;
      meta.append(title, detail);
      const release = document.createElement("button");
      release.type = "button";
      release.textContent = "RELEASE";
      release.addEventListener("click", () => {
        boundActions?.onCrewRelease();
      });
      row.append(meta, release);
      elements.profileCrew.append(row);
    }
    const enlist = document.createElement("button");
    enlist.type = "button";
    enlist.textContent = hasCrew ? "REPLACE FROM PET" : "ENLIST PET";
    enlist.addEventListener("click", () => {
      boundActions?.onCrewEnlist();
    });
    elements.profileCrew.append(enlist);

    const companions = view.visited.filter((entry) => entry.hasPet);
    const hasCompanions = companions.length > 0;
    elements.profilePetsEmpty.classList.toggle("hidden", hasCompanions);
    elements.profilePets.classList.toggle("hidden", !hasCompanions);
    elements.profilePets.replaceChildren();
    for (const entry of companions) {
      const row = document.createElement("div");
      row.className = "profile-pet";
      if (currentSeedHex !== null && entry.seed === currentSeedHex) {
        row.classList.add("current");
      }

      const title = document.createElement("div");
      title.className = "profile-pet-name";
      title.textContent = entry.name.toUpperCase();

      const detail = document.createElement("div");
      detail.className = "profile-pet-detail";
      detail.textContent =
        currentSeedHex !== null && entry.seed === currentSeedHex
          ? `${entry.seed} · HERE`
          : entry.seed;

      row.append(title, detail);
      elements.profilePets.append(row);
    }

    elements.profileVisited.replaceChildren();
    const hasVisits = view.visited.length > 0;
    elements.profileVisitedEmpty.classList.toggle("hidden", hasVisits);
    elements.profileVisited.classList.toggle("hidden", !hasVisits);

    for (const entry of view.visited) {
      const row = document.createElement("div");
      row.className = "profile-visit";
      if (currentSeedHex !== null && entry.seed === currentSeedHex) {
        row.classList.add("current");
      }

      const meta = document.createElement("div");
      meta.className = "profile-visit-meta";

      const title = document.createElement("div");
      title.className = "profile-visit-name";
      title.textContent = entry.name.toUpperCase();

      const detail = document.createElement("div");
      detail.className = "profile-visit-detail";
      detail.textContent = entry.hasPet
        ? `${entry.seed} · PET`
        : entry.seed;

      meta.append(title, detail);

      const travel = document.createElement("button");
      travel.type = "button";
      travel.className = "profile-travel";
      const isCurrent =
        currentSeedHex !== null && entry.seed === currentSeedHex;
      travel.textContent = isCurrent ? "HERE" : "TRAVEL";
      travel.disabled = isCurrent;
      travel.addEventListener("click", () => {
        boundActions?.onTravelToVisited(entry.seed);
      });

      row.append(meta, travel);
      elements.profileVisited.append(row);
    }

    const hasPostcards = view.postcards.length > 0;
    elements.profileAtlasEmpty.classList.toggle("hidden", hasPostcards);
    elements.profileAtlas.classList.toggle("hidden", !hasPostcards);
    elements.profileAtlas.replaceChildren();
    for (const card of view.postcards) {
      const item = document.createElement("div");
      item.className = "profile-atlas-card";
      const image = document.createElement("img");
      image.src = card.thumb;
      image.alt = postcardCaption(card.name, card.seed);
      const caption = document.createElement("span");
      caption.textContent = postcardCaption(card.name, card.seed);
      item.append(image, caption);
      elements.profileAtlas.append(item);
    }
  }

  function showPlaying(): void {
    elements.startOverlay.classList.add("hidden");
    elements.inventoryOverlay.classList.add("hidden");
    elements.gearOverlay.classList.add("hidden");
    elements.buildOverlay.classList.add("hidden");
    elements.profileOverlay.classList.add("hidden");
    elements.commandOverlay.classList.add("hidden");
  }

  function notify(text: string, color: string): void {
    const notification = document.createElement("div");
    notification.className = "notif";
    notification.textContent = text;
    notification.style.color = color;
    elements.notifications.append(notification);
    window.setTimeout(() => notification.remove(), 1550);
  }

  function setTargetLabel(label: string): void {
    if (label === lastTargetLabel) return;
    elements.targetLabel.textContent = label;
    lastTargetLabel = label;
  }

  function setMiningProgress(progress: number): void {
    const offset =
      MINING_RING_CIRCUMFERENCE * (1 - clamp(progress, 0, 1));
    elements.ring.style.strokeDashoffset = offset.toFixed(1);
  }

  function setFuel(fuel: number): void {
    const percentage = Math.round(fuel * 100);
    if (percentage === lastFuelPercentage) return;
    lastFuelPercentage = percentage;
    elements.fuelFill.style.width = `${percentage}%`;
    elements.fuelFill.classList.toggle("low", percentage < 25);
  }

  function setFlightSpeed(speed: number, boosting: boolean): void {
    const readout = formatFlightSpeed(speed);
    const ratio = flightSpeedBarRatio(speed);
    const key = `${readout}|${ratio.toFixed(3)}|${boosting ? 1 : 0}`;
    if (key === lastSpeedKey) return;
    lastSpeedKey = key;
    elements.speedValue.textContent = readout;
    elements.speedFill.style.width = `${Math.round(ratio * 100)}%`;
    elements.speedFill.classList.toggle("boosting", boosting);
  }

  function showFatal(title: string, message: string): void {
    elements.errorTitle.textContent = title;
    elements.errorMessage.textContent = message;
    elements.errorOverlay.classList.remove("hidden");
    elements.startOverlay.classList.add("hidden");
  }

  function bindActions(actions: UIActions): void {
    boundActions = actions;
    elements.playButton.addEventListener("click", () => {
      if (!playButtonArmed) return;
      actions.onPlay();
    });
    elements.saveGameButton.addEventListener("click", () => {
      actions.onSaveGame();
      elements.saveGameButton.blur();
    });
    elements.loadGameButton.addEventListener("click", () => {
      elements.gameFileInput.value = "";
      elements.gameFileInput.click();
      elements.loadGameButton.blur();
    });
    elements.newGameButton.addEventListener("click", () => {
      actions.onNewGame();
      elements.newGameButton.blur();
    });
    elements.gameFileInput.addEventListener("change", () => {
      const file = elements.gameFileInput.files?.[0];
      if (file) actions.onLoadGame(file);
    });
    elements.inventoryClose.addEventListener(
      "click",
      actions.onToggleInventory,
    );
    elements.gearClose.addEventListener("click", actions.onToggleGearMenu);
    elements.buildClose.addEventListener(
      "click",
      actions.onToggleBuildMenu,
    );
    elements.profileClose.addEventListener(
      "click",
      actions.onToggleProfile,
    );
    for (const tab of document.querySelectorAll<HTMLButtonElement>(
      ".menu-tab[data-menu]",
    )) {
      tab.addEventListener("click", () => {
        const menu = tab.dataset.menu;
        if (
          menu === "inventory" ||
          menu === "gear" ||
          menu === "build" ||
          menu === "profile"
        ) {
          actions.onOpenMenu(menu);
        }
      });
    }
    elements.profileNameSave.addEventListener("click", () => {
      actions.onProfileRename(elements.profileName.value);
      elements.profileNameSave.blur();
    });
    elements.profileName.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Enter") {
        actions.onProfileRename(elements.profileName.value);
        elements.profileName.blur();
      }
    });
    elements.profileLook.addEventListener("input", () => {
      const value = Number(elements.profileLook.value);
      elements.profileLookValue.textContent = Number.isFinite(value)
        ? value.toFixed(2)
        : LOOK_SENSITIVITY_DEFAULT.toFixed(2);
      actions.onLookSensitivity(value);
    });
    elements.profileReduceCrt.addEventListener("change", () => {
      actions.onReduceCrtMotion(elements.profileReduceCrt.checked);
    });
    elements.commandInput.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.code === "Escape") {
        event.preventDefault();
        actions.onDismissCommandBar();
        return;
      }
      if (event.code === "Enter") {
        event.preventDefault();
        const line = elements.commandInput.value;
        elements.commandInput.value = "";
        actions.onCommandSubmit(line);
      }
    });
  }

  buildInventory();
  buildResourceHud();

  return {
    bindActions,
    notify,
    setFuel,
    setFlightSpeed,
    setInventoryVisible,
    setGearMenuVisible,
    setBuildMenuVisible,
    setProfileVisible,
    setCommandBarVisible,
    setCommandFeedback,
    updateProfile,
    updateGearMenu,
    updateBuildMenu,
    setMiningProgress,
    setTargetLabel,
    setWorldSummary,
    setScanReadout,
    setPrompt,
    setPetCompass,
    setHudMode,
    setRoverDriving,
    setMinimapVisible,
    paintMinimapTerrain,
    setMinimapMarkers,
    setPhotoMode,
    capturePostcard,
    showFatal,
    showOverlay,
    showPlaying,
    setSessionReady,
    updateInventory,
    updateInventoryViews,
    revealGameHud(): void {
      elements.hud.classList.remove("hidden");
      elements.reticle.classList.remove("hidden");
    },
  };
}
