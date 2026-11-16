# 0004 — Cross-chain onboarding and resume

- **Status**: Accepted
- **Date**: 2026-11-16 (amended 2026-11-17)
- **Context**: A user's automation account lives on Reactive Lasna and their funds account on
  Unichain Sepolia. EVM contracts on these networks cannot synchronously inspect each other's
  state. The Vault needs the Agent address as its authenticated Reactive callback identity.

## Decision

Onboarding proceeds in resumable stages:

1. `AgentFactory.deploy(owner)` on Lasna. The Agent is owned by `owner`; the relayer is only the
   caller. Its address is the identity used by later setup steps.
2. The connected owner signs an EIP-712 `VaultDeployment` authorization for the Unichain
   `VaultFactory`. It binds the owner, Agent, token pair, factory domain, per-owner nonce, and a
   short expiry. The frontend sends this signature to the sponsor API; the relayer never signs
   for the owner.
3. `VaultFactory.deploy(...)` verifies the signature and deploys a Vault with immutable owner
   and Agent identities. The factory cannot query the remote Agent's code or owner. The signed
   authorization is the explicit cross-chain consent and prevents arbitrary deployment or replay.
4. The owner calls `Agent.linkVault(chainId, vault)` on Lasna. This stores owner-authorized
   discovery metadata only. It does not participate in callback authorization because a Lasna
   Agent cannot be queried from Unichain.

The Vault accepts execution only when both checks pass: `msg.sender` is the configured Reactive
callback proxy, and the first callback argument is the immutable Agent address injected by
Reactive. The Vault does not read Agent state across chains. Its immutable Agent was selected in
the owner's signature verified by the factory.

## Resume strategy

`POST /v1/onboarding` reads both factories before doing anything and skips existing deployments:

- Agent missing → deploy the Agent and return `agent_only` so the owner can sign the exact Vault
  authorization;
- Agent exists, Vault missing, signature absent → return `agent_only` and request authorization;
- Agent exists, Vault missing, valid signature supplied → deploy only the Vault;
- both exist, Agent link missing → return `partial` with `link.error = owner_signature_required`;
- both exist and linked → `complete`, with deployment and funding steps skipped.

If the user rejects a signature or a transaction fails, they can retry without duplicating a
confirmed deployment. The Agent's `getVault(1301)` record remains the setup-completion signal,
while the factory's `vaultOf(owner)` remains the source of truth for Vault deployment.

Starter funds are a separate once-per-address action. The claim row is written before any
transfer, a repeat request returns 409, and funds are approved and deposited (not plain
transferred) so they become withdrawable principal.

## Consequences

- Setup requires an EIP-712 signature for Vault deployment and an owner transaction to record the
  Lasna link; sponsored deployments remain gasless for the owner.
- Signatures are factory-, chain-, token-pair-, Agent-, nonce-, and time-bound. A consumed or
  expired authorization cannot be used again.
- The operator can never become an owner, and the owner can withdraw principal without operator
  action (SC-006).
