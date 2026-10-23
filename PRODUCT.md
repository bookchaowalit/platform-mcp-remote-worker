# Solo Empire remote MCP (tool hub) — Product Brief

Status on 2026-10-23: **live, single user.** Cloudflare Worker `solo-empire-mcp-remote` at
`https://solo-empire-mcp-remote.bookchaowalit.workers.dev/mcp`. The owner's Claude Code sessions reach it through
the `solo` plugin. There is no uptime history beyond one-off smoke runs (`verify.py`).

## Who it is for

The owner only, and the AI agents acting for the owner (Claude Code locally or in cloud sessions, Codex through
`launch.py`). It is not a public or multi-tenant service; one bearer token grants access.

## Problem

Each Solo Empire cell is its own hosted API. Without a hub, every agent session would need one MCP entry and one
credential per cell, and anything local (laptop MCP, SQLite) disappears when the laptop is off. The hub gives one
stable HTTPS MCP endpoint that reaches every own cell with a delegated, rotated token.

## What exists

| Capability | Detail |
|---|---|
| MCP endpoint | `POST /mcp`, Streamable HTTP in stateless JSON mode; fresh SDK server per request; no sessions or storage |
| Auth | `Authorization: Bearer <token>`; the Worker stores only its SHA-256 (`MCP_TOKEN_SHA256`) and compares in constant time; wrong/missing token `401`; host and browser `Origin` checked (`403`) |
| Tool hub | `list_cells`, `describe_cell` (compact operations from a cell's `/openapi.json`, cached 5 min), `call_cell` (GET/POST/PATCH/PUT under `/v1/`, no DELETE) over the 28 cells in `CELLS` (`wrangler.toml`); hosts must also be in the fixed `CELL_HOSTS` allowlist in code |
| Delegated token | `call_cell` sends the `owner-mcp` JWT (`EMPIRE_OWNER_MCP_TOKEN`), pushed weekly by the hosted Railway rotation job; cells make the final authorisation decision |
| Older tools | `list_remote_services`, `check_remote_services`, `get_ai_status`, `get_agency_workspace`, `get_income_workspace` (fixed read paths) |
| Limits | 64 KiB input, 15 s upstream deadline, no redirects, 2 MiB read / 100 KiB returned per cell call, secrets redacted from all output |
| `GET /healthz` | `{"status":"ok"}` only when auth and `PUBLIC_ORIGIN` are configured, otherwise `503` |
| Error reporting | Sentry via `@sentry/cloudflare` only when the `SENTRY_DSN` secret is set (errors only; request, headers, tool arguments and breadcrumbs are never sent; see `src/sentry.ts`) |
| Tests | 35 Node tests in `tests/*.test.ts` (auth, routing, tools, redaction, Sentry options and scrub, the exported Worker with and without a DSN) and 6 Python tests for `manage.py`; all upstreams are mocked |

Out of scope: no arbitrary HTTP proxy, no DELETE, no client systems, no local SQLite/filesystem tools, no
messaging or AI generation.

## How it runs and deploys

Cloudflare Workers, `wrangler.toml` at the repo root. CI (`.github/workflows/ci.yml`, shared
`platform-ci-workflows`) runs tests, typecheck, a dry-run bundle and security scans, and never deploys. Deploys are
manual: `python3 manage.py deploy` (code plus secrets from Infisical), or for a code-only change
`wrangler deploy --var PUBLIC_ORIGIN:<origin>` with Cloudflare credentials from Infisical `/cloudflare`, which keeps
the existing secrets. `python3 verify.py` runs the live smoke (unauthenticated `401`, then list and call tools,
printing metadata only). Rollback: `wrangler rollback <version-id>`.

## Limits and risks

- One shared bearer token; anyone holding it can call every cell with the `owner-mcp` scopes.
- `call_cell` can write (POST/PATCH/PUT); set `MCP_READONLY = "1"` to restrict it to GET.
- No continuous uptime monitoring of this Worker is documented here; health is checked by hand.
- Sentry is code-ready but stays off until the owner sets `SENTRY_DSN`.
