import { expect, it } from 'vitest';
import fixture from '../../test/stream.json';
import type { Reply } from '../protocol.js';
import { planesReply } from './frames.js';

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
  const count = fixture.rows.length, rows = await planesReply(answer(decoded(fixture.replies.rows), 3), { columns: fixture.columns, from: 0, maxBytes: 4096 });
  expect(rows.header).toMatchObject({ rows: count, state: 'completed', range: [0, count - 1], first: 0, count });
  const [planes] = await partsOf(rows);
  expect([...new Float64Array(planes!, 0, count)]).toEqual(fixture.rows.map(row => row[0]));
  expect([...new Float64Array(planes!, 8 * count, count)]).toEqual(fixture.rows.map(row => row[1]));

  // A coarse level's starts, ends, minima and maxima: its one whole bucket.
  const entries = await planesReply(answer(decoded(fixture.replies.entries), 3), { columns: fixture.columns, level: 1, first: 0, count: 2, maxBytes: 4096 });
  expect(entries.header).toMatchObject({ rows: count, first: 0, count: 1 });
  expect([...new Float64Array((await partsOf(entries))[0]!)]).toEqual([0, 7, 0.7, 1.3]);
});

it('refuses a truncated reply, an unreadable header, and more than it asked for, before holding it', async () => {
  const whole = reply({ ...revision, first: 0, count: 2 }, Float64Array.of(0, 1, 10, 20));
  const read = (bytes: Uint8Array, maxBytes = 4096) => planesReply(answer(bytes), { columns: ['v'], from: 0, maxBytes });
  await expect(read(whole.slice(0, -1))).rejects.toMatchObject({ code: 'protocol' });
  await expect(read(new Uint8Array(4))).rejects.toMatchObject({ code: 'protocol' });
  await expect(read(whole, 16)).rejects.toMatchObject({ code: 'protocol' });
  const broken = new Uint8Array(8); new DataView(broken.buffer).setUint32(0, 4, true); broken.set([123, 123, 123, 123], 4);
  await expect(read(broken)).rejects.toMatchObject({ code: 'protocol' });
  await expect(read(whole.slice(0, 2))).rejects.toMatchObject({ code: 'protocol' });
  // Two coarse entries are twice the bytes of two rows.
  await expect(planesReply(answer(reply({ ...revision, first: 0, count: 2 }, new Float64Array(8))), { columns: ['v'], level: 1, first: 0, count: 2, maxBytes: 63 }))
    .rejects.toMatchObject({ code: 'protocol' });
});
