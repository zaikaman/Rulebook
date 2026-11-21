<!--
SYNC IMPACT REPORT
Version change: (none) → 1.0.0
Bump rationale: Initial ratification. No prior constitution existed; the file held the raw
  scaffold. MAJOR-by-default for a first adoption; recorded as 1.0.0.

Modified principles:
  - Placeholder I → I. Readable, Single-Purpose Code
  - Placeholder II → II. Test-First on Every Money Path (NON-NEGOTIABLE)
  - Placeholder III → III. One Source of Truth per Fact
  - Placeholder IV → IV. Explicit Contracts and Typed Boundaries
  - Placeholder V → V. Operable and Documented by Default

Added sections:
  - Quality Gates and Definition of Done (replaced scaffold section 2)
  - Development Workflow and Review (replaced scaffold section 3)
  - Governance (rules filled in)

Removed sections:
  - None. The two scaffold section placeholders were replaced.

Deferred TODOs:
  - None. Ratification date set to the first adoption date (2026-11-16).
-->

# Rulebook Constitution

> **Project**: Rulebook — a no-code builder for personal on-chain
> automations, built on Reactive Network (Lasna) and Unichain Sepolia.
> Design source of truth: `PRODUCT.md` and `README.md`. This document governs *how* we build, never *what*.

## Core Principles

### I. Readable, Single-Purpose Code

Code is read far more often than it is written, and on a 19-day build the author is also
the reader. Every module MUST do one stated thing, and its name MUST state that thing.

- Each contract, indexer module, and UI component MUST have a single responsibility. A
  unit that needs "and" in its description MUST be split.
- Solidity public/external functions and non-trivial internal functions MUST carry NatSpec
  (`@notice`, `@param`, `@return`). Exported TypeScript symbols whose behavior is not
  obvious from the signature MUST carry a doc comment.
- Magic numbers, raw addresses, and stringly-typed literals MUST NOT appear in logic. Use
  named constants, typed params, or the single per-chain config module (Principle III).
  Exception: test fixtures and verified chain constants documented in `contracts/src/chain/ChainConfig.sol`.
- Dead code, commented-out code, debug logging, and unowned `TODO` markers MUST NOT be
  merged. A `TODO` MUST name an owner and a tracking reference.
- Formatting is automated, never debated in review: `forge fmt`, Prettier, and ESLint/
  Solhint MUST pass. Warnings are failures (`--max-warnings 0`).
- Naming MUST be explicit: no `data`, `temp`, `helper`, `Manager`, `Utils` when a domain
  name exists. Prefer `executeCallback` over `exec`, `slippageBps` over `x`.

**Rationale**: In a contest build, the same person writes, reviews, and debugs the code at
2 a.m. Clarity is the only reliable defense; cleverness is a liability that outlives the
deadline.

### II. Test-First on Every Money Path (NON-NEGOTIABLE)

Anything that can move, lock, or misreport user funds MUST be specified by a failing test
before it is implemented. Red → Green → Refactor is mandatory for those paths.

- Every behavior change MUST start with a failing test. The implementation is written only
  to make that test (and its neighbors) pass; refactoring happens with tests green.
- Solidity coverage is mandatory for: the `Agent` (`react()` routing, latch, cooldown,
  budget, reorder, pause/unsubscribe), the `Vault` (limits, quote-at-execution, operator
  checks, principal withdrawal), both factories, and the `Registry`.
- Every revert path and every access-control check MUST have a dedicated test. The
  callback-authentication footgun (Reactive overwrites the first 160 bits of the payload
  with the Agent address) MUST be tested directly against a wrong sender.
- Core contracts (`Agent`, `Vault`, `*Factory`, `Registry`) MUST reach **≥ 90% branch
  coverage** as reported by `forge coverage`, and **100% of external functions** must be
  invoked by at least one test with a passing and a failing case.
- Tests MUST be layered: unit tests for pure logic and encoding/decoding; integration
  tests for factory → agent → vault → registry wiring; end-to-end tests for
  composer → `addRule` calldata → simulated execution → proof-page data.
- Each of the 13 templates MUST have: a happy-path test, a "condition no longer holds"
  test, and a "must not fire twice" test.
- Adversarial cases MUST be covered where the design depends on them: stale cached price,
  price drift between chains, duplicate `Sync` events, insufficient callback reserves,
  debt-blocked execution, and mirror depth (a mirror of a mirror must never exist).
- A bug fix MUST ship with a regression test that fails before the fix.
- A skipped or quarantined test MUST carry a reason and a tracking reference in the same
  commit. Silent `.skip`/`vm.skip` is a gate failure.
- CI MUST run tests hermetically: no live RPC, no faucet, no real funds. Fork tests and
  explicitly labeled soak tests are the only exceptions.

**Rationale**: The contracts never stop running after we log off. A missed revert path is
not a bug, it is custody risk — and the sponsor's money pays for every reverted `react()`.

### III. One Source of Truth per Fact

Every fact has exactly one authoritative home. Copies are generated or validated, never
hand-maintained.

- Canonical contract schemas and ABIs are the single source of truth for on-chain
  interactions. Contract code implements them; TypeScript types are generated from ABIs and MUST
  NOT be hand-copied or widened.
- Template semantics (13 templates × trigger/condition/action) MUST live in one place per
  layer: the contract's evaluation logic, one template registry, and one frontend mapping.
  Cross-layer agreement MUST be enforced by a shared fixture or generated manifest, not by
  parallel edits kept in sync by memory.
- The callback-authentication check MUST live in one shared base (`AbstractCallback`) and
  MUST NOT be reimplemented per vault or per function.
- Chain constants (chain IDs, routers, pairs, proxies) MUST live in one per-chain config
  module per layer, keyed by chain ID. Duplicated addresses in components are forbidden.
- Domain events (`Executed`, `Mirrored`, `Balances`, `RuleCreated`, `RulePaused`) are API
  contracts. `Executed` MUST be emitted only by leader vaults and `Mirrored` only by mirror
  vaults — that split is the structural depth cap and MUST NOT be "simplified" away.
- `react()` MUST stay within the 900,000 gas cap and gas budget per wake-up. A change that
  pushes a shared slice over budget MUST be rejected or explicitly justified in the plan.

**Rationale**: Two sources of truth become two behaviors the moment one is edited. In a
cross-chain system where a wrong address silently burns funds, there is no acceptable
amount of duplication.

### IV. Explicit Contracts and Typed Boundaries

Everything crossing a boundary — RPC, indexer API, wallet, contract ABI, user input — is
untrusted until parsed into a named, validated type.

- TypeScript MUST NOT use `any` (or `as unknown as X` casting) to cross a boundary. Data
  from chain, indexer, or HTTP MUST be validated once at ingestion (zod or equivalent) and
  then flow as a typed domain object.
- Solidity MUST use custom errors instead of revert strings, explicit visibility on every
  declaration, `immutable`/`constant` where possible, and checked arithmetic unless a block
  is documented and tested.
- Every state-changing function MUST emit the event its consumers need. Event changes MUST
  be additive; renaming or removing a field is a breaking change and requires a version
  bump of the consumer.
- Errors shown to users MUST preserve the underlying chain error (or its selector) next to
  a human explanation. Swallowing an error, or reporting "success" from a Lasna receipt
  before the destination transaction confirms, is forbidden.
- The UI MUST treat the destination chain as the only source of truth for "did it run".
- Public functions and exported module APIs MUST have a stable, documented shape before
  dependent code is written against them.

**Rationale**: Unvalidated data is how a demo reports a green check while the funds never
moved. Explicit types make the boundary between "we asked" and "it happened" visible in
code, not just in the README.

### V. Operable and Documented by Default

If an operator cannot run, fund, pause, debug, and hand off the system from the repo, the
feature is not done.

- `PRODUCT.md` is the internal design source of truth; `README.md` is the external contract.
  Architecture, cost model, custody model, and the "this is not a bot; the indexer cannot
  move funds" statement MUST be updated in the same change that makes them stale.
- Non-obvious decisions MUST be recorded as a short ADR in `docs/decisions/NNN-title.md`
  (context, decision, consequence) or as a dated entry in an existing decision log. One
  paragraph is enough; undocumented reversals are not.
- Configuration MUST come from environment variables or the per-chain config module.
  Secrets and private keys MUST NOT be committed, logged, or embedded in frontend bundles.
- Every dependency added MUST be justified in the PR (purpose, maintenance status,
  alternative considered). Abandoned or unmaintained packages MUST NOT be introduced.
  Lockfiles MUST be committed.
- Every deployment MUST be recorded with chain ID, address, contract name, commit SHA,
  deployer, and explorer link in a versioned deployments file. A deploy that exists only in
  someone's terminal history did not happen.
- Operational runbooks MUST exist for the three actions we will actually need: top up
  reserves via `depositTo`, pause or cancel a rule, and rebuild or reindex from chain
  events. Each runbook MUST be executable by a teammate who did not write it.
- Hosted state MUST be reconstructible: anything the indexer stores MUST be derivable from
  chain events, with `getCallbacks` as the authoritative proof path.

**Rationale**: Sponsorship means the system can go quiet while we sleep. Documents and
runbooks are the difference between a five-minute top-up and a dead demo.

## Quality Gates and Definition of Done

### Automated gates (all MUST pass before merge)

| Gate | Command / check | Threshold |
|------|-----------------|-----------|
| Solidity format | `forge fmt --check` | zero diffs |
| Solidity lint | `solhint 'src/**/*.sol'` | zero errors, zero warnings |
| Contract build | `forge build` | no warnings |
| Contract tests | `forge test` | 100% pass, 0 skipped |
| Contract coverage | `forge coverage --report summary` | ≥ 90% branch on core contracts |
| TypeScript types | `tsc --noEmit` | zero errors |
| Frontend lint | `eslint . --max-warnings 0` | zero warnings |
| Frontend tests | unit + integration suite | 100% pass, 0 skipped |
| Production build | app build | succeeds |
| Secret scan | repo scan for keys/seed phrases | zero findings |

### Definition of Done

A task is done only when all of the following are true. A task missing any item MUST NOT be
marked complete, regardless of demo pressure.

1. Tests exist for the behavior, including its failure paths, and pass locally.
2. Lint, format, and type gates pass for every touched package.
3. Public interfaces and events are documented, and docs are updated if behavior changed.
4. Any new address, deployment, or dependency is recorded per Principle V.
5. No new `TODO`, dead code, or debug output was introduced.
6. The change was reviewed against this constitution (see Development Workflow).

### Schedule pressure rule

When time runs short, **cut scope, never gates**. The binding cut order prioritizes
core execution loops: leaderboard -> marketplace filters -> secondary templates. The proof page, a second
template, and the pause/cancel flow are never cut. Disabling a gate to hit a date is a
constitution violation, not a trade-off.

## Development Workflow and Review

- **Small, reviewable changes.** A PR SHOULD stay under ~400 lines of hand-written logic
  excluding tests, generated code, and lockfiles. Larger changes MUST state why they cannot
  be split.
- **Working increments.** Every commit MUST build and pass its package's tests. Broken
  intermediate commits on the main line are forbidden.
- **Contract changes get a second pair of eyes.** Because this is a small team, every change
  to `Agent`, `Vault`, factories, `Registry`, or the shared callback base MUST receive an
  independent review pass (teammate, or an automated review tool used deliberately) and the
  findings MUST be recorded in the PR description. "LGTM" without a checklist is not a
  review.
- **Self-review checklist** (required before requesting review): gates run, tests cover
  failure paths, no secrets, no duplicated constants, docs updated, events emitted, gas/
  budget impact considered.
- **Boy-scout scope.** Improve the code you are already touching; drive-by refactors of
  unrelated modules belong in a separate, reviewed change.
- **Templates are added once.** A new rule template MUST land with its contract test, its
  registry entry, its frontend mapping, and its documentation in one change. Half a
  template is a broken template.
- **Bug triage.** A production or demo-blocking defect gets a failing reproduction first,
  then a fix, then a regression test, then a one-line note in the changelog.

## Governance

- This constitution supersedes ad-hoc preferences and tool defaults. Where it conflicts
  with convenience, this document wins.
- **Amendments** require: a written proposal stating the change and its motivation, an
  explicit version bump, a migration note when existing code or plans are affected, and an
  update to dependent plans and tasks before the amendment is treated as active.
- **Versioning** follows semantic versioning:
  - MAJOR — a principle is removed, or redefined in a way that makes previously compliant
    work non-compliant.
  - MINOR — a principle or governance section is added, or guidance is materially expanded.
  - PATCH — clarifications, wording, and typo fixes with no change in obligation.
- **Compliance review** happens at three points, every time: during planning (the plan's
  Constitution Check MUST cite each principle and the gate it satisfies), before merge
  (the automated gates plus the self-review checklist), and at release (Definition of Done
  confirmed for every shipped item). A violation MUST be recorded and resolved, never
  waived silently.
- **Complexity must be justified.** Any deviation from a principle MUST be documented in
  the plan or ADR with the reason, the risk accepted, and the follow-up that removes it.
- **Runtime guidance** lives in `README.md` (external), `PRODUCT.md` (design), and
  `docs/decisions/` (rationale). This constitution governs process and quality, not product
  scope.

**Version**: 1.0.0 | **Ratified**: 2026-11-16 | **Last Amended**: 2026-11-16
