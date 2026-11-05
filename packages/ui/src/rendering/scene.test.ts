import { expect, it } from 'vitest';
import { field, when } from 'latkit';
import input from '../../../library/test/small.case.json';
import { CaseDocument, parseCase } from '@gridkit/library';
import { drawingOf, positionOf, resolveNetwork, voltagePalette } from '../mappings/defaults.js';
import { createPreferences, type PreferencesState } from '../preferences/state.svelte.js';
import { contrast, rgbOf } from '../ui/color.js';
import { isGeographic } from './data.js';
import { failuresOf, networkScene, type NetworkScene } from './scene.js';
import { defaultMarks } from '../domain/views.js';

const fixture = () => parseCase(JSON.stringify(input));
const bus = { mark: 'buses' } as const;
const target = { collection: 'buses', class: 'Bus' } as const;
const documentWith = (network: unknown) => new CaseDocument(parseCase(JSON.stringify({ ...input, $ui: { views: { network } } })));
const busMark = (options: unknown) => ({ id: 'buses', target, kind: 'vertices', options });
const scene = (document: CaseDocument, preferences: PreferencesState = createPreferences('{}')) =>
  networkScene({ document, preferences, mappings: document.views, geographic: isGeographic(document) });
const mark = (result: NetworkScene, id: string) =>
  result.scene.marks!.find(mark => mark.name === id) as unknown as Record<string, unknown> | undefined;
// The voltage palette on the light ground the theme's tokens resolve to without a palette.
const level = { colormap: voltagePalette(false), value: '$params.kv', domain: [60, 800] };


it('draws branches out of service dashed and muted in their own mark, under a mapped visibility', () => {
  const document = documentWith({ marks: defaultMarks().map(mark => mark.id === 'branches' ? { ...mark, options: { visible: field('params.R').gt(0) } } : mark) });
  const preferences = createPreferences('{}');
  const input = networkScene({ document, preferences, mappings: document.views, geographic: true, simulation: true });
  expect(input.scene.marks!.filter(mark => mark.name?.startsWith('branches'))).toHaveLength(1);
  const drawn = mark(input, 'branches')!, [dash, color] = [JSON.stringify(drawn.dash), JSON.stringify(drawn.color)];
  expect(dash).toContain('BranchState');
  expect(color).toContain('BranchState');
  expect(color).toMatch(/,0\.7\)/);
  // In service, a branch has no color of its own and keeps blending its ends' colors.
  expect(color).toContain('"otherwise":null');
  expect(JSON.stringify(drawn.visible)).not.toContain('BranchState');
  expect(JSON.stringify(drawn.visible)).toContain('params.R');
  expect(JSON.stringify(mark(scene(document), 'branches'))).not.toContain('BranchState');
});

it('draws mappings over the catalog structure, with preferences as theme, controls, and layout', () => {
  const document = new CaseDocument(fixture());
  const network = scene(document);
  expect(network.scene.space).toEqual({ earth: { projection: 'mercator', graticule: true, atmosphere: false } });
  expect(mark(network, 'buses')).toMatchObject({
    vertices: ['case', 'Bus'], position: ['$placement.geographic.longitude', '$placement.geographic.latitude'], color: level,
  });
  expect(mark(network, 'branches')).toMatchObject({ edges: ['case', 'Branch'], ends: ['ports.bus1', 'ports.bus2'] });
  expect(network.scene.theme).toMatchObject({ edge: { color: null } });
  expect(network.scene.theme).toHaveProperty('gridSpacing', 24);
  expect(network.scene.controls).toEqual({ gestures: { twist: 'turn', slide: 'tilt' }, keyboard: true, hover: true, pickRadius: 6, cycle: false, motion: 'full' });
  // With zoom on Ctrl or Cmd, the wheel scrolls the view, as a trackpad does.
  const modifier = scene(document, createPreferences(JSON.stringify({ wheel: 'modifier' })));
  expect(modifier.scene.controls).toMatchObject({ gestures: { wheel: 'pan', 'control+wheel': 'zoom', 'meta+wheel': 'zoom' } });

});

it('sizes the network in latkit\'s lengths, and orders overlapping buses by kV alongside layout', () => {
  const document = new CaseDocument(fixture());
  const network = scene(document), buses = mark(network, 'buses')!, drawing = drawingOf(document, 'geographic');
  // Geographic position lengths and elevation are degrees of arc.
  const branch = Math.hypot(0.1, 0.1);
  expect(Math.abs(Math.log2(drawing.spacing / branch))).toBeLessThanOrEqual(0.125);
  expect(buses).toMatchObject({ radius: { units: drawing.spacing / 4, atLeast: 1, atMost: 5 }, priority: '$params.kv' });
  expect(drawing.height).toBe(drawing.extent * 0.15);
  expect(drawingOf(document, 'geographic')).toBe(drawing);
  expect(network.scene.layout).toBe('none');
  // A bus the case does not place is laid out while the mark keeps its priority.
  const value = fixture();
  const unplaced = new CaseDocument({ ...value, buses: [...value.buses, { number: 3, class: 'Bus', name: 'Unplaced', params: {} }] });
  const laid = scene(unplaced);
  expect(laid.scene.layout).toBe('stress');
  expect(mark(laid, 'buses')).toHaveProperty('priority', '$params.kv');
});

it('draws a lone positioned bus in pixels without inventing a geographic branch spacing', () => {
  const value = fixture(), document = new CaseDocument({ ...value, buses: [value.buses[0]!], devices: [] });
  expect(drawingOf(document, 'geographic')).toEqual({ extent: 0, spacing: 0, height: 0, placed: true });
  expect(mark(scene(document), 'buses')).not.toHaveProperty('radius');
});



it('reports unsupported Network mark targets without losing supported marks', () => {
  const document = documentWith({ marks: [...defaultMarks(), { id: 'signal-edges', target: { collection: 'signals' }, kind: 'edges', options: {} }] });
  const network = scene(document);
  expect(network.scene.marks!.map(mark => mark.name)).toEqual(['branches', 'buses']);
  expect(network.diagnostics).toEqual([expect.objectContaining({ path: 'network.marks.signal-edges', code: 'unsupported' })]);
});

it('applies browser mappings and interaction preferences to the Network', () => {
  const document = new CaseDocument(fixture()), preferences = createPreferences('{}');
  preferences.editMappings(tx => {
    tx.map(bus, 'marker', 'diamond');
    tx.map(bus, 'radius', field('init.Vr').scale(3, 10));
  });
  preferences.set('pickRadius', 15);
  preferences.set('networkGridSpacing', 64);
  const network = scene(document, preferences);
  expect(mark(network, 'buses')).toMatchObject({ marker: 'diamond', radius: { scale: [3, 10], value: '$init.Vr' }, label: null });
  expect(network.scene.controls).toMatchObject({ pickRadius: 15 });
  expect(network.scene.theme).toHaveProperty('gridSpacing', 64);
});

it('labels numeric fields as latkit writes numbers, and shows a bus class mark only for its rows', () => {
  const document = documentWith({ marks: [busMark({ label: { text: '$number' } }),
    { id: 'infinite', target: { collection: 'buses', class: 'BusInfinite' }, kind: 'vertices', options: {} }] });
  const network = scene(document);
  expect(mark(network, 'buses')?.label).toEqual({ text: '$number' });
  expect(mark(network, 'infinite')?.visible).toEqual({ is: ['$class', 'BusInfinite'] });
});



it('keeps native label mappings before a field has its first value', () => {
  const document = new CaseDocument(parseCase(JSON.stringify({ ...input, buses: [],
    devices: [{ class: 'Ieeet1', id: 'exciter', ports: {}, params: {} }],
    $ui: { views: { network: { marks: [busMark({ label: { text: '$name' } })] } } },
  })));
  expect(mark(scene(document), 'buses')?.label).toEqual({ text: '$name' });
});

it('hands latkit mappings it cannot read, names each by its mapping where latkit draws it as if unset, and keeps them saved', () => {
  const views = { network: { marks: [{ id: 'buses', target, kind: 'vertices', options: { radius: { newFunction: '$params.kv' }, futureChannel: [1, 2] } }] }, futureView: { arbitrary: true } };
  const document = new CaseDocument({ ...fixture(), $ui: { author: 'kept', views } });
  const network = scene(document), index = network.entries.findIndex(entry => entry?.mark.id === 'buses');
  expect(mark(network, 'buses')).toMatchObject({ radius: { newFunction: '$params.kv' }, futureChannel: [1, 2] });
  expect(failuresOf(network, [Object.assign(new Error(`marks[${index}].radius: no field \`newFunction\``), { code: 'invalid' as const, path: `marks[${index}].radius` })]))
    .toEqual([{ path: 'network.marks.buses.options.radius', code: 'invalid', message: 'no field `newFunction`' }]);
  expect(document.export().$ui).toMatchObject({ author: 'kept', views: { network: views.network } });
});

it('rejects unsafe imported radii in favor of inherited values and accepts a valid imported scale', () => {
  const document = new CaseDocument({ ...fixture(), $ui: { views: { network: {
    marks: [{ id: 'buses', target, kind: 'vertices', options: { radius: -1 } }],
  } } } });
  expect(scene(document).diagnostics).toEqual([expect.objectContaining({ path: 'case.network.marks[0].options.radius' })]);
  const scaled = documentWith({ marks: [busMark({ radius: { scale: [3, 10], value: '$params.kv' } })] });
  expect(scene(scaled).diagnostics).toEqual([]);
  expect(mark(scene(scaled), 'buses')?.radius).toEqual({ scale: [3, 10], value: '$params.kv' });
});

it('keeps advanced Network expressions', () => {
  const document = documentWith({ marks: [busMark({ color: when(field('params.kv').gt(200)).then('#ff0000').otherwise('#0000ff') })] });
  expect(mark(scene(document), 'buses')?.color).toHaveProperty('when');
});

it('inherits voltage color and height while preserving case overrides over browser preferences', () => {
  const document = new CaseDocument(fixture()), preferences = createPreferences('{}');
  const network = () => mark(scene(document, preferences), 'buses');
  expect(network()).toMatchObject({ color: level, elevation: { scale: [0, expect.any(Number)], value: '$params.kv' } });
  expect(scene(document, preferences).diagnostics).toEqual([]);
  expect(document.views).toEqual({});
  preferences.editMappings(tx => tx.map(bus, 'elevation', 0.5));
  const overridden = documentWith({ marks: [busMark({ color: '#123456', elevation: 0.25 })] });
  expect(mark(scene(overridden, preferences), 'buses')).toMatchObject({ color: '#123456', elevation: 0.25 });
  expect(network()).toMatchObject({ color: level, elevation: 0.5 });
});

it('draws geography under the case and applies the globe, grid, and pole choices', () => {
  const document = new CaseDocument(fixture()), preferences = createPreferences(JSON.stringify({ networkGrid: false, networkPoles: true }));
  const geography = [['geography-0', 'polygons'], ['geography-1', 'lines']] as const;
  const network = networkScene({ document, preferences, mappings: {}, geographic: true, globe: true, geography });
  expect(network.scene.space).toEqual({ earth: { projection: 'globe', graticule: false, atmosphere: false } });
  expect(network.scene.marks!.slice(0, 2)).toEqual(geography.map(table => ({ lines: table, width: 1, pick: false })));
  expect(network.scene.theme).toMatchObject({ line: { color: 'var(--color-graph-line)' } });
  // Poles rise from the ground under the case's marks.
  expect(network.entries.slice(0, 3)).toEqual([null, null, null]);
  expect(network.scene.marks![2]).toMatchObject({ edges: ['case', 'Bus'], poles: true, pick: false });
  // Poles draw however the network is seen; looking straight down, latkit shrinks each to a point under its bus.
  const flat = networkScene({ document, preferences, mappings: {}, geographic: false });
  expect(flat.scene.space).toEqual({ plane: { grid: 'off' } });
  expect(flat.scene.marks!.some(mark => 'edges' in mark && mark.poles)).toBe(true);
});

it('draws from the ground up, buses over the branches and poles that meet them', () => {
  const document = new CaseDocument(fixture()), preferences = createPreferences(JSON.stringify({ networkPoles: true }));
  const kinds = (result: NetworkScene) => result.scene.marks!.map(mark => 'vertices' in mark ? 'vertices' : 'poles' in mark ? 'poles' : 'edges');
  const network = scene(document, preferences);
  expect(kinds(network)[0]).toBe('poles');
  expect(kinds(network).lastIndexOf('edges')).toBeLessThan(kinds(network).indexOf('vertices'));
  // Each mark keeps its mapping beside it; poles have none.
  network.scene.marks!.forEach((drawn, index) => {
    const entry = network.entries[index];
    expect(entry ? String(drawn.name).startsWith(entry.mark.id) : 'poles' in drawn).toBe(true);
  });
});

const dark = { background: '#060404', vertex: '#d65b65', line: '#6d6767', text: '#e8e3e3', grid: '#282322', surface: '#1a1514', raised: '#140f0f', hover: '#e8e3e380', selected: '#e8e3e3' };
const light = { background: '#f8f5f4', vertex: '#5b1c22', line: '#8a8584', text: '#1f1a1a', grid: '#ddd8d7', surface: '#ede9e8', raised: '#faf8f7', hover: '#1f1a1a80', selected: '#1f1a1a' };
const colorsOf = (map: unknown) => (map as { colors: (string | [number, string])[] }).colors.map(entry => Array.isArray(entry) ? entry[1] : entry);
const readsOn = (colors: readonly string[], grounds: readonly string[], floor: number) => {
  for (const color of colors) for (const ground of grounds) expect(contrast(rgbOf(color)!, rgbOf(ground)!)).toBeGreaterThanOrEqual(floor);
};

it('keeps every colormap at 4.5:1 with the background, or 7:1 with wider marks in high contrast, leaving mapped colormaps as mapped', () => {
  const document = documentWith({ marks: [busMark({ color: { colormap: 'viridis', value: '$params.kv' } })] });
  const network = networkScene({ document, preferences: createPreferences(JSON.stringify({ theme: 'dark' })), palette: dark, mappings: document.views, geographic: true });
  expect(mark(network, 'buses')!.color).toEqual({ colormap: 'viridis', value: '$params.kv' });
  expect(network.scene.theme).toMatchObject({ contrast: 4.5 });
  const high = networkScene({ document: new CaseDocument(fixture()), preferences: createPreferences(JSON.stringify({ theme: 'dark', contrast: 'high' })),
    palette: dark, mappings: {}, geographic: true });
  expect(high.scene.theme).toMatchObject({ contrast: 7, vertex: { radius: 7 }, edge: { width: 2.5 } });
});

it('draws voltage levels in bands that read on each ground, from the background\'s palette', () => {
  for (const [palette, theme] of [[light, 'light'], [dark, 'dark']] as const) {
    const network = networkScene({ document: new CaseDocument(fixture()), preferences: createPreferences(JSON.stringify({ theme })), palette, mappings: {}, geographic: true });
    const color = mark(network, 'buses')!.color as { colormap: unknown; domain: unknown };
    expect(color).toMatchObject({ colormap: voltagePalette(theme === 'dark'), domain: [60, 800] });
    readsOn(colorsOf(color.colormap), [palette.background, palette.surface], 4.5);
  }
});

it('keeps the color of a missing value at the floor every colormap keeps', () => {
  for (const [palette, theme, floor] of [[light, 'light', 4.5], [dark, 'dark', 4.5], [light, 'light', 7]] as const) {
    const preferences = createPreferences(JSON.stringify({ theme, contrast: floor === 7 ? 'high' : 'system' }));
    const network = networkScene({ document: new CaseDocument(fixture()), preferences, palette, mappings: {}, geographic: true });
    const missing = rgbOf(String(network.scene.theme && typeof network.scene.theme === 'object' ? network.scene.theme.missing : ''))!;
    for (const ground of [palette.background, palette.surface]) expect(contrast(missing, rgbOf(ground)!)).toBeGreaterThanOrEqual(floor);
  }
});



it('applies Network atmosphere and selection preferences', () => {
  const preferences = createPreferences(JSON.stringify({ networkAtmosphere: true, cycle: true }));
  const network = scene(new CaseDocument(fixture()), preferences);
  expect(network.scene.space).toEqual({ earth: { projection: 'mercator', graticule: true, atmosphere: true } });
  expect(network.scene.controls).toMatchObject({ cycle: true });
});

it('sizes an explicitly chosen network layout from its own coordinates even in a geographic case', () => {
  const document = documentWith({ space: 'plane' });
  const network = scene(document);
  expect(network.scene.space).toHaveProperty('plane');
  const drawing = drawingOf(document, 'network');
  expect(mark(network, 'buses')).toMatchObject({ position: positionOf('network'), radius: { units: drawing.spacing / 4 } });
  expect(drawing.height).toBe(drawing.extent * 0.15);
  expect(network.scene.layout).toBe('stress');
});

it('shares resolved native sizes, elevation, and palette between defaults, marks, and poles', () => {
  const document = documentWith({ theme: { background: '#060404', vertex: { radius: 9 }, edge: { width: 3 } } });
  const preferences = createPreferences(JSON.stringify({ networkPoles: true }));
  const drawing = drawingOf(document, 'geographic');
  const resolved = resolveNetwork({ source: { geographic: true, drawing, targets: document.targets, fields: target => document.fields(target) },
    preferences: preferences.value, caseOverrides: document.views });
  const busMark = resolved.marks.find(mark => mark.id === 'buses')!;
  if (busMark.kind !== 'vertices') throw new Error('Buses must be vertices.');
  const direct = busMark.options;
  expect(direct).toMatchObject({ radius: { units: drawing.spacing / 4, atMost: 9 }, elevation: { scale: [0, drawing.height] },
    color: { value: '$params.kv', colormap: voltagePalette(true), domain: [60, 800] } });
  const network = scene(document, preferences);
  expect(mark(network, 'buses')!.radius).toEqual(direct.radius);
  expect(mark(network, 'buses')!.elevation).toEqual(direct.elevation);
  const branch = mark(network, 'branches')!, pole = network.scene.marks!.find(mark => 'edges' in mark && mark.poles)!;
  expect(branch.width).toMatchObject({ units: drawing.spacing * 3 / 40, atMost: 3 });
  expect(pole).toMatchObject({ width: branch.width });
});

it('keeps additional native marks independent of catalog defaults and preserves explicit sizes', () => {
  const document = documentWith({ marks: [busMark({ radius: { units: 0.02, atLeast: 2 } }),
    { id: 'additional', target, kind: 'vertices', options: { visible: true } }] });
  const preferences = createPreferences('{}');
  const resolved = resolveNetwork({ source: { geographic: true, drawing: drawingOf(document, 'geographic'), targets: document.targets,
    fields: target => document.fields(target) }, preferences: preferences.value, caseOverrides: document.views });
  expect(resolved.marks.find(mark => mark.id === 'additional')!.options).toEqual({ visible: true });
  expect(mark(scene(document), 'buses')!.radius).toEqual({ units: 0.02, atLeast: 2 });
});
