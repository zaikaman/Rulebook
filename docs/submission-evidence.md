# Submission evidence

## Workflow V2 cross-chain testnet verification · 24 November 2026

Workflow V2 operates across Reactive Lasna (automation and monitoring) and Unichain Sepolia (vault custody and settlement). The live loops below demonstrate multi-path branch evaluation, scheduled execution, and destination callback settlement.

### Multi-path branching income sweep

The income sweep workflow watches USDC transfers into the Vault (`0x95855cd060ef40B1212Eb1366365f3C925F300be`) linked to Agent `0x6bF114548E7A748c7E8ED736b0E80c07B01291F8`. The program checks incoming deposit size:

- Path 1: Deposits >= 1.00 USDC send 0.20 USDC to the recipient.
- Path 3: Deposits >= 0.25 USDC send 0.05 USDC to the recipient.
- Path 4: Deposits < 0.25 USDC are skipped; no funds move and the workflow remains active.

| Payment   | Path | Vault action     | Origin transfer                                                                                                  | Lasna react                                                                                                      | Unichain callback                                                                                                |
| --------- | ---- | ---------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 1.20 USDC | 1    | Sent 0.20 USDC   | [0x714e…83f8](https://sepolia.uniscan.xyz/tx/0x714e0c157898d3a79b9e4ae3ab69f1dab6fa340eb0255d12053aac690fd983f8) | [0x03dc…2638](https://lasna.reactscan.net/tx/0x03dca7bb85b59ca005c20601f41f3e472e2a0bf3a58ab6a29d51d532fe192638) | [0xba91…099e](https://sepolia.uniscan.xyz/tx/0xba91dc7ea2e98b4acc03c3b322e810b08e5edc45685bfc21dc992a26dc25099e) |
| 0.60 USDC | 3    | Sent 0.05 USDC   | [0x17ec…b9a8](https://sepolia.uniscan.xyz/tx/0x17ec5ee9fe16604548b664e3634aa26469bdf8354bad45902e511e4e56bbb9a8) | [0x49a0…89c8](https://lasna.reactscan.net/tx/0x49a056ef6e9168ca65ccdfb923c1d8769d494efe43e8f3942036a84ce18e89c8) | [0x6a4d…dc07](https://sepolia.uniscan.xyz/tx/0x6a4d944f3d0d9bd4e8561a01506e00db5a6e9baaac39c358399f92718dafdc07) |
| 0.10 USDC | 4    | Skipped (0 sent) | [0x2396…bd60](https://sepolia.uniscan.xyz/tx/0x239630065d398b717bf19ac1d3c75c5b793f26bd8e9e54895fb1361e37a0bd60) | [0x2441…e422](https://lasna.reactscan.net/tx/0x2441cefd445348f64914787f76da66582e37bba2d643b0790e8de3f093c1e422) | [0xa7a5…6214](https://sepolia.uniscan.xyz/tx/0xa7a51f37fec05a39782a26feb3f60bb20e50d1840cf73a1ad3f1cb3032b66214) |

### Scheduled execution

On the same Agent `0x6bF114548E7A748c7E8ED736b0E80c07B01291F8` and Vault `0x95855cd060ef40B1212Eb1366365f3C925F300be`, a scheduled buy of 0.20 USDC:

| Workflow      | Origin event                                                                                                                     | Lasna react                                                                                                                   | Destination callback                                                                                                             |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Scheduled buy | [Lasna Cron100, 06:30:33 UTC](https://lasna.reactscan.net/tx/0xa0dbed575f09181e3c3c62b83fc3a3cbdd6b76e68ff2aa330a39ccc61cfa10df) | [Next block, 06:30:34 UTC](https://lasna.reactscan.net/tx/0xc66cac219fbffefcac68212e1a984edc775d8e7c7936c497bd001900149d549c) | [Unichain swap, 06:30:36 UTC](https://sepolia.uniscan.xyz/tx/0xd377b1311e7aa8871e1c25bd3e46480e0da35944f25164d53d5674dd06a7005d) |

See [Workflow V2 smoke records](../deployments/workflows-v2-smoke.json).

---

## Verified automated evidence

- **Contracts** — 89 Foundry tests pass with zero skips. The coverage gate measures every shipped `src` contract and enforces 80% line and 50% branch overall, plus the per-contract floors recorded in the [coverage summary](../contracts/.coverage-summary.json).
- **Shared** — 36 Vitest tests cover program encoding, validation, recipe generation, health derivation, and chain configuration.
- **Backend** — 53 Vitest tests cover workflow indexing, activity, proof reads, health, marketplace, Rulewright, Bookkeeper assistant, and Telegram linking.
- **Frontend** — 73 Vitest tests and 63 Playwright tests cover account onboarding, multichain setup, the builder, execution activity, proof, marketplace, Telegram notifications, and offline recovery.
- **Deployments** — [V2 deployment records](../deployments/workflows-v2.json) hold the factory addresses, start blocks, commit `13aac2c4958b81dcca055fd34c895b5d93daaac7`, and bytecode hashes for Reactive Lasna, Unichain Sepolia, and Base Sepolia.

### Submission checklist

| Requirement                              | Result                                                                                                                     |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Public source repository and MIT license | GitHub reported `PUBLIC`. The repository includes the MIT license.                                                         |
| Active Workflow V2 factory pair          | Recorded with addresses, blocks, and bytecode hashes in [deployments/workflows-v2.json](../deployments/workflows-v2.json). |
| Origin → Reactive → callback             | Verified live loops linked above.                                                                                          |
| Hosted app                               | [rulebook-chi.vercel.app](https://rulebook-chi.vercel.app).                                                                |
| Demo video under three minutes           | Not published yet. The walkthrough is recorded against the hosted app before submission.                                   |

- [Hosted app](https://rulebook-chi.vercel.app)
- [Public repository](https://github.com/zaikaman/Rulebook)
- [Active Workflow V2 factory pair](../deployments/workflows-v2.json)
- [Lasna V2 Smoke Agent (recorded receipt)](https://lasna.reactscan.net/address/0x6bF114548E7A748c7E8ED736b0E80c07B01291F8)
- [Unichain V2 Smoke Vault (recorded receipt)](https://sepolia.uniscan.xyz/address/0x95855cd060ef40B1212Eb1366365f3C925F300be)
