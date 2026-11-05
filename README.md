# GridKit Editor

[![CI](https://img.shields.io/github/actions/workflow/status/lukelowry/gridkit-web/check.yml?branch=main&label=CI)](https://github.com/lukelowry/gridkit-web/actions/workflows/check.yml)
[![GridKit develop](https://img.shields.io/badge/GridKit-develop-brightgreen)](https://github.com/ORNL/GridKit/tree/develop)
[![BSD-3-Clause license](https://img.shields.io/badge/license-BSD--3--Clause-blue)](LICENSE)

Edit and simulate [GridKit](https://github.com/ORNL/GridKit) power-system cases in the browser, with live plots and
network playback, at [pdsim.us](https://pdsim.us).

To run it locally, write a `.env`:

```sh
GRIDKIT_EDITOR_PORT=8080
GRIDKIT_LIBRARY_DIR=./library
GRIDKIT_SOLVER_URL=
GRIDKIT_SOLVER_TOKEN=
GRIDKIT_LIBRARY_URL=
```

```sh
docker compose up
```

Then open [localhost:8080](http://localhost:8080). Its library lists the cases in `GRIDKIT_LIBRARY_DIR`.

## Author

[Luke Lowery](https://lukelowry.github.io/), PhD student in the
[Birchfield Research Group](https://birchfield.engr.tamu.edu/) at Texas A&M University ·
[Google Scholar](https://scholar.google.com/citations?user=CTynuRMAAAAJ&hl=en) ·
[ORCID](https://orcid.org/0009-0000-0029-3403)

Also by the author: [gridkit-studio](https://github.com/lukelowry/gridkit-studio), GridKit in VS Code ·
[latkit](https://latkit.readthedocs.io), GPU visualization of large networks.

## License

[BSD-3-Clause](LICENSE). The solver image also carries the licenses in `services/solver/licenses`.

Uses [GridKit](https://github.com/ORNL/GridKit) from Oak Ridge National Laboratory.
