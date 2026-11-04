import { connect as library } from '@gridkit/library/http';
import type { Config } from './config.js';
import { mountEditor } from './editor.js';

const beside = (name: string) => new URL(`api/${name}/`, document.baseURI).href;

/** What this deployment says, beside the editor. Only the solver needs it, so the editor shows without waiting for it. */
async function settings(signal?: AbortSignal): Promise<Config> {
  const response = await fetch(new URL('config.json', document.baseURI), { cache: 'no-cache', ...signal && { signal } })
    .catch((cause: unknown) => { throw signal?.aborted ? cause : new Error("Cannot reach this site's settings. Check the connection."); });
  if (!response.ok) throw new Error(`This site's settings could not be read (${response.status}).`);
  return await response.json() as Config;
}
// Asked for now, while the editor mounts; a solver that connects again after a failure asks again.
let asked: Promise<Config> | undefined = settings();

mountEditor(document.getElementById('app')!, {
  // A failure to read the settings is the solver's, tried again as any failure to connect is. Each solver is a chunk of its own,
  // loaded only where the settings ask for it.
  solver: async signal => {
    const pending = asked ?? settings(signal);
    asked = undefined;
    const { gridkit } = await pending;
    return gridkit
      ? (await import('@gridkit/solver/wasm')).connect({ module: new URL(gridkit, document.baseURI).href }, signal)
      : (await import('@gridkit/solver/http')).connect({ base: beside('solver') }, signal);
  },
  library: signal => library({ base: beside('library') }, signal),
});
