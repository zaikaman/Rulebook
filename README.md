# Rulebook

Rulebook is a Set It and Forget It entry for the [Reactive Omni Buildathon](https://dorahacks.io/hackathon/reactive-omni-buildathon). It lets a person who can connect a wallet leave a personal automation running: buy on a schedule, forward part of an incoming payment, refill a balance, sell when a pool price moves, or pay a chosen wallet after a long silence.

You describe the workflow in the app. Your wallet owns an Agent on Reactive Lasna and a Vault on Unichain Sepolia. The Agent subscribes to the logs that workflow needs, evaluates them in `react`, and asks Reactive to call the Vault. The Vault checks the program you signed and then swaps, transfers, refills, records an alert, or records a skip. Stopping the app leaves a funded workflow running.

Testnet only. You fund the Vault and the two network credits yourself.

## What to open first

The judging bar for this track is a reactive transaction, the callback it causes, a tool worth leaving on, and a repository someone else can follow. Start with the receipts, then the two contracts that produced them.

| Open this                                                                  | What it shows                                                                   |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| [Income payment of 1.20 USDC](#a-payment-that-takes-three-different-paths) | One `Transfer` becomes a Lasna decision and a Unichain payout.                  |
| [Scheduled buy](#a-schedule-that-fires-on-the-next-lasna-block)            | `Cron100` on Lasna, `react` on the next block, swap through the callback proxy. |
| [`WorkflowAgentV2.sol`](contracts/src/workflow/v2/WorkflowAgentV2.sol)     | Subscriptions, price and activity memory, `Dispatched`, `requestCallbackV_1_0`. |
| [`WorkflowVaultV2.sol`](contracts/src/workflow/v2/WorkflowVaultV2.sol)     | The signed program, per-run caps, weekly budget, and the settlement.            |

## A payment that takes three different paths

The workflow is an income sweep. It watches USDC transfers into one Vault. The signed program has two payment thresholds:

- A payment of at least 1.00 USDC sends 0.20 USDC to the chosen recipient.
- A smaller payment of at least 0.25 USDC sends 0.05 USDC.
- Anything below both thresholds is skipped. The workflow stays on.

Three USDC transfers into the same Vault each completed the loop: Unichain `Transfer`, Lasna `react`, Unichain callback.

| Payment in | Path | Vault did             | Origin `Transfer`                                                                                                | Lasna `react`                                                                                                    | Callback                                                                                                         |
| ---------- | ---- | --------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 1.20 USDC  | 1    | Sent 0.20 USDC        | [0xf33c…0d06](https://sepolia.uniscan.xyz/tx/0xf33c393a34baedf2bdc269bb7d122c733652b7709322848288384c677e720d06) | [0x1057…d05d](https://lasna.reactscan.net/tx/0x10575cea252fe5122060a299431d0209177caadc8096ef4b6e537f25cceed05d) | [0x6be4…41d9](https://sepolia.uniscan.xyz/tx/0x6be469dd6660dd8f51b994a75bbebd4b6e6fff82e1bb300eb270e3204daf41d9) |
| 0.60 USDC  | 3    | Sent 0.05 USDC        | [0x1c0d…3f41](https://sepolia.uniscan.xyz/tx/0x1c0dd824715e5648d705d6333acc0a31c58ac050a5fd7c236013e1287e6d3f41) | [0x82d3…14b2](https://lasna.reactscan.net/tx/0x82d3a2d72ecb81e4ec5329b968604975fd4de47eab0f59d122e529d8049514b2) | [0x3b83…8422](https://sepolia.uniscan.xyz/tx/0x3b833b455c8d2049731fbf5de73af7f564df3761c195eda9a8c0cabb6ef88422) |
| 0.10 USDC  | 4    | Skipped, sent nothing | [0xd524…9c48](https://sepolia.uniscan.xyz/tx/0xd524491816c3c9705642f3666db717d53523cfc7ca97da5f55fca912c3839c48) | [0xea4e…62ff](https://lasna.reactscan.net/tx/0xea4e23fef81ff6e34a18f298a5fa71ea51388b00d4a9fbf3487f130212af62ff) | [0x9b19…ad23](https://sepolia.uniscan.xyz/tx/0x9b1962cb1ac8b3aa6ed6563d3f8e34a3353cc4dcb3fa174ca7e77a55b109ad23) |

The 1.20 USDC payment was mined on Unichain at 14:08:49 UTC. The callback was mined at 14:08:52 UTC. The skip has a callback too: the destination receipt contains the Vault and no USDC transfer. The same event still woke the Agent, and the Vault still applied the signed program.

That sweep belongs to this wallet:

| Contract | Address                                                                                                                        |
| -------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Agent    | [`0x9934ECb31a427Fc3fac22075b6E0198842729825`](https://lasna.reactscan.net/address/0x9934ECb31a427Fc3fac22075b6E0198842729825) |
| Vault    | [`0xBf523873d349863BF491218885Ac00FB2A077Aa3`](https://sepolia.uniscan.xyz/address/0xBf523873d349863BF491218885Ac00FB2A077Aa3) |

On the Lasna receipt, the transaction is sent to the system contract. The Agent emits `Dispatched` from inside that call. On Unichain, the settlement transaction is sent to the callback proxy, and the Vault emits `Outcome`.

## A schedule that fires on the next Lasna block

The same wallet ran a scheduled buy. It watches `Cron100` at `0x0000000000000000000000000000000000fffFfF`. Its tick and its `react` are consecutive Lasna blocks, one second apart on Lasna's clock. The swap landed on Unichain two seconds after `react`. The destination receipt moves USDC and WETH through the configured pair.

| Workflow      | Origin                                                                                                                             | Lasna `react`                                                                                                                 | Callback                                                                                                                         |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Scheduled buy | [Lasna `Cron100`, 14:09:43 UTC](https://lasna.reactscan.net/tx/0x90e7ceab0787e7cb926f2204b41e111d2f0ce059b591d3eb9e9606af2b97422a) | [Next block, 14:09:44 UTC](https://lasna.reactscan.net/tx/0x880bd1a467b7a59a56d41bdad25938d47686f0936c5122f87def8b1f2d7e6001) | [Unichain swap, 14:09:46 UTC](https://sepolia.uniscan.xyz/tx/0x43561295b2dc38ca88cb799ae13608d2b07f43c8aa68b85bcf798ffb6c670e7c) |

Both runs are recorded in [`deployments/workflows-v2-smoke.json`](deployments/workflows-v2-smoke.json), which also names the factories and commit that produced them.

## What you can leave running

Open **Workflows → New workflow**, pick a recipe, and fill in the amounts. The same screen can start from a blank canvas. A check splits the workflow into a Yes path and an Otherwise path. Each path holds up to three checks and three ordered actions. The review names the network, the amounts, the recipient, the caps, and the expiry before the wallet signs.

| You want                              | Recipe               | What wakes it                           | What the Vault can do                          |
| ------------------------------------- | -------------------- | --------------------------------------- | ---------------------------------------------- |
| Buy a fixed amount on a timer         | Scheduled buy        | `Cron100`                               | Swap USDC for WETH                             |
| Buy only after a drop                 | Buy more on a dip    | `Cron100`, using the latest `Sync`      | Swap, or skip                                  |
| Buy if the price reaches a limit      | Limit buy            | Pair `Sync`                             | One swap, then the workflow closes             |
| Sell into strength                    | Take profit          | Pair `Sync`                             | One swap, then the workflow closes             |
| Sell if the price falls from its high | Trailing stop        | Pair `Sync`                             | One swap off a fixed stop or a trail           |
| Trade around a reference price        | Price-band trading   | Pair `Sync`                             | Buy below the band, sell above it              |
| Pay someone on a timer                | Recurring transfer   | `Cron100`                               | Send USDC                                      |
| Forward part of income                | Income sweep         | USDC `Transfer` into the Vault          | Send a larger or smaller amount, or skip       |
| Top up the Vault from your wallet     | Balance refill       | `Cron100`                               | `transferFrom` up to the allowance and the cap |
| Name a recipient if you go quiet      | Inactivity payout    | `Cron100`, plus your own USDC transfers | One payout after a 24-hour grace period        |
| Hear about a price                    | Price alert          | Pair `Sync`                             | Record an alert, move no funds                 |
| Hear when a price leaves a range      | Price-range alert    | Pair `Sync`                             | Record an alert                                |
| Hear about a large movement           | Large-transfer alert | `Transfer` of a token you name          | Record an alert                                |

Price checks use the last `Sync` on the configured USDC/WETH pair, quoted as USDC per WETH. The Agent keeps that price, the previous price, and, for a trailing stop, the high since the workflow was enabled. A dip compares the two prices.

An inactivity payout needs an explicit confirmation in the review, a fixed recipient and amount, and at least one day of silence. Silence means no USDC `Transfer` from the owner. When the grace period starts, the owner can check in. A check-in clears the pending payout. The payout can happen only once.

A weekly spending budget is optional and per asset. It sits on top of the per-run caps. A run that would cross either weekly limit is skipped whole, the workflow stays active, and the reason is **Run would exceed the weekly spending budget**. The counter resets Monday at 00:00 UTC from the Unichain block timestamp. Editing the budget leaves the schedule and the inactivity window where they are.

The Marketplace lists a workflow you choose to publish. The factory reads the program hash from your Agent, so the listing matches the program you enabled. Someone else can copy it. The copy arrives as their draft with the recipient, the watched wallet, the expiry, and the spending limits empty. They sign it onto their own Agent and fund their own Vault. Publishing, or unpublishing, leaves your workflow running.

Activity shows each run and the path that was taken. **Public proof** is a link to the origin, the Lasna decision, and the settlement. It opens without a wallet. Telegram can send funding warnings, failure and inactivity warnings, and per-workflow run messages. Those messages are notices. The callback remains the settlement.

An optional drafter can turn a sentence into a workflow draft. You still review the program and sign both transactions. The Agent stores those signed bytes, and settlement reads them from the Agent.

## How a run happens

```mermaid
sequenceDiagram
    actor Owner
    participant Vault as Vault on Unichain Sepolia
    participant Agent as Agent on Reactive Lasna
    participant System as System contract
    participant Proxy as Callback proxy
    Owner->>Vault: authorizeWithWeeklyBudget
    Owner->>Agent: enable
    Agent->>System: subscribe to the logs this program needs
    System->>Agent: react(log)
    Agent->>System: requestCallbackV_1_0
    System->>Proxy: deliver the callback
    Proxy->>Vault: execute(agent, workflow, run)
    Vault->>Vault: walk the signed program and settle or skip
```

1. The owner signs `authorizeWithWeeklyBudget` on the Vault. That stores the program, its hash, the epoch, the title, and the weekly limits.
2. After that authorization is mined, the owner signs `enable` on the Agent. The Agent checks the same bytes, stores them, and subscribes through the system contract at `0x8888888888888888888888888888888888888888`.
3. A schedule subscribes to `Cron100` on Lasna. A dip or a price workflow also subscribes to `Sync` on the pair. A payment workflow subscribes to USDC transfers into that Vault. A watched-wallet workflow subscribes to transfers of the named token. An inactivity workflow also watches USDC leaving the owner. A one-shot workflow subscribes to the Vault's own `Closed` event and removes its subscriptions after it finishes.
4. `react` accepts only the system contract. It ignores logs the program did not subscribe to. For a schedule it waits until `nextDue`, then carries the cached price or the last activity time. For a price log it updates the cached price and the trailing high. For a transfer it carries the amount and the counterparty. It builds a `Run` that names the origin chain, transaction, log index, and block.
5. The Agent emits `Dispatched` and calls `requestCallbackV_1_0`. The callback targets chain 1301, this owner's Vault, and an 850,000 gas limit. The payload expires ten minutes after the Lasna block. The same origin log cannot dispatch twice.
6. The callback proxy injects the Agent address as the first argument. `execute` requires that caller to be the proxy and that injected address to be the Vault's immutable Agent. A mismatched program hash, epoch, or stale origin is recorded as a skip. An expired payload is recorded as expired.
7. The Vault walks the tree. Caps, slippage, the weekly budget, a one-hour price age, and the inactivity grace period are enforced in that call. A failing step rolls the whole run back, and the Vault still records the outcome. Statuses are confirmed, skipped, expired, failed, and in grace period.

The owner pauses a workflow by revoking the Vault authorization, then disabling it on Lasna. The owner can withdraw Vault principal and recover ETH that was sent to the Vault by mistake. ETH held by the Vault does not pay for callbacks. Callback gas is paid from execution credit deposited to the proxy for that Vault. Lasna gas is paid from watching credit deposited to the system contract for that Agent.

## Limits of one account

These bounds are in the contracts, and the builder enforces the same ones before it asks for a signature.

| Bound                               | Value                              |
| ----------------------------------- | ---------------------------------- |
| Active workflows per Agent          | 4                                  |
| Nodes in one program                | 15                                 |
| Checks on one path                  | 3                                  |
| Actions on one path                 | 3                                  |
| Schedule interval                   | 120 seconds to 30 days             |
| Slippage                            | At most 10%                        |
| Callback gas                        | 850,000                            |
| Callback lifetime                   | 10 minutes                         |
| Price observation age               | 1 hour                             |
| Inactivity minimum                  | 1 day, then a 24-hour grace period |
| Title                               | 1 to 80 characters                 |
| Settlement chain in this deployment | Unichain Sepolia, chain id 1301    |

Intervals, expiries, and the weekly reset use timestamps. A per-run cap is the most the path can spend. The weekly budget, when set, can only make that smaller.

## Contracts and networks

| Role                         | Network                 | Contract                 | Address                                                                                                                              |
| ---------------------------- | ----------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Current Agent factory        | Reactive Lasna, 5318007 | `WorkflowAgentFactoryV2` | [`0x5a7c7c075a0cc782c5f6167f2344e83b00937851`](https://lasna.reactscan.net/address/0x5a7c7c075a0cc782c5f6167f2344e83b00937851)       |
| Current Vault factory        | Unichain Sepolia, 1301  | `WorkflowVaultFactoryV2` | [`0xe09f394c4806a1b8f6dc12a6b8f9538b29392261`](https://sepolia.uniscan.xyz/address/0xe09f394c4806a1b8f6dc12a6b8f9538b29392261)       |
| Factory deployment, Lasna    |                         |                          | [0xfb74…e0d4](https://lasna.reactscan.net/tx/0xfb74ad83db04ae71521da63ed72344340ffab2256b6d453eba576217c613e0d4) at block 8,977,941  |
| Factory deployment, Unichain |                         |                          | [0x8454…0157](https://sepolia.uniscan.xyz/tx/0x8454200c24e297ad2ecd6354fdff1364a80a27b141a73ecc6f1a481f32300157) at block 68,502,251 |
| System contract              | Reactive Lasna          | Reactive Omni            | [`0x8888888888888888888888888888888888888888`](https://lasna.reactscan.net/address/0x8888888888888888888888888888888888888888)       |
| Callback proxy               | Unichain Sepolia        | Reactive Omni            | [`0x775c9B990ADe401060B78D0e98684eEf8d2466C1`](https://sepolia.uniscan.xyz/address/0x775c9B990ADe401060B78D0e98684eEf8d2466C1)       |
| Cron                         | Reactive Lasna          | `Cron100`                | [`0x0000000000000000000000000000000000fffFfF`](https://lasna.reactscan.net/address/0x0000000000000000000000000000000000fffFfF)       |
| USDC                         | Unichain Sepolia        |                          | [`0x31d0220469e10c4E71834a79b1f276d740d3768F`](https://sepolia.uniscan.xyz/address/0x31d0220469e10c4E71834a79b1f276d740d3768F)       |
| WETH                         | Unichain Sepolia        |                          | [`0x4200000000000000000000000000000000000006`](https://sepolia.uniscan.xyz/address/0x4200000000000000000000000000000000000006)       |
| Pair                         | Unichain Sepolia        |                          | [`0x1d8698365321D6DcE1F7141c380C866b012eE9dA`](https://sepolia.uniscan.xyz/address/0x1d8698365321D6DcE1F7141c380C866b012eE9dA)       |
| Router                       | Unichain Sepolia        |                          | [`0x6e8C9D62A16419357eA998229126D2fD6B1CCfbF`](https://sepolia.uniscan.xyz/address/0x6e8C9D62A16419357eA998229126D2fD6B1CCfbF)       |

Each wallet calls `create()` on the Lasna factory and receives a clone of `WorkflowAgentV2`. It then calls `create(agent)` on the Unichain factory and receives its own `WorkflowVaultV2`. A second call returns the contract that wallet already owns. The owner links the Vault from the Agent. Setup can resume after either deployment.

The factories that produced the 22 November receipts above were deployed from commit `df0b79d` and are the only pair recorded in [`deployments/workflows-v2.json`](deployments/workflows-v2.json). The backend and frontend read their factory addresses and start blocks from that record.

Lasna RPC: `https://lasna-rpc.rnk.dev/`. Unichain Sepolia RPC: `https://sepolia.unichain.org`. Explorers: [lasna.reactscan.net](https://lasna.reactscan.net) and [sepolia.uniscan.xyz](https://sepolia.uniscan.xyz).

## Using the app

Connect a wallet that can sign on both networks. Add Reactive Lasna if the wallet asks: chain id `5318007`, the RPC above, and symbol `REACT`.

1. Open **Account & Vault**. Create the Agent on Lasna, create the Vault on Unichain Sepolia, and link them. Each step is a transaction from your wallet. If one of them is already deployed, setup continues from the missing step.
2. Fund three balances, shown separately. Vault USDC pays for buys, transfers, and refunds. Vault WETH is used by workflows that sell WETH. Execution credit is testnet ETH deposited to the callback proxy for your Vault. Watching credit is testnet REACT deposited to the Lasna system contract for your Agent.
3. Build a workflow. A balance refill also asks you to approve the Vault to pull USDC from your wallet, up to the per-run cap.
4. Sign the Unichain authorization, then sign `enable` on Lasna. The review shows the caps before either signature.
5. Open **Activity** for the path and the receipts. Open **Public proof** for a link you can share. **Workflow costs** shows the credits and a live gas quote.

The app reads chain state through its API. The API has no key that can move Vault principal.

## Repository

| Path                                       | What it is                                                                        |
| ------------------------------------------ | --------------------------------------------------------------------------------- |
| `contracts/src/workflow/v2/`               | Agent, Vault, factories, program validator, and the settlement calls.             |
| `contracts/src/chain/ChainConfig.sol`      | The only chain-address literals in the Solidity sources.                          |
| `contracts/test/`                          | Foundry unit and integration tests, including the recipe matrix.                  |
| `packages/shared/src/workflowV2Recipes.ts` | The 13 recipes. The builder encodes them into the program the contracts validate. |
| `packages/shared/src/chains.ts`            | Chain ids, RPC URLs, and token addresses for the app.                             |
| `frontend/src/workflows/`                  | The canvas, review, account, activity, proof, and marketplace screens.            |
| `backend/src/workflows/`                   | The indexer and the read API.                                                     |
| `deployments/`                             | Factory addresses, creation transactions, and the live-loop record.               |
| `docs/workflows.md`                        | Operator notes for funding, pause, and the weekly budget.                         |
| `docs/submission-evidence.md`              | The cross-chain receipts for the workflow runs.                                   |

## Run the tests

Node.js 24 or newer, npm, and Foundry with Solidity 0.8.29.

```powershell
npm install
npm test -w packages/shared
npm test -w contracts
```

`npm test -w contracts` runs `forge test`. The integration tests deploy the real Agent and Vault against a mock system contract and a mock callback delivery, then assert the path, the balances, and a replay that must not settle again.

```powershell
npm run verify
npx playwright test
```

`npm run verify` is the repository gate: formatting, the Foundry suite and its gas snapshot, coverage, the frontend and backend build, typecheck, unit tests, lint, and the secret scan. Playwright covers the browser flows against a local chain. Running the app against the public testnets also needs `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and the same `WORKFLOW_V2_DEPLOYMENT` JSON on the backend and `VITE_WORKFLOW_V2_DEPLOYMENT` on the frontend. The shape is `{ lasna: { factory, startBlock }, unichain: { factory, startBlock } }`. Set `VITE_WORKFLOW_V2_ACTIVATION=true` to allow new activations. Deployment steps are in [`docs/workflows.md`](docs/workflows.md).

## License

[MIT](LICENSE). Reactive Network's system contract and callback proxy are theirs. This repository is the factories, the Agent, the Vault, and the app.
