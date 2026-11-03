# ADR-0002 — Generic tool hub (list/describe/call) behind a fixed host allowlist and the edge gateway

- Status: accepted (retro-documented)
- Date of evidence: 2026-10-18 (PR #2 `915bc01`), gateway move 2026-11-03 (`cc8492d`)

## Context

มี cell API หลายสิบตัว การมี MCP tool ต่อ operation จะได้ tool หลายร้อยตัว และการให้ config ชี้ URL อิสระจะทำให้ hub
เป็น open proxy

## Decision

- tool ทั่วไป 3 ตัว: `list_cells`, `describe_cell` (ย่อ `/openapi.json`), `call_cell`
- base URL ใน `CELLS` (wrangler `[vars]`) ต้องเป็น HTTPS origin ใน `CELL_HOSTS` ที่ fix ในโค้ด หรือรูป
  `https://gateway.bookchaowalit.com/v1/<system>` เท่านั้น (`cellBase`, `GATEWAY_ROUTE`); entry อื่นถูกตัดและแสดงใน `rejected`
- `call_cell` จำกัด GET/POST/PATCH/PUT (ไม่มี DELETE), path `/v1/...` ไม่มี traversal/`%`/query, body ≤ 64 KiB,
  ไม่ตาม redirect, deadline 15 s, อ่าน ≤ 2 MiB, คืน ≤ 100 KiB หลัง redact, `MCP_READONLY` จำกัด GET
- ตั้งแต่ 2026-11-03 ทุก cell ผ่าน edge gateway; rollback = ใส่ direct origin กลับใน `CELLS`

## Evidence

src/worker.ts (`CELL_HOSTS`, `GATEWAY_ORIGIN`, `cellBase`, `cellPath`, `CELL_METHODS`, limits), wrangler.toml comments,
tests/worker.test.ts ("host allowlist ...", "gateway bases ...", "wrangler CELLS routes every own cell through the gateway"),
central ADR-0003 decision 4, ops record: api-gateway-edge (2026-11-03)

## Consequences

- เพิ่ม cell = แก้ `CELLS` + `CELL_HOSTS` (+ `PLATFORM_CELLS` สำหรับ platform) และ redeploy; test บังคับให้ตรงกัน
- `call_cell` เขียนได้ จึงมี annotation `destructiveHint: true`
