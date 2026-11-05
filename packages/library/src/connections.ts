import type { ElementRef, Bus, Device, Signal } from './case.js';
import type { ElementRecord, Connection } from './document.js';
import { elementCatalog } from './catalog.js';

interface PortRef { readonly element: ElementRef; readonly port: string }

export const portsOf = (row: ElementRecord): Readonly<Record<string, Connection>> =>
  row.ref.collection === 'signals' ? {} : row.value.ports as Readonly<Record<string, Connection>>;

export function readPorts(value: Readonly<Record<string, unknown>>) {
  const { ports: flat, ...rest }: Record<string, unknown> = value;
  const ports = { ...(flat as Record<string, number> | undefined) };
  for (const [name, port] of Object.entries(elementCatalog.get(String(value.class))?.ports ?? {})) {
    const [group, key] = port.path;
    if (group === 'ports') continue;
    const fields = { ...(rest[group] as Record<string, number> | undefined) };
    if (Object.hasOwn(fields, key)) {
      if (!Number.isSafeInteger(fields[key])) throw new Error(`Invalid connection: ${value.class}.${name}.`);
      ports[name] = fields[key]!; delete fields[key];
    }
    if (Object.keys(fields).length) rest[group] = fields;
    else delete rest[group];
  }
  return { ...rest, ports };
}

export function writePorts(row: ElementRecord, number: (connection: Connection) => number) {
  if (row.ref.collection === 'signals') return row.value;
  const { ports: _ports, ...value }: Record<string, unknown> = row.value;
  if (row.ref.collection === 'devices') value.ports = {};
  for (const [name, connection] of Object.entries(portsOf(row))) {
    const [group, key] = elementCatalog.get(String(row.value.class))?.ports[name]?.path ?? ['ports', name];
    value[group] = { ...(value[group] as Record<string, number> | undefined), [key]: number(connection) };
  }
  return value as Bus | Device | Signal;
}

export function signalOutputs(rows: readonly ElementRecord[], signal: ElementRef): PortRef[] {
  return rows.flatMap(row => Object.entries(portsOf(row)).flatMap(([port, target]) =>
    typeof target !== 'number' && target.id === signal.id && elementCatalog.get(String(row.value.class))?.ports[port]?.output
      ? [{ element: row.ref, port }] : []));
}
