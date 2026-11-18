# Rulebook

Build personal on-chain automations from a sentence such as “Every Friday, buy 10 USDC
worth of WETH.” Your wallet owns the Agent that evaluates the rule and the Vault that
holds your funds. Rulebook sponsors setup and execution credit on testnet.

## Architecture

```text
Unichain Sepolia            Reactive Lasna                  Unichain Sepolia
origin events ────────────▶ per-user Agent ── callback ──▶ per-user Vault
pool, transfers,             rules, price cache,            principal, live checks,
leader executions            and subscriptions              settlement receipt
                                     ▲
                              Lasna cron ticks

Lasna Registry ──┐
Lasna and Unichain logs ────▶ Fastify indexer ────▶ Supabase read cache ──▶ React UI
Lasna getCallbacks ─────────▶ proof API and direct Lasna reader
```

1. A matching chain event or Lasna cron tick wakes the Agent. Reactive charges the
   Agent’s watching credit for the evaluation.
2. The Agent checks the rule against its cached observations. If the rule fires, it
   requests an authenticated callback to the user’s Vault.
3. The Vault checks live reserves and spending limits before swapping or transferring.
   The callback draws on the Vault’s execution credit. The destination receipt determines
   the outcome shown in the proof view.

The cached check avoids unnecessary callbacks. The live check protects against price
movement between evaluation and settlement. Alerts record activity without moving funds.

## Custody and funding

| Action                             | Wallet owner                             | Operator |
| ---------------------------------- | ---------------------------------------- | -------- |
| Own the Agent and Vault            | Yes                                      | No       |
| Create, pause or cancel rules      | Yes                                      | No       |
| Withdraw principal                 | Yes, including when automation is paused | No       |
| Fund execution and watching credit | Yes                                      | Yes      |
| Set the Vault’s spending limits    | Yes                                      | No       |

The Vault can spend principal under an authorized rule, within the owner’s limits.
The sponsor pays for setup, provides starter test funds and tops up execution credit.
Direct wallet transactions can still incur network fees. The UI displays principal,
Lasna watching credit and Unichain execution credit separately.

**This is not a bot. The indexer cannot move funds.** Reactive and the contracts run the
automation. The indexer reads chain events and provides a rebuildable view. Two sponsor
routes can deploy user-owned contracts and fund accounts with sponsor assets.

A wake-up costs about 0.02 REACT at the measured Lasna gas price. A destination swap
adds an estimated 0.0000006 ETH at the sampled Unichain rate. Weekly and daily rules on the
same cron subscription wake for the same ticks. [Measured fees and annual estimates](./docs/cost-model.md)

## Local setup

Install Node.js 24, npm and Foundry 1.7.1. Use a Supabase project or local Supabase
stack with the Rulebook migrations applied.

```powershell
git submodule update --init --recursive
npm ci
npm run build -w contracts
npm run generate
npm run build -w packages/shared
Copy-Item backend/.env.example backend/.env
Copy-Item frontend/.env.example frontend/.env.local
```

Fill in the Supabase API URL and service-role key in `backend/.env`. Add the public RPC
URLs and the configured Lasna AgentFactory and Unichain VaultFactory addresses to both
environments. For local read-only work, set `INDEXER_ENABLED=false` and leave the sponsor
variable unset. For local database migrations, set `DATABASE_URL` in the backend
environment and run `npm run migrate -w backend`. [Deployment addresses](./deployments/README.md)

```powershell
npm run dev
npm run check
npx playwright install chromium
npx playwright test
```

The API listens on port 8787 and the web app on 5173. Playwright starts its own Anvil
and fixture API. It exercises onboarding, rule creation, controls, cloning, proof rendering
and accessibility without spending testnet funds.

## Deployment and operations

| Component       | Host                       | Setup                                                                                                                                                     |
| --------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend        | Vercel                     | Use the `frontend` root, enable workspace sources outside the root and use the SPA rewrites in `frontend/vercel.json`.                                    |
| API and indexer | Heroku                     | Deploy from the workspace root. The root `Procfile` starts the built Fastify service. Run the web process on Basic so it can continue polling while idle. |
| Read database   | Supabase                   | Apply the Rulebook migrations and configure the service-role key on the backend.                                                                          |
| Contracts       | Lasna and Unichain Sepolia | Use the chain-specific factory addresses and start cursors just before the earliest blocks you need to replay.                                            |

The existing Heroku app is `rulebook-backend`. Set the backend’s CORS allowlist to the
Vercel site origin. Set `VITE_API_BASE_URL` to the backend URL, and set the RPC and factory
addresses in the frontend’s build environment. All `VITE_*` values are public. The
Supabase service-role key and sponsor key belong in backend config vars.

The workspace polls `/health` every 30 seconds. It warns when a reported cursor is more
than 60 seconds behind and identifies unavailable RPCs. The deployment smoke target is
under 15 seconds of reported lag with the database reachable. Proofs show their source.
When Lasna has no callback record, use the independently verified transaction links in
the evidence to inspect the origin, evaluation and destination receipts. [Submission evidence](./docs/submission-evidence.md)

- [Top up execution reserves](./docs/runbooks/top-up-reserves.md)
- [Pause or cancel an automation](./docs/runbooks/pause-cancel-a-rule.md)
- [Rebuild the read model](./docs/runbooks/reindex-from-chain.md)
- [Rotate the sponsor key](./docs/runbooks/rotate-sponsor-key.md)

## Known limitations and what comes next

- The release targets testnets and one destination chain, Unichain Sepolia.
- Rules can go quiet if sponsored credit runs out. Anyone can top up a target with
  `depositTo`, and the wallet owner can still withdraw principal.
- Cron windows are approximate. A Friday rule runs sometime on Friday.
- Thin pools make it easy to demonstrate a price trigger. Their fills and price impact
  differ from deeper pools, and quoted prices reflect the last trade or reserve update.
- Each Agent pays for its own wake-ups. A future shared engine could amortize each tick
  across a bounded batch of rules, while retaining per-user Vault ownership and limits.
- Mirroring is disabled by default. Keep the release clone-only if the grouped proof
  fails at the release cutoff. The two-hop settlement receipts and duplicate replay result
  are recorded. [Testnet measurements](./docs/measurements.md)

[Watch the 75-second walkthrough](./docs/demo.mp4) · [Demo script](./docs/demo-script.md) · [Technical specification](./specs/001-reactive-rule-builder/spec.md) · [MIT license](./LICENSE)
