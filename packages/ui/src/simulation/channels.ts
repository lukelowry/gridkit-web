import type { Channel } from '@gridkit/library/gridkit';
import type { ElementRef } from '@gridkit/library';

/** How many elements a plot keeps pinned for comparison. */
export const pinnedSeriesLimit = 64;

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

const indexed = new WeakMap<Quantity, ReadonlyMap<string, readonly Channel[]>>();
/** Selection changes look up their channels without scanning a large quantity again. */
export function channelsOf(quantity: Quantity, elements: readonly ElementRef[]): readonly Channel[] {
  let index = indexed.get(quantity);
  if (!index) {
    const built = new Map<string, Channel[]>();
    for (const channel of quantity.channels) {
      let group = built.get(channel.element.id);
      if (!group) built.set(channel.element.id, group = []);
      group.push(channel);
    }
    indexed.set(quantity, index = built);
  }
  const ids = new Set<string>();
  return elements.flatMap(element => {
    if (ids.has(element.id)) return [];
    ids.add(element.id);
    return (index.get(element.id) ?? []).filter(channel => channel.element.collection === element.collection);
  });
}

/**
 * What an output measures. A branch's power and current are what it delivers into the bus at its from end (1) or its to end (2),
 * so its power into the to bus is positive while power flows from its from bus to its to bus.
 */
const outputNames: Readonly<Record<string, string>> = {
  Vm: 'Voltage magnitude', Va: 'Voltage angle', Vr: 'Real voltage', Vi: 'Imaginary voltage',
  omega: 'Speed', p: 'Real power', q: 'Reactive power', delta: 'Rotor angle',
  p1: 'Real power into from bus', q1: 'Reactive power into from bus', im1: 'Current magnitude at from bus',
  ir1: 'Real current into from bus', ii1: 'Imaginary current into from bus',
  p2: 'Real power into to bus', q2: 'Reactive power into to bus', im2: 'Current magnitude at to bus',
  ir2: 'Real current into to bus', ii2: 'Imaginary current into to bus',
};
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
