import { expect, it } from 'vitest';
import { entries, shown } from './listing.js';

const item = (name: string, folder = false) => ({ name, folder, size: folder ? 0 : 1, modified: null });

it('shows folders, then cases, in natural order, titled without .case.json', () => {
  expect(entries('IEEE/', [item('IEEE118.case.json'), item('IEEE14.case.json'), item('WECC', true), item('notes.txt'), item('Archive', true)])
    .map(entry => [entry.path, entry.title, entry.folder])).toEqual([
    ['IEEE/Archive/', 'Archive', true], ['IEEE/WECC/', 'WECC', true],
    ['IEEE/IEEE14.case.json', 'IEEE14', false], ['IEEE/IEEE118.case.json', 'IEEE118', false]]);
});

it('never shows what is hidden or would leave the folder', () => {
  for (const [name, folder] of [['.hidden.case.json', false], ['..', true], ['.', true], ['IEEE/../x.case.json', false], ['a\\b.case.json', false], ['', true]] as const)
    expect(shown(name, folder), name).toBe(false);
  expect(shown('IEEE 14.case.json', false)).toBe(true);
  expect(shown('IEEE 14', true)).toBe(true);
});
