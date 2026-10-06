import assert from 'node:assert/strict';
import test from 'node:test';
import { requireTrustedOrigin } from '../src/middleware/trustedOrigin.js';

function runMiddleware({ method = 'POST', origin } = {}) {
  let nextCalled = false;
  let statusCode;
  let body;
  const request = {
    method,
    get: (name) => name === 'origin' ? origin : undefined,
  };
  const response = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(value) {
      body = value;
      return this;
    },
  };

  requireTrustedOrigin(request, response, () => { nextCalled = true; });
  return { nextCalled, statusCode, body };
}

test('trusted origin middleware rejects missing and untrusted origins for mutations', () => {
  assert.equal(runMiddleware().statusCode, 403);
  assert.equal(runMiddleware({ origin: 'https://attacker.example' }).statusCode, 403);
  assert.equal(runMiddleware({ origin: 'null' }).statusCode, 403);
});

test('trusted origin middleware allows the configured client origin for mutations', () => {
  const configuredOrigin = new URL(process.env.CLIENT_URL ?? 'http://localhost:5173').origin;
  assert.equal(runMiddleware({ origin: configuredOrigin }).nextCalled, true);
});

test('trusted origin middleware allows the known production and local origins', () => {
  assert.equal(runMiddleware({ origin: 'https://mkmroad.netlify.app' }).nextCalled, true);
  assert.equal(runMiddleware({ origin: 'http://localhost:5173' }).nextCalled, true);
});

test('trusted origin middleware does not restrict safe methods', () => {
  assert.equal(runMiddleware({ method: 'GET' }).nextCalled, true);
  assert.equal(runMiddleware({ method: 'OPTIONS' }).nextCalled, true);
});
