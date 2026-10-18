import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { readFileSync } from 'node:fs';
import { CELL_HOSTS, cellPath, handleRequest, type Env } from '../src/worker.js';

const token = 'local-test-bearer-with-sufficient-entropy';
const url = 'https://mcp.example.com/mcp';
const env: Env = { MCP_TOKEN_SHA256: createHash('sha256').update(token).digest('hex'), PUBLIC_ORIGIN: 'https://mcp.example.com' };
const rpc = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} };
function request(body: unknown = rpc, headers: Record<string, string> = {}, target = url): Request {
  return new Request(target, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
}
const unavailable: typeof fetch = async () => { throw new Error('private upstream error that must not escape'); };
async function clientFor(config: Env = env, upstream: typeof fetch = unavailable) {
  const calls: Request[] = [];
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
    fetch: async (input, init) => {
      const req = new Request(input, init);
      calls.push(req);
      const response = await handleRequest(req, { ...config }, upstream);
      assert.equal(response.headers.has('mcp-session-id'), false);
      assert.equal(response.headers.has('access-control-allow-origin'), false);
      return response;
    },
  });
  const client = new Client({ name: 'integration-test', version: '1.0.0' });
  await client.connect(transport);
  return { client, transport, calls };
}
type ToolOutput = { isError?: boolean; structuredContent?: Record<string, unknown>; content?: unknown };
async function call(name: string, config: Env = env, upstream: typeof fetch = unavailable, args: Record<string, unknown> = {}) {
  const { client } = await clientFor(config, upstream);
  try { return await client.callTool({ name, arguments: args }) as ToolOutput; }
  finally { await client.close(); }
}

test('health discloses only readiness of authentication configuration', async () => {
  const health = new Request('https://mcp.example.com/healthz');
  assert.equal((await handleRequest(health, {})).status, 503);
  assert.equal((await handleRequest(health, { ...env, PUBLIC_ORIGIN: undefined })).status, 503);
  const response = await handleRequest(health, env);
  assert.deepEqual(await response.json(), { status: 'ok' });
});

test('auth fails closed and uses fixed errors', async () => {
  assert.equal((await handleRequest(request(), {})).status, 503);
  assert.equal((await handleRequest(request(), { ...env, PUBLIC_ORIGIN: undefined })).status, 503);
  for (const authorization of ['', 'Bearer incorrect-test-token', 'Basic abc']) {
    const result = await handleRequest(request(rpc, { Authorization: authorization }), env);
    assert.equal(result.status, 401);
    assert.deepEqual(await result.json(), { error: 'unauthorized' });
  }
});

test('host and browser origin are validated before SDK routing', async () => {
  assert.equal((await handleRequest(request(rpc, {}, 'https://evil.example.com/mcp'), env)).status, 403);
  assert.equal((await handleRequest(request(rpc, { Host: 'evil.example.com' }), env)).status, 403);
  assert.equal((await handleRequest(request(rpc, { Origin: 'https://app.example.com' }), env)).status, 403);
  const allowed = { ...env, ALLOWED_ORIGINS: 'https://app.example.com' };
  assert.equal((await handleRequest(request(rpc, { Origin: 'https://app.example.com' }), allowed)).status, 200);
  assert.equal((await handleRequest(request(rpc, { Origin: 'null' }), allowed)).status, 403);
  assert.equal((await handleRequest(request(rpc, { Origin: 'https://app.example.com/evil' }), allowed)).status, 403);
});

test('rejects malformed JSON, SDK protocol errors, unsupported content and streamed oversized input', async () => {
  const malformed = await handleRequest(request('{'), env);
  assert.equal(malformed.status, 400);
  assert.deepEqual(await malformed.json(), { error: 'invalid_json' });
  assert.equal((await handleRequest(request('null'), env)).status, 400);
  assert.equal((await handleRequest(request(rpc, { 'Content-Type': 'text/plain' }), env)).status, 415);
  const stream = new ReadableStream<Uint8Array>({ start(controller) {
    controller.enqueue(new TextEncoder().encode(' '.repeat(32768)));
    controller.enqueue(new TextEncoder().encode(' '.repeat(32769)));
    controller.close();
  } });
  const init: RequestInit & { duplex: string } = { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: stream, duplex: 'half' };
  assert.equal((await handleRequest(new Request(url, init), env)).status, 413);
});

test('real SDK initializes, lists the five read-only tools plus the cell hub, and calls across fresh transports', async () => {
  for (let index = 0; index < 2; index++) {
    const { client, transport, calls } = await clientFor();
    try {
      assert.equal(transport.sessionId, undefined);
      const result = await client.listTools();
      assert.deepEqual(result.tools.map(tool => tool.name).sort(), ['list_remote_services', 'check_remote_services', 'get_ai_status', 'get_agency_workspace', 'get_income_workspace', 'list_cells', 'describe_cell', 'call_cell'].sort());
      for (const tool of result.tools) {
        assert.equal(tool.annotations?.readOnlyHint, tool.name !== 'call_cell');
        assert.equal(tool.annotations?.destructiveHint, false);
      }
      const method = (result.tools.find(tool => tool.name === 'call_cell')?.inputSchema.properties as Record<string, { enum?: string[] }>).method;
      assert.deepEqual(method.enum, ['GET', 'POST', 'PATCH', 'PUT']);
      const listed = await client.callTool({ name: 'list_remote_services', arguments: {} });
      const services = (listed.structuredContent as { services: Record<string, unknown>[] }).services;
      assert.equal(services.length, 3);
      assert.equal(services[0].availability, 'not_checked');
      assert.equal(services[0].read_token_configured, false);
      assert.ok(calls.length >= 4);
      assert.ok(calls.every(req => !req.headers.has('mcp-session-id')));
    } finally { await client.close(); }
  }
});

test('missing read tokens never calls upstream or claims connectivity', async () => {
  let calls = 0;
  const upstream: typeof fetch = async () => { calls++; return Response.json({}); };
  for (const name of ['get_ai_status', 'get_agency_workspace', 'get_income_workspace']) {
    const result = await call(name, env, upstream);
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent?.status, 'not_configured');
  }
  assert.equal(calls, 0);
});

test('read paths, tokens and methods are fixed; upstream secrets are redacted', async () => {
  const config = { ...env, AI_API_READ_TOKEN: 'ai-private-test-token', AGENCY_CRM_TOKEN: 'agency-private-test-token', INCOME_CRM_TOKEN: 'income-private-test-token' };
  const observed: { url: string; auth: string | null; method?: string; redirect?: string }[] = [];
  const upstream: typeof fetch = async (input, init) => {
    observed.push({ url: String(input), auth: new Headers(init?.headers).get('authorization'), method: init?.method, redirect: init?.redirect });
    return Response.json({ ready: true, authorization: 'private', nested: { message: `echo ${config.AI_API_READ_TOKEN}` } });
  };
  for (const name of ['get_ai_status', 'get_agency_workspace', 'get_income_workspace']) {
    const result = await call(name, config, upstream);
    assert.equal(result.structuredContent?.status, 'ok');
    const serialized = JSON.stringify(result);
    for (const secret of [config.AI_API_READ_TOKEN, config.AGENCY_CRM_TOKEN, config.INCOME_CRM_TOKEN]) assert.equal(serialized.includes(secret), false);
  }
  assert.deepEqual(observed.map(item => item.url), ['https://api.bookchaowalit.com/api/ai/status', 'https://crm-api-production-a7e0.up.railway.app/api/v1/crm/agency/workspace', 'https://crm-api-production-19fd.up.railway.app/api/v1/crm/agency/workspace']);
  assert.deepEqual(observed.map(item => item.auth), [`Bearer ${config.AI_API_READ_TOKEN}`, `Bearer ${config.AGENCY_CRM_TOKEN}`, `Bearer ${config.INCOME_CRM_TOKEN}`]);
  assert.ok(observed.every(item => item.method === 'GET' && item.redirect === 'manual'));
});

test('health checks return HTTP status only without payload or tokens', async () => {
  const config = { ...env, AI_API_READ_TOKEN: 'private-ai-token' };
  const observed: string[] = [];
  const upstream: typeof fetch = async (input, init) => {
    observed.push(String(input));
    assert.equal(new Headers(init?.headers).has('authorization'), false);
    return Response.json({ private: 'do not return me' }, { status: 200 });
  };
  const result = await call('check_remote_services', config, upstream);
  assert.equal(JSON.stringify(result).includes('do not return me'), false);
  assert.deepEqual(observed, ['https://api.bookchaowalit.com/healthz', 'https://crm-api-production-a7e0.up.railway.app/health', 'https://crm-api-production-19fd.up.railway.app/health']);
  assert.ok((result.structuredContent?.services as Record<string, unknown>[]).every(item => item.http_status === 200));
});

test('rejects redirects, invalid content, oversized JSON and sanitizes fetch errors', async () => {
  const config = { ...env, AI_API_READ_TOKEN: 'private-ai-token' };
  const cases: [typeof fetch, string][] = [
    [async () => new Response('private error', { status: 302, headers: { Location: 'https://evil.example.com' } }), 'http_error'],
    [async () => new Response('private html', { headers: { 'Content-Type': 'text/html' } }), 'invalid_response'],
    [async () => Response.json({ body: 'x'.repeat(512 * 1024) }), 'response_too_large'],
    [async () => new Response('not JSON', { headers: { 'Content-Type': 'application/json' } }), 'upstream_error'],
    [unavailable, 'upstream_error'],
  ];
  for (const [upstream, expected] of cases) {
    const result = await call('get_ai_status', config, upstream);
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent?.status, expected);
    assert.equal(JSON.stringify(result).includes('private'), false);
  }
});

test('invalid administrator origins cannot produce an upstream request', async () => {
  for (const origin of ['http://api.example.com', 'https://user:password@api.example.com', 'https://api.example.com/path', 'https://api.example.com?query=1', 'https://127.0.0.1', 'https://metadata.internal', 'https://[::1]']) {
    const result = await call('get_ai_status', { ...env, AI_API_READ_TOKEN: 'private-ai-token', AI_API_ORIGIN: origin }, async () => { assert.fail('must not fetch'); });
    assert.equal(result.structuredContent?.status, 'not_configured');
  }
});

test('upstream deadline cancels the request after fifteen seconds without exposing its error', async () => {
  let aborted = false;
  const upstream: typeof fetch = async (_input, init) => new Promise<Response>((_resolve, reject) => {
    init!.signal!.addEventListener('abort', () => { aborted = true; reject(new Error('private timeout details')); }, { once: true });
  });
  const result = await call('get_ai_status', { ...env, AI_API_READ_TOKEN: 'private-ai-token' }, upstream);
  assert.equal(aborted, true);
  assert.equal(result.structuredContent?.status, 'timeout');
  assert.equal(JSON.stringify(result).includes('private'), false);
});

// --- Tool hub -------------------------------------------------------------
const wranglerCells = JSON.parse(/^CELLS = '''([\s\S]*?)'''$/m.exec(readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8'))![1]) as Record<string, string>;
const ownerToken = 'owner-mcp-private-test-jwt-value';
const hub: Env = { ...env, CELLS: JSON.stringify(wranglerCells), EMPIRE_OWNER_MCP_TOKEN: ownerToken };
const goals = 'https://goals-api-production-c16e.up.railway.app';
type Seen = { url: string; method?: string; headers: Headers; body?: string };
function recorder(reply: () => Response = () => Response.json({ items: [] })) {
  const seen: Seen[] = [];
  const upstream: typeof fetch = async (input, init) => {
    seen.push({ url: String(input), method: init?.method, headers: new Headers(init?.headers), body: init?.body as string | undefined });
    return reply();
  };
  return { seen, upstream };
}
async function invoke(args: Record<string, unknown>, config: Env = hub, upstream: typeof fetch = unavailable): Promise<ToolOutput & { rejected?: boolean }> {
  // Schema violations surface either as a protocol error or as an SDK isError result.
  try {
    const result = await call('call_cell', config, upstream, args);
    return result.isError && !result.structuredContent ? { ...result, rejected: true } : result;
  } catch { return { rejected: true }; }
}

test('wrangler CELLS lists every own cell and exactly the allowlisted hosts', () => {
  const hosts = Object.values(wranglerCells).map(value => new URL(value).hostname);
  assert.deepEqual([...hosts].sort(), [...CELL_HOSTS].sort());
  assert.ok(Object.values(wranglerCells).every(value => value.startsWith('https://') && new URL(value).pathname === '/'));
  for (const name of ['goals', 'tasks', 'tax', 'projects', 'habits', 'decisions']) assert.ok(name in wranglerCells, name);
  for (const client of ['crm', 'crm-income', 'agency']) assert.equal(client in wranglerCells, false);
});

test('list_cells reports names, hosts and token presence without the token', async () => {
  const listed = await call('list_cells', hub);
  const content = listed.structuredContent as { cells: { name: string; host: string }[]; token_configured: boolean; read_only: boolean; rejected: string[] };
  assert.equal(content.cells.length, Object.keys(wranglerCells).length);
  assert.ok(content.cells.some(cell => cell.name === 'goals' && cell.host === new URL(goals).host));
  assert.equal(content.token_configured, true);
  assert.equal(content.read_only, false);
  assert.deepEqual(content.rejected, []);
  assert.equal(JSON.stringify(listed).includes(ownerToken), false);
  const missing = await call('list_cells', { ...hub, EMPIRE_OWNER_MCP_TOKEN: undefined });
  assert.equal(missing.structuredContent?.token_configured, false);
});

test('host allowlist rejects non-https, credentialed, private and unknown cell hosts', async () => {
  const cells = { goals, evil: 'https://evil.example.com', plain: 'http://goals-api-production-c16e.up.railway.app', creds: 'https://u:p@goals-api-production-c16e.up.railway.app',
    pathy: `${goals}/v1`, local: 'https://127.0.0.1', other: 'https://other-api.up.railway.app', 'Bad Name': goals };
  const { seen, upstream } = recorder();
  const listed = await call('list_cells', { ...hub, CELLS: JSON.stringify(cells) }, upstream);
  assert.deepEqual((listed.structuredContent?.cells as { name: string }[]).map(cell => cell.name), ['goals']);
  assert.deepEqual((listed.structuredContent?.rejected as string[]).sort(), ['[invalid-name]', 'creds', 'evil', 'local', 'other', 'pathy', 'plain']);
  for (const cell of ['evil', 'plain', 'other', 'nope']) {
    const result = await invoke({ cell, method: 'GET', path: '/v1/goals' }, { ...hub, CELLS: JSON.stringify(cells) }, upstream);
    assert.equal(result.structuredContent?.status, 'unknown_cell');
  }
  for (const broken of ['{', '[]', '"x"']) {
    const result = await call('list_cells', { ...hub, CELLS: broken });
    assert.equal(result.structuredContent?.config, 'invalid');
  }
  assert.equal(seen.length, 0);
});

test('path validation allows only /v1/ paths on the configured cell', async () => {
  for (const path of ['/v1/goals', '/v1/goals/0b8c-11ef', '/v1/goals/abc/check-ins/', '/v1/a.b_c~d']) assert.equal(cellPath(path), path);
  const bad = ['/v2/goals', 'v1/goals', '/v1', '/v1/', '/v1//goals', '/v1/../admin', '/v1/goals/..', '/v1/./goals', '/v1/goals?x=1', '/v1/goals#x',
    'https://evil.example.com/v1/goals', '//evil.example.com/v1/x', '/v1/%2e%2e/x', '/v1/goals\\..\\x', '/v1/go als', `/v1/${'a'.repeat(600)}`, '/v1/a..b'];
  const { seen, upstream } = recorder();
  for (const path of bad) {
    assert.equal(cellPath(path), null, path);
    const result = await invoke({ cell: 'goals', method: 'GET', path }, hub, upstream);
    assert.ok(result.rejected || result.structuredContent?.status === 'invalid_path', path);
  }
  assert.equal(seen.length, 0);
});

test('method allowlist has no DELETE and MCP_READONLY limits calls to GET', async () => {
  const { seen, upstream } = recorder();
  for (const method of ['DELETE', 'delete', 'HEAD', 'OPTIONS', 'TRACE', 'CONNECT']) {
    const result = await invoke({ cell: 'goals', method, path: '/v1/goals/1' }, hub, upstream);
    assert.ok(result.rejected || result.isError, method);
  }
  const readonly = { ...hub, MCP_READONLY: '1' };
  for (const method of ['POST', 'PATCH', 'PUT']) {
    const result = await invoke({ cell: 'goals', method, path: '/v1/goals', body: { title: 'x' } }, readonly, upstream);
    assert.equal(result.structuredContent?.status, 'read_only');
  }
  assert.equal(seen.length, 0);
  assert.deepEqual((await call('list_cells', readonly)).structuredContent?.allowed_methods, ['GET']);
  const read = await invoke({ cell: 'goals', method: 'GET', path: '/v1/goals' }, readonly, upstream);
  assert.equal(read.structuredContent?.status, 'ok');
  assert.equal(seen.length, 1);
});

test('missing EMPIRE_OWNER_MCP_TOKEN answers not_configured without calling the cell', async () => {
  const { seen, upstream } = recorder();
  for (const method of ['GET', 'POST']) {
    const result = await invoke({ cell: 'goals', method, path: '/v1/goals', ...(method === 'POST' ? { body: { title: 'x' } } : {}) }, { ...hub, EMPIRE_OWNER_MCP_TOKEN: undefined }, upstream);
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent?.status, 'not_configured');
  }
  assert.equal(seen.length, 0);
  const noCells = await invoke({ cell: 'goals', method: 'GET', path: '/v1/goals' }, { ...env }, upstream);
  assert.equal(noCells.structuredContent?.status, 'unknown_cell');
});

test('call_cell forwards bearer, channel, query and body; the token never reaches output', async () => {
  const { seen, upstream } = recorder(() => Response.json({ id: 'g1', echo: `Bearer ${ownerToken}`, authorization: 'Bearer leaked', nested: { detail: ownerToken } }, { status: 201 }));
  const result = await invoke({ cell: 'goals', method: 'POST', path: '/v1/goals', query: { dry_run: true, limit: 5, q: 'a b&c' }, body: { title: 'Ship hub' }, idempotency_key: 'idem-12345678' }, hub, upstream);
  assert.equal(result.structuredContent?.status, 'ok');
  assert.equal(result.structuredContent?.http_status, 201);
  assert.equal((result.structuredContent?.data as Record<string, unknown>).id, 'g1');
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(ownerToken), false);
  assert.equal(serialized.includes('leaked'), false);
  assert.equal(seen.length, 1);
  const [sent] = seen;
  assert.equal(sent.url, `${goals}/v1/goals?dry_run=true&limit=5&q=a+b%26c`);
  assert.equal(sent.method, 'POST');
  assert.equal(sent.headers.get('authorization'), `Bearer ${ownerToken}`);
  assert.equal(sent.headers.get('x-empire-channel'), 'mcp');
  assert.equal(sent.headers.get('idempotency-key'), 'idem-12345678');
  assert.equal(sent.headers.get('content-type'), 'application/json');
  assert.deepEqual(JSON.parse(sent.body!), { title: 'Ship hub' });
});

test('call_cell reports cell errors, truncates large bodies and sanitizes failures', async () => {
  const errorReply = recorder(() => Response.json({ detail: [{ msg: 'field required', loc: ['body', 'title'] }] }, { status: 422 }));
  const invalid = await invoke({ cell: 'goals', method: 'POST', path: '/v1/goals', body: {} }, hub, errorReply.upstream);
  assert.equal(invalid.isError, true);
  assert.equal(invalid.structuredContent?.status, 'http_error');
  assert.equal(invalid.structuredContent?.http_status, 422);
  assert.ok(JSON.stringify(invalid.structuredContent?.data).includes('field required'));
  const large = recorder(() => Response.json({ items: 'x'.repeat(200 * 1024), tail: ownerToken }));
  const truncated = await invoke({ cell: 'goals', method: 'GET', path: '/v1/goals' }, hub, large.upstream);
  assert.equal(truncated.structuredContent?.truncated, true);
  assert.ok(String(truncated.structuredContent?.preview).length <= 100 * 1024);
  const cutToken = recorder(() => new Response(`{"x":"${'y'.repeat(100 * 1024 - 14)}${ownerToken}"}`, { headers: { 'Content-Type': 'application/json' } }));
  const cut = await invoke({ cell: 'goals', method: 'GET', path: '/v1/goals' }, hub, cutToken.upstream);
  assert.equal(String(cut.structuredContent?.preview).endsWith(ownerToken.slice(0, 7)), false);
  const empty = await invoke({ cell: 'goals', method: 'PATCH', path: '/v1/goals/1', body: { title: 'y' } }, hub, recorder(() => new Response(null, { status: 204 })).upstream);
  assert.equal(empty.structuredContent?.status, 'ok');
  assert.equal(empty.structuredContent?.data, null);
  const cases: [typeof fetch, string][] = [
    [async () => new Response('private', { status: 302, headers: { Location: 'https://evil.example.com' } }), 'http_error'],
    [async () => new Response('private html', { headers: { 'Content-Type': 'text/html' } }), 'invalid_response'],
    [async () => new Response('not JSON private', { headers: { 'Content-Type': 'application/json' } }), 'upstream_error'],
    [async () => { throw new Error(`private failure Authorization: Bearer ${ownerToken}`); }, 'upstream_error'],
  ];
  for (const [upstream, expected] of cases) {
    const result = await invoke({ cell: 'goals', method: 'GET', path: '/v1/goals' }, hub, upstream);
    assert.equal(result.structuredContent?.status, expected);
    assert.equal(JSON.stringify(result).includes('private'), false);
    assert.equal(JSON.stringify(result).includes(ownerToken), false);
  }
});

test('call_cell rejects GET bodies, oversized bodies and bad query values before fetching', async () => {
  const { seen, upstream } = recorder();
  assert.equal((await invoke({ cell: 'goals', method: 'GET', path: '/v1/goals', body: { a: 1 } }, hub, upstream)).structuredContent?.status, 'invalid_request');
  for (const query of [{ nested: { a: 1 } }, { list: [1] }, { 'bad key': 'x' }]) {
    const result = await invoke({ cell: 'goals', method: 'GET', path: '/v1/goals', query }, hub, upstream);
    assert.ok(result.rejected || result.isError);
  }
  assert.equal(seen.length, 0);
});

test('call_cell deadline aborts after fifteen seconds', async () => {
  let aborted = false;
  const upstream: typeof fetch = async (_input, init) => new Promise<Response>((_resolve, reject) => {
    init!.signal!.addEventListener('abort', () => { aborted = true; reject(new Error('private timeout')); }, { once: true });
  });
  const result = await invoke({ cell: 'goals', method: 'GET', path: '/v1/goals' }, hub, upstream);
  assert.equal(aborted, true);
  assert.equal(result.structuredContent?.status, 'timeout');
});

const openapi = {
  openapi: '3.1.0',
  paths: {
    '/health': { get: { summary: 'Health' } },
    '/v1/goals': {
      get: { summary: 'List Goals', parameters: [{ name: 'limit', in: 'query' }, { name: 'authorization', in: 'header' }, { name: 'x-empire-channel', in: 'header' }] },
      post: { summary: 'Create Goal', requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/GoalCreate' } } } } },
    },
    '/v1/goals/{goal_id}': {
      patch: { summary: 'Update Goal', parameters: [{ name: 'goal_id', in: 'path', required: true }] },
      delete: { summary: 'Delete Goal', parameters: [{ name: 'goal_id', in: 'path', required: true }] },
    },
  },
  components: { schemas: { GoalCreate: { required: ['title'], properties: { title: { type: 'string' }, horizon: { anyOf: [{ type: 'string' }, { type: 'null' }] } } } } },
};

test('describe_cell returns compact callable operations and caches per isolate', async () => {
  const { seen, upstream } = recorder(() => Response.json(openapi));
  const first = await call('describe_cell', hub, upstream, { cell: 'goals' });
  const content = first.structuredContent as { status: string; cached: boolean; omitted_operations: number; operations: Record<string, unknown>[] };
  assert.equal(content.status, 'ok');
  assert.equal(content.cached, false);
  assert.deepEqual(content.operations, [
    { method: 'GET', path: '/v1/goals', summary: 'List Goals', params: ['query:limit?'] },
    { method: 'POST', path: '/v1/goals', summary: 'Create Goal', body: 'GoalCreate', body_fields: ['title:string', 'horizon?:string'] },
    { method: 'PATCH', path: '/v1/goals/{goal_id}', summary: 'Update Goal', params: ['path:goal_id'] },
  ]);
  assert.equal(content.omitted_operations, 2);
  assert.equal(seen[0].url, `${goals}/openapi.json`);
  assert.equal(seen[0].headers.has('authorization'), false);
  const second = await call('describe_cell', hub, upstream, { cell: 'goals' });
  assert.equal(second.structuredContent?.cached, true);
  assert.equal(seen.length, 1);
  await call('describe_cell', hub, upstream, { cell: 'tax' });
  assert.equal(seen.length, 2);
});

test('describe_cell caps output size and reports unknown cells and upstream errors', async () => {
  const paths: Record<string, unknown> = {};
  for (let index = 0; index < 2000; index++) paths[`/v1/items-${index}`] = { get: { summary: 'S'.repeat(150) } };
  const big = await call('describe_cell', hub, recorder(() => Response.json({ paths })).upstream, { cell: 'goals' });
  assert.equal(big.structuredContent?.truncated, true);
  assert.ok(JSON.stringify(big.structuredContent).length < 64 * 1024);
  assert.equal((await call('describe_cell', hub, unavailable, { cell: 'nope' })).structuredContent?.status, 'unknown_cell');
  const failed = await call('describe_cell', hub, recorder(() => new Response('private', { status: 500 })).upstream, { cell: 'goals' });
  assert.equal(failed.structuredContent?.status, 'http_error');
  assert.equal(JSON.stringify(failed).includes('private'), false);
});
