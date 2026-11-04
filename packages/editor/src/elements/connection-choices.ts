import { elementCatalog, portsOf, type CaseDocument, type ConnectionEnd, type PortRef } from '@gridkit/library';
import type { Entry } from '../domain/entries.js';
import { entryChoices, type EntryChoices } from '../table/rows.js';

export type ConnectionChoices = EntryChoices<Entry & { connection: ConnectionEnd }>;
export function busChoices(entries: readonly Entry[]): ConnectionChoices {
  return entryChoices(entries.filter(row => row.collection === 'buses').map(row => ({ ...row, connection: { collection: row.collection, id: row.id } })));
}

export function signalChoices(entries: readonly Entry[], document: CaseDocument, from: PortRef): ConnectionChoices {
  const row = document.get(from.element);
  const current = row ? portsOf(row)[from.port] : undefined;
  return entryChoices(entries.flatMap<Entry & { connection: ConnectionEnd }>(row => {
    const element = { collection: row.collection, id: row.id };
    if (row.collection === 'signals') return (current && typeof current !== 'number' && current.id === row.id) || document.canConnect(from, element, from) ? [{ ...row, connection: element }] : [];
    return Object.entries(elementCatalog.get(row.class)?.ports ?? {}).flatMap(([port, definition]) => {
      const connection = { element, port };
      if (definition.target !== 'signals' || !document.canConnect(from, connection, from)) return [];
      return [{ ...row, id: JSON.stringify([row.id, port]), label: `${row.label} / ${definition.label}`, connection }];
    });
  }));
}

