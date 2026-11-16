# 0003 — The sponsor relayer key

- **Status**: Accepted
- **Date**: 2026-11-16
- **Context**: FR-005/FR-006 require the operator to pay deployment and execution costs while
  never gaining custody. Onboarding needs a server-side signer, which is the only key in the
  system that can spend sponsor funds.

## Decision

One sponsor key exists. It signs only calls whose `(to, selector)` pair is on a hard-coded
allowlist; the check runs before the transaction is built or signed. The allowed operations are:

| Target                   | Selector                                  | Purpose                                                               |
| ------------------------ | ----------------------------------------- | --------------------------------------------------------------------- |
| `AgentFactory`           | `deploy(address)`                         | create the user's Agent, owned by the user                            |
| `VaultFactory`           | `deploy(address,address,address,address)` | create the user's Vault, owned by the user                            |
| Reactive system contract | `depositTo(address)`                      | credit the Agent's execution reserves (settles debt first)            |
| Demo USDC / WETH         | `approve(address,uint256)`                | approve the user's vault for the fixed starter amount                 |
| The vault being funded   | `deposit(address,uint256)`                | record starter funds as withdrawable principal                        |
| A capped native transfer | no selector                               | send the user Lasna gas so they can sign their own config transaction |

The native transfer is reachable only through `topUpUserGas(owner)`, which reads the owner's
balance first and sends only the shortfall up to `SPONSOR_GAS_TOP_UP_WEI`. The vault deposit is
reachable only through `sendStarterFunds(vault)`, which binds the deposit target to that vault.

## What the key provably cannot do

- It is not the owner of any Agent or Vault. Factories write `owner = user`; the relayer never
  appears as an owner.
- It cannot call `withdraw`, `setPayoutAddress`, `setLimits`, pause, cancel, or `addRule`.
  Those selectors are absent from the allowlist and the key has no role that would satisfy
  their owner checks.
- It cannot deploy a second Agent or Vault for an existing owner: both factories revert
  `AgentAlreadyLinked`.
- It cannot move a user's principal. Its only token interactions are approving and depositing
  the fixed demo amounts into the vault named in the request.
- It cannot redirect a starter-funds transfer: the vault owner is read from the vault itself,
  not from the request body.

## Where it lives, caps, rotation, revocation

- Stored only as the Heroku config var `SPONSOR_PRIVATE_KEY`; never in the repo, never in a
  `VITE_*` variable, never logged. `.env` files are ignored.
- Caps: per-address onboarding rate limit (`ONBOARDING_RATE_LIMIT_PER_MINUTE`), a global daily
  cap (`ONBOARDING_DAILY_CAP`), fixed reserve target (`SPONSOR_RESERVE_TARGET_WEI`), fixed gas
  top-up (`SPONSOR_GAS_TOP_UP_WEI`), and fixed starter amounts (`STARTER_FUNDS_USDC`,
  `STARTER_FUNDS_WETH`). Starter funds are once per address, enforced by a claim row written
  before the first transfer.
- Rotation: generate a new key, fund it, set `SPONSOR_PRIVATE_KEY` and the factory addresses
  as Heroku config vars, restart the dyno, then drain the old key. No contract change is
  required because the key holds no role.
- Revocation: remove the variable (the onboarding/starter-funds routes return 503), or drain
  the key. Users keep their contracts and can still withdraw; only new onboarding stops.

## Consequences

- Sponsorship is a central dependency: if the key is unfunded, onboarding and new rules go
  quiet. That is disclosed in the README, and `depositTo` remains permissionless so anyone can
  revive an Agent.
- The demo-token `approve`/`deposit` pair is two transactions per token, so starter funds
  return four hashes. A plain transfer was rejected because it would not update `principalOf`
  and would leave the tokens unwithdrawable.
