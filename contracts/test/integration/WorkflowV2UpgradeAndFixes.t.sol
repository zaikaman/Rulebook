// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {Test} from "forge-std/Test.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";
import {IReactive} from "@reactive/interfaces/IReactive.sol";
import {ChainConfig} from "../../src/chain/ChainConfig.sol";
import {CallbackConfiguration, IReactiveSystem} from "../../src/shared/ReactiveTypes.sol";
import {WorkflowAgentFactoryV2} from "../../src/workflow/v2/WorkflowAgentFactoryV2.sol";
import {WorkflowAgentReactV2} from "../../src/workflow/v2/WorkflowAgentReactV2.sol";
import {WorkflowAgentStorageV2} from "../../src/workflow/v2/WorkflowAgentStorageV2.sol";
import {WorkflowAgentV2} from "../../src/workflow/v2/WorkflowAgentV2.sol";
import {WorkflowProgramV2 as P} from "../../src/workflow/v2/WorkflowProgramV2.sol";
import {WorkflowProgramValidatorV2} from "../../src/workflow/v2/WorkflowProgramValidatorV2.sol";
import {WorkflowProtocolsV2} from "../../src/workflow/v2/WorkflowProtocolsV2.sol";
import {WorkflowVaultFactoryV2} from "../../src/workflow/v2/WorkflowVaultFactoryV2.sol";
import {WorkflowVaultV2} from "../../src/workflow/v2/WorkflowVaultV2.sol";
import {MockAggregatorV3} from "../mocks/MockAggregatorV3.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockPair} from "../mocks/MockPair.sol";
import {MockRouter} from "../mocks/MockRouter.sol";
import {MockSystemContract} from "../mocks/MockSystemContract.sol";
import {MockV3Pool} from "../mocks/MockV3Pool.sol";
import {MockV3Router} from "../mocks/MockV3Router.sol";

contract MockVaultV2Upgrade is WorkflowVaultV2 {
    constructor(
        address proxy,
        address owner_,
        address agent_,
        uint32 chain_,
        Networks memory cfg,
        WorkflowProgramValidatorV2 validator_
    ) WorkflowVaultV2(proxy, owner_, agent_, chain_, cfg, validator_) {}

    function version() external pure returns (uint256) {
        return 201;
    }
}

contract MockAgentV2Upgrade is WorkflowAgentV2 {
    constructor(
        IReactiveSystem system_,
        WorkflowProgramValidatorV2 validator_,
        address reactModule_
    ) WorkflowAgentV2(system_, validator_, reactModule_) {}

    function version() external pure returns (uint256) {
        return 201;
    }
}

contract MockBadProxiable {
    function proxiableUUID() external pure returns (bytes32) {
        return keccak256("wrong");
    }
}

contract MockProxiableNoChain {
    function proxiableUUID() external pure returns (bytes32) {
        return 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;
    }
}

contract WorkflowV2UpgradeAndFixesTest is Test {
    address private constant OWNER = address(0xA11CE);
    address private constant OTHER = address(0xB0B);
    address private constant RECIPIENT = address(0xBEEF);
    address private constant PROXY = address(0xCA11);
    uint256 private constant MONDAY = 1_794_787_200;
    uint256 private constant SYNC = uint256(keccak256("Sync(uint112,uint112)"));
    uint256 private constant BUDGET_SYNCED =
        uint256(keccak256("BudgetSynced(bytes32,uint96,uint96,uint128,uint128,uint64,uint32)"));
    uint256 private constant PEAK_SYNCED = uint256(keccak256("PeakSynced(bytes32,uint64,uint128)"));

    MockERC20 private usdc;
    MockERC20 private weth;
    MockPair private pair;
    MockRouter private router;
    MockAggregatorV3 private ethUsd;
    MockAggregatorV3 private usdcUsd;
    MockAggregatorV3 private sequencer;
    MockSystemContract private system;
    WorkflowProgramValidatorV2 private validator;
    WorkflowAgentReactV2 private reactModule;
    WorkflowAgentFactoryV2 private agentFactory;
    WorkflowVaultFactoryV2 private vaultFactory;
    WorkflowAgentV2 private agent;
    WorkflowVaultV2 private vault;

    function setUp() public {
        vm.warp(MONDAY + 1 hours);
        usdc = new MockERC20("USDC", "USDC", 6);
        weth = new MockERC20("WETH", "WETH", 18);
        pair = new MockPair(address(usdc), address(weth));
        router = new MockRouter();
        router.setPair(address(pair));
        usdc.mint(address(router), 1_000_000e6);
        weth.mint(address(router), 500 ether);
        pair.setReserves(2_000_000e6, 1_000 ether);

        ethUsd = new MockAggregatorV3(8, 2_000e8, MONDAY + 1 hours, MONDAY + 1 hours);
        usdcUsd = new MockAggregatorV3(8, 1e8, MONDAY + 1 hours, MONDAY + 1 hours);
        sequencer = new MockAggregatorV3(0, 0, MONDAY - 1 hours, MONDAY);

        system = new MockSystemContract();
        validator = new WorkflowProgramValidatorV2();

        vm.chainId(P.REACTIVE_MAINNET);
        reactModule = new WorkflowAgentReactV2(system, validator);
        WorkflowAgentV2 agentImpl = new WorkflowAgentV2(system, validator, address(reactModule));
        agentFactory = new WorkflowAgentFactoryV2(system, validator, address(agentImpl));
        vm.prank(OWNER);
        agent = WorkflowAgentV2(payable(agentFactory.create()));

        ChainConfig.Config memory base = ChainConfig.baseMainnet();
        vm.chainId(ChainConfig.BASE_MAINNET);
        vm.etch(base.callbackProxy, hex"00");
        vm.etch(PROXY, hex"00");
        WorkflowProtocolsV2.Networks memory market = WorkflowProtocolsV2.Networks(
            address(usdc),
            address(weth),
            address(router),
            address(pair),
            0,
            address(ethUsd),
            address(usdcUsd),
            address(sequencer),
            1 days,
            1 days
        );
        WorkflowVaultV2 vaultImpl =
            new WorkflowVaultV2(PROXY, address(0), address(0), P.BASE_MAINNET, market, validator);
        // Vault factory checks ChainConfig.baseMainnet().callbackProxy code, while our impl uses PROXY
        // for testing. Etch code on mainnet feeds/router/pair to deploy the real factory as well.
        vm.etch(base.ethUsdFeed, hex"00");
        vm.etch(base.usdcUsdFeed, hex"00");
        vm.etch(base.sequencerFeed, hex"00");
        vm.etch(base.router, hex"00");
        vm.etch(base.pair, hex"00");
        vaultFactory = new WorkflowVaultFactoryV2(validator, address(vaultImpl));
        vm.prank(OWNER);
        vault = WorkflowVaultV2(payable(vaultFactory.create(address(agent))));

        vm.prank(OWNER);
        agent.linkVault(P.BASE_MAINNET, address(vault));
    }

    function testOwnerCanOptInUpgradeVaultAndFactoryAdminControlsWork() public {
        bytes32 wf = keccak256("vault upgrade");
        P.Program memory prog = _program(
            P.BASE_MAINNET, P.BASE_MAINNET, P.SCHEDULE, _path(_action(P.SEND, 5e6, RECIPIENT))
        );
        bytes memory encoded = abi.encode(prog);
        usdc.mint(address(vault), 20e6);
        vm.prank(OWNER);
        vault.authorizeWithWeeklyBudget(wf, 1, encoded, "Upgrade test", 50e6, 0);

        P.Run memory run1 = _run(wf, 1, P.BASE_MAINNET, 0);
        vm.prank(PROXY);
        vault.execute(address(agent), wf, run1);
        assertEq(usdc.balanceOf(RECIPIENT), 5e6);

        WorkflowProtocolsV2.Networks memory market = WorkflowProtocolsV2.Networks(
            address(usdc),
            address(weth),
            address(router),
            address(pair),
            0,
            address(ethUsd),
            address(usdcUsd),
            address(sequencer),
            1 days,
            1 days
        );
        address nextProxy = address(0xCA12);
        vm.etch(nextProxy, hex"00");
        MockVaultV2Upgrade v21 = new MockVaultV2Upgrade(
            nextProxy, address(0), address(0), P.BASE_MAINNET, market, validator
        );

        // Non-admin cannot approve implementations or transfer admin.
        vm.prank(OWNER);
        vm.expectRevert(WorkflowVaultFactoryV2.Unauthorized.selector);
        vaultFactory.approveImplementation(address(v21), true);
        vm.prank(OWNER);
        vm.expectRevert(WorkflowVaultFactoryV2.Unauthorized.selector);
        vaultFactory.setAdmin(OWNER);
        vm.expectRevert(WorkflowVaultFactoryV2.Unauthorized.selector);
        vaultFactory.setAdmin(address(0));

        // Bad implementations are rejected.
        vm.expectRevert(WorkflowVaultFactoryV2.InvalidImplementation.selector);
        vaultFactory.approveImplementation(address(0), true);
        vm.expectRevert(WorkflowVaultFactoryV2.InvalidImplementation.selector);
        vaultFactory.approveImplementation(address(0x1234), true);
        MockBadProxiable badSlot = new MockBadProxiable();
        vm.expectRevert(WorkflowVaultFactoryV2.InvalidImplementation.selector);
        vaultFactory.approveImplementation(address(badSlot), true);
        MockProxiableNoChain noChain = new MockProxiableNoChain();
        vm.expectRevert(WorkflowVaultFactoryV2.InvalidImplementation.selector);
        vaultFactory.approveImplementation(address(noChain), true);
        vm.expectRevert(WorkflowVaultFactoryV2.InvalidImplementation.selector);
        vaultFactory.approveImplementation(address(validator), true);
        WorkflowVaultV2 wrongChainImpl = new WorkflowVaultV2(
            PROXY, address(0), address(0), P.UNICHAIN_MAINNET, market, validator
        );
        vm.expectRevert(WorkflowVaultFactoryV2.InvalidImplementation.selector);
        vaultFactory.approveImplementation(address(wrongChainImpl), true);

        // Unapproved upgrade & non-owner upgrade revert.
        vm.prank(OTHER);
        vm.expectRevert(WorkflowVaultV2.Unauthorized.selector);
        vault.upgradeToAndCall(address(v21), "");
        vm.prank(OWNER);
        vm.expectRevert(WorkflowVaultV2.InvalidAuthorization.selector);
        vault.upgradeToAndCall(address(v21), "");

        // Direct implementation call reverts (not via proxy).
        vm.prank(OWNER);
        vm.expectRevert(UUPSUpgradeable.UUPSUnauthorizedCallContext.selector);
        v21.upgradeToAndCall(address(v21), "");

        // Admin approves without switching default; owner opts in.
        address oldDefault = vaultFactory.implementation();
        vaultFactory.approveImplementation(address(v21), false);
        assertEq(vaultFactory.implementation(), oldDefault);

        vm.prank(OWNER);
        vault.upgradeToAndCall(address(v21), "");
        assertEq(MockVaultV2Upgrade(payable(address(vault))).version(), 201);
        assertEq(vault.owner(), OWNER);
        assertEq(vault.agent(), address(agent));
        assertEq(vault.factory(), address(vaultFactory));
        (,, uint128 spent,,,,,) = vault.weeklyBudget(wf);
        assertEq(spent, 5e6);

        // The old relay loses settlement and payment authority atomically.
        P.Run memory run2 = _run(wf, 2, P.BASE_MAINNET, 0);
        vm.prank(PROXY);
        vm.expectRevert(WorkflowVaultV2.Unauthorized.selector);
        vault.execute(address(agent), wf, run2);
        vm.prank(PROXY);
        vm.expectRevert(bytes("Authorized sender only"));
        vault.pay(0);
        vm.prank(nextProxy);
        vault.pay(0);
        vm.prank(nextProxy);
        vault.execute(address(agent), wf, run2);
        assertEq(usdc.balanceOf(RECIPIENT), 10e6);

        // Rotating admin and making v21 current gives new wallets V2.1.
        vaultFactory.setAdmin(OTHER);
        vm.prank(OTHER);
        vaultFactory.approveImplementation(address(v21), true);
        assertEq(vaultFactory.implementation(), address(v21));
        vm.prank(OTHER);
        address otherVault = vaultFactory.create(address(agent));
        assertEq(MockVaultV2Upgrade(payable(otherVault)).version(), 201);
    }

    function testOwnerCanOptInUpgradeAgentAndFactoryAdminControlsWork() public {
        bytes32 wf = keccak256("agent upgrade");
        P.Program memory prog = _program(
            P.BASE_MAINNET, P.BASE_MAINNET, P.SCHEDULE, _path(_action(P.SEND, 1e6, RECIPIENT))
        );
        bytes memory encoded = abi.encode(prog);
        vm.startPrank(OWNER);
        vault.authorizeWithWeeklyBudget(wf, 1, encoded, "Agent upgrade", 10e6, 0);
        agent.enable(wf, 1, encoded, "Agent upgrade", uint64(block.number));
        vm.stopPrank();

        vm.chainId(P.REACTIVE_MAINNET);
        MockAgentV2Upgrade a21 = new MockAgentV2Upgrade(system, validator, address(reactModule));

        // Direct module calls without delegatecall revert Unauthorized.
        IReactive.LogRecord memory emptyLog;
        vm.expectRevert(WorkflowAgentStorageV2.Unauthorized.selector);
        reactModule.react(emptyLog);
        vm.expectRevert(WorkflowAgentStorageV2.Unauthorized.selector);
        reactModule.resumeWatching(wf);

        // Direct impl initialization is locked.
        vm.expectRevert(WorkflowAgentStorageV2.Unauthorized.selector);
        a21.initialize(OWNER);

        // Admin validation.
        vm.prank(OWNER);
        vm.expectRevert(WorkflowAgentFactoryV2.Unauthorized.selector);
        agentFactory.approveImplementation(address(a21), true);
        vm.prank(OWNER);
        vm.expectRevert(WorkflowAgentFactoryV2.Unauthorized.selector);
        agentFactory.setAdmin(OWNER);
        vm.expectRevert(WorkflowAgentFactoryV2.Unauthorized.selector);
        agentFactory.setAdmin(address(0));
        vm.expectRevert(WorkflowAgentFactoryV2.InvalidImplementation.selector);
        agentFactory.approveImplementation(address(0), true);
        vm.expectRevert(WorkflowAgentFactoryV2.InvalidImplementation.selector);
        agentFactory.approveImplementation(address(0x1234), true);
        MockBadProxiable badSlot = new MockBadProxiable();
        vm.expectRevert(WorkflowAgentFactoryV2.InvalidImplementation.selector);
        agentFactory.approveImplementation(address(badSlot), true);
        MockProxiableNoChain noChain = new MockProxiableNoChain();
        vm.expectRevert(WorkflowAgentFactoryV2.InvalidImplementation.selector);
        agentFactory.approveImplementation(address(noChain), true);
        vm.expectRevert(WorkflowAgentFactoryV2.InvalidImplementation.selector);
        agentFactory.approveImplementation(address(validator), true);

        vm.chainId(ChainConfig.LASNA);
        WorkflowAgentReactV2 lasnaReact = new WorkflowAgentReactV2(system, validator);
        WorkflowAgentV2 lasnaImpl = new WorkflowAgentV2(system, validator, address(lasnaReact));
        vm.chainId(P.REACTIVE_MAINNET);
        vm.expectRevert(WorkflowAgentFactoryV2.InvalidImplementation.selector);
        agentFactory.approveImplementation(address(lasnaImpl), true);

        // Non-owner and unapproved upgrades revert.
        vm.prank(OTHER);
        vm.expectRevert(WorkflowAgentStorageV2.Unauthorized.selector);
        agent.upgradeToAndCall(address(a21), "");
        vm.prank(OWNER);
        vm.expectRevert(WorkflowAgentStorageV2.InvalidWorkflow.selector);
        agent.upgradeToAndCall(address(a21), "");

        address oldAgentDefault = agentFactory.implementation();
        agentFactory.approveImplementation(address(a21), false);
        assertEq(agentFactory.implementation(), oldAgentDefault);
        agentFactory.approveImplementation(address(a21), true);
        vm.prank(OWNER);
        agent.upgradeToAndCall(address(a21), "");
        assertEq(MockAgentV2Upgrade(payable(address(agent))).version(), 201);
        assertEq(agent.owner(), OWNER);
        assertEq(agent.vaults(P.BASE_MAINNET), address(vault));
        assertEq(agent.factory(), address(agentFactory));
        (bytes32 storedHash,,,,,,,,,,,,,,) = agent.entries(wf);
        assertEq(storedHash, keccak256(encoded));

        agentFactory.setAdmin(OTHER);
        assertEq(agentFactory.admin(), OTHER);
        vm.prank(OTHER);
        address otherAgent = agentFactory.create();
        assertEq(MockAgentV2Upgrade(payable(otherAgent)).version(), 201);
    }

    function testTrailingStridedLookbackRecoversSixtyPlusRoundsAndPeakSyncedStopsSpam() public {
        bytes32 wf = keccak256("trailing 60 rounds");
        P.Program memory prog = _program(
            P.BASE_MAINNET,
            P.BASE_MAINNET,
            P.PRICE,
            _branch(P.TRAILING, 1_000, _action(P.SELL, 0.1 ether, address(0)))
        );
        prog.once = true;
        bytes memory encoded = abi.encode(prog);
        vm.startPrank(OWNER);
        vault.authorizeWithWeeklyBudget(wf, 1, encoded, "Trailing 60+", 0, 1 ether);
        agent.enable(wf, 1, encoded, "Trailing 60+", uint64(block.number));
        vm.stopPrank();
        weth.mint(address(vault), 1 ether);

        // checkIn rejects non-inactivity workflows (B-1 secondary fix).
        vm.prank(OWNER);
        vm.expectRevert(WorkflowVaultV2.InvalidAuthorization.selector);
        vault.checkIn(wf);

        // Populate 70 Chainlink rounds: round 10 at $3,500, rounds 11..70 declining to $3,100.
        uint256 ts = block.timestamp;
        ethUsd.setRound(10, 3_500e8, ts, ts, 10);
        for (uint80 r = 11; r <= 70; ++r) {
            int256 px = int256(3_500e8 - ((uint256(r) - 10) * 400e8) / 60);
            ethUsd.setRound(r, px, ts, ts, r);
        }
        pair.setReserves(3_100_000e6, 1_000 ether);

        P.Run memory run = _run(wf, 100, P.BASE_MAINNET, 3_100e18);
        run.high = 3_500e18;
        run.highBlock = 50;
        vm.prank(PROXY);
        vault.execute(address(agent), wf, run);
        bytes32 runId = _runId(wf, P.BASE_MAINNET, bytes32(uint256(100)), 0);
        assertEq(vault.outcomes(runId), vault.CONFIRMED(), "60-round peak recovers via stride");
        assertEq(router.swapCount(), 1);
        vm.prank(OWNER);
        agent.disable(wf, 1);

        // Now test PeakSynced stops callback spam on a rejected high.
        bytes32 wf2 = keccak256("trailing peak sync");
        vm.startPrank(OWNER);
        vault.authorizeWithWeeklyBudget(wf2, 1, encoded, "Trailing sync", 0, 1 ether);
        agent.enable(wf2, 1, encoded, "Trailing sync", uint64(block.number));
        vm.stopPrank();

        // Reset oracle to flat $3,000 across rounds 71..95.
        for (uint80 r = 71; r <= 95; ++r) {
            ethUsd.setRound(r, 3_000e8, ts, ts, r);
        }
        pair.setReserves(3_000_000e6, 1_000 ether);
        _sync(P.BASE_MAINNET, 10, 3_500e6);
        _sync(P.BASE_MAINNET, 11, 3_500e6);
        // Drop to $2,950 (>10% below fake $3,500): Agent dispatches with high = $3,500.
        vm.warp(ts + 120);
        pair.setReserves(2_950_000e6, 1_000 ether);
        _sync(P.BASE_MAINNET, 12, 2_950e6);
        assertEq(system.requestCount(), 1);

        // Vault rejects $3,500 high (oracle stayed $3,000), keeps memory_.peak = $2,950, emits PeakSynced.
        CallbackConfiguration memory req = system.requestAt(0);
        bytes memory payload = req.payload;
        address sender = address(agent);
        assembly ("memory-safe") {
            mstore(add(payload, 36), sender)
        }
        vm.expectEmit(true, true, false, true, address(vault));
        emit WorkflowVaultV2.PeakSynced(wf2, 1, 2_950e18);
        vm.prank(PROXY);
        (bool ok,) = address(vault).call{gas: req.gasLimit}(payload);
        assertTrue(ok);

        // Forward PeakSynced to Agent -> highs[wf2] resets to 2_950e18.
        IReactive.LogRecord memory peakLog;
        peakLog.chain_id = P.BASE_MAINNET;
        peakLog._contract = address(vault);
        peakLog.topic_0 = PEAK_SYNCED;
        peakLog.topic_1 = uint256(wf2);
        peakLog.topic_2 = 1;
        peakLog.block_number = 200;
        peakLog.tx_hash = 200;
        peakLog.data = abi.encode(uint128(2_950e18));
        vm.prank(address(system));
        agent.react(peakLog);

        // Next swap at $2,900 (only 1.7% below $2,950) does NOT spam another callback.
        vm.warp(ts + 240);
        _sync(P.BASE_MAINNET, 13, 2_900e6);
        assertEq(system.requestCount(), 1, "PeakSynced prevents callback spam loop");
    }

    function testHistoricalPeakUsesObservationTimeAcrossOraclePhases() public {
        uint64 since = uint64(block.timestamp);
        uint64 observedAt = since + 2;
        uint80 firstPhase = uint80(1) << 64;
        uint80 secondPhase = uint80(2) << 64;
        ethUsd.setRound(firstPhase | 1, 3_600e8, since - 1, since - 1, firstPhase | 1);
        ethUsd.setRound(firstPhase | 2, 3_500e8, since + 1, since + 1, firstPhase | 2);
        ethUsd.setRound(firstPhase | 3, 3_100e8, since + 3, since + 3, firstPhase | 3);
        for (uint80 round = 1; round <= 75; ++round) {
            uint256 time = uint256(since) + 3 + round;
            ethUsd.setRound(secondPhase | round, 3_100e8, time, time, secondPhase | round);
        }
        MockAggregatorV3 previous = new MockAggregatorV3(8, 3_100e8, since + 3, since + 3);
        previous.setRound(3, 3_100e8, since + 3, since + 3, 3);
        vm.mockCall(
            address(ethUsd),
            abi.encodeWithSignature("phaseAggregators(uint16)", 1),
            abi.encode(address(previous))
        );
        vm.warp(since + 80);
        usdcUsd.setAnswer(0.95e8);

        assertTrue(
            validator.verifyPeakAt(
                address(ethUsd),
                address(usdcUsd),
                1e10,
                1e10,
                secondPhase | 75,
                observedAt,
                since,
                3_500e18,
                1 hours,
                1 hours
            )
        );
        assertFalse(
            validator.verifyPeakAt(
                address(ethUsd),
                address(usdcUsd),
                1e10,
                1e10,
                secondPhase | 75,
                since - 1,
                since,
                3_500e18,
                1 hours,
                1 hours
            )
        );
        assertFalse(
            validator.verifyPeakAt(
                address(ethUsd),
                address(usdcUsd),
                1e10,
                1e10,
                secondPhase | 75,
                observedAt,
                since,
                3_650e18,
                1 hours,
                1 hours
            )
        );

        previous.setDecimals(19);
        assertFalse(_peakAt(observedAt, since, secondPhase | 75));
        previous.setDecimals(8);
        previous.setDecimalsReverts(true);
        assertFalse(_peakAt(observedAt, since, secondPhase | 75));
        previous.setDecimalsReverts(false);
        previous.setReverts(true);
        assertFalse(_peakAt(observedAt, since, secondPhase | 75));
        previous.setReverts(false);
        previous.setRound(secondPhase | 3, 3_100e8, since + 3, since + 3, secondPhase | 3);
        assertFalse(_peakAt(observedAt, since, secondPhase | 75));
        vm.clearMockedCalls();
        assertFalse(_peakAt(observedAt, since, secondPhase | 75));
        vm.mockCall(
            address(ethUsd),
            abi.encodeWithSignature("phaseAggregators(uint16)", 1),
            abi.encode(address(0))
        );
        assertFalse(_peakAt(observedAt, since, secondPhase | 75));
        assertFalse(_peakAt(observedAt, since, 0));
    }

    function _peakAt(uint64 observedAt, uint64 since, uint80 latest) private view returns (bool) {
        return validator.verifyPeakAt(
            address(ethUsd), address(0), 1e10, 0, latest, observedAt, since, 3_500e18, 1 hours, 0
        );
    }

    function testPriceCrossingsConfirmOnLargeLegitimateGaps() public {
        bytes32 fallWf = keccak256("fall gap");
        P.Program memory fallProg = _program(
            P.BASE_MAINNET,
            P.BASE_MAINNET,
            P.PRICE,
            _branch(P.PRICE_FALLS_THROUGH, 2_050e18, _action(P.SEND, 5e6, RECIPIENT))
        );
        fallProg.once = true;

        bytes32 riseWf = keccak256("rise gap");
        P.Program memory riseProg = _program(
            P.BASE_MAINNET,
            P.BASE_MAINNET,
            P.PRICE,
            _branch(P.PRICE_RISES_THROUGH, 2_100e18, _action(P.SEND, 5e6, RECIPIENT))
        );
        riseProg.once = true;

        usdc.mint(address(vault), 20e6);
        vm.startPrank(OWNER);
        vault.authorize(fallWf, 1, abi.encode(fallProg), "Fall gap");
        vault.authorize(riseWf, 1, abi.encode(riseProg), "Rise gap");
        vm.stopPrank();

        // 2_200 -> 2_000 (~9.1% gap) crosses 2_050 cleanly.
        P.Run memory fallRun = _run(fallWf, 1, P.BASE_MAINNET, 2_000e18);
        fallRun.previous = 2_200e18;
        vm.prank(PROXY);
        vault.execute(address(agent), fallWf, fallRun);
        assertEq(
            vault.outcomes(_runId(fallWf, P.BASE_MAINNET, bytes32(uint256(1)), 0)),
            vault.CONFIRMED()
        );

        // 1_900 -> 2_200 (~15.8% gap) crosses 2_100 cleanly.
        ethUsd.setAnswer(2_200e8);
        pair.setReserves(2_200_000e6, 1_000 ether);
        P.Run memory riseRun = _run(riseWf, 2, P.BASE_MAINNET, 2_200e18);
        riseRun.previous = 1_900e18;
        vm.prank(PROXY);
        vault.execute(address(agent), riseWf, riseRun);
        assertEq(
            vault.outcomes(_runId(riseWf, P.BASE_MAINNET, bytes32(uint256(2)), 0)),
            vault.CONFIRMED()
        );
        assertEq(usdc.balanceOf(RECIPIENT), 10e6);
    }

    function testRefillClampsToRemainingWeeklyBudgetAndPausesAgentCleanly() public {
        bytes32 wf = keccak256("refill weekly clamp");
        P.Program memory prog = _program(
            P.BASE_MAINNET,
            P.BASE_MAINNET,
            P.SCHEDULE,
            _branch(P.USDC_BELOW, 100e6, _action(P.REFILL, 100e6, address(0)))
        );
        bytes memory encoded = abi.encode(prog);
        usdc.mint(address(vault), 70e6);
        usdc.mint(OWNER, 200e6);
        vm.startPrank(OWNER);
        usdc.approve(address(vault), 200e6);
        vault.authorizeWithWeeklyBudget(wf, 1, encoded, "Refill clamp", 50e6, 0);
        agent.enableWithBudget(
            wf,
            1,
            encoded,
            "Refill clamp",
            uint64(block.number),
            WorkflowAgentStorageV2.BudgetSeed(50e6, 0, 40e6, 0, uint64(MONDAY), 1)
        );
        vm.stopPrank();

        // Spend 40e6 first via a prior refill or simulate 40e6 already spent on Vault:
        // Lower Vault from 70 -> 30, run once for 40e6, then withdraw 40e6? Even simpler:
        // Seed Vault at 60e6 so first run pulls 40e6 (100 - 60 = 40), then withdraw 30e6 -> Vault 70e6.
        vm.prank(OWNER);
        vault.withdraw(address(usdc), 10e6); // Vault = 60e6
        P.Run memory r1 = _run(wf, 1, P.REACTIVE_MAINNET, 0);
        vm.prank(PROXY);
        vault.execute(address(agent), wf, r1);
        assertEq(usdc.balanceOf(address(vault)), 100e6);
        (,, uint128 spent1,,,,,) = vault.weeklyBudget(wf);
        assertEq(spent1, 40e6);

        // Withdraw 30e6 so needed = 30e6, remaining weekly budget = 10e6 -> clamps to 10e6!
        vm.prank(OWNER);
        vault.withdraw(address(usdc), 30e6); // Vault = 70e6
        P.Run memory r2 = _run(wf, 2, P.REACTIVE_MAINNET, 0);
        vm.expectEmit(true, false, false, true, address(vault));
        emit WorkflowVaultV2.BudgetSynced(wf, 50e6, 0, 50e6, 0, uint64(MONDAY), 1);
        vm.prank(PROXY);
        vault.execute(address(agent), wf, r2);
        assertEq(
            vault.outcomes(_runId(wf, P.REACTIVE_MAINNET, bytes32(uint256(2)), 0)),
            vault.CONFIRMED()
        );
        assertEq(usdc.balanceOf(address(vault)), 80e6);

        // Sync BudgetSynced(50e6, 50e6) to Agent -> pauses cleanly without infinite callback loop.
        IReactive.LogRecord memory syncLog;
        syncLog.chain_id = P.BASE_MAINNET;
        syncLog._contract = address(vault);
        syncLog.topic_0 = BUDGET_SYNCED;
        syncLog.topic_1 = uint256(wf);
        syncLog.data = abi.encode(
            uint96(50e6), uint96(0), uint128(50e6), uint128(0), uint64(MONDAY), uint32(1)
        );
        vm.prank(address(system));
        agent.react(syncLog);
        assertTrue(agent.watchingPaused(wf), "Agent pauses REFILL when weekly budget is exhausted");

        // Another Vault attempt while remaining == 0 skips with WeeklyBudgetExceeded.
        P.Run memory r3 = _run(wf, 3, P.REACTIVE_MAINNET, 0);
        vm.expectEmit(true, true, false, true, address(vault));
        emit WorkflowVaultV2.Outcome(
            wf,
            _runId(wf, P.REACTIVE_MAINNET, bytes32(uint256(3)), 0),
            1,
            vault.SKIPPED(),
            type(uint8).max,
            WorkflowVaultV2.WeeklyBudgetExceeded.selector
        );
        vm.prank(PROXY);
        vault.execute(address(agent), wf, r3);
    }

    function testExpiredPausedWorkflowRetiresInResumeWatchingAndSyncBudget() public {
        bytes32 wf1 = keccak256("expired resume");
        bytes32 wf2 = keccak256("expired sync");
        P.Program memory prog = _program(
            P.BASE_MAINNET, P.BASE_MAINNET, P.SCHEDULE, _path(_action(P.SEND, 10e6, RECIPIENT))
        );
        prog.expires = uint64(block.timestamp + 100);
        bytes memory encoded = abi.encode(prog);

        vm.startPrank(OWNER);
        vault.authorizeWithWeeklyBudget(wf1, 1, encoded, "Exp 1", 5e6, 0);
        agent.enableWithBudget(
            wf1,
            1,
            encoded,
            "Exp 1",
            uint64(block.number),
            WorkflowAgentStorageV2.BudgetSeed(5e6, 0, 5e6, 0, uint64(MONDAY), 1)
        );
        vault.authorizeWithWeeklyBudget(wf2, 1, encoded, "Exp 2", 5e6, 0);
        agent.enableWithBudget(
            wf2,
            1,
            encoded,
            "Exp 2",
            uint64(block.number),
            WorkflowAgentStorageV2.BudgetSeed(5e6, 0, 5e6, 0, uint64(MONDAY), 1)
        );
        vm.stopPrank();
        assertTrue(agent.watchingPaused(wf1));
        assertTrue(agent.watchingPaused(wf2));

        vm.warp(block.timestamp + 200);
        vm.expectEmit(true, false, false, true, address(agent));
        emit WorkflowAgentStorageV2.Expired(wf1, 1);
        agent.resumeWatching(wf1);
        assertFalse(agent.watchingPaused(wf1));
        (,,,, uint8 t1,,,,,,,,,,) = agent.entries(wf1);
        assertEq(t1, 0);

        IReactive.LogRecord memory syncLog;
        syncLog.chain_id = P.BASE_MAINNET;
        syncLog._contract = address(vault);
        syncLog.topic_0 = BUDGET_SYNCED;
        syncLog.topic_1 = uint256(wf2);
        syncLog.data = abi.encode(
            uint96(20e6), uint96(0), uint128(5e6), uint128(0), uint64(MONDAY), uint32(2)
        );
        vm.expectEmit(true, false, false, true, address(agent));
        emit WorkflowAgentStorageV2.Expired(wf2, 1);
        vm.prank(address(system));
        agent.react(syncLog);
        (,,,, uint8 t2,,,,,,,,,,) = agent.entries(wf2);
        assertEq(t2, 0);

        // BudgetSynced for a disabled workflow is a no-op.
        vm.prank(address(system));
        agent.react(syncLog);
        assertFalse(agent.watchingPaused(wf2));
    }

    function testCrossChainScheduleRejectsStaleObservationBeforeDipBy() public {
        bytes32 wf = keccak256("cross sched stale price");
        P.Node[] memory nodes = new P.Node[](5);
        nodes[0] = P.Node(P.PRICE_BELOW, 1, 2, 2_500e18, 0, new P.Action[](0));
        nodes[1].actions = _actions(_action(P.SEND, 5e6, RECIPIENT));
        nodes[2] = P.Node(P.DIP_BY, 3, 4, 500, 0, new P.Action[](0));
        nodes[3].actions = _actions(_action(P.SEND, 5e6, RECIPIENT));
        nodes[4].actions = _actions(_action(P.SEND, 5e6, RECIPIENT));

        P.Program memory prog = _program(P.BASE_MAINNET, P.UNICHAIN_MAINNET, P.SCHEDULE, nodes);
        usdc.mint(address(vault), 20e6);
        vm.prank(OWNER);
        vault.authorize(wf, 1, abi.encode(prog), "Cross sched stale");

        P.Run memory staleRun = _run(wf, 1, P.REACTIVE_MAINNET, 1_950e18);
        staleRun.observationTime = uint64(block.timestamp - 2 hours);
        vm.prank(PROXY);
        vault.execute(address(agent), wf, staleRun);
        assertEq(
            vault.outcomes(_runId(wf, P.REACTIVE_MAINNET, bytes32(uint256(1)), 0)), vault.SKIPPED()
        );
        assertEq(usdc.balanceOf(RECIPIENT), 0);
    }

    function testZeroBudgetSeedPreservesRevisionAgainstDelayedBudgetEvents() public {
        bytes32 workflow = keccak256("zero budget revision");
        uint64 week = uint64(MONDAY);
        bytes memory encoded = abi.encode(
            _program(
                P.BASE_MAINNET, P.BASE_MAINNET, P.SCHEDULE, _path(_action(P.SEND, 5e6, RECIPIENT))
            )
        );
        vm.prank(OWNER);
        agent.enableWithBudget(
            workflow,
            1,
            encoded,
            "Zero budget",
            uint64(block.number),
            WorkflowAgentStorageV2.BudgetSeed(0, 0, 0, 0, week, 2)
        );
        IReactive.LogRecord memory snapshot;
        snapshot.chain_id = P.BASE_MAINNET;
        snapshot._contract = address(vault);
        snapshot.topic_0 = BUDGET_SYNCED;
        snapshot.topic_1 = uint256(workflow);
        snapshot.data = abi.encode(uint96(1), uint96(0), uint128(0), uint128(0), week, uint32(1));
        vm.prank(address(system));
        agent.react(snapshot);
        assertFalse(agent.watchingPaused(workflow));
        (uint96 limit,,,,, uint32 revision, bool known) = agent.budgets(workflow);
        assertEq(limit, 0);
        assertEq(revision, 2);
        assertTrue(known);

        vm.startPrank(OWNER);
        agent.disable(workflow, 1);
        agent.enable(workflow, 2, encoded, "No budget seed", uint64(block.number));
        vm.stopPrank();
        vm.prank(address(system));
        agent.react(snapshot);
        assertFalse(agent.watchingPaused(workflow));

        vm.startPrank(OWNER);
        agent.disable(workflow, 2);
        agent.linkVault(P.BASE_MAINNET, address(0xBEEF));
        agent.enableWithBudget(
            workflow,
            3,
            encoded,
            "New vault",
            uint64(block.number),
            WorkflowAgentStorageV2.BudgetSeed(0, 0, 0, 0, week, 1)
        );
        vm.stopPrank();
        (,,,,, revision,) = agent.budgets(workflow);
        assertEq(revision, 1);
    }

    function testCanTriggerTransferRejectsPercentOverObservedOrUsdcCap() public view {
        // 1. Mixed PERCENT + FIXED exceeding observed (50% of 100 + 60 = 110 > 100).
        P.Node[] memory mixedNodes = new P.Node[](1);
        mixedNodes[0].actions = new P.Action[](2);
        mixedNodes[0].actions[0] = P.Action(P.SEND, P.PERCENT, 5_000, RECIPIENT);
        mixedNodes[0].actions[1] = P.Action(P.SEND, P.FIXED, 60e6, RECIPIENT);
        P.Program memory mixed = _program(P.BASE_MAINNET, P.BASE_MAINNET, P.PAYMENT, mixedNodes);
        mixed.usdcCap = 200e6;
        assertFalse(validator.canTriggerTransfer(abi.encode(mixed), 100e6, OWNER));
        assertTrue(validator.canTriggerTransfer(abi.encode(mixed), 130e6, OWNER));

        // 2. PERCENT share exceeding program.usdcCap (50% of 100 = 50 > 40).
        P.Program memory capped = _program(
            P.BASE_MAINNET,
            P.BASE_MAINNET,
            P.PAYMENT,
            _path(P.Action(P.SEND, P.PERCENT, 5_000, RECIPIENT))
        );
        capped.usdcCap = 40e6;
        assertFalse(validator.canTriggerTransfer(abi.encode(capped), 100e6, OWNER));
        assertTrue(validator.canTriggerTransfer(abi.encode(capped), 80e6, OWNER));
    }

    function testLinkVaultAllowsRelinkWhenIdleAndRejectsWhileActive() public {
        address altVault = address(0x9999);
        bytes32 wf = keccak256("relink guard");
        P.Program memory prog = _program(
            P.BASE_MAINNET, P.BASE_MAINNET, P.SCHEDULE, _path(_action(P.ALERT, 0, address(0)))
        );
        vm.startPrank(OWNER);
        vault.authorize(wf, 1, abi.encode(prog), "Relink guard");
        agent.enable(wf, 1, abi.encode(prog), "Relink guard", uint64(block.number));
        vm.expectRevert(WorkflowAgentStorageV2.InvalidWorkflow.selector);
        agent.linkVault(P.BASE_MAINNET, altVault);
        agent.disable(wf, 1);
        agent.linkVault(P.BASE_MAINNET, altVault);
        assertEq(agent.vaults(P.BASE_MAINNET), altVault);
        agent.linkVault(P.BASE_MAINNET, address(vault));

        // Inactivity workflow guards both chains.
        agent.linkVault(P.UNICHAIN_MAINNET, address(0x8888));
        P.Program memory inact = _program(
            P.BASE_MAINNET,
            P.BASE_MAINNET,
            P.SCHEDULE,
            _branch(P.INACTIVITY, 1 days, _action(P.INACTIVITY_PAYOUT, 1e6, RECIPIENT))
        );
        inact.once = true;
        vault.authorize(wf, 2, abi.encode(inact), "Inactivity");
        agent.enable(wf, 2, abi.encode(inact), "Inactivity", uint64(block.number));
        vm.expectRevert(WorkflowAgentStorageV2.InvalidWorkflow.selector);
        agent.linkVault(P.UNICHAIN_MAINNET, altVault);
        vm.stopPrank();
    }

    function testAgentWithdrawTokenAndPriceCooldownSkipsValidatorCall() public {
        usdc.mint(address(agent), 25e6);
        vm.prank(OTHER);
        vm.expectRevert(WorkflowAgentStorageV2.Unauthorized.selector);
        agent.withdrawToken(address(usdc), 25e6);
        vm.prank(OWNER);
        vm.expectRevert(WorkflowAgentStorageV2.InvalidWorkflow.selector);
        agent.withdrawToken(address(0), 1);
        vm.prank(OWNER);
        agent.withdrawToken(address(usdc), 25e6);
        assertEq(usdc.balanceOf(OWNER), 25e6);

        bytes32 wf = keccak256("cooldown short circuit");
        P.Program memory prog = _program(
            P.BASE_MAINNET,
            P.BASE_MAINNET,
            P.PRICE,
            _branch(P.PRICE_AT_MOST, 2_100e18, _action(P.ALERT, 0, address(0)))
        );
        bytes memory encoded = abi.encode(prog);
        vm.startPrank(OWNER);
        vault.authorize(wf, 1, encoded, "Cooldown");
        agent.enable(wf, 1, encoded, "Cooldown", uint64(block.number));
        vm.stopPrank();

        _sync(P.BASE_MAINNET, 10, 2_000e6);
        assertEq(system.requestCount(), 1);

        // During cooldown, canTriggerPrice is NOT called (0 calls).
        vm.warp(block.timestamp + 10);
        vm.expectCall(
            address(validator),
            abi.encodeWithSelector(WorkflowProgramValidatorV2.canTriggerPrice.selector),
            0
        );
        _sync(P.BASE_MAINNET, 11, 2_000e6);
        assertEq(system.requestCount(), 1);
    }

    function testValidatorUnverifiedMarketsAndQuoteGuards() public {
        // V2 unverified market mismatches pair returned by factory.
        MockRouter wrongRouter = new MockRouter();
        wrongRouter.setPair(OTHER);
        vm.expectRevert(WorkflowProgramValidatorV2.InvalidMarket.selector);
        validator.quoteSwapFloor(
            WorkflowProgramValidatorV2.SwapQuoteParams({
                sell: true,
                marketVerified: false,
                usdcIsToken0: true,
                router: address(wrongRouter),
                pair: address(pair),
                usdc: address(usdc),
                weth: address(weth),
                poolFee: 0,
                amount: 1 ether,
                slippage: 100,
                v3Spot: 0,
                externalPrice: 2_000e18,
                referencePrice: 0
            })
        );

        // V3 unverified market checks getPool and reads pool token order directly.
        MockV3Router v3Router = new MockV3Router();
        MockV3Pool v3Pool = new MockV3Pool(address(usdc), address(weth), 500);
        // sqrtPriceX96 for $2,000 when token0=USDC(6), token1=WETH(18): reserve1/reserve0 * 1e12 -> let's use PriceMath reverse: 1 WETH = 2000 USDC.
        uint160 sqrt2000 = 1_771_595_571_142_957_102_961_017_161_607_260;
        v3Pool.setPrice(sqrt2000, 1e18);
        v3Router.setPool(address(usdc), address(weth), 500, address(v3Pool));

        vm.expectRevert(WorkflowProgramValidatorV2.InvalidMarket.selector);
        validator.quoteSwapFloor(
            WorkflowProgramValidatorV2.SwapQuoteParams({
                sell: true,
                marketVerified: false,
                usdcIsToken0: false,
                router: address(v3Router),
                pair: OTHER,
                usdc: address(usdc),
                weth: address(weth),
                poolFee: 500,
                amount: 1 ether,
                slippage: 100,
                v3Spot: 0,
                externalPrice: 2_000e18,
                referencePrice: 0
            })
        );

        // Matching V3 pool reads spot directly when v3Spot == 0 & marketVerified == false.
        uint256 floor = validator.quoteSwapFloor(
            WorkflowProgramValidatorV2.SwapQuoteParams({
                sell: true,
                marketVerified: false,
                usdcIsToken0: false,
                router: address(v3Router),
                pair: address(v3Pool),
                usdc: address(usdc),
                weth: address(weth),
                poolFee: 500,
                amount: 1 ether,
                slippage: 100,
                v3Spot: 0,
                externalPrice: 2_000e18,
                referencePrice: 0
            })
        );
        assertGt(floor, 0);

        // Mismatched V3 pool token composition reverts InvalidMarket.
        MockV3Pool badTokenPool = new MockV3Pool(address(usdc), OTHER, 500);
        badTokenPool.setPrice(sqrt2000, 1e18);
        v3Router.setPool(address(usdc), address(weth), 500, address(badTokenPool));
        vm.expectRevert(WorkflowProgramValidatorV2.InvalidMarket.selector);
        validator.quoteSwapFloor(
            WorkflowProgramValidatorV2.SwapQuoteParams({
                sell: true,
                marketVerified: false,
                usdcIsToken0: true,
                router: address(v3Router),
                pair: address(badTokenPool),
                usdc: address(usdc),
                weth: address(weth),
                poolFee: 500,
                amount: 1 ether,
                slippage: 100,
                v3Spot: 0,
                externalPrice: 0,
                referencePrice: 0
            })
        );

        // Quote floor rejects large deviation between referencePrice and externalPrice.
        vm.expectRevert(
            abi.encodeWithSelector(
                WorkflowProgramValidatorV2.OraclePriceDeviation.selector, 1_000e18, 2_000e18
            )
        );
        validator.quoteSwapFloor(
            WorkflowProgramValidatorV2.SwapQuoteParams({
                sell: true,
                marketVerified: true,
                usdcIsToken0: true,
                router: address(router),
                pair: address(pair),
                usdc: address(usdc),
                weth: address(weth),
                poolFee: 0,
                amount: 1 ether,
                slippage: 100,
                v3Spot: 0,
                externalPrice: 2_000e18,
                referencePrice: 1_000e18
            })
        );
    }

    function _sync(uint32 chainId, uint64 blockNum, uint256 quotePerWeth) private {
        ChainConfig.Config memory cfg = ChainConfig.get(chainId);
        IReactive.LogRecord memory log;
        log.chain_id = chainId;
        log._contract = cfg.pair;
        log.topic_0 = SYNC;
        log.block_number = blockNum;
        log.tx_hash = blockNum;
        bool usdc0 = cfg.usdc < cfg.weth;
        uint112 usdcReserve = uint112(quotePerWeth * 10_000);
        uint112 wethReserve = uint112(10_000 ether);
        log.data =
            usdc0 ? abi.encode(usdcReserve, wethReserve) : abi.encode(wethReserve, usdcReserve);
        vm.prank(address(system));
        agent.react(log);
    }

    function _run(bytes32 workflow, uint256 txId, uint32 originChain, uint256 observed)
        private
        view
        returns (P.Run memory run)
    {
        (bytes32 programHash,,,,,,,,,,,,,,) = agent.entries(workflow);
        if (programHash == bytes32(0)) {
            (programHash,,,) = vault.authorizations(workflow);
        }
        run.epoch = 1;
        run.programHash = programHash;
        run.originChain = originChain;
        run.originTransaction = bytes32(txId);
        run.originBlock = uint64(block.number + txId);
        run.expiresAt = uint64(block.timestamp + 10 minutes);
        run.observed = observed;
        run.observationTime = uint64(block.timestamp);
    }

    function _runId(bytes32 id, uint32 originChain, bytes32 txHash, uint64 logIndex)
        private
        view
        returns (bytes32)
    {
        return keccak256(abi.encode(address(agent), id, originChain, txHash, logIndex));
    }

    function _program(uint32 chain, uint32 origin, uint8 trigger, P.Node[] memory nodes)
        private
        pure
        returns (P.Program memory program)
    {
        program.version = 2;
        program.chain = chain;
        program.originChain = origin;
        program.trigger = trigger;
        program.interval = trigger == P.SCHEDULE ? 1 hours : 0;
        program.usdcCap = 5_000e6;
        program.wethCap = 1 ether;
        program.slippage = 100;
        program.nodes = nodes;
    }

    function _action(uint8 kind, uint96 amount, address account)
        private
        pure
        returns (P.Action memory)
    {
        return P.Action(kind, P.FIXED, amount, account);
    }

    function _path(P.Action memory action) private pure returns (P.Node[] memory nodes) {
        nodes = new P.Node[](1);
        nodes[0].actions = new P.Action[](1);
        nodes[0].actions[0] = action;
    }

    function _branch(uint8 kind, uint128 value, P.Action memory action)
        private
        pure
        returns (P.Node[] memory nodes)
    {
        nodes = new P.Node[](3);
        nodes[0] = P.Node(kind, 1, 2, value, 0, new P.Action[](0));
        nodes[1].actions = new P.Action[](1);
        nodes[1].actions[0] = action;
    }

    function _actions(P.Action memory action) private pure returns (P.Action[] memory list) {
        list = new P.Action[](1);
        list[0] = action;
    }
}
