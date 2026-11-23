# Submission evidence

## Workflow V2 cross-chain testnet verification · 22 November 2026

Workflow V2 operates across Reactive Lasna (automation and monitoring) and Unichain Sepolia (vault custody and settlement). The live loops below demonstrate multi-path branch evaluation, scheduled execution, and destination callback settlement.

### Multi-path branching income sweep

The income sweep workflow watches USDC transfers into the Vault (`0xBf523873d349863BF491218885Ac00FB2A077Aa3`) linked to Agent `0x9934ECb31a427Fc3fac22075b6E0198842729825`. The program checks incoming deposit size:

- Path 1: Deposits >= 1.00 USDC send 0.20 USDC to the recipient.
- Path 3: Deposits >= 0.25 USDC send 0.05 USDC to the recipient.
- Path 4: Deposits < 0.25 USDC are skipped; no funds move and the workflow remains active.

| Payment   | Path | Vault action     | Origin transfer                                                                                                  | Lasna react                                                                                                      | Unichain callback                                                                                                |
| --------- | ---- | ---------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 1.20 USDC | 1    | Sent 0.20 USDC   | [0xf33c…0d06](https://sepolia.uniscan.xyz/tx/0xf33c393a34baedf2bdc269bb7d122c733652b7709322848288384c677e720d06) | [0x1057…d05d](https://lasna.reactscan.net/tx/0x10575cea252fe5122060a299431d0209177caadc8096ef4b6e537f25cceed05d) | [0x6be4…41d9](https://sepolia.uniscan.xyz/tx/0x6be469dd6660dd8f51b994a75bbebd4b6e6fff82e1bb300eb270e3204daf41d9) |
| 0.60 USDC | 3    | Sent 0.05 USDC   | [0x1c0d…3f41](https://sepolia.uniscan.xyz/tx/0x1c0dd824715e5648d705d6333acc0a31c58ac050a5fd7c236013e1287e6d3f41) | [0x82d3…14b2](https://lasna.reactscan.net/tx/0x82d3a2d72ecb81e4ec5329b968604975fd4de47eab0f59d122e529d8049514b2) | [0x3b83…8422](https://sepolia.uniscan.xyz/tx/0x3b833b455c8d2049731fbf5de73af7f564df3761c195eda9a8c0cabb6ef88422) |
| 0.10 USDC | 4    | Skipped (0 sent) | [0xd524…9c48](https://sepolia.uniscan.xyz/tx/0xd524491816c3c9705642f3666db717d53523cfc7ca97da5f55fca912c3839c48) | [0xea4e…62ff](https://lasna.reactscan.net/tx/0xea4e23fef81ff6e34a18f298a5fa71ea51388b00d4a9fbf3487f130212af62ff) | [0x9b19…ad23](https://sepolia.uniscan.xyz/tx/0x9b1962cb1ac8b3aa6ed6563d3f8e34a3353cc4dcb3fa174ca7e77a55b109ad23) |

### Scheduled execution

On the same Agent `0x9934ECb31a427Fc3fac22075b6E0198842729825` and Vault `0xBf523873d349863BF491218885Ac00FB2A077Aa3`, a scheduled buy of 0.20 USDC:

| Workflow      | Origin event                                                                                                                     | Lasna react                                                                                                                   | Destination callback                                                                                                             |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Scheduled buy | [Lasna Cron100, 14:09:43 UTC](https://lasna.reactscan.net/tx/0x90e7ceab0787e7cb926f2204b41e111d2f0ce059b591d3eb9e9606af2b97422a) | [Next block, 14:09:44 UTC](https://lasna.reactscan.net/tx/0x880bd1a467b7a59a56d41bdad25938d47686f0936c5122f87def8b1f2d7e6001) | [Unichain swap, 14:09:46 UTC](https://sepolia.uniscan.xyz/tx/0x43561295b2dc38ca88cb799ae13608d2b07f43c8aa68b85bcf798ffb6c670e7c) |

See [Workflow V2 smoke records](../deployments/workflows-v2-smoke.json).

---

## Verified automated evidence

- **Contracts** — 59 Foundry tests pass with zero skips. Coverage of `src/workflow/v2` is 89.7% line and 63.2% branch ([coverage summary](../contracts/.coverage-summary.json)).
- **Backend** — 33 Vitest tests cover workflow indexing, activity, proof reads, Rulewright, and Telegram linking.
- **Frontend** — 42 Vitest tests and 59 Playwright tests cover account onboarding, the builder, execution activity, proof, marketplace, Telegram notifications, and offline recovery.
- **Deployments** — [V2 deployment records](../deployments/workflows-v2.json) hold the factory addresses and indexer start blocks for Reactive Lasna and Unichain Sepolia.

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
- [Lasna V2 Smoke Agent (recorded receipt)](https://lasna.reactscan.net/address/0x9934ECb31a427Fc3fac22075b6E0198842729825)
- [Unichain V2 Smoke Vault (recorded receipt)](https://sepolia.uniscan.xyz/address/0xBf523873d349863BF491218885Ac00FB2A077Aa3)
