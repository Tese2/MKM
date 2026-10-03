import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';
import test from 'node:test';
import { createUserRateLimit } from '../src/middleware/userRateLimit.js';

test('authenticated mutation rate limits are enforced independently per user', async () => {
  const app = express();
  app.use((request, _response, next) => {
    request.auth = { userId: request.get('x-test-user') ?? 'customer-a' };
    next();
  });
  app.post('/mutation', createUserRateLimit({ limit: 2, windowMs: 60_000 }), (_request, response) => response.sendStatus(204));

  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}/mutation`;

  try {
    const first = await fetch(url, { method: 'POST' });
    const second = await fetch(url, { method: 'POST' });
    const blocked = await fetch(url, { method: 'POST' });
    const otherUser = await fetch(url, { method: 'POST', headers: { 'x-test-user': 'customer-b' } });

    assert.equal(first.status, 204);
    assert.equal(second.status, 204);
    assert.equal(blocked.status, 429);
    assert.equal((await blocked.json()).code, 'RATE_LIMITED');
    assert.equal(otherUser.status, 204);
  } finally {
    server.closeAllConnections();
    server.close();
    await once(server, 'close');
  }
});
