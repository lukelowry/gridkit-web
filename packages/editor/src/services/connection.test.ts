import { afterEach, expect, it, vi } from 'vitest';
import { Connection } from './connection.svelte.js';

afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

it('stops scheduled retries and recovery when disposed', async () => {
  vi.useFakeTimers();
  const open = vi.fn<() => Promise<object | null>>().mockRejectedValue(new Error('Offline'));
  const service = new Connection(open);
  await service.connect();
  service.dispose();
  service.recover();
  await service.connect();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(open).toHaveBeenCalledOnce();
  expect(service.status).toBe('absent');
});

it('aborts a pending connection without scheduling another attempt', async () => {
  vi.useFakeTimers();
  let signal: AbortSignal | undefined;
  const open = vi.fn((next: AbortSignal) => {
    signal = next;
    return new Promise<object>((_, reject) => next.addEventListener('abort', () => reject(next.reason), { once: true }));
  });
  const service = new Connection(open), pending = service.connect();
  service.dispose();
  await pending;
  await vi.advanceTimersByTimeAsync(60_000);
  expect(signal?.aborted).toBe(true);
  expect(service.pending).toBe(false);
  expect(service.error).toBe('');
  expect(open).toHaveBeenCalledOnce();
});

it('releases a service that connects after disposal without publishing it', async () => {
  let resolve!: (value: object) => void;
  const result = new Promise<object>(done => { resolve = done; }), release = vi.fn();
  const service = new Connection(() => result, release), pending = service.connect();
  service.dispose();
  const value = {};
  resolve(value);
  await pending;
  service.dispose();
  expect(service.value).toBeNull();
  expect(release).toHaveBeenCalledExactlyOnceWith(value);
});

it('releases an established service once and never opens a duplicate connection', async () => {
  const value = {}, release = vi.fn(), open = vi.fn(async () => value);
  const service = new Connection(open, release);
  await service.connect();
  await service.connect();
  service.dispose();
  service.dispose();
  expect(open).toHaveBeenCalledOnce();
  expect(release).toHaveBeenCalledExactlyOnceWith(value);
  expect(service.value).toBeNull();
});

it('retries a failed connection, waiting longer each time, until it answers', async () => {
  vi.useFakeTimers();
  const unreachable = new Error('Cannot reach the solver service at http://127.0.0.1:8081.');
  const open = vi.fn<() => Promise<object | null>>().mockRejectedValue(unreachable);
  const service = new Connection(open);
  expect(service.status).toBe('connecting');
  await service.connect();
  expect(service.status).toBe('unreachable');
  expect(service.error).toBe(unreachable.message);
  await vi.advanceTimersByTimeAsync(2_000);
  expect(open).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(3_999);
  expect(open).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(1);
  expect(open).toHaveBeenCalledTimes(3);
  // Coming back to the editor asks at once; once answering, nothing more is asked.
  open.mockResolvedValue({});
  service.recover();
  await vi.waitFor(() => expect(service.status).toBe('ready'));
  expect(service.error).toBe('');
  service.recover();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(open).toHaveBeenCalledTimes(4);
});

it('leaves a service there is none of alone until the editor is shown again, so one started later appears', async () => {
  vi.useFakeTimers();
  const open = vi.fn<() => Promise<object | null>>().mockResolvedValue(null);
  const service = new Connection(open);
  await service.connect();
  expect(service.status).toBe('absent');
  await vi.advanceTimersByTimeAsync(60_000);
  expect(open).toHaveBeenCalledOnce();
  open.mockResolvedValue({});
  service.recover();
  await vi.waitFor(() => expect(service.status).toBe('ready'));
});
