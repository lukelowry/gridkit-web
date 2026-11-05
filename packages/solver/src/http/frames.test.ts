import { expect, it, vi } from 'vitest';
import fixture from '../../test/stream.json';
import type { Reply, SummaryHeader } from '../protocol.js';
import { rowsReply, summaryReply } from './frames.js';

function body(bytes: Uint8Array, fragment = bytes.length) {
  let offset = 0;
  return new ReadableStream<Uint8Array>({ pull(controller) {
    if (offset === bytes.length) { controller.close(); return; }
    controller.enqueue(bytes.slice(offset, offset+fragment)); offset = Math.min(bytes.length, offset+fragment);
  } });
}
/** A reply: its length-prefixed header, then its planes. */
function reply(header: unknown, values = new Float64Array()) {
  const json = new TextEncoder().encode(JSON.stringify(header));
  const bytes = new Uint8Array(4+json.length+values.byteLength);
  new DataView(bytes.buffer).setUint32(0, json.length, true);
  bytes.set(json, 4); bytes.set(new Uint8Array(values.buffer), 4+json.length);
  return bytes;
}
const answer = (bytes: Uint8Array, fragment?: number) => new Response(body(bytes, fragment));
const decoded = (text: string) => Uint8Array.from(Buffer.from(text, 'base64'));
const revision = { rows: 2, state: 'completed', range: [0, 1] };
async function partsOf(reply: Reply<unknown>) {
  const parts: ArrayBuffer[] = [];
  for await (const part of reply.parts) parts.push(part);
  return parts;
}

it('reads what the solver writes, across fragmented transport reads', async () => {
  const rows = await rowsReply(answer(decoded(fixture.replies.rows), 3), { columns: fixture.columns, from: 0, maxBytes: 4096 });
  expect(rows.header).toMatchObject({ rows: 2, state: 'completed', range: [0, 1], first: 0, count: 2 });
  const [planes] = await partsOf(rows);
  expect([...new Float64Array(planes!, 0, 2)]).toEqual(fixture.rows.map(row => row[0]));
  expect([...new Float64Array(planes!, 16, 2)]).toEqual(fixture.rows.map(row => row[1]));

  const summary = await summaryReply(answer(decoded(fixture.replies.summary), 3), { columns: fixture.columns, range: null, resolution: 100, maxBytes: 4096 });
  expect(summary.header).toMatchObject({ rows: 2, state: 'completed', reset: true, cursor: { level: 0, first: 0, sealed: 2 } });
  expect(summary.header.tiles.map(tile => [tile.target, tile.level, tile.first])).toEqual([['history', 0, 0]]);
  const [tile] = await partsOf(summary);
  expect([...new Float64Array(tile!, 16, 2)]).toEqual(fixture.rows.map(row => row[1]));
});

it('reads an envelope\'s planes in turn, as tiles arrive', async () => {
  const tiles = [{ target: 'history', kind: 'envelope', level: 1, first: 0, rows: 2 }, { target: 'edge', kind: 'samples', level: 0, first: 16, rows: 1 }];
  const summary = await summaryReply(answer(reply({ ...revision, reset: false, cursor: { level: 1, first: 0, sealed: 16 }, tiles },
    Float64Array.of(0, 8, 7, 15, 1, 2, 3, 4, 16, 5)), 5), { columns: ['v'], range: null, resolution: 10, maxBytes: 4096 });
  const [envelope, samples] = (await partsOf(summary)).map(part => [...new Float64Array(part)]);
  expect(envelope).toEqual([0, 8, 7, 15, 1, 2, 3, 4]);
  expect(samples).toEqual([16, 5]);
});

it('refuses a truncated reply, an unreadable header, and more than it asked for, before holding it', async () => {
  const whole = reply({ ...revision, first: 0, count: 2 }, Float64Array.of(0, 1, 10, 20));
  const read = (bytes: Uint8Array, maxBytes = 4096) => rowsReply(answer(bytes), { columns: ['v'], from: 0, maxBytes });
  await expect(read(whole.slice(0, -1))).rejects.toMatchObject({ code: 'protocol' });
  await expect(read(new Uint8Array(4))).rejects.toMatchObject({ code: 'protocol' });
  await expect(read(whole, 16)).rejects.toMatchObject({ code: 'protocol' });
  const broken = new Uint8Array(8); new DataView(broken.buffer).setUint32(0, 4, true); broken.set([123, 123, 123, 123], 4);
  await expect(read(broken)).rejects.toMatchObject({ code: 'protocol' });
  await expect(read(whole.slice(0, 2))).rejects.toMatchObject({ code: 'protocol' });
});

it('stops a summary\'s body when its reader leaves between tiles', async () => {
  const cancelled = vi.fn(), tiles = [0, 1].map(first => ({ target: 'edge', kind: 'samples', level: 0, first, rows: 1 }));
  const stream = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(reply({ ...revision, reset: true, cursor: { level: 0, first: 0, sealed: 0 }, tiles }, Float64Array.of(0, 1))); },
    cancel: cancelled,
  });
  const summary: Reply<SummaryHeader> = await summaryReply(new Response(stream), { columns: ['v'], range: null, resolution: 10, maxBytes: 4096 });
  const parts = (summary.parts as AsyncIterable<ArrayBuffer>)[Symbol.asyncIterator]();
  expect([...new Float64Array((await parts.next()).value as ArrayBuffer)]).toEqual([0, 1]);
  await parts.return!();
  expect(cancelled).toHaveBeenCalledOnce();
});
