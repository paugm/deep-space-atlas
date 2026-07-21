/**
 * Sample-backed game audio (Kenney + rubberduck CC0 packs).
 * Buffers decode after the first user gesture.
 */

import { SAMPLE_URLS, type SampleId } from "./audio-catalog.ts";
import {
  type FootstepSurface,
  chimeSampleForFrequency,
  footstepSample,
  miningHumGain,
  odditySample,
  petChirpSample,
  scanPingSample,
  spaceBedGain,
  spaceBedRate,
  swimStrokeSample,
  thrusterLoopGain,
  thrusterLoopRate,
  thrusterLoopSample,
  underwaterBedGain,
  vehicleEngineGain,
  vehicleEngineRate,
  vehicleEngineSample,
} from "./audio-rules.ts";
import type { RoverKindId } from "./vehicles/kinds.ts";

export const MASTER_GAIN = 0.5;

/** Pure; no AudioContext. Mute → 0, otherwise MASTER_GAIN. */
export function masterGainForMute(muted: boolean): number {
  return muted ? 0 : MASTER_GAIN;
}

interface SafariAudioWindow extends Window {
  /** Legacy Safari constructor absent from the standard DOM declarations. */
  webkitAudioContext?: typeof AudioContext;
}

export interface SoundController {
  resume(): void;
  isMuted(): boolean;
  setMuted(muted: boolean): void;
  toggleMute(): boolean;
  humOn(): void;
  setHumProgress(progress: number): void;
  humOff(): void;
  chime(frequency: number): void;
  /** Compatibility entry for travel/explosion samples. */
  burst(
    volume: number,
    cutoff: number,
    duration: number,
    playbackRate: number,
  ): void;
  step(surface?: FootstepSurface): void;
  thud(): void;
  /** Intensity controls thruster gain and playback rate. */
  jetOn(intensity?: number): void;
  jetOff(): void;
  boostPunch(): void;
  setUnderwater(active: boolean, strength?: number): void;
  setVehicle(
    kind: RoverKindId | null,
    speedRatio?: number,
  ): void;
  boardVehicle(): void;
  dismountVehicle(): void;
  petChirp(): void;
  petBond(): void;
  uiOpen(): void;
  uiClose(): void;
  uiError(): void;
  uiClick(): void;
  scanPing(): void;
  harvestFanfare(): void;
  oddity(): void;
  swimStroke(): void;
  travelWhoosh(): void;
  setSpaceBed(active: boolean): void;
  /** No-op outside space mode. */
  setSpaceFlight(
    speedRatio: number,
    thrustIntensity: number,
    boosting?: boolean,
  ): void;
}

interface LoopSlot {
  source: AudioBufferSourceNode | null;
  gain: GainNode;
  sampleId: SampleId | null;
  rate: number;
}

function createSound(): SoundController {
  let context: AudioContext | null = null;
  let master: GainNode | null = null;
  let muted = false;
  const buffers = new Map<SampleId, AudioBuffer>();
  let loading: Promise<void> | null = null;
  let ready = false;

  let humActive = false;
  let humProgress = 0;
  let jetActive = false;
  let jetIntensity = 0.7;
  let jetSample: SampleId = "thrusterFire0";
  let underwaterActive = false;
  let underwaterStrength = 1;
  let spaceBedActive = false;
  let spaceSpeedRatio = 0;
  let spaceBoosting = false;
  let vehicleKind: RoverKindId | null = null;
  let vehicleSpeedRatio = 0;

  let humLoop: LoopSlot | null = null;
  let jetLoop: LoopSlot | null = null;
  let underwaterLoop: LoopSlot | null = null;
  let underwaterBubbleLoop: LoopSlot | null = null;
  let vehicleLoop: LoopSlot | null = null;
  let spaceBedLoop: LoopSlot | null = null;

  function ensureContext(): void {
    if (context) return;

    const safariWindow = window as SafariAudioWindow;
    const AudioContextClass =
      window.AudioContext ?? safariWindow.webkitAudioContext;
    if (!AudioContextClass) return;

    try {
      const nextContext = new AudioContextClass();
      context = nextContext;
      master = nextContext.createGain();
      master.gain.value = masterGainForMute(muted);
      master.connect(nextContext.destination);
    } catch {
      context = null;
      master = null;
    }
  }

  function syncDesiredLoops(): void {
    if (!ready) return;

    if (humActive) {
      humLoop = ensureLoop(humLoop);
      if (humLoop) {
        startLoop(humLoop, "computerNoise", miningHumGain(humProgress), 0.9 + humProgress * 0.35);
      }
    } else {
      fadeLoop(humLoop, 0);
    }

    if (jetActive) {
      jetLoop = ensureLoop(jetLoop);
      if (jetLoop) {
        startLoop(
          jetLoop,
          jetSample,
          thrusterLoopGain(jetIntensity),
          thrusterLoopRate(jetIntensity),
        );
      }
    } else {
      fadeLoop(jetLoop, 0);
    }

    if (underwaterActive) {
      underwaterLoop = ensureLoop(underwaterLoop);
      underwaterBubbleLoop = ensureLoop(underwaterBubbleLoop);
      const bed = underwaterBedGain(underwaterStrength);
      if (underwaterLoop) startLoop(underwaterLoop, "ambientDeep", bed, 0.85);
      if (underwaterBubbleLoop) {
        startLoop(underwaterBubbleLoop, "burble01", bed * 0.55, 0.95);
      }
    } else {
      fadeLoop(underwaterLoop, 0);
      fadeLoop(underwaterBubbleLoop, 0);
    }

    if (vehicleKind !== null) {
      vehicleLoop = ensureLoop(vehicleLoop);
      if (vehicleLoop) {
        startLoop(
          vehicleLoop,
          vehicleEngineSample(vehicleKind),
          vehicleEngineGain(vehicleSpeedRatio),
          vehicleEngineRate(vehicleSpeedRatio),
        );
      }
    } else {
      fadeLoop(vehicleLoop, 0);
    }

    if (spaceBedActive) {
      spaceBedLoop = ensureLoop(spaceBedLoop);
      if (spaceBedLoop) {
        startLoop(
          spaceBedLoop,
          "spaceEngineLow",
          spaceBedGain(spaceSpeedRatio, spaceBoosting),
          spaceBedRate(spaceSpeedRatio, spaceBoosting),
        );
      }
    } else {
      fadeLoop(spaceBedLoop, 0);
    }
  }

  async function loadBuffers(): Promise<void> {
    if (!context || ready) return;
    if (loading) {
      await loading;
      return;
    }

    const activeContext = context;
    loading = (async () => {
      const entries = Object.entries(SAMPLE_URLS) as [SampleId, string][];
      await Promise.all(
        entries.map(async ([id, url]) => {
          try {
            const response = await fetch(url);
            if (!response.ok) return;
            const raw = await response.arrayBuffer();
            const buffer = await activeContext.decodeAudioData(raw.slice(0));
            buffers.set(id, buffer);
          } catch {
            // Missing or undecodable samples stay silent because callers no-op.
          }
        }),
      );
      ready = true;
      syncDesiredLoops();
    })();

    await loading;
  }

  function resume(): void {
    ensureContext();
    if (context?.state === "suspended") void context.resume();
    void loadBuffers();
  }

  function isMuted(): boolean {
    return muted;
  }

  function setMuted(nextMuted: boolean): void {
    muted = nextMuted;
    if (!master || !context) return;
    master.gain.setTargetAtTime(
      masterGainForMute(nextMuted),
      context.currentTime,
      0.03,
    );
  }

  function toggleMute(): boolean {
    setMuted(!muted);
    return muted;
  }

  function createLoopSlot(): LoopSlot {
    if (!context || !master) {
      throw new Error("Audio context required for loop slot.");
    }
    const gain = context.createGain();
    gain.gain.value = 0;
    gain.connect(master);
    return { source: null, gain, sampleId: null, rate: 1 };
  }

  function ensureLoop(slot: LoopSlot | null): LoopSlot | null {
    if (slot) return slot;
    if (!context || !master) return null;
    return createLoopSlot();
  }

  function startLoop(
    slot: LoopSlot,
    sampleId: SampleId,
    gainValue: number,
    rate = 1,
  ): void {
    if (!context) return;
    const buffer = buffers.get(sampleId);
    if (!buffer) return;

    if (slot.source && slot.sampleId === sampleId) {
      slot.rate = rate;
      slot.source.playbackRate.setTargetAtTime(
        rate,
        context.currentTime,
        0.08,
      );
      slot.gain.gain.setTargetAtTime(gainValue, context.currentTime, 0.08);
      return;
    }

    if (slot.source) {
      try {
        slot.source.stop();
      } catch {
        // already stopped
      }
      slot.source.disconnect();
      slot.source = null;
    }

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.playbackRate.value = rate;
    source.connect(slot.gain);
    source.start();
    slot.source = source;
    slot.sampleId = sampleId;
    slot.rate = rate;
    slot.gain.gain.setTargetAtTime(gainValue, context.currentTime, 0.08);
  }

  function fadeLoop(slot: LoopSlot | null, to = 0): void {
    if (!slot || !context) return;
    slot.gain.gain.setTargetAtTime(to, context.currentTime, 0.1);
  }

  function playOneShot(
    sampleId: SampleId,
    options: {
      volume?: number;
      playbackRate?: number;
      when?: number;
    } = {},
  ): void {
    if (!context || !master) return;
    const buffer = buffers.get(sampleId);
    if (!buffer) return;

    const volume = options.volume ?? 0.35;
    const playbackRate = options.playbackRate ?? 1;
    const start = options.when ?? context.currentTime;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = playbackRate;

    const gain = context.createGain();
    gain.gain.value = volume;
    source.connect(gain);
    gain.connect(master);
    source.start(start);
    source.stop(start + buffer.duration / Math.max(0.01, playbackRate) + 0.05);
  }

  function humOn(): void {
    resume();
    humActive = true;
    syncDesiredLoops();
  }

  function setHumProgress(progress: number): void {
    humProgress = progress;
    if (!humActive || !humLoop || !context) return;
    humLoop.gain.gain.setTargetAtTime(
      miningHumGain(progress),
      context.currentTime,
      0.06,
    );
    if (humLoop.source) {
      humLoop.source.playbackRate.setTargetAtTime(
        0.9 + progress * 0.35,
        context.currentTime,
        0.08,
      );
    }
  }

  function humOff(): void {
    humActive = false;
    humProgress = 0;
    fadeLoop(humLoop, 0);
  }

  function chime(frequency: number): void {
    resume();
    playOneShot(chimeSampleForFrequency(frequency), {
      volume: 0.32,
      playbackRate: 0.92 + Math.random() * 0.16,
    });
  }

  function burst(
    _volume: number,
    _cutoff: number,
    duration: number,
    playbackRate: number,
  ): void {
    resume();
    playOneShot("warpWhoosh", {
      volume: 0.4,
      playbackRate: Math.max(0.5, Math.min(1.6, playbackRate)),
    });
    playOneShot("lowFrequencyExplosion", {
      volume: 0.28,
      playbackRate: 0.7,
      when: (context?.currentTime ?? 0) + Math.min(0.35, duration * 0.15),
    });
    playOneShot("explosionCrunch", {
      volume: 0.18,
      playbackRate: 0.8,
    });
    playOneShot("spaceEngine", {
      volume: 0.16,
      playbackRate: 0.9,
    });
  }

  function step(surface: FootstepSurface = "dry"): void {
    resume();
    playOneShot(footstepSample(surface, Math.random()), {
      volume: surface === "wet" ? 0.28 : 0.22,
      playbackRate: 0.9 + Math.random() * 0.25,
    });
  }

  function thud(): void {
    resume();
    playOneShot("impactPlateHeavy", { volume: 0.4, playbackRate: 0.85 });
    playOneShot("impactMetalMedium", { volume: 0.22, playbackRate: 0.7 });
    playOneShot("impactMetal0", { volume: 0.16, playbackRate: 0.75 });
  }

  function jetOn(intensity = 0.7): void {
    resume();
    if (!jetActive) {
      jetSample = thrusterLoopSample(Math.random());
    }
    jetActive = true;
    jetIntensity = Math.max(0, Math.min(1, intensity));
    syncDesiredLoops();
  }

  function jetOff(): void {
    jetActive = false;
    jetIntensity = 0;
    fadeLoop(jetLoop, 0);
  }

  function boostPunch(): void {
    resume();
    playOneShot("warpWhoosh", { volume: 0.28, playbackRate: 1.15 });
    playOneShot("spaceEngine", { volume: 0.2, playbackRate: 1.05 });
    playOneShot("phaseJump1", { volume: 0.14, playbackRate: 0.95 });
  }

  function setUnderwater(active: boolean, strength = 1): void {
    resume();
    underwaterActive = active;
    underwaterStrength = strength;
    syncDesiredLoops();
  }

  function setVehicle(
    kind: RoverKindId | null,
    speedRatio = 0,
  ): void {
    resume();
    vehicleKind = kind;
    vehicleSpeedRatio = speedRatio;
    syncDesiredLoops();
  }

  function boardVehicle(): void {
    resume();
    playOneShot("doorOpen", { volume: 0.38 });
    playOneShot("switchUi", { volume: 0.2, playbackRate: 1.1 });
    playOneShot("impactGenericLight", { volume: 0.14, playbackRate: 1.1 });
  }

  function dismountVehicle(): void {
    resume();
    playOneShot("doorClose", { volume: 0.36 });
    playOneShot("impactMetal2", { volume: 0.14, playbackRate: 1.05 });
    setVehicle(null);
  }

  function petChirp(): void {
    resume();
    playOneShot(petChirpSample(Math.random()), {
      volume: 0.34,
      playbackRate: 0.95 + Math.random() * 0.2,
    });
  }

  function petBond(): void {
    resume();
    playOneShot("jingleRetro", { volume: 0.36 });
    playOneShot("jinglePizzi", { volume: 0.22, playbackRate: 1.05 });
    playOneShot("cute05", { volume: 0.3 });
  }

  function uiOpen(): void {
    resume();
    playOneShot("openUi", { volume: 0.28 });
  }

  function uiClose(): void {
    resume();
    playOneShot("closeUi", { volume: 0.26 });
  }

  function uiError(): void {
    resume();
    playOneShot("errorUi", { volume: 0.3 });
  }

  function uiClick(): void {
    resume();
    playOneShot("click", { volume: 0.22 });
    playOneShot("select", { volume: 0.12, playbackRate: 1.2 });
  }

  function scanPing(): void {
    resume();
    playOneShot(scanPingSample(Math.random()), {
      volume: 0.24,
      playbackRate: 1.05 + Math.random() * 0.2,
    });
    playOneShot("toggleUi", { volume: 0.12, playbackRate: 1.3 });
  }

  function harvestFanfare(): void {
    resume();
    playOneShot("jingleHit", { volume: 0.28 });
    playOneShot("drop", { volume: 0.2 });
    playOneShot("impactMining", { volume: 0.18, playbackRate: 0.9 });
  }

  function oddity(): void {
    resume();
    playOneShot(odditySample(Math.random()), {
      volume: 0.28,
      playbackRate: 0.9 + Math.random() * 0.25,
    });
  }

  function swimStroke(): void {
    resume();
    playOneShot(swimStrokeSample(Math.random()), {
      volume: 0.26,
      playbackRate: 0.85 + Math.random() * 0.3,
    });
  }

  function travelWhoosh(): void {
    resume();
    playOneShot("warpWhoosh", { volume: 0.42 });
    playOneShot("laserLarge", { volume: 0.24, playbackRate: 0.8 });
    playOneShot("phaseJump1", { volume: 0.22 });
    playOneShot("terminalHum", { volume: 0.12, playbackRate: 0.85 });
  }

  function setSpaceBed(active: boolean): void {
    resume();
    spaceBedActive = active;
    if (!active) {
      spaceSpeedRatio = 0;
      spaceBoosting = false;
    }
    syncDesiredLoops();
  }

  function setSpaceFlight(
    speedRatio: number,
    thrustIntensity: number,
    boosting = false,
  ): void {
    if (!spaceBedActive) return;
    spaceSpeedRatio = Math.max(0, Math.min(1, speedRatio));
    spaceBoosting = boosting;
    // Keep thruster intensity hot while boosting even if W is released.
    const intensity = Math.max(
      thrustIntensity,
      speedRatio * 0.45,
      boosting ? 0.85 : 0,
    );
    if (intensity > 0.08 || boosting) {
      jetOn(intensity);
    } else {
      jetOff();
    }
    syncDesiredLoops();
  }

  return {
    resume,
    isMuted,
    setMuted,
    toggleMute,
    humOn,
    setHumProgress,
    humOff,
    chime,
    burst,
    step,
    thud,
    jetOn,
    jetOff,
    boostPunch,
    setUnderwater,
    setVehicle,
    boardVehicle,
    dismountVehicle,
    petChirp,
    petBond,
    uiOpen,
    uiClose,
    uiError,
    uiClick,
    scanPing,
    harvestFanfare,
    oddity,
    swimStroke,
    travelWhoosh,
    setSpaceBed,
    setSpaceFlight,
  };
}

export const Sound: SoundController = createSound();

/** Register gestures that satisfy browser Web Audio autoplay policies. */
export function installAudioUnlockListeners(): void {
  window.addEventListener("pointerdown", () => Sound.resume());
  window.addEventListener("keydown", () => Sound.resume(), { once: true });
}
