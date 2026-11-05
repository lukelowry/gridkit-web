let context: CanvasRenderingContext2D | null;

/** `value` as `#rrggbb`, or as `#rrggbbaa` when `alpha` asks and it is translucent; `null` for anything but a CSS color. */
export function colorHex(value: string, alpha = false): string | null {
  if (!CSS.supports('color', value)) return null;
  context ??= document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  context.clearRect(0, 0, 1, 1);
  context.fillStyle = value;
  context.fillRect(0, 0, 1, 1);
  const channels = [...context.getImageData(0, 0, 1, 1).data];
  return '#' + channels.slice(0, alpha && channels[3]! < 255 ? 4 : 3)
    .map(channel => channel.toString(16).padStart(2, '0')).join('');
}

type Rgb = [number, number, number];
/** `#rgb`, `#rrggbb`, `#rrggbbaa`, or `rgb()`/`rgba()` as channels; `null` for any other color. */
export function rgbOf(color: string): Rgb | null {
  const hex = /^#([\da-f]{3}|[\da-f]{6}|[\da-f]{8})$/i.exec(color)?.[1];
  if (hex) return [0, 1, 2].map(i => hex.length === 3 ? parseInt(hex[i]!.repeat(2), 16) : parseInt(hex.slice(2 * i, 2 * i + 2), 16)) as Rgb;
  const channels = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(color);
  return channels ? channels.slice(1, 4).map(Number) as Rgb : null;
}
const hexOf = (rgb: Rgb) => '#' + rgb.map(channel => channel.toString(16).padStart(2, '0')).join('');
const linear = (channel: number) => { const v = channel / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const encode = (v: number) => Math.round(255 * Math.min(1, Math.max(0, v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)));
const luminance = ([r, g, b]: Rgb) => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
/** WCAG's contrast ratio of two colors. */
export function contrast(a: Rgb, b: Rgb) {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high! + 0.05) / (low! + 0.05);
}
// Darker than this, a ground contrasts more with white than with black.
const dark = (ground: Rgb) => luminance(ground) < 0.18;
/** Whether `color` is a ground light text reads on; `false` for anything but a hex or `rgb()` color. */
export const isDark = (color: string) => { const rgb = rgbOf(color); return !!rgb && dark(rgb); };
const reads = (rgb: Rgb | null, grounds: readonly Rgb[], floor: number) => !!rgb && grounds.every(ground => contrast(rgb, ground) >= floor);

function oklab(rgb: Rgb): Rgb {
  const [r, g, b] = rgb.map(linear) as Rgb;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b),
    s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
/** The color at OKLab lightness `lightness` with the hue of `a` and `b`, its chroma reduced until it fits sRGB. */
function srgb(lightness: number, a: number, b: number): Rgb {
  for (let scale = 1; ; scale -= 1 / 32) {
    const [x, y] = [a * Math.max(0, scale), b * Math.max(0, scale)];
    const l = (lightness + 0.3963377774 * x + 0.2158037573 * y) ** 3, m = (lightness - 0.1055613458 * x - 0.0638541728 * y) ** 3,
      s = (lightness - 0.0894841775 * x - 1.291485548 * y) ** 3;
    const rgb = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
    if (scale <= 0 || rgb.every(v => v > -1e-4 && v < 1 + 1e-4)) return rgb.map(encode) as Rgb;
  }
}

/**
 * `colors` kept at `floor` contrast with every one of `grounds`: when any falls short, all of them have their lightness
 * rescaled, in order, into the band that holds, so a palette keeps its hues and its order. Colors that cannot be read
 * pass through.
 */
export function legible(colors: readonly string[], grounds: readonly string[], floor: number): string[] {
  const rgbs = colors.map(rgbOf), under = grounds.map(rgbOf).filter(ground => ground !== null);
  const holds = (rgb: Rgb) => reads(rgb, under, floor);
  if (rgbs.every(rgb => !rgb || holds(rgb))) return [...colors];
  // A gray holds above each dark ground's edge and below each light ground's.
  let low = 0, high = 1;
  for (const ground of under) {
    const y = luminance(ground);
    if (dark(ground)) low = Math.max(low, Math.cbrt(floor * (y + 0.05) - 0.05));
    else high = Math.min(high, Math.cbrt(Math.max(0, (y + 0.05) / floor - 0.05)));
  }
  if (low > high) low = high = (low + high) / 2;
  const labs = rgbs.map(rgb => rgb && oklab(rgb)), levels = labs.flatMap(lab => lab ? [lab[0]] : []);
  const least = Math.min(...levels), most = Math.max(...levels), into = (v: number) => Math.min(high, Math.max(low, v));
  const [from, to] = [into(least), into(most)];
  return colors.map((color, index) => {
    const lab = labs[index];
    if (!lab) return color;
    let lightness = most > least ? from + (lab[0] - least) / (most - least) * (to - from) : into(lab[0]);
    let rgb = srgb(lightness, lab[1], lab[2]);
    // Hue moves luminance at a given lightness: step away from whichever ground still falls short.
    for (let step = 0; step < 100 && !holds(rgb); step++) {
      lightness = Math.min(1, Math.max(0, lightness + (under.some(ground => dark(ground) && contrast(rgb, ground) < floor) ? 0.01 : -0.01)));
      rgb = srgb(lightness, lab[1], lab[2]);
    }
    return hexOf(rgb);
  });
}
