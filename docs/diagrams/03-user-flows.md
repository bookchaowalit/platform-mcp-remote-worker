# 03 — User flows

ไม่มีหน้าเว็บ "user" คือ agent และผู้ดูแล flow ด้านล่างมาจาก route (`/mcp`, `/healthz`), tool และ script จริง

## Flow A — Claude Code (เครื่องใดก็ได้ / cloud session) ใช้ tool hub

```mermaid
flowchart TD
  a1["export SOLO_MCP_REMOTE_TOKEN from Infisical /mcp"] --> a2["claude mcp add --transport http solo-empire .../mcp with header placeholder"]
  a2 --> a3["Session start: initialize over Streamable HTTP"]
  a3 --> a4{"Token hash matches?"}
  a4 -- "no" --> a5["401 unauthorized"]
  a4 -- "yes" --> a6["tools/list: 8 tools"]
  a6 --> a7["list_cells"]
  a7 --> a8["describe_cell(cell)"]
  a8 --> a9["call_cell(cell, method, path, query, body, idempotency_key, if_match)"]
  a9 --> a10{"status"}
  a10 -- "ok" --> a11["Use data, maybe truncated with items_returned"]
  a10 -- "error status" --> a12["isError result: read_only, invalid_path, not_configured, token_error, http_error ..."]
```

Sources: README.md (เชื่อม agent), src/worker.ts (`handleRequest`, `toolResult`, `errorStatuses`)

## Flow B — Codex ผ่าน stdio bridge

```mermaid
flowchart TD
  b1["python3 manage.py configure --endpoint .../mcp"] --> b2["~/.codex/config.toml gets solo-empire-remote entry, no token value"]
  b2 --> b3["Codex starts launch.py"]
  b3 --> b4{"Infisical session valid?"}
  b4 -- "no" --> b5["Exit 1: reauthenticate the secret manager"]
  b4 -- "yes" --> b6["exec node bridge.mjs with token in env, deleted after connect"]
  b6 --> b7["bridge: stdio server to Codex, HTTP client to remote /mcp"]
  b7 --> b8["ListTools and CallTool forwarded, 30 s timeout"]
  b8 --> b9{"Remote error?"}
  b9 -- "yes" --> b10["isError remote_mcp_unavailable"]
  b9 -- "no" --> b11["Remote result returned"]
```

Sources: manage.py (`configure`), launch.py, bridge.mjs

## Flow C — ผู้ดูแล deploy และตรวจ

```mermaid
flowchart TD
  c1["npm ci, npm test, typecheck, build"] --> c2["python3 manage.py status"]
  c2 --> c3["python3 manage.py bootstrap (only if token absent)"]
  c3 --> c4["python3 manage.py deploy: wrangler deploy --var PUBLIC_ORIGIN, then secret bulk via stdin"]
  c4 --> c5["python3 verify.py: no-token 401, two fresh HTTPS clients"]
  c5 --> c6["python3 verify.py --bridge: fresh bridge client"]
```

Sources: README.md (ตรวจและ deploy), manage.py, verify.py, smoke.mjs

## Open questions

- smoke.mjs เรียกเฉพาะ `list_cells` ใน hub (ไม่เรียก `call_cell`) — การตรวจ call ต่อ cell บันทึกไว้ที่ไหนนอกจาก ops record?
