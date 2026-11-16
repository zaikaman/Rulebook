# 0004 — Two-deployment onboarding and resume

- **Status**: Accepted
- **Date**: 2026-11-16
- **Context**: A user's automation account lives on Reactive Lasna and their funds account on
  Unichain Sepolia. A contract on one chain cannot deploy to the other, and the Vault needs the
  Agent address in its constructor because that address is the callback authentication.

## Decision

Onboarding is two deployments, in this order:

1. `AgentFactory.deploy(owner)` on Lasna. The Agent is owned by `owner`; the relayer is only the
   caller. The Agent address is the identity every later step uses.
2. `VaultFactory.deploy(owner, agent, usdc, weth)` on Unichain Sepolia. The Vault stores
   `owner` and `agent` as immutables; the factory verifies it is called with an existing Agent
   owned by `owner` and refuses a second vault for the same owner with `AgentAlreadyLinked`.
3. `Agent.linkVault(chainId, vault)` is signed by the **owner**, not the relayer. It records the
   destination vault for chain 1301 and emits `VaultLinked`. `Vault.execute` refuses every
   callback until the Agent reports that vault (`AgentNotLinked`), so a deployment alone cannot
   move funds.

The ordering invariant is therefore: Agent before Vault, Vault before link. A Vault deployed
with a different Agent is rejected by `linkVault` because the Vault's `agent()` must equal the
linking Agent.

## Resume strategy

`POST /v1/onboarding` reads the factories before doing anything and skips every step that
already exists on-chain:

- agent exists, vault missing → deploy only the vault (`agent_only`);
- both exist, link missing → return `partial` with `link.error = owner_signature_required`;
- linked → `complete`, with all deployment and funding steps skipped.

The client then signs the link transaction if the response is `partial`, and the setup hook
polls `GET /v1/accounts/:agent` until the on-chain link is visible. `setup_state` is derived
from the indexed `agents`/`vaults` rows **and** the on-chain `getVault(1301)` read, so a stale
database cannot report `complete`. A completed account is never sent through onboarding again;
the hook returns without calling the API when the state is already `complete`.

Starter funds are a separate, once-per-address action. The claim row is written before any
transfer, a repeat request returns 409, and the funds are approved and deposited (not plain
transferred) so they become withdrawable principal.

## Consequences

- Setup needs two signatures only in the normal case: none for the two sponsored deployments,
  one for `linkVault`, and one for a starter-funds claim (a backend call, not a signature).
- A failed vault deployment leaves a resumable `agent_only` account; retrying creates the
  missing vault without redeploying the Agent.
- The operator can never become an owner, and the owner can withdraw the full principal with
  no operator action (SC-006).
