# Quickstart Validation: Rulebook

**Feature**: `001-reactive-rule-builder` | **Date**: 2026-11-16

Runnable scenarios that prove the feature works end to end. Each maps to success criteria in [spec.md](./spec.md) and to contracts in [contracts/](./contracts/). This is a validation guide, not an implementation guide.

---

## Prerequisites

| Tool | Version | Why |
|---|---|---|
| Foundry (`forge`, `cast`, `anvil`) | stable | contracts, tests, local chain, on-chain reads |
| Node.js | 24 LTS (22 LTS acceptable) | backend + tooling; matches Heroku support |
| npm | 10+ | npm workspaces |
| Supabase CLI | current | local Postgres + migrations |
| Heroku CLI | current | backend deploys, config vars, logs |
| Vercel CLI | current | frontend previews |
| Wallets | 2 EOAs with test ETH | one leader, one follower |

| External prerequisite | Where it comes from | Note |
|---|---|---|
| Lasna REACT credit | lREACT faucet via Base Sepolia or Ethereum Sepolia ETH | 1 ETH → 100 lREACT; faucet does not accept Unichain ETH |
| Unichain Sepolia ETH | Superchain / QuickNode / thirdweb faucets | some faucets require mainnet history |
| USDC on Unichain Sepolia | Circle faucet | same token as the WETH/USDC pair |

```bash
# one-time
npm ci
npm run generate -w packages/shared      # manifest + ABI → codegen
forge --version && node --version
```

Expected: codegen writes Solidity constants, TS types, and the catalog table with no diff on a second run (idempotent).

---

## V0 — Day-1 spikes (blocking; run before any UI work)

These come from `IDEA.md` §15 and gate the rest of the plan. Do not proceed past a red spike.

```bash
# 0.1 router works: 1 USDC → WETH through Router02 on Unichain Sepolia
cast send $ROUTER "swapExactTokensForTokens(uint256,uint256,address[],address,uint256)" \
  1000000 900000000000000000 "[$USDC,$WETH]" $ME $DEADLINE --rpc-url $UNICHAIN_RPC
```

| Spike | Pass condition | Measured by |
|---|---|---|
| 0.1 Router swap | a swap tx confirms and the pair's reserves move | `cast call` pair `getReserves` before/after |
| 0.2 lREACT spendable by an EOA | the EOA sends a Lasna tx that confirms | `cast send` to the agent with a nonzero status |
| 0.3 Proof path | `getCallbacks` returns a record with a destination hash | `cast call $SYSTEM "getCallbacks(uint256)((uint256,address,uint256,uint256,uint256,bytes)[])" $REACTIVE_TX --rpc-url $LASNA_RPC` |
| 0.4 Cost model | `_extraGas`, `_gasPriceCoeffPer1000`, `_maxChargeGas` read successfully on both proxies | the five `cast call`s in `IDEA.md` §12 |
| 0.5 Lasna chain id | the RPC reports **5318007** | `cast chain-id --rpc-url $LASNA_RPC` |

**If 0.1–0.3 pass**, the plan stands. **If 0.2 fails**, switch rule-creation funding to the signed-intent relay before writing the onboarding flow. **If 0.3 fails**, the proof page falls back to locating destination txs by `ruleId`, and the README must say so.

---

## V1 — Hermetic gate (CI, no network)

```bash
forge fmt --check
forge build
forge test
forge coverage --report summary
npm run typecheck
npm run lint
npm run test -w frontend
npm run test -w backend
npm run build -w frontend && npm run build -w backend
```

| Check | Expected | Criterion |
|---|---|---|
| `forge test` | all pass, 0 skipped | Constitution II |
| coverage | ≥90% branch on `Agent`, `Vault`, `*Factory`, `Registry` | Constitution II |
| template matrix | 13 × {happy, condition-no-longer-holds, must-not-fire-twice} present and green | FR-024, FR-022 |
| callback auth | wrong proxy sender reverts `NotServiceProvider`; wrong first argument reverts `CallbackSenderMismatch` | FR-026 |
| frontend tests | composer calldata equals fixtures for all 13 templates | FR-012, SC-002 |
| backend tests | replaying the same log fixture twice yields one row | FR-045 |
| builds | both succeed, typecheck zero errors, lint zero warnings | quality gates |

```bash
# local chain for the e2e smoke path (no testnets, no funds)
anvil &
npm run migrate -w backend -- --local
npm run dev -w backend      # indexer disabled, fixture mode
npm run dev -w frontend
npx playwright test         # compose DCA → assert calldata → render proof fixture
```

Expected: the composer produces the same `addRule` calldata as the fixture, and the proof page renders three rows from the fixture with a latency figure.

---

## V2 — Account creation and custody (US1, FR-001–FR-008, SC-006)

1. Connect a fresh wallet.
2. Click "Create my account". Both deployments are submitted; the app funds execution costs.
3. Confirm the account view shows an Agent (Lasna) and a Vault (Unichain Sepolia), each labelled with its network, both owned by the connected wallet.
4. Deposit a small amount of test USDC into the Vault.
5. Withdraw the full principal to the wallet.

| Pass condition | Criterion |
|---|---|
| both contracts exist and `owner()` returns the connected wallet | FR-002 |
| the Vault's `agent()` equals the Agent address | FR-003 |
| no operator key is used for steps 4–5 | FR-007, SC-006 |
| the full principal returns; three balances are shown separately | FR-008 |

**Resumability (US1 scenario 2)**: interrupt step 2 after the Agent deploy (reject the second signature), reload, and click "Create my account" again. Expected: `setup_state: agent_only` → retry creates only the Vault, links it, and ends `complete` — no duplicate Agent.

---

## V3 — Compose and launch a rule (US2, FR-009–FR-017, SC-001, SC-002, SC-003)

1. Open Create. Pick template 1 (DCA).
2. Drag chips: `Every` → `Friday`, amount `10`, token `USDC`, target `ETH`.
3. Watch the calldata panel update after each drag.
4. Copy the calldata and compare with `POST /v1/encode/preview` for the same draft.
5. Sign once.

| Pass condition | Criterion |
|---|---|
| sentence reads exactly the chosen values | FR-010 |
| calldata changes on every chip change and matches the preview endpoint byte for byte | FR-011, FR-012 |
| no free-text or code field is present anywhere in the flow | FR-009 |
| the rule appears as active with `runs: 0` and a budget figure | FR-035 |
| time from landing to active rule ≤ 3 minutes, ≤ 4 clicks beyond signing | SC-001 |

**Incomplete draft**: remove the amount and press Create. Expected: blocked, the amount slot is highlighted, and `missing_slots` names it (FR-017).

---

## V4 — Proof of the loop (US3, FR-033–FR-034, SC-004, SC-005, SC-010)

1. Let a rule fire (use a seeded thin pair for a price rule, or wait for a cron window).
2. Open the proof view from the rule's execution list.
3. Follow all three links.
4. Record the latency figure.
5. Stop the backend (`heroku ps:scale web=0`), then reload the proof view.

| Pass condition | Criterion |
|---|---|
| three rows present: origin, automation, destination | FR-033 |
| row 3's hash is the transaction that moved funds on the destination explorer | FR-031 |
| latency ≤ 10s at p50 across 10 executions | SC-010 |
| with the backend down, the proof still renders (or is rebuilt after restart from chain data) | FR-034, SC-005 |
| a refused execution shows its selector and a plain-language reason, not "success" | FR-051 |

---

## V5 — Pause, cancel, reorder, limits (US4, FR-013–FR-015, SC-014)

1. Pause the rule before its next window; confirm the status pill changes within 5s.
2. Confirm no execution occurs during the paused window (`GET /v1/executions` unchanged).
3. Resume, then create rules until the 5-rule limit is hit.
4. Reorder two active rules and reload the page.

| Pass condition | Criterion |
|---|---|
| paused rule does not execute | FR-013, SC-014 |
| 6th rule is refused with a message naming the limit and how to free a slot | FR-015 |
| order persists after reload and matches `getRuleIds()` on-chain | FR-014 |
| a paused-last-rule account releases its topic (no further credit spend on that topic) | FR-029 |

---

## V6 — Budget visibility and silent-stop prevention (FR-030, FR-032, SC-015)

1. Read `reserves`/`debt` for the Agent (Lasna) and Vault (Unichain) — the numbers shown in the UI must match `cast call`.
2. Top up only the Agent via `depositTo`.
3. Drive the budget below the warning level.

| Pass condition | Criterion |
|---|---|
| UI flags `low` before the account stops, with a top-up action | FR-032, SC-015 |
| a third party can top up an account without owner keys | FR-006 |
| `debt` state is displayed as stopped, never as "active" | FR-030 |

---

## V7 — Template catalog sweep (US5, FR-018–FR-024, SC-018)

For each of the 13 templates: build it, create it, confirm the catalog row and the readable sentence, and (for 11–13) confirm that firing produces zero funds movement.

| Pass condition | Criterion |
|---|---|
| all 13 buildable and listed | FR-018 |
| price templates label the value "last traded price" with an observation time | FR-020 |
| scheduled templates say "sometime on <day>" | FR-021 |
| alert rules produce an activity record and no `Executed` | FR-023, SC-018 |
| every rule in the sweep has its three mandatory contract tests | FR-024 |

---

## V8 — Clone (US6, FR-038–FR-042, SC-012, SC-013)

1. Mark one of your rules public.
2. From a second wallet, open the marketplace and clone it.
3. Confirm the clone uses the second wallet's Vault and limits.

| Pass condition | Criterion |
|---|---|
| marketplace shows ≥3 listings, each badged `team` where applicable | FR-041, SC-013 |
| clone is active in the second account within 30s | SC-012 |
| the original author's Vault receives nothing from the clone's runs | FR-039 |
| listing stats match `executions` counts | FR-040 |

---

## V9 — Mirror, the two-hop loop (US8, FR-043–FR-048, SC-011)

1. From wallet B, attach a mirror to wallet A's limit-buy rule (scale 5000 bps = 50%, cap set).
2. Move the seeded thin pool so A's limit-buy fires.
3. Open A's proof view; confirm both funds-side transactions appear.

| Pass condition | Criterion |
|---|---|
| exactly two destination transactions from one leader execution | SC-011 |
| follower spend = min(perRunCap, leaderAmount × scaleBps / 10000) | FR-044 |
| replaying the same leader event produces no third transaction | FR-045 |
| follower's Vault emitted `Mirrored`, never `Executed` | FR-046 |
| a third user cannot mirror the follower's mirrored action | FR-046 |
| a bad follower fill skips (reverts) rather than filling, and the skip is visible | FR-047 |

---

## V10 — Deployment smoke (Vercel + Heroku + Supabase)

```bash
# backend
heroku config:set INDEXER_ENABLED=true LASNA_RPC_URL=... UNICHAIN_RPC_URL=... \
  SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=...
git push heroku main
curl -s https://<app>.herokuapp.com/health | jq '.indexer.lag_seconds, .database.reachable'

# frontend
vercel --prod
# deep link check (SPA rewrite)
curl -sI https://<app>.vercel.app/proof/0x0000... | head -1
```

| Pass condition | Criterion |
|---|---|
| `/health` reports indexer lag < 15s and database reachable | R6 |
| the Heroku dyno is Basic (always-on), not Eco (sleeps) | R2 |
| a deep link to `/proof/:hash` returns 200 and renders | R1 |
| the Vercel bundle contains no service-role key or private key | Constitution V |
| after 24h idle, the Supabase project is still active | R13 |

---

## Rollback / recovery drills

| Drill | Command | Expected |
|---|---|---|
| Reindex from chain | `npm run reindex -w backend` | derived tables rebuilt; `verify:reconcile` reports zero mismatches |
| Reconcile | `npm run verify:reconcile -w backend` | per-rule `runs` equals `count(executions)` |
| Paused Supabase | resume in dashboard | `/health` returns to `ok` without redeploying |
| Stopped sponsor | `depositTo(agent)` by any wallet | runs resume at the next window; principal untouched |
