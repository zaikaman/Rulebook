# Submission evidence

## Active testnet deployment

These are the contracts used in the November 28, 2026 testnet runs. The smoke wallets revoked and disabled the four workflows after verification. The public proofs remain available.

| Network          | Factory                                                                                                                                    | Contract that ran the workflow                                                                                                             |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Reactive Lasna   | [`0xe8779e7c2eef222d8df44191ef1a7993df5778bf`](https://lasna.reactscan.net/address/0xe8779e7c2eef222d8df44191ef1a7993df5778bf)             | [`0x026B69EBF52aE7F0568B544A41B805bdcfa9746a`](https://lasna.reactscan.net/address/0x026B69EBF52aE7F0568B544A41B805bdcfa9746a)             |
| Unichain Sepolia | [`0x273f4b5ed558326ac3355a84f5f60e291c7db6d6`](https://unichain-sepolia.blockscout.com/address/0x273f4b5ed558326ac3355a84f5f60e291c7db6d6) | [`0xb814D7C2246903AAf83767e07EC0660508483c52`](https://unichain-sepolia.blockscout.com/address/0xb814D7C2246903AAf83767e07EC0660508483c52) |
| Base Sepolia     | [`0x5a7c7c075a0cc782c5f6167f2344e83b00937851`](https://base-sepolia.blockscout.com/address/0x5a7c7c075a0cc782c5f6167f2344e83b00937851)     | [`0x8B343a19Ba9c3E53c8eCd968F525e8edB5f24e31`](https://base-sepolia.blockscout.com/address/0x8B343a19Ba9c3E53c8eCd968F525e8edB5f24e31)     |

The factory record contains the deployment transactions, bytecode hashes, and source revision. The smoke record contains the authorization, run, and cleanup transactions. [Factory record](../deployments/workflows-v2.json) · [Smoke record](../deployments/workflows-v2-smoke.json) · [Deployed source](https://github.com/zaikaman/Rulebook/tree/7eb7cc9506f6e07557a4377501936d79b5bb2dc3/contracts/src/workflow/v2)

## Complete transaction trails

Amounts are in test USDC. Each proof opens without a wallet. The three explorer links let you verify each step independently.

| Settlement network | Outcome                   | Origin event                                                                                                                   | Reactive Lasna                                                                                                      | Settlement                                                                                                                      | In Rulebook                                                                                                                           |
| ------------------ | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Unichain Sepolia   | 1.20 in, 0.20 sent        | [USDC transfer](https://unichain-sepolia.blockscout.com/tx/0x1bfa7efa7581d91e2d94d7a34ad09febf9444daacb430c9d09ca81b1cc8dbaa0) | [Lasna reaction](https://lasna.reactscan.net/tx/0xdd7e74fe0b75d7664133eb92ec3cf5ebb78f4d5687f16f76c8b01f45d7fcba3b) | [Vault callback](https://unichain-sepolia.blockscout.com/tx/0xa149f9cffbff4b1ed121e6d581b95c92dc7506b1d65403fa7d3e2d68bd64bf1a) | [Open proof](https://rulebook-chi.vercel.app/runs/0xfde2a4ef2a2dbebae6417c14112ef7ab6626867c7da52fd50d784e71aac57309?network=testnet) |
| Unichain Sepolia   | 0.60 in, 0.05 sent        | [USDC transfer](https://unichain-sepolia.blockscout.com/tx/0x75d0b26732f5e4f9ddb640a7ee2169525ec95ea2ef1c6914b269af8e76d69a46) | [Lasna reaction](https://lasna.reactscan.net/tx/0xa166964d47ce14f07ee89b25788ce07e2d38e1dca4bf8457938e835686506964) | [Vault callback](https://unichain-sepolia.blockscout.com/tx/0xf521d0901b6c18bcc9f052f5d0f1e5dc7007b59b92bc68b19a9075d50dfdaab6) | [Open proof](https://rulebook-chi.vercel.app/runs/0xfa496fb75cc35521f8bdc9baf81a48ec3553d8a2c60202d889fea014d603f0de?network=testnet) |
| Unichain Sepolia   | Scheduled buy, 0.20 spent | [Lasna tick](https://lasna.reactscan.net/tx/0xd969804a28d0729b3516e1b6dfd05a9ca1704ab2dccc5c1258eaa1646256b3be)                | [Lasna reaction](https://lasna.reactscan.net/tx/0x9e73beaf15f223dc28c69012153a719a88e6927ebbc7038723402977a223f9a5) | [Vault callback](https://unichain-sepolia.blockscout.com/tx/0x5daade087d192861151065e47de8949cfdf8c7caa2e113c0b209737aa501dd61) | [Open proof](https://rulebook-chi.vercel.app/runs/0xfffe69f8cdaa1d23532aa4e11501b73f3a2092f25d62fdc0665477a9e04ba1af?network=testnet) |
| Base Sepolia       | 1.20 in, 0.20 sent        | [USDC transfer](https://base-sepolia.blockscout.com/tx/0x999e3d77a3f29bffbf82e467fd2b6878eb1d2e798c73f21faec03cf202b6590d)     | [Lasna reaction](https://lasna.reactscan.net/tx/0x9b5d8bf8f123e12451af1b13331d812a9888cd1ae50f43812a000c20cf6ada94) | [Vault callback](https://base-sepolia.blockscout.com/tx/0x28de738bf14c5a7b7b75787eb7dda7b445c94231379567d6cde3b4339577019e)     | [Open proof](https://rulebook-chi.vercel.app/runs/0xcc86135b1643f348db86320d7d10cc5c92f34e16fa8bc7b50f682fdbd558bb07?network=testnet) |
| Base Sepolia       | 0.60 in, 0.05 sent        | [USDC transfer](https://base-sepolia.blockscout.com/tx/0xfae706f05380beb2d83373338acd306034ad8919548b9999b9f824dd48a2c516)     | [Lasna reaction](https://lasna.reactscan.net/tx/0x2ad87442ff7710b450a9fc1c4aece3e1ed75ecfe84328c1df9b6372dfaec5f33) | [Vault callback](https://base-sepolia.blockscout.com/tx/0xe01a2cd900297c089b7ceece86c117a98de01083b5a1b3d40b022083a9485dad)     | [Open proof](https://rulebook-chi.vercel.app/runs/0xc19cb6b78609c87e0eb011589c0fd80fb9544d6fa7ca9cd524da924a8c644083?network=testnet) |
| Base Sepolia       | Scheduled buy, 0.20 spent | [Lasna tick](https://lasna.reactscan.net/tx/0x5b54f6f4496906e10ce397c713709d11d76860582d25526578b8ec981789c880)                | [Lasna reaction](https://lasna.reactscan.net/tx/0x176c1eb3026b464a6cbf2e66d18c7fe60db58792249603d8e58add100989055a) | [Vault callback](https://base-sepolia.blockscout.com/tx/0xdbd106931705b3bd602af3f450c48f8cc4d878f0c980a1358d373d9c0390119e)     | [Open proof](https://rulebook-chi.vercel.app/runs/0xc2bd27dd53053da6eb65c0379216aa06dc5c9e5332db294a73fc715a10c11477?network=testnet) |

## Trace a receipt through the code

1. **Origin.** In a payment receipt, find the USDC `Transfer` into the Vault. In a scheduled run, find the Lasna `Cron100` tick.
2. **Reactive.** In the Lasna receipt, find `Dispatched` from the Agent proxy. Follow `react` into the delegated implementation. It matches the subscription and packs the origin chain, transaction, log index, and observation into a callback request. [Agent entry point](../contracts/src/workflow/v2/WorkflowAgentV2.sol) · [Reaction and dispatch](../contracts/src/workflow/v2/WorkflowAgentReactV2.sol)
3. **Settlement.** In the destination receipt, find `Outcome` from the Vault and the token transfers for a confirmed payment or swap. The Vault authenticates the callback proxy and its Agent, checks the authorized program and expiry, and evaluates the path using the observation from Lasna. Spending caps and the weekly budget are enforced as part of settlement. The run ID in `Outcome` matches the one in `Dispatched`. [Vault entry point](../contracts/src/workflow/v2/WorkflowVaultV2.sol) · [Path evaluation and settlement](../contracts/src/workflow/v2/WorkflowVaultSettlementV2.sol)

The proof page numbers paths from one. The stored path index in the smoke record starts at zero, so stored path 1 appears as **Path 2** in Rulebook.

## Historical Workflow V2 testnet verification · 24 November 2026

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

The archived smoke file contains these November 24 receipts. [Historical smoke receipts](https://github.com/zaikaman/Rulebook/blob/75dd7930d025d627dd08a7d4e8c25c881594f411/deployments/workflows-v2-smoke.json)

---

## Verified automated evidence

- **Contracts** — The deployed source passed 195 Foundry tests with zero skips and three separate fork tests. The coverage gate measures every shipped `src` contract and enforces 80% line and 50% branch overall, plus the per-contract floors recorded in the [coverage summary](../contracts/.coverage-summary.json).
- **Shared** — Vitest tests cover program encoding, validation, recipe generation, health derivation, and chain configuration.
- **Backend** — Vitest tests cover workflow indexing, activity, proof reads, health, marketplace, Rulewright, Bookkeeper assistant, Telegram linking, and release deployment validation.
- **Frontend** — Vitest tests and 73 Playwright tests cover account onboarding, multichain setup, the builder, execution activity, proof, marketplace, Telegram notifications, Bookkeeper assistant, and offline recovery.
- **Deployments** — [V2 deployment records](../deployments/workflows-v2.json) hold the factory addresses, start blocks, source commits, and bytecode hashes for Reactive Lasna, Unichain Sepolia, and Base Sepolia.

## Submission checklist

| Requirement                              | Result                                                                                                                     |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Public source repository and MIT license | [Public GitHub repository](https://github.com/zaikaman/Rulebook) with the [MIT license](../LICENSE).                       |
| Active Workflow V2 factories             | Recorded with addresses, blocks, and bytecode hashes in [deployments/workflows-v2.json](../deployments/workflows-v2.json). |
| Origin → Reactive → callback             | Six complete loops from the active factories, plus the historical skip.                                                    |
| Hosted app                               | [rulebook-chi.vercel.app](https://rulebook-chi.vercel.app).                                                                |
| Demo video under three minutes           | [90-second video](demo/rulebook-buildathon.mp4) and [transcript](demo/README.md).                                          |

- [Hosted app](https://rulebook-chi.vercel.app)
- [Public repository](https://github.com/zaikaman/Rulebook)
- [Active Workflow V2 factories](../deployments/workflows-v2.json)
- [Lasna V2 Smoke Agent (recorded receipt)](https://lasna.reactscan.net/address/0x6bF114548E7A748c7E8ED736b0E80c07B01291F8)
- [Unichain V2 Smoke Vault (recorded receipt)](https://sepolia.uniscan.xyz/address/0x95855cd060ef40B1212Eb1366365f3C925F300be)
