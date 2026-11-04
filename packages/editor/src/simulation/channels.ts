import type { Channel } from '@gridkit/library/gridkit';

/** What a plot shows: the channels of one output of one scope, in one unit. */
export interface Quantity {
  readonly key: string;
  readonly label: string;
  /** The elements it covers, which group the choices. */
  readonly scope: string;
  readonly output: string;
  readonly unit: string;
  readonly channels: readonly Channel[];
}

/** What an output measures. */
const outputNames: Readonly<Record<string, string>> = { Vm: 'Voltage magnitude', Va: 'Voltage angle', omega: 'Speed' };
export const outputLabel = (output: string) => outputNames[output] ?? output;

/** A quantity never combines different units or bus/device scopes. */
export function quantitiesOf(channels: readonly Channel[]): Quantity[] {
  const quantities = new Map<string, Omit<Quantity, 'key' | 'channels'> & { channels: Channel[] }>();
  for (const channel of channels) {
    const { output, unit, element } = channel, key = JSON.stringify([element.collection, output, unit]);
    let quantity = quantities.get(key);
    if (!quantity) {
      quantity = { label: outputLabel(output), scope: element.collection === 'buses' ? 'Buses' : 'Devices', output, unit, channels: [] };
      quantities.set(key, quantity);
    }
    quantity.channels.push(channel);
  }
  return [...quantities].map(([key, quantity]) => ({ key, ...quantity }));
}
