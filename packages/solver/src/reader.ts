import type { ResultReader, RowsReply, SummaryReply } from './index.js';
import { envelopeOf, samplesOf } from './planes.js';
import type { RowsHeader, SummaryHeader } from './protocol.js';
import { Asker } from './reply.js';

export function reader(port: MessagePort): ResultReader {
  const asker = new Asker(port);
  return {
    async rows(query, signal): Promise<RowsReply> {
      const { header: { first, count, ...revision }, parts } = await asker.ask<RowsHeader>({ op: 'rows', query }, signal);
      let buffer = new ArrayBuffer(0);
      for await (const part of parts) buffer = part;
      return { ...revision, samples: samplesOf(buffer, first, count, query.columns) };
    },
    async summary(query, signal): Promise<SummaryReply> {
      const { header, parts } = await asker.ask<SummaryHeader>({ op: 'summary', query }, signal);
      return { ...header, async *pages() {
        let index = 0;
        for await (const buffer of parts) {
          const { target, kind, level, first, rows } = header.tiles[index++]!;
          yield { target, level, first, block: kind === 'samples' ? samplesOf(buffer, first, rows, query.columns) : envelopeOf(buffer, rows, query.columns) };
        }
      } };
    },
    close: () => asker.close(),
  };
}
