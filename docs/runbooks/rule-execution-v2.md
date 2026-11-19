# Rule execution v2 testnet rollout

The [Lasna deployment record](../../deployments/lasna.json) and [Unichain Sepolia deployment record](../../deployments/unichain-sepolia.json) identify the factories and bytecode used for validation. Create the Agent through the Lasna factory and the Vault through the Unichain factory from the same release. The Vault checks execution payload version 2, the authorized tokens, the callback expiry, and the highest successful execution sequence for each rule.

Hourly rules share the native Lasna `Cron100(uint256)` subscription. Daily and longer rules use `Cron10000(uint256)` to reduce monitoring fees. The first eligible tick anchors the schedule. Later ticks advance to the next slot without issuing multiple trades for missed slots. A destination callback can still settle after a pause or cancellation if Lasna already requested it. Pause the Vault on Unichain when immediate enforcement at the funds side is needed.

## Configure a rollout

The local app at `localhost:5173` uses the v2 testnet factories and preserves access to the previous vault factory. The hosted app has a separate deployment and configuration.

Use the deployment records to set `VITE_AGENT_FACTORY_ADDRESS` and `VITE_VAULT_FACTORY_ADDRESS` for the new release. Carry the previous `VITE_VAULT_FACTORY_ADDRESS` into `VITE_PREVIOUS_VAULT_FACTORY_ADDRESS` before the cutover. Deploy the matching application and indexer code together. The indexer may keep its current cursors if it has already indexed the new deployment blocks.

Existing owners can withdraw USDC and WETH from `/account?vault=<previous-vault-address>` with the same wallet. This route checks the old factory's ownership record and the vault's owner. Existing Agents and Vaults are bound to their original addresses. Owners must authorize the new account and recreate any rules they wish to carry over. Retire the old rules before starting equivalent rules in the new account. Allow any in-flight callbacks to expire or settle before moving balances if the old vault is execution-capable.

For the rule lifecycle release, apply backend migration `0011_rule_replacements.sql` before
cutting over. Deploy the matching Agent and Vault factories together. Keep the old factory in
`VITE_PREVIOUS_AGENT_FACTORY_ADDRESS` so owners can still manage their old rules and open their
history from **Your rules**.
List any earlier Vault factories under `VITE_PREVIOUS_VAULT_FACTORY_ADDRESSES`, separated by commas,
to keep their withdrawal links available.

## Verify the live release

Check the origin event and Lasna evaluation for each canary. Confirm a funds-moving rule only when the paired Unichain receipt contains the vault's `Executed` event. Confirm alert rules from the Lasna `AlertRaised` event. Inspect both sides for debt before investigating a missed trigger. The same timer, price and transfer subscriptions stop receiving events if the Agent's network fees are unpaid. [Reactive fee and debt documentation](https://dev.reactive.network/economy)

The live canaries used the configured USDC/WETH pool. The Solidity test matrix also covers refused triggers and simulated inactivity. Testnet receipts establish behavior under the conditions of those runs. Live liquidity, fee credit and delivery still determine future outcomes.

### Dead-Man Switch canary

Rule `7` on the Lasna validation Agent `0x67aF6DaA2CE66521d7E14B3a1FDf0E8131A260a0` was armed to send 1 test USDC to another test wallet after one day of inactivity. It becomes eligible at 12:40:23 UTC on 2026-11-20, then waits for `Cron10000(uint256)`. The Vault holds one payout. Confirm the destination receipt contains both `Executed` for rule `7` and the corresponding USDC `Transfer` to `0xa29ACF49B7a75094D39CBfdaa08501FdF3042D0c`. [Lasna setup](https://lasna.reactscan.net/tx/0x6f8958e4b08ff199effcb0c864d01e02bcfbf7ceae2283e447eb62f5bc3192ff)

The local Solidity test checks that the same one-day schedule sends nothing before the inactivity boundary, pays at the boundary, and cannot spend again when Lasna or the callback proxy redelivers the same event.

An accelerated check on local forks of Lasna block `8734633` and Unichain Sepolia block `68240209` replayed a recorded native `Cron10000` event against the deployed Agent, advanced the fork clock across the inactivity boundary, and delivered the emitted callback through the deployed proxy. The Agent requested nothing one second early. At the boundary, the destination Vault emitted `Executed` and the recipient's USDC balance rose by exactly 1 USDC. The public testnet payout remains pending. [Recorded cron event](https://lasna.reactscan.net/tx/0x8725c2fb1f218f496515187a0fe9b957c52c5bf6d099fc62ec8f5500200d0926)

| Template             | Public testnet evidence                                                                                                                                                                                                                                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| DCA                  | The native `Cron100` tick triggered a 0.1 USDC buy. [Lasna evaluation](https://lasna.reactscan.net/tx/0xd428405763b296b279763f33a07a53b3974083fe0b7ea76a36fb757491131409) · [Unichain execution](https://sepolia.uniscan.xyz/tx/0x38864f77ec674be649cccd6c6fe483cbc2da35019368d98412cc2579b3a90f99)                      |
| DipBoost DCA         | The next native timer tick after the price fell triggered a swap. [Lasna evaluation](https://lasna.reactscan.net/tx/0xb61d12755f6586e017abb43310cb1e2f9755cfc5c6d9781eca35b59e348a203a) · [Unichain execution](https://sepolia.uniscan.xyz/tx/0xd9b0b8f0a16d7a1e32de75022b33d3d45296af5ae848743e077cf21220ae5e51)        |
| Limit Buy            | [Unichain execution](https://sepolia.uniscan.xyz/tx/0xaa230e3f90b08be5bbfc373ff3ee069904fbe500a0f6c747cc87452ab6289e44)                                                                                                                                                                                                  |
| Take Profit          | [Unichain execution](https://sepolia.uniscan.xyz/tx/0x6f44ac8e8ba22dca1b64603bf8c1765f7667bc0577efb4330626931f1bddcbbe)                                                                                                                                                                                                  |
| Stop Loss            | [Unichain execution](https://sepolia.uniscan.xyz/tx/0x7fa4991fca751d9b853b7cfb7c8a534278b419f502691af8578ffa4d5b1bc537)                                                                                                                                                                                                  |
| Grid Rebalance       | The swap settled, and Lasna cleared its latch and recorded the new reference. [Unichain execution](https://sepolia.uniscan.xyz/tx/0x0b45be9774806c0421c432d68440c17a68c5410ed9129fd926fdc5dce33c2db5) · [Lasna rearm](https://lasna.reactscan.net/tx/0x2bf6c12f82601517d0c3ad69fab53a450a24496bce96847c2d4aca7371d819dd) |
| Recurring Transfer   | [Unichain execution](https://sepolia.uniscan.xyz/tx/0xa14211c616b3bf05417fb42ee41d20a6c322a657a970106ac613f9a1075a27eb)                                                                                                                                                                                                  |
| Income Sweep         | [Unichain execution](https://sepolia.uniscan.xyz/tx/0xf1be676c15aae66173d95ca159272296cbd94d89382f4cbdaa066f548f18f74f)                                                                                                                                                                                                  |
| Balance Floor        | [Unichain execution](https://sepolia.uniscan.xyz/tx/0x977d78e78aea6b7ecc4bc1ea2fc893d74a356ba7d9ecdff893c2095bb4a4ea15)                                                                                                                                                                                                  |
| Dead-Man Switch      | Lasna observed the owner's token activity and reset the inactivity clock. A full inactivity payout passed in Solidity tests and remains unverified on public testnet. [Lasna reaction](https://lasna.reactscan.net/tx/0xe9afbd31fb4c0a54291c662f5398be6b2f6bdc9213d7d6e597e8a3e8840eb208)                                |
| Price Alert          | [Lasna alert](https://lasna.reactscan.net/tx/0xbd564909c1134da83e55a61752f916bc0f0fd662ad42ac6c6a684730b13e870b)                                                                                                                                                                                                         |
| Range Alert          | [Lasna alert](https://lasna.reactscan.net/tx/0xef4661b45589bc69821979bb3d5db9c3c5cce2bfec83a718f7ebf9f51016dc54)                                                                                                                                                                                                         |
| Large Transfer Alert | [Lasna alert](https://lasna.reactscan.net/tx/0x82060829508c0fc1ebd4390087f24df5deae765f08d0d3ec0048237acc95ce88)                                                                                                                                                                                                         |
