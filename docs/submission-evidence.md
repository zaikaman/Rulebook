# Submission evidence

## Workflow V2 cross-chain testnet verification · 20–21 November 2026

Workflow V2 operates across Reactive Lasna (automation and monitoring) and Unichain Sepolia (vault custody and settlement). The live loops below demonstrate multi-path branch evaluation, scheduled execution, and destination callback settlement.

### Multi-path branching income sweep

The income sweep workflow watches USDC transfers into the Vault (`0xC15a2BA79c63bd462f362867446E9a33731b814f`) linked to Agent `0xebDA1C4d66D80CE37AdcE33D0F524645b01CcFf0`. The program checks incoming deposit size:

- Path 1: Deposits >= 1.00 USDC send 0.20 USDC to the recipient.
- Path 3: Deposits >= 0.25 USDC send 0.05 USDC to the recipient.
- Path 4: Deposits < 0.25 USDC are skipped; no funds move and the workflow remains active.

| Payment   | Path | Vault action     | Origin transfer                                                                                                  | Lasna react                                                                                                      | Unichain callback                                                                                                |
| --------- | ---- | ---------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 1.20 USDC | 1    | Sent 0.20 USDC   | [0x7e60…b636](https://sepolia.uniscan.xyz/tx/0x7e60500a6ebdd08ef4cfd561d40030f01d8342233655781c341c6d4d3c19b636) | [0xf968…9a48](https://lasna.reactscan.net/tx/0xf96813b6dab95a46947a0befae6c002c54dd2b43de1860d5f675c64d89609a48) | [0x45a1…f7fd](https://sepolia.uniscan.xyz/tx/0x45a1fd070af63bfb19218a639ddb96430f8626806a08c08b8aa51a1a7459f7fd) |
| 0.60 USDC | 3    | Sent 0.05 USDC   | [0x0b1a…f1a9](https://sepolia.uniscan.xyz/tx/0x0b1a50868ff8bf8f439811ddd9aa245d6a707c9603dbe9b6dc06c7933b08f1a9) | [0x2823…4e39](https://lasna.reactscan.net/tx/0x2823d68d1cef33f6e35b79a2a2632fb6869cb2e5fb7afdb65ff9e01d13884e39) | [0xc62b…e708](https://sepolia.uniscan.xyz/tx/0xc62b69b6a9c539ae3fe90dddc39f745d6ca82331fe3d6a0666904b7acdfbe708) |
| 0.10 USDC | 4    | Skipped (0 sent) | [0x66b0…0e0c](https://sepolia.uniscan.xyz/tx/0x66b0bc6dcd6fc0ced78cd76583f4d675a4f2acbc69a05120ba173e7d1da10e0c) | [0x4608…24f5](https://lasna.reactscan.net/tx/0x4608a32e7b6e88e8aa4fd64dcf4850be8e2fe1a88c0aa357c22456384a3c24f5) | [0x793f…a04e](https://sepolia.uniscan.xyz/tx/0x793fbf8706c668bcd67594723be17d5f36a08853a6b9303a355f7f4bf5a4a04e) |

### Scheduled executions and alerts

On Agent `0x0b5948c756d517d9a297bcd800e695381e4fb87c` and Vault `0x1fefEe31b60a84583F80ff5063cbe9547D535ccB`:

| Workflow              | Origin event                                                                                                                     | Lasna react                                                                                                                   | Destination callback                                                                                                             |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Scheduled buy (run 1) | [Lasna Cron100, 10:13:09 UTC](https://lasna.reactscan.net/tx/0x5ba44715cec17b1d754447d29fd46dff7e49838c9909f2dcacb52cb08d0de329) | [Next block, 10:13:10 UTC](https://lasna.reactscan.net/tx/0xc89b6df3119dc50d676a47b68a312e821a32c57cf0f6b84f5eee1251abc85f7f) | [Unichain swap, 10:13:13 UTC](https://sepolia.uniscan.xyz/tx/0xbce50a688b997c5ccbdc12839b50df57b11ffbe8bf30c9331b696d24495ad0dc) |
| Scheduled buy (run 2) | [Cron tick](https://lasna.reactscan.net/tx/0x84db004be1e69e504071f599334804808945083e158f47bdb20febd94f821f0c)                   | [Lasna react](https://lasna.reactscan.net/tx/0xb270a37d8d349166592d931c5f7ef1f98bb9447fb6cd13dfa614ee8720dc26ee)              | [Unichain swap](https://sepolia.uniscan.xyz/tx/0x7769b5b93da5a98681f3be60ec6ee2f8cd751bcb415a2866dee33bf7a65db3c9)               |
| Recurring transfer    | [Cron tick](https://lasna.reactscan.net/tx/0xdec71c1cf18b841b5bbc2d21cfd1f138c94de4566d3d3e35490b23897e92f6d0)                   | [Lasna react](https://lasna.reactscan.net/tx/0x6c090746325bb6736be55e852be78a36719a17b2292b63b1c5e2965bc77c61b2)              | [USDC payout](https://sepolia.uniscan.xyz/tx/0x5c1f5e3678a7ab026e59a70d77117e650930798bb5a1eb4d618ba864ae5e11a4)                 |
| Large-transfer alert  | [Unichain Transfer](https://sepolia.uniscan.xyz/tx/0xa742275a08ff7b8cc7b595483d5ca38d4d28bee67324d5b0921c035d45fb4add)           | [Lasna react](https://lasna.reactscan.net/tx/0x0ed6f3df9e48b814edf0704c73013876ee88cd9fa579815628d1f8dbf5c010f1)              | [Alert outcome](https://sepolia.uniscan.xyz/tx/0xa8298ed04430d8d1e1cdac53fc7e564d8cd610bab141110b2e29ca9afc61389a)               |

See [Workflow V2 smoke records](../deployments/workflows-v2-smoke.json) and [Workflow V2 verification](../deployments/workflows-v2-verification.json).

---

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

| Quickstart               | Result                                                                                          | Evidence                                                                                                                                                                                                |
| ------------------------ | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V1 · Hermetic gate       | Local tests and builds verified. Solidity lint remains open.                                    | Foundry ran 219 tests with zero failures or skips. The committed coverage summary records core branch coverage of 92.16–100%. Solhint 6.2.5 reported 389 warnings using the repository’s current rules. |
| V2 · Account and custody | Passed with local Anvil and the fixture API.                                                    | The browser created the Agent and Vault, claimed 10 test USDC, then withdrew 10 USDC as the owner. The setup tests cover partial deployments and retries.                                               |
| V3 · Compose and launch  | Passed with local Anvil.                                                                        | The DCA browser test checks the calldata and single rule signature. The shared encoder tests cover all 13 templates.                                                                                    |
| V4 · Proof of the loop   | Three live receipts verified. Direct callback lookup and the 10-run latency sample remain open. | The leader settled 3 seconds after the pool event. Browser fixtures verified the three-row proof and latency display.                                                                                   |
| V5 · Rule controls       | Passed with local Anvil and Foundry.                                                            | Playwright verified pause and persisted order. Foundry exercised the rule limit, inactive execution and subscription release.                                                                           |
| V6 · Budget visibility   | Passed in contract and frontend tests.                                                          | The sponsor tests cover reserve credit and debt. The account view shows the three balances separately. Operator top-up instructions are in the runbook.                                                 |
| V7 · Template sweep      | Passed with the local template matrix.                                                          | Foundry and encoder tests cover the 13 templates. The live per-template wallet sweep is pending.                                                                                                        |
| V8 · Clone               | Passed with local Anvil. Live clone receipt pending.                                            | The browser created the clone on the second wallet’s Agent and opened its rule detail.                                                                                                                  |
| V9 · Mirror              | Two live settlements and the duplicate replay verified. Live grouped API proof pending.         | Leader and follower settled 2 seconds apart. Replay requested zero additional callbacks. The grouped browser proof passes with a fixture.                                                               |
| V10 · Hosts              | Verified through Supabase and GitHub Actions.                                                   | Supabase keep-alive SELECT succeeded. Production deployment automated through GitHub Actions workflow.                                                                                                  |

[Coverage report](../contracts/.coverage-summary.json) · [Performance and live receipts](./measurements.md) · Walkthrough demo video recorded from testnet evidence

### Submission checklist audit

| Requirement                              | Result                                                                                 |
| ---------------------------------------- | -------------------------------------------------------------------------------------- |
| Public source repository and MIT license | GitHub reported `PUBLIC`. The repository includes the MIT license.                     |
| Active Workflow V2 Agent factory         | Lasna factory `0xce6fdd1a509bf18cbe0237cc170279b51b93ad45`.                            |
| Active Workflow V2 Vault factory         | Unichain Sepolia factory `0x6c5aa38e3dc1537fd53c61721ea35f360a70858a`.                 |
| Legacy validation leader Agent           | Validation leader `0x7668aC28f434B622F352ed281Fa6ECA1f1227bcC`.                        |
| Legacy validation leader Vault           | Validation leader `0xEcdDD6b5317ed92b162c2de8523649430E9eA0A5`.                        |
| Legacy Lasna registry                    | Configured registry `0x743Bd5c1DE57Fb4E4F88CF020dcfFAeE670b959e`.                      |
| Origin → Reactive → callback             | Verified live loops for both Workflow V2 and legacy rules linked above.                |
| Demo video under three minutes           | The recorded walkthrough names the fixtures and shows the testnet settlement receipts. |

- [Public repository](https://github.com/zaikaman/Rulebook)
- [Active Lasna Agent Factory](https://lasna.reactscan.net/address/0xce6fdd1a509bf18cbe0237cc170279b51b93ad45)
- [Active Unichain Vault Factory](https://sepolia.uniscan.xyz/address/0x6c5aa38e3dc1537fd53c61721ea35f360a70858a)
- [Lasna V2 Smoke Agent](https://lasna.reactscan.net/address/0xebDA1C4d66D80CE37AdcE33D0F524645b01CcFf0)
- [Unichain V2 Smoke Vault](https://sepolia.uniscan.xyz/address/0xC15a2BA79c63bd462f362867446E9a33731b814f)
- [Historical Lasna Agent](https://lasna.reactscan.net/address/0x7668aC28f434B622F352ed281Fa6ECA1f1227bcC)
- [Historical Unichain Vault](https://sepolia.uniscan.xyz/address/0xEcdDD6b5317ed92b162c2de8523649430E9eA0A5)
- [Historical Lasna registry](https://lasna.reactscan.net/address/0x743Bd5c1DE57Fb4E4F88CF020dcfFAeE670b959e)
