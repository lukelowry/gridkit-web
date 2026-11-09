import { beforeEach, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('latkit', () => ({ Gpu: { create: mocks.create } }));

beforeEach(() => {
  vi.resetModules();
  mocks.create.mockReset();
});

test('concurrent views share one device, and a failed request can be retried', async () => {
  const gpu = {};
  mocks.create.mockRejectedValueOnce(new Error('unavailable')).mockResolvedValueOnce(gpu);
  const { latkit } = await import('./latkit.js');
  await expect(latkit()).rejects.toThrow('unavailable');
  const [first, second] = await Promise.all([latkit(), latkit()]);
  expect(first).toBe(gpu);
  expect(second).toBe(gpu);
  expect(mocks.create).toHaveBeenCalledTimes(2);
});

test('a preload starts the load views share, and a failed one leaves the next view to try again', async () => {
  const gpu = {};
  mocks.create.mockRejectedValueOnce(new Error('unavailable')).mockResolvedValueOnce(gpu);
  const { latkit, preload } = await import('./latkit.js');
  preload();
  await vi.waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
  await expect(latkit()).resolves.toBe(gpu);
  preload();
  await expect(latkit()).resolves.toBe(gpu);
  expect(mocks.create).toHaveBeenCalledTimes(2);
});
