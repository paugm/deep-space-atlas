/**
 * Land / launch cinematics: the 3D sequence (ship departure or cockpit
 * ascent) plays uncovered for a hold, then a quick fade to black delivers the
 * hard cut. Space is black, so both transitions cut through black. It owns its
 * own DOM so mode transitions stay independent from the game HUD.
 */

import { Sound } from "../audio.ts";
import {
  LANDING_FADE_MS,
  LANDING_HOLD_MS,
  LAUNCH_FADE_MS,
  LAUNCH_HOLD_MS,
} from "./cinematic-math.ts";

const CLEAR_MS = 900;
/** Near-black matching the space scene background. */
const FADE_COLOR = "#02050a";

export interface Cinema {
  playLand(): Promise<void>;
  playLaunch(): Promise<void>;
  clear(): void;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}

export function createCinema(): Cinema {
  const overlay = document.createElement("div");
  overlay.id = "cinema";
  overlay.style.background = FADE_COLOR;
  document.body.append(overlay);

  async function holdThenFade(
    holdMs: number,
    fadeMs: number,
  ): Promise<void> {
    Sound.burst(0.3, 900, (holdMs + fadeMs) / 1000, 0.6);
    await wait(holdMs);
    overlay.style.transitionDuration = `${fadeMs}ms`;
    // Force a style flush so the transition starts from opacity 0.
    void overlay.offsetWidth;
    overlay.classList.add("opaque");
    await wait(fadeMs);
  }

  return {
    playLand(): Promise<void> {
      return holdThenFade(LANDING_HOLD_MS, LANDING_FADE_MS);
    },
    playLaunch(): Promise<void> {
      return holdThenFade(LAUNCH_HOLD_MS, LAUNCH_FADE_MS);
    },
    clear(): void {
      overlay.style.transitionDuration = `${CLEAR_MS}ms`;
      overlay.classList.remove("opaque");
    },
  };
}
