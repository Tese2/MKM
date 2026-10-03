import assert from 'node:assert/strict';
import test from 'node:test';
import { runIdempotent } from '../src/db/idempotency.js';
import { runInTransaction } from '../src/db/transaction.js';
import { adjustLockedBalance, postWalletMovement } from '../src/services/wallet.js';

test('same idempotency key and payload replays the original result', async () => {
    const store = new MemoryIdempotencyStore();
    const firstClient = new MemoryIdempotencyClient(store);
    const secondClient = new MemoryIdempotencyClient(store);
    let executions = 0;
    const options = idempotencyOptions({ amount: '12.50', account: 'acct-1' });
    const first = await runInTransaction(firstClient, () => runIdempotent(firstClient, options, async () => {
        executions += 1;
        return { status: 201, body: { requestId: 'request-1' } };
    }));
    const replay = await runInTransaction(secondClient, () => runIdempotent(secondClient, idempotencyOptions({ account: 'acct-1', amount: '12.50' }), async () => {
        executions += 1;
        return { status: 201, body: { requestId: 'unexpected' } };
    }));

    assert.equal(executions, 1);
    assert.equal(first.replayed, false);
    assert.deepEqual(replay, { status: 201, body: { requestId: 'request-1' }, replayed: true });
    const stored = [...store.rows.values()][0];
    assert.equal(JSON.stringify(stored).includes('acct-1'), false);
    assert.equal(JSON.stringify(stored).includes('client-key-0001'), false);
});

test('same idempotency key with a different payload is rejected', async () => {
    const store = new MemoryIdempotencyStore();
    const client = new MemoryIdempotencyClient(store);
    const operation = () => ({ status: 200, body: { complete: true } });
    await runInTransaction(client, () => runIdempotent(client, idempotencyOptions({ amount: '10.00' }), operation));

    await assert.rejects(
        runInTransaction(client, () => runIdempotent(client, idempotencyOptions({ amount: '11.00' }), operation)),
        { code: 'IDEMPOTENCY_KEY_CONFLICT' },
    );
});

test('concurrent same-key requests execute the operation once', async () => {
    const store = new MemoryIdempotencyStore();
    const firstClient = new MemoryIdempotencyClient(store);
    const secondClient = new MemoryIdempotencyClient(store);
    let executions = 0;
    let continueFirst;
    const firstGate = new Promise((resolve) => { continueFirst = resolve; });
    const options = idempotencyOptions({ amount: '25.00' });
    const first = runInTransaction(firstClient, () => runIdempotent(firstClient, options, async () => {
        executions += 1;
        await firstGate;
        return { status: 201, body: { id: 'one-result' } };
    }));
    await new Promise((resolve) => setImmediate(resolve));
    const second = runInTransaction(secondClient, () => runIdempotent(secondClient, options, async () => {
        executions += 1;
        return { status: 201, body: { id: 'duplicate' } };
    }));
    continueFirst();
    const results = await Promise.all([first, second]);

    assert.equal(executions, 1);
    assert.deepEqual(results.map((result) => result.body.id), ['one-result', 'one-result']);
    assert.equal(results.filter((result) => result.replayed).length, 1);
});

test('failed idempotent operation rolls its key back with the transaction', async () => {
    const store = new MemoryIdempotencyStore();
    const client = new MemoryIdempotencyClient(store);

    await assert.rejects(runInTransaction(client, () => runIdempotent(client, idempotencyOptions({ amount: '8.00' }), async () => {
        throw new Error('simulated financial failure');
    })), /simulated financial failure/);
    assert.equal(store.rows.size, 0);
});

test('wallet movements create matching ledger and transaction records', async () => {
    const store = new MemoryWalletStore();
    const client = new MemoryWalletClient(store);
    const movement = await runInTransaction(client, () => postWalletMovement(client, walletMovement({ amount: '12.34', direction: 'CREDIT' })));

    assert.equal(movement.availableBalance, '112.34');
    assert.equal(store.state.ledger.length, 1);
    assert.equal(store.state.transactions.length, 1);
    assert.equal(store.state.ledger[0].walletId, store.state.transactions[0].walletId);
    assert.equal(store.state.ledger[0].userId, store.state.transactions[0].userId);
    assert.equal(store.state.ledger[0].credit, '12.34');
    assert.equal(store.state.ledger[0].debit, '0');
});

test('wallet debit cannot make available balance negative', async () => {
    const store = new MemoryWalletStore();
    const client = new MemoryWalletClient(store);

    await assert.rejects(postWalletMovement(client, walletMovement({ amount: '100.01', direction: 'DEBIT' })), { code: 'INSUFFICIENT_BALANCE' });
    assert.equal(store.state.availableCents, 10000n);
    assert.equal(store.state.ledger.length, 0);
    assert.equal(store.state.transactions.length, 0);
});

test('withdrawal reservation moves funds to locked balance atomically', async () => {
    const store = new MemoryWalletStore();
    const client = new MemoryWalletClient(store);
    const movement = await runInTransaction(client, () => postWalletMovement(client, walletMovement({
        amount: '30.00',
        direction: 'DEBIT',
        lockedDirection: 'CREDIT',
        transactionType: 'WITHDRAWAL',
        ledgerStatus: 'PENDING',
        transactionStatus: 'PENDING',
    })));

    assert.equal(movement.availableBalance, '70.00');
    assert.equal(movement.lockedBalance, '30.00');
    assert.equal(store.state.ledger[0].debit, '30.00');
    await adjustLockedBalance(client, { userId: 'user-1', amount: '30.00', direction: 'DEBIT' });
    assert.equal(store.state.lockedCents, 0n);
    await assert.rejects(adjustLockedBalance(client, { userId: 'user-1', amount: '30.00', direction: 'DEBIT' }), { code: 'LOCKED_BALANCE_INSUFFICIENT' });
});

test('wallet movement rejects a wallet owned by another user', async () => {
    const store = new MemoryWalletStore();
    const client = new MemoryWalletClient(store);

    await assert.rejects(postWalletMovement(client, walletMovement({ walletId: 'other-wallet' })), { code: 'WALLET_NOT_FOUND' });
    assert.equal(store.state.ledger.length, 0);
    assert.equal(store.state.transactions.length, 0);
});

test('concurrent wallet debits cannot overdraw available balance', async () => {
    const store = new MemoryWalletStore();
    const firstClient = new MemoryWalletClient(store);
    const secondClient = new MemoryWalletClient(store);
    const results = await Promise.allSettled([
        postWalletMovement(firstClient, walletMovement({ amount: '80.00', direction: 'DEBIT' })),
        postWalletMovement(secondClient, walletMovement({ amount: '80.00', direction: 'DEBIT' })),
    ]);

    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
    assert.equal(store.state.availableCents, 2000n);
    assert.equal(store.state.ledger.length, 1);
    assert.equal(store.state.transactions.length, 1);
});

test('failed transaction rolls wallet, ledger, and transaction writes back', async () => {
    const store = new MemoryWalletStore({ failTransactionInsert: true });
    const client = new MemoryWalletClient(store);

    await assert.rejects(runInTransaction(client, () => postWalletMovement(client, walletMovement({ amount: '15.00', direction: 'DEBIT' }))), /simulated transaction insert failure/);
    assert.equal(store.state.availableCents, 10000n);
    assert.equal(store.state.ledger.length, 0);
    assert.equal(store.state.transactions.length, 0);
});

function idempotencyOptions(payload) {
    return { userId: 'user-1', operation: 'test.wallet-credit', key: 'client-key-0001', payload };
}

function walletMovement(overrides) {
    return {
        userId: 'user-1',
        walletId: 'wallet-1',
        amount: '1.00',
        direction: 'CREDIT',
        transactionType: 'DEPOSIT',
        referenceId: 'reference-1',
        referenceType: 'test',
        description: 'Test movement',
        ...overrides,
    };
}

class MemoryIdempotencyStore {
    rows = new Map();
}

class MemoryIdempotencyClient {
    constructor(store) {
        this.store = store;
        this.snapshot = null;
    }

    async query(sql, values = []) {
        if (sql === 'BEGIN') {
            this.snapshot = cloneMap(this.store.rows);
            return { rows: [], rowCount: null };
        }
        if (sql === 'COMMIT') {
            this.snapshot = null;
            return { rows: [], rowCount: null };
        }
        if (sql === 'ROLLBACK') {
            this.store.rows = this.snapshot;
            this.snapshot = null;
            return { rows: [], rowCount: null };
        }
        if (sql.startsWith('INSERT INTO idempotency_keys')) {
            const [key, userId, operation, requestHash, expiresAt] = values;
            let row = this.store.rows.get(key);
            if (row?.pending)
                await row.completed;
            row = this.store.rows.get(key);
            if (row)
                return { rows: [], rowCount: 0 };
            let complete;
            const completed = new Promise((resolve) => { complete = resolve; });
            this.store.rows.set(key, { key, user_id: userId, operation, request_hash: requestHash, expires_at: expiresAt, response_status: null, response_body: null, pending: true, completed, complete });
            return { rows: [{ key }], rowCount: 1 };
        }
        if (sql.startsWith('UPDATE idempotency_keys')) {
            const [key, status, body] = values;
            const row = this.store.rows.get(key);
            row.response_status = status;
            row.response_body = JSON.parse(body);
            row.pending = false;
            row.complete();
            return { rows: [], rowCount: 1 };
        }
        if (sql.startsWith('SELECT user_id, operation, request_hash, response_status, response_body')) {
            const row = this.store.rows.get(values[0]);
            return { rows: row ? [{ user_id: row.user_id, operation: row.operation, request_hash: row.request_hash, response_status: row.response_status, response_body: row.response_body }] : [], rowCount: row ? 1 : 0 };
        }
        throw new Error(`Unexpected idempotency SQL: ${sql}`);
    }
}

class MemoryWalletStore {
    constructor({ failTransactionInsert = false } = {}) {
        this.failTransactionInsert = failTransactionInsert;
        this.state = { walletId: 'wallet-1', userId: 'user-1', availableCents: 10000n, lockedCents: 0n, ledger: [], transactions: [], nextId: 1 };
    }
}

class MemoryWalletClient {
    constructor(store) {
        this.store = store;
        this.snapshot = null;
    }

    async query(sql, values = []) {
        if (sql === 'BEGIN') {
            this.snapshot = structuredClone(this.store.state);
            return { rows: [], rowCount: null };
        }
        if (sql === 'COMMIT') {
            this.snapshot = null;
            return { rows: [], rowCount: null };
        }
        if (sql === 'ROLLBACK') {
            this.store.state = this.snapshot;
            this.snapshot = null;
            return { rows: [], rowCount: null };
        }
        if (sql.startsWith('SELECT id FROM wallets')) {
            const walletMatches = values.length === 1
                ? values[0] === this.store.state.userId
                : values[0] === this.store.state.walletId && values[1] === this.store.state.userId;
            return { rows: walletMatches ? [{ id: this.store.state.walletId }] : [], rowCount: walletMatches ? 1 : 0 };
        }
        if (sql.startsWith('UPDATE wallets')) {
            if (sql.startsWith('UPDATE wallets\n     SET locked_balance')) {
                const [walletId, direction, amount] = values;
                const next = this.store.state.lockedCents + (direction === 'CREDIT' ? toCents(amount) : -toCents(amount));
                if (walletId !== this.store.state.walletId || next < 0n)
                    return { rows: [], rowCount: 0 };
                this.store.state.lockedCents = next;
                return { rows: [{ locked_balance: formatCents(next) }], rowCount: 1 };
            }
            const [walletId, availableDirection, amount, lockedDirection] = values;
            const amountCents = toCents(amount);
            const availableCents = this.store.state.availableCents + (availableDirection === 'CREDIT' ? amountCents : -amountCents);
            const lockedCents = this.store.state.lockedCents + (lockedDirection === 'CREDIT' ? amountCents : lockedDirection === 'DEBIT' ? -amountCents : 0n);
            if (walletId !== this.store.state.walletId || availableCents < 0n || lockedCents < 0n)
                return { rows: [], rowCount: 0 };
            this.store.state.availableCents = availableCents;
            this.store.state.lockedCents = lockedCents;
            return { rows: [{ available_balance: formatCents(availableCents), locked_balance: formatCents(lockedCents) }], rowCount: 1 };
        }
        if (sql.startsWith('INSERT INTO wallet_ledger')) {
            const [walletId, userId, transactionType, referenceId, credit, debit, balanceAfter, description, status] = values;
            const id = `ledger-${this.store.state.nextId++}`;
            this.store.state.ledger.push({ id, walletId, userId, transactionType, referenceId, credit, debit, balanceAfter, description, status });
            return { rows: [{ id }], rowCount: 1 };
        }
        if (sql.startsWith('INSERT INTO transactions')) {
            if (this.store.failTransactionInsert)
                throw new Error('simulated transaction insert failure');
            const [userId, type, amount, direction, status, referenceType, referenceId, externalReference, description] = values;
            const id = `transaction-${this.store.state.nextId++}`;
            this.store.state.transactions.push({ id, userId, type, amount, direction, status, referenceType, referenceId, externalReference, description, walletId: this.store.state.walletId });
            return { rows: [{ id }], rowCount: 1 };
        }
        throw new Error(`Unexpected wallet SQL: ${sql}`);
    }
}

function cloneMap(source) {
    return new Map([...source].map(([key, value]) => [key, { ...value }]));
}

function toCents(amount) {
    const [whole, fraction = ''] = String(amount).split('.');
    return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
}

function formatCents(cents) {
    return `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
}