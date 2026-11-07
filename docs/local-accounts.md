# Local accounts and recovery

Brewey authenticates browser users with a local username/password and an HttpOnly session cookie. Email is optional; no SMTP service or reset emails are used. Existing email/password sign-ins continue to work after the schema v2 migration. User UUIDs, password hashes, recipes, profiles, preferences, sessions and agent homes retain their ownership.

On an empty, never-configured installation, `/signup` creates the first owner account. The operation checks first setup atomically, so two simultaneous requests cannot create two owners. Once configured, public signup is closed. An explicit `DISABLE_SIGNUP=true` also prevents first setup. Deleting users never reopens public signup.

The earliest existing account (ordered by creation time, then UUID) becomes the administrator during migration. Existing accounts receive deterministic usernames from their email prefix, with numeric suffixes for collisions. They can see their username in Account settings. The migration does not change their password.

Administrators can use **Settings → Users** or the session-authenticated `GET`/`POST /api/admin/users` endpoints to list/create accounts, including another administrator. New users receive an initial password from the administrator outside Brewey; no email is sent. Role flags come from the account record, never editable user preferences or PAT scopes. The last administrator cannot delete their account until another administrator exists.

## Operator password recovery

Back up the database using the existing SQLite backup procedure before recovery. Run the command as the installation operator with access to that installation's database. It changes one local account's password and revokes **all of that account's browser sessions**. User IDs, usernames, administrator role, recipe data, preferences, PATs and agent credentials stay intact.

From a checkout with Node 24 and frontend dependencies installed:

```sh
node ops/recover-account.mjs --database /absolute/path/brewey.sqlite --user USERNAME_OR_EXISTING_EMAIL
```

The terminal prompt hides the password. Passwords are never accepted as command arguments, echoed or printed in results. Automated recovery can use `--password-stdin` with a private pipe or protected secret file; keep the password out of shell history and command arguments. The command requires an existing explicit database path and does not create accounts.

The production runtime can run the same CLI when `ops/recover-account.mjs` is included in the image:

```sh
docker compose exec -it web node ops/recover-account.mjs --database /var/lib/brewey/brewey.sqlite --user USERNAME_OR_EXISTING_EMAIL
```

A successful command reports only that the password changed and sessions were revoked. The user must sign in again with the new password. Recovery is an operator CLI, not an unauthenticated HTTP endpoint.

## Personal access token capabilities

REST `/api/v1` and MCP `/api/mcp` use the same bearer PAT permissions:

| Permission | Access |
| --- | --- |
| `recipes:read` | Own recipe library, detail, calculations and exports |
| `recipes:write` | Create, edit, clone and delete own recipes; includes recipe reads |
| `catalog:read` | Reference ingredients and beer styles |
| `profile:read` | Own brewing profile and measurement preferences |
| `profile:write` | Update own brewing profile/preferences; includes profile reads |

Permissions are independent except the matching write→read implication. Recipe writes do not grant catalogue/profile access. Tokens never grant account, administrator, token-management or agent-connection settings access. New tokens default to recipe/catalog reads; creation and editing let the owner choose capabilities explicitly.

Legacy `api` or `mcp` transport scopes granted full brewing access, so schema v2 maps either to all five capabilities without changing the token secret/hash, owner, expiry, revocation or rate counter. New token requests must use domain capabilities. The existing ownership, expiry/revocation and per-token rate limits remain enforced. Validated PAT responses include `X-RateLimit-Limit`, `X-RateLimit-Remaining` and `X-RateLimit-Reset` (Unix seconds); quota errors also include `Retry-After`.

## Desktop identity boundary

Account records reserve an identity provider and external subject for a future native desktop identity. Only local password authentication is implemented. An `os` identity record cannot sign in with the local password route. No host headers, loopback address or environment flag bypasses authentication.
