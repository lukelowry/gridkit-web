import { Gpu, type Controls, type FocusTheme, type Gestures } from 'latkit';
import type { Preferences } from '../preferences/definitions.js';

let loading: Promise<Gpu> | undefined;

/**
 * The page's GPU, shared by every view. Its WebAssembly carries the shaders; jobs load their own module when needed.
 * Latkit moves views to a replacement device when it is lost. A failed load is tried again on the next call.
 */
export function latkit(): Promise<Gpu> {
  // Gpu.create also loads the runtime, with a bounded wait for both loading and the device.
  // Awaiting load() separately bypasses that timeout and can leave the page waiting forever.
  return loading ??= Gpu.create().catch((error: unknown) => {
    loading = undefined;
    throw error;
  });
}

/** Starts loading the GPU before a view asks for it, as when a case is chosen. A failure shows where a view asks. */
export function preload() { latkit().catch(() => {}); }

/**
 * What the pointer, wheel, and fingers do, over latkit's defaults (a drag pans, Shift or the secondary button turns, the wheel
 * and a pinch zoom): two fingers twist to turn and slide to tilt, which a plot takes as panning. With zoom on Ctrl
 * or Cmd, the wheel scrolls the view instead, as a trackpad does.
 */
const gesturesOf = (wheel: Preferences['wheel']): Gestures => ({
  twist: 'turn', slide: 'tilt',
  ...wheel === 'modifier' && { wheel: 'pan', 'control+wheel': 'zoom', 'meta+wheel': 'zoom' },
});

/**
 * How every view answers input, as Interaction's settings choose, and how often it draws while only time or its comets move; a
 * view adds the gestures of its own.
 */
export const controlsOf = (v: Preferences, motion: 'reduce' | 'full'): Exclude<Controls, string> => ({
  gestures: gesturesOf(v.wheel), keyboard: v.keyboard, hover: v.hover, pickRadius: v.pickRadius, cycle: v.cycle,
  motion: motion === 'reduce' ? 'reduced' : 'full', fps: Number(v.frameRate),
});

/** How every view shows what is hovered and selected, as Highlight's settings choose, in `palette` where they name no color. */
export const focusOf = (v: Preferences, palette: { readonly hover: string; readonly selected: string }): FocusTheme => ({
  hover: v.hoverColor || palette.hover, selected: v.selectionColor || palette.selected, glow: v.hoverWidth, dim: v.unselectedAlpha, grow: v.hoverScale,
});
