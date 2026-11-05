declare global {
  interface Window {
    /** Chromium's save picker, through which a page writes the file the user chooses. */
    showSaveFilePicker?(options: { suggestedName: string; types: { accept: Record<string, string[]> }[] }): Promise<FileSystemFileHandle>;
  }
}

/** The files the UI makes, by extension. */
const types = { json: 'application/json', csv: 'text/csv', log: 'text/plain', png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp', mp4: 'video/mp4' } as const;
/** A file's name, ending in an extension the UI makes. */
export type FileName = `${string}.${keyof typeof types}`;
/** Makes a file into `output` and closes it; on failure, whoever gave `output` aborts it. */
export type Make = (output: WritableStream<Uint8Array>) => Promise<void>;

/** `name` as any file system takes it. */
export const fileName = (name: string) => (name.trim() || 'untitled').replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_');

/** Writes `bytes` to `output` as the whole file. */
export async function write(output: WritableStream<Uint8Array>, bytes: Uint8Array) {
  const writer = output.getWriter();
  try { await writer.write(bytes); await writer.close(); } finally { writer.releaseLock(); }
}

/**
 * Saves text, or what `make` makes, as `name`: into the file the user chooses where the browser lets a page write one, so it
 * streams to disk as it is made; elsewhere as a download once whole. Call it from the click that asks, before any other await:
 * the picker needs that click. Answers whether it saved; nothing is made until the user has chosen, and a failure leaves no file.
 */
export async function save(name: FileName, content: string | Make): Promise<boolean> {
  const output = await destination(name);
  if (!output) return false;
  try { await (typeof content === 'string' ? write(output, new TextEncoder().encode(content)) : content(output)); }
  catch (cause) {
    await output.abort(cause).catch(() => {});
    throw cause;
  }
  return true;
}

/** Copies the PNG `make` makes to the clipboard, which takes it while it is still being made. Call it from the click that asks. */
export function copy(make: Make): Promise<void> {
  const { output, file } = held(types.png);
  make(output).catch((cause: unknown) => output.abort(cause).catch(() => {}));
  return navigator.clipboard.write([new ClipboardItem({ [types.png]: file })]);
}

/** Where a save writes: the file the user chooses, else a download once the file is whole; `null` once they cancel. */
async function destination(name: FileName): Promise<WritableStream<Uint8Array> | null> {
  const extension = name.slice(name.lastIndexOf('.') + 1) as keyof typeof types, type = types[extension];
  if (window.showSaveFilePicker) {
    try {
      const file = await window.showSaveFilePicker({ suggestedName: name, types: [{ accept: { [type]: [`.${extension}`] } }] });
      return await file.createWritable();
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return null;
      throw cause;
    }
  }
  const { output, file } = held(type);
  void file.then(blob => download(blob, name), () => {});
  return output;
}

/** A stream that holds what is written, and the file it makes once closed: what downloads, the clipboard, and previews take. */
export function held(type: string) {
  const parts: Uint8Array<ArrayBuffer>[] = [];
  let made!: (file: Blob) => void, failed!: (cause: unknown) => void;
  const file = new Promise<Blob>((resolve, reject) => { made = resolve; failed = reject; });
  // A writer hands its chunks over; this page shares no memory, so each is an ArrayBuffer's.
  const output = new WritableStream<Uint8Array>({ write: chunk => { parts.push(chunk as Uint8Array<ArrayBuffer>); },
    close: () => made(new Blob(parts, { type })), abort: failed });
  return { output, file };
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  try { link.click(); } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }
}
