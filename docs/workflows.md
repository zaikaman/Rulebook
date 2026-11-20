# Rulebook workflows

Rulebook watches events and runs schedules on Reactive Lasna. It settles workflows in a wallet-owned Vault on Unichain Sepolia. The original catalog contains 13 recipes.

| Category      | Recipes                                                                                     |
| ------------- | ------------------------------------------------------------------------------------------- |
| Trading       | Scheduled buy, buy more on a dip, limit buy, take profit, trailing stop, price-band trading |
| Payments      | Recurring transfer, income sweep, balance refill                                            |
| Wallet safety | Inactivity payout, price alert, price-range alert, large-transfer alert                     |

Open **Workflows → New workflow** and choose a recipe or start from scratch. Drag a node from the library onto the canvas, or select it and choose a path from the settings. A check creates a Yes path and an Otherwise path. Each path can contain up to three checks and three ordered actions. The review shows the settlement network, amounts, recipients, spending limits, and expiry before the wallet asks for signatures.

The income sweep can use two payment thresholds. For example, send 0.20 USDC when the Vault receives at least 1 USDC, send 0.05 USDC when it receives at least 0.25 USDC, and skip smaller deposits. Open **Activity** from a workflow to see its runs. **Run details** shows the evaluated path on the canvas. **Public proof** gives you a shareable link to the origin, Lasna decision, and settlement records without a wallet connection.

Fund vault principal and network credit from **Account & Vault**. USDC and WETH are vault principal: USDC pays for buys, transfers, and refunds, while WETH is only needed for workflows that sell it. Execution credit is testnet ETH deposited to the Unichain callback proxy for the vault, not ETH held in the vault; it pays for callbacks. Watching credit is testnet lREACT deposited to the Lasna system contract for the agent. A balance refill pulls USDC from the owner’s wallet up to the approved allowance, per-run cap, and amount needed to reach the floor. An inactivity payout requires a fixed recipient and amount, explicit consent, and a 24-hour grace period. The owner can check in to clear a pending payout. The owner can pause a workflow by revoking Vault authorization before turning off its Lasna subscription. ETH sent directly to the vault is a separate native balance; it is recoverable but does not pay for callbacks.

Workflow review and the workspace flag low reserves and outstanding network fees. Follow the top-up link to the corresponding credit deposit. **Workflow costs** shows suggested reserves and live network gas quotes. Public proofs show execution gas from the available transaction receipts.

The Marketplace publishes the exact enabled program version. Copying creates an editable draft with recipients, watched-wallet details, expiry, and spending limits cleared. Each wallet provides its own Vault funds and signs its own authorization.

## Deploy and verify

Build the contracts with Foundry and regenerate the shared ABIs with `npm run generate`. Run `DeployWorkflowsV2.s.sol:DeployWorkflowsV2` against the `lasna` and `unichain_sepolia` RPC aliases. The script deploys the Agent factory on Lasna and the Vault factory on Unichain Sepolia. Record confirmed addresses, blocks, transaction hashes, and bytecode hashes.

Apply `0014_workflow_v2.sql` with `npm run migrate -w backend`. Set `WORKFLOW_V2_DEPLOYMENT` on the backend and `VITE_WORKFLOW_V2_DEPLOYMENT` on the frontend. Both use JSON with `lasna` and `unichain` entries, each containing the confirmed factory address and start block under `factory` and `startBlock`. Enable the indexer with `INDEXER_ENABLED=true`. The frontend uses `VITE_WORKFLOW_V2_ACTIVATION=true` to allow new activations. Pause, check-in, and withdrawal controls are independent of the activation flag.

Run `npm run verify` and `npx playwright test`. Test the branching income sweep on the live testnets with 1.20, 0.60, and 0.10 USDC deposits. Record the origin, Lasna decision, and destination transactions, and check the selected path and balances for each. Verify scheduled and price-triggered runs before presenting them as live-tested recipes.

[Testnet factory receipts](../deployments/workflows-v2.json) · [Live income sweep receipts](../deployments/workflows-v2-smoke.json)
