// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

/// @title IRuleRegistry
/// @notice The only registry surface an Agent or a user needs: publish one stored rule.
interface IRuleRegistry {
    /// @notice Publishes `ruleId` for `agent`; the caller must own the Agent.
    /// @dev The registry reads the rule from the Agent, so the stored parameters and the
    /// published `paramsHash` cannot disagree.
    function list(address agent, uint256 ruleId, string calldata metadataURI) external;
}
