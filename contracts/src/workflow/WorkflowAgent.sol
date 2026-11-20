// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {AbstractPayer} from "@reactive/abstract-base/AbstractPayer.sol";
import {IPayable} from "@reactive/interfaces/IPayable.sol";
import {IReactive} from "@reactive/interfaces/IReactive.sol";
import {ChainConfig} from "../chain/ChainConfig.sol";
import {PriceMath} from "../libraries/PriceMath.sol";
import {CallbackConfiguration, IReactiveSystem} from "../shared/ReactiveTypes.sol";
import {WorkflowProgram as WF} from "./WorkflowProgram.sol";

interface IWorkflowDirectory {
    function recordCopy(uint256 listingId, address owner, bytes32 workflowId, bytes32 shape)
        external;
}

interface IWorkflowExecutor {
    function executeWorkflow(address agent, bytes32 workflowId, WF.Run calldata run) external;
}

/// @notice Evaluates wallet-approved workflow paths on Reactive Lasna.
contract WorkflowAgent is AbstractPayer {
    uint256 private constant ANY =
        0xa65f96fc951c35ead38878e0f0b7a3c744a6f5ccc1476b313353ce31712313ad;
    uint256 private constant TRANSFER = uint256(keccak256("Transfer(address,address,uint256)"));
    uint256 private constant SYNC = uint256(keccak256("Sync(uint112,uint112)"));
    uint256 private constant CRON = uint256(keccak256("Cron100(uint256)"));
    uint256 private constant LONG_CRON = uint256(keccak256("Cron10000(uint256)"));
    uint256 private constant MAX_ACTIVE = 4;
    uint64 private constant CALLBACK_GAS = 850_000;
    uint64 private constant LIFETIME = 10 minutes;

    struct Entry {
        bytes32 programHash;
        uint64 epoch;
        uint64 originAfter;
        uint64 nextDue;
        uint8 lane;
        bool enabled;
        bool cancelled;
        uint128 target;
        bool rising;
        bool priceInitialized;
    }

    struct LiveNode {
        uint128 threshold;
        uint8 yes;
        uint8 no;
        bool hasActions;
    }

    error Unauthorized();
    error InvalidWorkflowState();

    event WorkflowEnabled(
        bytes32 indexed workflowId,
        bytes32 indexed programHash,
        uint64 epoch,
        uint256 sourceListing,
        string title
    );
    event WorkflowDisabled(bytes32 indexed workflowId, uint64 epoch, bool cancelled);
    event WorkflowDecided(
        bytes32 indexed runId,
        bytes32 indexed workflowId,
        bytes32 indexed programHash,
        uint64 epoch,
        uint8 leaf,
        uint256 originChain,
        bytes32 originTransaction,
        uint256 originLogIndex,
        uint256 observed,
        uint64 expiresAt,
        bool skipped
    );

    IReactiveSystem public immutable system;
    IWorkflowDirectory public immutable directory;
    address public owner;
    address public vault;
    mapping(bytes32 => Entry) public workflows;
    mapping(bytes32 => string) public titles;
    mapping(bytes32 => bytes) private _programs;
    mapping(bytes32 => mapping(uint8 => LiveNode)) private _liveNodes;
    bytes32[] private _workflowIds;
    bytes32[] private _active;
    mapping(uint8 => uint256) private _subscriptions;
    mapping(bytes32 => bool) private _seen;
    uint256 private _lastPrice;
    uint256 private _priceBlock;
    uint256 private _priceLog;
    mapping(uint8 => uint256) private _cronBlock;

    constructor(IReactiveSystem system_, IWorkflowDirectory directory_) {
        system = system_;
        directory = directory_;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    function initialize(address owner_) external {
        if (msg.sender != address(directory) || owner != address(0) || owner_ == address(0)) {
            revert Unauthorized();
        }
        owner = owner_;
        vendor = IPayable(payable(address(system)));
        addAuthorizedSender(address(system));
    }

    function linkVault(address vault_) external onlyOwner {
        if (vault != address(0) || vault_ == address(0)) revert InvalidWorkflowState();
        vault = vault_;
    }

    function enable(
        bytes32 id,
        uint64 epoch,
        uint64 originAfter,
        bytes calldata encoded,
        uint256 sourceListing,
        string calldata title
    ) external onlyOwner {
        if (
            id == bytes32(0) || vault == address(0) || bytes(title).length == 0
                || bytes(title).length > 80
        ) {
            revert InvalidWorkflowState();
        }
        Entry storage entry = workflows[id];
        if (entry.cancelled || epoch <= entry.epoch) revert InvalidWorkflowState();
        bool existing = entry.epoch != 0;
        if (existing && sourceListing != 0) revert InvalidWorkflowState();
        WF.Program memory program = WF.validate(encoded, vault);
        if (entry.enabled) _disable(id, entry);
        if (_active.length >= MAX_ACTIVE) revert InvalidWorkflowState();
        uint8 lane = _lane(program);
        if (lane == WF.PAYMENT && _subscriptions[lane] != 0) revert InvalidWorkflowState();
        bytes32 hash = keccak256(encoded);
        if (_programs[hash].length == 0) {
            _programs[hash] = encoded;
            for (uint8 i; i < program.nodes.length; ++i) {
                WF.Node memory node = program.nodes[i];
                _liveNodes[hash][i] =
                    LiveNode(node.threshold, node.yes, node.no, node.actions.length != 0);
            }
        }
        if (!existing) _workflowIds.push(id);
        entry.programHash = hash;
        entry.epoch = epoch;
        entry.originAfter = originAfter;
        entry.nextDue = 0;
        entry.lane = lane;
        entry.enabled = true;
        entry.target = program.target;
        entry.rising = program.rising;
        entry.priceInitialized = false;
        _active.push(id);
        if (_subscriptions[lane]++ == 0) _subscribe(lane, true);
        titles[id] = title;
        if (sourceListing != 0) directory.recordCopy(sourceListing, owner, id, WF.shape(program));
        emit WorkflowEnabled(id, hash, epoch, sourceListing, title);
    }

    function disable(bytes32 id, uint64 epoch, bool cancel) external onlyOwner {
        Entry storage entry = workflows[id];
        if (entry.epoch == 0 || epoch != entry.epoch || entry.cancelled) {
            revert InvalidWorkflowState();
        }
        if (entry.enabled) _disable(id, entry);
        entry.cancelled = cancel;
        emit WorkflowDisabled(id, epoch, cancel);
    }

    function _disable(bytes32 id, Entry storage entry) private {
        for (uint256 i; i < _active.length; ++i) {
            if (_active[i] == id) {
                _active[i] = _active[_active.length - 1];
                _active.pop();
                break;
            }
        }
        entry.enabled = false;
        if (--_subscriptions[entry.lane] == 0) {
            _subscribe(entry.lane, false);
            if (entry.lane == WF.PRICE) _lastPrice = 0;
        }
    }

    function programByHash(bytes32 hash) external view returns (bytes memory) {
        return _programs[hash];
    }

    function workflowIds() external view returns (bytes32[] memory) {
        return _workflowIds;
    }

    function publication(bytes32 id) external view returns (bytes32 hash, bytes32 shape) {
        Entry storage entry = workflows[id];
        if (!entry.enabled) revert InvalidWorkflowState();
        hash = entry.programHash;
        shape = WF.shape(WF.decode(_programs[hash]));
    }

    function react(IReactive.LogRecord calldata log) external {
        if (msg.sender != address(system)) revert Unauthorized();
        (uint8 lane, uint256 observed, uint256 previous) = _observe(log);
        if (lane == 0) return;
        for (uint256 i; i < _active.length; ++i) {
            bytes32 id = _active[i];
            Entry storage entry = workflows[id];
            if (entry.lane == lane) _evaluate(id, entry, log, observed, previous);
        }
    }

    function _evaluate(
        bytes32 id,
        Entry storage entry,
        IReactive.LogRecord calldata log,
        uint256 observed,
        uint256 previous
    ) private {
        if (log.chain_id == ChainConfig.UNICHAIN_SEPOLIA && log.block_number <= entry.originAfter) {
            return;
        }
        if (entry.lane == WF.SCHEDULE || entry.lane == 4) {
            if (block.timestamp < entry.nextDue) return;
            uint256 due = entry.nextDue == 0 ? block.timestamp : entry.nextDue;
            entry.nextDue =
                uint64(due + (1 + (block.timestamp - due) / entry.target) * entry.target);
        } else if (entry.lane == WF.PRICE) {
            if (!entry.priceInitialized) {
                entry.priceInitialized = true;
                return;
            }
            bool crossed = entry.rising
                ? previous < entry.target && observed >= entry.target
                : previous >= entry.target && observed < entry.target;
            if (previous == 0 || !crossed || block.timestamp < entry.nextDue) return;
            entry.nextDue = uint64(block.timestamp) + LIFETIME;
        }
        WF.Run memory run;
        run.epoch = entry.epoch;
        run.programHash = entry.programHash;
        LiveNode memory node = _liveNodes[entry.programHash][0];
        while (node.threshold != 0) {
            run.leaf = observed >= node.threshold ? node.yes : node.no;
            node = _liveNodes[entry.programHash][run.leaf];
        }
        run.originChainId = log.chain_id;
        run.originTransaction = bytes32(log.tx_hash);
        run.originLogIndex = log.log_index;
        run.originBlock = log.block_number;
        run.observed = observed;
        run.expiresAt = uint64(block.timestamp) + LIFETIME;
        run.id = WF.runId(address(this), id, run);
        if (_seen[run.id]) return;
        _seen[run.id] = true;
        bool skipped = !node.hasActions;
        emit WorkflowDecided(
            run.id,
            id,
            run.programHash,
            run.epoch,
            run.leaf,
            run.originChainId,
            run.originTransaction,
            run.originLogIndex,
            observed,
            run.expiresAt,
            skipped
        );
        if (skipped) return;
        system.requestCallbackV_1_0(
            CallbackConfiguration({
                chainId: ChainConfig.UNICHAIN_SEPOLIA,
                recipient: vault,
                gasLimit: CALLBACK_GAS,
                payload: abi.encodeCall(IWorkflowExecutor.executeWorkflow, (address(0), id, run))
            })
        );
    }

    function _observe(IReactive.LogRecord calldata log)
        private
        returns (uint8 lane, uint256 observed, uint256 previous)
    {
        ChainConfig.Config memory cfg = ChainConfig.unichainSepolia();
        if (log.chain_id == cfg.chainId && log.topic_0 == TRANSFER && log._contract == cfg.usdc) {
            if (
                log.topic_2 != uint160(vault) || log.topic_1 == uint160(vault)
                    || log.data.length != 32
            ) {
                return (0, 0, 0);
            }
            observed = abi.decode(log.data, (uint256));
            if (observed > 0) return (WF.PAYMENT, observed, 0);
        } else if (log.chain_id == cfg.chainId && log.topic_0 == SYNC && log._contract == cfg.pair)
        {
            if (
                log.data.length != 64 || log.block_number < _priceBlock
                    || (log.block_number == _priceBlock && log.log_index <= _priceLog)
            ) return (0, 0, 0);
            (uint112 reserve0, uint112 reserve1) = abi.decode(log.data, (uint112, uint112));
            if (reserve0 == 0 || reserve1 == 0) return (0, 0, 0);
            observed = cfg.usdc < cfg.weth
                ? PriceMath.usdcPerWeth(reserve0, reserve1)
                : PriceMath.usdcPerWeth(reserve1, reserve0);
            previous = _lastPrice;
            _lastPrice = observed;
            _priceBlock = log.block_number;
            _priceLog = log.log_index;
            return (WF.PRICE, observed, previous);
        } else if (
            log.chain_id == ChainConfig.LASNA && log._contract == ChainConfig.lasna().cronSource
                && (log.topic_0 == CRON || log.topic_0 == LONG_CRON)
        ) {
            lane = log.topic_0 == CRON ? WF.SCHEDULE : 4;
            if (log.topic_1 != log.block_number || log.block_number <= _cronBlock[lane]) {
                return (0, 0, 0);
            }
            _cronBlock[lane] = log.block_number;
            return (lane, block.timestamp, 0);
        }
        return (0, 0, 0);
    }

    function _lane(WF.Program memory program) private pure returns (uint8) {
        return program.trigger == WF.SCHEDULE && program.target >= 1 days ? 4 : program.trigger;
    }

    function _subscribe(uint8 lane, bool enabled) private {
        ChainConfig.Config memory cfg = ChainConfig.unichainSepolia();
        uint256 chain = cfg.chainId;
        address source = cfg.usdc;
        uint256 topic = TRANSFER;
        uint256 second = uint160(vault);
        if (lane == WF.PRICE) {
            source = cfg.pair;
            topic = SYNC;
            second = ANY;
        } else if (lane != WF.PAYMENT) {
            chain = ChainConfig.LASNA;
            source = ChainConfig.lasna().cronSource;
            topic = lane == WF.SCHEDULE ? CRON : LONG_CRON;
            second = ANY;
        }
        if (enabled) system.subscribe(chain, source, topic, ANY, second, ANY);
        else system.unsubscribe(chain, source, topic, ANY, second, ANY);
    }
}

