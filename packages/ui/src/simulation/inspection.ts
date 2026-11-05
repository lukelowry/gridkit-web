import type { ElementRef } from '@gridkit/library';
import type { Channel } from '@gridkit/library/gridkit';
import type { Row, Rows } from 'latkit';

const key = (ref: ElementRef) => JSON.stringify([ref.collection, ref.id]);
/** Plot rows are recording columns; interactions elsewhere name case elements. */
export class PlotElements {
  #columns = new Map<string, Channel>();
  #elements = new Map<string, Channel[]>();
  constructor(private data: string, channels: readonly Channel[]) {
    for (const channel of channels) {
      this.#columns.set(String(channel.column), channel);
      const id = key(channel.element), group = this.#elements.get(id) ?? [];
      group.push(channel); this.#elements.set(id, group);
    }
  }
  channel(row: Row | null) {
    return row?.data === this.data && row.table === 'Trace' ? this.#columns.get(String(row.id)) : undefined;
  }
  channels(ref: ElementRef | null): readonly Channel[] { return ref ? this.#elements.get(key(ref)) ?? [] : []; }
  rows(ref: ElementRef | null): Rows[] {
    const channels = this.channels(ref);
    return channels.length ? [{ data: this.data, table: 'Trace', ids: channels.map(channel => channel.column) }] : [];
  }
}
