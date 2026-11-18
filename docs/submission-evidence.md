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

## US8 · Mirror

The Foundry integration scenario verified two independent swaps and no third swap
after replay. Playwright verifies two destination rows with separate explorer links
using a fixture.

On 18 November 2026, the live leader swap spent 1 USDC and the follower swap spent
0.5 USDC. Each swap settled in its own Unichain Sepolia transaction.

- [Leader destination](https://sepolia.uniscan.xyz/tx/0xccf64f31878be71e8c0d3ba0dee0700e05d4d4bf0dc0e24d789a39e7e872bdcc)
- [Follower destination](https://sepolia.uniscan.xyz/tx/0x1b01d4dff73a83807bf4c396ee49a0baa58463bb4e8fc448d8693d66e4438251)

A read-only replay of the same leader log against confirmed Lasna state evaluated
false and requested zero callbacks. The live vault receipts confirmed both swaps.
Lasna `getCallbacks` returned empty arrays during verification, so the grouped
proof remains verified by fixture. [Full transaction and replay evidence](./measurements.md)
