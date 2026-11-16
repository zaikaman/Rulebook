---
description: 'Task list for Rulebook implementation'
---

# Tasks: Rulebook — No-Code On-Chain Personal Automations

**Input**: Design documents from `/specs/001-reactive-rule-builder/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`, `.specify/memory/constitution.md`

**Tests**: **INCLUDED and mandatory.** Constitution Principle II ("Test-First on Every Money Path") is NON-NEGOTIABLE: a failing test precedes any money-path implementation, core contracts need ≥90% branch coverage, and every revert path and access-control check gets its own test. Test tasks therefore sit before their implementation tasks in every phase. §speckit-tasks normally treats tests as optional; the project constitution makes them a gate here.

**Organization**: grouped by user story from `spec.md` so each story is independently implementable, testable, and demonstrable.

**Scale**: 279 tasks across 11 phases. Completing every task completes the project as specified — including the submission checklist, the deployment records, and the documentation the constitution gates on.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: parallelisable — different files, no dependency on an incomplete task
- **[Story]**: `US1`–`US8`, matching `spec.md`; Setup, Foundational, and Polish carry no story label
- Every task names the exact file it creates or edits
- **Money path** = anything that can move, lock, or misreport funds. Never skip its test task

## Path Conventions

Monorepo per `plan.md`: `contracts/` (Foundry), `packages/shared/`, `backend/` (Node 24 + Fastify), `frontend/` (React + Vite). Tests sit beside their layer: `contracts/test/{unit,integration,templates,fork}/`, `backend/test/`, `frontend/test/`, `frontend/e2e/`.

**Verified chain constants** (`IDEA.md` §22): Lasna `5318007`, Unichain Sepolia `1301`, Router02 `0x6e8C9D62A16419357eA998229126D2fD6B1CCfbF`, WETH/USDC pair `0x1d8698365321d6dce1f7141c380c866b012ee9da`, callback proxy `0x775c9B990ADe401060B78D0e98684eEf8d2466C1`, Lasna system contract `0x8888888888888888888888888888888888888888`.

**Two sponsor-only write routes exist** (`contracts/http-api.yaml`): `POST /v1/onboarding` and `POST /v1/starter-funds`. Nothing else in the backend may write to a chain.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: repository, tooling, hosts, and the gates every later task must keep green.

- [x] T001 Create the npm-workspaces root `package.json` with workspaces `contracts`, `packages/shared`, `backend`, `frontend`, `engines.node: ">=24"`, and scripts `build`, `typecheck`, `lint`, `test`, `format`, `generate`.
- [x] T002 [P] Add root `.gitignore`, `.editorconfig`, `.nvmrc` (`24`), `.node-version`; ignore `node_modules`, `dist`, `out`, `cache`, `broadcast`, `.env*`, `coverage`, `.turbo` (`./.gitignore`).
- [x] T003 [P] Add `.prettierrc.json` + `.prettierignore` at repo root (single quotes, trailing comma `all`, printWidth 100) covering TS, JSON, MD, YAML (`./.prettierrc.json`).
- [x] T004 [P] Add `eslint.config.js` flat config at repo root (typescript-eslint type-checked, react-hooks, import/order); the only accepted invocation is `--max-warnings 0`.
- [x] T005 [P] Add `contracts/.solhint.json` (compiler-version, custom-errors, explicit-types, no-unused-import) plus `contracts/.solhintignore`.
- [x] T006 Create `.github/workflows/ci.yml` with jobs `contracts` (fmt --check, build, test, coverage gate), `backend` (typecheck, lint, test), `frontend` (typecheck, lint, test, build), `secret-scan`; any warning or skipped test fails the run.
- [x] T007 Initialise Foundry in `contracts/` and set `contracts/foundry.toml`: `solc = "0.8.29"`, optimizer 200 runs, `fuzz.runs = 512`, `invariant.runs = 256`, `fs_permissions` for reading the shared manifest.
- [x] T008 Pin `forge-std`, `Reactive-Network/reactive-lib` (exact commit), and `openzeppelin-contracts` (exact tag) in `contracts/remappings.txt`; record both pins in `docs/decisions/0001-record-architecture-decisions.md`.
- [x] T009 Create `packages/shared/package.json` (ESM, `exports`, scripts `generate`/`build`/`test`/`typecheck`) and `packages/shared/tsconfig.json` (`strict`, `noUncheckedIndexedAccess`, `composite`).
- [x] T010 Create `backend/package.json` + `backend/tsconfig.json` with `fastify`, `@fastify/cors`, `zod`, `viem`, `@supabase/supabase-js`, `pino`, `tsx`, `vitest`; scripts `dev`, `build`, `start`, `test`, `migrate`, `reindex`, `verify:reconcile`.
- [x] T011 Scaffold `frontend/` with Vite + React + TypeScript; add `wagmi`, `viem`, `@tanstack/react-query`, `react-router`, `@dnd-kit/core`, `@dnd-kit/sortable`, `zod`; confirm the naked scaffold builds.
- [x] T012 [P] Add Tailwind to `frontend/` with `frontend/tailwind.config.ts` and `frontend/src/styles/tokens.css`; define semantic tokens for the automation network and the funds network used by every badge.
- [x] T013 [P] Write `contracts/.env.example`, `backend/.env.example`, `frontend/.env.example`; label every variable `PUBLIC` or `SECRET` and state that only `VITE_*` values may cross into the bundle.
- [x] T014 [P] Write `docs/decisions/0001-record-architecture-decisions.md` (context, decision, consequence) covering the monorepo split and the pinned library versions.
- [x] T015 [P] Create `deployments/README.md` and empty `deployments/lasna.json` + `deployments/unichain-sepolia.json` with the required record shape: chain ID, address, contract name, commit SHA, deployer, explorer link, timestamp.
- [x] T016 [P] Write the `README.md` skeleton with Constitution V's mandatory sections: architecture, cost model, custody model, "the indexer cannot move funds", local setup, deployment (`./README.md`).
- [x] T017 [P] Add `husky` + `lint-staged` at repo root running Prettier and ESLint on staged files only (`./package.json`).
- [x] T018 Provision the Supabase project; record URL, region, free-plan pause rule, and the 500 MB cap in `docs/decisions/0002-supabase-project.md` — never a key.
- [x] T019 Create the Heroku app on the **Basic** tier (`heroku ps:type web=basic`): Eco dynos sleep after 30 idle minutes and would silently stop the indexer; record the app name in `README.md` (`./README.md`).
- [x] T020 Create and link the Vercel project; add `frontend/vercel.json` with the SPA rewrite to `/index.html` and build command `npm run build -w frontend`.
- [x] T021 [P] Install Playwright at repo root (`@playwright/test`) and add `playwright.config.ts` targeting `frontend/e2e` with a local `webServer`.
- [x] T022 [P] Add root `scripts/check.mjs` running the full local gate in order (fmt, build, test, coverage, typecheck, lint, secret scan) and exiting non-zero on the first failure.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: contract skeleton, generated shared package, indexer/API shell, frontend shell. **No user story may start until this phase is green.**

### 2A. Contracts core (T023–T042)

- [x] T023 Create `contracts/src/shared/Errors.sol` with every custom error from `contracts/onchain-interfaces.md` §1 verbatim — no revert strings anywhere in `contracts/src/`.
- [x] T024 [P] Write failing tests first for reserve→price math, slippage, and scale rounding in `contracts/test/unit/PriceMath.t.sol` (price scaled 1e18; `scaleBps` rounds down; zero-reserve reverts).
- [x] T025 Implement `contracts/src/libraries/PriceMath.sol` until T024 is green: `priceFromReserves`, `expectedOut`, `applySlippage`, `scaleAmount`.
- [x] T026 [P] Write failing tests first for struct packing and validation in `contracts/test/unit/RuleLib.t.sol`, covering every rule in `data-model.md` §1.1: `template ∈ 1..13`, `amountIn > 0` for money templates and `== 0` for alert templates, `threshold > 0` for threshold templates, `pair != 0` for price templates, `tokenOut != 0` for swap templates, `secondary` bounds (trailing ≤ 10000 bps, inactivity 1..365 days).
- [x] T027 Implement `contracts/src/libraries/RuleLib.sol` (pack/unpack into the 8-slot layout from `data-model.md` §1.1, `validate`, `paramsHash`) until T026 is green.
- [x] T028 [P] Create `contracts/src/chain/ChainConfig.sol`: the single per-chain constant module keyed by chain ID (system contract, callback proxy, router, WETH, USDC, pair) for `5318007` and `1301` only; no address literal may appear anywhere else in `src/`.
- [x] T029 [P] Build the mock suite in `contracts/test/mocks/`: `MockSystemContract` (records `requestCallbackV_1_0`, serves a settable `getCallbacks` array, tracks `reserves`/`debt`), `MockPair` (real `getReserves`, settable, emits `Sync`), `MockRouter`, `MockERC20`, `MockCallbackProxy`.
- [x] T030 [P] Write failing tests first in `contracts/test/unit/Agent.t.sol`: `react()` rejects non-system caller, `addRule` rejects non-owner, rule limit of 5 reverts `RuleLimitReached`, `RuleCreated` emitted with correct `template`, `getRuleIds()` returns evaluation order.
- [x] T031 Implement `contracts/src/agent/Agent.sol` storage, `addRule` with full `RuleLib.validate`, `pauseRule`/`resumeRule`/`cancelRule`/`resetRule`/`reorderRules`/`linkVault` skeletons, and all views from `contracts/onchain-interfaces.md` §2 until T030 is green.
- [x] T032 [P] Write failing tests first in `contracts/test/unit/Vault.t.sol`: wrong proxy sender reverts `NotServiceProvider`; wrong first argument reverts `CallbackSenderMismatch`; non-owner `withdraw` reverts; `setLimits` enforces allowlist; `paused` blocks `execute` but not `withdraw`; `Balances` emitted after deposit and withdraw.
- [x] T033 Implement `contracts/src/vault/Vault.sol` inheriting Reactive's `AbstractCallback` with `constructor(IPayable proxy, address agent, address router)` restrictions, plus `withdraw`, `setPayoutAddress`, `setLimits`, `setPaused`, `principalOf`, and the `execute` skeleton until T032 is green.
- [x] T034 [P] Write failing tests first in `contracts/test/unit/VaultFactory.t.sol`: deploy requires an existing agent, owner is set to the user, `vaultOf(owner)` is populated, a second deploy for the same `(owner, chainId)` reverts `AgentAlreadyLinked`, `VaultDeployed` emitted.
- [x] T035 Implement `contracts/src/vault/VaultFactory.sol` until T034 is green.
- [x] T036 [P] Write failing tests first in `contracts/test/unit/AgentFactory.t.sol`: one agent per owner, owner set to the user, `agentOf` populated, `AgentDeployed` emitted, redeploy reverts.
- [x] T037 Implement `contracts/src/agent/AgentFactory.sol` until T036 is green.
- [x] T038 [P] Write failing tests first in `contracts/test/unit/RuleRegistry.t.sol`: only the listing author may `list`/`delist`, `paramsHash` is stable for identical params, `listingCount` increments, and no function on the contract can move funds or call a vault.
- [x] T039 Implement `contracts/src/registry/RuleRegistry.sol` until T038 is green.
- [x] T040 Write `contracts/test/integration/Onboarding.t.sol` proving factory → agent → vault → registry wiring end to end against the mocks from T029.
- [x] T041 Write `contracts/script/Deploy.s.sol` deploying both factories and the registry, reading addresses from `ChainConfig`, and writing `deployments/{lasna,unichain-sepolia}.json` entries with chain ID, address, contract name, commit SHA, deployer, explorer link.
- [x] T042 Add `contracts/.gas-snapshot` (`forge snapshot`) and `scripts/coverage-gate.mjs` asserting ≥90% branch coverage on `Agent`, `Vault`, `AgentFactory`, `VaultFactory`, `RuleRegistry`; wire both into the CI job from T006.

### 2B. Shared package (T043–T052)

- [x] T043 Write `packages/shared/manifest/templates.json` declaring all 13 templates from `spec.md` §5 with `id`, `name`, `category` (`trading`/`personal`/`alert`), `trigger`, `condition`, `action`, `sentence`, and `slots[]` (key, kind, label, required, min, max, unit) — including the documented caveats: #2 has no indicators, #6 is a price band not a portfolio ratio, #9 listens to `Balances`, #12 watches a price range not a V3 position.
- [x] T044 Write `packages/shared/scripts/generate.ts` emitting `packages/shared/src/generated/templates.ts`, `contracts/src/libraries/TemplateCatalog.sol`, `docs/catalog.md`'s table, and `contracts/test/templates/fixtures.generated.ts` from the single manifest.
- [x] T045 [P] Write `packages/shared/test/generate.test.ts` asserting the generator is idempotent (second run produces byte-identical output) and that the manifest validates against its JSON schema, with 13 unique ids and every slot reachable.
- [x] T046 Create `packages/shared/src/chains.ts`: typed per-chain config keyed by chain ID (name, role, RPC default, explorer URL, router, WETH, USDC, pair, callback proxy, system contract) for `5318007` and `1301`, plus `supportedTemplates` per chain.
- [x] T047 [P] Write `packages/shared/src/schemas.ts` with zod schemas for `Address`, `TxHash`, `Uint256` (decimal string → `bigint`, reject > `2^256-1`), `Rule`, `Execution`, `Proof`, `Listing`, `Account`, `SponsorStatus`, `Health`; export inferred TS types only — no hand-written duplicates.
- [x] T048 Write `packages/shared/scripts/copy-abis.ts` copying `contracts/out/**/*.json` ABIs into `packages/shared/src/abi/` and generating a typed `index.ts`; add a CI check that the committed ABIs match a fresh build.
- [x] T049 Write `packages/shared/src/encode.ts`: `encodeAddRule(agentAddress, draft)` via viem `encodeFunctionData`, `readableSentence(draft)`, and `missingSlots(draft)`; reject free-text and unknown slot keys; reject `tokenIn == tokenOut`.
- [x] T050 [P] Write `packages/shared/test/encode.test.ts` with golden calldata per template (13 cases), a missing-slot case per template, a conflicting-slot case, and a guarantee that no encoding path accepts an unvalidated string.
- [x] T051 [P] Write `contracts/test/unit/TemplateCatalog.t.sol` asserting the generated Solidity constants equal `packages/shared/manifest/templates.json` (parameter counts, ids, categories) so a manifest edit cannot silently desynchronise the contract.
- [x] T052 [P] Write `packages/shared/manifest/seed-rules.json` with 3–4 team-authored public rules (DCA, limit buy, stop loss, price alert), each flagged `authorBadge: "team"`.

### 2C. Backend shell and indexer spine (T053–T072)

- [x] T053 Write `backend/src/config.ts` parsing every env var with zod (`PORT`, `NODE_ENV`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `LASNA_RPC_URL`, `UNICHAIN_RPC_URL`, `INDEXER_ENABLED`, `INDEXER_START_BLOCK_LASNA`, `INDEXER_START_BLOCK_UNICHAIN`, `SPONSOR_PRIVATE_KEY`), failing fast with a readable list of missing vars.
- [x] T054 [P] Write `backend/db/migrations/0001_init.sql` creating every table and index from `data-model.md` §2 with its constraints verbatim: `rules.status` CHECK in (`active`,`paused`,`cancelled`), PK `(agent, rule_id)`, PK `(chain_id, tx_hash, log_index)`, PK `(reactive_tx_hash, callback_index)`, `mirrors.scale_bps <= 10000`, `mirrors.hourly_cap BETWEEN 1 AND 10`.
- [x] T055 Write `backend/scripts/migrate.ts` applying `db/migrations/*.sql` in order against Supabase (and a local Postgres for tests) with a `schema_migrations` table; expose `npm run migrate`.
- [x] T056 Write `backend/src/db/client.ts` creating the service-role Supabase client (server only) plus a `probeDatabase()` used by health and the keep-alive job.
- [x] T057 Write `backend/src/chain/clients.ts` with viem clients for Lasna and Unichain Sepolia using fallback transports (primary + documented alternate RPC) and chain-scoped helpers.
- [x] T058 Write `backend/src/server.ts` bootstrapping Fastify: pino logger, CORS allowlist from config, request ids, zod validation, and a global error handler emitting the `Error` schema from `contracts/http-api.yaml` with the underlying chain error preserved.
- [x] T059 Write `backend/src/api/routes/health.ts` returning indexer enabled state, lag seconds, per-chain cursors, database reachability, `paused_hint`, and per-chain RPC health.
- [x] T060 Write `backend/src/api/routes/chains.ts` returning chains and the template catalog from `packages/shared`.
- [x] T061 [P] Write `backend/test/api/contract.test.ts` validating every response against the zod schemas and asserting the route set equals the paths declared in `contracts/http-api.yaml`.
- [x] T062 Write `backend/src/indexer/cursors.ts`: get/set per-chain cursor with block hash, guarded against regression beyond confirmation depth.
- [x] T063 Write `backend/src/indexer/poller.ts`: cursor-driven `getLogs` in bounded ranges, confirmation depth 12 (Unichain) and 20 (Lasna), exponential backoff, graceful shutdown, and in-flight range protection on restart.
- [x] T064 Write `backend/src/indexer/decoders/index.ts` mapping `topic0` → decoder for every event in `contracts/onchain-interfaces.md` §8, each decoded then validated by a zod schema before any write.
- [x] T065 [P] Write `backend/test/indexer/idempotency.test.ts` replaying the same log fixture twice and asserting one row, plus a reorg fixture that removes a row whose tx no longer exists.
- [x] T066 Write repositories in `backend/src/db/repositories/` (agents, vaults, rules, rule_events, executions, callbacks, mirrors, listings, price_observations, sponsor_ledger) with idempotent upserts on the keys from `data-model.md` §2.
- [x] T067 Write `backend/src/indexer/backfill.ts` and `npm run reindex` to truncate derived tables, reset cursors to the configured start blocks, and replay — the Constitution V runbook must be executable by this command.
- [x] T068 Write `backend/scripts/reconcile.ts` (`npm run verify:reconcile`) comparing each rule's `runs` against `count(executions)` and exiting non-zero on any mismatch.
- [x] T069 Create the `dead_letter` table migration and write path in `backend/src/indexer/deadLetter.ts`; surface the count in `/health` so an undecodable log is never silently dropped.
- [x] T070 [P] Write `backend/src/jobs/keepalive.ts` performing a real `SELECT` against a table (not an RPC returning a constant) once per day, plus the Heroku Scheduler entry in `docs/runbooks/top-up-reserves.md`… keep-alive instructions live in `docs/decisions/0002-supabase-project.md`.
- [x] T071 Add `backend/Procfile` (`web: node dist/server.js`) and `heroku-postbuild` building `packages/shared` then `backend`; bind `0.0.0.0:$PORT` and verify a Heroku deploy serves `/health`.
- [x] T072 Write `backend/src/api/middleware/errorMap.ts` translating contract custom-error selectors into `{code, message, detail}` while preserving the raw selector (FR-051), and unit-test it against the selectors in `contracts/src/shared/Errors.sol`.

### 2D. Frontend shell (T073–T083)

- [x] T073 Write `frontend/src/lib/wagmi.ts`: two-chain config (Lasna `5318007`, Unichain Sepolia `1301`), injected + WalletConnect connectors (`VITE_WALLETCONNECT_PROJECT_ID`), and chain-scoped write helpers that refuse a write on the wrong chain.
- [x] T074 Write `frontend/src/lib/api.ts`: typed fetch wrapper that parses every response with the zod schemas from `packages/shared`, throws an `ApiError` carrying `code`/`detail`/HTTP status, and never casts with `any`.
- [x] T075 Write `frontend/src/main.tsx` and `frontend/src/app/router.tsx` with the eight routes from `plan.md`: `/`, `/create`, `/rules/:agent/:ruleId`, `/proof/:reactiveTxHash`, `/marketplace`, `/leaderboard`, `/account`, `/cost`.
- [x] T076 Write `frontend/src/components/AppShell.tsx`: header, wallet connect/disconnect, active-network indicator, nav, and the footer line stating that the operator never holds custody.
- [x] T077 [P] Write `frontend/src/components/NetworkBadge.tsx` reading labels from `packages/shared/src/chains.ts`; the same component is used on every signature surface.
- [x] T078 [P] Write `frontend/src/components/TxLink.tsx` building explorer URLs from the per-chain config only — no hard-coded explorer hosts in components.
- [x] T079 [P] Write `frontend/src/components/StatusPill.tsx` rendering `active`, `paused`, `cancelled`, `latched`, `silent` (budget exhausted) with distinct styling; `latched` and `silent` must never look like `active`.
- [x] T080 [P] Write `frontend/src/components/BalanceTrio.tsx` showing principal, funds-side execution cost, and watching-side credit as three separately labelled figures (FR-008) — the component has no API for merging them.
- [x] T081 [P] Write `frontend/src/components/ErrorState.tsx` + `frontend/src/app/ErrorBoundary.tsx` rendering the chain selector next to a plain-language message (FR-051).
- [x] T082 [P] Configure `frontend/src/lib/queryClient.ts` (TanStack Query defaults: 30s stale for chain reads, no retry on 4xx, retry twice on 5xx).
- [x] T083 Write `frontend/test/deeplink.test.ts` asserting the `vercel.json` rewrite serves `/proof/:hash` and `/rules/:agent/:id` to `index.html`.

---

## Phase 3: User Story 1 — Create a personal automation account I actually own (Priority: P1) 🎯 MVP

**Goal**: one guided flow creates the user's Agent (Lasna) and Vault (Unichain Sepolia), both owned by the user, funded for execution by the sponsor; setup is resumable and principal is withdrawable without anyone's permission.

**Independent Test**: from a fresh wallet with only test funds, complete setup, confirm both contracts exist and report the user as owner, create no rule, then withdraw the full principal. The withdrawal needs no operator action — that is the custody proof (SC-006).

### Tests for User Story 1 ⚠️ (write first, confirm each fails)

- [x] T084 [P] [US1] Contract test `contracts/test/integration/Onboarding.t.sol`: agent is deployed before vault; `VaultFactory.deploy` reverts without an agent; `linkVault` is owner-only; `vault.agent() == agent`; an unlinked vault rejects `execute`.
- [x] T085 [P] [US1] Contract test: a second `VaultFactory.deploy` for the same `(owner, chainId)` reverts `AgentAlreadyLinked`, proving retry cannot duplicate (FR-004) (`contracts/test/unit/VaultFactory.t.sol`).
- [x] T086 [P] [US1] Contract test: owner withdraws the full principal; a non-owner reverts `NotOwner`; withdrawal still works while `paused`; `Withdrawn` + `Balances` emitted (`contracts/test/unit/Vault.t.sol`).
- [x] T087 [P] [US1] Contract test against `MockSystemContract`: `depositTo(target)` credits the target from any caller, and a plain transfer without a target does not (the stranding case in `IDEA.md` §12) (`contracts/test/unit/Sponsorship.t.sol`).
- [x] T088 [P] [US1] Frontend test `frontend/test/onboarding.test.tsx`: `setup_state: agent_only` renders a resume action, and resuming issues only the vault step.

### Implementation for User Story 1

- [x] T089 [US1] Finalise `Agent.linkVault` (owner-only, one vault per chain ID, emits `VaultLinked`) and the guard in `Vault.execute` that refuses an unlinked agent (`contracts/src/agent/Agent.sol`).
- [x] T090 [US1] Finalise `Vault.withdraw` (full/partial, owner-only, allowed while paused, updates `principalOf`, emits `Withdrawn` then `Balances`) and `setPayoutAddress`.
- [x] T091 [US1] Write `backend/src/sponsor/relayer.ts`: a sponsor key restricted by a selector allowlist to `AgentFactory.deploy`, `VaultFactory.deploy`, `depositTo`, the Lasna gas top-up transfer, and the fixed demo-token transfer; any other call throws `SelectorNotAllowed` before signing.
- [x] T092 [US1] Write `docs/decisions/0003-sponsor-relayer-key.md`: what the key can do, what it provably cannot do (no owner role on any Vault, no withdraw), where it lives, caps, rotation, and revocation.
- [x] T093 [US1] Implement `POST /v1/onboarding` in `backend/src/api/routes/onboarding.ts`: idempotent, resumable, per-address rate limit, returns `setup_state` plus per-step status and tx hashes.
- [x] T094 [US1] Implement `POST /v1/starter-funds` in `backend/src/api/routes/starterFunds.ts`: capped amounts, refuses a `vault` not owned by `owner`, returns 409 on a repeat claim.
- [x] T095 [US1] Add `starter_funds` claim tracking (migration + repository) so starter funds are once per address, with the cap constants in one place (`backend/db/migrations/0003_starter_funds.sql`).
- [x] T096 [US1] Add indexer decoders for `AgentDeployed` and `VaultDeployed`, writing `agents` and `vaults` rows including `owner`, `agent`, `chain_id`, `created_tx` (`backend/src/indexer/decoders/index.ts`).
- [x] T097 [US1] Implement `GET /v1/accounts/:agent` deriving `setup_state` (`none`/`agent_only`/`partial`/`complete`) from `agents`, `vaults`, and the on-chain link.
- [x] T098 [US1] Build `frontend/src/pages/CreateAccount.tsx`: connect → create → starter funds → done, with each step showing its network badge and result link.
- [x] T099 [US1] Write `frontend/src/hooks/useAccountSetup.ts`: query `setup_state`, resume the missing step, poll until confirmed, and never restart a completed step.
- [x] T100 [US1] Build `frontend/src/pages/Account.tsx`: three-balance display from `BalanceTrio`, contract addresses with explorer links, per-network labels.
- [x] T101 [US1] Build the withdraw flow in `frontend/src/components/WithdrawForm.tsx`: amount, destination confirmation, Unichain signature, tx link, and a success state that requires the destination confirmation (never a Lasna receipt).
- [x] T102 [P] [US1] RTL tests: withdraw form validation, three balance labels never merged, withdraw disabled when principal is zero (`frontend/test/withdraw.test.tsx`).
- [x] T103 [US1] Playwright `frontend/e2e/onboarding.spec.ts` against anvil + fixture backend: create account, assert both addresses appear, withdraw, assert balance zero.
- [x] T104 [US1] Write `docs/decisions/0004-two-deployment-onboarding.md` covering why onboarding is two deployments, the ordering invariant, and the resume strategy.

---

## Phase 4: User Story 2 — Build a rule by assembling a sentence (Priority: P1) 🎯 MVP

**Goal**: the user builds any rule by choosing values in slots, reads it as a sentence, sees the exact transaction the rule will create, and signs once.

**Independent Test**: build a weekly 10-USDC buy of ETH using only selections, sign once, and confirm the rule appears active with those exact values — with no free-text, code, or prompt field anywhere in the flow.

### Tests for User Story 2 ⚠️ (write first, confirm each fails)

- [ ] T105 [P] [US2] Composer reducer tests `frontend/test/composer.reducer.test.ts`: for all 13 templates, setting a slot mutates exactly one parameter; clearing a required slot marks it missing; changing template resets incompatible slots.
- [ ] T106 [P] [US2] Calldata parity test: the client-side encoder and `POST /v1/encode/preview` produce byte-identical `data` for the same draft across all 13 templates (uses the fixtures from T050).
- [ ] T107 [P] [US2] Contract test: `addRule` stores every parameter exactly as supplied, emits `RuleCreated` with the right `template`, and adds the topic subscription once (via `MockSystemContract` call count) (`contracts/test/unit/Agent.t.sol`).
- [ ] T108 [P] [US2] Contract test: `addRule` reverts `RuleLimitReached` at the sixth active rule, `ExceedsPerRunCap` above the vault ceiling, `UnknownTemplate` for id 14, `InvalidTemplateParams` when `tokenOut` is missing on a swap template (`contracts/test/unit/Agent.t.sol`).

### Implementation for User Story 2

- [ ] T109 [US2] Write `frontend/src/composer/types.ts`: a discriminated union over the generated `TemplateId`, where each member declares its required slots — the type makes an incomplete rule unrepresentable for money templates.
- [ ] T110 [US2] Write `frontend/src/composer/reducer.ts` with `selectTemplate`, `setSlot`, `clearSlot`, `reset`, and `canSign` derived from `missingSlots`.
- [ ] T111 [US2] Build `frontend/src/composer/ChipPalette.tsx`: value chips grouped by slot kind (schedule, amount, token, price, percent, duration, address), sourced from the manifest.
- [ ] T112 [US2] Build `frontend/src/composer/SentenceCanvas.tsx`: `DndContext` + `SortableContext` with keyboard sensors, rendering slots inline in trigger → condition → action order.
- [ ] T113 [US2] Build `frontend/src/composer/SlotChip.tsx`: droppable slot with `aria-label`, drag handle, keyboard move support, and an invalid-state style driven by validation.
- [ ] T114 [US2] Build `frontend/src/composer/LiveCalldata.tsx`: memoised `encodeAddRule`, 50 ms debounce, copy button, and the target contract address labelled by network.
- [ ] T115 [US2] Write `frontend/src/composer/validation.ts` delegating to the manifest slot rules from `packages/shared` (min/max, integer-only amounts, price scale) and returning per-slot messages.
- [ ] T116 [US2] Build `frontend/src/pages/Create.tsx` wiring palette, sentence, validation, live calldata, and the create action into one screen.
- [ ] T117 [US2] Write `frontend/src/hooks/useCreateRule.ts`: simulate with `eth_call` first, surface the decoded custom error on failure, then send the Lasna write and wait for the receipt; distinguish simulated-failure from wallet-rejection.
- [ ] T118 [US2] Implement `POST /v1/encode/preview` in `backend/src/api/routes/encode.ts` returning `to`, `data`, `readable_sentence`, `missing_slots`, and 422 when the draft is incomplete (FR-017).
- [ ] T119 [US2] Add indexer handling for `RuleCreated` → upsert into `rules` with `status: active`, increment `agents.rule_count`, write a `rule_events` row (`backend/src/indexer/decoders/index.ts`).
- [ ] T120 [US2] Implement `GET /v1/accounts/:agent/rules` (evaluation order, `status` filter) and `GET /v1/accounts/:agent/rules/:ruleId` (rule + recent executions) in `backend/src/api/routes/rules.ts`.
- [ ] T121 [US2] Build `frontend/src/pages/Home.tsx`: rule list ordered by on-chain evaluation order, each row showing status pill, run count, last run, remaining budget.
- [ ] T122 [US2] Build `frontend/src/pages/RuleDetail.tsx`: parameters rendered back as the same sentence, execution table, and actions slot.
- [ ] T123 [P] [US2] RTL test: pressing create with a missing amount blocks submission, highlights the amount slot, and names it (`frontend/test/create.validation.test.tsx`).
- [ ] T124 [US2] Playwright `frontend/e2e/compose-dca.spec.ts`: drag chips into a DCA sentence, assert the calldata equals the fixture, sign (mock wallet), assert the success state.
- [ ] T125 [US2] Accessibility pass on the composer: complete a rule with keyboard only; add an axe check over `/create` with zero violations.
- [ ] T126 [US2] Write `frontend/src/lib/errors.ts` mapping every selector from `contracts/src/shared/Errors.sol` to a plain-language message while preserving the selector for display.
- [ ] T127 [US2] Add `frontend/src/components/CreateSuccess.tsx`: rule id, sentence, tx link, and next actions (view rule, build another).
- [ ] T128 [US2] Add empty and loading states for `/`, `/rules/:agent/:ruleId`, and the rule list (no blank screens, no layout shift).
- [ ] T129 [P] [US2] Unit test: a draft with `tokenIn == tokenOut`, zero amount, or an out-of-range percent is rejected before any encoding happens (`packages/shared/test/encode.test.ts`).
- [ ] T130 [US2] Write `docs/composer.md` describing the sentence model, why it is not a canvas (`IDEA.md` §14), and the chip → calldata mapping with two worked examples.

---

## Phase 5: User Story 3 — See proof that the loop actually ran (Priority: P1) 🎯 MVP

**Goal**: for any execution, a proof view links the originating event, the automation-side transaction, and the funds-side transaction, with one latency figure, built from chain state rather than our database.

**Independent Test**: open a known execution's proof view, follow all three links to public explorers, then load the same view with the backend stopped and confirm it still renders (SC-005).

### Tests for User Story 3 ⚠️ (write first, confirm each fails)

- [ ] T131 [P] [US3] Contract test: `react()` emits `RuleEvaluated` with `originChainId`, `originTxHash`, and `originLogIndex` copied from the `LogRecord` — for a rule that fired and for one that did not (`contracts/test/unit/Agent.t.sol`).
- [ ] T132 [P] [US3] Backend test `backend/test/api/proofs.test.ts`: chain-first read succeeds and returns `source: chain`; RPC failure returns `source: cache` with `cache_age_seconds`; both unavailable returns 503; an empty `getCallbacks` array returns 404 rather than a fake success.
- [ ] T133 [P] [US3] RTL test: the proof page renders three rows with roles, block times, explorer links, and exactly one latency value; a refused execution shows the selector plus a plain-language reason and no success state (`frontend/test/proof.test.tsx`).

### Implementation for User Story 3

- [ ] T134 [US3] Emit `RuleEvaluated` in `Agent.react()` for every rule evaluated (fired or not), copying the origin `chainId`/`txHash`/`logIndex` from `LogRecord` — this is what supplies the origin row `getCallbacks` cannot (`contracts/onchain-interfaces.md` §2 provenance).
- [ ] T135 [US3] Write `backend/src/chain/lasnaCallbacks.ts` reading `getCallbacks(uint256)` with the tuple ABI `(uint256,address,uint256,uint256,uint256,bytes)[]` from `packages/shared`, decoding into `CallbackRecord` with a zod schema.
- [ ] T136 [US3] Implement `GET /v1/proofs/:reactiveTxHash` in `backend/src/api/routes/proofs.ts`: join `RuleEvaluated` (origin) → receipt hash (reactive) → `getCallbacks` (destination) → destination tx from the Unichain RPC; compute `latency_ms` from origin block time to destination block time.
- [ ] T137 [US3] Add the `callbacks` cache write path with TTL, `source`, and `cache_age_seconds`; never present a cached proof as live (`backend/src/api/routes/proofs.ts`).
- [ ] T138 [US3] Add indexer persistence for `RuleEvaluated` → `rule_events` rows carrying `origin_tx`, `origin_log_index`, and `fired` (`backend/src/indexer/decoders/index.ts`).
- [ ] T139 [US3] Build `frontend/src/pages/Proof.tsx`: three rows, one latency figure, a `source` badge when cached, and a copyable reactive tx hash.
- [ ] T140 [US3] Build `frontend/src/components/ProofRow.tsx`: role label, chain badge, block number, timestamp, explorer link, and an `error` detail block that keeps the raw selector visible.
- [ ] T141 [US3] Wire the deep link `/proof/:reactiveTxHash` and confirm the Vercel rewrite from T083 serves it in a preview deployment.
- [ ] T142 [US3] Write `frontend/src/hooks/useProof.ts` distinguishing 404 (validators have not written the record yet), 503 (both sources down), and cached responses, each with distinct copy.
- [ ] T143 [US3] Playwright `frontend/e2e/proof.spec.ts`: render a proof from a fixture with three rows, assert the latency value and that all links carry the correct explorer host per chain.
- [ ] T144 [US3] Build `frontend/src/components/ChainOnlyProof.tsx`, a documented fallback that reads `getCallbacks` from the browser if the backend is unreachable during judging; hidden behind `VITE_ENABLE_CHAIN_ONLY_PROOF`.
- [ ] T145 [US3] Build `frontend/src/components/ExecutionTable.tsx` linking each execution row to its proof view by reactive tx hash.
- [ ] T146 [US3] Backend test: a callback record with non-empty `error_data` surfaces the selector and human message and is never reported as a successful run (FR-031, FR-051) (`backend/test/api/proofs.test.ts`).
- [ ] T147 [US3] Run quickstart V4 on testnet: capture 10 end-to-end latencies and write them with tx hashes to `docs/measurements.md`.
- [ ] T148 [US3] Write `docs/decisions/0005-chain-first-proof.md` recording why the proof endpoint reads chain first and what `cached: true` promises the user.

---

## Phase 6: User Story 4 — Stay in control of what runs and what it may spend (Priority: P1) 🎯 MVP

**Goal**: the user can pause, resume, cancel, and reorder rules, sees run counts and remaining budget, and is warned before the account goes silent.

**Independent Test**: create a rule, pause it before its next window, confirm nothing executes, resume, reorder two rules and confirm the order survives a reload, then drive the budget low and confirm the warning appears before execution stops.

### Tests for User Story 4 ⚠️ (write first, confirm each fails)

- [ ] T149 [P] [US4] Contract test `contracts/test/unit/AgentControl.t.sol`: pause/resume/cancel transitions emit `RulePaused`/`RuleCancelled`; pausing the last rule needing a topic calls `unsubscribe` exactly once; resuming re-subscribes; cancelling releases references (FR-029).
- [ ] T150 [P] [US4] Contract test: `reorderRules` is owner-only, rejects a duplicate or unknown id, persists `getRuleIds()`, and evaluation honours the new order (`contracts/test/unit/AgentControl.t.sol`).
- [ ] T151 [P] [US4] Contract test: with many eligible rules, `react()` stops before breaching the 900k ceiling, emits `EvaluationDeferred` for those not reached, and still does not revert (`contracts/test/unit/AgentControl.t.sol`).
- [ ] T152 [P] [US4] Contract test: the per-run ceiling and the per-user monthly cap each revert with their own error, and a rule cannot exceed `maxSpendPerRun` even when the vault holds more (`contracts/test/unit/AgentControl.t.sol`).
- [ ] T153 [P] [US4] RTL test: pressing pause updates the status pill within one render cycle; a failed reorder rolls back the visual order and shows the error (`frontend/test/control.test.tsx`).

### Implementation for User Story 4

- [ ] T154 [US4] Implement `pauseRule`/`resumeRule`/`cancelRule` in `Agent.sol` with the per-topic reference counter and `subscribe`/`unsubscribe` calls on the system contract (never from `react()`).
- [ ] T155 [US4] Implement `reorderRules` with a full-permutation check and keep `getRuleIds()` as the single source of evaluation order (`contracts/src/agent/Agent.sol`).
- [ ] T156 [US4] Implement budget accounting in `Agent.sol`: per-rule execution counter, per-user monthly cap, `BudgetLow` emission at the documented threshold (`contracts/src/agent/Agent.sol`).
- [ ] T157 [US4] Add the gas guard in `react()`: estimate per-rule cost, stop before the ceiling, defer the remainder, and never let one rule's revert abort the loop (`contracts/src/agent/Agent.sol`).
- [ ] T158 [US4] Extend the rule detail API response with budget fields and the sponsor state so the UI needs no second call (`backend/src/api/routes/rules.ts`).
- [ ] T159 [US4] Implement `GET /v1/sponsor/:agent` in `backend/src/api/routes/sponsor.ts` reading `reserves`/`debt` on both proxies and deriving `healthy`/`low`/`exhausted`/`debt`.
- [ ] T160 [US4] Build `frontend/src/components/RuleOrderList.tsx`: dnd-kit sortable list whose drop submits `reorderRules`, with keyboard reordering and an explicit “runs first” affordance.
- [ ] T161 [US4] Build `frontend/src/components/RuleActions.tsx`: pause/resume/cancel with a confirmation for cancel, optimistic status, and rollback on revert.
- [ ] T162 [US4] Build `frontend/src/components/BudgetMeter.tsx`: remaining credit, threshold marker, and `low`/`exhausted`/`debt` states that never render as `active`.
- [ ] T163 [US4] Add the at-risk banner to `/` and rule detail with top-up instructions (permissionless `depositTo`, including the target-address caveat).
- [ ] T164 [US4] Add indexer handling for `RulePaused`/`RuleCancelled` updating `rules.status`, `latched`, and writing `rule_events` rows.
- [ ] T165 [US4] Playwright `frontend/e2e/control.spec.ts`: pause suppresses the next simulated window, and a reorder survives a page reload.
- [ ] T166 [US4] Write `docs/runbooks/pause-cancel-a-rule.md` executable by a teammate who did not write it.

---

## Phase 7: User Story 5 — Choose from a small, honest catalog of rule types (Priority: P2)

**Goal**: all 13 templates work through one engine, each read as one plain sentence, with prices labelled as last traded price and schedules as approximate.

**Independent Test**: build and run all 13 templates; confirm each renders a complete sentence, each distinct preview, and that the three alert templates move zero funds across their full validation.

### Tests and engine work for User Story 5

- [ ] T167 [US5] Implement the price cache and topic reference counting in `Agent.sol`: `cachedPrice`/`cachedPriceAt` updated only from the latest `Sync`, plus a single `topicKey` counter driving subscribe/unsubscribe.
- [ ] T168 [P] [US5] Test the cache: a newer `Sync` replaces the value, an older one is ignored, `cachedPriceAt` matches the observation block time, and a quiet pair keeps its stale value rather than zeroing (`contracts/test/unit/Agent.t.sol`).
- [ ] T169 [US5] Implement cron gating against `Cron10000` (timestamp window) with tests proving a tick inside the window fires once and a tick outside does not (`contracts/src/agent/Agent.sol`).
- [ ] T170 [P] [US5] Write failing tests for the Vault's transfer path: `SafeERC20.transfer` for personal templates, `transferFrom` for the balance-floor template, allowance failure surfaces as `TransferFailed`, and `Balances` is emitted after each (`contracts/test/unit/Vault.t.sol`).
- [ ] T171 [US5] Implement the transfer path in `Vault.sol` until T170 is green (`contracts/src/vault/Vault.sol`).
- [ ] T172 [P] [US5] Write failing tests that the Vault refuses alert-only templates with `AlertOnlyTemplate` and never reaches a token transfer (`contracts/test/unit/Vault.t.sol`).
- [ ] T173 [US5] Implement the alert-only guard in `Vault.execute` until T172 is green (`contracts/src/vault/Vault.sol`).
- [ ] T174 [P] [US5] Write failing tests for quote-at-execution: `amountOutMin` derives from live reserves, a reserve move between decision and execution reverts `SlippageExceeded`, and the cached price is never used for `minOut` (`contracts/test/unit/Vault.t.sol`).
- [ ] T175 [P] [US5] Write the latch/cooldown invariant test: 100 identical trigger events produce exactly one funds movement for a non-cron rule (SC-008).
- [ ] T176 [P] [US5] Template 1 DCA — three mandated tests in `contracts/test/templates/T01_DCA.t.sol` (happy, condition no longer holds, must not fire twice).
- [ ] T177 [US5] Template 1 DCA — implement the branch in `Agent.react()` plus Vault payload handling until T176 is green (`contracts/src/agent/Agent.sol`).
- [ ] T178 [P] [US5] Template 2 dip-boost DCA — three tests (cron fire, dip condition false, no double fire), including the `Sync`-keeps-cache-fresh subscription pair (`contracts/test/templates/T02_DipBoostDCA.t.sol`).
- [ ] T179 [US5] Template 2 — implement the branch until T178 is green (`contracts/src/agent/Agent.sol`).
- [ ] T180 [P] [US5] Template 3 limit buy — three tests including expiry (`Expired`) and price-above-threshold skip (`contracts/test/templates/T03_LimitBuy.t.sol`).
- [ ] T181 [US5] Template 3 — implement until T180 is green (`contracts/src/agent/Agent.sol`).
- [ ] T182 [P] [US5] Template 4 take profit — three tests (`contracts/test/templates/T04_TakeProfit.t.sol`).
- [ ] T183 [US5] Template 4 — implement until T182 is green (`contracts/src/agent/Agent.sol`).
- [ ] T184 [P] [US5] Template 5 stop loss — three tests including the trailing variant using `highWater` (`contracts/test/templates/T05_StopLoss.t.sol`).
- [ ] T185 [US5] Template 5 — implement until T184 is green (`contracts/src/agent/Agent.sol`).
- [ ] T186 [P] [US5] Template 6 grid rebalance — three tests including reference reset after a fill (`contracts/test/templates/T06_GridRebalance.t.sol`).
- [ ] T187 [US5] Template 6 — implement until T186 is green (`contracts/src/agent/Agent.sol`).
- [ ] T188 [P] [US5] Template 7 recurring transfer — three tests (`contracts/test/templates/T07_RecurringTransfer.t.sol`).
- [ ] T189 [US5] Template 7 — implement until T188 is green (`contracts/src/agent/Agent.sol`).
- [ ] T190 [P] [US5] Template 8 income sweep — three tests including the `topic2 = vault` filter (`contracts/test/templates/T08_IncomeSweep.t.sol`).
- [ ] T191 [US5] Template 8 — implement until T190 is green (`contracts/src/agent/Agent.sol`).
- [ ] T192 [P] [US5] Template 9 balance floor — three tests driven by the Vault's `Balances` event, including the missing-allowance case (`contracts/test/templates/T09_BalanceFloor.t.sol`).
- [ ] T193 [US5] Template 9 — implement until T192 is green (`contracts/src/agent/Agent.sol`).
- [ ] T194 [P] [US5] Template 10 dead-man switch — three tests using inactivity plus the user's own `Transfer` activity to reset the clock (`contracts/test/templates/T10_DeadManSwitch.t.sol`).
- [ ] T195 [US5] Template 10 — implement until T194 is green (`contracts/src/agent/Agent.sol`).
- [ ] T196 [P] [US5] Template 11 price alert — three tests, asserting zero token movement and one alert record (`contracts/test/templates/T11_PriceAlert.t.sol`).
- [ ] T197 [US5] Template 11 — implement until T196 is green (`contracts/src/agent/Agent.sol`).
- [ ] T198 [P] [US5] Template 12 LP range alert — three tests including both band edges (`contracts/test/templates/T12_RangeAlert.t.sol`).
- [ ] T199 [US5] Template 12 — implement until T198 is green (`contracts/src/agent/Agent.sol`).
- [ ] T200 [P] [US5] Template 13 large transfer alert — three tests including the amount threshold boundary (`contracts/test/templates/T13_LargeTransferAlert.t.sol`).
- [ ] T201 [US5] Template 13 — implement until T200 is green (`contracts/src/agent/Agent.sol`).
- [ ] T202 [US5] Generate `contracts/test/templates/Matrix.generated.t.sol` from the manifest fixtures and fail the build if any template lacks its three cases (prevents a half-added template).
- [ ] T203 [US5] Build `frontend/src/composer/TemplatePicker.tsx`: category grouping, supported-template filtering per selected chain, and the caveat copy for #2, #6, #9, #12.
- [ ] T204 [US5] Render the price basis everywhere as “last traded price” with `observed_at`, never “current price” (FR-020) (`frontend/src/components/PriceLabel.tsx`).
- [ ] T205 [US5] Render schedules as approximate windows (“sometime on Friday”) from the manifest, with the cost note for tight windows (FR-021) (`frontend/src/components/ScheduleLabel.tsx`).
- [ ] T206 [US5] Add alert ingestion to the indexer and an alerts section on rule detail and `/` — an alert produces an activity row and no `Executed` row; then regenerate `docs/catalog.md` from the manifest and verify the three-case matrix is complete.

---

## Phase 8: User Story 6 — Copy someone else's working rule (Priority: P2)

**Goal**: public rules are discoverable with real statistics, and a clone lands in the cloner's own account with their own limits, granting the author nothing.

**Independent Test**: clone a public rule, confirm it is active in the cloner's account with the cloner's budget, and confirm the author's vault receives nothing and controls nothing.

### Tests for User Story 6 ⚠️ (write first, confirm each fails)

- [ ] T207 [P] [US6] Contract test `contracts/test/unit/RuleRegistryListing.t.sol`: only the author may `list`/`delist`, `paramsHash` is stable, `listingCount` tracks listings, and no path on the contract can call a vault or move funds.
- [ ] T208 [P] [US6] Backend test `backend/test/api/marketplace.test.ts`: pagination cursors, template filter, `sort` variants (`newest`/`runs`/`success_rate`), and that `author_badge` is present on every row.
- [ ] T209 [P] [US6] RTL test: a listing card shows run count, success rate, and the team badge; statistics equal the values returned by the API (no local recomputation) (`frontend/test/listingCard.test.tsx`).

### Implementation for User Story 6

- [ ] T210 [US6] Finalise `RuleRegistry.list`/`delist` and derive `paramsHash` through `RuleLib.paramsHash` so a clone can reconstruct the rule exactly.
- [ ] T211 [US6] Implement the public-flag path: `addRule(rule, makePublic)` writes to the registry from the user's own transaction, and document why the indexer never writes the registry (`contracts/src/agent/Agent.sol`).
- [ ] T212 [US6] Add indexer handling for `RuleListed`/`RuleDelisted` → `listings` upserts with `author`, `template`, `metadata_uri`, `is_public`.
- [ ] T213 [US6] Implement `GET /v1/marketplace` with template filter, sort, and cursor pagination.
- [ ] T214 [US6] Implement `GET /v1/leaderboard` from `rule_stats`, ranked by runs then success rate.
- [ ] T215 [US6] Add `backend/db/migrations/0002_views.sql` creating `rule_stats` (runs, success rate, average amount) and `marketplace_feed` (listings ⋈ rules ⋈ stats).
- [ ] T216 [US6] Build `frontend/src/pages/Marketplace.tsx`: filters, sort, cursor pagination, and a guaranteed non-empty first load.
- [ ] T217 [US6] Build `frontend/src/components/ListingCard.tsx` + `CloneButton.tsx` with the author badge and a one-click clone affordance.
- [ ] T218 [US6] Build `frontend/src/pages/Leaderboard.tsx` with the team/community split visible.
- [ ] T219 [US6] Implement the clone flow in `frontend/src/hooks/useCloneRule.ts`: reconstruct the draft from `paramsHash`-matching manifest slots, show it read-only, then `addRule` on the cloner's own agent with their per-run cap and budget.
- [ ] T220 [US6] Add clone guards: refuse when the cloner is at 5 rules, when the template is unsupported on their chain, or when their vault ceiling is below the rule's amount — each with a specific message (`frontend/src/hooks/useCloneRule.ts`).
- [ ] T221 [US6] Write `backend/scripts/seed-marketplace.ts` publishing the 3–4 team rules from `packages/shared/manifest/seed-rules.json`, each flagged `team`.
- [ ] T222 [P] [US6] Test: the marketplace is never empty on first load (SC-013) and every seeded listing carries the team badge (FR-041) (`backend/test/api/marketplace.test.ts`).
- [ ] T223 [US6] Playwright `frontend/e2e/clone.spec.ts`: clone from the marketplace and assert an active rule appears in the second account with the second account's limits.
- [ ] T224 [US6] Write `docs/marketplace.md` covering listing, cloning, statistics provenance, and the team-badge honesty rule.

---

## Phase 9: User Story 7 — Understand what I am signing and on which network (Priority: P2)

**Goal**: no user ever thinks their funds vanished because a signature happened on the other network, and the three balances are never merged.

**Independent Test**: walk setup, funding, rule creation, and withdrawal; every signature prompt names its network and effect, and no screen merges sponsored credit into principal.

### Tests for User Story 7 ⚠️ (write first, confirm each fails)

- [ ] T225 [P] [US7] RTL test `frontend/test/signatureSummary.test.tsx`: the prompt names the network, the target account, and the effect in plain language for all six write flows.
- [ ] T226 [P] [US7] RTL test: a write attempted on the wrong chain shows an explicit switch prompt and does not call the wallet until the user confirms (`frontend/test/chainGuard.test.tsx`).
- [ ] T227 [P] [US7] RTL test: `BalanceTrio` renders three distinct labelled figures and has no prop that combines them (FR-008) (`frontend/test/balanceTrio.test.tsx`).

### Implementation for User Story 7

- [ ] T228 [US7] Build `frontend/src/components/SignatureSummary.tsx`: network badge, target contract, plain-language effect, and the amount at stake.
- [ ] T229 [US7] Write `frontend/src/hooks/useChainGuard.ts` + `frontend/src/components/ChainSwitchPrompt.tsx`: detect the wrong chain before a write, explain why the other network is needed, and switch only after confirmation.
- [ ] T230 [US7] Wire `SignatureSummary` and the chain guard into every write flow: onboarding, `addRule`, pause/resume/cancel, reorder, withdraw, clone, mirror.
- [ ] T231 [US7] Finalise `BalanceTrio` with ownership labels (“yours” vs “sponsored”) and per-network grouping (`frontend/src/components/BalanceTrio.tsx`).
- [ ] T232 [US7] Add the two-network explainer to `/account` with both explorer links and a sentence on why the rule and the money live apart.
- [ ] T233 [US7] Playwright `frontend/e2e/network-legibility.spec.ts`: complete the full journey and assert a network badge is visible at every signature step.
- [ ] T234 [US7] Accessibility check on both prompts: focus trap, escape to cancel, and screen-reader labels naming the network (`frontend/test/signatureSummary.test.tsx`).

---

## Phase 10: User Story 8 — Mirror another user's trade (Priority: P3)

**Goal**: one leader execution produces exactly two independent funds movements, both visible on one proof page, and a copy can never be copied.

**Independent Test**: attach a mirror, cause one leader execution, confirm two destination transactions with distinct hashes on one proof view, then replay the same leader event and confirm no third transaction.

### Tests for User Story 8 ⚠️ (write first, confirm each fails)

- [ ] T235 [P] [US8] Contract test `contracts/test/unit/MirrorVault.t.sol`: a mirror vault emits `Mirrored` and never `Executed`, and its own executions are not offered as a copyable source (FR-046).
- [ ] T236 [P] [US8] Contract test `contracts/test/unit/AgentMirror.t.sol`: `addMirror` rejects the same agent on both sides, rejects a mismatched `tokenIn`, rejects `scaleBps > 10_000`, and rejects `hourlyCap` outside 1..10.
- [ ] T237 [P] [US8] Contract test: mirroring a `Mirrored` event is impossible because the copyable topic set contains only `Executed` — assert with a wrong-topic log that nothing fires (`contracts/test/unit/AgentMirror.t.sol`).
- [ ] T238 [P] [US8] Contract test: the same leader `(vault, ruleId, txHash)` delivered twice produces one execution; an unacceptable live `minOut` skips rather than filling; the hourly cap blocks the N+1th burst (FR-045, FR-047, FR-048) (`contracts/test/unit/AgentMirror.t.sol`).

### Implementation for User Story 8

- [ ] T239 [US8] Implement `contracts/src/vault/MirrorVault.sol`: `mirrorMode = true`, emits `Mirrored(ruleId, leader, leaderTx)`, inherits the same callback authentication as `Vault`.
- [ ] T240 [US8] Implement `Agent.addMirror` validation and storage matching `data-model.md` §1.4 (`contracts/src/agent/Agent.sol`).
- [ ] T241 [US8] Implement the mirror execution branch in `Agent.react()` for leader `Executed` logs: dedupe on `keccak256(leaderVault, ruleId, leaderTxHash)`, spend = `min(perRunCap, leaderAmountIn × scaleBps / 10_000)`, hourly counter, callback payload for the follower's vault.
- [ ] T242 [US8] Enforce the mirror constraints in `Vault`: a mirror-mode vault accepts only mirror payloads and still applies its own live `minOut` check (`contracts/src/vault/Vault.sol`).
- [ ] T243 [US8] Add `VaultFactory.deployMirror` with a test proving a leader vault cannot be converted into a mirror vault and vice versa (`contracts/test/unit/VaultFactory.t.sol`).
- [ ] T244 [US8] Persist mirror links in the `mirrors` table and expose them on the rule detail API response (`backend/src/api/routes/rules.ts`).
- [ ] T245 [US8] Add indexer handling for `Mirrored` → `executions` row with `kind: mirrored` and `leader_tx` populated (`backend/src/indexer/decoders/index.ts`).
- [ ] T246 [US8] Build `frontend/src/components/MirrorForm.tsx`: leader selection, scale (bps), per-run cap, hourly cap, explicit warning about thin-pool fills, and detach.
- [ ] T247 [US8] Show the mirror relationship on follower rule detail: “copies <leader rule>”, scale, caps, and its own mirrored execution history (`frontend/src/pages/RuleDetail.tsx`).
- [ ] T248 [US8] Extend `GET /v1/proofs/:hash?include=mirrors` to return the follower's destination transaction alongside the leader's.
- [ ] T249 [US8] Build the grouped proof view: leader and follower rows on one page with distinct badges and two explorer links (`frontend/src/pages/Proof.tsx`).
- [ ] T250 [US8] Write `backend/scripts/seed-mirror.ts` creating a leader rule, a follower mirror, and a deterministic trigger for the demo.
- [ ] T251 [US8] Playwright `frontend/e2e/mirror.spec.ts`: one leader event renders two destination rows from a fixture.
- [ ] T252 [US8] Run the two-hop loop on testnet and record both destination hashes plus the dedupe replay result in `docs/measurements.md` and `docs/submission-evidence.md`.
- [ ] T253 [US8] Write `docs/decisions/0006-mirror-depth-cap.md`: why the cap is structural (event type), not a counter.
- [ ] T254 [US8] Add the documented fallback to `README.md`: if the two-hop loop is broken at the cut line, ship clone-only and state it plainly (`./README.md`).

---

## Phase 11: Polish & Cross-Cutting Concerns

**Purpose**: everything the constitution gates on and the buildathon submission requires. Completing this phase is what turns a working demo into a submittable project.

- [ ] T255 Complete `README.md` with the architecture diagram, the three-step loop, the check-twice explanation, the custody table, the funding model, the “this is not a bot” statement, and local + deployed setup (`./README.md`).
- [ ] T256 [P] Write `docs/cost-model.md`: measured base fees, per-wake-up costs, per-year table, the `_extraGas`/`_gasPriceCoeffPer1000` verification commands, and the two lessons (weekly ≈ daily; cost scales with events, not time).
- [ ] T257 [P] Build `frontend/src/pages/Cost.tsx` rendering the cost model from a typed data module, cited as “measured on <date>”.
- [ ] T258 [P] Write `docs/runbooks/top-up-reserves.md`: `depositTo(target)` on both proxies, permissionless top-up, and the warning that a plain transfer strands funds.
- [ ] T259 [P] Write `docs/runbooks/reindex-from-chain.md`: truncate, reset cursors, replay, reconcile, and the expected runtime at demo volume.
- [ ] T260 [P] Write `docs/runbooks/rotate-sponsor-key.md`: revoke, reissue, redeploy config vars, verify onboarding still works, and what happens to in-flight work.
- [ ] T261 Record every deployment in `deployments/lasna.json` and `deployments/unichain-sepolia.json` (agent factory, vault factory, registry, callback proxy) with commit SHA and explorer links.
- [ ] T262 [P] Write `scripts/secret-scan.mjs` scanning the tree for private keys, seed phrases, and `VITE_*SERVICE_ROLE*` misuse; wire it into the CI job from T006.
- [ ] T263 Run an accessibility pass with axe over all eight routes plus the two prompts and the composer; fix every violation to zero (`frontend/test/a11y.test.tsx`).
- [ ] T264 [P] Measure and record proof-view first paint (<2s) and API p95 (<300 ms) in `docs/measurements.md` with the method used.
- [ ] T265 Add the indexer-lag banner (threshold 60s) driven by `/health`, and document the thresholds in `README.md`.
- [ ] T266 [P] Add offline and RPC-failure states to every page: no blank screens, no infinite spinners, always a retry affordance (`frontend/src/components/OfflineState.tsx`).
- [ ] T267 Audit the error taxonomy: every selector in `Errors.sol` has a human message in `frontend/src/lib/errors.ts`, and a test fails if one is missing.
- [ ] T268 Commit the coverage summary artifact and enforce the gate in CI; confirm 0 skipped tests (Constitution II) (`contracts/.coverage-summary.json`).
- [ ] T269 Add `forge snapshot --check` as a CI gate comparing against `contracts/.gas-snapshot`.
- [ ] T270 Run quickstart V1–V10 end to end and record every result, hash, and latency in `docs/submission-evidence.md`.
- [ ] T271 Verify the submission checklist: public repo, agent address, vault address, registry address, 3+ hashes for origin → reactive → callback, one clone hash, one mirror hash, and a `getCallbacks` proof independent of the indexer (`docs/submission-evidence.md`).
- [ ] T272 [P] Write `scripts/seed-thin-pair.ts` and `scripts/move-price.ts` for the demo price beat, with the honest on-screen caveat text in `docs/demo-script.md`.
- [ ] T273 [P] Write `docs/demo-script.md` with the seven beats from `IDEA.md` §16 and the exact words for the two honesty moments (thin pair, sponsored credit).
- [ ] T274 Record the demo video under 3 minutes and link it from `README.md` (`./README.md`).
- [ ] T275 Run the full gate (`scripts/check.mjs`), confirm every quality gate in `constitution.md` passes, and tag `v0.1.0`.
- [ ] T276 Production smoke on all three hosts: Vercel deep link, Heroku `/health` with indexer lag, and a 24-hour confirmation that the Supabase project did not pause.
- [ ] T277 Prune dead code, commented-out blocks, debug logging, and unowned `TODO`s; every surviving `TODO` names an owner and a tracking reference (`./eslint.config.js`).
- [ ] T278 Add `LICENSE` (MIT) — the repository must be public and open source for submission (`./LICENSE`).
- [ ] T279 Add the “known limitations and what comes next” section to `README.md`: single destination chain, sponsor dependency, approximate cron, thin-pool demos, and the shared-engine scaling lever (`./README.md`).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 Setup (T001–T022)**: no dependencies; start immediately.
- **Phase 2 Foundational (T023–T083)**: depends on Setup. **BLOCKS all user stories.** The contract skeleton, generated manifest, indexer spine, and frontend shell must exist before any story is testable.
- **Phases 3–10 User Stories**: depend on Foundational only. Each story is independently testable given a seeded account (see Notes).
- **Phase 11 Polish (T255–T279)**: depends on the stories you intend to ship.

### User Story Dependencies

| Story                      | Priority | Depends on                                                                      | Why                                           |
| -------------------------- | -------- | ------------------------------------------------------------------------------- | --------------------------------------------- |
| US1 account + custody      | P1       | Foundational                                                                    | nothing else can be tested without an account |
| US2 composer + create rule | P1       | Foundational, US1 for a real end-to-end run (a seeded agent suffices for tests) | creating a rule needs an Agent address        |
| US3 proof view             | P1       | Foundational, US2 to generate a real execution                                  | proof needs something that ran                |
| US4 control                | P1       | Foundational, US2                                                               | pause/cancel/reorder target existing rules    |
| US5 13-template catalog    | P2       | Foundational; templates 3–6 use the price cache                                 | shares the one engine                         |
| US6 marketplace + clone    | P2       | Foundational, US2                                                               | cloning calls `addRule`                       |
| US7 network legibility     | P2       | Foundational; wires into US1/US2/US4/US8 flows                                  | presentation of existing writes               |
| US8 mirror                 | P3       | Foundational, US2, US5 (a leader rule must fire)                                | two-hop loop needs a working leader           |

**Independence caveat**: US2–US8 are independently _testable_ (fixtures, seeded accounts, mocks) but not independently _demonstrable_ without US1. That is a product fact, not a task-design flaw.

### Within Each Story

Test tasks first and failing → models/types → services → routes/components → integration → story-level Playwright. A story is complete only when its gate passes (`scripts/check.mjs`), not when the feature "works on my machine".

### Parallel Opportunities

- Setup: T002–T005, T012–T017, T021–T022 are file-disjoint.
- Foundational: T023–T029 (contracts primitives) and T043–T052 (shared package) can run side by side; T053–T072 (backend) and T073–T083 (frontend) can run side by side once T049 (encoder) exists.
- US5: all 13 template pairs (T176–T201) touch separate test files and separate `react()` branches; run in parallel only after T167–T175 settle the engine.
- US6 and US7 are mostly disjoint (marketplace surfaces vs. signature surfaces) and can be parallelised.

---

## Parallel Example: Foundational skeleton

```bash
# contracts primitives (one agent)
Task: "T023 Errors.sol" ; "T025 PriceMath.sol" ; "T027 RuleLib.sol" ; "T028 ChainConfig.sol"
# shared package (another agent)
Task: "T043 templates.json" ; "T046 chains.ts" ; "T047 schemas.ts" ; "T049 encode.ts"
# backend + frontend shells (two more agents)
Task: "T053 config.ts" ... "T064 decoders" ; "T073 wagmi.ts" ... "T082 queryClient"
```

## Parallel Example: User Story 5 templates

```bash
# each pair is a separate test file + a separate react() branch
Task: "T176/T177 DCA"      Task: "T178/T179 DipBoost"  Task: "T180/T181 LimitBuy"
Task: "T182/T183 TakeProfit" Task: "T184/T185 StopLoss"  Task: "T186/T187 Grid"
Task: "T192/T193 BalanceFloor" Task: "T198/T199 RangeAlert" Task: "T200/T201 LargeTransfer"
```

---

## Implementation Strategy

### MVP scope (US1 + US2 + US3)

Constitution II calls a rule the money path, and a rule that cannot be created or proven is not demonstrable. The smallest shippable increment is therefore:

1. Phase 1 Setup → 2. Phase 2 Foundational → 3. **US1** (account + custody, testable alone) → 4. **US2** (compose and launch one rule) → 5. **US3** (prove the loop).

That combination satisfies the submission's hardest requirement (a provable origin → reactive → callback chain) and the custody claim (**SC-006**). Validate with quickstart **V2, V3, V4** before adding anything else.

If you must ship even smaller, US1 alone is a complete, verifiable custody slice — but it is not a product demo and should not be recorded as one.

### Incremental delivery after the MVP

| Increment | Adds                                   | Validate with     |
| --------- | -------------------------------------- | ----------------- |
| +US4      | pause/cancel/reorder/budget visibility | quickstart V5, V6 |
| +US5      | the honest 13-template catalog         | quickstart V7     |
| +US6      | marketplace, clone, leaderboard        | quickstart V8     |
| +US7      | network legibility across every write  | manual journey    |
| +US8      | the two-hop mirror                     | quickstart V9     |

### Cut line (binding, from `IDEA.md` §15)

If behind schedule, cut in this order: **leaderboard (T214, T218) → marketplace filters (T213, T216) → dip-boost and grid templates (T178/T179, T186/T187)**. Mirror is committed but falls back to clone-only at T254 if the two-hop loop is broken. **Never cut**: the proof page (US3), a second template (US5), or the pause/cancel flow (US4).

### Team parallelism

After Foundational, one person on contracts + indexer and one on frontend will collide at US2 (encoder) and US5 (template manifest). Assign US5's test halves and implementation halves to the same person per template to avoid the half-added-template failure mode the constitution forbids.

---

## Notes

- **`[P]` means file-disjoint, not cost-free.** Two "parallel" contract tasks touching `Agent.sol` are not parallel; the template pairs T176–T201 are, because each owns its own test file and its own branch.
- **Commit per task or logical group.** Every commit must build and pass its package's tests (Constitution: no broken intermediate commits on the main line).
- **Story complete ≠ feature visible.** A story is done when its tests, lint, types, and build pass and its quickstart scenario is recorded in `docs/submission-evidence.md`.
- **Template tasks are atomic.** A template lands with its contract branch, its three tests, its manifest entry, its composer mapping, and its documentation in one change (Constitution: “templates are added once”).
- **No task may weaken a gate.** If a task cannot pass `--max-warnings 0` or the coverage threshold, fix the code — do not adjust the gate.
- **Chain-constant drift is a bug.** Any new address goes into `contracts/src/chain/ChainConfig.sol` and `packages/shared/src/chains.ts` in the same commit, never into a component.
- **Total: 279 tasks** — Setup 22, Foundational 61, US1 21, US2 26, US3 18, US4 18, US5 40, US6 18, US7 10, US8 20, Polish 25.
