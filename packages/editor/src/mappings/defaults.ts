import type { ColormapNode, CustomColormap, ScaleNode, Size, Theme, Scene } from 'latkit';
import { elementCatalog, portsOf, record, type CaseDocument, type ElementTarget, type FieldInfo, type Position, type SavedViews, type Space } from '@gridkit/library';
import type { Preferences } from '../preferences/definitions.js';
import { isDark, rgbOf } from '../ui/color.js';
import { defaultMarks, mergeTheme, recognize, type MarkDefinition } from '../domain/views.js';
import { resolveMappings } from './resolve.js';
import { untrack } from 'svelte';
import { defaultBand, fieldOf, readings, type Measure } from '../domain/measure.js';

/**
 * The palette of voltage levels, cool to hot: below 100 kV, 115–161, 230, 345, 500, and 765 kV. A level starts at each of
 * `voltageLevels`' kV, and each color keeps 4.5:1 on its ground; the scene picks the set for the view's background.
 */
export const voltageDomain = [60, 800] as const;
const voltageLevels = [100, 200, 300, 450, 700];
const voltageColors = {
  dark: ['#7e8ea2', '#56b4e1', '#56d4d5', '#fec348', '#fb9d62', '#fdedc9'],
  light: ['#5c6777', '#185e9c', '#076f70', '#915c08', '#ae390c', '#860f27'],
};
/** The voltage palette for a dark or a light ground, a band of one color per level across `voltageDomain`. */
export function voltagePalette(dark: boolean): CustomColormap {
  const [low, high] = voltageDomain, place = (kv: number) => (kv - low) / (high - low);
  const edges = [0, ...voltageLevels.map(place), 1];
  return { kind: 'sequential', colors: voltageColors[dark ? 'dark' : 'light'].flatMap((color, level): [number, string][] =>
    [[edges[level]!, color], [edges[level + 1]!, color]]) };
}

/** What a measure spans: as recorded, its own domain, every recorded value without one; a deviation, a band around no change. */
function measureDomain(measure: Measure, band?: number | null, recorded = readings[measure.output]?.domain): [number, number] | 'all' {
  if (measure.basis === 'value') return recorded ?? 'all';
  const reach = band ?? defaultBand(measure);
  return [-reach, reach];
}
/** A bus's color for `measure`: a deviation always on a diverging map, no change at its middle. */
export function measureColor(measure: Measure, band?: number | null): ColormapNode {
  return { colormap: measure.basis === 'value' ? readings[measure.output]?.map ?? 'viridis' : 'rdbu',
    value: `$simulation.${fieldOf(measure)}`, domain: measureDomain(measure, band) };
}
/** How high a bus stands for `measure`, up to `height`. */
export function measureHeight(measure: Measure, height: number, band?: number | null): ScaleNode {
  return { scale: [0, height], value: `$simulation.${fieldOf(measure)}`, domain: measureDomain(measure, band, readings[measure.output]?.height) };
}

/**
 * A network's extent, branch spacing, and height in position units: plane units or degrees of arc.
 * A drawing whose case places every bus needs no layout.
 */
export interface Drawing { readonly extent: number; readonly spacing: number; readonly height: number; readonly placed: boolean }
// Quarter steps of a doubling: a drawing's measures, and the scene sized by them, change only when it does by a fifth.
const stepped = (value: number) => 2 ** (Math.round(Math.log2(value) * 4) / 4);
// Units between the buses latkit's stress layout places, which places those the case does not.
const stressGap = 40;

// Each imported document has fixed bus placement and connections.
const drawings = new WeakMap<CaseDocument, Map<string, Drawing>>();
/**
 * The network drawing of `document`'s buses where `space` places them: its larger side, and the median length of up to
 * 512 of its branches, or without any the room a bus has. A case placing fewer than two is laid out by latkit.
 */
export function drawingOf(document: CaseDocument, space: 'network' | 'geographic'): Drawing {
  const kept = drawings.get(document)?.get(space);
  if (kept) return kept;
  // Read every row only once per document and space.
  const drawing = untrack(() => measure(document, space));
  (drawings.get(document) ?? drawings.set(document, new Map()).get(document)!).set(space, drawing);
  return drawing;
}
function measure(document: CaseDocument, space: 'network' | 'geographic'): Drawing {
  const places = new Map<string, Position>(), buses = document.rows('buses');
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const row of buses) {
    const at = row.placement[space];
    if (!at) continue;
    places.set(row.ref.id, at);
    [x0, y0, x1, y1] = [Math.min(x0, at[0]), Math.min(y0, at[1]), Math.max(x1, at[0]), Math.max(y1, at[1])];
  }
  const placed = places.size === buses.length;
  // A lone positioned bus has no branch spacing or elevation range; draw its marker in pixels.
  if (placed && places.size === 1) return { extent: 0, spacing: 0, height: 0, placed };
  const sized = (extent: number, spacing: number): Drawing => {
    extent = stepped(extent);
    return { extent, spacing: stepped(spacing), height: extent * 0.15, placed };
  };
  if (places.size < 2) return sized(stressGap * Math.sqrt(Math.max(buses.length, 1)), stressGap);
  const branches = document.rows('devices').filter(row => elementCatalog.get(String(row.value.class))?.model.ends);
  const every = Math.max(1, Math.floor(branches.length / 512)), lengths: number[] = [];
  for (let index = 0; index < branches.length; index += every) {
    const row = branches[index]!, [a, b] = elementCatalog.get(String(row.value.class))!.model.ends!.map(port => {
      const bus = portsOf(row)[port];
      return typeof bus === 'object' ? places.get(bus.id) : undefined;
    });
    const length = a && b ? Math.hypot(b[0] - a[0], b[1] - a[1]) : 0;
    if (length > 0) lengths.push(length);
  }
  lengths.sort((p, q) => p - q);
  const extent = Math.max(x1 - x0, y1 - y0);
  return sized(extent, lengths[lengths.length >> 1] ?? extent / Math.sqrt(places.size));
}
/**
 * A network's marker radius and stroke width: in the drawing's lengths, so zoomed out markers shrink to stay a quarter
 * of a branch apart, and strokes with them, down to `least` (or a third of the stroke); never past the theme's.
 */
export function fittedSizes(drawing: Drawing | undefined, theme: SceneTheme, least: number): { radius?: Size; width?: Size } {
  const radius = theme.vertex?.radius ?? 5, width = theme.edge?.width ?? 1.5;
  if (!drawing?.spacing) return {};
  return {
    radius: { units: drawing.spacing / 4, atLeast: Math.min(least, radius), atMost: radius },
    width: { units: drawing.spacing * 3 / 40, atLeast: width / 3, atMost: width },
  };
}

/** Theme colors as CSS; the views normalize them for contrast calculations, and the mapping editor names them as tokens. */
export interface Palette { background: string; vertex: string; line: string; text: string; grid: string; surface: string; hover: string; selected: string }
const tokens: Palette = {
  background: 'var(--color-bg)', vertex: 'var(--color-primary-text)', line: 'var(--color-graph-line)', text: 'var(--color-text-1)', grid: 'var(--color-graph-grid)',
  surface: 'var(--color-surface-2)', hover: 'var(--color-graph-hover)', selected: 'var(--color-graph-selection)',
};
export type SceneTheme = Exclude<Theme, string>;

/** Shared UI tokens translated into the network's rendering theme. */
export function networkTheme(v: Preferences, palette: Palette = tokens, base: 'light' | 'dark' = 'light'): SceneTheme {
  return {
    base, background: v.networkBackground || palette.background,
    vertex: { color: palette.vertex, radius: 5 }, edge: { color: null, width: 1.5 },
    line: { color: palette.line }, missing: '#808080', grid: v.networkGridColor || palette.grid, gridSpacing: v.networkGridSpacing,
    text: { color: v.networkTextColor || palette.text,
      font: `${v.networkFont || 'IBM Plex Sans'}, system-ui, sans-serif`, size: v.networkFontSize,
      halo: v.networkLabelHalo },
    focus: { hover: v.hoverColor || palette.hover, selected: v.selectionColor || palette.selected, glow: v.hoverWidth, dim: v.unselectedAlpha,
      grow: v.hoverScale },
    earth: { ground: palette.surface }, dash: v.dashPeriod,
  };
}
/** Whether `space` places positions on the earth, as a map or a globe. */
export const earthSpace = (space: unknown) => space === 'earth' || record(space)?.earth !== undefined;
/** The native position fields for a coordinate space. */
export const positionOf = (space: Space): [string, string] => space === 'geographic'
  ? ['$placement.geographic.longitude', '$placement.geographic.latitude'] : ['$placement.network.x', '$placement.network.y'];
/** The placement a network position reads, or `null` for any other mapping. */
export function placementOf(position: unknown): Space | null {
  if (!Array.isArray(position) || position.length !== 2) return null;
  const pair = position.map(value => recognize(value));
  if (pair.some(value => value.kind !== 'field')) return null;
  for (const space of ['network', 'geographic'] as const) {
    const axes = space === 'geographic' ? ['longitude', 'latitude'] : ['x', 'y'];
    if (pair.every((value, index) => value.kind === 'field' && value.field === `placement.${space}.${axes[index]}`)) return space;
  }
  return null;
}

export interface MappingSource {
  readonly simulation?: boolean;
  readonly targets: readonly ElementTarget[];
  readonly geographic: boolean;
  /** The network drawing, which sizes markers, strokes, and heights. */
  readonly drawing?: Drawing | undefined;
  /** What buses show while results play, and how far a deviation's colors reach. */
  readonly measure?: Measure | undefined;
  readonly band?: number | null | undefined;
  fields(target: ElementTarget): readonly FieldInfo[];
}

/** The coordinate space after browser and case inheritance, shared by scene sizing and the mapping editor. */
export function networkSpace(geographic: boolean, userDefaults: SavedViews = {}, caseOverrides: SavedViews = {}): NonNullable<Scene['space']> {
  return (record(caseOverrides.network)?.space ?? record(userDefaults.network)?.space
    ?? (geographic ? { earth: { projection: 'mercator' } } : 'plane')) as NonNullable<Scene['space']>;
}

export function resolveNetwork({ source, preferences: v, theme = networkTheme(v), userDefaults = {}, caseOverrides = {} }: {
  source: MappingSource; preferences: Preferences; theme?: SceneTheme;
  userDefaults?: SavedViews; caseOverrides?: SavedViews;
}) {
  const space = networkSpace(source.geographic, userDefaults, caseOverrides);
  const catalog = defaultMarks(source.targets);
  const resolved = resolveMappings(catalog, userDefaults.network, caseOverrides.network, target => source.fields(target), !!source.simulation);
  const measure = source.measure ?? { output: 'Vm', basis: 'value' as const };
  theme = mergeTheme(theme, resolved.theme);
  const position = positionOf(earthSpace(space) ? 'geographic' : 'network');
  const { radius, width } = fittedSizes(source.drawing, theme, v.networkMinRadius);
  const height = source.drawing?.height ?? 0;
  const background = String(theme.background), dark = rgbOf(background) ? isDark(background) : theme.base === 'dark';
  const level: ColormapNode = { colormap: voltagePalette(dark), value: '$params.kv', domain: [...voltageDomain] };
  const byId = new Map(catalog.map(mark => [mark.id, mark]));
  const marks = resolved.marks.map((mark): MarkDefinition => {
    const base = byId.get(mark.id);
    if (!base || base.kind !== mark.kind || base.target.collection !== mark.target.collection
      || (base.target.class !== undefined && base.target.class !== mark.target.class)) return mark;
    const kv = mark.target.collection === 'buses' && source.fields(mark.target).some(field => field.id === 'params.kv' && field.kind === 'number');
    // Network buses are colored by voltage level and stand as high as their kV; where they overlap, the higher kV draws on top.
    return mark.kind === 'vertices' ? { ...mark, options: {
      position,
      marker: 'ellipse', ...radius ? { radius } : {},
      ...kv ? { color: level, priority: '$params.kv', ...height ? { elevation: { scale: [0, height], value: '$params.kv' } } : {} } : {},
      // While results play, a bus shows the plot's measure in the flat view too: voltage sags red below 1 p.u. and rises blue
      // above, and a deviation does either way from no change.
      ...(source.simulation && mark.target.collection === 'buses' && source.fields(mark.target).some(field => field.id === `simulation.${measure.output}`) ? {
        color: measureColor(measure, source.band),
        elevation: measureHeight(measure, height || (earthSpace(space) ? 0.01 : 20), source.band),
      } : {}),
      label: null, ...mark.options,
    } } : { ...mark, options: { label: null, dash: false, ...width ? { width } : {}, ...mark.options } };
  });
  return { ...resolved, marks, space, theme };
}

/** What a mark draws with before its own mappings: a `null` edge color blends its ends' colors. */
export function effectiveOptions(mark: MarkDefinition | undefined, theme: SceneTheme): Record<string, unknown> {
  if (!mark) return {};
  return {
    color: mark.kind === 'vertices' ? theme.vertex?.color : theme.edge?.color,
    ...(mark.kind === 'vertices' ? { radius: theme.vertex?.radius, elevation: 0 } : { width: theme.edge?.width }),
    visible: true, ...mark.options,
  };
}
