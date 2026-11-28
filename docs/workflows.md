# Rulebook workflows

Rulebook watches events and runs schedules on Reactive Lasna. It settles workflows in wallet-owned Vaults on Unichain Sepolia and Base Sepolia, and supports cross-chain origin triggers (`originChain` -> Reactive Lasna -> `chain`) with per-chain price tracking and multi-chain inactivity monitoring. The builder offers 13 recipes.

| Category      | Recipes                                                                                     |
| ------------- | ------------------------------------------------------------------------------------------- |
| Trading       | Scheduled buy, buy more on a dip, limit buy, take profit, trailing stop, price-band trading |
| Payments      | Recurring transfer, income sweep, balance refill                                            |
| Wallet safety | Inactivity payout, price alert, price-range alert, large-transfer alert                     |

Open **Workflows → New workflow** and choose a recipe or start from scratch. Drag a node from the library onto the canvas, or select it and choose a path from the settings. A check creates a Yes path and an Otherwise path. Each path can contain up to three checks and three ordered actions. The review shows the settlement network, amounts, recipients, spending limits, and expiry before the wallet asks for signatures.

The income sweep can use two payment thresholds. For example, send 0.20 USDC when the Vault receives at least 1 USDC, send 0.05 USDC when it receives at least 0.25 USDC, and skip smaller deposits. Open **Activity** from a workflow to see its runs. **Run details** shows the evaluated path on the canvas. **Public proof** gives you a shareable link to the origin, Lasna decision, and settlement records without a wallet connection.

Weekly spending budgets are optional per asset and apply in addition to the per-run caps. A run whose actual USDC or WETH input would exceed either weekly limit is skipped in full, with reason **Run would exceed the weekly spending budget**, and the workflow stays active. The Agent also avoids requesting a callback it can prove the Vault would reject. A schedule or price workflow that is blocked removes its trigger subscriptions, so it stops paying watching credit for evaluations that cannot run; it keeps its settlement feedback filters, pins a Lasna cron block for the mirrored reset, and can resume earlier when a raised limit is published. `resumeWatching(workflow)` is a permissionless recovery path if the pinned wake is missed, and still requires the mirrored budget to admit a path. A payment or transfer trigger keeps its trigger subscription because its origin log never repeats; the run is kept in a per-workflow waiting list (up to eight; a ninth is reported dropped) and retried after a budget change or on the next Lasna cron tick once the week resets. A waiting run keeps its original origin transaction, so settlement still pays it at most once. Spending resets every Monday at 00:00 UTC using the settlement Vault's block timestamp at settlement. The Vault tracks spend while a limit is blank, so adding, removing, or restoring a limit midweek preserves the counter. Workflow detail shows spent, remaining, and the next reset in local time; **Edit weekly budget** changes only the limits and leaves the schedule and inactivity window untouched. [Weekly budget runbook](runbooks/weekly-budgets.md)

Fund vault principal and network credit per settlement chain from **Account & Vault**. USDC and WETH are vault principal: USDC pays for buys, transfers, and refunds, while WETH is only needed for workflows that sell it. Execution credit is testnet ETH deposited to the settlement chain's callback proxy for that Vault, not ETH held in the Vault; it pays for callbacks. Watching credit is testnet lREACT deposited to the Lasna system contract for the agent, and it pays for trigger evaluations; a schedule or price workflow paused by its weekly budget removes those subscriptions, so it does not pay while blocked. A balance refill pulls USDC from the owner’s wallet up to the approved allowance, per-run cap, and amount needed to reach the floor. An inactivity payout requires a fixed recipient and amount and explicit consent. The Vault waits through a 24-hour grace period and a final ten-minute confirmation window. Reactive watches qualifying owner USDC transfers on the supported funds chains and forwards cancellation during grace. Delayed or missed cross-chain events can still leave the Vault unaware of recent activity. A direct owner check-in on the Vault clears a pending payout immediately. Owner deposits and refills are excluded from payment triggers. The owner can pause a workflow by revoking Vault authorization before turning off its Lasna subscription. ETH sent directly to a Vault or to the Agent is a separate native balance; both are recoverable from **Account & Vault** but neither pays for callbacks or trigger evaluations. Execution credit and watching credit are prepaid to the Reactive callback proxy and system contract, which expose no refund for unspent credit, so the account page shows those balances without a withdrawal action.

A run the Vault cannot fund is skipped, not failed. Before every USDC transfer or swap, the Vault compares the amount it is about to move with its own live token balance; if it is short, the run reverts with `InsufficientVaultBalance` and records **skipped** with the reason **The Vault did not hold enough of the asset this run needed**. Nothing is spent, the weekly budget and any consumed payment are left untouched, and the workflow stays active. The check runs per step, so a path that sells WETH and then sends the USDC it just filled still settles. Because it runs at settlement, it also covers balances that change after dispatch. Health reports **Vault short of funds** with the amount to add and links to Account & Vault; the activation check still catches fixed shortfalls before activation, while the Vault is the authority once a workflow is live. Both the Agent and settlement Vault run behind ERC-1967 proxies with owner-only opt-in UUPS upgrades to factory-approved implementations, so owners can adopt fixes without losing their addresses or prepaid Reactive credit.

A funding shortfall pauses watching for scheduled and
price workflows once the Agent receives the Vault's outcome. Top up the Vault
or restore the owner's refill allowance or balance, then call
`resumeWatching(workflow)` on the Agent from the owner wallet. Weekly budget
restrictions still apply. When a payment or transfer callback loses a race
for the weekly budget, the Agent can requeue its original event. Activity
shows a separate dispatch for the retry, and an origin can settle only once.
A failed price crossing keeps its evidence for a retry on a fresh pool log
after the cooldown. The Vault rechecks the price and rejects duplicate
settlement of that crossing.

Workflow review and the workspace flag low reserves and outstanding network fees. Follow the top-up link to the corresponding credit deposit. **Workflow costs** shows suggested reserves and live network gas quotes. Public proofs show execution gas from the available transaction receipts.

Each workflow card and its detail page show one health status: **Watching for the next trigger**, **Waiting for a payment**, **Callback pending**, **Inactivity payout in grace period**, **Blocked by low execution credit**, **Blocked by low watching credit**, **Vault short of funds**, **Budget reached**, **Last run failed**, **Last run unconfirmed**, **Paused**, **Ready to activate**, or **Completed**. A grace-period status means the Vault already recorded the run and is holding its inactivity payout during the grace or final confirmation window; checking in cancels that payout, and the hold is not reported as a missing callback. Health reads the live Lasna subscription, Vault authorization, credit reserves, weekly budget, and the newest indexed run. The last successful run links to its public proof. A blocked state links to the matching fix: the credit deposit, the weekly budget editor, Account & Vault, or the workflow editor. Run history and status use the same reserve thresholds as Telegram funding and action alerts, so the app and a Telegram warning agree.

## Archive and restore workflows

Open a workflow and choose **Archive workflow**. If it is watching or still authorized, Rulebook first asks you to revoke spending on the Vault and disable watching on Lasna. Then sign a message to record the archive. If the pause is interrupted, choose **Finish archiving** from the workflow detail page. The archive is recorded after the pause transactions reach the confirmations required by the indexer.

Open **Archived** in the workflow list to find the workflow and its run history. Choose **Restore as paused** to return it to the workflow list. Completed one-shot workflows show **Restore to workflow list** and retain their completed status. Restoring uses a wallet message and keeps execution paused. Resume separately when the workflow can run again.

## Marketplace

The Marketplace publishes the exact enabled program version. Copying creates an editable draft that keeps the trigger, checks, amounts, per-run caps, watched wallet, and expiry, leaves weekly budgets blank, and clears the payout recipients so the copier chooses their own. Each wallet provides its own Vault funds and signs its own authorization. To remove a public listing for an archived workflow, use **Marketplace listing** on the workflow detail page.

### Seed the testnet Marketplace

The [Marketplace launch catalog](../scripts/seed-workflow-marketplace.mjs) covers payments, alerts, and trading on the active Lasna deployment. Run `npm run build -w packages/shared` and then `node scripts/seed-workflow-marketplace.mjs` to validate the ten programs and estimate registration gas. The script reads `DEPLOYER_PRIVATE_KEY` and the RPC overrides from `contracts/.env` or the process environment. The publishing wallet needs lREACT for gas and an Agent with linked vaults on Unichain Sepolia and Base Sepolia.

Run the same command with `--publish` to register each program, disable its subscription, and publish the copyable version. The seed assigns no vault authorizations and leaves any manually unpublished listing private. Check the printed listing IDs against the Marketplace after the indexer catches up.

## Run your first income sweep

1. Open **Account & Vault** in Testnet mode. On Unichain Sepolia, create and link your Vault to your Lasna Agent. Fund watching credit with testnet lREACT and execution credit with Unichain Sepolia ETH. Check **Workflow costs** for the current suggested reserves. Keep testnet gas in both signing wallets for transactions you send directly.
2. Open **New workflow → Income sweep**. Select **Unichain Sepolia**. Enter a minimum payment of **1 USDC**, a sweep of **0.20 USDC**, a smaller threshold of **0.25 USDC**, and a smaller sweep of **0.05 USDC**. Use a recipient you control that differs from your Vault. Open the builder.
3. Set a **1 USDC** weekly budget in the workflow settings. In **Review workflow**, check the thresholds, the recipient, the **0.20 USDC** cap per run, and the weekly budget. Approve the program on Unichain Sepolia, then enable it on Reactive Lasna. Wait for the workflow to show **Waiting for a payment**.
4. From a second wallet, transfer **1.20 USDC** to the Vault address shown in **Account & Vault**. Use the configured [Unichain Sepolia test USDC](https://sepolia.uniscan.xyz/address/0x31d0220469e10c4E71834a79b1f276d740d3768F). The owner’s deposits and Vault refills are excluded from the payment trigger.
5. Open **Activity → Public proof** for the confirmed run. Check the payment into the Vault, the Lasna decision, and the **0.20 USDC** transfer to your recipient in the callback receipt. Send **0.60 USDC** from the same payer to see the smaller branch deliver **0.05 USDC**. A **0.10 USDC** payment should produce a skip.
6. When finished, pause the workflow from its detail page and confirm both transactions. This revokes Vault authorization and turns off the Lasna subscription. Withdraw any remaining principal from **Account & Vault**.

If the run is missing, verify the sender, token, and destination Vault in the origin receipt. If it is pending, open **Public proof** to see which receipt is available and check both credit balances in **Account & Vault**. A pause affects future execution. Use the destination receipt to verify money already sent.

[Example confirmed run](https://rulebook-chi.vercel.app/runs/0xfde2a4ef2a2dbebae6417c14112ef7ab6626867c7da52fd50d784e71aac57309?network=testnet) · [Testnet deployment evidence](submission-evidence.md#active-testnet-deployment)

## Mainnet swap slippage and trade-size limits

The Vault uses pool and oracle quotes to enforce the minimum output allowed by the configured slippage. A swap can fail when the oracle and the live pool diverge or when the trade moves through enough V3 liquidity to fall below the linear spot quote. The current market configuration and quote implementation are recorded in the contract source. [Chain configuration](../contracts/src/chain/ChainConfig.sol) · [Quote and slippage checks](../contracts/src/workflow/v2/WorkflowProgramValidatorV2.sol)

## Deploy and verify

Follow the staged testnet deployment and smoke procedure for Lasna, Unichain Sepolia, and Base Sepolia. For an application release, apply all pending database migrations with `npm run migrate -w backend` and enable the backend indexer with `INDEXER_ENABLED=true`. The backend `WORKFLOW_V2_DEPLOYMENT` and frontend `VITE_WORKFLOW_V2_DEPLOYMENT` use matching JSON with `lasna`, `unichain`, and `base` entries containing `factory` and `startBlock`. Set `VITE_WORKFLOW_V2_ACTIVATION=true` when the verified deployment is ready for new activations. Pause, check-in, and withdrawals remain available independently of that flag. [Staged testnet deployment](../deployments/README.md#deploy-and-verify-a-testnet-candidate) · [Production application release](runbooks/production-release.md)

Run `npm run verify` before releasing. Record the origin, Lasna decision, and destination transactions for any additional live-tested recipe, and check the selected path and balances against the receipt.

[Active testnet factory record](../deployments/workflows-v2.json) · [Historical income sweep receipts](https://github.com/zaikaman/Rulebook/blob/75dd7930d025d627dd08a7d4e8c25c881594f411/deployments/workflows-v2-smoke.json) · [Active deployment smoke evidence](submission-evidence.md#active-testnet-deployment)
