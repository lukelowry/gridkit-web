import { field, when, type Expr, type ExprInput, type LatkitError, type Mark, type Scene } from 'latkit';
import { record, type CaseDocument, type SavedViews } from '@gridkit/library';
import { drawingOf, networkSpace, earthSpace, fittedSizes, resolveNetwork, networkTheme, type Palette } from '../mappings/defaults.js';
import { representation, type Diagnostic, type MarkDefinition } from '../domain/views.js';
import type { PreferencesState } from '../preferences/state.svelte.js';
import { legible, rgbOf } from '../ui/color.js';
import { gesturesOf } from '../ui/latkit.js';
import { dataset, tableOf } from './data.js';
import { branchStateTable } from '../simulation/branches.js';
import { simulationDataset, simulationFields, simulationOption, type SampledField } from '../simulation/sampled.js';
import type { Measure } from '../domain/measure.js';

/** The space a scene draws in, by name; the earth's by projection. */
export const spaceOf = (scene: Scene) => { const space = record(scene.space); return String(record(space?.earth)?.projection ?? (typeof scene.space === 'string' ? scene.space : Object.keys(space ?? {})[0])); };
/** A scene's theme, when it sets one beyond its base. */
export const themeOf = (scene: Scene) => typeof scene.theme === 'object' ? scene.theme : undefined;

/** The mapping behind a scene mark; `null` for the marks the editor adds, such as geography and poles. */
export interface SceneMark { readonly mark: MarkDefinition; readonly path: string }
export interface NetworkScene {
  readonly scene: Scene;
  /** One per scene mark, in order. */
  readonly entries: readonly (SceneMark | null)[];
  readonly diagnostics: readonly Diagnostic[];
}

/** Mapped options are plain JSON until latkit reads them as a mark. */
const markOf = (kind: 'vertices' | 'edges', table: string, options: Record<string, unknown>): Mark => kind === 'vertices'
  ? { vertices: [dataset, table], ...options } : { edges: [dataset, table], ...options };

/** The network scene: mappings over catalog structure, with geography, simulation and accessible contrast. */
export function networkScene({ document, preferences, palette, mappings, geographic, globe = false, simulation = false, sampled = [], measure, band, geography = [] }: {
  document: CaseDocument; preferences: PreferencesState; palette?: Palette; mappings: SavedViews; geographic: boolean;
  globe?: boolean; simulation?: boolean; sampled?: readonly SampledField[]; measure?: Measure | undefined; band?: number | null | undefined;
  /** The geography's tables, `[data, table]`, which draw as lines under the case. */
  geography?: readonly (readonly [data: string, table: string])[];
}): NetworkScene {
  const v = preferences.value, high = preferences.contrast === 'high';
  const theme = networkTheme(v, palette, preferences.theme);
  if (high) { theme.vertex = { ...theme.vertex, radius: 7 }; theme.edge = { ...theme.edge, width: 2.5 }; }
  const drawing = drawingOf(document, earthSpace(networkSpace(geographic, preferences.mappings, mappings)) ? 'geographic' : 'network');
  const resolved = resolveNetwork({ source: { targets: document.targets, geographic, drawing, simulation, measure, band, fields: simulationFields(document) },
    preferences: v, theme, userDefaults: preferences.mappings, caseOverrides: mappings });
  const grounds = [resolved.theme.background, resolved.theme.earth?.ground].filter(color => typeof color === 'string');
  const floor = high ? 7 : 4.5;
  const present = new Set(['Bus', 'Signal', ...document.targets.map(tableOf)]);
  const diagnostics: Diagnostic[] = [...resolved.diagnostics];
  // Marks draw in one order however the network is seen: from the ground up, its geography and poles, then each mapping in
  // its order, which by default has buses over the branches that meet them. Where depth varies, the nearest opaque row shows
  // whatever the order, so only translucent rows, such as those a selection dims, go by it, as they do seen flat.
  const marks: Mark[] = [], entries: (SceneMark | null)[] = [];
  for (const [data, table] of geography) {
    marks.push({ lines: [data, table], width: 1, pick: false });
    entries.push(null);
  }
  if (v.networkPoles) {
    const { width } = fittedSizes(drawing, resolved.theme, v.networkMinRadius);
    marks.push({ edges: [dataset, 'Bus'], poles: true, pick: false, ...width ? { width } : {} });
    entries.push(null);
  }
  for (const mark of resolved.marks) {
    const path = `network.marks.${mark.id}`, table = tableOf(mark.target), structure = representation(mark.target)?.[mark.kind];
    if (!table || !structure) { diagnostics.push({ path, code: 'unsupported', message: 'This class has no representation in this view.' }); continue; }
    if (!present.has(table)) continue; // A declared class may have no rows yet.
    const fallback: Record<string, ExprInput> = { elevation: 0, color: resolved.theme.missing ?? '#808080',
      radius: resolved.theme.vertex?.radius ?? 4, width: 1, visible: false, label: '' };
    const available = simulation && new Set(sampled.filter(field => field.collection === mark.target.collection &&
      (!mark.target.class || field.class === mark.target.class)).map(field => field.field));
    const options: Record<string, unknown> = Object.fromEntries(Object.entries(mark.options).map(([property, value]) =>
      [property, simulationOption(value, available, mark.target, fallback[property] ?? 0)]));
    const only = (rows: Expr) => (options.visible === undefined ? rows : rows.and(options.visible as ExprInput)).toJSON();
    // Bus classes share one table; a class's mark shows only its rows.
    if (table === 'Bus' && mark.target.class) options.visible = only(field('class').is(mark.target.class));
    const base = { name: mark.id, ...options, ...structure, pick: true, select: true };
    // While results play, a branch out of service draws dashed and muted in the same mark, so its hover and selection stay.
    // In service it keeps no color of its own, so it blends its ends' colors as it does without results.
    if (simulation && table === 'Branch' && mark.kind === 'edges') {
      const open = field('inService').from([simulationDataset, branchStateTable]).gt(0).not();
      const [r, g, b] = rgbOf(legible([String(resolved.theme.line?.color ?? '#808080')], grounds, floor)[0]!) ?? [128, 128, 128];
      Object.assign(base, { dash: open.or((options.dash ?? false) as ExprInput),
        color: when(open).then(`rgba(${r},${g},${b},0.7)`).otherwise((options.color ?? null) as ExprInput) });
    }
    marks.push(markOf(mark.kind, table, base));
    entries.push({ mark, path });
  }
  const missing = legible([String(resolved.theme.missing)], grounds, floor)[0]!;
  const scene: Scene = {
    space: earthSpace(resolved.space) ? { earth: { projection: globe ? 'globe' : 'mercator', graticule: v.networkGrid, atmosphere: v.networkAtmosphere } }
      : { plane: { grid: v.networkGrid ? { lines: { pitch: 10 } } : 'off' } },
    marks, theme: { ...resolved.theme, missing, contrast: floor },
    // A network lays out only the buses its case does not place.
    layout: drawing.placed ? 'none' : 'stress',
    controls: { gestures: gesturesOf(v.wheel), keyboard: v.keyboard,
      hover: v.hover, pickRadius: v.pickRadius, cycle: v.cycle, motion: preferences.motion === 'reduce' ? 'reduced' : 'full' },
    ease: simulation || preferences.motion === 'reduce' ? 0 : v.animationMs / 1000,
  };
  return { scene, entries, diagnostics };
}

const drawn = new WeakMap<NetworkScene, ReadonlySet<string>>();
/** The case tables `input` draws. */
export function tablesOf(input: NetworkScene): ReadonlySet<string> {
  let tables = drawn.get(input);
  if (!tables) drawn.set(input, tables = new Set(input.scene.marks?.flatMap(mark => {
    const [data, table] = ('vertices' in mark ? mark.vertices : 'edges' in mark ? mark.edges : 'lines' in mark ? mark.lines : 'areas' in mark ? mark.areas : mark.faces) as [string, string];
    return data === dataset ? [table] : [];
  })));
  return tables;
}

/** The mark a latkit path names, such as `marks[2].color` or `marks[2].label.text`, and its option; none for the whole mark. */
function pathOf(path: string | undefined): { index: number; option: string | undefined } | null {
  const match = /^(?:scene\.)?marks\[(\d+)\](?:\.(\w+))?/.exec(path ?? '');
  return match ? { index: Number(match[1]), option: match[2] } : null;
}

/** The mapping a latkit path names, and the mark it belongs to. */
function mapped(input: NetworkScene, path: string | undefined) {
  const at = pathOf(path), entry = at?.option === undefined ? null : input.entries[at.index];
  return entry && Object.hasOwn(entry.mark.options, at!.option!) ? { index: at!.index, option: at!.option!, entry } : null;
}

const reason = (message: string) => message.replace(/^[\w.[\]]+: /, '');

/**
 * Why latkit draws mappings of `input` as if unset: options it cannot read or use, and data they do not fit, such as a missing
 * field or one of another kind, named by the mapping where one is behind it. latkit draws them again once it can.
 */
export function failuresOf(input: NetworkScene, failures: readonly LatkitError[]): Diagnostic[] {
  return failures.map(failure => {
    const at = mapped(input, failure.path);
    return { path: at ? `${at.entry.path}.options.${at.option}` : failure.path ?? 'network', code: 'invalid', message: reason(failure.message) };
  });
}
