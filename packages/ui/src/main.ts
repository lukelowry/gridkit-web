import './zod.js'; // before any module builds a schema
import { connect as library } from '@gridkit/library/http';
import type { Config } from './config.js';
import { mountUi } from './mount.js';

const beside = (name: string) => new URL(`api/${name}/`, document.baseURI).href;

/** What this deployment says, beside the UI: whether studies run in the page, and where the library is. */
async function settings(): Promise<Config> {
  const response = await fetch(new URL('config.json', document.baseURI), { cache: 'no-cache' })
    .catch(() => { throw new Error("Cannot reach this site's settings. Check the connection."); });
  if (!response.ok) throw new Error(`This site's settings could not be read (${response.status}).`);
  return await response.json() as Config;
}
// Asked once, while the UI mounts. A failure is the failure of each service that waits on it, and is asked again with them.
let asked: Promise<Config> | undefined;
const config = () => asked ??= settings().catch((cause: unknown) => { asked = undefined; throw cause; });
config().catch(() => {});

mountUi(document.getElementById('app')!, {
  // Each solver is a chunk of its own, loaded only where the settings ask for it.
  solver: async signal => {
    const { gridkit } = await config();
    return gridkit
      ? (await import('@gridkit/solver/wasm')).connect({ module: new URL(gridkit, document.baseURI).href }, signal)
      : (await import('@gridkit/solver/http')).connect({ base: beside('solver') }, signal);
  },
  library: async signal => {
    const { library: named } = await config();
    return library({ base: named ? new URL(named, document.baseURI).href : beside('library') }, signal);
  },
});
