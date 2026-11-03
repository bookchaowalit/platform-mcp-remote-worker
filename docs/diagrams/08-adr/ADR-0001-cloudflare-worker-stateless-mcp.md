# ADR-0001 — Host the remote MCP as a stateless Cloudflare Worker

- Status: accepted (retro-documented)
- Date of evidence: 2026-10-04 (first commit `f84f878`), still true at `0a0e32d`

## Context

agent ต้องการ MCP endpoint ที่ URL คงที่ข้ามแชตและ restart โดยไม่ต้องเปิดเครื่องหลักค้างไว้ MCP เดิม
(`solo-empire/infra/mcp-server/`) เป็น local และพึ่ง SQLite/filesystem

## Decision

ใช้ Cloudflare Worker `solo-empire-mcp-remote` (`workers_dev = true`) เสิร์ฟ MCP Streamable HTTP แบบ stateless JSON
(`sessionIdGenerator: undefined`, `enableJsonResponse: true`) สร้าง `McpServer` ใหม่ทุก request ไม่มี storage binding
หรือ cron Worker เป็นช่องทางเรียก API ที่ host แล้วเท่านั้น ไม่รวม business runtime

## Evidence

- wrangler.toml: `name`, `main = "src/worker.ts"`, `workers_dev = true`, ไม่มี binding
- src/worker.ts `handleRequest`: "A fresh SDK server/transport for every request avoids isolate or laptop state"
- README.md ขอบเขต; central ADR-0003 alternative "Revive empire-mcp (Railway) ... Worker already serves MCP with auth on the free plan"
  ([ADR-0003](https://github.com/bookchaowalit/architecture-docs/blob/main/docs/architecture/decisions/ADR-0003-hosted-shared-services.md))

## Consequences

- ไม่มีข้อมูลต้อง backup (ดู 14) และ in-memory cache หายเมื่อ isolate ใหม่
- tool ที่พึ่ง SQLite/filesystem ไม่ย้ายมา
- Deploy แยกจาก CI (ดู ADR-0003)
