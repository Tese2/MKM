const amountPattern = /^(?:0|[1-9]\d{0,17})(?:\.\d{1,2})?$/;

export async function postWalletMovement(client, {
    userId,
    walletId,
    amount,
    direction,
    lockedDirection = 'NONE',
    insufficientBalanceStatus = 409,
    insufficientBalanceCode = 'INSUFFICIENT_BALANCE',
    insufficientBalanceMessage = 'Available balance is insufficient for this movement.',
    transactionType,
    referenceId = null,
    referenceType = null,
    externalReference = null,
    description,
    ledgerStatus = 'COMPLETED',
    transactionStatus = 'COMPLETED',
}) {
    validateMovement({ amount, direction, lockedDirection, transactionType, description });
    const walletResult = await client.query(walletId
        ? 'SELECT id FROM wallets WHERE id = $1 AND user_id = $2 FOR UPDATE'
        : 'SELECT id FROM wallets WHERE user_id = $1 FOR UPDATE', walletId ? [walletId, userId] : [userId]);
    const wallet = walletResult.rows[0];
    if (!wallet)
        throw Object.assign(new Error('Wallet not found.'), { status: 409, code: 'WALLET_NOT_FOUND' });

    const updated = await client.query(`UPDATE wallets
     SET available_balance = available_balance + CASE WHEN $2 = 'CREDIT' THEN $3::numeric ELSE -$3::numeric END,
         locked_balance = locked_balance + CASE WHEN $4 = 'CREDIT' THEN $3::numeric WHEN $4 = 'DEBIT' THEN -$3::numeric ELSE 0 END,
         updated_at = now()
     WHERE id = $1
       AND available_balance + CASE WHEN $2 = 'CREDIT' THEN $3::numeric ELSE -$3::numeric END >= 0
       AND locked_balance + CASE WHEN $4 = 'CREDIT' THEN $3::numeric WHEN $4 = 'DEBIT' THEN -$3::numeric ELSE 0 END >= 0
     RETURNING available_balance::text AS available_balance, locked_balance::text AS locked_balance`,
    [wallet.id, direction, amount, lockedDirection]);
    if (!updated.rowCount) {
        const insufficientAvailable = direction === 'DEBIT';
        throw Object.assign(new Error(insufficientAvailable
            ? insufficientBalanceMessage
            : 'The locked balance is insufficient for this movement.'), {
            status: direction === 'DEBIT' ? insufficientBalanceStatus : 409,
            code: insufficientAvailable ? insufficientBalanceCode : 'LOCKED_BALANCE_INSUFFICIENT',
        });
    }

    const credit = direction === 'CREDIT' ? amount : '0';
    const debit = direction === 'DEBIT' ? amount : '0';
    const ledger = await client.query(`INSERT INTO wallet_ledger(wallet_id, user_id, transaction_type, reference_id,
       credit, debit, balance_after, description, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [wallet.id, userId, transactionType, referenceId, credit, debit, updated.rows[0].available_balance, description, ledgerStatus]);
    const transaction = await client.query(`INSERT INTO transactions(user_id, type, amount, direction, status,
       reference_type, reference_id, external_reference, description)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [userId, transactionType, amount, direction, transactionStatus, referenceType, referenceId, externalReference, description]);

    return {
        walletId: wallet.id,
        availableBalance: updated.rows[0].available_balance,
        lockedBalance: updated.rows[0].locked_balance,
        ledgerId: ledger.rows[0].id,
        transactionId: transaction.rows[0].id,
    };
}

export async function adjustLockedBalance(client, { userId, amount, direction }) {
    validateAmount(amount);
    if (!['CREDIT', 'DEBIT'].includes(direction))
        throw new TypeError('Locked balance direction must be CREDIT or DEBIT.');
    const wallet = await client.query('SELECT id FROM wallets WHERE user_id = $1 FOR UPDATE', [userId]);
    if (!wallet.rowCount)
        throw Object.assign(new Error('Wallet not found.'), { status: 409, code: 'WALLET_NOT_FOUND' });
    const updated = await client.query(`UPDATE wallets
     SET locked_balance = locked_balance + CASE WHEN $2 = 'CREDIT' THEN $3::numeric ELSE -$3::numeric END,
         updated_at = now()
     WHERE id = $1
       AND locked_balance + CASE WHEN $2 = 'CREDIT' THEN $3::numeric ELSE -$3::numeric END >= 0
     RETURNING locked_balance::text AS locked_balance`, [wallet.rows[0].id, direction, amount]);
    if (!updated.rowCount)
        throw Object.assign(new Error('The locked balance is insufficient for this movement.'), { status: 409, code: 'LOCKED_BALANCE_INSUFFICIENT' });
    return updated.rows[0].locked_balance;
}

function validateMovement({ amount, direction, lockedDirection, transactionType, description }) {
    validateAmount(amount);
    if (!['CREDIT', 'DEBIT'].includes(direction))
        throw new TypeError('Wallet movement direction must be CREDIT or DEBIT.');
    if (!['CREDIT', 'DEBIT', 'NONE'].includes(lockedDirection))
        throw new TypeError('Locked balance direction must be CREDIT, DEBIT, or NONE.');
    if (typeof transactionType !== 'string' || !transactionType)
        throw new TypeError('Wallet movement transaction type is required.');
    if (typeof description !== 'string' || !description)
        throw new TypeError('Wallet movement description is required.');
}

function validateAmount(amount) {
    if (typeof amount !== 'string' || !amountPattern.test(amount) || decimalCents(amount) <= 0n)
        throw new TypeError('Wallet movement amount must be a positive decimal with at most two places.');
}

function decimalCents(amount) {
    const [whole, fraction = ''] = amount.split('.');
    return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
}