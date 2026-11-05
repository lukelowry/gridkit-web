import { afterEach, expect, it, vi } from 'vitest';
import { copy, fileName, save, write } from './files.js';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const picking = (output: WritableStream<Uint8Array>) => vi.fn(async () => ({ createWritable: async () => output }));
const text = (chunks: Uint8Array[]) => chunks.map(chunk => new TextDecoder().decode(chunk)).join('');

it('names files as any file system takes them', () => {
  expect(fileName(' North: 230/115 kV ')).toBe('North_ 230_115 kV');
  expect(fileName('  ')).toBe('untitled');
});

it('writes into the file the user chooses, typed by its name, as the file is made', async () => {
  const chunks: Uint8Array[] = [], picker = picking(new WritableStream({ write: chunk => { chunks.push(chunk); } }));
  vi.stubGlobal('window', { showSaveFilePicker: picker });
  expect(await save('Case.case.json', '{}')).toBe(true);
  expect(picker).toHaveBeenCalledWith({ suggestedName: 'Case.case.json', types: [{ accept: { 'application/json': ['.json'] } }] });
  expect(text(chunks)).toBe('{}');
});

it('makes nothing once the user cancels, and leaves no file when making it fails', async () => {
  vi.stubGlobal('window', { showSaveFilePicker: async () => { throw new DOMException('The user aborted a request.', 'AbortError'); } });
  const make = vi.fn(async () => {});
  expect(await save('Run.mp4', make)).toBe(false);
  expect(make).not.toHaveBeenCalled();

  let aborted: unknown;
  vi.stubGlobal('window', { showSaveFilePicker: picking(new WritableStream({ abort: reason => { aborted = reason; } })) });
  const failure = new Error('The video encoder failed.');
  await expect(save('Run.mp4', async () => { throw failure; })).rejects.toBe(failure);
  expect(aborted).toBe(failure);
});

it('downloads the whole file where the browser has no save picker', async () => {
  const link = { click: vi.fn(), remove: vi.fn() };
  vi.stubGlobal('window', {});
  vi.stubGlobal('document', { createElement: () => link, body: { append: vi.fn() } });
  const created = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:solver');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  expect(await save('Case.solver.json', async output => {
    const writer = output.getWriter();
    await writer.write(new TextEncoder().encode('{"tmax"'));
    await writer.write(new TextEncoder().encode(':10}'));
    await writer.close();
  })).toBe(true);
  expect(link).toMatchObject({ href: 'blob:solver', download: 'Case.solver.json' });
  expect(link.click).toHaveBeenCalledOnce();
  const file = created.mock.calls[0]![0] as Blob;
  expect([file.type, await file.text()]).toEqual(['application/json', '{"tmax":10}']);
});

it('gives the clipboard a PNG while it is still being made, and its failure if making it fails', async () => {
  const items: Record<string, Promise<Blob>>[] = [];
  vi.stubGlobal('ClipboardItem', class { constructor(data: Record<string, Promise<Blob>>) { items.push(data); } });
  vi.stubGlobal('navigator', { clipboard: { write: vi.fn(async () => {}) } });
  let finish!: () => void;
  const drawn = new Promise<void>(resolve => { finish = resolve; });
  await copy(async output => { await drawn; await write(output, Uint8Array.of(137, 80)); });
  finish();
  const png = await items[0]!['image/png']!;
  expect([png.type, [...new Uint8Array(await png.arrayBuffer())]]).toEqual(['image/png', [137, 80]]);

  const failure = new Error('The view stopped drawing.');
  await copy(async () => { throw failure; });
  await expect(items[1]!['image/png']).rejects.toBe(failure);
});
