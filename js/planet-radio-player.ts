/**
 * Tone.js playback for seed-derived planet radio. Mute ducks this bus only.
 */

import * as Tone from "tone";

import {
  midiToFrequency,
  type PlanetRadioPatch,
} from "./planet-radio.ts";

interface RadioEngine {
  prepare(): Promise<void>;
  start(patch: PlanetRadioPatch): Promise<void>;
  stop(): void;
  setMuted(muted: boolean): void;
  setDucked(ducked: boolean): void;
}

function createRadioEngine(): RadioEngine {
  let synth: Tone.PolySynth | null = null;
  let filter: Tone.Filter | null = null;
  let delay: Tone.FeedbackDelay | null = null;
  let volume: Tone.Volume | null = null;
  let loop: Tone.Loop | null = null;
  let muted = false;
  let ducked = false;

  function applyGain(): void {
    if (volume === null) return;
    volume.mute = muted;
    volume.volume.value = ducked ? -14 : 0;
  }

  function disposeGraph(): void {
    loop?.stop();
    loop?.dispose();
    loop = null;
    synth?.releaseAll();
    synth?.dispose();
    synth = null;
    delay?.dispose();
    delay = null;
    filter?.dispose();
    filter = null;
    volume?.dispose();
    volume = null;
  }

  async function ensureGraph(patch: PlanetRadioPatch): Promise<void> {
    await Tone.start();
    disposeGraph();
    volume = new Tone.Volume(0).toDestination();
    filter = new Tone.Filter({
      frequency: patch.filterHz,
      type: "lowpass",
      Q: 0.7,
    }).connect(volume);
    delay = new Tone.FeedbackDelay({
      delayTime: patch.delayTime,
      feedback: 0.28,
      wet: 0.22,
    }).connect(filter);
    synth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: patch.waveform },
      envelope: { attack: 0.08, decay: 0.3, sustain: 0.2, release: 1.4 },
      volume: patch.volumeDb,
    }).connect(delay);
    Tone.getTransport().bpm.value = patch.bpm;
    let step = 0;
    loop = new Tone.Loop((time) => {
      if (synth === null) return;
      const midi = patch.notes[step % patch.notes.length]!;
      synth.triggerAttackRelease(
        midiToFrequency(midi),
        "8n",
        time,
        0.18,
      );
      step += 1;
    }, "4n");
    loop.start(0);
    if (Tone.getTransport().state !== "started") {
      Tone.getTransport().start();
    }
    applyGain();
  }

  return {
    async prepare() {
      await Tone.start();
    },
    async start(patch) {
      await ensureGraph(patch);
    },
    stop() {
      disposeGraph();
    },
    setMuted(next) {
      muted = next;
      applyGain();
    },
    setDucked(next) {
      ducked = next;
      applyGain();
    },
  };
}

export const PlanetRadio: RadioEngine = createRadioEngine();
