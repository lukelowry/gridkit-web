import { colormaps, type Colormap, type ColormapKind, type ColormapName } from 'latkit';
import { colorHex, legible } from './color.js';

/** The ground and the contrast a view keeps its colormaps at: a preview has to show the colors the view draws. */
export interface ColorFit { readonly grounds: readonly string[]; readonly floor: number }

const catalog = () => colormaps() as readonly { name: ColormapName; label: string; kind: ColormapKind; colors: readonly [number, string][] }[];
const stopsOf = (map: Colormap) => typeof map === 'string' ? catalog().find(entry => entry.name === map)?.colors ?? [] : map.colors as readonly [number, string][];
export const paletteLabel = (map: Colormap) => typeof map === 'string' ? catalog().find(entry => entry.name === map)?.label ?? map : 'Custom palette';
const paletteKind = (map: Colormap) => typeof map === 'string' ? catalog().find(entry => entry.name === map)?.kind : map.kind;
export const diverges = (map: Colormap) => paletteKind(map) === 'diverging';

/** `map` as a CSS gradient of the colors a view fitted to `fit` draws. */
export function rampCss(map: Colormap, fit: ColorFit, direction = 'to right') {
  const stops = stopsOf(map), colors = legible(stops.map(([, color]) => colorHex(color) ?? color), fit.grounds, fit.floor);
  return `linear-gradient(${direction}, ${stops.map(([at], index) => `${colors[index]} ${at * 100}%`).join(', ')})`;
}

/** The palettes to choose from, those that suit first: a deviation reads best on a diverging map. A category has no ramp. */
export function palettes(deviating: boolean) {
  const kinds: readonly ColormapKind[] = deviating ? ['diverging', 'sequential', 'cyclic'] : ['sequential', 'diverging', 'cyclic'];
  return kinds.flatMap(kind => catalog().filter(entry => entry.kind === kind));
}

/** What a mark's color means while results play. */
export interface ColorScale { readonly name: string; readonly map: Colormap; readonly domain: [number, number] | null; readonly signed: boolean; readonly fit: ColorFit }
/** The values a scale names along its ramp, at their places: a diverging map's middle too. */
export function scaleTicks(map: Colormap, domain: [number, number] | null, signed: boolean) {
  if (!domain) return [{ at: 0, text: 'Least' }, { at: 1, text: 'Most' }];
  const [low, high] = domain, text = (value: number) => {
    const rounded = Number(value.toPrecision(3));
    return `${signed && rounded > 0 ? '+' : ''}${rounded}`;
  };
  return [{ at: 0, text: text(low) }, ...diverges(map) ? [{ at: 0.5, text: text((low + high) / 2) }] : [], { at: 1, text: text(high) }];
}
