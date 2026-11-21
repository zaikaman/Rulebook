# Runbook: pause, resume, edit, cancel, and fund automations

This runbook is for the account owner or an operator assisting them. The user retains full custody of their principal throughout: none of these actions moves funds without explicit signature.

## Workflow V2 controls (current app)

Open `/workflows` to view all active, ready, and paused workflows.

### Pause an active workflow

1. In `/workflows`, find the workflow card or open its detail page.
2. Select **Pause workflow**.
3. Confirm the transactions:
   - First, the Vault authorization is revoked on Unichain Sepolia. This immediately cuts off callback execution at the funds side.
   - Second, the subscription is disabled on the Reactive Lasna Agent.
4. Confirm the status pill updates to **Paused**.

### Check in on an inactivity payout

For workflows with an inactivity payout condition:

1. When the inactivity threshold is reached, the workflow enters a 24-hour grace period and issues a notice.
2. Open the workflow detail page or follow the link from the Telegram alert.
3. Select **Check in**. The transaction is submitted on Unichain Sepolia, clearing the pending payout and resetting the timer.

### Edit weekly spending budgets

1. Open the workflow detail page.
2. In the weekly budget section, select **Edit weekly budget**.
3. Adjust the USDC or WETH weekly limits. Setting a field blank removes the limit for that asset.
4. Sign the update transaction on Unichain Sepolia. The schedule, accumulated historical spend, and inactivity tracking remain untouched.

### Fund or withdraw from the Vault

1. Open **Account & Vault** (or `/account/funds`).
2. To deposit principal, select **Add USDC** or **Add WETH** and sign the deposit.
3. To withdraw principal, select **Withdraw USDC** or **Withdraw WETH**, enter the amount, and sign on Unichain Sepolia. Principal can be withdrawn whenever automations do not require it.
4. If native ETH was transferred directly to the Vault by mistake, use **Withdraw ETH** to recover it.

### Top up network credits

Network credits pay for automation infrastructure and are separate from Vault principal:

- **Watching credit (Reactive Lasna)**: Pays for Agent event evaluation and timer subscriptions. Add testnet REACT by selecting **Top up watching credit** or calling `depositTo(agent)` on the Lasna system contract (`0x8888888888888888888888888888888888888888`).
- **Execution credit (Unichain Sepolia)**: Pays for callback proxy gas. Add testnet ETH by selecting **Top up execution credit** or calling `depositTo(vault)` on the callback proxy (`0x775c9B990ADe401060B78D0e98684eEf8d2466C1`).

---

## Legacy V1 rule controls

When running in legacy workspace mode (`/rules`):

### States

| State               | What the Agent does                                    | What you see                  |
| ------------------- | ------------------------------------------------------ | ----------------------------- |
| `active`            | Evaluates the rule on every matching wake-up.          | Active pill                   |
| `paused`            | Retains the rule and settings, but skips evaluation.   | Paused pill and Resume button |
| `cancelled`         | Retains rule id in history and releases subscriptions. | Cancelled pill                |
| `Replaced`          | Retains old rule in history and links to replacement.  | Replaced pill                 |
| `Waiting for funds` | Rule stays enabled while Vault balance is below spend. | Waiting for funds notice      |
| `latched`           | Fired non-cron rule waits for condition reset.         | Fired - needs reset           |
| `silent`            | Account lacks execution credit; callbacks halted.      | Silent - no execution credit  |

### Pause or resume

1. Open `/rules` and select the rule's **Detail** link.
2. Under **Control**, select **Pause**. The transaction is signed on Reactive Lasna.
3. To resume, select **Resume** on the same panel.

### Cancel a rule

1. Open the rule detail page.
2. Select **Cancel rule**, then **Confirm cancel**.
3. Confirm the status updates to **Cancelled**. Cancelling is permanent; subscriptions and budget reservations are freed.
