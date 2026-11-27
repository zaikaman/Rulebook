// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {AbstractCallback} from "@reactive/abstract-base/AbstractCallback.sol";
import {WorkflowProgramValidatorV2} from "./WorkflowProgramValidatorV2.sol";
import {WorkflowProtocolsV2} from "./WorkflowProtocolsV2.sol";

abstract contract WorkflowVaultStorageV2 is AbstractCallback, ReentrancyGuard, WorkflowProtocolsV2 {
    uint8 public constant CONFIRMED = 1;
    uint8 public constant SKIPPED = 2;
    uint8 public constant EXPIRED = 3;
    uint8 public constant FAILED = 4;
    uint8 public constant IN_GRACE_PERIOD = 6;
    uint8 internal constant NO_PATH = type(uint8).max;
    uint64 public constant PAYOUT_GRACE = 24 hours;
    uint64 internal constant CALLBACK_LIFETIME = 10 minutes;
    uint64 internal constant PRICE_MAX_AGE = 1 hours;
    uint64 internal constant WEEK = 7 days;
    // Unix time zero is a Thursday. Monday 00:00 UTC therefore falls on a weekly remainder of
    // four days, which this shift removes before flooring to the start of the week.
    uint64 internal constant MONDAY_SHIFT = 3 days;

    struct Authorization {
        bytes32 programHash;
        uint64 epoch;
        uint64 originAfter;
        bool active;
    }

    struct WeeklyBudget {
        uint96 usdcLimit;
        uint96 wethLimit;
        uint128 usdcSpent;
        uint128 wethSpent;
        uint64 weekStart;
        uint32 revision;
    }

    struct Memory {
        uint128 peak;
        uint128 referencePrice;
        uint64 lastCheckIn;
        uint64 activity;
        uint64 eligibleAt;
        uint64 positionBlock;
        uint64 positionIndex;
        bool closed;
    }

    struct Context {
        uint256 price;
        uint256 refillThreshold;
        bool dipAvailable;
        bool dip;
        bool swapped;
        bool referenceSeeded;
        MarketCache market;
    }

    error Unauthorized();
    error InvalidAuthorization();
    error StaleBudget();
    error CapExceeded();
    error WeeklyBudgetExceeded();
    error DuplicateOrigin();
    error StaleObservation();
    error CrossingAlreadySettled();
    error SettlementInterrupted();
    error InsufficientVaultBalance(address asset, uint256 required, uint256 available);
    error InsufficientRefillAllowance(uint256 required, uint256 available);
    error InsufficientOwnerBalance(uint256 required, uint256 available);

    event Authorized(bytes32 indexed workflow, bytes32 indexed programHash, uint64 epoch);
    event WeeklyBudgetSet(
        bytes32 indexed workflow, uint96 usdcLimit, uint96 wethLimit, uint32 revision
    );
    event BudgetSynced(
        bytes32 indexed workflow,
        uint96 usdcLimit,
        uint96 wethLimit,
        uint128 usdcSpent,
        uint128 wethSpent,
        uint64 weekStart,
        uint32 revision
    );
    event Revoked(bytes32 indexed workflow, uint64 epoch);
    event CheckIn(bytes32 indexed workflow, uint64 timestamp);
    event Closed(bytes32 indexed workflow, uint64 indexed epoch);
    event GraceStarted(bytes32 indexed workflow, uint64 indexed epoch, uint64 eligibleAt);
    event ReferenceSynced(bytes32 indexed workflow, uint64 indexed epoch, uint128 referencePrice);
    event PeakSynced(bytes32 indexed workflow, uint64 indexed epoch, uint128 peak);
    event PeakCorrected(
        bytes32 indexed workflow,
        uint64 indexed epoch,
        uint128 peak,
        uint128 rejectedPeak,
        uint64 rejectedBlock,
        uint64 rejectedTime
    );
    event AgentRebound(address indexed previousAgent, address indexed nextAgent);
    event BudgetRetry(
        bytes32 indexed workflow,
        uint64 indexed epoch,
        bytes32 indexed runId,
        uint64 weekStart,
        uint32 revision,
        uint64 deadline,
        bytes32 originTransaction,
        uint64 originLogIndex,
        uint64 originBlock,
        uint256 observed,
        address actor
    );
    event Outcome(
        bytes32 indexed workflow,
        bytes32 indexed runId,
        uint64 epoch,
        uint8 status,
        uint8 path,
        bytes4 reason
    );
    event Step(
        bytes32 indexed runId,
        uint8 indexed index,
        uint8 kind,
        uint256 spent,
        uint256 received,
        address account
    );
    event Observation(bytes32 indexed runId, uint256 value, address actor);

    address public immutable callbackProxy;
    uint32 public immutable chain;
    address public owner;
    address public agent;
    bytes32 public paymentWorkflow;
    mapping(bytes32 => Authorization) internal _authorizations;
    mapping(bytes32 => WeeklyBudget) internal weeklyBudgets;
    mapping(bytes32 => bytes) public programs;
    mapping(bytes32 => string) public titles;
    bytes32[] internal knownWorkflows;
    mapping(bytes32 => Memory) public workflowMemory;
    mapping(bytes32 => uint8) public outcomes;
    mapping(bytes32 => bool) internal consumedPayments;
    mapping(bytes32 => mapping(bytes32 => bool)) internal consumedDips;
    address public factory;
    mapping(bytes32 => uint64) public payoutReadyAt;
    uint256 internal agentGeneration;
    mapping(bytes32 => uint256) internal authorizationGeneration;
    mapping(bytes32 => uint64) internal retryDeadline;
    mapping(bytes32 => uint64) internal confirmedCrossingSequence;
    uint256[45] private __gap;

    /// @notice Current authorization. A binding change invalidates every old authorization.
    function authorizations(bytes32 workflow)
        external
        view
        returns (bytes32 programHash, uint64 epoch, uint64 originAfter, bool active)
    {
        Authorization storage auth = _authorizations[workflow];
        return (auth.programHash, auth.epoch, auth.originAfter, _isAuthorized(workflow, auth));
    }

    function _isAuthorized(bytes32 workflow, Authorization storage auth)
        internal
        view
        returns (bool)
    {
        return auth.active && authorizationGeneration[workflow] == agentGeneration;
    }

    constructor(
        address proxy,
        uint32 chain_,
        Networks memory cfg,
        WorkflowProgramValidatorV2 validator_
    ) AbstractCallback(proxy) WorkflowProtocolsV2(cfg, validator_) {
        callbackProxy = proxy;
        chain = chain_;
    }

    function _recordActivity(bytes32 workflow, uint64 activityTime) internal {
        Memory storage memory_ = workflowMemory[workflow];
        if (activityTime <= memory_.activity) return;
        memory_.activity = activityTime;
        if (activityTime > memory_.lastCheckIn) {
            memory_.eligibleAt = 0;
            delete payoutReadyAt[workflow];
        }
    }

    function _weekStart(uint256 timestamp) internal pure returns (uint64) {
        uint256 remainder = (timestamp + MONDAY_SHIFT) % WEEK;
        return uint64(timestamp >= remainder ? timestamp - remainder : 0);
    }
}
