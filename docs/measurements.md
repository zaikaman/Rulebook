# Measurements

## Phase 11 frontend and API timing

Measured on **2026-11-18** on the local Windows workstation with Node.js 24.11.1
and Playwright Chromium 159.0.8154.6. The browser loaded the production Vite build
via `vite preview`. Each of 20 navigations to `/proof/:hash` used a fresh Chromium
context at 1440×900. The browser received a fixed three-row proof payload. We recorded
first contentful paint from the Paint Timing API and separately timed when the third
proof row became visible.

| Browser measurement          |      p50 |      p95 |
| ---------------------------- | -------: | -------: |
| First contentful paint       |   144 ms |   148 ms |
| All three proof rows visible | 187.5 ms | 193.8 ms |

For the API, each route received five warm-up requests followed by 30 sequential
loopback requests against the real Fastify fixture server and its in-memory store.
The timer covered the request and response-body read. Percentiles use nearest rank.

| API route         |    p50 |    p95 |
| ----------------- | -----: | -----: |
| `/health`         | 0.6 ms | 1.3 ms |
| `/v1/chains`      | 0.6 ms | 1.0 ms |
| `/v1/marketplace` | 0.5 ms | 0.7 ms |
| `/v1/leaderboard` | 0.4 ms | 0.5 ms |
| `/v1/executions`  | 0.4 ms | 0.6 ms |

The local run meets the 2 s paint and 300 ms API targets. Hosted latency through
Heroku, Supabase and both public RPCs still needs measurement.

## Phase 10 mirror verification

On 18 November 2026, the Lasna and Unichain Sepolia validation run confirmed one
leader swap and one follower swap. The follower scaled the input by 5,000 bps and
spent its 0.5 USDC cap.

| Step                          | Transaction                                                                                                      | Verified outcome                                                  |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Unichain pool trigger         | [0x4f0e…dfb8](https://sepolia.uniscan.xyz/tx/0x4f0e01bcd4234cbc21c546aea55283756f5111d0acd8099ccbbbd47f61bddfb8) | `Sync` at block 68,164,045                                        |
| Lasna leader evaluation       | [0xde89…fd98](https://lasna.reactscan.net/tx/0xde8907ed2c7bb26bca3796f73c5c6779b9e4eb472193ad6c7a675293ea9dfd98) | `RuleEvaluated` records the trigger and a fired rule              |
| Unichain leader destination   | [0xccf6…bdcc](https://sepolia.uniscan.xyz/tx/0xccf64f31878be71e8c0d3ba0dee0700e05d4d4bf0dc0e24d789a39e7e872bdcc) | `Executed`, 1 USDC → 0.000665954527415238 WETH                    |
| Lasna follower evaluation     | [0x3b72…8d9d](https://lasna.reactscan.net/tx/0x3b7298410dadf03d984f6034f0ce3c850ac7042a753898f1c45b29f46f738d9d) | `MirrorCallbackRequested` names the exact leader destination hash |
| Unichain follower destination | [0x1b01…8251](https://sepolia.uniscan.xyz/tx/0x1b01d4dff73a83807bf4c396ee49a0baa58463bb4e8fc448d8693d66e4438251) | `Mirrored`, 0.5 USDC → 0.000332947633510694 WETH                  |

Unichain block timestamps put the leader trade 3 seconds after the trigger and the
follower trade 2 seconds after the leader. The proxy transactions used 227,682 and
250,357 gas respectively. The initial run reached the follower vault with 218,395 gas
and ran out. A historical trace confirmed that a 600,000 callback budget resolved the
failure. The live retry used that budget.

### Duplicate delivery

At confirmed Lasna block 8,662,750, a read-only RPC replay called the follower's
`react` with the original Unichain `Executed` log, including its transaction hash and
log index. The trace returned `RuleEvaluated(fired=false)`, zero external calls, and
zero `MirrorCallbackRequested` events. The live receipts contained one leader and
one follower execution. The replay ran against confirmed testnet state without
broadcasting another transaction.

Both swaps were verified through their Unichain proxy calldata, vault receipts, and
the linking events on Lasna. The Lasna system contract's `getCallbacks` returned an
empty array for both reactive hashes during verification, so the live grouped API
proof is still pending.

### Validation contracts

These deployments were isolated from the app's configured factories. Both factory
creation transactions reproduce the bytecode at `b22172e`. The deployer was
`0xC2500C19C77de23443AF5B559a3dADB283DAD41C`.

| Contract       | Chain ID | Address                                      | Deployment                                                                                                            |
| -------------- | -------: | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| AgentFactory   |  5318007 | `0x16eab90a886df9b7e362e799269c8543a1d99dc7` | [Lasna receipt](https://lasna.reactscan.net/tx/0x40679f220bb3d5258ccc64c1de06d30152cd1682a7df5cd54ebe01cb1fc868eb)    |
| VaultFactory   |     1301 | `0x24a445e555cc4762357bfba071ff35ad464fa89e` | [Unichain receipt](https://sepolia.uniscan.xyz/tx/0x1c9e468a84f7a7608aa606146ec7b3d33f4ad017a5fdd22f21c8306e18f674f8) |
| Leader Agent   |  5318007 | `0x7668aC28f434B622F352ed281Fa6ECA1f1227bcC` |                                                                                                                       |
| Leader Vault   |     1301 | `0xEcdDD6b5317ed92b162c2de8523649430E9eA0A5` |                                                                                                                       |
| Follower Agent |  5318007 | `0x271E55f2F7eDF726256503490ed133B496827dc5` |                                                                                                                       |
| Follower Vault |     1301 | `0x71Fc041dFCF40887E43918E20363Fe6f0A6Bc33C` |                                                                                                                       |

### Local verification

The Foundry integration test used the real Agent and Vault code with a mock pool,
router, Reactive system and callback delivery. One leader event produced two successful
swaps. The leader spent 2 USDC and the follower spent 0.8 USDC at 5,000 bps with a
0.8 USDC cap. Replaying the same event left the request and swap counts at two.

The Playwright fixture uses synthetic hashes to exercise the two destination explorer
links.

## Testnet seed

Configure `AGENT_FACTORY_ADDRESS`, `VAULT_FACTORY_ADDRESS`, `LASNA_RPC_URL`, and
`UNICHAIN_RPC_URL` for the Phase 10 testnet deployment. Run
`npm run seed:mirror -w backend` with distinct funded demo wallets in
`MIRROR_LEADER_PRIVATE_KEY` and `MIRROR_FOLLOWER_PRIVATE_KEY`, and set the two
execution credit targets in `MIRROR_AGENT_RESERVE_WEI` and `MIRROR_VAULT_RESERVE_WEI`.
The seed deposits demo principal, creates a private limit buy and its mirror, and calls
`sync()` on the configured pool to trigger the rule. It prints the creation,
attachment, and trigger hashes.
