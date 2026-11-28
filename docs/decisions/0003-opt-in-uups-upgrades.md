# 0003 — Opt-in UUPS upgrades and unbundled V2 deployment

**Date**: 2026-11-27
**Status**: Accepted

## Context

The initial V2 deployment deployed EIP-1167 minimal clones (`Clones.clone`) from factories that embedded `new WorkflowProgramValidatorV2()` and `new WorkflowAgentV2(...)` / `new WorkflowVaultV2(...)` inside their constructors. That design had three problems:

1. Factory initcode exceeded 40 KB, inflating single-transaction deployment gas on Reactive Mainnet.
2. Both `WorkflowAgentV2` and `WorkflowVaultV2` sat within ~240–267 bytes of the EIP-170 24,576-byte runtime limit, leaving no room for bug fixes or features.
3. The legacy contracts could only adopt code changes through a new deployment, leaving any unused prepaid Reactive watching and execution credit at the former addresses.

The November 27 review records the legacy implementation and its findings. [Historical contract review](https://github.com/zaikaman/Rulebook/blob/dd178595a97a45b1831dab4fb89e3d92ea76dd59/docs/contract-audit-2026-11-27.md)

## Decision

1. **Unbundled deployments:** `WorkflowProgramValidatorV2`, `WorkflowAgentV2` / `WorkflowVaultV2` implementations, and the factories are deployed separately and wired via constructor arguments.
2. **Owner-only opt-in UUPS proxies (`ERC1967Proxy` + `UUPSUpgradeable`):** Both `WorkflowAgentFactoryV2` and `WorkflowVaultFactoryV2` deploy `ERC1967Proxy` instances initialized with the user's `owner`. Each factory maintains `approvedImplementation` and `implementation` (the default for new accounts), controllable by `admin`. Existing proxies only upgrade when their `owner` calls `upgradeToAndCall(newImplementation, data)` against an implementation approved by their factory (`_authorizeUpgrade`).
3. **Bytecode headroom via stateless validator delegation and Agent module split:** Pure and stateless market/budget/filter helpers (`readSpotPrice`, `quoteSwapFloor`, `budgetBlocks`, `settlementFilters`, `triggerFilters`) live on `WorkflowProgramValidatorV2`, and `WorkflowAgentV2` shares `WorkflowAgentStorageV2` with a delegatecall `WorkflowAgentReactV2` module (`react` / `resumeWatching`), reducing runtime bytecode. The React module delegates feedback handling to `WorkflowAgentFeedbackV2`, and the Vault delegates settlement to `WorkflowVaultSettlementV2`. Per-chain immutable configuration remains in implementation and module bytecode.

## Consequence

- Wallet owners retain sole custody and upgrade authority over their own Agent and Vault proxies: a factory admin can publish new approved implementations for opt-in upgrades and new accounts, but can never unilaterally alter code holding user funds or subscriptions.
- Proxy addresses, Reactive subscriptions, callback authentication, Marketplace listings, token balances, and prepaid Reactive credits persist across opt-in upgrades.
- Preserve storage layout and UUPS compatibility across upgrades. Add fields using the reserved gaps in `WorkflowAgentStorageV2` and `WorkflowVaultStorageV2`, and verify storage compatibility with the delegatecall modules.
- The legacy contracts require a wallet cutover. ERC-1967 proxies use the owner opt-in procedure. [Active testnet evidence](../submission-evidence.md#active-testnet-deployment) · [Deployment and upgrade procedures](../../deployments/README.md#upgrading-an-existing-proxy-release)
