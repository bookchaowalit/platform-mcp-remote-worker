# Solo Empire remote MCP

ปลายทาง MCP แบบ Streamable HTTP บน Cloudflare Workers ใช้ URL เดิมข้ามการเปิด
แชตและการ restart โดยไม่ต้องเปิดเครื่องหลักค้างไว้ บริการนี้เป็นช่องทาง agent
สำหรับเรียก API ที่มีเจ้าของและโฮสต์ของตนเอง ไม่ย้าย SQLite หรือรวม business
runtime เข้าด้วยกัน

## สถานะที่ตรวจจริง — 4 ตุลาคม 2026

- Hosted endpoint: `https://solo-empire-mcp-remote.bookchaowalit.workers.dev/mcp`
- SDK client ใหม่เชื่อมต่อ, list และ call ได้; ไม่มี token ตอบ `401`
- Codex bridge process ใหม่เรียก remote ได้ และตั้งค่า user-level config แล้ว
- AI, Agency CRM และ Income CRM ตอบ health `200`; อ่าน workspace ของ CRM
  ทั้งสองได้ การอ่าน AI status ยัง `not_configured` หากไม่มี token ที่ gateway ยอมรับ
- พบ Income read timeout หนึ่งรอบใน smoke test แรก จึงเพิ่ม deadline จาก 8 เป็น
  15 วินาที หลัง deploy รุ่นแก้ไข อ่าน CRM ทั้งสองผ่านจาก client SDK ใหม่สองชุด
  และ bridge process ใหม่ที่ดึงสิทธิ์จาก Infisical โดยไม่ใส่ token ใน config
- ยังไม่ได้สังเกต uptime ต่อเนื่อง 24 ชั่วโมง และยังไม่ครอบคลุม local MCP ทุก tool

ตรวจซ้ำโดยพิมพ์เฉพาะผล protocol/สถานะ ไม่พิมพ์ข้อมูล workspace:

```bash
python3 verify.py
python3 verify.py --bridge
```

## ขอบเขต

| Tool | บริการ | สิทธิ์ |
|---|---|---|
| `list_remote_services` | รายการ upstream และสถานะการตั้งค่า | metadata |
| `check_remote_services` | health ของ AI, Agency CRM และ Income CRM | GET; ไม่คืน body |
| `get_ai_status` | Central AI Gateway | GET `/api/ai/status` |
| `get_agency_workspace` | Agency CRM | GET workspace |
| `get_income_workspace` | Income CRM | GET workspace |
| `list_cells` | รายชื่อ cell ใน tool hub, host และสถานะ token | metadata |
| `describe_cell` | operation ย่อจาก `/openapi.json` ของ cell (cache 5 นาที) | GET สาธารณะ; ไม่ส่ง token |
| `call_cell` | cell API ใต้ `/v1/` ของ cell ใน allowlist | GET/POST/PATCH/PUT ด้วย token `owner-mcp`; ไม่มี DELETE |

MCP เดิมใน `solo-empire/infra/mcp-server/` ยังเป็น local และมีเครื่องมือเพิ่มเติมที่พึ่ง
SQLite, filesystem และ Python เครื่องมือเหล่านั้นไม่ได้กลายเป็น hosted โดย
อัตโนมัติ การเพิ่ม upstream ต้องมี API ที่ deploy แล้วและผ่านการตรวจสิทธิ์ก่อน
ไม่มี arbitrary HTTP proxy, remote shell, การส่งข้อความ หรือ AI generation
ในปลายทาง remote รุ่นนี้ (`call_cell` เรียกได้เฉพาะ host ที่ fix ไว้ในโค้ด ดู Tool hub)

## Tool hub

Tool hub ทำให้ Claude/Codex บนเครื่องใดก็ได้หรือ cloud session เข้าถึง cell API
ของ Solo Empire ทุกตัวผ่าน endpoint เดียว
`https://solo-empire-mcp-remote.bookchaowalit.workers.dev/mcp` โดยไม่ต้องตั้ง MCP
แยกต่อ cell ลำดับที่ agent ควรใช้: `list_cells` → `describe_cell(cell)` →
`call_cell(cell, method, path, query?, body?, idempotency_key?, if_match?)`

รายชื่อ cell อยู่ใน `CELLS` ของ `wrangler.toml` (JSON ชื่อ → HTTPS base URL;
27 cell ของเจ้าของ + `tasks` = tasks-api ของ platform-empire; ไม่มีระบบของลูกค้า
และไม่มี CRM ที่ใช้ token แบบอื่น) เพิ่ม cell ใหม่ต้องแก้ทั้ง `CELLS` และ
`CELL_HOSTS` ใน `src/worker.ts` เทสต์บังคับให้สองที่ตรงกันพอดี

### เชื่อม agent

Claude Code (เครื่องใดก็ได้): config เก็บแค่ชื่อตัวแปร `${SOLO_MCP_REMOTE_TOKEN}`
(ใส่ single quote เพื่อไม่ให้ shell แทนค่า) Claude Code แทนค่าตอนเชื่อมต่อ token
จริงจึงไม่ถูกเขียนลง `~/.claude.json` ก่อนเปิด session ให้ export ค่าจาก Infisical `/mcp`
(หรือตั้งเป็น environment variable ของ cloud environment):

```bash
claude mcp add --transport http solo-empire https://solo-empire-mcp-remote.bookchaowalit.workers.dev/mcp --header 'Authorization: Bearer ${SOLO_MCP_REMOTE_TOKEN}'
export SOLO_MCP_REMOTE_TOKEN="$(infisical secrets get SOLO_MCP_REMOTE_TOKEN --path /mcp --plain --silent)"
```

Codex: `python3 manage.py configure --endpoint https://solo-empire-mcp-remote.bookchaowalit.workers.dev/mcp`
เพิ่ม entry `solo-empire-remote` ที่รัน `launch.py` ซึ่งดึง token จาก Infisical
ตอนเริ่ม ไม่มีค่า token ใน `~/.codex/config.toml`

Cloud session (Claude Code บนเว็บ, CI agent): ตั้ง `SOLO_MCP_REMOTE_TOKEN` เป็น
secret/env var ของ environment นั้น แล้วใช้คำสั่ง `claude mcp add` ด้านบน (หรือ
`.mcp.json` ที่อ้าง `${SOLO_MCP_REMOTE_TOKEN}`) ห้าม commit ค่า token

### Security model

- สองชั้นของสิทธิ์: client ต้องมี `SOLO_MCP_REMOTE_TOKEN` (Worker เก็บแค่ SHA-256)
  และ Worker เรียก cell ด้วย delegated JWT `owner-mcp` (RS256; `aud` ทุก cell;
  scope อ่าน/เขียน ไม่มี delete/approve) ใน secret `EMPIRE_OWNER_MCP_TOKEN`
  cell เป็นผู้ตัดสินสิทธิ์สุดท้ายและเห็น channel `X-Empire-Channel: mcp`
- ไม่มี proxy อิสระ: base URL ต้องเป็น HTTPS origin และ host ต้องอยู่ใน
  `CELL_HOSTS` ที่ fix ในโค้ด entry อื่นถูกตัดทิ้งและแสดงใน `rejected`
- `call_cell`: method เฉพาะ GET/POST/PATCH/PUT (ไม่มี DELETE); path ต้องขึ้นต้น
  `/v1/` ไม่มี `..`, `//`, scheme/host, `%`, query string; query เป็น object แบน
  (string/number/bool); body เป็น JSON object ไม่เกิน 64 KiB; ไม่ตาม redirect;
  deadline 15 วินาที; อ่าน response ได้ไม่เกิน 2 MiB (เกินตอบ `response_too_large`);
  redact ก่อนแล้วจึงตัดรายการใน list ให้เหลือไม่เกิน 100 KiB พร้อม `truncated`,
  `items_returned`, `items_total` (ถ้าตัด list ไม่ได้จึงคืน `preview` ข้อความที่ redact แล้ว)
- tool annotation ของ `call_cell` เป็น `destructiveHint: true` เพราะ PUT/PATCH เขียนทับได้
- token ไม่ออกใน output: ค่า token ถูก redact จากทุก string, key ที่ชื่อคล้าย
  token/authorization ถูกแทนด้วย `[redacted]` และ error ของ fetch ไม่ถูกส่งต่อ
- `MCP_READONLY = "1"` ใน `[vars]` จำกัด `call_cell` ให้ GET อย่างเดียว
- ถ้ายังไม่มี `EMPIRE_OWNER_MCP_TOKEN` (ก่อน rotation job รอบแรก) `call_cell`
  ตอบ `not_configured` โดยไม่เรียก cell; `describe_cell` ยังใช้ได้เพราะ
  `/openapi.json` เป็นสาธารณะ
- Token `owner-mcp` หมุนทุกสัปดาห์โดย hosted rotation job ที่ push เข้า Worker
  ตรง ๆ; `manage.py deploy` ส่งต่อเฉพาะเมื่อ Infisical `/empire-platform` มี
  `EMPIRE_AUTOMATION_TOKEN_OWNER_MCP` ไม่เช่นนั้นข้าม (ไม่ลบค่าที่ job push ไว้)

## การยืนยันตัวตนและ client

เก็บ `SOLO_MCP_REMOTE_TOKEN` ใน Infisical `/mcp` เท่านั้น Worker รับเพียง
SHA-256 hash ใน binding `MCP_TOKEN_SHA256` ข้อมูล discovery ไม่มี secret
`PUBLIC_ORIGIN` ต้องตรงกับ origin ที่ deploy; browser Origin ถูกปฏิเสธหาก
ไม่ได้ allowlist เครื่องมืออ่านข้อมูลต้องมี upstream token ที่ service นั้น
ยอมรับ จึงต้องทดสอบ read endpoint เพิ่มจาก public health

Codex ใช้ `launch.py` และ `bridge.mjs` เป็นตัวเชื่อม protocol ที่ดึง token จาก
Infisical เมื่อเริ่ม client ไม่มี `npx` และไม่มี token ฝังใน config งานและข้อมูล
อยู่บน hosted APIs เครื่องใหม่ต้องติดตั้ง package นี้และยืนยันตัวตน Infisical
ครั้งแรก หลังจากนั้นใช้ config เดิมได้จนกว่าสิทธิ์ของ secret manager จะหมดอายุ
หาก session หมดอายุยังต้อง login secret manager ใหม่; ไม่อ้างว่า auth ไม่มีวัน
หมดอายุ Client ที่รองรับ HTTPS โดยตรงใช้ endpoint `/mcp` กับ Bearer token จาก
secret manager ของ client ได้

## ตรวจและ deploy

```bash
npm ci
npm test
npm run typecheck
npm run build
python3 tests/manage_test.py
python3 manage.py status
python3 manage.py bootstrap
python3 manage.py deploy
python3 manage.py configure --endpoint https://solo-empire-mcp-remote.bookchaowalit.workers.dev/mcp
```

`status` ตรวจ provider และพิมพ์ชื่อ plan/สถานะโดยไม่เปิดเผยค่า secret
`bootstrap` สร้าง key เฉพาะเมื่อยืนยันได้ว่าไม่มีอยู่ และบันทึกใน Infisical
พร้อม readback ก่อนนำไปใช้ `deploy` ใช้ Cloudflare account/token ผ่าน runtime
resolver; secrets ส่งให้ Wrangler ผ่าน stdin ไม่ผ่าน command arguments
deploy แรกยังตอบ `503` จนกว่าจะมี auth hash บริการนี้ไม่มี storage binding,
cron หรือการ provision VPS และไม่เปลี่ยน service เดิม

Upstream credentials ที่ยังอ่านไม่ได้จะแสดง `not_configured` ไม่มีการสมมติว่า
public health `200` ยืนยันการเข้าถึงข้อมูล เครื่องมือรอได้สูงสุด 15 วินาทีต่อ
upstream จำกัด input 64 KiB และ output 512 KiB ไม่ติดตาม redirect และไม่คืน
error body ของ provider

การตรวจ URL จริงต้องครอบคลุมไม่มี token `401`, SDK initialize/list/call,
client ใหม่ที่ URL เดิม และการอ่าน upstream ที่มี token บันทึกผลเฉพาะ metadata
การสังเกตความพร้อมต่อเนื่อง 24 ชั่วโมงต้องมีหลักฐานแยกจาก smoke test รอบเดียว

Rollback: ปิด client entry `solo-empire-remote` และย้อน Worker version ของ
`solo-empire-mcp-remote` ผ่าน Cloudflare deployment history การ rollback ไม่
ต้องเปลี่ยน database หรือ service ของ upstream


## Sentry

`src/sentry.ts` เป็นสำเนาของ `~/work/b-tier-b/sentry-ref/sentry.ts` (repo นี้เป็นเจ้าของสำเนาเอง)
ปรับสำหรับ Worker: `withSentry` ทำงานเฉพาะเมื่อมี secret `SENTRY_DSN`; ถ้าไม่มีเป็น no-op
และพฤติกรรมเหมือนเดิม ส่งเฉพาะ error (ไม่มี tracing, breadcrumbs, trace header ไปยัง cell)
`beforeSend` ลบ request (รวม header `Authorization`), `extra`, user และ context ที่ไม่ใช่ platform
และ redact bearer token/credential ใน message; ไม่แนบ tool arguments ตั้ง DSN ด้วย
`wrangler secret put SENTRY_DSN` (org `personal-yu0`) เทสต์: `tests/sentry.test.ts`,
`tests/sentry-worker.test.ts`

## ที่มา / การย้าย

ย้ายมาจาก `solo-empire/infra/mcp-remote/` (2026-10-11) พร้อมประวัติ git. Worker ที่ deploy แล้ว: `solo-empire-mcp-remote` บน Cloudflare Workers (`wrangler.toml` อยู่ที่ root ของ repo นี้; deploy ผ่าน `python3 manage.py deploy` เท่านั้น).

`manage.py` และ `launch.py` ใช้ `vendor/secret_resolver.py` (สำเนาใน repo นี้ ไม่ต้องพึ่ง checkout อื่น).
ถ้า MCP client ตั้งค่าไว้ที่ `infra/mcp-remote/launch.py` ต้องแก้เป็น path ของ repo นี้ (`<clone>/launch.py`).
