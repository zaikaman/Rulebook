# Runbook: pause, resume, cancel, reorder, and top up a rule

This runbook is for the account owner or a teammate helping them. It assumes no knowledge of the
implementation. The user retains custody throughout: none of these actions moves principal.

## What the states mean

| State             | What the Agent does                                                                               | What you see                                         |
| ----------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `active`          | Evaluates the rule on every matching wake-up.                                                     | Green **Active** pill.                               |
| `paused`          | Keeps the rule and its values, but does not evaluate it.                                          | **Paused** pill and a **Resume** button.             |
| `cancelled`       | Keeps the rule id and executions in **History** and releases its reservation and subscriptions.   | **Cancelled** pill on the old rule.                  |
| Replaced          | Keeps the original rule and its executions in **History** and assigns the new version its own id. | **Replaced** pill with a link to the new rule.       |
| Waiting for funds | The rule stays enabled while the Vault is short of the token it spends.                           | **Waiting for funds** and the amount needed per run. |
| `latched`         | A fired non-cron rule waits for a reset before it can fire again.                                 | **Fired — needs reset**.                             |
| `silent`          | The account has no execution credit, so callbacks stop. This is not active.                       | **Silent — no execution credit**.                    |

Subscriptions are reference-counted per topic. Pausing the last rule that needs a topic calls
`unsubscribe` exactly once; resuming re-subscribes once for the first rule on that topic.
Cancelling a rule that is already paused does not release the topic a second time.

## Pause or resume in the app

1. Open `/rules` and select the rule's **Detail** link.
2. Under **Control**, press **Pause**. The pill changes immediately; the transaction is sent on
   Lasna and the page waits for its receipt.
3. To undo, press **Resume** on the same panel.

If the transaction is refused, the pill returns to its previous value and the panel shows the
contract's reason (for example `NotOwner` or `RuleNotActive`).

## Cancel in the app

1. Open the rule detail.
2. Press **Cancel rule**, then **Confirm cancel**.
3. Confirm the pill reads **Cancelled**.

Cancelling is permanent. The Agent stops requesting new executions for that rule when the
transaction confirms. A callback already sent to the Vault can still settle. Use **Pause** for
a temporary stop.

## Edit a rule

On automation accounts that support edits, open the rule and select **Edit rule**. Review the new
sentence and sign once on Lasna. The updated rule keeps its priority and the old rule keeps its
executions and proofs. A rule that was paused or waiting for a reset has a paused replacement.
An existing callback can still settle. The replacement waits until any old callback has expired
before it can request another execution.

## Reorder in the app

The Agent checks enabled rules from top to bottom.

1. Open **Your rules** and find **Evaluation order**.
2. Drag a rule by its handle, or use **Move up** / **Move down** (keyboard works).
3. Confirm the new order in your wallet. The order persists after a reload.

If the order changes before you sign, review the latest order and try again. Paused rules keep
their saved slots and return to the order when resumed.

## Fund a waiting rule

Use **Account & Vault** to deposit the token the rule spends. With the newer Agent and Vault,
scheduled buys skip a due slot when a recent balance report shows insufficient funds. The next
eligible slot can run after the deposit is observed. Paused rules still require **Resume**.
After a plain ERC-20 transfer, the Vault owner can call `publishBalances()` to report the updated
balance. The Vault verifies the live balance on every swap request.
If a request already reached the Vault, delivery can still use network credit. The Agent releases
the request's spend budget when it receives the Vault's skip report for the current attempt.

## Top up execution credit

The banner appears on `/rules` and on a rule detail when the account is `low`, `exhausted`, or
in `debt`.

1. Read the remaining credit and the warning threshold on the budget meter.
2. Call `depositTo(<agent address>)` on the **Lasna system contract**
   (`0x8888888888888888888888888888888888888888`) with the amount to add. The agent address is
   shown on the rule detail page.
3. Wait for the Lasna receipt, then reload. The meter should move above the threshold.

The caveat matters: a plain ETH/token transfer to the system contract **without** the target
address does not credit the account and can strand the funds. Always pass the account as the
`depositTo` argument.

## If something looks wrong

- **Rule still runs after Pause.** Check the transaction receipt and the rule's event history.
  A pause that did not confirm did not take effect. Do not send a second pause; wait for the
  first receipt.
- **Budget meter still low after a top-up.** Confirm the transfer used `depositTo(agent)`, not a
  bare transfer, and that both were on Lasna.
- **Rule shows latched.** This is expected after a fire for non-cron rules. Reset it from the
  owner flow once the condition should be evaluated again.
