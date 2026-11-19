import type { Hono } from 'hono';
import type { Db } from '../db';
import magic from './magic';
import push from './push';
import hr from './hr';

/** Server extension modules. Each exports `(db) => Hono` mounted under /api/<name>. */
export function buildExtensions(db: Db): [string, Hono][] {
  return [['/magic', magic(db)], ['/push', push(db)], ['/hr', hr(db)]];
}
