// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {Agent} from "./Agent.sol";
import {IReactiveSystem} from "../shared/ReactiveTypes.sol";
import {AgentAlreadyLinked, InvalidTemplateParams} from "../shared/Errors.sol";

/// @title AgentFactory
/// @notice Deploys one Agent per owner on Reactive Lasna.
/// @dev One agent per owner is what makes onboarding idempotent-but-not-duplicating (FR-004).
contract AgentFactory {
    /// @notice Emitted on every successful deployment.
    event AgentDeployed(address indexed owner, address indexed agent, uint256 index);

    /// @notice The Reactive system contract every deployed Agent trusts.
    IReactiveSystem public immutable systemContract;
    /// @notice Total agents deployed, also used as the deployment index.
    uint256 public agentCount;

    mapping(address => address) private _agentOf;

    constructor(IReactiveSystem system_) {
        systemContract = system_;
    }

    /// @notice Deploys the Agent for `owner_`.
    /// @dev Reverting on a second deploy is deliberate: onboarding resumes, it never duplicates.
    function deploy(address owner_) external returns (address agent) {
        if (owner_ == address(0)) revert InvalidTemplateParams();
        if (_agentOf[owner_] != address(0)) revert AgentAlreadyLinked();
        agent = address(new Agent(owner_, systemContract, address(this)));
        _agentOf[owner_] = agent;
        agentCount += 1;
        emit AgentDeployed(owner_, agent, agentCount);
    }

    /// @notice The agent deployed for `owner_`, or the zero address.
    function agentOf(address owner_) external view returns (address agent) {
        agent = _agentOf[owner_];
    }
}
