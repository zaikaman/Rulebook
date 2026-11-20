#!/usr/bin/env node
/**
 * Applies `db/migrations/*.sql` in filename order against Postgres (Supabase or a local
 * instance), recording each applied file in `schema_migrations`.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from 'pg';

const MIGRATIONS_DIR = new URL('../db/migrations/', import.meta.url);

/** Runs every pending migration and returns the files applied. */
export async function migrate(databaseUrl) {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  const applied = [];
  try {
    await client.query('begin');
    await client.query("select pg_advisory_xact_lock(hashtext('rulebook-schema-migrations'))");
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
      const sql = readFileSync(new URL(file, MIGRATIONS_DIR), 'utf8');
      await client.query(sql);
      await client.query('insert into schema_migrations (filename) values ($1)', [file]);
      applied.push(file);
    }
    await client.query('commit');
    return applied;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    await client.end();
  }
}

const databaseUrl = process.env.DATABASE_URL ?? process.env.SUPABASE_DB_URL;
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  if (!databaseUrl) {
    console.error('Set DATABASE_URL or SUPABASE_DB_URL before running migrations.');
    process.exit(1);
  }
  migrate(databaseUrl)
    .then((applied) => {
      process.stdout.write(
        (applied.length === 0 ? 'No pending migrations.' : `Applied: ${applied.join(', ')}`) + '\n',
      );
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
