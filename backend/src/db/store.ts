import type { SupabaseClient } from '@supabase/supabase-js';

/** A value the read model stores. uint256 values are decimal strings, never numbers. */
export type StoreValue = string | number | boolean | null;
export type Row = Record<string, StoreValue>;

export interface SelectOptions {
  readonly limit?: number;
  readonly orderBy?: { readonly column: string; readonly ascending?: boolean };
}

/** The narrow read-model surface the indexer and API need. */
export interface Store {
  upsert(table: string, rows: readonly Row[], onConflict: string): Promise<void>;
  /** Inserts only when the conflict key is free; returns false when the row already exists. */
  insert(table: string, row: Row, onConflict: string): Promise<boolean>;
  select(
    table: string,
    filters?: Readonly<Record<string, StoreValue>>,
    options?: SelectOptions,
  ): Promise<Row[]>;
  selectOne(table: string, filters: Readonly<Record<string, StoreValue>>): Promise<Row | null>;
  count(table: string, filters?: Readonly<Record<string, StoreValue>>): Promise<number>;
  deleteWhere(table: string, filters: Readonly<Record<string, StoreValue>>): Promise<void>;
  truncate(tables: Readonly<Record<string, string>>): Promise<void>;
}

// PostgREST serializes numeric(78, 0) as JSON numbers unless PostgreSQL casts them to text.
const DECIMAL_COLUMNS: Partial<Record<string, readonly string[]>> = {
  vaults: ['max_spend_per_run'],
  rules: ['rule_id', 'amount_in', 'threshold', 'secondary'],
  executions: ['rule_id', 'amount_in', 'amount_out'],
  callbacks: ['destination_chain_id'],
  rule_events: ['rule_id'],
  mirrors: ['rule_id', 'leader_rule_id', 'per_run_cap'],
  listings: ['listing_id', 'rule_id'],
  sponsor_ledger: ['amount'],
  price_observations: ['price'],
  starter_funds: ['amount_usdc', 'amount_weth'],
};

/** Supabase-backed store. Service-role key only; never constructed in the browser. */
export class SupabaseStore implements Store {
  constructor(private readonly client: SupabaseClient) {}

  async upsert(table: string, rows: readonly Row[], onConflict: string): Promise<void> {
    if (rows.length === 0) return;
    const { error } = await this.client
      .from(table)
      .upsert([...rows], { onConflict })
      .select();
    if (error) throw new Error(`upsert ${table} failed: ${error.message}`);
  }

  async insert(table: string, row: Row, _onConflict: string): Promise<boolean> {
    const { error } = await this.client.from(table).insert([row]);
    if (!error) return true;
    if (error.code === '23505' || /duplicate key/i.test(error.message)) return false;
    throw new Error(`insert ${table} failed: ${error.message}`);
  }

  async select(
    table: string,
    filters: Readonly<Record<string, StoreValue>> = {},
    options: SelectOptions = {},
  ): Promise<Row[]> {
    const decimalColumns = (DECIMAL_COLUMNS[table] ?? []).map((column) => ({
      column,
      alias: `${column}_text`,
    }));
    const projection = [
      '*',
      ...decimalColumns.map(({ column, alias }) => `${alias}:${column}::text`),
    ];
    let query = this.client.from(table).select(projection.join(','));
    for (const [column, value] of Object.entries(filters)) query = query.eq(column, value);
    if (options.orderBy) {
      query = query.order(options.orderBy.column, {
        ascending: options.orderBy.ascending ?? false,
      });
    }
    if (options.limit !== undefined) query = query.limit(options.limit);
    const { data, error } = await query.overrideTypes<Row[], { merge: false }>();
    if (error) throw new Error(`select ${table} failed: ${error.message}`);
    const rows = data ?? [];
    for (const row of rows) {
      for (const { column, alias } of decimalColumns) {
        row[column] = row[alias] ?? null;
        delete row[alias];
      }
    }
    return rows;
  }

  async selectOne(
    table: string,
    filters: Readonly<Record<string, StoreValue>>,
  ): Promise<Row | null> {
    const rows = await this.select(table, filters, { limit: 1 });
    return rows[0] ?? null;
  }

  async count(table: string, filters: Readonly<Record<string, StoreValue>> = {}): Promise<number> {
    let query = this.client.from(table).select('*', { count: 'exact', head: true });
    for (const [column, value] of Object.entries(filters)) query = query.eq(column, value);
    const { count, error } = await query;
    if (error) throw new Error(`count ${table} failed: ${error.message}`);
    return count ?? 0;
  }

  async deleteWhere(table: string, filters: Readonly<Record<string, StoreValue>>): Promise<void> {
    let query = this.client.from(table).delete();
    for (const [column, value] of Object.entries(filters)) query = query.eq(column, value);
    const { error } = await query;
    if (error) throw new Error(`delete ${table} failed: ${error.message}`);
  }

  async truncate(tables: Readonly<Record<string, string>>): Promise<void> {
    for (const [table, keyColumn] of Object.entries(tables)) {
      const { error } = await this.client.from(table).delete().not(keyColumn, 'is', null);
      if (error) throw new Error(`truncate ${table} failed: ${error.message}`);
    }
  }
}

/** In-memory store used by hermetic tests and the backfill dry run. */
export class InMemoryStore implements Store {
  private readonly tables = new Map<string, Row[]>();

  private table(name: string): Row[] {
    const existing = this.tables.get(name);
    if (existing) return existing;
    const created: Row[] = [];
    this.tables.set(name, created);
    return created;
  }

  async upsert(table: string, rows: readonly Row[], onConflict: string): Promise<void> {
    const keys = onConflict.split(',').map((key) => key.trim());
    const target = this.table(table);
    for (const row of rows) {
      const index = target.findIndex((candidate) =>
        keys.every((key) => candidate[key] === row[key]),
      );
      if (index >= 0) target[index] = { ...target[index], ...row };
      else target.push({ ...row });
    }
  }

  async insert(table: string, row: Row, onConflict: string): Promise<boolean> {
    const keys = onConflict.split(',').map((key) => key.trim());
    const target = this.table(table);
    const exists = target.some((candidate) => keys.every((key) => candidate[key] === row[key]));
    if (exists) return false;
    target.push({ ...row });
    return true;
  }

  async select(
    table: string,
    filters: Readonly<Record<string, StoreValue>> = {},
    options: SelectOptions = {},
  ): Promise<Row[]> {
    let rows = this.table(table).filter((row) =>
      Object.entries(filters).every(([column, value]) => row[column] === value),
    );
    if (options.orderBy) {
      const { column, ascending = false } = options.orderBy;
      rows = [...rows].sort((left, right) => {
        const a = left[column];
        const b = right[column];
        if (a === b) return 0;
        const order = (a ?? '') < (b ?? '') ? -1 : 1;
        return ascending ? order : -order;
      });
    }
    if (options.limit !== undefined) rows = rows.slice(0, options.limit);
    return rows.map((row) => ({ ...row }));
  }

  async selectOne(
    table: string,
    filters: Readonly<Record<string, StoreValue>>,
  ): Promise<Row | null> {
    const rows = await this.select(table, filters, { limit: 1 });
    return rows[0] ?? null;
  }

  async count(table: string, filters: Readonly<Record<string, StoreValue>> = {}): Promise<number> {
    return (await this.select(table, filters)).length;
  }

  async deleteWhere(table: string, filters: Readonly<Record<string, StoreValue>>): Promise<void> {
    const remaining = this.table(table).filter(
      (row) => !Object.entries(filters).every(([column, value]) => row[column] === value),
    );
    this.tables.set(table, remaining);
  }

  async truncate(tables: Readonly<Record<string, string>>): Promise<void> {
    for (const table of Object.keys(tables)) this.tables.set(table, []);
  }
}
