import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';

export interface Env {
  MCP_TOKEN_SHA256?: string;
  PUBLIC_ORIGIN?: string;
  ALLOWED_ORIGINS?: string;
  AI_API_ORIGIN?: string;
  AGENCY_CRM_ORIGIN?: string;
  INCOME_CRM_ORIGIN?: string;
  AI_API_READ_TOKEN?: string;
  AGENCY_CRM_TOKEN?: string;
  INCOME_CRM_TOKEN?: string;
  CELLS?: string | Record<string, unknown>;
  EMPIRE_OWNER_MCP_TOKEN?: string;
  MCP_READONLY?: string;
}

type ServiceId = 'ai' | 'agency' | 'income';
interface Service { id: ServiceId; origin: string | null; token?: string; healthPath: string; readPath: string }
type Result = Record<string, unknown>;
type Fetcher = typeof fetch;
const INPUT_LIMIT = 64 * 1024;
const OUTPUT_LIMIT = 512 * 1024;
const annotations = { readOnlyHint: true, destructiveHint: false, openWorldHint: true };

// Configuration is administrator-owned; tool callers cannot supply URLs or paths.
function httpsOrigin(value?: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' ||
        url.search || url.hash || url.port || !url.hostname.includes('.') ||
        url.hostname.includes(':') || /^\d+(\.\d+){3}$/.test(url.hostname) ||
        /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(url.hostname)) return null;
    return url.origin;
  } catch { return null; }
}

function services(env: Env): Service[] {
  return [
    { id: 'ai', origin: httpsOrigin(env.AI_API_ORIGIN ?? 'https://api.bookchaowalit.com'), token: env.AI_API_READ_TOKEN, healthPath: '/healthz', readPath: '/api/ai/status' },
    { id: 'agency', origin: httpsOrigin(env.AGENCY_CRM_ORIGIN ?? 'https://crm-api-production-a7e0.up.railway.app'), token: env.AGENCY_CRM_TOKEN, healthPath: '/health', readPath: '/api/v1/crm/agency/workspace' },
    { id: 'income', origin: httpsOrigin(env.INCOME_CRM_ORIGIN ?? 'https://crm-api-production-19fd.up.railway.app'), token: env.INCOME_CRM_TOKEN, healthPath: '/health', readPath: '/api/v1/crm/agency/workspace' },
  ];
}

class BodyLimitError extends Error {}
async function boundedText(body: ReadableStream<Uint8Array> | null, limit: number): Promise<string> {
  if (!body) return '';
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel();
        throw new BodyLimitError();
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

function scrubText(value: string, secrets: string[]): string {
  for (const secret of secrets) value = value.split(secret).join('[redacted]');
  return value;
}
// Replaces secret values in every string and property name, without key-based redaction.
function scrub(value: unknown, secrets: string[]): unknown {
  if (typeof value === 'string') return scrubText(value, secrets);
  if (Array.isArray(value)) return value.map(item => scrub(item, secrets));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [scrubText(key, secrets), scrub(item, secrets)]));
  return value;
}
function redact(value: unknown, secrets: string[]): unknown {
  if (typeof value === 'string') return scrubText(value, secrets);
  if (Array.isArray(value)) return value.map(item => redact(item, secrets));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) =>
      [scrubText(key, secrets), /(?:token|password|secret|authorization|cookie|api[_-]?key|credential)/i.test(key) ? '[redacted]' : redact(item, secrets)]));
  }
  return value;
}

async function upstream(service: Service, read: boolean, fetcher: Fetcher, secrets: string[]): Promise<Result> {
  if (!service.origin || (read && !service.token)) return { service: service.id, status: 'not_configured' };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetcher(new URL(read ? service.readPath : service.healthPath, service.origin), {
      method: 'GET', redirect: 'manual', signal: controller.signal,
      headers: read ? { Accept: 'application/json', Authorization: `Bearer ${service.token}` } : { Accept: 'application/json' },
    });
    if (!read || !response.ok) {
      await response.body?.cancel();
      return { service: service.id, status: response.ok ? 'ok' : 'http_error', http_status: response.status };
    }
    const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
    if (contentType !== 'application/json' && !contentType?.endsWith('+json')) {
      await response.body?.cancel();
      return { service: service.id, status: 'invalid_response' };
    }
    const data: unknown = JSON.parse(await boundedText(response.body, OUTPUT_LIMIT));
    return { service: service.id, status: 'ok', data: redact(data, secrets) };
  } catch (error) {
    return { service: service.id, status: error instanceof BodyLimitError ? 'response_too_large' : controller.signal.aborted ? 'timeout' : 'upstream_error' };
  } finally { clearTimeout(timeout); }
}

// --- Tool hub: Solo Empire cell APIs -------------------------------------
// CELLS (wrangler [vars]) maps a cell name to its base URL. Every entry must be
// an HTTPS origin whose host is in this fixed allowlist, so a configuration
// change alone can never turn the hub into a proxy for arbitrary hosts.
export const CELL_HOSTS: readonly string[] = [
  'accounts-api-production-cfee.up.railway.app', 'automation-api-production-af8e.up.railway.app',
  'budgets-api-production-690e.up.railway.app', 'business-assets-api-production.up.railway.app',
  'cash-flow-api-production.up.railway.app', 'content-api-production-bca7.up.railway.app',
  'decisions-api-production-1ef5.up.railway.app', 'diary-api-production-2db8.up.railway.app',
  'finance-accounts-api-production.up.railway.app', 'goals-api-production-c16e.up.railway.app',
  'habits-api-production-e516.up.railway.app', 'health-api-production-c72f.up.railway.app',
  'intake-api-production.up.railway.app', 'investments-api-production.up.railway.app',
  'learning-api-production-3cee.up.railway.app', 'liabilities-api-production.up.railway.app',
  'notifications-api-production-c9d8.up.railway.app', 'operating-api-production.up.railway.app',
  'opportunities-api-production.up.railway.app', 'projects-api-production-f4eb.up.railway.app',
  'radar-api-production-7fe7.up.railway.app', 'reconciliations-api-production.up.railway.app',
  'roles-skills-api-production.up.railway.app', 'subscriptions-api-production-b1d4.up.railway.app',
  'tasks-api-production-4785.up.railway.app', 'tax-api-production-57f6.up.railway.app',
  'time-api-production-2050.up.railway.app', 'transactions-api-production-4078.up.railway.app',
];
// Cells read this header to tell callers apart (cellkit CHANNELS includes "mcp").
const CELL_CHANNEL = 'mcp';
const CELL_METHODS = ['GET', 'POST', 'PATCH', 'PUT'] as const;
const CELL_BODY_LIMIT = 64 * 1024;
const CELL_RESPONSE_LIMIT = 100 * 1024;
const CELL_READ_LIMIT = 2 * 1024 * 1024;
const OPENAPI_LIMIT = 2 * 1024 * 1024;
const DESCRIBE_LIMIT = 48 * 1024;
const DESCRIBE_TTL_MS = 5 * 60 * 1000;
const UPSTREAM_TIMEOUT_MS = 15000;
const hubAnnotations = { readOnlyHint: true, destructiveHint: false, openWorldHint: true };
// PUT/PATCH can overwrite records, so clients must not treat call_cell as additive-only.
const callAnnotations = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true };

interface Cells { cells: Map<string, string>; rejected: string[]; config: 'ok' | 'missing' | 'invalid' }
function cellsFrom(env: Env): Cells {
  const cells = new Map<string, string>();
  const rejected: string[] = [];
  let raw: unknown = env.CELLS;
  if (raw === undefined || raw === '') return { cells, rejected, config: 'missing' };
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch { return { cells, rejected, config: 'invalid' }; }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { cells, rejected, config: 'invalid' };
  for (const [name, value] of Object.entries(raw)) {
    const origin = typeof value === 'string' ? httpsOrigin(value) : null;
    if (/^[a-z][a-z0-9-]{0,39}$/.test(name) && origin && CELL_HOSTS.includes(new URL(origin).hostname)) cells.set(name, origin);
    else rejected.push(/^[a-z0-9-]{1,40}$/.test(name) ? name : '[invalid-name]');
  }
  return { cells, rejected, config: 'ok' };
}

function readOnly(env: Env): boolean { return /^(1|true|yes)$/i.test(env.MCP_READONLY ?? ''); }

// Callers choose only a /v1/ path below a configured cell: no scheme, host,
// traversal, encoded characters, empty segments or query strings in the path.
export function cellPath(path: string): string | null {
  if (path.length > 512 || !/^\/v1(?:\/[A-Za-z0-9_~.-]+)+\/?$/.test(path)) return null;
  if (path.split('/').some(segment => segment === '.' || segment === '..') || path.includes('..')) return null;
  return path;
}

function contentIsJson(response: Response): boolean {
  const type = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  return type === 'application/json' || Boolean(type?.endsWith('+json'));
}

// A cut-off preview could end in the first characters of a secret; drop them.
function dropSecretPrefix(text: string, secrets: string[]): string {
  for (const secret of secrets) {
    for (let length = Math.min(secret.length - 1, text.length); length >= 4; length--) {
      if (text.endsWith(secret.slice(0, length))) { text = text.slice(0, -length); break; }
    }
  }
  return text;
}

const jsonSize = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
// Keeps responses under CELL_RESPONSE_LIMIT: trims list items (top level or one
// level down) and only falls back to a text preview of already-redacted JSON.
function fitResponse(data: unknown, secrets: string[]): Result {
  if (jsonSize(data) <= CELL_RESPONSE_LIMIT) return { data };
  const trim = (items: unknown[]) => {
    const kept: unknown[] = [];
    let size = 2;
    for (const item of items) {
      size += jsonSize(item) + 1;
      if (size > CELL_RESPONSE_LIMIT * 0.9) break;
      kept.push(item);
    }
    return kept;
  };
  if (Array.isArray(data)) {
    const kept = trim(data);
    return { data: kept, truncated: true, items_returned: kept.length, items_total: data.length };
  }
  if (isObject(data)) {
    const listKey = Object.keys(data).filter(key => Array.isArray(data[key]))
      .sort((left, right) => jsonSize(data[right]) - jsonSize(data[left]))[0];
    if (listKey) {
      const items = data[listKey] as unknown[];
      const kept = trim(items);
      const shortened = { ...data, [listKey]: kept };
      if (jsonSize(shortened) <= CELL_RESPONSE_LIMIT) return { data: shortened, truncated: true, truncated_field: listKey, items_returned: kept.length, items_total: items.length };
    }
  }
  // Budget in UTF-8 bytes; a split trailing character decodes as U+FFFD.
  const head = new TextEncoder().encode(JSON.stringify(data)).subarray(0, CELL_RESPONSE_LIMIT / 2);
  return { truncated: true, preview: dropSecretPrefix(new TextDecoder().decode(head), secrets) };
}

async function withDeadline<T>(run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try { return await run(controller.signal); } finally { clearTimeout(timeout); }
}

function failure(cell: string, error: unknown, signal?: AbortSignal): Result {
  return { cell, status: error instanceof BodyLimitError ? 'response_too_large' : signal?.aborted ? 'timeout' : 'upstream_error' };
}

type Operation = { method: string; path: string; summary?: string; params?: string[]; body?: string; body_fields?: string[] };
type JsonObject = Record<string, unknown>;
const isObject = (value: unknown): value is JsonObject => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const clip = (value: unknown, length = 160) => typeof value === 'string' ? value.slice(0, length) : undefined;

function schemaRef(schema: unknown): string | undefined {
  if (!isObject(schema)) return undefined;
  if (typeof schema.$ref === 'string') return schema.$ref.split('/').pop();
  for (const key of ['anyOf', 'oneOf', 'allOf']) {
    const options = schema[key];
    if (Array.isArray(options)) for (const option of options) { const name = schemaRef(option); if (name) return name; }
  }
  return typeof schema.title === 'string' ? schema.title : typeof schema.type === 'string' ? schema.type : undefined;
}

function fieldsOf(spec: JsonObject, name: string | undefined): string[] | undefined {
  const schemas = isObject(spec.components) && isObject(spec.components.schemas) ? spec.components.schemas : {};
  const schema = name ? schemas[name] : undefined;
  if (!isObject(schema) || !isObject(schema.properties)) return undefined;
  const required = new Set(Array.isArray(schema.required) ? schema.required : []);
  return Object.entries(schema.properties).slice(0, 40).map(([field, definition]) =>
    `${field}${required.has(field) ? '' : '?'}:${schemaRef(definition) ?? 'any'}`.slice(0, 80));
}

export function compactOperations(spec: unknown): { operations: Operation[]; omitted: number } {
  const operations: Operation[] = [];
  let omitted = 0;
  if (!isObject(spec) || !isObject(spec.paths)) return { operations, omitted };
  for (const [path, item] of Object.entries(spec.paths)) {
    if (!isObject(item)) continue;
    for (const [method, operation] of Object.entries(item)) {
      if (!['get', 'post', 'patch', 'put', 'delete', 'head', 'options', 'trace'].includes(method) || !isObject(operation)) continue;
      if (!cellPath(path.replace(/\{[A-Za-z0-9_]+\}/g, 'x')) || !(CELL_METHODS as readonly string[]).includes(method.toUpperCase())) { omitted++; continue; }
      const params = (Array.isArray(operation.parameters) ? operation.parameters : [])
        .filter((param): param is JsonObject => isObject(param) && (param.in === 'path' || param.in === 'query') && typeof param.name === 'string')
        .slice(0, 30).map(param => `${param.in}:${String(param.name).slice(0, 60)}${param.required ? '' : '?'}`);
      const content = isObject(operation.requestBody) && isObject(operation.requestBody.content) ? operation.requestBody.content['application/json'] : undefined;
      const body = isObject(content) ? schemaRef(content.schema) : undefined;
      operations.push({ method: method.toUpperCase(), path: path.slice(0, 200), summary: clip(operation.summary),
        ...(params.length ? { params } : {}), ...(body ? { body: body.slice(0, 100), body_fields: fieldsOf(spec, body) } : {}) });
    }
  }
  return { operations, omitted };
}

// Per-isolate cache keyed by the fetch implementation, so tests stay isolated.
const describeCache = new WeakMap<Fetcher, Map<string, { expires: number; result: Result }>>();

async function describeCell(name: string, cells: Cells, fetcher: Fetcher, secrets: string[]): Promise<Result> {
  const origin = cells.cells.get(name);
  if (!origin) return { cell: name, status: 'unknown_cell' };
  let cache = describeCache.get(fetcher);
  if (!cache) { cache = new Map(); describeCache.set(fetcher, cache); }
  const hit = cache.get(origin);
  if (hit && hit.expires > Date.now()) return { ...hit.result, cached: true };
  let signal: AbortSignal | undefined;
  try {
    return await withDeadline(async deadline => {
      signal = deadline;
      const response = await fetcher(new URL('/openapi.json', origin), { method: 'GET', redirect: 'manual', signal: deadline, headers: { Accept: 'application/json' } });
      if (!response.ok || !contentIsJson(response)) {
        await response.body?.cancel();
        return { cell: name, status: response.ok ? 'invalid_response' : 'http_error', http_status: response.status };
      }
      // Scrub secrets before compaction so clipped summaries cannot keep a partial secret.
      const { operations, omitted } = compactOperations(scrub(JSON.parse(await boundedText(response.body, OPENAPI_LIMIT)), secrets));
      const kept: Operation[] = [];
      let size = 0;
      for (const operation of operations) {
        size += JSON.stringify(operation).length;
        if (size > DESCRIBE_LIMIT) break;
        kept.push(operation);
      }
      const result = redact({ cell: name, status: 'ok', host: new URL(origin).host, operations: kept,
        omitted_operations: omitted, truncated: kept.length < operations.length, cached: false }, secrets) as Result;
      cache.set(origin, { expires: Date.now() + DESCRIBE_TTL_MS, result });
      return result;
    });
  } catch (error) { return failure(name, error, signal); }
}

type CallInput = { cell: string; method: string; path: string; query?: Record<string, string | number | boolean>; body?: Record<string, unknown>; idempotency_key?: string; if_match?: string };

async function callCell(input: CallInput, env: Env, cells: Cells, fetcher: Fetcher, secrets: string[]): Promise<Result> {
  const { cell } = input;
  const origin = cells.cells.get(cell);
  if (!origin) return { cell, status: 'unknown_cell' };
  if (!(CELL_METHODS as readonly string[]).includes(input.method)) return { cell, status: 'method_not_allowed' };
  if (readOnly(env) && input.method !== 'GET') return { cell, status: 'read_only' };
  const path = cellPath(input.path);
  if (!path) return { cell, status: 'invalid_path' };
  if (input.method === 'GET' && input.body !== undefined) return { cell, status: 'invalid_request', reason: 'get_has_no_body' };
  const target = new URL(path, origin);
  if (target.origin !== origin || target.pathname !== path) return { cell, status: 'invalid_path' };
  for (const [key, value] of Object.entries(input.query ?? {})) target.searchParams.append(key, String(value));
  const body = input.body === undefined ? undefined : JSON.stringify(input.body);
  if (body !== undefined && new TextEncoder().encode(body).byteLength > CELL_BODY_LIMIT) return { cell, status: 'body_too_large' };
  const token = env.EMPIRE_OWNER_MCP_TOKEN;
  if (!token) return { cell, status: 'not_configured', missing: 'EMPIRE_OWNER_MCP_TOKEN' };
  const headers: Record<string, string> = { Accept: 'application/json', Authorization: `Bearer ${token}`, 'X-Empire-Channel': CELL_CHANNEL };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (input.idempotency_key) headers['Idempotency-Key'] = input.idempotency_key;
  if (input.if_match) headers['If-Match'] = input.if_match;
  const base = { cell, method: input.method, path };
  let signal: AbortSignal | undefined;
  try {
    return await withDeadline(async deadline => {
      signal = deadline;
      const response = await fetcher(target, { method: input.method, redirect: 'manual', signal: deadline, headers, body });
      const status = response.ok ? 'ok' : 'http_error';
      if (response.status === 204 || response.headers.get('content-length') === '0') {
        await response.body?.cancel();
        return { ...base, status, http_status: response.status, data: null };
      }
      if (!contentIsJson(response)) {
        await response.body?.cancel();
        return { ...base, status: response.ok ? 'invalid_response' : 'http_error', http_status: response.status };
      }
      const text = await boundedText(response.body, CELL_READ_LIMIT);
      // Redact the parsed value first, so any shortened output is built only from redacted data.
      const data = redact(text ? JSON.parse(text) : null, secrets);
      return { ...base, status, http_status: response.status, ...fitResponse(data, secrets) };
    });
  } catch (error) { return { ...base, ...failure(cell, error, signal) }; }
}

function registerCellTools(server: McpServer, env: Env, fetcher: Fetcher, secrets: string[]): void {
  const cells = cellsFrom(env);
  const names = [...cells.cells.keys()].sort();
  const cellName = z.string().max(40).describe(`ชื่อ cell จาก list_cells เช่น ${names.slice(0, 4).join(', ') || 'goals'}`);
  server.registerTool('list_cells', {
    description: 'แสดง Solo Empire cell API ที่ hub เรียกได้ (ชื่อ, host) และสถานะ token โดยไม่เปิดเผยค่า token', inputSchema: {}, annotations: hubAnnotations,
  }, async () => toolResult({ cells: names.map(name => ({ name, host: new URL(cells.cells.get(name)!).host })), config: cells.config,
    rejected: cells.rejected, token_configured: Boolean(env.EMPIRE_OWNER_MCP_TOKEN), read_only: readOnly(env), channel: CELL_CHANNEL,
    allowed_methods: readOnly(env) ? ['GET'] : [...CELL_METHODS] }));
  server.registerTool('describe_cell', {
    description: 'อ่าน /openapi.json ของ cell แล้วคืนรายการ operation แบบย่อ (method, path, summary, params, body schema) ที่ call_cell เรียกได้',
    inputSchema: { cell: cellName }, annotations: hubAnnotations,
  }, async ({ cell }) => toolResult(await describeCell(cell, cells, fetcher, secrets)));
  server.registerTool('call_cell', {
    description: 'เรียก cell API ใต้ /v1/ ด้วย delegated token owner-mcp (GET/POST/PATCH/PUT; ไม่มี DELETE) ใช้ describe_cell ดู operation ก่อน',
    inputSchema: {
      cell: cellName,
      method: z.enum(CELL_METHODS),
      path: z.string().max(512).describe('path ใต้ /v1/ เช่น /v1/goals หรือ /v1/goals/<id>; ไม่มี query string'),
      query: z.record(z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/), z.union([z.string().max(1024), z.number(), z.boolean()])).optional(),
      body: z.record(z.string(), z.unknown()).optional().describe('JSON object สำหรับ POST/PATCH/PUT (ไม่เกิน 64 KiB)'),
      idempotency_key: z.string().regex(/^[A-Za-z0-9_.:-]{8,128}$/).optional(),
      if_match: z.string().regex(/^[\x21-\x7E]{1,128}$/).optional(),
    },
    annotations: callAnnotations,
  }, async input => toolResult(await callCell(input, env, cells, fetcher, secrets)));
}

const errorStatuses = new Set(['not_configured', 'http_error', 'invalid_response', 'response_too_large', 'timeout', 'upstream_error',
  'unknown_cell', 'method_not_allowed', 'read_only', 'invalid_path', 'invalid_request', 'body_too_large']);
function toolResult(result: Result) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], structuredContent: result,
    ...(errorStatuses.has(String(result.status)) ? { isError: true } : {}) };
}

function serverFor(env: Env, fetcher: Fetcher): McpServer {
  const server = new McpServer({ name: 'solo-empire-mcp-remote', version: '1.0.0' });
  const configured = services(env);
  const secrets = [env.MCP_TOKEN_SHA256, env.EMPIRE_OWNER_MCP_TOKEN, ...configured.map(service => service.token)].filter((value): value is string => Boolean(value));
  server.registerTool('list_remote_services', {
    description: 'แสดงบริการ API ที่ตั้งค่าไว้ โดยไม่เปิดเผย token; การตั้งค่าไม่ยืนยันว่าบริการออนไลน์', inputSchema: {}, annotations,
  }, async () => toolResult({ services: configured.map(service => ({ id: service.id, origin: service.origin, origin_configured: Boolean(service.origin), read_token_configured: Boolean(service.token), availability: 'not_checked' })) }));
  server.registerTool('check_remote_services', {
    description: 'ตรวจ HTTP health ของบริการ API ที่ตั้งค่าไว้ และคืนสถานะโดยไม่อ่านเนื้อหาตอบกลับ', inputSchema: {}, annotations,
  }, async () => toolResult({ services: await Promise.all(configured.map(service => upstream(service, false, fetcher, secrets))) }));
  const names = { ai: 'get_ai_status', agency: 'get_agency_workspace', income: 'get_income_workspace' };
  for (const service of configured) server.registerTool(names[service.id], {
    description: `อ่านข้อมูลจากบริการ ${service.id} ผ่าน API ที่อนุญาต`, inputSchema: {}, annotations,
  }, async () => toolResult(await upstream(service, true, fetcher, secrets)));
  registerCellTools(server, env, fetcher, secrets);
  return server;
}

function jsonError(status: number, message: string): Response {
  return Response.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}
function authConfigured(env: Env): boolean { return /^[a-f0-9]{64}$/i.test(env.MCP_TOKEN_SHA256 ?? ''); }
async function authorized(request: Request, env: Env): Promise<boolean> {
  const header = request.headers.get('authorization') ?? '';
  if (!/^Bearer [\x21-\x7E]{16,4096}$/.test(header)) return false;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(header.slice(7)));
  const actual = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  const expected = env.MCP_TOKEN_SHA256!.toLowerCase();
  let difference = 0;
  for (let index = 0; index < 64; index++) difference |= actual.charCodeAt(index) ^ expected.charCodeAt(index);
  return difference === 0;
}

// A fresh SDK server/transport for every request avoids isolate or laptop state.
export async function handleRequest(request: Request, env: Env, fetcher: Fetcher = fetch): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === '/healthz' && request.method === 'GET') {
    return authConfigured(env) && httpsOrigin(env.PUBLIC_ORIGIN) ? Response.json({ status: 'ok' }, { headers: { 'Cache-Control': 'no-store' } }) : jsonError(503, 'not_configured');
  }
  if (url.pathname !== '/mcp') return jsonError(404, 'not_found');
  if (!authConfigured(env)) return jsonError(503, 'not_configured');
  const publicOrigin = httpsOrigin(env.PUBLIC_ORIGIN);
  if (!publicOrigin) return jsonError(503, 'not_configured');
  if (url.origin !== publicOrigin || (request.headers.has('host') && request.headers.get('host') !== new URL(publicOrigin).host)) return jsonError(403, 'forbidden');
  const origin = request.headers.get('origin');
  const allowed = (env.ALLOWED_ORIGINS ?? '').split(',').map(value => httpsOrigin(value.trim())).filter(Boolean);
  if (origin !== null && (!httpsOrigin(origin) || !allowed.includes(origin))) return jsonError(403, 'forbidden');
  if (!(await authorized(request, env))) return jsonError(401, 'unauthorized');
  if (request.method !== 'POST') return jsonError(405, 'method_not_allowed');
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return jsonError(415, 'unsupported_media_type');
  let parsedBody: unknown;
  try { parsedBody = JSON.parse(await boundedText(request.body, INPUT_LIMIT)); }
  catch (error) { return jsonError(error instanceof BodyLimitError ? 413 : 400, error instanceof BodyLimitError ? 'body_too_large' : 'invalid_json'); }
  const server = serverFor(env, fetcher);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  try {
    await server.connect(transport);
    const response = await transport.handleRequest(request, { parsedBody });
    // JSON mode resolves only once all replies exist. Consume before closing.
    const bytes = await response.arrayBuffer();
    const headers = new Headers(response.headers);
    headers.set('Cache-Control', 'no-store');
    headers.set('X-Content-Type-Options', 'nosniff');
    return new Response(bytes.byteLength ? bytes : null, { status: response.status, headers });
  } catch { return jsonError(500, 'internal_error'); }
  finally { await server.close(); }
}

export default { fetch: (request: Request, env: Env) => handleRequest(request, env) };
