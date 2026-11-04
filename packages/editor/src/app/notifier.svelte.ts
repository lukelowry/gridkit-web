/** A change that what reads it, under Svelte's reactivity, reads again on: for state kept outside runes. */
export class Notifier {
  #version = $state(0);
  track() { void this.#version; }
  notify() { this.#version++; }
}
