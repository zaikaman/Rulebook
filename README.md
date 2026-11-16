# Rulebook

A no-code builder for personal on-chain automations. Pick a trigger, a condition, and an
action — _every Friday → buy 10 USDC of ETH_ — and a reactive contract executes it forever.
No server to keep alive, no bot to run, and no key of yours held by us.

> **Working title.** Design source of truth: [`IDEA.md`](./IDEA.md). Implementation
> artifacts: [`specs/001-reactive-rule-builder/`](./specs/001-reactive-rule-builder/).

## Architecture

```text
Unichain Sepolia (origin)          Lasna (automation)             Unichain Sepolia (funds)
─────────────────────────          ──────────────────             ───────────────────────
Uniswap pool ──Sync──┐
User wallet ──Transfer──┤
Cron (legacy system) ──┼──────▶     Agent (per user)   ──callback──▶   Vault (per user)
Leader Vault ──Executed┘            react(), cache                    swap / transfer
                                         │                           limits, receipts
                                         └──▶ Registry ──▶ indexer ──▶ UI / proof page
```

- **Agent** (Lasna): holds the user's rules, subscribes to the events they need, decides in
  `react()`, requests a callback.
- **Vault** (Unichain Sepolia): holds principal, executes swaps and transfers, re-checks the
  condition against live reserves before moving a single token.
- **Registry + indexer**: public listings and a readable event log. The indexer is read-only.

## The loop, in three steps

1. An event is emitted on Unichain Sepolia (or a cron tick fires on Lasna).
2. The system contract calls `react(log)` on the Agent, which pays a fee in REACT.
3. If a rule fires, the Agent requests a callback; the Vault executes and pays gas in ETH.

The check happens **twice**. The Agent decides cheaply from cached event data; the Vault
decides for real from live reserves and refuses if the condition no longer holds. Execution
status always comes from the destination chain, never from the automation side.

## Custody

| Action                      | User                         | Operator |
| --------------------------- | ---------------------------- | -------- |
| Own the Agent and the Vault | yes                          | no       |
| Add / pause / cancel a rule | yes                          | no       |
| Withdraw principal          | yes                          | no       |
| Top up execution credit     | yes                          | yes      |
| Move principal              | only via a pre-approved rule | **no**   |

We pay the gas so anyone can use it. You keep the money, in your own contract, withdrawable
at any time. We never hold a key to it.

**The indexer cannot move funds. This is not a bot.**

## Cost model

Waking a rule costs roughly `0.02 REACT`; a callback swap on Unichain Sepolia costs on the
order of `0.0000006 ETH`. Weekly DCA costs almost the same as daily DCA — you pay for ticks,
not trades. Full table and the commands to re-measure it: `docs/cost-model.md` (Phase 11).

## Repository layout

```text
contracts/          Foundry: Agent, Vault, factories, Registry
packages/shared/    generated ABIs, chain config, template manifest, zod schemas, encoder
backend/            Node + Fastify: read-only indexer and API
frontend/           React + Vite: composer, rule management, proof page
specs/              spec-kit artifacts (spec, plan, tasks, contracts)
deployments/        one record per deployed contract, per network
docs/               ADRs, runbooks, measurements
```

## Local setup

```bash
# prerequisites: Node 24, npm 10+, Foundry (forge), git
npm ci
npm run generate -w packages/shared   # manifest + ABI codegen (Phase 2 onward)
npm run build -w packages/shared
npm run dev -w backend                # http://localhost:8787
npm run dev -w frontend               # http://localhost:5173
```

Gates (all must pass before merge):

```bash
npm run check        # fmt → build → test → coverage → typecheck → lint → secret scan
```

## Deployment

| Piece     | Host                     | Notes                                                                       |
| --------- | ------------------------ | --------------------------------------------------------------------------- |
| Frontend  | Vercel                   | static SPA, `vercel.json` rewrite for deep links                            |
| Backend   | Heroku                   | **Basic** dyno: Eco sleeps after 30 idle minutes and would stop the indexer |
| Database  | Supabase                 | free plan; derived cache only, rebuildable from chain events                |
| Contracts | Lasna + Unichain Sepolia | addresses in `deployments/`                                                 |

Only `VITE_*` values are public. The Supabase service-role key and the sponsor relayer key
live in Heroku config vars and never reach the bundle.

### Provisioned resources

| Resource         | Identifier                                                               | Region / tier                                            |
| ---------------- | ------------------------------------------------------------------------ | -------------------------------------------------------- |
| Supabase project | `onvbgrphxiobacsviire` — https://onvbgrphxiobacsviire.supabase.co        | `ap-northeast-1` (Tokyo), free plan, Postgres 17         |
| Heroku app       | `rulebook-backend` — https://rulebook-backend-99de5f3991c5.herokuapp.com | `eu`, stack `heroku-24`, **Basic** dyno — see note below |
| Vercel project   | not created yet                                                          | pending                                                  |

Region choice and plan limits are recorded in
[`docs/decisions/0002-supabase-project.md`](./docs/decisions/0002-supabase-project.md).

**Dyno tier note.** Heroku has no process types until the app's first release, so
`heroku ps:scale` cannot set the tier on a fresh app. The first deploy must run
`heroku ps:scale web=1:basic` — Eco would sleep after 30 idle minutes and silently stop the
indexer, which is the one failure mode this product cannot afford.

## Known limitations

- Test networks only. A testnet origin cannot call a mainnet destination.
- One destination chain in this release (the schema carries `chainId` for more).
- Cron windows are approximate: "every Friday" means "sometime on Friday".
- Prices are the **last traded price**, which on a quiet pair can be hours old.
- Sponsorship is load-bearing: if the operator stops topping up, automation pauses. Funds
  are never at risk, and `depositTo()` is permissionless, so anyone can revive an account.
