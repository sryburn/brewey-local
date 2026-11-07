# Persistence and brewing operations

`database.ts` uses Node 24's built-in SQLite with WAL, foreign keys, transactional migrations and ownership indexes. Schema 4 stores local accounts, profiles, recipes, PAT records and durable conversations. Runtime data belongs in a private named volume or ignored `.runtime/` directory.

`BrewingApplication` is the authenticated domain boundary for browser, HTTP, MCP and chat operations. It applies capability and ownership checks, validates metric fields and uses the private repository and deterministic calculations. Transports must never accept client-provided ownership or call repositories directly. Account and agent settings remain session-authenticated.

`style-catalog.json` supplies only beer-style names, IDs and brewing statistics. New databases start with empty ingredient tables. Administrator setup uses `ingredient-setup.ts` to download and atomically import ingredients and style descriptions; retries preserve recipe-referenced ingredients and existing style text. `reference-catalog-updates.json` retains guarded metadata corrections for supported older databases. `ingredient-migration-index.json` contains identity selectors for hosted exports. Run `python3 scripts/check-catalog.py` from the root to check the public metadata boundary. See [NOTICE](../../../../NOTICE.md) for source terms.

`database-backup.ts` owns backup validation, staged upgrades and atomic restore. Preserve supported schema references and rollback tests. `hosted-backup.ts` creates isolated, owner-scoped exports through `BrewingApplication`; it never uses an installation's live database. `migration.ts` contains synthetic snapshot helpers used by persistence fixtures, not a public transport.

`tool-metadata.json` declares metric/imperial brewing tool schemas. The tool adapter converts units at the boundary; persistence and HTTP quantities remain metric. See [architecture](../../../../docs/application-architecture.md), [conversations](../../../../docs/conversations.md), and [backup compatibility](../../../../docs/hosted-migration.md).
