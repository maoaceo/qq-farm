export {};
const fs = require('node:fs');
const Database = require('better-sqlite3');
const { getDataFile, ensureDataDir } = require('../config/runtime-paths');
let database: any;
function db(): any {
    if (database) return database;
    ensureDataDir();
    const connection = new Database(getDataFile('users.sqlite'));
    try {
        fs.chmodSync(getDataFile('users.sqlite'), 0o600);
        connection.pragma('journal_mode = WAL'); connection.pragma('foreign_keys = ON'); connection.pragma('busy_timeout = 5000');
        connection.exec(`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT NOT NULL COLLATE NOCASE UNIQUE, password TEXT NOT NULL, disabled INTEGER NOT NULL DEFAULT 0 CHECK(disabled IN (0,1)), createdAt INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS identities (issuer TEXT NOT NULL, subject TEXT NOT NULL, userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, PRIMARY KEY(issuer, subject));
            CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY);`);
        connection.transaction(() => {
            if (connection.prepare('SELECT 1 FROM migrations WHERE name = ?').get('users-json-v1')) return;
            const legacy = getDataFile('users.json');
            if (fs.existsSync(legacy)) {
                // Retain a byte-identical backup; abort on malformed or conflicting data, never silently reset users.
                const raw = fs.readFileSync(legacy); const data = JSON.parse(raw.toString('utf8'));
                if (!Array.isArray(data?.users)) throw new Error('Invalid legacy users.json');
                const backup = getDataFile('users.json.pre-sqlite.bak');
                if (!fs.existsSync(backup)) fs.writeFileSync(backup, raw, { mode: 0o600, flag: 'wx' });
                for (const u of data.users) {
                    if (typeof u.id !== 'string' || !u.id || u.id === 'admin' || typeof u.username !== 'string' || !u.username || typeof u.password !== 'string' || !Number.isFinite(u.createdAt)) throw new Error('Invalid legacy user');
                    connection.prepare('INSERT INTO users(id,username,password,disabled,createdAt) VALUES (?,?,?,?,?)').run(u.id,u.username,u.password,u.disabled ? 1 : 0,u.createdAt);
                    for (const i of u.identities || []) {
                        if (typeof i.issuer !== 'string' || !i.issuer || typeof i.subject !== 'string' || !i.subject) throw new Error('Invalid legacy identity');
                        connection.prepare('INSERT INTO identities(issuer,subject,userId) VALUES (?,?,?)').run(i.issuer,i.subject,u.id);
                    }
                }
            }
            connection.prepare('INSERT INTO migrations(name) VALUES (?)').run('users-json-v1');
        }).immediate();
        database = connection; return connection;
    } catch (error) { connection.close(); throw error; }
}
function close(): void { if (database) { database.close(); database = undefined; } }
module.exports = { db, close };
