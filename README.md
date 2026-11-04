# GridKit Editor

A browser editor for GridKit cases, with simulation, live plots, and network playback.

## Develop

Requires the Node in `.node-version` and the pnpm in `package.json`, Docker to run the services, and Go to test the solver.

```sh
cp .env.example .env            # once: your settings, never committed
pnpm install
pnpm dev                        # the editor in a browser
pnpm check && pnpm test
pnpm e2e                        # browser tests, on this machine; with GridKit's runtime image here, one simulates natively
go -C services/solver test ./...
```

**Check** runs on every push to main and every pull request: types, unit and Go tests, and the whole stack's smoke run with
each service requiring its token. Browser tests stay on developers' machines.

## Services

The editor works alone; its services add to it. Each deployment (the dev server, the editor container, and the static site)
mounts each service it has at `api/<name>/`, which the service sees as its own root, and adds the service's
token to what it forwards. Pages never see a token. A deployment answers 404 for a service it has none of, and the editor then
offers nothing that needs it. Each also writes `config.json` beside the editor, which says where studies run: in the page
(`gridkit`), or on the solver service.

| Service | Answers | Set with |
| --- | --- | --- |
| `solver` | Runs a GridKit simulation and serves what it records | `GRIDKIT_SOLVER_URL`, `GRIDKIT_SOLVER_TOKEN` |
| `library` | Case files to open: `GET <folder>/` lists a folder as JSON, `GET <path>` is a file | `GRIDKIT_LIBRARY_URL`, `GRIDKIT_LIBRARY_TOKEN` |

A blank address means this machine's own, at its port in `.env`; while that one isn't running, the editor behaves as if it
had none, and offers it once it starts. The static site runs studies in the page and mounts only the library, through its
binding to the library Worker.

```sh
docker compose up --build -d --wait           # editor at :8080, solver at :8081, library at :8082
docker compose up solver library -d --wait    # the services alone, for pnpm dev
pnpm smoke                                    # library cases, real studies, and native models through the stack
```

Before other machines use a solver, put HTTPS in front of it, set a token, and add its name to `GRIDKIT_SOLVER_HOSTS`.
`node packages/editor/tests/scrub.probe.ts` measures scrubbing a recorded run.

## Library

**Open from library…** on the welcome page finds and opens a case, folders and all. The local library serves the files in
`GRIDKIT_LIBRARY_DIR`, mounted read-only, with no build, manifest, or restart: add or replace files there, or point it at
your own folder. The checkout's `library/` is the default: GridKit's phasor-dynamics cases from its develop branch (not its
Toy cases, nor its 25k and 70k networks), as one flat folder of `.case.json` files, the same files as the hosted library. Everything in it is readable by
whoever reaches the library; `GRIDKIT_LIBRARY_TOKEN` makes it private to the deployments that hold the token.

To publish shared Favorites, put an optional `library.json` beside the case files:

```json
{
  "favorites": ["WECC240.case.json", "ACTIVSg2000.case.json"]
}
```

Paths are relative to the library root and may include folders. Favorites show a star in the ordinary case list;
folders and cases keep their usual order. Update a favorite's path when its file moves. Without this file, browsing works
as before. Invalid favorites show a warning without blocking browsing.
The local and hosted libraries use the same file; changing it requires no editor build or service restart.

On Cloudflare, `services/library/worker.ts` answers the same from an R2 bucket. Once, with `wrangler login`:

```sh
pnpm exec wrangler r2 bucket create gridkit-library
for f in library/*.case.json library/library.json; do
  [ -f "$f" ] || continue
  pnpm exec wrangler r2 object put "gridkit-library/${f#library/}" --file "$f" --content-type application/json --remote
done
pnpm deploy:library                                                    # the static site binds it by name
```

Upload files to the bucket to change the hosted library, as you add them to `library/` here. To make it private, `wrangler secret put GRIDKIT_LIBRARY_TOKEN` for both
Workers (`services/library` and `apps/static`).

## Release

| | |
| --- | --- |
| Web | `pnpm deploy:web` builds the static site (`apps/static/build.ts`: the editor, GridKit from `GRIDKIT_WASM_IMAGE`, its config and headers) and publishes it to the domain in `apps/static/wrangler.jsonc`; `pnpm preview:web` uploads a version of the same Worker, with its secrets, to its `preview` address without changing production |
| Library | `pnpm deploy:library` publishes `services/library/worker.ts` over its R2 bucket |
| Images | Push a tag `v…`. **Release** pushes `gridkit-editor`, `gridkit-solver`, and `gridkit-library` to `ghcr.io`, each tagged with it, once the stack they make passes its smoke run |

## Layout

| | |
| --- | --- |
| `packages/editor` | The Svelte editor, its tests, and its dev server; built once, the same for every deployment |
| `packages/library` | GridKit's cases (the format, the models, the case document, GridKit's study and compile) and where they are kept: `./http` (a library service), `./file` (a folder) |
| `packages/solver` | What runs studies, wherever GridKit runs: the contract, `./http` (the solver service), `./wasm` (GridKit in the page) |
| `apps/static` | The static site on Cloudflare: GridKit in the page, the library through a binding |
| `apps/container` | The editor image: Caddy serving the editor and mounting its services |
| `services/solver` | The Go API around GridKit, and its image |
| `services/library` | The library: its image (Caddy over a read-only folder) and its Cloudflare Worker (over R2) |
| `library` | GridKit's phasor-dynamics cases: the local library's default folder, the hosted library's contents, and the cases the tests run on |

## License

[BSD-3-Clause](LICENSE). The solver image also carries the licenses in `services/solver/licenses`.
