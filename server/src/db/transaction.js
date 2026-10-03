export async function runInTransaction(client, operation) {
    await client.query('BEGIN');
    try {
        const result = await operation(client);
        await client.query('COMMIT');
        return result;
    }
    catch (error) {
        await client.query('ROLLBACK');
        throw error;
    }
}