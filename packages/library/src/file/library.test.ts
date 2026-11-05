import { expect, it, vi } from 'vitest';
import { LibraryError } from '../index.js';
import { connect } from './index.js';

type Tree = { readonly [name: string]: File | Tree };
const modified = Date.UTC(2026, 10, 1);
const text = (name: string, content: string) => new File([content], name, { lastModified: modified });

/** A folder as the browser hands one over, holding `tree`; each file's getFile is a spy. */
function folder(name: string, tree: Tree): FileSystemDirectoryHandle {
  const child = (key: string, kind: FileSystemHandleKind) => {
    const value = tree[key];
    if (value === undefined) throw new DOMException(`${key} is not here.`, 'NotFoundError');
    if ((value instanceof File) !== (kind === 'file')) throw new DOMException(`${key} is not a ${kind}.`, 'TypeMismatchError');
    return value instanceof File ? handles.get(value)! : folder(key, value);
  };
  return {
    kind: 'directory', name,
    getDirectoryHandle: async (key: string) => child(key, 'directory'),
    getFileHandle: async (key: string) => child(key, 'file'),
    async *values() { for (const [key, value] of Object.entries(tree)) yield child(key, value instanceof File ? 'file' : 'directory'); },
  } as unknown as FileSystemDirectoryHandle;
}
const handles = new Map<File, { kind: 'file'; name: string; getFile: () => Promise<File> }>();
function cases(tree: Tree): Tree {
  for (const value of Object.values(tree)) {
    if (value instanceof File) handles.set(value, { kind: 'file', name: value.name, getFile: vi.fn(async () => value) });
    else cases(value);
  }
  return tree;
}

const ieee39 = text('IEEE 39.case.json', '{"header":{}}'), notes = text('notes.txt', 'not a case');
const tree = cases({
  'IEEE14.case.json': text('IEEE14.case.json', '{}'), 'notes.txt': notes, '.hidden.case.json': text('.hidden.case.json', '{}'),
  IEEE: { 'IEEE 39.case.json': ieee39 }, 'IEEE118.case.json': text('IEEE118.case.json', '{"buses":[]}'),
});

it('lists a folder as any library does, reading nothing it does not show', async () => {
  const library = (await connect({ directory: folder('cases', tree) }))!;
  const entries = await library.list('');
  expect(entries.map(entry => [entry.path, entry.title, entry.folder, entry.size])).toEqual([
    ['IEEE/', 'IEEE', true, 0], ['IEEE14.case.json', 'IEEE14', false, 2], ['IEEE118.case.json', 'IEEE118', false, 12]]);
  expect(entries[1]!.modified).toEqual(new Date(modified));
  expect(handles.get(notes)!.getFile).not.toHaveBeenCalled();
  expect((await library.list('IEEE/')).map(entry => entry.path)).toEqual(['IEEE/IEEE 39.case.json']);
});

it('opens a case as the file itself, never a copy, and says what it cannot find', async () => {
  const library = (await connect({ directory: folder('cases', tree) }))!;
  expect(await library.open({ path: 'IEEE/IEEE 39.case.json' })).toBe(ieee39);
  await expect(library.open({ path: 'IEEE/missing.case.json' }))
    .rejects.toEqual(new LibraryError('missing', 'The library has no such file.'));
  await expect(library.list('IEEE14.case.json/')).rejects.toEqual(new LibraryError('missing', 'The library has no such folder.'));
});

it('reads only library.json for favorites and opens a nested favorite through the same file reader', async () => {
  const example = text('example.case.json', '{}');
  const info = text('library.json', '{"favorites":["Nested/example.case.json"]}');
  const library = (await connect({ directory: folder('cases', cases({ 'library.json': info, Nested: { 'example.case.json': example } })) }))!;
  expect(await library.favorites()).toEqual(['Nested/example.case.json']);
  expect(handles.get(example)!.getFile).not.toHaveBeenCalled();
  expect(await library.open({ path: 'Nested/example.case.json' })).toBe(example);
  expect((await library.list('')).map(entry => entry.path)).toEqual(['Nested/']);
});

it('handles absent, invalid and canceled favorites without hiding file access failures', async () => {
  expect(await (await connect({ directory: folder('cases', tree) }))!.favorites()).toEqual([]);
  const invalid = text('library.json', '{');
  const library = (await connect({ directory: folder('cases', cases({ 'library.json': invalid })) }))!;
  await expect(library.favorites()).rejects.toMatchObject({ code: 'protocol' });
  expect(await library.list('')).toEqual([]);
  const request = new AbortController(); request.abort();
  await expect(library.favorites(request.signal)).rejects.toMatchObject({ name: 'AbortError' });
  const denied = Object.assign(folder('cases', {}), { getFileHandle: async () => { throw new DOMException('Denied', 'NotAllowedError'); } });
  await expect((await connect({ directory: denied }))!.favorites()).rejects.toMatchObject({ code: 'unavailable' });
});

it('asks to read a folder the page may not read yet, and is no library where that is refused', async () => {
  const asked = (answer: PermissionState) => Object.assign(folder('cases', tree), {
    queryPermission: vi.fn(async () => 'prompt' as const), requestPermission: vi.fn(async () => answer) });
  const refused = asked('denied');
  expect(await connect({ directory: refused })).toBeNull();
  expect(refused.requestPermission).toHaveBeenCalledWith({ mode: 'read' });
  expect(await connect({ directory: asked('granted') })).not.toBeNull();
});
