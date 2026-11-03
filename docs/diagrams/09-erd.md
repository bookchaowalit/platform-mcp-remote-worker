# 09 — ERD

**Status: not_applicable** — Worker ไม่มีข้อมูลที่ persist: wrangler.toml ไม่มี KV, D1, R2, Durable Object หรือ Queue binding
และ README ระบุ "บริการนี้ไม่มี storage binding, cron" ข้อมูลธุรกิจทั้งหมดอยู่ใน cell ปลายทาง (ดู ERD ของแต่ละ cell repo)

เพื่อให้เห็นรูปข้อมูลที่ Worker ถือ ด้านล่างคือ model ของ **config และ cache ใน memory ต่อ isolate** (ไม่ใช่ตารางฐานข้อมูล)

```mermaid
erDiagram
  CELLS_VAR ||--o{ CELL_ENTRY : "JSON map name to base"
  CELL_ENTRY }o--|| ALLOWED_BASE : "must match"
  CELL_ENTRY |o--o| PLATFORM_CELL : "platform-* only"
  PLATFORM_CELL ||--o{ PLATFORM_TOKEN_CACHE : "one per clientId and audience"
  CELL_ENTRY ||--o| DESCRIBE_CACHE : "keyed by base origin"
  CELL_ENTRY {
    string name "a-z0-9- up to 40 chars"
    string base "gateway route or CELL_HOSTS origin"
  }
  ALLOWED_BASE {
    string kind "CELL_HOSTS host or GATEWAY_ORIGIN /v1/system"
  }
  PLATFORM_CELL {
    string audience "e.g. commerce-api"
    string scopes "owner scopes only"
  }
  PLATFORM_TOKEN_CACHE {
    string key "clientId|audience"
    string token "access_token"
    int expires "epoch seconds"
  }
  DESCRIBE_CACHE {
    string origin
    int expires "now + 5 min"
    string result "compact operations"
  }
```

Sources: wrangler.toml, README.md, src/worker.ts (`CELLS` parsing in `cellsFrom`, `CELL_HOSTS`, `PLATFORM_CELLS`,
`platformTokens`, `describeCache`)

## Open questions

- ไม่มี
