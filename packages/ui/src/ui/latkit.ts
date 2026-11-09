import { Gpu, type Gestures } from 'latkit';

let loading: Promise<Gpu> | undefined;

/**
 * The page's GPU, which every view draws with: latkit downloads its shaders while its WebAssembly compiles, then makes
 * the WebGL2 device, and moves the views to a new one when it is lost. A failed load is tried again on the next call.
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
export const gesturesOf = (wheel: 'wheel' | 'modifier'): Gestures => ({
  twist: 'turn', slide: 'tilt',
  ...wheel === 'modifier' && { wheel: 'pan', 'control+wheel': 'zoom', 'meta+wheel': 'zoom' },
});
