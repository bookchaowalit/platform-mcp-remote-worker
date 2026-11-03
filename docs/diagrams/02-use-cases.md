# 02 — Use cases

Actor มาจากระดับสิทธิ์จริงในโค้ด: ผู้ถือ `SOLO_MCP_REMOTE_TOKEN` (hash ใน `MCP_TOKEN_SHA256`) คือ client เดียวที่
เรียก `/mcp` ได้ ผู้ไม่มี token เรียกได้แค่ `GET /healthz` ผู้ดูแลใช้ `manage.py` กับ Cloudflare และ Infisical
ระบบภายนอกที่ Worker เรียกต่อเป็น secondary actor

```mermaid
flowchart LR
  agent(["Agent with MCP token (Claude Code, Codex, cloud session)"])
  anon(["Unauthenticated caller or uptime probe"])
  admin(["Owner as operator (manage.py)"])
  rotate(["Hosted token-rotate job (platform-empire)"])
  cells(["Cell APIs via edge gateway"])
  identity(["platform-identity token endpoint"])
  legacy(["AI gateway, Agency CRM, Income CRM"])

  subgraph worker["solo-empire-mcp-remote Worker"]
    uc1(["List cells and token state"])
    uc2(["Describe a cell's operations"])
    uc3(["Call a cell operation"])
    uc4(["Check upstream health"])
    uc5(["Read AI status or CRM workspace"])
    uc6(["List configured legacy services"])
    uc7(["Health probe /healthz"])
  end
  subgraph ops["Operator scripts"]
    uc8(["Bootstrap client token in Infisical"])
    uc9(["Deploy code and secrets"])
    uc10(["Configure Codex client"])
    uc11(["Run live smoke"])
  end

  agent --> uc1
  agent --> uc2
  agent --> uc3
  agent --> uc4
  agent --> uc5
  agent --> uc6
  anon --> uc7
  admin --> uc8
  admin --> uc9
  admin --> uc10
  admin --> uc11
  rotate -- "pushes EMPIRE_OWNER_MCP_TOKEN secret" --> uc3
  uc2 --> cells
  uc3 --> cells
  uc3 -- "platform-* cells only" --> identity
  uc4 --> legacy
  uc5 --> legacy
```

Sources: src/worker.ts (`serverFor`, `registerCellTools`, `handleRequest`), manage.py (`main` actions), verify.py,
README.md (rotation job), ops record: hosted-shared-services (2026-11-03)

| Use case | Tool / entry | Guard in code |
|---|---|---|
| List cells | `list_cells` | MCP token |
| Describe cell | `describe_cell` | MCP token; GET `/openapi.json` without cell token; cache 5 min |
| Call cell | `call_cell` | MCP token; methods GET/POST/PATCH/PUT; `/v1/` path; `MCP_READONLY` |
| Upstream health | `check_remote_services` | MCP token; status only |
| Read legacy | `get_ai_status`, `get_agency_workspace`, `get_income_workspace` | MCP token + upstream read token |
| Health probe | `GET /healthz` | none; 200 only when auth + `PUBLIC_ORIGIN` configured |

## Open questions

- ไม่มี role แยกใน Worker (ทุก client ที่ถือ token ได้สิทธิ์เท่ากัน) — ตั้งใจหรือรอ per-client token?
