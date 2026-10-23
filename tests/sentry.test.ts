// Port of the shared reference test (~/work/b-tier-b/sentry-ref/sentry.test.ts) to node:test,
// plus cases for what this Worker carries: bearer tokens, credentials and tool arguments.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { scrubEvent, sentryOptions } from '../src/sentry.js';

describe('sentryOptions', () => {
  it('stays disabled when no DSN is configured', () => {
    assert.equal(sentryOptions({}).enabled, false);
    assert.equal(sentryOptions({ SENTRY_DSN: '' }).enabled, false);
    assert.equal(sentryOptions({ SENTRY_DSN: '' }).dsn, undefined);
  });

  it('reports errors only: no PII collection, tracing, trace headers or breadcrumbs', () => {
    const options = sentryOptions({ SENTRY_DSN: 'https://key@o0.ingest.sentry.io/1' });
    assert.equal(options.enabled, true);
    assert.equal('sendDefaultPii' in options, false);
    assert.equal(options.tracesSampleRate, undefined);
    assert.deepEqual(options.tracePropagationTargets, []);
    assert.equal(options.maxBreadcrumbs, 0);
    assert.equal(options.beforeSendTransaction(), null);
    assert.equal(options.enhanceFetchErrorMessages, false);
    const collection = options.dataCollection;
    assert.equal(collection.userInfo, false);
    assert.equal(collection.cookies, false);
    assert.equal(collection.httpHeaders, false);
    assert.deepEqual(collection.httpBodies, []);
    assert.equal(collection.urlQueryParams, false);
    assert.equal(collection.stackFrameVariables, false);
  });
});

describe('scrubEvent', () => {
  it('drops request data, user, breadcrumbs and extra context', () => {
    const event = scrubEvent({
      message: 'boom',
      request: { url: 'https://example.com/p?token=secret', headers: { cookie: 'a=b', authorization: 'Bearer abc' }, data: '{"arguments":{"body":{"note":"private"}}}' },
      user: { ip_address: '1.2.3.4' },
      breadcrumbs: [{ message: 'clicked' }],
      extra: { arguments: { cell: 'diary', body: { note: 'private' } } },
    });
    assert.equal(event.message, 'boom');
    assert.equal(event.request, undefined);
    assert.equal(event.user, undefined);
    assert.equal(event.breadcrumbs, undefined);
    assert.equal(event.extra, undefined);
    assert.doesNotMatch(JSON.stringify(event), /private|Bearer abc|secret/);
  });

  it('keeps only platform contexts and strips query strings from transaction and tags', () => {
    const event = scrubEvent({
      transaction: 'POST /mcp?token=secret',
      tags: { url: 'https://mcp.example.com/mcp?token=secret', route: '/mcp?q=private' },
      contexts: { cloud_resource: { 'cloud.provider': 'cloudflare' }, trace: { trace_id: 't' }, response: { status_code: 500 }, runtime: { name: 'cloudflare' } },
    });
    assert.equal(event.transaction, 'POST /mcp');
    assert.deepEqual(event.tags, { route: '/mcp' });
    assert.deepEqual(event.contexts, { runtime: { name: 'cloudflare' } });
    assert.doesNotMatch(JSON.stringify(event), /private|secret/);
  });

  it('redacts bearer tokens and credential pairs from messages and exception values', () => {
    const event = scrubEvent({
      message: 'upstream said Authorization: Bearer abc.def-123 and token=xyz987',
      exception: { values: [{ value: 'Failed https://cell.example.com/v1/goals?q=private {"api_key": "k-123", "password":"p@ss"} Basic dXNlcjpwYXNz' }] },
    });
    assert.equal(event.message, 'upstream said Authorization: Bearer [redacted] and token=[redacted]');
    const value = event.exception?.values?.[0]?.value ?? '';
    assert.match(value, /^Failed https:\/\/cell\.example\.com\/v1\/goals /);
    assert.doesNotMatch(value, /private|k-123|p@ss|dXNlcjpwYXNz/);
  });

  it('caps free text so a large serialized argument cannot be shipped whole', () => {
    const event = scrubEvent({ message: 'x'.repeat(5000), exception: { values: [{ value: 'y'.repeat(5000) }] } });
    assert.equal(event.message?.length, 1024);
    assert.equal(event.exception?.values?.[0]?.value?.length, 1024);
  });

  it('strips query strings from frames and debug images and removes local variables', () => {
    const event = scrubEvent({
      exception: { values: [{ stacktrace: { frames: [{ filename: 'https://example.com/worker.js?v=private', abs_path: '/worker.js?q=private', vars: { token: 't' } }] } }] },
      debug_meta: { images: [{ code_file: 'https://example.com/chunk.js?private=1' }] },
    });
    assert.deepEqual(event.exception?.values?.[0]?.stacktrace?.frames?.[0], { filename: 'https://example.com/worker.js', abs_path: '/worker.js' });
    assert.equal(event.debug_meta?.images?.[0]?.code_file, 'https://example.com/chunk.js');
  });
});
