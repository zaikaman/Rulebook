# Phase 0 Research: Rulebook Implementation

**Feature**: `001-reactive-rule-builder` | **Date**: 2026-11-16

Scope: resolve every unknown in the plan's Technical Context, and settle the stack choices the user fixed (React + Vite, Node.js backend, Vercel, Heroku, Supabase) as concrete decisions with alternatives recorded.

---

## R1. Frontend: React + Vite SPA, static on Vercel

**Decision**: React single-page application built with Vite, TypeScript, React Router in client-side routing mode, deployed to Vercel as a static build with an SPA rewrite.

**Rationale**: The product is a wallet-connected app with no SEO surface and no server-rendered personal data; a static SPA is the cheapest thing that works and Vercel serves it from CDN for free. Client-side routing needs `vercel.json` rewrites so deep links to `/proof/:hash` resolve to `index.html`. The composer needs sub-frame recalculation while dragging, which is where Vite's fast refresh and a plain React tree (no SSR hydration) pay off.

**Alternatives considered**:

- Next.js on Vercel — rejected: SSR buys nothing for a wallet-authenticated app, adds a second server runtime and a mental split with the Heroku backend.
- Remix — rejected: same SSR argument, plus framework-specific data-loading patterns that fight wagmi's client hooks.
- Static export with no router — rejected: the proof page and marketplace need deep links for judges.

---

## R2. Backend: Node.js + Fastify on a Heroku Basic dyno

**Decision**: Fastify 5 on Node.js 24 LTS, deployed to Heroku as a `web` process (`node dist/server.js`) on the **Basic ($7/mo, always-on)** tier. The indexer runs inside the same process, started after the server binds, and is disabled by an env flag so tests and one-off jobs do not start it.

**Rationale**: Heroku removed free dynos in November 2022; the current cheapest tier is Eco ($5/mo), and **Eco dynos sleep after 30 minutes without web traffic**. A sleeping dyno would stop the indexer, which is precisely the failure the product claims to eliminate — and it would look like the product's own thesis failing during judging. Basic dynos stay up. One dyno runs both the API and the indexer because the demo workload is a few thousand events per day; splitting is a documented later step, not a buildathon cost.

**Alternatives considered**:

- Heroku Eco — rejected: idle-sleep kills the indexer (see above).
- Separate `worker` dyno on Basic (+$7/mo) — rejected for v1: doubles spend while the workload needs no isolation; recorded as the first scaling move.
- Vercel serverless/edge for the backend — rejected: 10–60s execution ceilings, no persistent cursor process, cold starts during a judge's click.
- Render / Railway / Fly.io — viable, but the user fixed Heroku and the plan does not need to relitigate it.

**Operational notes**: bind to `process.env.PORT`; `NODE_ENV=production`; `heroku-postbuild` compiles `packages/shared` then `backend`; Heroku Scheduler (free add-on) runs the daily keep-alive job.

---

## R3. Data access: backend-only Supabase, service-role key server-side

**Decision**: The frontend never talks to Supabase. All reads go through the backend read API, which holds the service-role key as a Heroku config var. Supabase RLS is enabled with no permissive policies as defense-in-depth, and every table is written only by the indexer.

**Rationale**: Constitution IV requires one validated boundary. If the browser also queried Postgres directly, there would be two decoders, two schema expectations, and a `VITE_*`-exposed anon key in the bundle. Routing everything through the backend gives one zod schema per response shape, one place to enforce read-only, and no chance of accidentally exposing sponsor or wallet data. It also keeps the Supabase anon key out of the client entirely.

**Alternatives considered**:

- Direct browser → Supabase with RLS — rejected: two validation paths, RLS as a security boundary we would have to prove under time pressure.
- PostgREST endpoints consumed by the frontend — rejected: same problem, fewer guarantees.
- Prisma/Drizzle ORM — rejected: supabase-js plus hand-written SQL migrations is less machinery for ~10 tables and avoids a generated client that must be rebuilt on every deploy.

---

## R4. Reactive interfaces: exact signatures (was an unknown, now resolved)

**Decision**: Implement against Reactive's current documented interfaces:

```solidity
// Lasna system contract — proof source
getCallbacks(uint256 reactiveTxHash)
    returns ((uint256, address, uint256, uint256, uint256, bytes)[]);
// tuple = (blockNumber, reactingContract, callbackIndex, destinationChainId, destinationTxHash, error)

// Requesting a callback
struct CallbackConfiguration_V_1_0 {
    uint256 chainId;
    address recipient;
    uint64  gasLimit;
    bytes   payload;
}
function requestCallbackV_1_0(CallbackConfiguration_V_1_0 memory config) external;

// Entry point
struct LogRecord {
    uint256 chainId; address contractAddress;
    uint256 topic0; uint256 topic1; uint256 topic2; uint256 topic3;
    bytes data; uint256 blockNumber; uint256 opCode;
    uint256 blockHash; uint256 txHash; uint256 logIndex;
}
function react(LogRecord memory log) external;   // guarded by onlySystem
```

The Vault inherits Reactive's `AbstractCallback` and authenticates with `onlyServiceProvider` + `onlyCallbackSender(reactiveAddress)`; the callback payload's first argument is the Agent address, which is what `onlyCallbackSender` compares.

**Rationale**: An earlier sketch in `IDEA.md` §9 described the authentication as "the first 160 bits are overwritten with the Agent address" and left the base class abstract. The library already ships this check, so reimplementing it would violate Constitution III (one shared callback base) and would be the single most expensive class of bug in the system. The tuple shape for `getCallbacks` is what makes the proof page implementable without our database (FR-034, SC-005). `LogRecord` field names also matter: current library builds use `chainId`, not the legacy `chain_id`, so decoder and contract must be generated from the same pinned library version.

**Alternatives considered**:

- Hand-rolled `require(msg.sender == callbackProxy)` — rejected: reimplements a solved problem, and gets the *sender* wrong (the call comes via the proxy; the identity is the payload's first argument).
- Emitting the legacy `Callback` event instead of `requestCallbackV_1_0` — rejected: deprecated; docs explicitly direct new contracts to the system-contract methods.

**Verification step (day 1)**: confirm `getCallbacks` selector and return shape against the live Lasna system contract `0x8888…8888` with a `cast call` before the proof page is written; pin the `reactive-lib` commit in `foundry.toml`. Also confirm Lasna's chain ID on-chain — Reactive's docs list **5318007**, which differs from numbers circulating in older examples.

---

## R5. Subscription lifecycle: managed from ordinary Lasna transactions only

**Decision**: `subscribe` / `unsubscribe` are called on the system contract from normal transactions to the Agent (`addRule`, `pauseRule`, `cancelRule`, `resumeRule`) — never from inside `react()`. The Agent keeps a per-topic reference count in storage so it subscribes once per topic and unsubscribes when the last rule needing that topic is paused or cancelled.

**Rationale**: A reactive contract exists twice — on Lasna and inside the reactVM. The system contract does not exist in the reactVM, so a `subscribe()` call made during `react()` fails there. Managing subscriptions at rule-change time avoids that entirely and is also cheaper: no extra callback just to change a subscription. The reference count satisfies FR-029 (stop paying for unused topics) without duplicate-subscription bookkeeping.

**Alternatives considered**:

- Subscribing inside `react()` via a self-callback — rejected: costs an extra round trip per subscription change and is the documented footgun in Reactive's FAQ.
- Subscribing all topics at Agent creation — rejected: DCA-only users would pay for every `Sync` event on the pair, which is the largest cost line in `IDEA.md` §12.
- Ignoring duplicates (allowed by the protocol) — rejected: duplicates are billed; a counter is cheap.

---

## R6. Indexer ingestion: persisted cursors over `getLogs`, not websockets

**Decision**: A cursor-driven polling loop using viem `getLogs` in bounded block ranges per chain, persisting the last fully-processed block in `indexer_cursors`. Confirmation depth: 12 blocks on Unichain Sepolia (~12s at 1s blocks), 20 blocks on Lasna. Every row is upserted on `(chain_id, tx_hash, log_index)`, which makes replay idempotent. Reorg handling: on a cursor regression beyond confirmation depth, re-scan the affected range and delete rows whose `tx_hash` no longer exists.

**Rationale**: Websocket subscriptions to public testnet RPCs drop silently, and a Heroku dyno restart would lose the subscription with no way to know what was missed. A persisted cursor makes the indexer restartable, backfillable, and testable offline with recorded fixtures (satisfies the "rebuild or reindex from chain events" runbook in Constitution V). Idempotent upserts mean a double-delivered log costs nothing.

**Alternatives considered**:

- Websockets — rejected: silent drops, no resume point.
- A hosted subgraph — rejected: none exists for Lasna or Unichain Sepolia.
- Querying RPC on every page load — rejected: public RPC rate limits and no aggregation.

---

## R7. Proof page: chain-first, database as cache

**Decision**: `GET /v1/proofs/:reactiveTxHash` calls `getCallbacks` on Lasna first, resolves the destination transaction via the Unichain RPC, and returns a fully-formed proof. The result is cached in Supabase with a TTL; a cache hit is returned only when the RPC read fails, and then labelled `cached: true` with its age. The frontend renders the proof from the API response and links every row to a public explorer.

**Rationale**: This is SC-005 turned into an endpoint. It also means the proof page keeps working if the Supabase project pauses (which it can, after 7 days of low activity on the free plan) or if the dyno is mid-restart. The `cached` flag prevents the failure mode of showing a stale proof as if it were live.

**Alternatives considered**:

- Read proof from Supabase only — rejected: makes the submission's central claim depend on our own uptime.
- Read `getCallbacks` from the browser directly — viable, but then two RPC paths exist and the CORS/rate-limit behaviour of the Lasna public RPC becomes a demo risk. Kept as a documented fallback if the backend is down during judging.

---

## R8. Composer encoding: one manifest, generated everywhere

**Decision**: `packages/shared/manifest/templates.json` declares the 13 templates — id, category, trigger kind, condition kind, action kind, slot list with types/ranges/labels, and the sentence template. A generator (`npm run generate -w packages/shared`) produces (a) Solidity constants in `TemplateCatalog.sol`, (b) TypeScript discriminated-union types and zod validators, (c) the catalog table used in documentation, and (d) fixture seeds for the template test matrix. The composer encodes via viem `encodeFunctionData` with the generated `Agent` ABI — the same call the wallet will submit.

**Rationale**: This is the one place where three runtimes must agree on 13 templates. Generating all four artifacts from one file makes disagreement a build error rather than a demo-time surprise (Constitution III, and FR-011's "every chip maps to exactly one parameter").

**Alternatives considered**:

- Hand-written constants in the contract, types in the frontend, and a doc table — rejected: three copies that drift on the first template edit.
- Runtime JSON fetch by frontend and backend — rejected: loses compile-time exhaustiveness in the composer, which is what makes 13 templates maintainable.

---

## R9. Wallet and network legibility

**Decision**: wagmi + viem with a two-chain config (Lasna 5318007, Unichain Sepolia 1301). Writes are chain-scoped: rule transactions target Lasna, deposits/withdrawals target Unichain. Before any signature, the app calls `switchChain` only after an explicit in-app prompt, and every signature surface carries a persistent network badge. Connect via injected wallets plus WalletConnect (needs a project ID); no email/social login.

**Rationale**: FR-049 and US7 exist because one wallet signing on two chains is the most likely place a user concludes their funds vanished. Making the switch explicit (rather than silently switching) also prevents the classic failure where a user signs a deposits transaction on the wrong chain and sees "success" with no funds moved.

**Alternatives considered**:

- RainbowKit — rejected: heavy default styling and an extra dependency; the connect surface here is one button.
- Privy/Dynamic embedded wallets — rejected: email onboarding is unnecessary on testnets and adds a custody-shaped component to a product whose pitch is "no custody".
- Auto-switch chains silently — rejected: violates FR-049's intent.

---

## R10. Drag and drop

**Decision**: `@dnd-kit/core` + `@dnd-kit/sortable` with keyboard sensors for both the chip-to-slot drag in the composer and the rule reorder list.

**Rationale**: `IDEA.md` §14 requires keyboard accessibility, and dnd-kit ships sensors for it without custom ARIA work. It also works on touch, which matters because judges may open the deployed app on a phone.

**Alternatives considered**: HTML5 drag events (rejected: no keyboard path, inconsistent on touch); react-beautiful-dnd (rejected: unmaintained for the React version in use).

---

## R11. Rule mutation semantics: replace, never edit in place

**Decision**: Changing a rule's parameters stops the old rule and creates a new one in a single flow; there is no in-place parameter edit. Reordering is separate (`reorderRules`) and is allowed on active rules.

**Rationale**: An in-place edit could raise a per-run spend ceiling under a running rule, which is a silent change to what the user pre-approved. Replace-and-recreate makes every new approval explicit and keeps the on-chain audit trail honest. Reordering is safe because it changes evaluation priority, not permission.

**Alternatives considered**: in-place edit with re-approval — rejected: two code paths, and the audit trail would need versioning for no demo benefit.

---

## R12. Testing layering and what runs where

**Decision**:

| Layer | Tool | Runs in CI | Notes |
|---|---|---|---|
| Contract unit + revert/access-control | `forge test` | yes | every external function, passing and failing case |
| `react()` routing, latch, cooldown, budget, reorder | `forge test` + `reactive-test-lib` | yes | simulated log records, no network |
| 13-template matrix (happy / condition-no-longer-holds / must-not-fire-twice) | `forge test` (generated fixtures) | yes | generated from the manifest |
| Factory → Agent → Vault → Registry wiring | `forge test` (integration) | yes | hermetic |
| Fork tests against Unichain Sepolia reserves/router | `forge test --match-path test/fork` | no (labeled) | needs RPC; run before submissions |
| Composer encoding and sentence rendering | Vitest + RTL | yes | asserts calldata equality against fixtures |
| Indexer decoder, cursor replay, idempotency | Vitest + recorded logs | yes | no network |
| API response shapes | Vitest + zod round-trip | yes | contract tests against `http-api.yaml` |
| End-to-end compose → calldata → proof render | Playwright, 1 path | yes | mocked chain client, no funded keys |
| Live testnet loop (origin → callback) | manual, `quickstart.md` | no | needs funded accounts |

**Rationale**: Constitution II demands hermetic CI with no live RPC or faucet except explicitly labeled fork/soak tests. The template matrix is generated so adding a 14th template cannot land without its three mandatory cases.

---

## R13. Hosting configuration, secrets, and the two platform traps

**Decision**:

- **Vercel**: project root `frontend`, build `npm run build -w frontend`, output `dist`, SPA rewrite. Only `VITE_UNICHAIN_RPC_URL`, `VITE_LASNA_RPC_URL`, `VITE_API_BASE_URL`, `VITE_WALLETCONNECT_PROJECT_ID`, `VITE_CHAIN_ID` are exposed.
- **Heroku**: Basic dyno, `Procfile` with `web: node dist/server.js`, `PORT` binding, config vars for `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `LASNA_RPC_URL`, `UNICHAIN_RPC_URL`, `INDEXER_ENABLED`, `INDEXER_START_BLOCK_*`. Heroku Scheduler runs `node dist/jobs/keepalive.js` daily.
- **Supabase**: two migrations paths only (schema, seed); free plan, 500 MB, 2 active projects; a paused free project is resumable from the dashboard for a year.

**Rationale**: The Vite `VITE_*` prefix is a public-in-bundle contract, so the service-role key must never sit behind it — this is stated as a rule because it is the easiest secret leak in this stack. The Supabase free-tier pause (7 days of low activity) is real; the indexer's continuous writes normally prevent it, but the daily keep-alive exists for the buildathon's quiet stretches. Note that a keep-alive must be a **real query against a table** — an RPC that returns a constant does not count as database activity.

**Alternatives considered**: Supabase Pro ($25/mo) to eliminate pausing — rejected for now, recorded as the paid escape hatch if the project pauses mid-judging.

---

## R14. Day-1 verification spikes (blocking for later phases)

These come from `IDEA.md` §15 and are not optional; the plan assumes they pass and names the fallback.

| Spike | Command-level check | If it fails |
|---|---|---|
| Router works | 1 USDC swap through Uniswap V2 Router02 `0x6e8C…CfbF` on Unichain Sepolia | Try the second live router (`0x920b…`), then deploy V2 from source |
| Test funds reach the pair | balance deltas observed on the pair after the swap | Seed the thin demo pair and use it for templates 3–6 |
| lREACT usable by an EOA | receive from faucet, then send a Lasna tx from that EOA | Switch rule-creation funding to signed intents relayed by the app (v2 in `IDEA.md` §11) |
| Cost model | `_extraGas`, `_gasPriceCoeffPer1000`, `_maxChargeGas`, `reserves`, `debt` on both proxies | Re-budget; if per-wake-up cost exceeds ~0.03 REACT, lengthen cron intervals |
| Proof path | a test callback exists and `getCallbacks` returns its destination hash | Proof page falls back to indexing destination txs by `ruleId`, and the README says so |
| Callback auth | wrong-sender and wrong-first-argument calls revert | Fix in `AbstractCallback` usage before any testnet deploy |

---

## R15. Cost and capacity envelope for this deployment

**Decision**: Operate within one Basic dyno ($7/mo), one free Vercel project, one free Supabase project, and ≤14 REACT for the buildathon; gate the demo on ~2 REACT of headroom.

**Rationale**: `IDEA.md` §12 measured per-wake-up cost at ~0.02 REACT and per-year DCA at ~42–44 REACT with `Cron10000`. The demo uses one daily DCA plus price rules on a seeded thin pair capped at 10 events/day (~51 REACT/year ⇒ ~1.5 REACT for the event window), which fits the budget. Two levers are built in and documented rather than discovered later: use the longest cron interval that satisfies the template, and per-user Agents mean a demo with 3 users pays 3 tick bills — acceptable at this scale, and the shared-engine optimization is explicitly out of v1.

**Alternatives considered**: shared Agent with a bounded slice per tick (~100× cheaper at 100 rules) — rejected for v1 by `IDEA.md` §12's own decision (isolation, ownership clarity, simpler demo); recorded as the scaling lever, not a v1 feature.
