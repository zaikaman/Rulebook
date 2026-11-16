# Implementation Plan: Rulebook — No-Code On-Chain Personal Automations

**Branch**: `001-reactive-rule-builder` | **Date**: 2026-11-16 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-reactive-rule-builder/spec.md`

## Summary

Rulebook turns a sentence the user assembles from chips into a self-executing on-chain automation. The technical shape is four deployable units plus one shared package:

1. **Contracts** (Solidity/Foundry) — a per-user `Agent` on Reactive Lasna that evaluates rules in `react()`, a per-user `Vault` on Unichain Sepolia that holds principal and moves money, two factories, and a `RuleRegistry`. These are the product; nothing else can substitute for them.
2. **Frontend** (React + Vite + TypeScript SPA, deployed on Vercel) — the sentence composer with drag-to-fill chips, a live calldata preview encoded client-side from the same ABI the transaction uses, rule management, and the proof page.
3. **Backend** (Node.js + TypeScript on Heroku) — a read-only event indexer plus a thin read API. It writes decoded chain events into Supabase and serves them to the frontend. It holds no key that can move funds and exposes no write path to a rule or a vault.
4. **Shared package** (`packages/shared`) — generated ABIs, per-chain constants, the 13-template manifest, zod boundary schemas, and the rule encoder. One source of truth for the template catalog across contracts, frontend, and backend.

The proof page deliberately bypasses the backend's own database: it reads `getCallbacks(reactiveTxHash)` from the Lasna system contract as its primary source and treats Supabase as a cache. That keeps judge-facing proof independent of our infrastructure, per SC-005.

Research resolved the two open platform facts that shape the design: `getCallbacks` returns `(uint256,address,uint256,uint256,uint256,bytes)[]` per Reactive's docs, and Heroku's Eco dynos sleep after 30 idle minutes — which would silently stop the indexer, so the backend runs on a **Basic ($7/mo) always-on dyno**, not Eco. Details in [research.md](./research.md).

## Technical Context

**Language/Version**:

- Contracts: Solidity `0.8.29` (pinned in `foundry.toml`; Reactive's `AbstractCallback` requires `^0.8.29`), Foundry stable toolchain
- Frontend: TypeScript 5.x, React (current stable, pinned by lockfile), Vite (current stable, pinned by lockfile)
- Backend: TypeScript 5.x on **Node.js 24 LTS** (Heroku supports 26/24/22; 24 is the conservative LTS choice, 22 as fallback)

**Primary Dependencies**:

- Contracts: `forge-std`, `Reactive-Network/reactive-lib` (`AbstractCallback`, `ISystemContract`, `IReactive`, `IPayable`), OpenZeppelin Contracts (`Ownable`, `SafeERC20`, `ReentrancyGuard`)
- Frontend: `wagmi` + `viem` (wallet + chain reads + client-side encoding), `@tanstack/react-query`, `react-router`, `@dnd-kit/core` + `@dnd-kit/sortable` (chip and list drag with keyboard sensors), Tailwind CSS
- Backend: Fastify 5, `zod` (boundary validation), `viem` (log polling and ABI decoding), `@supabase/supabase-js` (server-side only, service-role key), `pino` (structured logs)

**Storage**: Supabase managed Postgres — **derived read cache only**. Authoritative state is the chain: contract storage for rules and principal, `getCallbacks` for proof. Supabase is rebuildable by replaying logs (FR-034, SC-005). Free plan limits: 500 MB database, project pauses after 7 days of low activity — the indexer's continuous writes keep it active, with a daily Scheduler ping as belt-and-braces.

**Testing**:

- Contracts: `forge test` (unit, integration, access-control and revert paths), `reactive-test-lib` for `react()` simulation, `forge coverage` gated at ≥90% branch on core contracts, labeled fork tests against Unichain Sepolia RPC
- Frontend: Vitest + React Testing Library (composer encoding, sentence rendering, proof rendering states)
- Backend: Vitest with recorded log fixtures (decoder, idempotency, cursor replay, API contract)
- Cross-layer: one Playwright smoke path — compose a DCA sentence → assert emitted calldata → render proof view from fixture

**Target Platform**: Modern evergreen browsers (desktop + mobile web); Vercel static CDN for the SPA; Heroku Linux dyno (Basic, always-on) for the backend; Supabase managed Postgres; Reactive Lasna (5318007) and Unichain Sepolia (1301) for contracts.

**Performance Goals**:

- p50 origin event → confirmed funds-side transaction under 10s (SC-010)
- Proof view first paint under 2s; API read endpoints p95 under 300 ms
- Composer chip drag and calldata preview stay at 60 fps (no re-encode storm; memoized encoder)
- Indexer lag under 15s behind chain head at demo event volume

**Constraints**:

- Testnets only; a testnet origin cannot call a mainnet destination
- **No custody**: the backend and frontend hold no key that can move principal; the API is read-only by construction
- Reactive: 900k gas ceiling per reactive tx, minimum 100k callback gas, a reverting `react()` is still charged
- Budget: ~14 REACT for the whole buildathon; one Basic dyno, one free Supabase project, one free Vercel project
- Heroku Eco dynos sleep after 30 idle minutes and would stop the indexer — Basic tier required
- Single destination chain (1301) shipped; rule struct and callback routing already carry `chainId`
- 5 active rules per user; allowlisted templates only
- Secrets: service-role key and RPC keys exist only as Heroku/Vercel server-side config vars; Vite exposes `VITE_*` publicly, so no secret may use that prefix

**Scale/Scope**: 13 templates, 5 rules per user, 1 destination chain, ≤10 concurrent users, ~1–5k indexed events/day during the demo (well inside Supabase free tier), 8 frontend routes.

**Project Type**: web application (frontend + backend) with an on-chain program; npm workspaces monorepo.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### Pre-research gate (2026-11-16)

| Principle / Gate | Requirement | How this plan satisfies it | Status |
|---|---|---|---|
| I. Readable, Single-Purpose Code | One stated purpose per unit; NatSpec on external functions; named constants; `forge fmt` / Prettier / ESLint (`--max-warnings 0`) | Contracts split by role (`Agent`, `Vault`, factories, `Registry`, `RuleLib`, `TemplateCatalog`); one chain-config module per layer; formatters wired as CI gates | PASS |
| II. Test-First on Money Path (NON-NEGOTIABLE) | Failing test first on every money path; ≥90% branch on core contracts; revert paths and wrong-sender callback auth tested; 13 templates × 3 mandatory cases | Phase 1 design names the mandatory test matrix per contract; `AbstractCallback.onlyCallbackSender` wrong-sender case is a first-class test; template fixture matrix generated from the shared manifest so every template is forced to cover happy / stale-condition / must-not-fire-twice | PASS |
| III. One Source of Truth per Fact | `IDEA.md` §23 schema is canonical; events are API contracts; one shared callback base; one per-chain config per layer; 900k gas budget respected | `Rule` struct, events, and errors implemented exactly as `IDEA.md` §23; callback auth inherited from Reactive's `AbstractCallback` (not reimplemented); `packages/shared` generates ABIs, types, and the template catalog from one manifest | PASS |
| IV. Explicit Contracts and Typed Boundaries | No `any` across boundaries; validate once at ingestion; custom errors; destination chain is the only source of truth for "did it run" | zod schemas at every API/RPC/DB boundary in the backend; generated ABI types in the frontend; UI success states require a destination-side `Executed`/`Mirrored` event or a confirmed destination tx, never a Lasna receipt | PASS |
| V. Operable and Documented by Default | README, ADRs, versioned deployments file, three runbooks, secrets from env | `deployments/` file per network, `docs/decisions/` ADRs for the choices in research.md, runbooks for top-up / pause-cancel / reindex | PASS |
| Quality gate: contract tests & coverage | `forge test` 100% pass, 0 skipped; ≥90% branch | Gate script in `quickstart.md`; coverage command pinned to report summary | PASS |
| Quality gate: TS types, lint, build | `tsc --noEmit`, ESLint zero warnings, production builds | Each workspace owns its `typecheck`/`lint`/`build` script; CI runs all three | PASS |
| Quality gate: secret scan | Zero findings | Only public `VITE_*` values reach the bundle; service-role key never leaves Heroku config | PASS |

No violations. `Complexity Tracking` below justifies the multi-unit structure.

### Post-design gate (re-check after Phase 1)

| Check | Result |
|---|---|
| Data model still matches `IDEA.md` §23 without drift | PASS — `data-model.md` transcribes the struct, adds packed-slot plan, and adds no field the contract does not have |
| No new source of truth introduced | PASS — Supabase is explicitly derived and marked rebuildable; `contracts/http-api.yaml` marks every endpoint read-only |
| Gas/budget impact considered | PASS — evaluation order, latch, and `unsubscribe`-on-pause designed in; per-wake-up cost budget recorded in research.md |
| Boundary validation specified for each new surface | PASS — zod schema named per endpoint and per decoder in `data-model.md` and `contracts/http-api.yaml` |
| Cut line preserved | PASS — leaderboard and marketplace filters are additive surfaces behind the same read model; nothing in the design makes them load-bearing |

## Project Structure

### Documentation (this feature)

```text
specs/001-reactive-rule-builder/
├── plan.md                       # This file
├── spec.md                       # Feature specification
├── research.md                   # Phase 0 — decisions, rationale, alternatives
├── data-model.md                 # Phase 1 — on-chain + read-model entities
├── quickstart.md                 # Phase 1 — runnable validation scenarios
├── contracts/
│   ├── onchain-interfaces.md     # Solidity interfaces, events, errors, encoding
│   └── http-api.yaml             # OpenAPI 3.1 — read-only backend API
├── checklists/requirements.md
└── tasks.md                      # Phase 2 output ($speckit-tasks) — not created here
```

### Source Code (repository root)

```text
OmniIdeation/
├── contracts/                          # Foundry project
│   ├── foundry.toml
│   ├── src/
│   │   ├── agent/
│   │   │   ├── Agent.sol               # react(), rule storage, cache, subscriptions
│   │   │   └── AgentFactory.sol
│   │   ├── vault/
│   │   │   ├── Vault.sol               # principal, swap/transfer, live re-check
│   │   │   ├── MirrorVault.sol         # emits Mirrored, never Executed
│   │   │   └── VaultFactory.sol
│   │   ├── registry/RuleRegistry.sol
│   │   ├── libraries/
│   │   │   ├── RuleLib.sol             # struct + encode/decode helpers
│   │   │   ├── TemplateCatalog.sol     # generated constants from the manifest
│   │   │   └── PriceMath.sol           # reserves → price, slippage, scaleBps
│   │   └── shared/Errors.sol
│   ├── test/
│   │   ├── unit/                       # per-contract, per-revert-path
│   │   ├── integration/                # factory → agent → vault → registry
│   │   ├── templates/                  # 13 × happy / stale / no-double-fire
│   │   └── fork/                       # labeled Unichain Sepolia fork tests
│   └── script/Deploy.s.sol
├── packages/shared/                     # npm workspace, consumed by frontend + backend
│   ├── manifest/templates.json          # the 13 templates — one source of truth
│   ├── src/chains.ts                    # per-chain constants keyed by chain ID
│   ├── src/abi/                         # generated from forge artifacts
│   ├── src/encode.ts                    # rule → calldata / preview sentence
│   ├── src/schemas.ts                   # zod boundary schemas
│   └── scripts/generate.ts              # manifest + ABI → Solidity + TS + docs table
├── backend/                             # Node.js service on Heroku
│   ├── Procfile                         # web: node dist/server.js
│   ├── src/
│   │   ├── server.ts                    # Fastify bootstrap, PORT binding, health
│   │   ├── api/routes/                  # rules, executions, proofs, marketplace, leaderboard, sponsor
│   │   ├── indexer/
│   │   │   ├── poller.ts                # cursor-driven getLogs loop
│   │   │   ├── decoders/                # per-event decode → zod → row
│   │   │   ├── cursors.ts               # persisted block cursors, reorg guard
│   │   │   └── backfill.ts              # replay from genesis-ish block
│   │   ├── db/repositories/             # typed queries, idempotent upserts
│   │   ├── chain/                       # viem clients (Lasna + Unichain, fallback RPC)
│   │   └── jobs/keepalive.ts            # daily real SELECT to defer Supabase pause
│   └── db/migrations/                   # versioned SQL
├── frontend/                            # React + Vite SPA on Vercel
│   ├── vercel.json                      # SPA rewrite + build config
│   ├── index.html
│   └── src/
│       ├── pages/                       # home, create, rule detail, proof, marketplace, leaderboard, account
│       ├── composer/                    # sentence slots, chip palette, live calldata
│       ├── components/                  # network badge, balance trio, tx link, status pill
│       ├── hooks/                       # wagmi hooks, query hooks
│       └── lib/                         # wallet config, API client (zod-validated)
├── deployments/                         # versioned address records per network
├── docs/decisions/                      # ADRs
├── README.md
└── package.json                         # npm workspaces root
```

**Structure Decision**: npm workspaces monorepo with four workspaces — `contracts`, `packages/shared`, `backend`, `frontend`. Rationale: the template catalog and ABIs must be generated once and consumed by three layers (Constitution III), which requires a shared package; npm workspaces were chosen over pnpm because Heroku's Node buildpack and Vercel's build both handle npm workspaces without custom buildpack or install configuration. `contracts/` is a separate Foundry project because Foundry and npm resolve artifacts differently; it exposes artifacts into `packages/shared` through the generator script.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| Four workspaces instead of one project | The spec requires an on-chain program (AGENTS/VAULT), a browser SPA, and an indexer; each has a different runtime, build, and host | A single-package repo would duplicate the template catalog and ABIs across three runtimes, which Constitution III forbids; and Foundry cannot be made to share npm's build graph |
| `packages/shared` as a generated-code producer | The 13 templates must agree across Solidity constants, TS types, docs, and the composer | Hand-maintaining four parallel copies is the exact failure mode the constitution names; a generated manifest makes disagreement a build failure instead of a runtime surprise |
| Indexer and read API in one Heroku dyno | One always-on Basic dyno ($7) instead of two; the read API is stateless and the indexer is a background loop in the same process | A separate worker dyno doubles cost for a demo-scale workload; Vercel cron/serverless was rejected because a 10–60s function timeout cannot sustain a catch-up indexer or persist cursors between invocations |
| Supabase as a second store alongside chain state | Marketplace, leaderboard, and activity feeds need queryable aggregates that no chain RPC exposes | Reading everything from RPC per page load would exceed public RPC rate limits and cannot sort or aggregate across executions; the design keeps Supabase strictly derived and rebuildable, and proof never depends on it |
