// The exported Worker (wrapped in withSentry): identical behaviour without SENTRY_DSN, and with a
// DSN only a scrubbed error event leaves the Worker. Global fetch is mocked; nothing hits the network.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import worker, { type Env } from '../src/worker.js';

const token = 'local-test-bearer-with-sufficient-entropy';
const ownerToken = 'local-owner-mcp-value-for-scrub-checks';
const base: Env = { MCP_TOKEN_SHA256: createHash('sha256').update(token).digest('hex'), PUBLIC_ORIGIN: 'https://mcp.example.com' };
const dsn = 'https://publickey@o0.ingest.sentry.io/1';

type Ctx = { waitUntil(promise: Promise<unknown>): void; passThroughOnException(): void; props: Record<string, unknown>; settle(): Promise<void> };
function context(): Ctx {
  const pending: Promise<unknown>[] = [];
  return { waitUntil: promise => { pending.push(promise); }, passThroughOnException() {}, props: {}, settle: async () => { await Promise.allSettled(pending); } };
}
const fetchWorker = worker.fetch as unknown as (request: Request, env: Env, ctx: Ctx) => Promise<Response>;

function rpc(body: unknown, authorization = `Bearer ${token}`): Request {
  return new Request('https://mcp.example.com/mcp', {
    method: 'POST', body: JSON.stringify(body),
    headers: { Authorization: authorization, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
  });
}

function recordFetch() {
  // @sentry/cloudflare caches one client per isolate; each test starts from a fresh isolate state.
  delete (globalThis as Record<string, unknown>).__SENTRY_CLOUDFLARE_CLIENT__;
  const calls: Request[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    calls.push(request);
    if (new URL(request.url).hostname.endsWith('sentry.io')) return new Response('{}', { status: 200 });
    return Response.json({ items: [] });
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

for (const [label, env] of [['without SENTRY_DSN', base], ['with SENTRY_DSN', { ...base, SENTRY_DSN: dsn }]] as const) {
  test(`exported Worker keeps health, auth and tool listing unchanged ${label}`, async () => {
    const recorder = recordFetch();
    try {
      const ctx = context();
      const health = await fetchWorker(new Request('https://mcp.example.com/healthz'), env, ctx);
      assert.deepEqual(await health.json(), { status: 'ok' });
      const denied = await fetchWorker(rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, 'Bearer wrong-token-value-123456'), env, ctx);
      assert.equal(denied.status, 401);
      assert.deepEqual(await denied.json(), { error: 'unauthorized' });
      const listed = await fetchWorker(rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }), env, ctx);
      assert.equal(listed.status, 200);
      const tools = (await listed.json() as { result: { tools: { name: string }[] } }).result.tools.map(tool => tool.name);
      assert.ok(tools.includes('call_cell') && tools.includes('list_cells'));
      await ctx.settle();
      assert.equal(recorder.calls.length, 0, 'no upstream or Sentry traffic for health, auth or listing');
    } finally { recorder.restore(); }
  });
}

test('with SENTRY_DSN, call_cell upstream requests carry no Sentry trace headers', async () => {
  const recorder = recordFetch();
  try {
    const env: Env = { ...base, SENTRY_DSN: dsn, EMPIRE_OWNER_MCP_TOKEN: ownerToken, CELLS: { goals: 'https://goals-api-production-c16e.up.railway.app' } };
    const ctx = context();
    const response = await fetchWorker(rpc({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'call_cell', arguments: { cell: 'goals', method: 'GET', path: '/v1/goals' } } }), env, ctx);
    assert.equal(response.status, 200);
    await ctx.settle();
    const upstream = recorder.calls.filter(call => new URL(call.url).hostname.endsWith('railway.app'));
    assert.equal(upstream.length, 1);
    assert.equal(upstream[0].headers.has('sentry-trace'), false);
    assert.equal(upstream[0].headers.has('baggage'), false);
    assert.equal(recorder.calls.some(call => new URL(call.url).hostname.endsWith('sentry.io')), false);
  } finally { recorder.restore(); }
});

test('with SENTRY_DSN, an uncaught error is reported without token, headers or tool arguments', async () => {
  const recorder = recordFetch();
  try {
    const env = { ...base, SENTRY_DSN: dsn, EMPIRE_OWNER_MCP_TOKEN: ownerToken } as Env;
    // A broken CELLS binding makes the request handler throw before the SDK transport runs.
    Object.defineProperty(env, 'CELLS', { enumerable: true, get() { throw new Error(`cells config broke near Bearer ${ownerToken} token=${ownerToken}`); } });
    const ctx = context();
    const args = { cell: 'diary', method: 'POST', path: '/v1/entries', body: { note: 'private-diary-note' } };
    await assert.rejects(fetchWorker(rpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'call_cell', arguments: args } }), env, ctx));
    await ctx.settle();
    const sent = recorder.calls.filter(call => new URL(call.url).hostname.endsWith('sentry.io'));
    assert.equal(sent.length, 1, 'exactly one error envelope');
    const envelope = await sent[0].text();
    assert.match(envelope, /cells config broke/);
    for (const forbidden of [token, ownerToken, 'private-diary-note', '/v1/entries', 'authorization', 'Authorization', '"request"', '"extra"']) {
      assert.equal(envelope.includes(forbidden), false, `envelope must not contain ${forbidden}`);
    }
    assert.equal(recorder.calls.some(call => new URL(call.url).hostname.endsWith('railway.app')), false);
  } finally { recorder.restore(); }
});
