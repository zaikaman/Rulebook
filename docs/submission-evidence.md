# Submission evidence

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
