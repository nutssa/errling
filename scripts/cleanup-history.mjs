import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const daysArg = args.find(value => value.startsWith('--older-than-days='));
const days = Number(daysArg?.split('=')[1] || 30);
if (!Number.isInteger(days) || days < 1 || days > 3650) throw new Error('Use --older-than-days=1..3650');
const apply = args.includes('--apply');
const root = resolve(import.meta.dirname, '..');
const path = resolve(root, process.env.ERRLING_DB_PATH || 'data/errling.sqlite');
if (!existsSync(path)) { console.log('No local database exists.'); process.exit(0); }
const db = new DatabaseSync(path);
try {
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  const candidate = db.prepare('SELECT COUNT(*) AS count FROM runs WHERE created_at < ?').get(cutoff);
  const count = Number(candidate.count);
  if (!apply) { console.log(`${count} run(s) older than ${days} days. Dry run; add --apply to remove them.`); process.exit(0); }
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM events WHERE run_id IN (SELECT id FROM runs WHERE created_at < ?)').run(cutoff);
    db.prepare('DELETE FROM runs WHERE created_at < ?').run(cutoff);
    db.exec('COMMIT');
    console.log(`Removed ${count} run(s) older than ${days} days.`);
  } catch (error) { db.exec('ROLLBACK'); throw error; }
} finally { db.close(); }
