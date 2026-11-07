# Working with Brewey

Brewey is provided as-is. Forks are welcome, but outside code contributions and pull requests are not currently accepted. GitHub Issues can be used for bug reports and suggestions; there is no commitment to respond, fix problems or maintain the project.

For a bug report, include the Brewey version, Docker platform, reproduction steps and expected/actual behavior. Use synthetic examples. Do not attach database backups, credentials, tokens or private chat/recipe exports. Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

To develop your own fork, use Node 24.15 or newer within 24.x and Python 3.10+ for ingredient setup. Install the `zstd` executable when Python lacks native Zstandard support (before Python 3.14):

```sh
cd frontend
npm ci
```

Copy `frontend/.env.example` to `frontend/.env.local`, choose an absolute private data directory, and run `npm run dev -- --port 3100`. Never reuse desktop agent credentials or a production database.

From `frontend/`, verify changes with:

```sh
npm test -- --runInBand
npm run test:storage
node --test --test-isolation=none ../ops/__tests__/*.node.mjs src/lib/harness/__tests__/*.node.mjs
npm run typecheck
npm run lint
npm run build
python3 ../scripts/check-build-boundary.py
node ../scripts/check-installation.mjs
```

From the repository root, run `python3 -m unittest discover -s scripts/__tests__ -v` and `python3 scripts/check-catalog.py`. These checks validate the public metadata boundary and synthetic conversions without hosted services. Full catalogue downloads and generated data stay in ignored `.runtime/`; see [catalogue maintenance](catalog/README.md).

For a local container build, copy `.env.example` to `.env`, set `BREWEY_IMAGE=brewey-local:development`, and run `docker compose -f compose.yaml -f compose.build.yaml up -d --build`. Keep the same project name and data volume when updating an existing installation.

Read [the architecture](docs/application-architecture.md) and [AGENTS.md](AGENTS.md) before changing authenticated brewing operations. API changes must update the OpenAPI contract and meaningful tests. Database changes must preserve supported restore formats and test failure rollback.

Dependency overrides retain patched KaTeX, glob and minimatch versions where upstream ranges still select affected versions. The React Hooks lint plugin stays on 7.0.1 to preserve the established rule set; review a rule-set upgrade separately. Keep Milkdown packages on matching versions to avoid duplicate context types. Run the full validation sequence after dependency changes.
