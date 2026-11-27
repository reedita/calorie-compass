const { Pool } = require("pg");

if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is missing.");
}

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000
});

function convertSQL(sql) {
    let index = 0;
    let converted = sql.replace(/\?/g, () => `$${++index}`);

    converted = converted.replace(
        /DATE_ADD\(NOW\(\),\s*INTERVAL\s+(\d+)\s+MINUTE\)/gi,
        "NOW() + INTERVAL '$1 minutes'"
    );

    converted = converted.replace(
        /DATE_SUB\(NOW\(\),\s*INTERVAL\s+(\d+)\s+DAY\)/gi,
        "NOW() - INTERVAL '$1 days'"
    );

    return converted;
}

function addReturning(sql) {
    if (!/^\s*INSERT\s+INTO/i.test(sql) || /\bRETURNING\b/i.test(sql)) {
        return sql;
    }

    const table = sql.match(/INSERT\s+INTO\s+(\w+)/i)?.[1]?.toLowerCase();

    const idColumns = {
        users: "user_id",
        auth_codes: "id",
        food_entries: "id",
        activity_entries: "id",
        weight_entries: "id",
        password_reset_sessions: "session_id"
    };

    const column = idColumns[table];
    return column ? `${sql.trim().replace(/;$/, "")} RETURNING ${column}` : sql;
}

function normalizeError(error) {
    if (error.code === "23505") error.code = "ER_DUP_ENTRY";
    return error;
}

async function run(sql, params = []) {
    const converted = addReturning(convertSQL(sql));

    try {
        const result = await pool.query(converted, params);
        const isSelect = /^\s*(SELECT|WITH)\b/i.test(sql);

        if (isSelect) {
            return [result.rows, result];
        }

        return [{
            affectedRows: result.rowCount,
            insertId: result.rows[0]?.id ??
                result.rows[0]?.user_id ??
                result.rows[0]?.session_id ??
                null,
            rows: result.rows
        }, result];
    } catch (error) {
        throw normalizeError(error);
    }
}

const db = {
    query: run,
    execute: run,

    async getConnection() {
        const client = await pool.connect();

        return {
            async query(sql, params = []) {
                return runOnClient(client, sql, params);
            },
            async execute(sql, params = []) {
                return runOnClient(client, sql, params);
            },
            async beginTransaction() {
                await client.query("BEGIN");
            },
            async commit() {
                await client.query("COMMIT");
            },
            async rollback() {
                await client.query("ROLLBACK");
            },
            release() {
                client.release();
            }
        };
    },

    async connect() {
        const client = await pool.connect();
        client.release();
    },

    async end() {
        await pool.end();
    }
};

async function runOnClient(client, sql, params = []) {
    const converted = addReturning(convertSQL(sql));

    try {
        const result = await client.query(converted, params);
        const isSelect = /^\s*(SELECT|WITH)\b/i.test(sql);

        if (isSelect) {
            return [result.rows, result];
        }

        return [{
            affectedRows: result.rowCount,
            insertId: result.rows[0]?.id ??
                result.rows[0]?.user_id ??
                result.rows[0]?.session_id ??
                null,
            rows: result.rows
        }, result];
    } catch (error) {
        throw normalizeError(error);
    }
}

module.exports = db;
