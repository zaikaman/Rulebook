# Phase 1 Data Model: Rulebook

**Feature**: `001-reactive-rule-builder` | **Date**: 2026-11-16

Two stores, one authority. On-chain state (contracts) is authoritative for rules, principal, and execution outcomes. The Supabase read model is **derived** — fully rebuildable by replaying logs — and exists to make lists, aggregates, and the marketplace queryable.

Canonical schema source: `IDEA.md` §23. This document transcribes it without drift, adds the packed-slot plan the contract needs, and defines the read model.

---

## 1. On-chain entities

### 1.1 `Rule`

```solidity
struct Rule {
    uint8   template;    // 1..13, validated against TemplateCatalog
    uint16  chainId;     // destination chain; 1301 in v1
    address pair;        // Uniswap V2 pair, or address(0) for non-price templates
    address tokenIn;
    address tokenOut;    // address(0) for alert templates
    uint256 amountIn;    // per-run spend, in tokenIn base units
    uint256 threshold;   // price (1e18-scaled) or amount, per template
    uint256 secondary;   // band width % / trailing % / expiry / inactivity days
    uint64  lastRun;
    uint32  runs;
    uint8   flags;       // bit0 active, bit1 latched/done, bit2 mirrored
}
```

**Slot layout** (8 slots max, per Constitution III gas budget):

| Slot | Contents |
|---|---|
| 0 | `template` (uint8) + `chainId` (uint16) + `flags` (uint8) packed |
| 1 | `pair` |
| 2 | `tokenIn` |
| 3 | `tokenOut` |
| 4 | `amountIn` |
| 5 | `threshold` |
| 6 | `secondary` |
| 7 | `lastRun` (uint64) + `runs` (uint32) packed |

**Validation rules**

| Rule | Source | Enforcement |
|---|---|---|
| `template ∈ 1..13` and known to the catalog | FR-009, FR-018 | `addRule` reverts `UnknownTemplate` |
| `chainId` is a configured destination | FR-050 | `addRule` reverts `UnsupportedChain` |
| `amountIn > 0` for money templates; `== 0` for alert templates | FR-023, FR-027 | `InvalidAmount` |
| `amountIn ≤ per-run cap` and `amountIn ≤ vault balance headroom` | FR-027 | `ExceedsPerRunCap` |
| `threshold > 0` for threshold templates | FR-017 | `InvalidThreshold` |
| `pair != 0` for price templates; `tokenOut != 0` for swap templates | FR-018 | `InvalidTemplateParams` |
| `secondary` interpreted per template (expiry > now, trailing ≤ 10000 bps, inactivity 1..365 days) | FR-027 | `InvalidSecondary` |
| ≤ 5 active rules per Agent | FR-015 | `RuleLimitReached` |
| Only owner may add/pause/cancel/reorder | FR-016 | `Ownable` revert |

**State transitions**

```text
            addRule (owner, Lasna)
                  │
                  ▼
   ┌──────────► ACTIVE ◄──────────┐
   │              │               │
   │         pauseRule        resumeRule
   │              ▼               │
   │           PAUSED ────────────┘
   │              │
   │         cancelRule (owner)  or  expiry reached during react()
   │              ▼
   │          CANCELLED
   │
   └── fire (not cron-gated): ACTIVE → ACTIVE + latched (flags.bit1)
```

| From | Event | To | Side effects |
|---|---|---|---|
| — | `addRule` | ACTIVE | `RuleCreated`; subscribe to newly needed topic; budget counter increments |
| ACTIVE | `pauseRule` | PAUSED | `RulePaused(true)`; if last rule needing a topic, `unsubscribe` |
| PAUSED | `resumeRule` | ACTIVE | `RulePaused(false)`; re-subscribe if needed |
| ACTIVE/PAUSED | `cancelRule` | CANCELLED | `RulePaused` with `cancelled` semantics + `RuleCancelled`; release topic refs |
| ACTIVE | `react()` fires non-cron rule | ACTIVE (latched) | `lastRun`, `runs++`; requires owner `resetRule` (or cooldown expiry) to re-arm |
| ACTIVE | cooldown elapsed | ACTIVE (unlatched) | implicit on read |

### 1.2 `Agent` (Lasna, one per user)

| Field | Type | Purpose |
|---|---|---|
| `owner` | `address` | user; only address that may mutate rules |
| `factory` | `address` | provenance |
| `vaults` | `mapping(uint256 chainId => address)` | destination vault per chain |
| `rules` | `mapping(uint256 => Rule)` | rule storage |
| `order` | `uint256[]` | evaluation order (FR-014) |
| `nextRuleId` | `uint256` | monotonic |
| `cachedPrice` | `mapping(address pair => uint256)` | last traded price from `Sync` |
| `cachedPriceAt` | `mapping(address pair => uint64)` | observation time — surfaced in UI (FR-020) |
| `highWater` | `mapping(uint256 ruleId => uint256)` | trailing stop / grid reference |
| `lastActivity` | `uint64` | dead-man switch |
| `topicRefCount` | `mapping(bytes32 topicKey => uint256)` | subscription refcount (R5) |
| `activeRules` | `uint256` | limit enforcement |

**Validation**: `react()` must ignore any log whose sender is not the system contract (`onlySystem`); must never exceed 900k gas — enforced by iterating `order` and stopping when the gas budget per wake-up is exhausted, recording the remaining rules as "deferred" for the activity feed.

### 1.3 `Vault` (Unichain Sepolia, one per `(user, chainId)`)

| Field | Type | Purpose |
|---|---|---|
| `owner` | `address` | user; may withdraw principal, change payout address |
| `agent` | `address` | the only contract allowed to trigger execution |
| `router` | `address` | Uniswap V2 Router02 for that chain |
| `callbackProxy` | `address` | from `AbstractCallback` constructor |
| `allowedTokenIn` / `allowedTokenOut` | `address` | FR-027 pair allowlist |
| `maxSpendPerRun` | `uint256` | FR-027 ceiling |
| `paused` | `bool` | emergency stop by owner |
| `mirrorMode` | `bool` | if true, emits `Mirrored`, never `Executed` |

**Invariants**: principal is only ever moved by (a) `withdraw` from owner, (b) an execution whose caller is `agent` and whose parameters pass every check. `Balances` is emitted after every balance change.

### 1.4 `MirrorLink` (on the follower's Agent)

| Field | Type | Purpose |
|---|---|---|
| `leaderChainId` | `uint256` | 1301 |
| `leaderVault` | `address` | source of `Executed` |
| `leaderRuleId` | `uint256` | which rule to copy |
| `scaleBps` | `uint16` | ≤ 10 000, capped per rule |
| `perRunCap` | `uint256` | ceiling for the follower |
| `hourlyCap` | `uint8` | burst control (FR-048) |
| `consumed` | `mapping(bytes32 key => bool)` | dedupe on `keccak256(leaderVault, ruleId, leaderTxHash)` |

**Constraint**: `leaderVault` must be a leader vault and the follower's own vault must be `mirrorMode = true`, which is what makes copy-of-copy structurally impossible (FR-046).

### 1.5 `RuleRegistry` entry (Unichain Sepolia)

| Field | Type | Purpose |
|---|---|---|
| `author` | `address` | agent owner |
| `agent` | `address` | agent on Lasna |
| `template` | `uint8` | catalog id |
| `paramsHash` | `bytes32` | hash of the encoded rule params |
| `paramsURI` | `string` | metadata pointer for description/labels |
| `isPublic` | `bool` | listing flag |
| `createdAt` | `uint64` | ordering |

No funds, no execution capability. Writes come from the user's own transaction or an Agent callback contract; the indexer is read-only (FR-052).

### 1.6 Events (API contract, per `IDEA.md` §23)

```solidity
event RuleCreated(address indexed agent, uint256 indexed ruleId, uint8 template, bool publicRule);
event RulePaused(address indexed agent, uint256 indexed ruleId, bool paused);
event RuleCancelled(address indexed agent, uint256 indexed ruleId);
event Executed(uint256 indexed ruleId, address tokenIn, address tokenOut,
               uint256 amountIn, uint256 amountOut, uint256 timestamp);
event Mirrored(uint256 indexed ruleId, address indexed leader, bytes32 leaderTx);
event Balances(address token0, uint256 balance0, address token1, uint256 balance1);
```

`Executed` is emitted **only** by leader vaults; `Mirrored` **only** by mirror vaults. Event changes are additive only.

---

## 2. Read model (Supabase / Postgres)

All tables are derived. Every table carries `chain_id` and an `indexed_at` timestamp. Deletion is never hard except during reorg repair.

### 2.1 `agents`

| Column | Type | Notes |
|---|---|---|
| `address` | `text` PK | lowercase hex |
| `owner` | `text` NOT NULL | indexed |
| `factory` | `text` NOT NULL | |
| `created_tx` | `text` NOT NULL | |
| `created_block` | `bigint` NOT NULL | |
| `rule_count` | `int` NOT NULL DEFAULT 0 | maintained on `RuleCreated` |

### 2.2 `vaults`

| Column | Type | Notes |
|---|---|---|
| `address` | `text` PK | |
| `owner` | `text` NOT NULL | |
| `agent` | `text` NOT NULL | |
| `chain_id` | `int` NOT NULL | 1301 |
| `mirror_mode` | `boolean` NOT NULL | |
| `allowed_token_in` / `allowed_token_out` | `text` | |
| `max_spend_per_run` | `numeric(78,0)` | uint256 as numeric |
| `paused` | `boolean` NOT NULL | |

### 2.3 `rules`

| Column | Type | Notes |
|---|---|---|
| `agent` | `text` NOT NULL | FK → `agents.address` |
| `rule_id` | `numeric(78,0)` NOT NULL | on-chain id |
| `template` | `smallint` NOT NULL | 1..13 |
| `chain_id` | `int` NOT NULL | |
| `status` | `text` NOT NULL | `active` / `paused` / `cancelled` — CHECK constraint |
| `latched` | `boolean` NOT NULL | |
| `pair`, `token_in`, `token_out` | `text` | |
| `amount_in`, `threshold`, `secondary` | `numeric(78,0)` | |
| `last_run_at` | `timestamptz` | |
| `runs` | `int` NOT NULL DEFAULT 0 | |
| `is_public` | `boolean` NOT NULL DEFAULT false | |
| PRIMARY KEY | (`agent`, `rule_id`) | |

Indexes: `(template)`, `(status)`, `(is_public)`, partial `(agent) WHERE status = 'active'`.

### 2.4 `executions`

| Column | Type | Notes |
|---|---|---|
| `chain_id` | `int` NOT NULL | |
| `tx_hash` | `text` NOT NULL | |
| `log_index` | `int` NOT NULL | |
| `vault` | `text` NOT NULL | |
| `agent` | `text` NOT NULL | |
| `owner` | `text` NOT NULL | denormalized for "my runs" |
| `rule_id` | `numeric(78,0)` NOT NULL | |
| `kind` | `text` NOT NULL | `executed` / `mirrored` |
| `token_in`, `token_out` | `text` | |
| `amount_in`, `amount_out` | `numeric(78,0)` | |
| `block_number` | `bigint` NOT NULL | |
| `block_time` | `timestamptz` NOT NULL | |
| `leader_tx` | `text` | nullable, mirrors only |
| PRIMARY KEY | (`chain_id`, `tx_hash`, `log_index`) | idempotent upsert key |

Indexes: `(agent, block_time DESC)`, `(rule_id)`, `(owner, block_time DESC)`.

### 2.5 `callbacks`

| Column | Type | Notes |
|---|---|---|
| `reactive_tx_hash` | `text` NOT NULL | |
| `callback_index` | `int` NOT NULL | |
| `reactive_contract` | `text` NOT NULL | agent address |
| `destination_chain_id` | `numeric(78,0)` NOT NULL | |
| `destination_tx_hash` | `text` | null until delivered |
| `error_data` | `text` | empty string on success |
| `block_number` | `bigint` NOT NULL | Lasna block |
| `recorded_at` | `timestamptz` NOT NULL DEFAULT now() | |
| PRIMARY KEY | (`reactive_tx_hash`, `callback_index`) | |

This table is a **cache of `getCallbacks`**, not a substitute. `GET /v1/proofs/:hash` reads the chain first (R7). Rows are inserted when the proof endpoint runs, so the table is naturally populated by proof views as well as by the indexer.

### 2.6 Supporting tables

| Table | Purpose | Key columns |
|---|---|---|
| `rule_events` | activity feed of created/paused/cancelled | `(chain_id, tx_hash, log_index)`, `agent`, `rule_id`, `kind`, `block_time` |
| `mirrors` | follower → leader links | `(follower_agent, rule_id)`, `leader_agent`, `leader_rule_id`, `scale_bps`, `hourly_cap` |
| `listings` | public catalog entries + metadata | `(chain_id, listing_id)`, `agent`, `rule_id`, `template`, `metadata_uri`, `is_public` |
| `indexer_cursors` | per-chain last fully processed block | `chain_id` PK, `last_block`, `last_block_hash`, `updated_at` |
| `sponsor_ledger` | observed top-ups (from `depositTo` logs) | `(chain_id, tx_hash, log_index)`, `target`, `amount`, `asset`, `block_time` |
| `price_observations` | optional: `Sync`-derived price history for the UI | `(chain_id, pair, block_number)`, `price`, `observed_at` |

### 2.7 Derived views

| View | Definition intent |
|---|---|
| `rule_stats` | `runs`, `success_rate`, `avg_amount_in` per `(agent, rule_id)` from `executions` — powers FR-040 and the leaderboard (FR-042) |
| `marketplace_feed` | `listings` ⋈ `rules` ⋈ `rule_stats` where `is_public` |

### 2.8 Retention and rebuild

- Retention: `price_observations` may be pruned to 30 days; everything else is kept for the buildathon.
- Rebuild: `npm run reindex -w backend` truncates all derived tables except `listings` metadata, resets `indexer_cursors` to the configured start blocks, and replays. Expected: minutes, not hours, at demo volume.
- Integrity check: `npm run verify:reconcile -w backend` compares per-rule `runs` from `rules` against `count(*)` in `executions` and reports mismatches. A mismatch is a bug, never patched by hand.

---

## 3. Cross-layer type mapping

| Concept | Solidity | Generated TS | DB column |
|---|---|---|---|
| Rule id | `uint256` | `bigint` | `numeric(78,0)` |
| Token amount | `uint256` | `bigint` | `numeric(78,0)` |
| Price | `uint256` (1e18) | `bigint` | `numeric(78,0)` |
| Timestamp | `uint64` | `number` (unix s) | `timestamptz` |
| Flags | `uint8` bitfield | discriminated booleans (`isActive`, `isLatched`, `isMirrored`) | separate boolean columns |
| Address | `address` | `0x${string}` | `text` lowercase |
| Template | `uint8` | `TemplateId` union (1..13) | `smallint` with CHECK |

**Rule**: uint256 never crosses a boundary as `number`. The zod schemas in `packages/shared/src/schemas.ts` parse string/numeric into `bigint` (and reject anything above `2^256-1`), and the API serializes `bigint` as decimal strings in JSON.
