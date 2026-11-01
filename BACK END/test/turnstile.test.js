const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const verifyTurnstile = require('../middleware/verifyTurnstile');

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

async function runMiddleware(token, fetchImplementation, options = {}) {
  const previousFetch = global.fetch;
  const previousSecret = process.env.TURNSTILE_SECRET_KEY;
  const previousHostname = process.env.TURNSTILE_EXPECTED_HOSTNAME;
  global.fetch = fetchImplementation;
  if (options.secret === undefined) delete process.env.TURNSTILE_SECRET_KEY;
  else process.env.TURNSTILE_SECRET_KEY = options.secret;
  if (options.hostname === undefined) delete process.env.TURNSTILE_EXPECTED_HOSTNAME;
  else process.env.TURNSTILE_EXPECTED_HOSTNAME = options.hostname;

  const res = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  let continued = false;
  const req = { get: name => name.toLowerCase() === 'cf-turnstile-response' ? token : undefined };

  try {
    await verifyTurnstile(req, res, () => { continued = true; });
    return { res, continued };
  } finally {
    global.fetch = previousFetch;
    if (previousSecret === undefined) delete process.env.TURNSTILE_SECRET_KEY;
    else process.env.TURNSTILE_SECRET_KEY = previousSecret;
    if (previousHostname === undefined) delete process.env.TURNSTILE_EXPECTED_HOSTNAME;
    else process.env.TURNSTILE_EXPECTED_HOSTNAME = previousHostname;
  }
}

test('rejects a missing CAPTCHA token without calling the provider', async () => {
  const result = await runMiddleware('', () => assert.fail('siteverify should not be called'), { secret: 'test-secret' });
  assert.equal(result.continued, false);
  assert.equal(result.res.statusCode, 400);
  assert.match(result.res.body.message, /complete the CAPTCHA/i);
});

test('passes valid tokens only after successful server-side verification', async () => {
  let requestUrl;
  let requestOptions;
  const result = await runMiddleware('valid-token', async (url, options) => {
    requestUrl = url;
    requestOptions = options;
    return { ok: true, json: async () => ({ success: true, hostname: 'forms.example.org' }) };
  }, { secret: 'test-secret', hostname: 'forms.example.org' });

  assert.equal(result.continued, true);
  assert.equal(requestUrl, VERIFY_URL);
  assert.equal(requestOptions.method, 'POST');
  assert.equal(new URLSearchParams(requestOptions.body).get('secret'), 'test-secret');
  assert.equal(new URLSearchParams(requestOptions.body).get('response'), 'valid-token');
});

test('rejects invalid and mismatched-hostname tokens', async () => {
  const invalid = await runMiddleware('invalid-token', async () => ({
    ok: true,
    json: async () => ({ success: false, 'error-codes': ['invalid-input-response'] }),
  }), { secret: 'test-secret' });
  assert.equal(invalid.continued, false);
  assert.equal(invalid.res.statusCode, 400);
  assert.match(invalid.res.body.message, /failed or expired/i);

  const wrongHostname = await runMiddleware('valid-token', async () => ({
    ok: true,
    json: async () => ({ success: true, hostname: 'other.example.org' }),
  }), { secret: 'test-secret', hostname: 'forms.example.org' });
  assert.equal(wrongHostname.continued, false);
  assert.equal(wrongHostname.res.statusCode, 400);
});

test('fails closed when the provider is not configured or unavailable', async () => {
  const missingSecret = await runMiddleware('valid-token', () => assert.fail('siteverify should not be called'));
  assert.equal(missingSecret.continued, false);
  assert.equal(missingSecret.res.statusCode, 503);

  const providerError = await runMiddleware('valid-token', async () => { throw new Error('network error'); }, { secret: 'test-secret' });
  assert.equal(providerError.continued, false);
  assert.equal(providerError.res.statusCode, 503);
  assert.match(providerError.res.body.message, /temporarily unavailable/i);
});

test('both public submission routes reject requests without a CAPTCHA token', async t => {
  const app = express();
  app.use(express.json());
  app.use('/api/collection-requests', require('../routes/collectionRequests'));
  app.use('/api/reports', require('../routes/reports'));
  const server = await new Promise(resolve => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  t.after(() => new Promise(resolve => server.close(resolve)));

  const base = `http://127.0.0.1:${server.address().port}/api`;
  const collection = await fetch(base + '/collection-requests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fullName: 'Resident' }),
  });
  const report = await fetch(base + '/reports', { method: 'POST', body: new FormData() });

  assert.equal(collection.status, 400);
  assert.equal(report.status, 400);
  assert.match((await collection.json()).message, /complete the CAPTCHA/i);
  assert.match((await report.json()).message, /complete the CAPTCHA/i);
});
