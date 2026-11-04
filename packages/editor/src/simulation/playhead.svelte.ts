import type { View } from 'latkit';

/** The longest step a frame advances: a tab coming back continues, it does not jump. */
const longestStep = 0.1;
/** The speeds time plays at, in playback and in videos. */
export const speeds = [0.25, 0.5, 1, 2, 4] as const;

export interface PlayheadOptions {
  /** Told of every time shown, in the frame it shows in. */
  moved(time: number): void;
  /** The last time there is to show. */
  end(): number;
  /** Whether more is still to come, which playback waits at the end for. */
  running(): boolean;
}

/**
 * The one time every view shows. Playing runs on the GPU's frame listener, before the views draw, so a time shows in the frame
 * it was set for: setting it anywhere later draws it a frame late, and draws only every other frame.
 */
export class Playhead {
  time = $state(0);
  playing = $state(false);
  speed = $state(1);
  #views = new Set<View>();
  #stop: (() => void) | undefined;
  #last: number | undefined;

  constructor(private options: PlayheadOptions) {}

  /** The views kept at this time. */
  get views(): ReadonlySet<View> { return this.#views; }
  /** Keeps `view` at this time until the function returned is called. */
  attach(view: View) {
    view.at = this.time;
    this.#views.add(view);
    this.#run();
    return () => { this.#views.delete(view); };
  }
  show(time: number) {
    if (time === this.time) return;
    this.time = time;
    this.options.moved(time);
    for (const view of this.#views) view.at = time;
  }
  play() { this.playing = true; this.#run(); }
  pause() {
    this.playing = false;
    this.#stop?.();
    this.#stop = undefined;
  }
  #run() {
    const [view] = this.#views;
    if (!this.playing || this.#stop || !view) return;
    this.#last = undefined;
    this.#stop = view.gpu.on('frame', now => this.#frame(now));
  }
  #frame(now: number) {
    const step = this.#last === undefined ? 0 : Math.min(longestStep, (now - this.#last) / 1000), end = this.options.end();
    this.#last = now;
    this.show(Math.min(end, this.time + step * this.speed));
    if (this.time >= end && !this.options.running()) this.pause();
  }
}
