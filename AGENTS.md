# Development rules

- Keep brewing operations behind the typed `BrewingApplication`; transports must not bypass domain validation or persistence ownership.
- Derive identity and permissions from verified sessions or personal access tokens. Account, administrator and agent settings require a session.
- SQLite is the runtime database. Preserve supported backup schemas, recipe identities and calculation compatibility.
- Use the `AgentHarness` registry with explicit capabilities and private per-user storage. Never inherit desktop credentials or silently substitute providers.
- Keep credentials, account data and runtime state in named volumes or ignored `.runtime/`; use synthetic fixtures for tests.
- Read `frontend/AGENTS.md` and the bundled Next.js documentation before framework changes.
- Keep `/api/v1`, MCP, chat and OpenAPI contracts aligned. Run relevant tests, typecheck, lint and production build; report any checks not completed.
- Preserve licence notices and review catalogue redistribution evidence before release.
- Repository creation, publication and deployment require explicit owner approval. Work only in this checkout unless separately authorized.
