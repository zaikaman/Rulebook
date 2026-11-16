#!/usr/bin/env node
/**
 * Applies `db/migrations/*.sql` in filename order against Postgres (Supabase or a local
 * instance), recording each applied file in `schema_migrations`.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from 'pg';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(HERE, '..', 'db', 'migrations');

/** Runs every pending migration and returns the files applied. */
export async function migrate(databaseUrl: string): Promise<string[]> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  const applied: string[] = [];
  try {
    await client.query(`
      create table if not exists schema_migrations (
        filename text primary key,
        applied_at timestamptz not null default now()
      )
    `);

    const files = readdirSync(MIGRATIONS_DIR)
      .filter((file) => file.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const seen = await client.query('select 1 from schema_migrations where filename = $1', [
        file,
      ]);
      if ((seen.rowCount ?? 0) > 0) continue;
      const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
      await client.query('begin');
      try {
        await client.query(sql);
        await client.query('insert into schema_migrations (filename) values ($1)', [file]);
        await client.query('commit');
        applied.push(file);
      } catch (error) {
        await client.query('rollback');
        throw error;
      }
    }
    return applied;
  } finally {
    await client.end();
  }
}

const databaseUrl = process.env.DATABASE_URL ?? process.env.SUPABASE_DB_URL;
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (!databaseUrl) {
    console.error('Set DATABASE_URL or SUPABASE_DB_URL before running migrations.');
    process.exit(1);
  }
  migrate(databaseUrl)
    .then((applied) => {
      console.log(
        applied.length === 0 ? 'No pending migrations.' : `Applied: ${applied.join(', ')}`,
      );
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exit(1);
    });
}
