# Workflow composer and canvas

Rulebook provides a visual builder and drafting assistant for constructing personal on-chain automations. You can start from one of 13 pre-built recipes, draft a workflow from a natural-language description with the Rulewright assistant, or assemble custom logic directly on the interactive canvas.

Before signing on-chain, every workflow is synthesized into human-readable sentences and an explicit contract preview detailing spending caps, weekly limits, recipients, and callback parameters.

## The visual workflow canvas

The workflow composer organizes logic into a tree structure composed of three node categories:

1. **Triggers** — The event that wakes the Agent on Reactive Lasna:
   - `Cron` — Periodic timer tick (`Cron100` for short intervals; `Cron10000` for long intervals).
   - `Pair sync` — Uniswap V2 pair `Sync` event for price updates.
   - `Token transfer` — ERC-20 `Transfer` events (e.g. USDC sent to the Vault or sent from the owner).
   - `Vault balances` — Changes in Vault token holdings.

2. **Checks (Conditions)** — Evaluation logic that branches execution:
   - Each check node splits execution into a **Yes** path and an **Otherwise** path.
   - Types include: price above/below threshold, price dip percentage relative to previous observation, price band deviation, token transfer amount threshold, and wallet inactivity duration.

3. **Actions** — Settleable instructions dispatched via callback to the Vault:
   - `Swap` — Atomic trade through Uniswap V2 router (e.g. USDC for WETH).
   - `Transfer` — ERC-20 token payout to a specified recipient.
   - `Refill (transferFrom)` — Pulls approved tokens from the owner's wallet into the Vault.
   - `Alert` — Emits an on-chain alert event without moving funds.

### Structural limits

These bounds are enforced both in the client-side builder and by the on-chain validator (`WorkflowProgramValidatorV2`):

| Limit                            | Maximum                 |
| -------------------------------- | ----------------------- |
| Nodes in one program             | 15 nodes                |
| Checks on a single path          | 3 checks                |
| Ordered actions on a single path | 3 actions               |
| Active workflows per Agent       | 4 workflows             |
| Schedule interval                | 120 seconds to 30 days  |
| Slippage tolerance               | At most 10% (1,000 bps) |
| Callback gas limit               | 850,000 gas             |
| Payload lifetime                 | 10 minutes              |
| Price observation freshness      | 1 hour                  |

## The 13 standard recipes

Rulebook provides 13 ready-to-run recipes across three categories:

| Category      | Recipe               | Trigger                    | Behavior                                                                            |
| ------------- | -------------------- | -------------------------- | ----------------------------------------------------------------------------------- |
| Trading       | Scheduled buy        | `Cron100`                  | Regular recurring swap of USDC for WETH                                             |
| Trading       | Buy more on a dip    | `Cron100` + Pair `Sync`    | Swaps if the pair price fell by a set percentage; otherwise skips                   |
| Trading       | Limit buy            | Pair `Sync`                | One-shot swap when price drops below threshold                                      |
| Trading       | Take profit          | Pair `Sync`                | One-shot swap when price rises above threshold                                      |
| Trading       | Trailing stop        | Pair `Sync`                | Swaps when price drops below a trail percentage from its observed peak              |
| Trading       | Price-band trading   | Pair `Sync`                | Buys below lower bound, sells above upper bound                                     |
| Payments      | Recurring transfer   | `Cron100`                  | Sends a fixed token payout on a timer                                               |
| Payments      | Income sweep         | USDC `Transfer`            | Multi-threshold sweep: sends higher or lower payout based on deposit size, or skips |
| Payments      | Balance refill       | `Cron100`                  | Calls `transferFrom` on owner wallet if Vault falls below threshold                 |
| Wallet safety | Inactivity payout    | `Cron100` + owner activity | Sends one-off payout if owner is quiet for set days, after a 24-hour grace period   |
| Wallet safety | Price alert          | Pair `Sync`                | Records alert when price crosses a threshold                                        |
| Wallet safety | Price-range alert    | Pair `Sync`                | Records alert when price exits a bounded range                                      |
| Wallet safety | Large-transfer alert | Token `Transfer`           | Records alert when transfer exceeds a threshold                                     |

## The Rulewright drafting assistant

Rulewright (`packages/shared/src/rulewright.ts`) translates informal natural-language prompts into structured workflow drafts:

1. **Prompt interpretation**: Maps text descriptions (e.g. "Every Monday buy 50 USDC of WETH with a 200 USDC weekly budget") to appropriate triggers, checks, actions, and limits.
2. **Draft staging**: Populates the visual canvas and settings panel with the interpreted nodes.
3. **Transparent review**: The user reviews every parameter, recipient, token, and limit on the canvas and in the summary panel before any transaction is prepared. Rulewright never signs or broadcasts transactions.

## Two-step on-chain authorization

To activate a workflow, the owner signs two transactions:

1. **Vault authorization (`authorizeWithWeeklyBudget`)**:
   - Sent to `WorkflowVaultV2` on Unichain Sepolia.
   - Registers the program hash, title, execution epoch, per-run caps, and weekly spending budgets.
   - Enforces that no callback can execute instructions the owner did not authorize.

2. **Agent activation (`enable`)**:
   - Sent to `WorkflowAgentV2` on Reactive Lasna after the Vault transaction confirms.
   - The Agent verifies the matching program bytecode, stores the program, and subscribes to the required logs through the Reactive system contract.

Pausing an active workflow follows the reverse order: revoking authorization on the Vault (which immediately halts callbacks on the funds side), followed by disabling subscriptions on the Agent.

## The legacy V1 template model

Rulebook's earlier version used 13 fixed templates with a single-sentence fill-in-the-blank model (`contracts/src/agent/Agent.sol` and `contracts/src/vault/Vault.sol`). In that model:

- Each rule mapped to 8 packed 32-byte words on chain (`Rule` struct).
- Values were mapped into slot keys (`amount_in`, `threshold`, `secondary`, `schedule`, `pair`).
- Execution followed a linear trigger -> condition -> action loop without branching paths.

The catalog in `docs/catalog.md` documents the slot mappings for the legacy templates. The current application uses the V2 visual workflow engine described above.
