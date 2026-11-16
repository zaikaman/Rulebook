# IDEA.md — Rulebook

> **Working title:** Rulebook
> **Track:** Set It and Forget It — Reactive Omni Buildathon
> **Deadline:** December 5, 2026 (19 days from this doc)
> **Status:** Design locked, build not started
> **Author's note:** this file is the single source of truth. If a decision changes, change it here first.

---

## 1. One-liner

**Rulebook is a no-code builder for personal on-chain automations.** A user picks a trigger, a condition, and an action from a short menu — *every Friday → buy 10 USDC of ETH* — and a reactive contract executes it forever, with no server, no bot, and no key held by us.

There is no text box and no prompt. The user operates a visual editor: they choose a template, then drag values into the slots. Everything on screen maps to a field in the contract call.

The rule lives on-chain. The money stays in the user's own contract. We pay the gas.

---

## 2. The problem

Every "automation" product today is a server with a private key:

- The server watches prices.
- The server decides.
- The server holds a key that can move your funds.
- If the server stops, your automation stops.

That is not "set it and forget it". That is "set it and hope the company stays online".

Reactive contracts invert this. The rule is a contract. The chain wakes it up. Nothing to host, nothing to keep alive, nothing to trust.

---

## 3. What we are building

A rule builder with three parts:

| Part | Where | Job |
|---|---|---|
| **Agent** | Reactive Network (Lasna) | Holds the rules, subscribes to events, decides, requests callbacks |
| **Vault** | Unichain Sepolia | Holds the user's funds, executes swaps and transfers, enforces limits |
| **Registry + indexer** | Unichain Sepolia + off-chain | Publishes public rules, powers the marketplace, makes events readable |

The UI is a **compiler and a viewer**. It turns the composer into a contract call, and turns events into a page. It never touches funds.

One wallet, two networks. The user signs the rule on Lasna and the money moves on Unichain Sepolia. The UI has to make that switch obvious, or people will think their funds vanished.

---

## 4. What we explicitly rejected

| Rejected | Why |
|---|---|
| A ClashX-style trading platform | ClashX's engine is an off-chain worker with delegated keys. Ported here, the reactive contract is decoration — Integration score collapses. |
| Liquidation insurance ("Second Wind") | Needs a real liquidation. Testnet prices don't move, so the core scene cannot be filmed. |
| A generic stop-loss bot | Same as the official Reactive Uniswap demo. No novelty. |
| A node-graph canvas builder | Every DeFi automation product has one, and every one of them needs an off-chain keeper to execute the graph. Our rules are one path, so a graph would be decoration. §14 |
| A wide platform (backtester, portfolios, AI copilot) | Earns nothing on this rubric and eats the timeline. |

**Design test we apply to every feature:** delete the reactive contract. If the product still works, the feature is bolted on and should be cut.

---

## 5. Who it is for

1. **The non-developer** who has never deployed a contract and wants their money to do something while they sleep.
2. **The small DeFi user** who wants a weekly buy, a stop-loss, or an alert without running a bot.
3. **The tinkerer** who wants to clone someone else's working rule instead of building one from scratch.

---

## 6. Core concepts

A **Rule** is five things:

```
Rule = Scope + Trigger + Condition + Action + Limits
```

- **Scope** — which chain, which token pair.
- **Trigger** — the event that wakes the agent (time, price, wallet activity, another user's execution).
- **Condition** — the check the agent runs on the event data (price threshold, price band, amount, balance, inactivity).
- **Action** — what happens: a swap or a transfer from the Vault, or an alert emitted on Lasna.
- **Limits** — max spend per run, execution budget, expiry, cooldown.

Rules are evaluated in `react()`, on-chain, with no off-chain logic.

---

## 7. Rule catalog

Thirteen templates built from **five trigger kinds × three actions × six conditions**. All of them share one engine.

### Trading — swap action

| # | Rule | Trigger | Condition |
|---|---|---|---|
| 1 | DCA | Cron | timestamp gate |
| 2 | Dip-boost DCA | Cron | price below last observed price by X% |
| 3 | Limit buy | Pool `Sync` | price < threshold, with expiry |
| 4 | Take profit | Pool `Sync` | price > threshold |
| 5 | Stop loss | Pool `Sync` | price < threshold, optional trailing % |
| 6 | Grid rebalance | Pool `Sync` | price moved X% from reference, then reset reference |

### Personal — transfer action

| # | Rule | Trigger | Condition |
|---|---|---|---|
| 7 | Recurring transfer | Cron | timestamp gate |
| 8 | Income sweep | Token `Transfer` | incoming amount > X |
| 9 | Balance floor | Vault `Balances` | balance < X, pull from an approved wallet |
| 10 | Dead-man switch | Cron | inactivity > N days |

### Alerts — emit only, no funds

| # | Rule | Trigger | Condition |
|---|---|---|---|
| 11 | Price alert | Pool `Sync` | threshold cross |
| 12 | LP range alert | Pool `Sync` | price outside `[low, high]` |
| 13 | Large transfer alert | Token `Transfer` | amount > X |

> Note on #12: this watches a **price range**, not a Uniswap V3 position. Reading a live V3 position is out of scope.

> Note on #2: no moving averages, RSI, or other indicators. The Agent caches **one** price per pair from the latest `Sync` and every condition compares against that. An indicator layer (ring buffer, warm-up, event-sampled not time-sampled) was considered and cut — it adds cost per event and means nothing on a thin testnet pool.

> Note on #6: "grid" here means a **price band**, not a portfolio ratio. A portfolio ratio needs the Vault's balances, which the Agent cannot see. The band needs one slot: after each fill, `reference = price`.

> Note on #9: the trigger had to change. A `Transfer` event carries an amount, not a balance, so the Agent can never compute "balance < X" from it. The Vault emits `Balances` after every change and the rule listens to that instead. The user must also approve the Vault once, because "pull from an approved wallet" is a `transferFrom`.

### Five rules that apply to every template

1. **Check twice.** The Agent decides on Lasna from a cached price. The Vault re-checks from live reserves before it moves money, and reverts if the condition no longer holds. Lasna decides cheaply; the Vault decides for real. See §9.
2. **Fire once.** Any rule that is not cron-gated must latch (`done = true`) or cool down after it fires. Otherwise a `Sync`-triggered rule buys again on every trade while the condition stays true.
3. **Say "last traded price".** Every price condition compares against the value cached from the most recent `Sync`. On a quiet pair that can be hours old. Do not call it the current price.
4. **Cron is approximate.** `Cron10000` is ~3h, so "every Friday" means "sometime on Friday". Fine for DCA. Use `Cron1000` only if a window must be tight, at roughly 8× the cost.
5. **Never trust the Agent's receipt.** A callback can revert after the Agent has already counted the run. Execution status always comes from the destination chain, never from Lasna.

---

## 8. Architecture

```
 Unichain Sepolia (origin)          Lasna (reactive)                Unichain Sepolia (destination)
 ─────────────────────────          ────────────────                ──────────────────────────────

 Uniswap pool ──Sync──┐
 User wallet ──Transfer──┤
 Cron (legacy system) ──┼──────▶  Agent (per user)  ──callback──▶  Vault (per user)
 Leader Vault ──Executed┘           react() logic                   swap / transfer
                                    rules[], cache                  limits, receipts
                                         │
                                         └──▶ Registry (public rules)
                                              Indexer ──▶ UI / Proof page
```

### Agent

- One per user, deployed by `AgentFactory` on Lasna, **owned by the user**.
- Storage: `rules[]`, cached prices, high-water marks, last-run timestamps, activity counters.
- Subscribes to the union of what its rules need. Subscriptions live in the node, not in contract storage, so the Agent tracks its own set and avoids duplicate `subscribe` calls.
- `react()` routes on `topic0`, evaluates, then calls `requestCallbackV_1_0`.
- `reorderRules(uint256[] ids)` — owner-only. Changes `rules[]` order, which is evaluation order inside `react()` and matters under the 900k gas cap. Backs the drag-to-reorder gesture in §14.
- `addRule` / `pauseRule` / `cancelRule` — owner-only, bounded by the abuse limits in §11.
- **Pause must unsubscribe.** When the last active rule needing a topic is paused or cancelled, the Agent calls `unsubscribe`. Otherwise it keeps paying for ticks it will never use.
- Funded with REACT reserves.

### Vault

- One per `(user, chainId)`, on Unichain Sepolia for v1, **owned by the user**.
- Holds principal. Executes swaps via the Uniswap router and transfers via ERC-20.
- Enforces: max spend per run, allowed token pair, `minOut`, expiry, only-agent caller.
- **Quotes at execution time.** `amountOutMin` is derived from the pool's *current* reserves minus a slippage tolerance, never from a price cached before the callback. Otherwise the trigger swap itself invalidates the quote and the callback reverts — and a revert is still charged.
- Emits `Executed(ruleId, tokenIn, tokenOut, amountIn, amountOut, timestamp)`.
- Emits `Balances(...)` after every balance change. The Agent cannot read the Vault, so this event is the only way rule #9 sees the holdings.
- Mirror vaults emit `Mirrored(...)` instead of `Executed(...)`. Different event = structural depth cap.
- Anyone can top up its callback reserves. Only the owner can withdraw principal.

### Factories (two, not one)

A contract on Lasna cannot deploy to Unichain Sepolia, so onboarding needs two deployments:

| Factory | Lives on | Deploys |
|---|---|---|
| `AgentFactory` | Lasna | the user's Agent |
| `VaultFactory` | Unichain Sepolia | the user's Vault |

- **Deploy the Agent first.** The Vault takes the Agent address in its constructor, because that address is the callback authentication.
- The app calls both in one flow, then links them: `agent.vault[chainId] = vault`.
- Both set the user as owner. The app pays deployment gas so the user needs nothing to start.
- If the second call fails, the Agent exists with no Vault. The app must retry, not leave a half-built account.

### Registry

- Lives on Unichain Sepolia. Written by the user's own transaction, or by a callback from the Agent. **Never written by the indexer** — it is read-only.
- Public rule listings: template id, encoded params, agent address, metadata pointer, public flag.
- Powers the marketplace and one-click clone. A clone reads the params and calls `addRule` on the cloner's own Agent.
- Stores no funds and cannot execute anything.

### Indexer

- Read-only. Watches `Executed`, `Mirrored`, `Balances`, `RuleCreated`, `RulePaused`, and callback records, on both chains.
- Writes to Postgres/SQLite. Powers the UI, the leaderboard, and the proof page.
- **Reconstructing the loop does not need the indexer.** `getCallbacks(reactiveTxHash)` on the Lasna system contract returns every callback posted by that reactive transaction, including the destination tx hash and any error. The proof page can be built from chain state alone.
- **Cannot move funds. This is not a bot.** Say that in the README.

### Multi-chain stance

**Architect for N chains. Ship one.**

Shipping chain: **Unichain Sepolia (1301)** — the only Reactive testnet with an official Uniswap V2 deployment, a live WETH/USDC pair, 1s blocks, and Uniswap UI support. Evidence and verified addresses in §22.

The cost of chain-readiness is nearly zero:

- The callback config already carries `chainId`. Store it on the rule; it costs nothing now.
- A Vault is deployed per `(user, chainId)` and takes that chain's Uniswap router as a constructor argument.
- The Agent routes the callback to the Vault matching the rule's `chainId`.
- The indexer tags every event with `chainId`.
- The UI hides templates a chain does not support.

Adding a second destination later = deploy a Vault, register a router, enable the template. No rewrite.

**What "multichain" honestly means here:** the rule lives on Lasna, the money lives on another chain. That is already true, and it is the point. Moving *value* between chains needs a bridge — do not claim that.

**Optional stretch, only after the core loop works:** one cross-chain alert rule (watch Base Sepolia, emit on Unichain Sepolia). It proves the cross-chain read without touching value.

---

## 9. How the reactive loop works

### The three steps

1. An event is emitted on Unichain Sepolia (or a cron tick on Lasna).
2. The system contract calls `react(log)` on the Agent. The Agent pays a fee in REACT.
3. If the rule fires, the Agent asks the system for a callback. The callback lands on the Vault, which pays gas in ETH on Unichain Sepolia.

### The check happens twice

The Agent cannot see live state on Unichain Sepolia. It only knows what the event told it, and the event is already a few seconds old by the time the callback lands.

So every money rule is checked in two places:

| Where | Sees | Decides |
|---|---|---|
| Agent (Lasna) | the `Sync` payload, plus its own cache | *should this rule fire at all?* |
| Vault (Unichain) | the pair's reserves **right now** | *does the rule still hold? spend or revert* |

The Agent's check is cheap and can be wrong. The Vault's check is the one that protects the user. If the price moved between the two, the Vault reverts. A revert costs gas, so the Vault's check must stay small and the slippage tolerance must be wide enough to cover a few seconds of drift.

This is also why the Vault — not the Agent — is the source of truth for "did it run". A callback can revert after the Agent has already incremented its counter.

### Key constraints

| Constraint | Consequence for the design |
|---|---|
| Agent cannot read other chains | All state must be cached from event data (price, balances, timestamps). |
| Subscriptions are exact match only | You cannot subscribe to "price < X". You subscribe to all `Sync` events of one pair and check the price inside `react()`. |
| Callback payload's first 160 bits are overwritten with the Agent's address | The Vault declares `address agent` as its first argument and checks it. This is the authentication. |
| Callback gas is paid by the recipient | The Vault must hold ETH. Two balances, two chains. |
| Any debt blocks execution | An underfunded Agent goes **silent**, not loud. |
| Minimum callback gas 100,000 | Below that, the request is ignored. |
| Max reactive gas 900,000 | Shared agents must process a bounded slice per tick. |
| A reverting `react()` is still charged | Bugs cost the same as successes. |
| Mainnet and testnet must not be mixed | A testnet origin cannot call a mainnet destination. Keep the whole flow on testnets. |

### Subscription map

| Template | Subscription |
|---|---|
| DCA, recurring transfer | `Cron10000` on the legacy system, gated by timestamp |
| Dip-boost DCA | `Cron10000` **plus** pair `Sync` (cron buys, `Sync` keeps the cache fresh) |
| Limit buy, take profit, stop loss, grid, price alert, range alert | pair `Sync` |
| Income sweep, large transfer | token `Transfer`, filtered on `topic2 = vault` |
| Balance floor | own Vault's `Balances` event |
| Dead-man switch | `Cron10000` **plus** the user's own `Transfer` events, to know when they were last active |
| Mirror / copy trading | leader Vault `Executed` |

Use the **longest cron interval that works**. `Cron1` is never acceptable.

Subscriptions are exact-match only, so a rule about *incoming* transfers sets `topic2` to the Vault address and leaves the token contract open. That is why #8 and #13 cost almost nothing: the node does the filtering, not the contract.

### Proving the loop without the indexer

```solidity
getCallbacks(uint256 reactiveTxHash)
    returns (CallbackRecord[] memory);
```

Each record carries the block number, the requesting reactive contract, the callback index, the destination chain id, the **destination tx hash**, and error data (empty on success). Call it on the Lasna system contract with the hash of the reactive transaction.

The proof page should use this as its primary source and the indexer only for caching. If our database dies during judging, the loop is still provable.

---

## 10. Custody and trust model

| Action | User | App |
|---|---|---|
| Own Agent and Vault | yes | no |
| Add / pause / cancel a rule | yes | no |
| Withdraw principal | yes | no |
| Change payout address | yes | no |
| Top up gas reserves | yes | yes |
| Move principal | only via the pre-approved action | **no** |

**Pitch line:** "We pay the gas so anyone can use it. You keep the money, in your own contract, withdrawable at any time. We never hold a key to it."

This is the line that separates Rulebook from every project that quietly took custody.

---

## 11. Funding model

Three separate balances. Do not mix them in the UI.

| Balance | Where | Paid by |
|---|---|---|
| Reactive credit (REACT) | Agent, Lasna | App (sponsored) |
| ETH | Vault, Unichain Sepolia (callbacks only) | App (sponsored) |
| Principal | Vault, Unichain Sepolia | **User** |

> **Fee token.** Reactive fees are charged in **REACT**, the native token. The faucet delivers **lREACT**, the liquid staking form. Confirm on day 1 how lREACT becomes spendable and set the budget from the REACT figure. Do not build a "runs left" meter on an assumption about this.

### Onboarding — four clicks

1. Connect wallet.
2. "Create my account" → both factories deploy the Agent and the Vault, and the app funds them.
3. "Get test funds" → the app sends a small starter amount of test USDC/WETH from a pre-funded demo wallet, and links to Circle's USDC faucet for more.
4. Build a rule in the composer, click create.

### Rule creation without user gas

`depositTo()` is permissionless, so the app can fund any Agent or Vault without the user's key. It settles debt first, then credits reserves.

For the rule-creation transaction itself:

- **v1 (simple):** the app sends the user ~0.05 REACT so they sign their own config tx.
- **v2 (nicer):** the user signs an intent off-chain; the app relays and pays. Agent verifies signature + nonce.

Start with v1. Verify on day 1 that an EOA can receive and spend the Lasna gas token. If it cannot, skip straight to v2.

### Abuse controls

- Max 5 rules per user
- Per-rule execution budget
- Per-user monthly execution cap
- Allowlisted templates only

### Honest caveat

Sponsorship creates one central dependency: if the app stops topping up, rules go quiet. Mitigations, stated in the README:

- `depositTo()` is permissionless, so anyone can revive an Agent
- the Vault is always withdrawable by the owner
- a lapsed sponsor pauses automation; it never risks funds

### Faucet reference

| Network | Faucet |
|---|---|
| Base Sepolia | `0x2afaFD298b23b62760711756088F75B7409f5967` |
| Ethereum Sepolia | `0x9b9BB25f1A81078C544C829c5EB7822d747Cf434` |

Rate: 1 ETH → 100 lREACT. Max 5 ETH sent, 500 lREACT received, per transaction.

Note: the lREACT faucet only accepts ETH on Base Sepolia or Ethereum Sepolia. The destination chain is still Unichain Sepolia — these are only for buying reactive credit.

---

## 12. Cost model

### Formula (from the Reactive docs)

```
fee = p_base × C × (gasUsed + K)
```

- `p_base` — the greater of `tx.gasprice` and `block.basefee`
- `C` — coefficient from `_gasPriceCoeffPer1000`, divided by 1000. Default 1.0
- `K` — fixed surcharge from `_extraGas`. Default 100,000 gas

Waking up costs more than thinking. Both `C` and `K` can be changed by the system owner, so query them rather than trusting the defaults.

### Measured on 2026-11-16

| Chain | Base fee |
|---|---|
| Lasna (block 8,466,858) | **100 gwei** |
| Unichain Sepolia | **0.0015 gwei** |
| Base Sepolia (for reference) | 0.005 gwei |

### Per call

| Action | Cost |
|---|---|
| Config tx (`addRule`) | ~0.022 REACT |
| Cron tick, rule does not fire | ~0.013 REACT |
| Cron tick, rule fires | ~0.022 REACT |
| Price event, no fire | ~0.014 REACT |
| Price event, fires | ~0.023 REACT |
| Callback swap on Unichain Sepolia | ~0.0000006 ETH |

**Rule of thumb: ~0.02 REACT per wake-up.**

### Per year

| Setup | REACT / year |
|---|---|
| Daily DCA, `Cron10000` (~3h) | ~44 |
| Weekly DCA, `Cron10000` | ~42 |
| Daily DCA, `Cron1000` (~17min) | ~410 |
| Daily DCA, `Cron100` (~2min) | ~4,100 |
| Price rule, 10 events/day | ~51 |
| Price rule, 1,000 events/day | ~5,100 |

Two things to notice:

1. **Weekly DCA costs almost the same as daily.** You pay for ticks, not trades.
2. **Response cost scales with event volume, not time.** A busy pool is expensive.

### Budget for this buildathon

- 19 days, one daily DCA rule: **~4 REACT**
- All testing, redeploys, config txs: **~10 REACT**
- Vault callbacks: **0.01 ETH** covers thousands of swaps

One faucet claim is enough for the whole event.

### Scaling lever: shared vs per-user Agent

Per-user agents are simple but each pays the full tick bill. A shared Agent with 100 rules pays one tick for all of them — roughly **100x cheaper**.

Decision for now: **per-user Agent** (isolation, clean ownership, simpler demo). Document the trade-off. If time allows, add a batched "shared engine" mode with a bounded slice per tick.

### Operational gotchas

- **Debt means silence.** No error, no alert. The "runs left" meter is load-bearing.
- **Fund with `depositTo()`**, not a plain transfer. A transfer raises the balance but settles no debt and creates no reserves. If the contract has no `coverDebt()` wrapper, the money is stranded.
- **A reverting `react()` is charged in full.** Same for a failed callback.
- **900k gas cap** per reactive tx.
- **Direct transfers to the system contract credit the sender.** Always pass the target to `depositTo(address)`.

### Verify before budgeting

```bash
# Reactive side
cast call $SYSTEM "_extraGas()"               --rpc-url $LASNA_RPC | cast to-dec
cast call $SYSTEM "_gasPriceCoeffPer1000()"   --rpc-url $LASNA_RPC | cast to-dec
cast call $SYSTEM "_maxChargeGas()"           --rpc-url $LASNA_RPC | cast to-dec
cast call $SYSTEM "reserves(address)" $AGENT  --rpc-url $LASNA_RPC | cast to-dec
cast call $SYSTEM "debt(address)"     $AGENT  --rpc-url $LASNA_RPC | cast to-dec

# Destination side — the callback proxy has its own values, no defaults
cast call $PROXY "_gasPriceCoeffPer1000()"    --rpc-url $UNICHAIN_RPC | cast to-dec
cast call $PROXY "_extraGas()"                --rpc-url $UNICHAIN_RPC | cast to-dec
cast call $PROXY "reserves(address)" $VAULT   --rpc-url $UNICHAIN_RPC | cast to-dec
cast call $PROXY "debt(address)"     $VAULT   --rpc-url $UNICHAIN_RPC | cast to-dec
```

---

## 13. Marketplace, clone, and mirror

Marketplace and clone are cheap. Mirror is the strongest demo beat and is **committed to v1**.

### Listing and clone

- **Listing:** any rule can be made public. Params and stats go to the Registry.
- **Clone:** copy the params into your own Agent, with your own budget. One click, no latency concern.
- **Leaderboard:** computed by the indexer from executions.

### Mirror (v1)

Two-hop loop: leader Vault emits → follower Agent reacts → follower Vault executes.

| Piece | Decision |
|---|---|
| Trigger | leader Vault's `Executed` event, subscribed per `(chainId, vault, topic0)` |
| Scale | `spend = min(perRunCap, leaderAmountIn × scaleBps / 10000)` |
| Dedupe | `keccak256(leaderVault, ruleId, leaderTxHash)` → bool |
| Depth cap | **structural**: mirror Vaults emit `Mirrored`, never `Executed`. Only `Executed` can be copied, so a copy can never be copied |
| Slippage | `scaleBps` capped per rule; `minOut` from the follower's own quote |
| Burst | max N mirror executions per hour per follower |
| Token constraint | leader and follower must hold the same `tokenIn`; enforced when the mirror is created |
| Agents | leader and follower must be different Agents |

**Best rules to mirror:** limit-buy and stop-loss. Mirroring a DCA is pointless — both sides just buy on schedule.

**Demo:** one leader event → two callbacks → two vaults → two tx hashes on one proof page. This is the strongest Execution artifact in the project.

Seed the marketplace with 3–4 of our own public rules so it is not empty on day one. **Label them as team-authored**, with a visible badge on the card. Never dress them up as fake users — the same reason the thin pool gets announced in the video.

---

## 14. What the user sees

- **Home** — my rules, status, runs left
- **Create** — the sentence composer (below)
- **Rule detail** — last executions, receipts, balances, pause/cancel
- **Proof page** — origin tx → reactive tx → callback tx, with latency in ms
- **Marketplace** — public rules, stats, clone
- **Leaderboard** — rules by runs and success rate

### The builder is a sentence, not a canvas

Every DeFi automation product uses the same UI: a node canvas. Drag a "trigger" box, wire it to an "action" box. Crieta, FlowFi, FlowHub, Kōan, Suiquencer, Glacient, mariposa — same screen, and **every one of them needs an off-chain keeper to execute what the graph describes.**

We are arguing against that keeper. We should not copy its UI.

A canvas also implies composition we do not have. There are 13 templates, and every rule is exactly one path: trigger → condition → action. A graph with one edge and no branching is decoration.

**Instead: a sentence you build by dragging words.**

```
[Every] [Friday] [buy] [10 USDC] [of ETH] [only if] [price < 1,400]
```

Each chip is a real stored value. There is no graph → template translation step, so there is nothing to fail at demo time. The sentence *is* the ABI.

### Three drags, all with on-chain meaning

| Drag | Effect | On-chain |
|---|---|---|
| Chip into a slot | sets a param | a field in `addRule` |
| Public rule card into "My Rules" | clones it | `addRule` on your Agent |
| Rule up/down in the list | runs earlier | `reorderRules` → evaluation order inside `react()` |

The third is the one worth pointing at. Order matters because `react()` has a 900k gas cap, and the rules that run first are the ones that get to execute. That is a drag gesture that changes on-chain behaviour, not a cosmetic one.

### Live calldata

Beside the composer, show the call it will produce:

```
addRule(3, 0x1d86…e9da, 1400000000, 10000000, 0)
```

It updates as you drag. This makes the no-code claim checkable and shows there is no server in the middle.

Use `dnd-kit`, not raw HTML5 drag events — it ships keyboard sensors, so the gesture stays accessible.

### The proof page

Three rows, each linking out:

1. origin tx on Uniscan
2. reactive tx on Reactscan
3. callback tx on Uniscan

Row 3 comes from `getCallbacks(reactiveTxHash)` — no database required. Show the gap between row 1's timestamp and row 3's timestamp. That number is the pitch.

### README line

> A canvas is what you build when an off-chain engine executes your graph. We do not have one. Every rule is one path, so the builder is a sentence, not a diagram.

The **proof page** is still the highest-value screen. It is the submission requirement, it is the demo, and it is what makes judges believe the loop.

---

## 15. Build plan (19 days)

| Days | Work |
|---|---|
| 1–5 | Agent, Vault, two factories, Registry. Foundry tests with `reactive-test-lib`. One rule end-to-end on testnet. |
| 6–10 | Sentence composer. Create / pause / cancel. Reorder. Proof page. Receipts. Indexer. |
| 11–14 | Four more templates. Simulate-now. Clone. Registry wiring. Marketplace. |
| 15–17 | Mirror + leaderboard. Docs. Seed data. |
| 18–19 | Video. Buffer. Submission. |

### Day 1 must-dos, before anything depends on them

1. One 1 USDC swap through the router `0x6e8C…CfbF` on Unichain Sepolia.
2. Receive lREACT from the faucet and confirm an EOA can spend it on Lasna.
3. Confirm `getCallbacks` returns a destination hash for a test callback.

If any of the three fails, the plan changes — find out on day 1, not day 15.

### Cut line

If behind on day 14, drop in this order:

1. Leaderboard
2. Marketplace filters
3. Dip-boost and grid templates

**Mirror is committed.** If the two-hop loop is still broken on day 16, ship clone-only and say so in the video — a working clone beats a broken mirror.

**Never cut:** the proof page, the second template, the pause/cancel flow.

---

## 16. Demo plan (under 3 minutes)

| Time | Beat |
|---|---|
| 0:00–0:20 | The problem: bots need a server and a key. |
| 0:20–0:50 | Create a DCA rule in the composer. A few drags, under a minute. |
| 0:50–1:20 | Proof page: origin event, reactive tx, callback tx, latency. |
| 1:20–1:50 | Move the price in a thin pool we seeded. Limit-buy fires. |
| 1:50–2:20 | Clone a public rule. |
| 2:20–2:40 | Mirror a leader's trade — the two-hop loop. |
| 2:40–3:00 | Leave-it-running proof: executions that happened while nobody watched. |

Everything else is screenshots, not footage.

**Say this out loud in the price beat:** the thin pair was seeded by us so the price could be moved on camera. The live WETH/USDC pool on Unichain Sepolia is ~$33.7k deep, so a real 5% move needs ~400 USDC. Seeding a thin pair is demo production, not a product trick — and admitting it costs nothing, while being caught hiding it costs the Craft score.

---

## 17. Submission checklist

- [ ] Public repository, open source
- [ ] Agent address (Lasna)
- [ ] Vault address (Unichain Sepolia)
- [ ] Registry address
- [ ] 3+ transaction hashes showing origin → reactive → callback
- [ ] One hash showing a **clone**, one showing a **mirror**
- [ ] A `getCallbacks` proof that does not depend on our indexer
- [ ] Demo video under 3 minutes
- [ ] README with architecture, cost model, and custody model
- [ ] Cost model page (see §12) — cheap Craft points

---

## 18. Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Testnet prices are calm, so price rules never fire | High | Seed our own thin Uniswap pool; move it with a small swap and say so in the video |
| Lasna gas (100 gwei) drains agents faster than expected | Medium | Longest cron interval; budget meter; app tops up via `depositTo()` |
| Uniswap docs and the deployments feed disagree on the Unichain Sepolia router address | Medium | Both routers are live and point at the same factory; use `0x6e8C...` from the feed and verify with a 1 USDC swap on day 1 |
| An EOA cannot receive or spend lREACT on Lasna | Medium | Test on day 1; fall back to signed intents relayed by the app |
| The two factories half-complete (Agent without Vault) | Medium | Onboarding is resumable; retry the missing deploy instead of restarting |
| Scope creep from marketplace features | High | The cut line in §15 is binding |
| Callback auth footgun (first arg overwritten) | Medium | One shared `AbstractCallback` base; test it in Foundry before testnet |
| A shared Agent hits the 900k gas cap | Low (v1) | Per-user agents for v1; bound rule count |
| Mirror burst: one leader event fans out to N followers | Medium | Per-follower hourly cap; dedupe on `(leaderVault, ruleId, txHash)` |
| Mirror gets a bad fill on a thin pool | High | Cap `scaleBps`; let `minOut` revert instead of filling |
| A price rule fires again on every `Sync` while the condition holds | High | Latch (`done = true`) or cooldown on every non-cron rule |
| The Vault's live re-check reverts because the price moved between the two chains | Medium | Wide slippage tolerance; keep the Agent's cached price close to live |
| A mirror of a mirror recurses | Low | Structural: mirror Vaults emit `Mirrored`, never `Executed` |
| Sponsor runs dry mid-demo | Low | Pre-fund 10x the expected usage; check before recording |

---

## 19. Out of scope

- Backtesting engine
- Shipping to more than one destination chain in v1 (the code supports N; the release ships one)
- Perpetuals
- Uniswap V3 position management, Aave, Morpho actions
- Portfolio baskets
- AI rule writer
- Tokens, referrals, points

---

## 20. Open questions

1. **Chain:** decided — Unichain Sepolia (1301), evidence in §22. The contract design still supports N chains; add a second destination only after the demo works.
2. **Agent model:** per-user (chosen) or shared engine with a bounded slice? Revisit only if there is spare time.
3. **Mirror:** committed to v1. Decide on day 16 whether it ships or falls back to clone-only.
4. **Rule creation:** decided — v1, the app sends the user a little Lasna gas so they sign their own config tx. Falls back to signed intents if an EOA cannot hold that gas.
5. **Name:** Rulebook is a working title. Alternatives: Autopilot, Setback, Loop.

---

## 21. The one-sentence version

> A no-code builder where every personal money rule becomes a reactive contract that runs itself — the user keeps the money, we pay the gas, and nobody has to keep a server awake.

---

## 22. Chain decision (verified 2026-11-16)

Reactive testnets are fixed: Base Sepolia, Ethereum Sepolia, Lasna, Unichain Sepolia. Three are usable destinations for this project. **Mainnet and testnet must not be mixed:** a testnet origin cannot call a mainnet destination.

| Criterion | Unichain Sepolia | Base Sepolia | Ethereum Sepolia |
|---|---|---|---|
| Reactive origin + destination | yes | yes | yes |
| Callback proxy live | `0x775c9B990ADe401060B78D0e98684eEf8d2466C1` | `0x476F44b11F5C942c58f4c8E3d0300E5710743585` | `0xAa14d9Cd0f788Ca23d11805986C1d8bd035D23b4` |
| Official Uniswap V2 | **yes, 4,026 pairs** | **none** | yes, two live factories |
| Uniswap UI support | yes | **no** | yes |
| Block time (measured) | **1.0s** | 0.2s | 12s |
| Gas price (measured) | **0.0015 gwei** | 0.005 gwei | higher |
| Full loop estimate | ~2–4s | ~1–2s | ~25–35s |
| Timer complexity | simple | 200ms caveat | simple |

**Decision: Unichain Sepolia (1301).**

- **Base Sepolia:** Uniswap's deployments feed (1,123 records) has **zero v2 entries** for 84532. Only v3, v4, universal-router, liquidity-launchpad. The Uniswap UI also does not support Base Sepolia testnet. Using it means deploying V2 yourself — extra work and a weaker integration story.
- **Ethereum Sepolia:** 12s blocks make the loop ~25–35s. Docs and feed also disagree on the V2 factory (`0xF62c...` vs `0xB7f9...`); both have code and thousands of pairs.

### Verified addresses — Unichain Sepolia

| Item | Address |
|---|---|
| Chain ID | 1301 |
| RPC | `https://sepolia.unichain.org` |
| Explorer | `https://sepolia.uniscan.xyz` |
| Callback proxy | `0x775c9B990ADe401060B78D0e98684eEf8d2466C1` |
| Uniswap V2 Factory | `0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f` |
| Uniswap V2 Router02 | `0x6e8C9D62A16419357eA998229126D2fD6B1CCfbF` |
| WETH | `0x4200000000000000000000000000000000000006` |
| USDC (6 dp) | `0x31d0220469e10c4e71834a79b1f276d740d3768f` |
| WETH/USDC pair | `0x1d8698365321d6dce1f7141c380c866b012ee9da` |
| System contract (Lasna) | `0x8888888888888888888888888888888888888888` |
| Cron source (Lasna) | `0x0000000000000000000000000000000000fffFfF` |

Verified on-chain: router `.factory()` returns the factory above, the factory reports 4,026 pairs, and the pair exists with WETH/USDC.

### Pool facts (measured)

- Reserves: **16,837.30 USDC + 11.2486 WETH**
- Implied price: **~1,496.84 USDC per WETH** (testnet price — do not quote USD figures in the demo)
- Notional: ~$33.7k
- Price impact: 10 USDC → 0.12%, 100 USDC → 1.19%, 1,000 USDC → 12.2%

Consequence: the live pool is good enough for a real product demo, but not for a dramatic "price collapsed" moment. For templates 3–6, seed a **separate thin pair** on the same factory and move it with a small swap.

### Caveats

1. **Two routers are live** and both point at the same factory: `0x6e8C...` (official feed) and `0x920b...` (docs page). Use `0x6e8C...`; verify with a 1 USDC swap on day 1.
2. **The lREACT faucet only accepts ETH on Base Sepolia or Ethereum Sepolia.** Keep a little ETH there for funding Agents; the destination stays Unichain Sepolia.
3. **Unichain Sepolia faucets often require mainnet history** (Alchemy needs ~0.001 ETH on Ethereum). Superchain, QuickNode and thirdweb are the fallbacks.
4. **Circle's faucet covers Unichain Sepolia USDC**, which is the token already in the pair.

---

## 23. Contract spec (write this before anything else)

Everything above is prose. This is the shape the code has to match.

### Rule struct

```solidity
struct Rule {
    uint8   template;   // 1..13
    uint16  chainId;    // destination chain; 1301 in v1
    address pair;       // Uniswap V2 pair, or address(0)
    address tokenIn;
    address tokenOut;
    uint256 amountIn;   // per-run spend, in tokenIn units
    uint256 threshold;  // price or amount, scaled per template
    uint256 secondary;  // band width, trailing %, expiry, or inactivity days
    uint64  lastRun;
    uint32  runs;
    uint8   flags;      // bit0 active, bit1 latched, bit2 mirrored
}
```

Five rules per user, so the whole set is small. Keep the struct under eight slots.

### Events

```solidity
event RuleCreated(address indexed agent, uint256 indexed ruleId, uint8 template, bool publicRule);
event RulePaused(address indexed agent, uint256 indexed ruleId, bool paused);
event BalanceUpdated(address token, uint256 balance, uint256 timestamp); // emitted after deposits
event Executed(uint256 indexed ruleId, address tokenIn, address tokenOut,
               uint256 amountIn, uint256 amountOut, uint256 timestamp);
event Mirrored(uint256 indexed ruleId, address indexed leader, bytes32 leaderTx);
event Balances(address token0, uint256 balance0, address token1, uint256 balance1);
```

`Executed` is only emitted by leader Vaults. `Mirrored` is only emitted by mirror Vaults. That split is the depth cap.

### Callback signature

Reactive overwrites the first 160 bits of the payload with the Agent's address, so `agent` **must** be the first argument:

```solidity
function execute(address agent, uint256 ruleId, bytes calldata data) external;
```

The Vault stores its Agent address and checks `agent == agentAddress` before doing anything else. One shared `AbstractCallback` base handles this for every callback function.

### Receipts

`getCallbacks(uint256)` on the Lasna system contract is the primary proof source. The indexer caches it; it does not replace it.
