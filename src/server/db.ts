import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type Db = Database;

export function openDb(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true });
  // WAL + synchronous=NORMAL is the standard fast/safe pairing (durable across app crashes; only an OS crash can lose the last commits,
// and the hourly backup + client outbox cover that). Memory-mapped reads + a larger page cache keep hot reads off the disk.
  db.exec(`PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;
    PRAGMA cache_size = -32768; PRAGMA temp_store = MEMORY; PRAGMA mmap_size = 134217728; PRAGMA journal_size_limit = 67108864;`);
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE,
      pass_hash TEXT,
      name TEXT NOT NULL DEFAULT '',
      seq INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tokens (
      hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      last_used INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS tokens_user ON tokens(user_id);
    CREATE TABLE IF NOT EXISTS api_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      scope TEXT NOT NULL CHECK (scope IN ('read','write')),
      hash TEXT NOT NULL UNIQUE,
      prefix TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      last_used INTEGER,
      revoked INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS api_tokens_user ON api_tokens(user_id);
    CREATE TABLE IF NOT EXISTS entities (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      id TEXT NOT NULL,
      json TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted INTEGER NOT NULL DEFAULT 0,
      seq INTEGER NOT NULL,
      PRIMARY KEY (user_id, type, id)
    );
    CREATE INDEX IF NOT EXISTS entities_seq ON entities(user_id, seq);
    CREATE TABLE IF NOT EXISTS events (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      at INTEGER NOT NULL,
      kind TEXT NOT NULL,
      session_id TEXT,
      payload TEXT,
      PRIMARY KEY (user_id, id)
    );
    CREATE INDEX IF NOT EXISTS events_user_at ON events(user_id, at);
  `);
  db.exec('PRAGMA optimize = 0x10002'); // analyse tables so the planner picks the indexes
  return db;
}
