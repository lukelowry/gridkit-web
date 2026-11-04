import { serializeCaseRow, type Bus, type Device } from '../case.js';
import { writePorts } from '../connections.js';
import type { CaseDocument } from '../document.js';
import { recordedOutputs } from './channels.js';
import type { Channel, Compiled, Study } from './index.js';

export function compile(document: CaseDocument, study: Study): Compiled {
  const { header, params } = document.info;
  const rows = { buses: document.rows('buses'), devices: document.rows('devices'), signals: document.rows('signals') };
  const numbers = new Map([...rows.buses, ...rows.signals].map(row => [row.ref.id, document.number(row.ref)]));
  const channels: Channel[] = [];
  const parts = [`{"header":${JSON.stringify(header)},"params":${JSON.stringify(params)}`];
  for (const collection of ['buses', 'devices', 'signals'] as const) {
    parts.push(`,"${collection}":[`);
    rows[collection].forEach((row, index) => {
      if (index) parts.push(',');
      const value: Record<string, unknown> = { ...writePorts(row, connection => typeof connection === 'number' ? connection : numbers.get(connection.id)!) };
      if (collection === 'signals') { parts.push(JSON.stringify(value)); return; }
      const label = String(collection === 'buses' ? value.number : value.id);
      if (/[,\r\n]/.test(label)) throw new Error(`GridKit cannot record ${label}: identifiers cannot contain commas or newlines.`);
      // GridKit labels bus columns by name, which need not be unique (WECC240 repeats names); the number is.
      if (collection === 'buses') value.name = label;
      const outputs = [...recordedOutputs(row)].sort((a, b) => a.id < b.id ? -1 : 1);
      value.mon = outputs.map(output => output.id);
      // GridKit writes every bus class's columns under Bus.
      const scope = collection === 'buses' ? 'Bus' : String(value.class);
      for (const { id, unit } of outputs) channels.push({ column: `${scope}_${label}_${id}`, element: row.ref, output: id, unit: unit ?? '', class: String(value.class), label });
      parts.push(serializeCaseRow(value as unknown as Bus | Device));
    });
    parts.push(']');
  }
  parts.push('}');
  if (new Set(channels.map(channel => channel.column)).size !== channels.length) throw new Error('GridKit cannot record two elements under one identifier.');
  // GridKit hands max_steps to IDA, whose 0 means its own 500 steps between outputs: unless the study limits it, IDA takes what it needs.
  const settings: Study = { rel_tol: 1e-5, abs_tol: 1e-5, max_steps: Number.MAX_SAFE_INTEGER, events: [], ...structuredClone(study) };
  return { study: settings, model: new Blob(parts, { type: 'application/json' }), channels };
}
