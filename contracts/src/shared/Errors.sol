// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

// Custom errors only (Constitution IV). No revert string may appear in contracts/src.
error NotOwner();
error NotAgent();
// Required by the factory ordering invariant (onchain-interfaces.md §4, FR-004).
error AgentAlreadyLinked();
// Raised by a vault whose Agent has not recorded it through `linkVault`.
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
