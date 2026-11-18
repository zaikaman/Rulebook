# Submission evidence

## US7 · Wallet signatures and network visibility

The Chromium test `frontend/e2e/network-legibility.spec.ts` walks a fresh fixture wallet from
setup through withdrawal against local Anvil and the fixture backend.

| Step                 | Verified behavior                                                                                                      |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Vault authorization  | The review names Unichain Sepolia before the wallet signs the vault deployment authorization.                          |
| Account linking      | The app waits for explicit switch confirmation, then shows the Reactive Lasna review before the wallet signs.          |
| Starter funds        | The funding section names Unichain Sepolia. The sponsor sends 10 USDC and 0.01 WETH without a wallet request.          |
| Rule creation        | The app shows the Reactive Lasna switch and signature review before creating the rule.                                 |
| Account and balances | Both explorer links use the configured networks. Principal, execution cost, and watching credit have their own labels. |
| Withdrawal           | The app shows the Unichain Sepolia switch and review. After the receipt confirms, the USDC principal is zero.          |

The frontend tests also exercise keyboard focus and Escape cancellation in both prompts, rejection
of a wallet that changes accounts or networks mid-review, and the mirror write adapter's displayed
spend cap and signed arguments.

## US8 · Mirror

The Foundry integration scenario verified two independent swaps and no third swap
after replay. Playwright verifies two destination rows with separate explorer links
using a fixture.

On 18 November 2026, the live leader swap spent 1 USDC and the follower swap spent
0.5 USDC. Each swap settled in its own Unichain Sepolia transaction.

- [Leader destination](https://sepolia.uniscan.xyz/tx/0xccf64f31878be71e8c0d3ba0dee0700e05d4d4bf0dc0e24d789a39e7e872bdcc)
- [Follower destination](https://sepolia.uniscan.xyz/tx/0x1b01d4dff73a83807bf4c396ee49a0baa58463bb4e8fc448d8693d66e4438251)

A read-only replay of the same leader log against confirmed Lasna state evaluated
false and requested zero callbacks. The live vault receipts confirmed both swaps.
Lasna `getCallbacks` returned empty arrays during verification, so the grouped
proof remains verified by fixture. [Full transaction and replay evidence](./measurements.md)

## Phase 11 release validation · 18 November 2026

| Quickstart               | Result                                                                                          | Evidence                                                                                                                                                                                                                           |
| ------------------------ | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V1 · Hermetic gate       | Local tests and builds verified. Solidity lint remains open.                                    | Foundry ran 219 tests with zero failures or skips. The committed coverage summary records core branch coverage of 92.16–100%. Solhint 6.2.5 reported 389 warnings using the repository’s current rules.                            |
| V2 · Account and custody | Passed with local Anvil and the fixture API.                                                    | The browser created the Agent and Vault, claimed 10 test USDC, then withdrew 10 USDC as the owner. The setup tests cover partial deployments and retries.                                                                          |
| V3 · Compose and launch  | Passed with local Anvil.                                                                        | The DCA browser test checks the calldata and single rule signature. The shared encoder tests cover all 13 templates.                                                                                                               |
| V4 · Proof of the loop   | Three live receipts verified. Direct callback lookup and the 10-run latency sample remain open. | The leader settled 3 seconds after the pool event. Browser fixtures verified the three-row proof and latency display.                                                                                                              |
| V5 · Rule controls       | Passed with local Anvil and Foundry.                                                            | Playwright verified pause and persisted order. Foundry exercised the rule limit, inactive execution and subscription release.                                                                                                      |
| V6 · Budget visibility   | Passed in contract and frontend tests.                                                          | The sponsor tests cover reserve credit and debt. The account view shows the three balances separately. Operator top-up instructions are in the runbook.                                                                            |
| V7 · Template sweep      | Passed with the local template matrix.                                                          | Foundry and encoder tests cover the 13 templates. The live per-template wallet sweep is pending.                                                                                                                                   |
| V8 · Clone               | Passed with local Anvil. Live clone receipt pending.                                            | The browser created the clone on the second wallet’s Agent and opened its rule detail.                                                                                                                                             |
| V9 · Mirror              | Two live settlements and the duplicate replay verified. Live grouped API proof pending.         | Leader and follower settled 2 seconds apart. Replay requested zero additional callbacks. The grouped browser proof passes with a fixture.                                                                                          |
| V10 · Hosts              | Pending.                                                                                        | Heroku has no web dyno and returned HTTP 502 at `/health`. Vercel rejected the available CLI token and no production deep link was verified. A real Supabase keep-alive SELECT succeeded once. The 24-hour observation is pending. |

[Coverage report](../contracts/.coverage-summary.json) · [Performance and live receipts](./measurements.md) · [75-second walkthrough](./demo.mp4)

### Submission checklist audit

| Requirement                              | Result                                                                                                                |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Public source repository and MIT license | GitHub reported `PUBLIC`. The Phase 11 tree includes the MIT license.                                                 |
| Lasna Agent                              | Validation leader `0x7668aC28f434B622F352ed281Fa6ECA1f1227bcC`.                                                       |
| Unichain Sepolia Vault                   | Validation leader `0xEcdDD6b5317ed92b162c2de8523649430E9eA0A5`.                                                       |
| Lasna registry                           | Configured registry `0x743Bd5c1DE57Fb4E4F88CF020dcfFAeE670b959e`.                                                     |
| Origin → Reactive → callback             | Three leader receipts linked below.                                                                                   |
| Clone hash                               | Local Anvil flow passed. Testnet receipt pending.                                                                     |
| Mirror hash                              | The testnet follower receipt records `Mirrored`.                                                                      |
| Indexer-independent `getCallbacks`       | Direct Lasna reads returned empty arrays for both reactive transactions. The destination receipts confirm the trades. |
| Demo video under three minutes           | The 75-second walkthrough names the local fixtures and shows the recorded settlement receipts.                        |

- [Public repository](https://github.com/zaikaman/Rulebook)
- [Lasna Agent](https://lasna.reactscan.net/address/0x7668aC28f434B622F352ed281Fa6ECA1f1227bcC)
- [Unichain Vault](https://sepolia.uniscan.xyz/address/0xEcdDD6b5317ed92b162c2de8523649430E9eA0A5)
- [Lasna registry](https://lasna.reactscan.net/address/0x743Bd5c1DE57Fb4E4F88CF020dcfFAeE670b959e)
- [Origin](https://sepolia.uniscan.xyz/tx/0x4f0e01bcd4234cbc21c546aea55283756f5111d0acd8099ccbbbd47f61bddfb8) · [Reactive evaluation](https://lasna.reactscan.net/tx/0xde8907ed2c7bb26bca3796f73c5c6779b9e4eb472193ad6c7a675293ea9dfd98) · [Destination](https://sepolia.uniscan.xyz/tx/0xccf64f31878be71e8c0d3ba0dee0700e05d4d4bf0dc0e24d789a39e7e872bdcc)
- [Mirror attachment](https://lasna.reactscan.net/tx/0x66d09b254a9b915193c2c419bacddb24268f3da0ebe06d1c37b74494d542c1ea) · [Mirror settlement](https://sepolia.uniscan.xyz/tx/0x1b01d4dff73a83807bf4c396ee49a0baa58463bb4e8fc448d8693d66e4438251)
