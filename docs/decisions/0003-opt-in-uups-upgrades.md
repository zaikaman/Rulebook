# 0003 — Opt-in UUPS upgrades and unbundled V2 deployment

**Date**: 2026-11-27
**Status**: Accepted

## Context

The initial V2 deployment deployed EIP-1167 minimal clones (`Clones.clone`) from factories that embedded `new WorkflowProgramValidatorV2()` and `new WorkflowAgentV2(...)` / `new WorkflowVaultV2(...)` inside their constructors. That design had three problems:

1. Factory initcode exceeded 40 KB, inflating single-transaction deployment gas on Reactive Mainnet.
2. Both `WorkflowAgentV2` and `WorkflowVaultV2` sat within ~240–267 bytes of the EIP-170 24,576-byte runtime limit, leaving no room for bug fixes or features.
3. Immutable clones forced every bug fix, pool/oracle migration, or new chain addition to redeploy all factories and abandon users' non-refundable prepaid Reactive watching and execution credits.

## Decision

1. **Unbundled deployments:** `WorkflowProgramValidatorV2`, `WorkflowAgentV2` / `WorkflowVaultV2` implementations, and the factories are deployed separately and wired via constructor arguments.
2. **Owner-only opt-in UUPS proxies (`ERC1967Proxy` + `UUPSUpgradeable`):** Both `WorkflowAgentFactoryV2` and `WorkflowVaultFactoryV2` deploy `ERC1967Proxy` instances initialized with the user's `owner`. Each factory maintains `approvedImplementation` and `implementation` (the default for new accounts), controllable by `admin`. Existing proxies only upgrade when their `owner` calls `upgradeToAndCall(newImplementation, data)` against an implementation approved by their factory (`_authorizeUpgrade`).
3. **Bytecode headroom via stateless validator delegation and Agent module split:** Pure and stateless market/budget/filter helpers (`readSpotPrice`, `quoteSwapFloor`, `budgetBlocks`, `settlementFilters`, `triggerFilters`) live on `WorkflowProgramValidatorV2`, and `WorkflowAgentV2` shares `WorkflowAgentStorageV2` with a delegatecall `WorkflowAgentReactV2` module (`react` / `resumeWatching`), keeping every deployed contract comfortably below EIP-170 while keeping per-chain `immutable` configurations in implementation bytecode.

## Consequence

- Wallet owners retain sole custody and upgrade authority over their own Agent and Vault proxies: a factory admin can publish new approved implementations for opt-in upgrades and new accounts, but can never unilaterally alter code holding user funds or subscriptions.
- Proxy addresses, Reactive subscriptions, callback authentication, Marketplace listings, token balances, and prepaid Reactive credits persist across opt-in upgrades.
- Future implementation upgrades MUST preserve storage layout ordering (only appending new variables and consuming from the trailing `uint256[50] private __gap` slots) and MUST NOT remove `UUPSUpgradeable` compatibility.
