// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

// Custom errors only (Constitution IV). No revert string may appear in contracts/src.
error NotOwner();
error InvalidVaultAuthorization();
error NotAgent();
// Required by the factory ordering invariant (onchain-interfaces.md §4, FR-004).
error AgentAlreadyLinked();
// Retained for decoding errors from earlier deployments; new Vaults do not read remote Agent state.
error AgentNotLinked();
error UnknownTemplate(uint8 template);
error UnsupportedChain(uint16 chainId);
error InvalidAmount();
error InvalidThreshold();
error InvalidSecondary();
error InvalidTemplateParams();
error RuleLimitReached(uint256 active, uint256 max);
error RuleNotActive(uint256 ruleId);
error RuleLatched(uint256 ruleId);
error ConditionNotMet();
error ExceedsPerRunCap(uint256 requested, uint256 cap);
// Abuse control from IDEA.md §11: the monthly pre-approved spend across active rules.
error MonthlyCapExceeded(uint256 approved, uint256 cap);
error SlippageExceeded(uint256 minOut, uint256 actual);
error Expired(uint256 ruleId, uint64 expiry);
error CooldownActive(uint256 ruleId, uint64 readyAt);
error InsufficientPrincipal(uint256 required, uint256 available);
error TransferFailed();
error NotServiceProvider();
error CallbackSenderMismatch(address expected, address actual);
error MirrorDepthNotAllowed();
error MirrorBurstExceeded();
error DuplicateLeaderExecution(bytes32 key);
error TokenMismatch(address expected, address actual);
// Alert templates move no funds; the Vault refuses them before any transfer (FR-023).
error AlertOnlyTemplate(uint8 template);
// The callback data did not match the six-word execution payload layout.
error InvalidCallbackPayload();
// The Agent has no registry address, so it cannot publish a public rule (FR-038).
error RegistryNotConfigured();
