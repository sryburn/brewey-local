# Moving your library and restoring backups

## From hosted Brewey

At [app.brewey.ai](https://app.brewey.ai), open Settings → Move to local. Choose a local administrator username and password, then download the backup. These credentials are for your local installation; your hosted sign-in is unchanged. Social-login users also choose local credentials here.

Start a fresh local installation, choose Restore a Brewey backup, select the downloaded file and check the preview. Confirm restore, wait for Brewey to restart, then sign in with the credentials you chose when downloading. Reconnect ChatGPT in Settings → Chat.

The hosted download contains your recipes and their ingredients, water additions, mash and fermentation steps, brewing/tasting notes, brewing profile and unit preference. It creates one local administrator. It excludes hosted conversations, billing, sessions, API tokens, other users and provider credentials. Recipes retain their timestamps; local account and recipe identifiers are newly generated. Check your library and save a local backup before discontinuing hosted access.

A downloaded file can be restored without contacting hosted Brewey. Migration replaces a fresh installation; it does not merge libraries. Use native recipe import for adding individual recipes to an existing library.

## Local backups

Administrators can download the entire local installation through Settings → Backup → Save backup. Local backups include all installation accounts, password hashes, profiles, recipes, saved conversations, settings and PAT records. They are private files; do not post them in bug reports. External provider credentials, native provider files and deployment configuration are not included.

To replace an existing installation, use Settings → Backup → Restore backup. Review the preview and confirm the replacement. All current installation data is replaced, everyone is signed out, native chat bindings are cleared and restored running turns become interrupted. A private safety copy is retained before replacement. Reconnect providers when moving machines.

Restore accepts standalone SQLite backups up to 100 MiB, with supported schemas 2–4. Older supported schemas are validated and upgraded in a private staged copy. Newer schemas require updating Brewey first. Schema 1 is not supported by browser restore. Invalid files leave the existing installation unchanged.

Restore restarts the application. Docker Compose restarts it automatically; a manually launched development process must be restarted manually. Sign in with credentials contained in the restored backup. The first-run restore option is available only before initial owner setup and while setup is enabled.

## Maintaining compatibility

The hosted exporter uses the same typed application core and calculations as the local application, with an isolated database per export. It rejects foreign ownership, unsupported records and calculation mismatches. The exporter entry point is `frontend/src/lib/server/hosted-backup.ts`; `scripts/sync-hosted-backup-core.py` can copy its exact dependency closure into an explicitly supplied hosted frontend checkout. It must not discover services or credentials automatically.

Hosted downloads contain only the ingredients referenced by the exported recipes, rather than the old full ingredient seed. Recognised ingredients use the new catalogue's stable IDs, selected by reviewed name/origin/form/producer identifiers, not the old reference UUIDs. Unknown or previously excluded ingredients used by a recipe are retained with stable private IDs. Aliases with identical brewing properties merge; conflicting properties remain separate. Source brewing values are retained for calculation compatibility.

After restoring and signing in, open **Settings → Ingredients → Download ingredients** to add the rest of the catalogue. Restored recipes work before downloading and if a source is unavailable. Retrying adds available records without replacing ingredients already used by recipes. No hosted database ingredient IDs are changed by exporting.

Preserve `createSchemaReference(version)` and restore fixtures for supported backup schemas. A release must pass synthetic export → first-run restore → sign-in → local backup → second restore, and a browser/container rehearsal with disposable accounts, before migration is announced as ready.
