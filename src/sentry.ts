// Sentry settings for the Worker (@sentry/cloudflare).
// Copied from the shared reference (~/work/b-tier-b/sentry-ref/sentry.ts) and owned by this repo.
// Errors only: no tracing, no trace headers on outgoing requests, no replay, no breadcrumbs,
// and nothing that can carry user input (URLs, query strings, headers, cookies, bodies, locals).
// This Worker carries bearer tokens and tool arguments, so the request is always deleted,
// `extra` is always deleted, and bearer/credential-looking values are redacted from free text.

type Frame = { vars?: unknown; filename?: string; abs_path?: string };
type ScrubbableEvent = {
  message?: string;
  request?: unknown;
  user?: unknown;
  breadcrumbs?: unknown;
  extra?: unknown;
  transaction?: string;
  tags?: Record<string, unknown>;
  contexts?: Record<string, unknown>;
  exception?: { values?: { value?: string; stacktrace?: { frames?: Frame[] } }[] };
  debug_meta?: { images?: { code_file?: string }[] };
};

// Contexts that describe the platform only. Everything else (for example `trace`, `response`
// or `cloud_resource`) is dropped.
const SAFE_CONTEXTS = ['os', 'runtime', 'browser', 'device', 'app'];
const TEXT_LIMIT = 1024;

const stripQuery = (value: string) => value.split(/[?#]/)[0];
// Drops ?query and #hash from every URL or absolute path inside free text, e.g. an error message.
const stripUrlQueries = (text: string) => text.replace(/((?:https?:\/\/|\/)[^\s?#"'<>()]*)[?#][^\s"'<>()]*/g, '$1');
// Removes bearer tokens and key=value / "key": "value" credentials from free text.
const redactCredentials = (text: string) => text
  .replace(/((?:token|password|secret|authorization|cookie|api[_-]?key|credential)[\w-]*["']?\s*[:=]\s*["']?)(?:(Bearer|Basic)\s+)?[^\s"'&,}]+/gi,
    (_match, key: string, scheme?: string) => `${key}${scheme ? `${scheme} ` : ''}[redacted]`)
  .replace(/\b(Bearer|Basic)\s+(?!\[redacted\])[\x21-\x7E]+/gi, '$1 [redacted]');
const cleanText = (text: string) => redactCredentials(stripUrlQueries(text)).slice(0, TEXT_LIMIT);

export function scrubEvent<T extends ScrubbableEvent>(event: T): T {
  delete event.request;
  delete event.user;
  delete event.breadcrumbs;
  delete event.extra;
  if (event.contexts) {
    const kept: Record<string, unknown> = {};
    for (const key of SAFE_CONTEXTS) if (key in event.contexts) kept[key] = event.contexts[key];
    event.contexts = kept;
  }
  if (typeof event.message === 'string') event.message = cleanText(event.message);
  if (typeof event.transaction === 'string') event.transaction = stripQuery(event.transaction);
  if (event.tags) {
    delete event.tags.url;
    for (const [key, value] of Object.entries(event.tags)) {
      if (typeof value === 'string') event.tags[key] = redactCredentials(stripQuery(value));
    }
  }
  for (const value of event.exception?.values ?? []) {
    if (typeof value.value === 'string') value.value = cleanText(value.value);
    for (const frame of value.stacktrace?.frames ?? []) {
      delete frame.vars;
      if (typeof frame.filename === 'string') frame.filename = stripQuery(frame.filename);
      if (typeof frame.abs_path === 'string') frame.abs_path = stripQuery(frame.abs_path);
    }
  }
  for (const image of event.debug_meta?.images ?? []) {
    if (typeof image.code_file === 'string') image.code_file = stripQuery(image.code_file);
  }
  return event;
}

// Disabled (a no-op) unless the SENTRY_DSN Worker secret is set.
export function sentryOptions(env: { SENTRY_DSN?: string }) {
  const dsn = env.SENTRY_DSN || undefined;
  return {
    dsn,
    enabled: Boolean(dsn),
    // @sentry/cloudflare 11 removed `sendDefaultPii` (it no longer accepts the key); its
    // replacement `dataCollection` defaults to collecting a lot, so every category is off here.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
      frameContextLines: 0,
    },
    // Never rewrite fetch error messages (keeps the Worker's behaviour identical with or without Sentry).
    enhanceFetchErrorMessages: false as const,
    sendClientReports: false,
    tracesSampleRate: undefined,
    tracePropagationTargets: [] as string[],
    maxBreadcrumbs: 0,
    beforeSend: scrubEvent,
    beforeSendTransaction: () => null,
  };
}
