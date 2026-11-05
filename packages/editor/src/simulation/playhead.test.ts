import type { View } from 'latkit';
import { expect, it, vi } from 'vitest';
import { Playhead } from './playhead.svelte.js';

function setup(end = 10, running = false) {
  const listeners = new Set<(now: number) => void>();
  const gpu = { on: vi.fn((_type: 'frame', listener: (now: number) => void) => { listeners.add(listener); return () => listeners.delete(listener); }) };
  const view = (at = 0) => ({ at, gpu }) as unknown as View;
  const moved = vi.fn(), state = { end, running };
  const playhead = new Playhead({ moved, end: () => state.end, running: () => state.running });
  const frame = (now: number) => { for (const listener of [...listeners]) listener(now); };
  return { playhead, view, gpu, listeners, frame, moved, state };
}

it('sets every view it holds in the frame it advances, before they draw', () => {
  const { playhead, view, frame, moved } = setup(), network = view(), plot = view();
  playhead.attach(network); playhead.attach(plot);
  playhead.play();
  frame(1000);
  expect(playhead.time).toBe(0);
  frame(1050);
  expect(playhead.time).toBeCloseTo(0.05);
  // Inside the frame listener: not on a later reaction, which would draw a frame late.
  expect([network.at, plot.at]).toEqual([playhead.time, playhead.time]);
  expect(moved).toHaveBeenLastCalledWith(playhead.time);
});

it('plays at its speed, and a tab coming back continues rather than jumps', () => {
  const { playhead, view, frame } = setup();
  playhead.attach(view());
  playhead.speed = 2;
  playhead.play();
  frame(0); frame(50);
  expect(playhead.time).toBeCloseTo(0.1);
  frame(60_000);
  expect(playhead.time).toBeCloseTo(0.3);
});

it('stops at the end of a finished run, and waits there for one still recording', () => {
  const { playhead, view, frame, listeners, state } = setup(0.05, true);
  playhead.attach(view());
  playhead.play();
  frame(0); frame(100);
  expect(playhead.time).toBe(0.05);
  expect(playhead.playing).toBe(true);
  state.end = 0.1;
  frame(200);
  expect(playhead.time).toBe(0.1);
  state.running = false;
  frame(300);
  expect(playhead.playing).toBe(false);
  expect(listeners.size).toBe(0);
});

it('runs on a frame listener only while playing, starting once it has a view to take the GPU from', () => {
  const { playhead, view, gpu, listeners } = setup();
  playhead.play();
  expect(gpu.on).not.toHaveBeenCalled();
  const detach = playhead.attach(view());
  expect(listeners.size).toBe(1);
  playhead.pause();
  expect(listeners.size).toBe(0);
  playhead.play(); playhead.play();
  expect(gpu.on).toHaveBeenCalledTimes(2);
  playhead.pause();
  detach();
});

it('shows a time at once to a view it holds, not to one it has let go', () => {
  const { playhead, view, moved } = setup(), held = view(), gone = view(99);
  playhead.show(3);
  playhead.attach(held);
  expect(held.at).toBe(3);
  const detach = playhead.attach(gone);
  expect(gone.at).toBe(3);
  detach();
  playhead.show(4);
  expect([held.at, gone.at]).toEqual([4, 3]);
  moved.mockClear();
  playhead.show(4);
  expect(moved).not.toHaveBeenCalled();
});

it('releases the last GPU while detached and resumes without including time spent detached', () => {
  const { playhead, view, frame, listeners } = setup();
  const detach = playhead.attach(view()); playhead.play();
  frame(0); frame(50); detach();
  expect(listeners.size).toBe(0); expect(playhead.playing).toBe(true);
  frame(5000);
  playhead.attach(view()); frame(6000);
  expect(playhead.time).toBe(.05);
  frame(6050); expect(playhead.time).toBe(.1);
});
it('moves the clock subscription to a replacement GPU when its owner is removed', () => {
  const first = setup(), second = setup();
  const detach = first.playhead.attach(first.view());
  first.playhead.attach(second.view()); first.playhead.play();
  expect(first.listeners.size).toBe(1); expect(second.listeners.size).toBe(0);
  detach();
  expect(first.listeners.size).toBe(0); expect(second.listeners.size).toBe(1);
  first.frame(0); first.frame(50); expect(first.playhead.time).toBe(0);
  second.frame(100); second.frame(150); expect(first.playhead.time).toBe(.05);
  first.playhead.pause(); expect(second.listeners.size).toBe(0);
});
