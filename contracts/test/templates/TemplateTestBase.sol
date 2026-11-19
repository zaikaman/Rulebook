// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {Test, Vm} from "forge-std/Test.sol";
import {IReactive} from "@reactive/interfaces/IReactive.sol";

import {Agent} from "../../src/agent/Agent.sol";
import {ChainConfig} from "../../src/chain/ChainConfig.sol";
import {RuleLib} from "../../src/libraries/RuleLib.sol";
import {IRuleRegistry} from "../../src/registry/IRuleRegistry.sol";
import {IReactiveSystem} from "../../src/shared/ReactiveTypes.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockPair} from "../mocks/MockPair.sol";
import {MockSystemContract} from "../mocks/MockSystemContract.sol";

/// @notice Shared harness for the thirteen template suites: one Agent, one pair, one system
/// double, and helpers that build the exact `LogRecord`s the system contract would deliver.
abstract contract TemplateTestBase is Test {
    address internal constant USER = address(0xA11CE);
    address internal constant STRANGER = address(0xB0B);
    address internal constant VAULT = address(0x7A17);
    uint256 internal constant CHAIN = 1301;

    bytes32 internal constant SYNC_TOPIC = keccak256("Sync(uint112,uint112)");
    bytes32 internal constant HOURLY_CRON_TOPIC = keccak256("Cron100(uint256)");
    bytes32 internal constant DAILY_CRON_TOPIC = keccak256("Cron10000(uint256)");
    bytes32 internal constant TRANSFER_TOPIC = keccak256("Transfer(address,address,uint256)");
    bytes32 internal constant BALANCES_TOPIC =
        keccak256("Balances(address,uint256,address,uint256)");
    bytes32 internal constant ALERT_TOPIC = keccak256("AlertRaised(uint256,uint8,uint256)");

    MockSystemContract internal system;
    MockERC20 internal usdc;
    MockERC20 internal weth;
    MockPair internal pair;
    Agent internal agent;

    uint256 private _cursor;

    function setUp() public virtual {
        system = new MockSystemContract();
        usdc = new MockERC20("USD Coin", "USDC", 6);
        weth = new MockERC20("Wrapped Ether", "WETH", 18);
        pair = new MockPair(address(usdc), address(weth));
        agent = new Agent(
            USER, IReactiveSystem(address(system)), IRuleRegistry(address(0)), address(this)
        );
        _linkVault();
    }

    /// @notice Links the funds-side vault so transfer/balance templates can filter on it.
    function _linkVault() internal {
        vm.prank(USER);
        agent.linkVault(CHAIN, VAULT);
    }

    function _add(RuleLib.Rule memory rule) internal returns (uint256 ruleId) {
        vm.prank(USER);
        ruleId = agent.addRule(rule, false);
    }

    function _react(IReactive.LogRecord memory log) internal {
        vm.prank(address(system));
        agent.react(log);
    }

    /// @notice Reacts and returns how many alert events the wake-up produced.
    function _reactAndCountAlerts(IReactive.LogRecord memory log)
        internal
        returns (uint256 alerts)
    {
        vm.recordLogs();
        _react(log);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i = 0; i < logs.length; ++i) {
            if (logs[i].topics[0] == ALERT_TOPIC) alerts += 1;
        }
    }

    /// @notice Sets the pair reserves so one base token costs `priceE18` quote tokens.
    function _syncPrice(uint256 priceE18) internal returns (IReactive.LogRecord memory log) {
        uint112 quote = uint112(priceE18 / 1e12);
        pair.setReserves(quote, uint112(1e18));
        log = _log(address(pair), SYNC_TOPIC, abi.encode(quote, uint112(1e18)));
    }

    function _tick() internal returns (IReactive.LogRecord memory log) {
        return _tick(DAILY_CRON_TOPIC);
    }

    function _tick(bytes32 topic) internal returns (IReactive.LogRecord memory log) {
        log = _log(ChainConfig.lasna().cronSource, topic, "");
        log.chain_id = ChainConfig.LASNA;
        log.topic_1 = log.block_number;
    }

    function _transferLog(address token, address from, address to, uint256 amount)
        internal
        returns (IReactive.LogRecord memory log)
    {
        log = _log(token, TRANSFER_TOPIC, abi.encode(amount));
        log.topic_1 = uint256(uint160(from));
        log.topic_2 = uint256(uint160(to));
    }

    function _balancesLog(address vault, address token, uint256 balance)
        internal
        returns (IReactive.LogRecord memory log)
    {
        log = _log(vault, BALANCES_TOPIC, abi.encode(token, balance, address(0), uint256(0)));
    }

    function _runs(uint256 ruleId) internal view returns (uint256) {
        return agent.getRule(ruleId).runs;
    }

    function _requestCount() internal view returns (uint256) {
        return system.requestCount();
    }

    function _log(address source, bytes32 topic0, bytes memory data)
        internal
        returns (IReactive.LogRecord memory log)
    {
        _cursor += 1;
        log.chain_id = CHAIN;
        log._contract = source;
        log.topic_0 = uint256(topic0);
        log.data = data;
        log.block_number = _cursor;
        log.tx_hash = uint256(keccak256(abi.encode(source, topic0, _cursor)));
        log.log_index = _cursor;
    }
}
