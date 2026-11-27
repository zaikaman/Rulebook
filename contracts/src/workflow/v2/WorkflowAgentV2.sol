// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";
import {IPayable} from "@reactive/interfaces/IPayable.sol";
import {IReactive} from "@reactive/interfaces/IReactive.sol";
import {IReactiveSystem} from "../../shared/ReactiveTypes.sol";
import {WorkflowAgentStorageV2} from "./WorkflowAgentStorageV2.sol";
import {WorkflowProgramV2 as P} from "./WorkflowProgramV2.sol";
import {WorkflowProgramValidatorV2} from "./WorkflowProgramValidatorV2.sol";

interface IAgentFactoryV2 {
    function approvedImplementation(address implementation) external view returns (bool);
}

/// @notice Routes authenticated Reactive events to the wallet's chain-specific V2 Vault.
contract WorkflowAgentV2 is WorkflowAgentStorageV2, UUPSUpgradeable {
    address public immutable reactModule;

    constructor(
        IReactiveSystem system_,
        WorkflowProgramValidatorV2 validator_,
        address reactModule_
    ) WorkflowAgentStorageV2(system_, validator_) {
        if (reactModule_ == address(0) || reactModule_.code.length == 0) {
            revert InvalidWorkflow();
        }
        reactModule = reactModule_;
        // Lock the implementation contract so it can never be initialized directly.
        owner = address(1);
    }

    function initialize(address owner_) external {
        if (owner != address(0) || owner_ == address(0)) {
            revert Unauthorized();
        }
        factory = msg.sender;
        owner = owner_;
        vendor = IPayable(payable(address(system)));
        addAuthorizedSender(address(system));
    }

    function _authorizeUpgrade(address newImplementation) internal view override {
        if (msg.sender != owner) revert Unauthorized();
        if (
            factory == address(0)
                || !IAgentFactoryV2(factory).approvedImplementation(newImplementation)
        ) {
            revert InvalidWorkflow();
        }
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    function linkVault(uint32 chain, address vault) external onlyOwner {
        if ((chain != primaryChain && chain != secondaryChain) || vault == address(0)) {
            revert InvalidWorkflow();
        }
        if (vaults[chain] != address(0)) {
            for (uint256 index; index < active.length; ++index) {
                Entry storage entry = entries[active[index]];
                if (entry.chain == chain || entry.inactivity) revert InvalidWorkflow();
            }
        }
        vaults[chain] = vault;
    }

    function withdraw(uint256 amount) external onlyOwner {
        _pay(payable(owner), amount);
    }

    /// @notice Recovers ERC-20 tokens mistakenly sent to the Agent.
    function withdrawToken(address token, uint256 amount) external onlyOwner {
        if (token == address(0)) revert InvalidWorkflow();
        (bool ok, bytes memory ret) = token.call(abi.encodeCall(IERC20.transfer, (owner, amount)));
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert InvalidWorkflow();
    }

    /// @notice Starts a new signed workflow epoch once the destination authorization has settled.
    function enable(
        bytes32 workflow,
        uint64 epoch,
        bytes calldata encoded,
        string calldata title,
        uint64 originAfter
    ) external onlyOwner {
        _enableCore(workflow, epoch, encoded, title, originAfter);
    }

    /// @notice Starts a new signed workflow epoch with an initial weekly budget snapshot.
    function enableWithBudget(
        bytes32 workflow,
        uint64 epoch,
        bytes calldata encoded,
        string calldata title,
        uint64 originAfter,
        BudgetSeed calldata budgetSeed
    ) external onlyOwner {
        budgets[workflow] = Budget(
            budgetSeed.usdcLimit,
            budgetSeed.wethLimit,
            budgetSeed.usdcSpent,
            budgetSeed.wethSpent,
            budgetSeed.weekStart,
            budgetSeed.revision,
            true
        );
        _enableCore(workflow, epoch, encoded, title, originAfter);
        address vault = vaults[entries[workflow].chain];
        if (budgetSeed.revision < budgetRevisions[workflow][vault]) revert InvalidWorkflow();
        budgetRevisions[workflow][vault] = budgetSeed.revision;
    }

    function _enableCore(
        bytes32 workflow,
        uint64 epoch,
        bytes calldata encoded,
        string calldata title,
        uint64 originAfter
    ) private {
        P.AgentPlan memory plan = validator.inspectForAgent(encoded);
        Entry storage entry = entries[workflow];
        if (
            workflow == bytes32(0) || epoch <= entry.epoch || vaults[plan.chain] == address(0)
                || originAfter == 0 || bytes(title).length == 0 || bytes(title).length > 80
                || (plan.expires != 0 && plan.expires <= block.timestamp)
        ) revert InvalidWorkflow();
        if (entry.epoch == 0) known.push(workflow);
        if (
            msg.sig != this.enableWithBudget.selector
                && (entry.trigger == 0 || entry.chain != plan.chain)
        ) {
            delete budgets[workflow];
        }
        if (entry.trigger != 0) _stop(workflow, entry);
        if (active.length >= MAX_ACTIVE) revert InvalidWorkflow();
        bytes32 hash = keccak256(encoded);
        entry.hash = hash;
        entry.epoch = epoch;
        entry.nextDue = uint64(block.timestamp);
        entry.lasnaAfter = uint64(block.number);
        entry.trigger = plan.trigger;
        entry.chain = plan.chain;
        entry.interval = plan.interval;
        entry.expiry = plan.expires;
        entry.source = plan.source;
        entry.subject = plan.subject;
        entry.dip = (plan.flags & P.FLAG_DIP) != 0;
        entry.inactivity = (plan.flags & P.FLAG_INACTIVITY) != 0;
        entry.once = (plan.flags & P.FLAG_ONCE) != 0;
        entry.originAfter = originAfter;
        entry.originChain = plan.originChain;
        delete meta[workflow];
        meta[workflow].flags = plan.flags;
        delete highs[workflow];
        programs[hash] = encoded;
        paths[workflow] = plan.paths;
        titles[workflow] = title;
        active.push(workflow);
        _settlementFilters(workflow, entry, true);
        if (
            (entry.trigger == P.SCHEDULE || entry.trigger == P.PRICE)
                && (plan.flags & P.FLAG_SPENDS) != 0 && _budgetBlocks(workflow, 0)
        ) {
            _enterPause(workflow, entry);
        } else {
            _triggerFilters(entry, !paused[workflow]);
        }
        emit Enabled(workflow, hash, plan.chain, epoch, title);
    }

    function disable(bytes32 workflow, uint64 epoch) external onlyOwner {
        Entry storage entry = entries[workflow];
        if (entry.trigger == 0 || epoch != entry.epoch) revert InvalidWorkflow();
        _stop(workflow, entry);
        emit Disabled(workflow, epoch);
    }

    function workflowIds() external view returns (bytes32[] memory) {
        return known;
    }

    /// @notice Number of budget-blocked runs waiting for a retry on `workflow`.
    function pendingRuns(bytes32 workflow) external view returns (uint256) {
        return pending[workflow].length;
    }

    /// @notice True while an exhausted weekly budget has removed the workflow's trigger filters.
    function watchingPaused(bytes32 workflow) external view returns (bool) {
        return paused[workflow];
    }

    /// @notice Lasna block pinned for the next budget-reset wake, or zero when none is scheduled.
    function wakeBlock(bytes32 workflow) external view returns (uint64) {
        return wakeAt[workflow];
    }

    function publication(bytes32 workflow)
        external
        view
        returns (bytes32 hash, uint32 chain, string memory title)
    {
        Entry storage entry = entries[workflow];
        if (entry.epoch == 0) revert InvalidWorkflow();
        return (entry.hash, entry.chain, titles[workflow]);
    }

    /// @notice Re-arms a paused workflow without waiting for its pinned wake.
    function resumeWatching(bytes32 workflow) external {
        workflow;
        _delegateToReact();
    }

    /// @notice Reacts to the exact configured emitters and dispatches one request per workflow and log.
    function react(IReactive.LogRecord calldata log) external {
        log;
        _delegateToReact();
    }

    function _delegateToReact() private {
        address target = reactModule;
        assembly ("memory-safe") {
            calldatacopy(0, 0, calldatasize())
            let ok := delegatecall(gas(), target, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            if iszero(ok) { revert(0, returndatasize()) }
            return(0, returndatasize())
        }
    }
}
