import assert from 'node:assert/strict';
import test from 'node:test';
import { app } from '../src/app.js';

test('health endpoint reports service status and database availability', async () => {
  const server = app.listen(0);

  try {
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;

    const response = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(response.status, 200);

    const body = await response.json();
    assert.equal(body.success, true);
    assert.equal(body.data.status, 'ok');
    assert.ok(['ok', 'unavailable', 'not-configured'].includes(body.data.database));
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
});
