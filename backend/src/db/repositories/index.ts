import type { Row, Store, StoreValue } from '../store.js';

/**
 * Row shapes for the read model. uint256 values are decimal strings and timestamps are ISO
 * strings, so nothing crosses the API as a number it cannot represent.
 */
export type AgentRow = {
  address: string;
  owner: string;
  factory: string;
  created_tx: string;
  created_block: number;
  rule_count: number;
  chain_id: number;
  indexed_at: string;
};

export type VaultRow = {
  address: string;
  owner: string;
  agent: string;
  chain_id: number;
  created_tx: string;
  mirror_mode: boolean;
  allowed_token_in: string | null;
  allowed_token_out: string | null;
  max_spend_per_run: string | null;
  paused: boolean;
  indexed_at: string;
};

export type RuleRow = {
  agent: string;
  rule_id: string;
  template: number;
  chain_id: number;
  status: 'active' | 'paused' | 'cancelled';
  latched: boolean;
  pair: string | null;
  token_in: string | null;
  token_out: string | null;
  amount_in: string | null;
  threshold: string | null;
  secondary: string | null;
  last_run_at: string | null;
  runs: number;
  is_public: boolean;
  indexed_at: string;
};

export type RuleEventRow = {
  chain_id: number;
  tx_hash: string;
  log_index: number;
  agent: string;
  rule_id: string;
  kind: string;
  block_time: string;
  /** Origin log copied from `RuleEvaluated`; null on events that carry no origin. */
  origin_chain_id?: number | null;
  origin_tx?: string | null;
  origin_log_index?: number | null;
  fired?: boolean | null;
  indexed_at: string;
};

export type ExecutionRow = {
  chain_id: number;
  tx_hash: string;
  log_index: number;
  vault: string;
  agent: string;
  owner: string;
  rule_id: string;
  kind: 'executed' | 'mirrored';
  token_in: string | null;
  token_out: string | null;
  amount_in: string | null;
  amount_out: string | null;
  block_number: number;
  block_time: string;
  leader_tx: string | null;
  status: 'confirmed' | 'refused' | 'pending';
  indexed_at: string;
};

export type CallbackRow = {
  reactive_tx_hash: string;
  callback_index: number;
  reactive_contract: string;
  destination_chain_id: string;
  destination_tx_hash: string | null;
  error_data: string | null;
  block_number: number;
  recorded_at: string;
};

export type MirrorRow = {
  follower_agent: string;
  rule_id: string;
  leader_agent: string;
  leader_rule_id: string;
  scale_bps: number;
  hourly_cap: number;
  indexed_at: string;
};

export type ListingRow = {
  chain_id: number;
  listing_id: string;
  agent: string;
  rule_id: string;
  template: number;
  metadata_uri: string;
  is_public: boolean;
  author: string;
  author_badge: 'team' | 'community';
  name: string | null;
  description: string | null;
  params_hash: string | null;
  created_at: string;
  indexed_at: string;
};

export type PriceObservationRow = {
  chain_id: number;
  pair: string;
  block_number: number;
  price: string;
  observed_at: string;
};

export type SponsorLedgerRow = {
  chain_id: number;
  tx_hash: string;
  log_index: number;
  target: string;
  amount: string;
  asset: string;
  block_time: string;
  indexed_at: string;
};

export type StarterFundsRow = {
  owner: string;
  claimed_at: string;
  usdc_tx: string | null;
  weth_tx: string | null;
  amount_usdc: string;
  amount_weth: string;
  chain_id: number;
  indexed_at: string;
};

export type DeadLetterRow = {
  id: string;
  chain_id: number;
  block_number: number;
  tx_hash: string;
  log_index: number;
  reason: string;
  payload: string;
  recorded_at: string;
};

function now(): string {
  return new Date().toISOString();
}

function withIndexedAt<T extends Row>(row: T): T & { indexed_at: string } {
  return { ...row, indexed_at: now() };
}

/** All read-model writes go through these typed, idempotent methods. */
export function createRepositories(store: Store) {
  return {
    agents: {
      async upsert(row: Omit<AgentRow, 'indexed_at'>): Promise<void> {
        await store.upsert('agents', [withIndexedAt(row)], 'address');
      },
      async get(address: string): Promise<AgentRow | null> {
        return (await store.selectOne('agents', { address })) as AgentRow | null;
      },
      async listByOwner(owner: string): Promise<AgentRow[]> {
        return (await store.select('agents', { owner })) as AgentRow[];
      },
      async incrementRuleCount(address: string): Promise<void> {
        const existing = await this.get(address);
        if (!existing) return;
        await store.upsert(
          'agents',
          [withIndexedAt({ ...existing, rule_count: existing.rule_count + 1 })],
          'address',
        );
      },
    },
    vaults: {
      async upsert(row: Omit<VaultRow, 'indexed_at'>): Promise<void> {
        await store.upsert('vaults', [withIndexedAt(row)], 'address');
      },
      async listByOwner(owner: string): Promise<VaultRow[]> {
        return (await store.select('vaults', { owner })) as VaultRow[];
      },
      async get(address: string): Promise<VaultRow | null> {
        return (await store.selectOne('vaults', { address })) as VaultRow | null;
      },
    },
    rules: {
      async upsert(row: Omit<RuleRow, 'indexed_at'>): Promise<void> {
        await store.upsert('rules', [withIndexedAt(row)], 'agent,rule_id');
      },
      async get(agent: string, ruleId: string): Promise<RuleRow | null> {
        return (await store.selectOne('rules', { agent, rule_id: ruleId })) as RuleRow | null;
      },
      async list(agent: string, status?: string): Promise<RuleRow[]> {
        const filters: Record<string, StoreValue> = { agent };
        if (status && status !== 'all') filters.status = status;
        return (await store.select('rules', filters, {
          orderBy: { column: 'rule_id', ascending: true },
        })) as RuleRow[];
      },
      /** Every rule, used by the leaderboard and the marketplace join. */
      async listAll(): Promise<RuleRow[]> {
        return (await store.select('rules')) as RuleRow[];
      },
      async setPublic(agent: string, ruleId: string, isPublic: boolean): Promise<void> {
        const existing = await this.get(agent, ruleId);
        if (!existing) return;
        await store.upsert(
          'rules',
          [withIndexedAt({ ...existing, is_public: isPublic })],
          'agent,rule_id',
        );
      },
      async updateStatus(
        agent: string,
        ruleId: string,
        status: RuleRow['status'],
        latched?: boolean,
      ): Promise<void> {
        const existing = await this.get(agent, ruleId);
        if (!existing) return;
        await store.upsert(
          'rules',
          [
            withIndexedAt({
              ...existing,
              status,
              latched: latched === undefined ? existing.latched : latched,
            }),
          ],
          'agent,rule_id',
        );
      },
      async recordRun(agent: string, ruleId: string, blockTime: string): Promise<void> {
        const existing = await this.get(agent, ruleId);
        if (!existing) return;
        await store.upsert(
          'rules',
          [
            withIndexedAt({
              ...existing,
              runs: existing.runs + 1,
              last_run_at: blockTime,
            }),
          ],
          'agent,rule_id',
        );
      },
    },
    ruleEvents: {
      async upsert(row: Omit<RuleEventRow, 'indexed_at'>): Promise<void> {
        await store.upsert('rule_events', [withIndexedAt(row)], 'chain_id,tx_hash,log_index');
      },
      /** The evaluation rows for one reactive tx, used by the cached proof fallback. */
      async listByTx(txHash: string): Promise<RuleEventRow[]> {
        return (await store.select(
          'rule_events',
          { tx_hash: txHash },
          { orderBy: { column: 'log_index', ascending: true } },
        )) as RuleEventRow[];
      },
      /** Alert activity rows: what fired, never an execution (US5). */
      async listAlerts(agent: string, ruleId?: string, limit = 10): Promise<RuleEventRow[]> {
        const filters: Record<string, StoreValue> = { agent, kind: 'alert' };
        if (ruleId) filters.rule_id = ruleId;
        return (await store.select('rule_events', filters, {
          limit,
          orderBy: { column: 'block_time', ascending: false },
        })) as RuleEventRow[];
      },
    },
    executions: {
      async upsert(row: Omit<ExecutionRow, 'indexed_at'>): Promise<void> {
        await store.upsert('executions', [withIndexedAt(row)], 'chain_id,tx_hash,log_index');
      },
      async list(
        filters: Readonly<Record<string, StoreValue>>,
        limit = 25,
      ): Promise<ExecutionRow[]> {
        return (await store.select('executions', filters, {
          limit,
          orderBy: { column: 'block_time', ascending: false },
        })) as ExecutionRow[];
      },
      async countForRule(agent: string, ruleId: string): Promise<number> {
        return store.count('executions', { agent, rule_id: ruleId });
      },
      /** Every execution, used to derive marketplace and leaderboard statistics (FR-040). */
      async listAll(): Promise<ExecutionRow[]> {
        return (await store.select('executions')) as ExecutionRow[];
      },
      async deleteByTx(chainId: number, txHash: string): Promise<void> {
        await store.deleteWhere('executions', { chain_id: chainId, tx_hash: txHash });
      },
    },
    callbacks: {
      async upsert(rows: readonly CallbackRow[]): Promise<void> {
        await store.upsert('callbacks', [...rows], 'reactive_tx_hash,callback_index');
      },
      async listForTx(reactiveTxHash: string): Promise<CallbackRow[]> {
        return (await store.select(
          'callbacks',
          { reactive_tx_hash: reactiveTxHash },
          { orderBy: { column: 'callback_index', ascending: true } },
        )) as CallbackRow[];
      },
      /** Finds the reactive hash that produced a destination tx, for execution → proof links. */
      async findByDestinationTx(destinationTxHash: string): Promise<CallbackRow | null> {
        return (await store.selectOne('callbacks', {
          destination_tx_hash: destinationTxHash,
        })) as CallbackRow | null;
      },
    },
    mirrors: {
      async upsert(row: Omit<MirrorRow, 'indexed_at'>): Promise<void> {
        await store.upsert('mirrors', [withIndexedAt(row)], 'follower_agent,rule_id');
      },
    },
    listings: {
      async upsert(row: Omit<ListingRow, 'indexed_at'>): Promise<void> {
        await store.upsert('listings', [withIndexedAt(row)], 'chain_id,agent,rule_id');
      },
      async get(chainId: number, agent: string, ruleId: string): Promise<ListingRow | null> {
        return (await store.selectOne('listings', {
          chain_id: chainId,
          agent,
          rule_id: ruleId,
        })) as ListingRow | null;
      },
      async list(limit = 25): Promise<ListingRow[]> {
        return (await store.select(
          'listings',
          { is_public: true },
          {
            limit,
            orderBy: { column: 'created_at', ascending: false },
          },
        )) as ListingRow[];
      },
      /** All live listings; the route filters, sorts, and pages in memory. */
      async listPublic(): Promise<ListingRow[]> {
        return (await store.select('listings', { is_public: true })) as ListingRow[];
      },
      async setPublic(
        chainId: number,
        agent: string,
        ruleId: string,
        isPublic: boolean,
      ): Promise<void> {
        const existing = await this.get(chainId, agent, ruleId);
        if (!existing) return;
        await store.upsert(
          'listings',
          [withIndexedAt({ ...existing, is_public: isPublic })],
          'chain_id,agent,rule_id',
        );
      },
    },
    priceObservations: {
      async upsert(row: PriceObservationRow): Promise<void> {
        await store.upsert('price_observations', [row], 'chain_id,pair,block_number');
      },
      async latest(pair: string): Promise<PriceObservationRow | null> {
        return (await store.selectOne('price_observations', {
          pair,
        })) as PriceObservationRow | null;
      },
    },
    sponsorLedger: {
      async upsert(row: Omit<SponsorLedgerRow, 'indexed_at'>): Promise<void> {
        await store.upsert('sponsor_ledger', [withIndexedAt(row)], 'chain_id,tx_hash,log_index');
      },
    },
    starterFunds: {
      async get(owner: string): Promise<StarterFundsRow | null> {
        return (await store.selectOne('starter_funds', { owner })) as StarterFundsRow | null;
      },
      /** Claims the once-per-address slot before any transfer is signed. */
      async claim(owner: string, chainId: number): Promise<boolean> {
        return store.insert(
          'starter_funds',
          withIndexedAt({
            owner,
            claimed_at: now(),
            usdc_tx: null,
            weth_tx: null,
            amount_usdc: '0',
            amount_weth: '0',
            chain_id: chainId,
          }),
          'owner',
        );
      },
      async complete(
        owner: string,
        row: Pick<StarterFundsRow, 'usdc_tx' | 'weth_tx' | 'amount_usdc' | 'amount_weth'>,
      ): Promise<void> {
        const existing = await this.get(owner);
        if (!existing) return;
        await store.upsert('starter_funds', [withIndexedAt({ ...existing, ...row })], 'owner');
      },
      /** Releases a claim after a failed transfer so the user can retry. */
      async release(owner: string): Promise<void> {
        await store.deleteWhere('starter_funds', { owner });
      },
    },
    deadLetter: {
      async record(row: DeadLetterRow): Promise<void> {
        await store.upsert('dead_letter', [row], 'id');
      },
      async count(): Promise<number> {
        return store.count('dead_letter');
      },
    },
  };
}

export type Repositories = ReturnType<typeof createRepositories>;
