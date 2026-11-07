# Installation and updates

Use Docker Engine with the Compose plugin on Linux, or Docker Desktop configured for Linux containers on Windows/macOS. Brewey's release images target `linux/amd64` and `linux/arm64`.

Source: [sryburn/brewey-local](https://github.com/sryburn/brewey-local). Installation files: [GitHub releases](https://github.com/sryburn/brewey-local/releases). The release workflow publishes images under `ghcr.io/sryburn/brewey-local`; each release's `brewey.env.example` pins the exact image digest. Use that reference rather than guessing a tag or enabling unattended updates to a floating tag. Contributors can also [build from source](../CONTRIBUTING.md).

Download `compose.yaml` and `brewey.env.example` from the chosen release into a dedicated folder. Rename `brewey.env.example` to `.env` and check its pinned `BREWEY_IMAGE`, then run `docker compose pull` and `docker compose up -d`. Browse to `http://localhost:3100` and complete setup. Choose Start fresh to create the first administrator, then download ingredients and BJCP 2021 style descriptions. Style names and brewing statistics work offline. Unavailable external sources leave a partial catalogue; retry through Settings → Ingredients. Alternatively, restore a Brewey backup during setup. Connect your own ChatGPT account in Settings → Chat to use the built-in agent, the primary way to create and edit recipes.

The source checkout also contains `compose.build.yaml` for contributors. It is not needed for prebuilt images. See [development](../CONTRIBUTING.md).

## Configuration

| Variable | Default/purpose |
| --- | --- |
| `BREWEY_IMAGE` | Required versioned image reference from the release |
| `APP_ORIGIN` | `http://localhost:3100`; exact browser origin, without a trailing slash |
| `BIND_ADDRESS` | `127.0.0.1`; limits access to this computer |
| `WEB_PORT` | `3100`; change `APP_ORIGIN` too if you change this port |
| `DISABLE_SIGNUP` | `false`; setting `true` blocks first-owner setup and first-run restore |

Further accounts are administrator-created regardless of `DISABLE_SIGNUP`. SMTP is not required. Each Brewey account connects its own ChatGPT account in Settings → Chat. Model, reasoning and verbosity settings are per account.

## Storage and backups

The Compose project is named `brewey-selfhosted`. Its `codex-state` named volume contains the SQLite database and private per-user agent homes under `/var/lib/brewey`. Keep both names stable when updating an existing installation; changing them can attach an empty volume. Do not share the volume with another running instance.

Use Settings → Backup → Save backup for a standalone SQLite file. It includes accounts, password hashes, recipes, profiles, saved conversations and personal-access-token records. Provider credentials and native agent files are excluded. Protect the file like the installation itself and keep a copy outside the host.

Do not copy a live SQLite database file directly: committed data may still be in its WAL. The administrator download and operator helper both use SQLite's consistent online backup mechanism. See [restore behavior](hosted-migration.md) and [account recovery](local-accounts.md).

For an operator backup without the browser:

```sh
docker compose exec web node ops/backup-sqlite.mjs --database /var/lib/brewey/brewey.sqlite --output /var/lib/brewey/operator-backup.sqlite
```

The helper refuses to overwrite an existing file. Copy it out with `docker compose cp web:/var/lib/brewey/operator-backup.sqlite ./operator-backup.sqlite`, protect that copy, and remove the temporary container-side backup when no longer needed. A copy on the same volume alone does not protect against losing the host.

## Updates and recovery

1. Download and verify a backup. Retain the previous image reference and configuration.
2. Read the new release notes and set `BREWEY_IMAGE` to its exact version.
3. Run `docker compose pull` and `docker compose up -d`.
4. Check `docker compose ps`, sign in, and verify your recipes and settings.

Ordinary restarts and `docker compose down` preserve data. **Never use `docker compose down --volumes` during an update.** Database upgrades run transactionally at startup. An older image may not open a newer schema; rollback requires its matching pre-upgrade database. A safe recovery method is a separate fresh installation running the old image, restoring its compatible backup, then verifying it before switching access. Preserve any newer work first.

## Remote access

Complete initial owner setup on a trusted connection before exposing the service. Set `APP_ORIGIN` to the canonical HTTPS origin and bind the app to an address reachable only by your reverse proxy. Configure DNS and TLS for your environment. [The Caddy example](../ops/caddy-brewey.caddy) uses placeholder names; it does not configure DNS or modify any existing server.

Proxy chat responses without buffering. Set appropriate request timeouts and request-size limits; backups can be up to 100 MiB plus multipart overhead. Keep the proxy and host patched. Brewey has one application process and one local SQLite volume; this Compose configuration is not a multi-replica deployment.

## App shortcuts

An installation agent can create a shortcut appropriate to your operating system that opens the configured address, and arrange for Docker and Brewey to start when needed. This is local setup, not a separate desktop edition. The supplied Compose service restarts automatically while Docker is running, including after a backup restore. Operating-system integration is left to the installer; Windows and macOS shortcut behavior is not tested by this project.
