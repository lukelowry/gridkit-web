import { afterEach, expect, it, vi } from 'vitest';
import { Connection } from './connection.svelte.js';

afterEach(() => vi.useRealTimers());

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
