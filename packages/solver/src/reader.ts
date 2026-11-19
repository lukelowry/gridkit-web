import type { EntriesReply, ResultReader, RowsReply } from './index.js';
import { envelopeOf, samplesOf } from './planes.js';
import type { PlanesHeader } from './protocol.js';
import { Asker } from './reply.js';

export function reader(port: MessagePort): ResultReader {
  const asker = new Asker(port);
  /** The one part of a reply, and its header. */
  const read = async (question: Parameters<Asker['ask']>[0], signal?: AbortSignal) => {
    const { header, parts } = await asker.ask<PlanesHeader>(question, signal);
    let buffer = new ArrayBuffer(0);
    for await (const part of parts) buffer = part;
    return { header, buffer };
  };
  return {
    async rows(query, signal): Promise<RowsReply> {
      const { header: { first, count, ...revision }, buffer } = await read({ op: 'rows', query }, signal);
      return { ...revision, samples: samplesOf(buffer, first, count, query.columns) };
    },
    async entries(query, signal): Promise<EntriesReply> {
      const { header: { first, count, ...revision }, buffer } = await read({ op: 'entries', query }, signal);
      return { ...revision, block: query.level ? envelopeOf(buffer, count, query.columns) : samplesOf(buffer, first, count, query.columns) };
    },
    close: () => asker.close(),
  };
}
