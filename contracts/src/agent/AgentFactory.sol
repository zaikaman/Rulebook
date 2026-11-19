// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";

import {Agent} from "./Agent.sol";
import {IRuleRegistry} from "../registry/IRuleRegistry.sol";
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
    /// @notice Registry every deployed Agent publishes public rules to.
    IRuleRegistry public immutable registry;
    address public immutable implementation;
    /// @notice Total agents deployed, also used as the deployment index.
    uint256 public agentCount;

    mapping(address => address) private _agentOf;

    constructor(IReactiveSystem system_, IRuleRegistry registry_) {
        systemContract = system_;
        registry = registry_;
        implementation = address(new Agent(address(this), system_, registry_, address(this)));
    }

    /// @notice Deploys the Agent for `owner_`.
    /// @dev Reverting on a second deploy is deliberate: onboarding resumes, it never duplicates.
    function deploy(address owner_) external returns (address agent) {
        if (owner_ == address(0)) revert InvalidTemplateParams();
        if (_agentOf[owner_] != address(0)) revert AgentAlreadyLinked();
        agent = Clones.clone(implementation);
        Agent(agent).initialize(owner_);
        _agentOf[owner_] = agent;
        agentCount += 1;
        emit AgentDeployed(owner_, agent, agentCount);
    }

    /// @notice The agent deployed for `owner_`, or the zero address.
    function agentOf(address owner_) external view returns (address agent) {
        agent = _agentOf[owner_];
    }
}
