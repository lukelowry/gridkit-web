import * as z from 'zod';

export const categories = [
  { id: 'appearance', label: 'Appearance', icon: 'theme' },
  { id: 'network', label: 'Network', icon: 'network' },
  { id: 'interaction', label: 'Interaction', icon: 'info' },
  { id: 'table', label: 'Table', icon: 'table' },
  { id: 'export', label: 'Export', icon: 'export' },
] as const;
type Category = (typeof categories)[number]['id'];
const bool = (category: Category, group: string, label: string, value: boolean) =>
  ({ category, group, label, kind: 'boolean' as const, schema: z.boolean().default(value) });
const num = (category: Category, group: string, label: string, value: number, min: number, max: number, step = 1, unit = '') =>
  ({ category, group, label, kind: 'number' as const, min, max, step, unit,
    schema: (step === 1 ? z.number().int() : z.number()).min(min).max(max).default(value) });
/** A choice among `options`, each shown by its label in `labels`, else by its own name, and under its heading in `groups`. */
const choice = <const T extends readonly [string, ...string[]]>(category: Category, group: string, label: string, options: T, value: T[number],
  labels: Partial<Record<T[number], string>> = {}, groups: Partial<Record<T[number], string>> = {}) =>
  ({ category, group, label, kind: 'choice' as const, options, labels: labels as Partial<Record<string, string>>,
    groups: groups as Partial<Record<string, string>>, schema: z.enum(options).default(value) });
const color = (category: Category, group: string, label: string) =>
  ({ category, group, label, kind: 'color' as const, schema: z.string().regex(/^(|#[\da-f]{6}([\da-f]{2})?)$/i).default('') });
const font = (category: Category) => ({ category, group: 'Labels', label: 'Font', kind: 'text' as const, schema: z.string().max(200).default('') });
const url = (category: Category, group: string, label: string) =>
  ({ category, group, label, kind: 'url' as const, schema: z.union([z.literal(''), z.url({ protocol: /^https?$/ })]).default('') });
/** `field`, shown only while the preference `key` holds one of `values`. */
const only = <F extends object>(field: F, key: string, values: readonly string[]) => ({ ...field, when: { key, values } });
/** Natural Earth's GeoJSON, at the release this pins. */
const naturalEarth = (name: string) => `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_${name}.geojson`;
/**
 * The geography a map draws under its network, each choice the GeoJSON files that draw it as lines: countries at 1:110m, and the
 * rest at 1:50m, its land borders and coasts drawn once each.
 */
export const geographies = {
  countries: [naturalEarth('110m_admin_0_countries')],
  detailed: [naturalEarth('50m_coastline'), naturalEarth('50m_admin_0_boundary_lines_land')],
  states: [naturalEarth('50m_coastline'), naturalEarth('50m_admin_0_boundary_lines_land'), naturalEarth('50m_admin_1_states_provinces_lines')],
  coastlines: [naturalEarth('50m_coastline')],
  water: [naturalEarth('50m_coastline'), naturalEarth('50m_rivers_lake_centerlines'), naturalEarth('50m_lakes')],
} as const;
const mapped = Object.keys(geographies) as (keyof typeof geographies)[];
/**
 * Picture sizes as the screens and pages they are for show them: laid out in CSS pixels and drawn at that device's pixels per
 * CSS pixel, so text and lines come out the size they read at there. A journal page sets only its width, at 600 dpi.
 */
export const pictureSizes = {
  slide: { group: 'Slides', layout: [960, 540], ratio: 2 },
  'slide-4k': { group: 'Slides', layout: [960, 540], ratio: 4 },
  phone: { group: 'Phone', layout: [360, 640], ratio: 3 },
  post: { group: 'Phone', layout: [360, 450], ratio: 3 },
  square: { group: 'Phone', layout: [360, 360], ratio: 3 },
  column: { group: 'Paper', label: 'Single column', width: 336, ratio: 6.25 },
  page: { group: 'Paper', label: 'Double column', width: 687, ratio: 6.25 },
} as const satisfies Record<string, { group: string; ratio: number } & ({ layout: readonly [number, number] } | { label: string; width: number })>;
const sized = Object.keys(pictureSizes) as (keyof typeof pictureSizes)[];

export const preferenceFields = {
  theme: choice('appearance', '', 'Theme', ['system', 'light', 'dark'], 'system'),
  contrast: choice('appearance', '', 'Contrast', ['system', 'high'], 'system'),
  motion: choice('appearance', '', 'Motion', ['system', 'reduce'], 'system'),
  resultsDock: choice('appearance', '', 'Results panel', ['bottom', 'right'], 'bottom'),
  networkGrid: bool('network', 'Layers', 'Grid', true),
  networkGridSpacing: num('network', 'Layers', 'Minimum grid spacing', 24, 4, 200, 1, 'px'),
  networkPoles: bool('network', 'Layers', 'Height poles', false),
  networkAtmosphere: bool('network', 'Layers', 'Atmosphere', false),
  geography: choice('network', 'Layers', 'Geography', ['none', ...mapped, 'custom'], 'countries', {
    countries: 'Countries', detailed: 'Detailed countries', states: 'States and provinces', coastlines: 'Coastlines', water: 'Rivers and lakes',
    custom: 'Custom GeoJSON',
  }),
  geographyUrl: only(url('network', 'Layers', 'GeoJSON URL'), 'geography', ['custom']),
  networkMinRadius: num('network', 'Geometry', 'Minimum bus radius', 1, 0, 10, .5, 'px'),
  dashPeriod: num('network', 'Geometry', 'Dash length', 12, 1, 64, 1, 'px'),
  networkFont: font('network'),
  networkFontSize: num('network', 'Labels', 'Text size', 12, 6, 32, 1, 'px'),
  networkLabelHalo: num('network', 'Labels', 'Label halo', 2, 0, 8, .5, 'px'),
  networkBackground: color('network', 'Colors', 'Background'),
  networkTextColor: color('network', 'Colors', 'Labels'),
  networkGridColor: color('network', 'Colors', 'Grid'),
  defaultProjection: choice('network', 'Camera', 'Initial projection', ['flat', 'tilt', 'globe'], 'flat'),
  hoverScale: num('network', 'Highlight', 'Bus hover scale', 1.1, 1, 3, .1),
  wheel: choice('interaction', 'Navigation', 'Wheel zoom', ['wheel', 'modifier'], 'wheel', { wheel: 'Always', modifier: 'With Ctrl or Cmd' }),
  keyboard: bool('interaction', 'Navigation', 'Keyboard navigation', true),
  cycle: bool('interaction', 'Navigation', 'Cycle overlapping', false),
  pickRadius: num('interaction', 'Navigation', 'Picking tolerance', 6, 1, 32, 1, 'px'),
  animationMs: num('interaction', 'Navigation', 'Animation duration', 300, 0, 1500, 10, 'ms'),
  hover: bool('interaction', 'Highlight', 'Hover', true),
  hoverColor: color('interaction', 'Highlight', 'Hover color'),
  selectionColor: color('interaction', 'Highlight', 'Selection color'),
  hoverWidth: num('interaction', 'Highlight', 'Glow width', 3, 0, 16, .5, 'px'),
  unselectedAlpha: num('interaction', 'Highlight', 'Other elements opacity', .5, 0, 1, .05),
  tableDensity: choice('table', '', 'Row density', ['compact', 'comfortable'], 'compact'),
  exportFormat: choice('export', 'Image', 'Format', ['png', 'jpeg', 'webp'], 'png', { png: 'PNG', jpeg: 'JPEG', webp: 'WebP' }),
  exportQuality: only(num('export', 'Image', 'JPEG quality', 90, 1, 100), 'exportFormat', ['jpeg']),
  // JPEG has no transparency.
  exportBackground: only(choice('export', 'Image', 'Background', ['theme', 'transparent'], 'theme', { theme: 'Solid' }), 'exportFormat', ['png', 'webp']),
  exportFrameRate: choice('export', 'Video', 'Frame rate', ['24', '30', '60'], '30', { 24: '24 fps', 30: '30 fps', 60: '60 fps' }),
  exportVideoQuality: choice('export', 'Video', 'Quality', ['standard', 'high', 'best'], 'high'),
  // Each choice is the degrees a second the camera turns.
  exportOrbit: choice('export', 'Video', 'Camera', ['0', '6', '15'], '0', { 0: 'Still', 6: 'Slow orbit', 15: 'Fast orbit' }),
  exportSize: choice('export', 'Size', 'Size', ['view', ...sized, 'custom'], 'view', {
    view: 'Match view',
    ...Object.fromEntries(sized.map(key => {
      const size = pictureSizes[key];
      return [key, 'label' in size ? size.label : `${size.layout[0] * size.ratio} × ${size.layout[1] * size.ratio}`];
    })),
  }, Object.fromEntries(sized.map(key => [key, pictureSizes[key].group]))),
  // A screen's or page's size sets its own pixels per CSS pixel.
  exportScale: only(choice('export', 'Size', 'Scale', ['1', '2', '3', '4'], '2', { 1: '1×', 2: '2×', 3: '3×', 4: '4×' }), 'exportSize', ['view', 'custom']),
  exportWidth: only(num('export', 'Size', 'Width', 1920, 16, 8192, 1, 'px'), 'exportSize', ['custom']),
  exportHeight: only(num('export', 'Size', 'Height', 1080, 16, 8192, 1, 'px'), 'exportSize', ['custom']),
  exportFraming: choice('export', 'Size', 'Framing', ['fit', 'shown'], 'fit', { fit: 'Fit all', shown: 'As shown' }),
  exportText: choice('export', 'Contents', 'Text size', ['1', '1.25', '1.5', '2'], '1', { 1: '100%', 1.25: '125%', 1.5: '150%', 2: '200%' }),
  exportPlot: bool('export', 'Contents', 'Plot', true),
} as const;

export type PreferenceKey = keyof typeof preferenceFields;
export type PreferenceField = (typeof preferenceFields)[PreferenceKey];
const shape = Object.fromEntries(Object.entries(preferenceFields).map(([key, preference]) => [key, preference.schema])) as
  { [K in PreferenceKey]: (typeof preferenceFields)[K]['schema'] };
export const preferencesSchema = z.object(shape);
export type Preferences = z.infer<typeof preferencesSchema>;
export const defaults = preferencesSchema.parse({});
export const preferenceKeys = Object.keys(preferenceFields) as PreferenceKey[];
/** Whether `key` applies while `v` holds: always, or while the preference it depends on holds a value it takes. */
export function applies(key: PreferenceKey, v: Preferences): boolean {
  const field: PreferenceField = preferenceFields[key];
  return !('when' in field) || field.when.values.includes(String(v[field.when.key as PreferenceKey]));
}
/** The GeoJSON files a map draws under its network as `v` chooses: a geography's, the user's own, or none. */
export const geographyOf = (v: Preferences): readonly string[] =>
  v.geography === 'custom' ? v.geographyUrl ? [v.geographyUrl] : [] : v.geography === 'none' ? [] : geographies[v.geography];

export const tableSchema = z.object({
  columns: z.array(z.object({ key: z.string(), width: z.number().min(60).max(600), visible: z.boolean() })).default([]),
  sort: z.object({ key: z.string(), dir: z.enum(['asc', 'desc']) }).nullable().default(null),
});
export type TablePreferences = z.infer<typeof tableSchema>;
