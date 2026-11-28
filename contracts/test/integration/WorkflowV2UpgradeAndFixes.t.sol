// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {Test} from "forge-std/Test.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";
import {IReactive} from "@reactive/interfaces/IReactive.sol";
import {ChainConfig} from "../../src/chain/ChainConfig.sol";
import {CallbackConfiguration, IReactiveSystem} from "../../src/shared/ReactiveTypes.sol";
import {WorkflowAgentFactoryV2} from "../../src/workflow/v2/WorkflowAgentFactoryV2.sol";
import {WorkflowAgentFeedbackV2} from "../../src/workflow/v2/WorkflowAgentFeedbackV2.sol";
import {WorkflowAgentReactV2} from "../../src/workflow/v2/WorkflowAgentReactV2.sol";
import {WorkflowAgentStorageV2} from "../../src/workflow/v2/WorkflowAgentStorageV2.sol";
import {WorkflowAgentV2} from "../../src/workflow/v2/WorkflowAgentV2.sol";
import {WorkflowProgramV2 as P} from "../../src/workflow/v2/WorkflowProgramV2.sol";
import {WorkflowProgramValidatorV2} from "../../src/workflow/v2/WorkflowProgramValidatorV2.sol";
import {WorkflowProtocolsV2} from "../../src/workflow/v2/WorkflowProtocolsV2.sol";
import {WorkflowVaultFactoryV2} from "../../src/workflow/v2/WorkflowVaultFactoryV2.sol";
import {WorkflowVaultSettlementV2} from "../../src/workflow/v2/WorkflowVaultSettlementV2.sol";
import {WorkflowVaultV2} from "../../src/workflow/v2/WorkflowVaultV2.sol";
import {WorkflowVaultStorageV2} from "../../src/workflow/v2/WorkflowVaultStorageV2.sol";
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
    uint256 private constant PEAK_CORRECTED =
        uint256(keccak256("PeakCorrected(bytes32,uint64,uint128,uint128,uint64,uint64)"));
    uint256 private constant REFERENCE_SYNCED =
        uint256(keccak256("ReferenceSynced(bytes32,uint64,uint128)"));
    uint256 private constant TRANSFER = uint256(keccak256("Transfer(address,address,uint256)"));

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

        // Non-admin cannot approve/revoke implementations or transfer admin.
        vm.prank(OWNER);
        vm.expectRevert(WorkflowVaultFactoryV2.Unauthorized.selector);
        vaultFactory.approveImplementation(address(v21), true);
        vm.prank(OWNER);
        vm.expectRevert(WorkflowVaultFactoryV2.Unauthorized.selector);
        vaultFactory.revokeImplementation(address(v21));
        vm.prank(OWNER);
        vm.expectRevert(WorkflowVaultFactoryV2.Unauthorized.selector);
        vaultFactory.setAdmin(OWNER);
        vm.expectRevert(WorkflowVaultFactoryV2.Unauthorized.selector);
        vaultFactory.setAdmin(address(0));
        vm.prank(OTHER);
        vm.expectRevert(WorkflowVaultFactoryV2.Unauthorized.selector);
        vaultFactory.acceptAdmin();

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
        vm.expectRevert(WorkflowVaultStorageV2.Unauthorized.selector);
        vault.upgradeToAndCall(address(v21), "");
        vm.prank(OWNER);
        vm.expectRevert(WorkflowVaultStorageV2.InvalidAuthorization.selector);
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
        vm.expectRevert(WorkflowVaultStorageV2.Unauthorized.selector);
        vault.execute(address(agent), wf, run2);
        vm.prank(PROXY);
        vm.expectRevert(bytes("Authorized sender only"));
        vault.pay(0);
        vm.prank(nextProxy);
        vault.pay(0);
        vm.prank(nextProxy);
        vault.execute(address(agent), wf, run2);
        assertEq(usdc.balanceOf(RECIPIENT), 10e6);

        // Rotating admin and making v21 current gives new wallets V2.1, and allows revoking old default.
        vaultFactory.setAdmin(OTHER);
        assertEq(vaultFactory.pendingAdmin(), OTHER);
        vm.prank(OWNER);
        vm.expectRevert(WorkflowVaultFactoryV2.Unauthorized.selector);
        vaultFactory.acceptAdmin();
        vm.prank(OTHER);
        vaultFactory.acceptAdmin();
        assertEq(vaultFactory.admin(), OTHER);
        assertEq(vaultFactory.pendingAdmin(), address(0));
        vm.prank(OTHER);
        vaultFactory.approveImplementation(address(v21), true);
        assertEq(vaultFactory.implementation(), address(v21));
        vm.prank(OTHER);
        vm.expectRevert(WorkflowVaultFactoryV2.InvalidImplementation.selector);
        vaultFactory.revokeImplementation(address(v21));
        vm.prank(OTHER);
        vm.expectRevert(WorkflowVaultFactoryV2.InvalidImplementation.selector);
        vaultFactory.revokeImplementation(address(0xdead));
        vm.prank(OTHER);
        vaultFactory.revokeImplementation(oldDefault);
        assertFalse(vaultFactory.approvedImplementation(oldDefault));
        vm.prank(OWNER);
        vm.expectRevert(WorkflowVaultStorageV2.InvalidAuthorization.selector);
        vault.upgradeToAndCall(oldDefault, "");
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
        WorkflowAgentFeedbackV2 feedbackModule =
            WorkflowAgentFeedbackV2(payable(reactModule.feedbackModule()));
        vm.expectRevert(WorkflowAgentStorageV2.Unauthorized.selector);
        feedbackModule.handleSettlement(emptyLog);
        vm.expectRevert(WorkflowAgentStorageV2.Unauthorized.selector);
        feedbackModule.priceRun(wf, address(pair));
        WorkflowVaultSettlementV2 settlementModule =
            WorkflowVaultSettlementV2(payable(vault.settlementModule()));
        P.Run memory emptyRun;
        vm.expectRevert(WorkflowVaultStorageV2.Unauthorized.selector);
        settlementModule.settle(wf, emptyRun, bytes32(0));

        // Direct impl initialization is locked.
        vm.expectRevert(WorkflowAgentStorageV2.Unauthorized.selector);
        a21.initialize(OWNER);

        // Admin validation.
        vm.prank(OWNER);
        vm.expectRevert(WorkflowAgentFactoryV2.Unauthorized.selector);
        agentFactory.approveImplementation(address(a21), true);
        vm.prank(OWNER);
        vm.expectRevert(WorkflowAgentFactoryV2.Unauthorized.selector);
        agentFactory.revokeImplementation(address(a21));
        vm.prank(OWNER);
        vm.expectRevert(WorkflowAgentFactoryV2.Unauthorized.selector);
        agentFactory.setAdmin(OWNER);
        vm.expectRevert(WorkflowAgentFactoryV2.Unauthorized.selector);
        agentFactory.setAdmin(address(0));
        vm.prank(OTHER);
        vm.expectRevert(WorkflowAgentFactoryV2.Unauthorized.selector);
        agentFactory.acceptAdmin();
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
        assertEq(agentFactory.pendingAdmin(), OTHER);
        vm.prank(OWNER);
        vm.expectRevert(WorkflowAgentFactoryV2.Unauthorized.selector);
        agentFactory.acceptAdmin();
        vm.prank(OTHER);
        agentFactory.acceptAdmin();
        assertEq(agentFactory.admin(), OTHER);
        assertEq(agentFactory.pendingAdmin(), address(0));
        vm.prank(OTHER);
        vm.expectRevert(WorkflowAgentFactoryV2.InvalidImplementation.selector);
        agentFactory.revokeImplementation(address(a21));
        vm.prank(OTHER);
        vm.expectRevert(WorkflowAgentFactoryV2.InvalidImplementation.selector);
        agentFactory.revokeImplementation(address(0xdead));
        vm.prank(OTHER);
        agentFactory.revokeImplementation(oldAgentDefault);
        assertFalse(agentFactory.approvedImplementation(oldAgentDefault));
        vm.prank(OWNER);
        vm.expectRevert(WorkflowAgentStorageV2.InvalidWorkflow.selector);
        agent.upgradeToAndCall(oldAgentDefault, "");
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
        vm.expectRevert(WorkflowVaultStorageV2.InvalidAuthorization.selector);
        vault.checkIn(wf);

        // Populate 70 Chainlink rounds: round 10 at $3,500, rounds 11..70 declining to $3,100.
        uint256 ts = MONDAY + 1 hours;
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
        emit WorkflowVaultStorageV2.PeakCorrected(wf2, 1, 2_950e18, 3_500e18, 10, uint64(ts));
        vm.prank(PROXY);
        (bool ok,) = address(vault).call{gas: req.gasLimit}(payload);
        assertTrue(ok);

        // Forward PeakSynced to Agent -> highs[wf2] resets to 2_950e18.
        IReactive.LogRecord memory peakLog;
        peakLog.chain_id = P.BASE_MAINNET;
        peakLog._contract = address(vault);
        peakLog.topic_0 = PEAK_CORRECTED;
        peakLog.topic_1 = uint256(wf2);
        peakLog.topic_2 = 1;
        peakLog.block_number = 200;
        peakLog.tx_hash = 200;
        peakLog.data = abi.encode(uint128(2_950e18), uint128(3_500e18), uint64(10), uint64(ts));
        vm.prank(address(system));
        agent.react(peakLog);

        // Next swap at $2,900 (only 1.7% below $2,950) does NOT spam another callback.
        vm.warp(ts + 240);
        _sync(P.BASE_MAINNET, 13, 2_900e6);
        assertEq(system.requestCount(), 1, "PeakSynced prevents callback spam loop");

        _sync(P.BASE_MAINNET, 14, 3_700e6);
        _sync(P.BASE_MAINNET, 15, 3_700e6);
        vm.prank(address(system));
        agent.react(peakLog);
        _sync(P.BASE_MAINNET, 16, 3_000e6);
        assertEq(system.requestCount(), 2, "stale correction must preserve the newer high");
    }

    function testAgentUpgradeRemovesTheFiltersThatWereActuallyInstalled() public {
        bytes32 wf = keccak256("subscription snapshots");
        P.Program memory prog = _program(
            P.BASE_MAINNET, P.BASE_MAINNET, P.SCHEDULE, _path(_action(P.SEND, 1e6, RECIPIENT))
        );
        vm.prank(OWNER);
        agent.enable(wf, 1, abi.encode(prog), "Filter snapshots", 1);

        vm.chainId(P.REACTIVE_MAINNET);
        WorkflowProgramValidatorV2 nextValidator = new WorkflowProgramValidatorV2();
        WorkflowAgentReactV2 nextModule = new WorkflowAgentReactV2(system, nextValidator);
        WorkflowAgentV2 next = new WorkflowAgentV2(system, nextValidator, address(nextModule));
        agentFactory.approveImplementation(address(next), true);
        vm.prank(OWNER);
        agent.upgradeToAndCall(address(next), "");
        vm.prank(OWNER);
        agent.refreshWorkflowFilters(wf);

        vm.mockCallRevert(
            address(nextValidator),
            abi.encodePacked(WorkflowProgramValidatorV2.settlementFilters.selector),
            hex""
        );
        vm.mockCallRevert(
            address(nextValidator),
            abi.encodePacked(WorkflowProgramValidatorV2.triggerFilters.selector),
            hex""
        );
        vm.prank(OWNER);
        agent.disable(wf, 1);
        assertFalse(
            system.isSubscribed(
                P.REACTIVE_MAINNET,
                ChainConfig.reactiveMainnet().cronSource,
                uint256(keccak256("Cron100(uint256)"))
            )
        );
    }

    function testHistoricalPeakUsesObservationTimeAcrossOraclePhases() public {
        uint64 since = uint64(MONDAY + 1 hours);
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
        emit WorkflowVaultStorageV2.BudgetSynced(wf, 50e6, 0, 50e6, 0, uint64(MONDAY), 1);
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
        emit WorkflowVaultStorageV2.Outcome(
            wf,
            _runId(wf, P.REACTIVE_MAINNET, bytes32(uint256(3)), 0),
            1,
            vault.SKIPPED(),
            type(uint8).max,
            WorkflowVaultStorageV2.WeeklyBudgetExceeded.selector
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

    function testReferencePendingDoesNotSlideForeverOnSkippedOrFailedCallbacks() public {
        uint256 t0 = block.timestamp;
        bytes32 wf = keccak256("ref pending no slide");
        P.Node[] memory nodes = new P.Node[](5);
        nodes[0] = P.Node(P.ABOVE_REFERENCE, 1, 2, 1_000, 2_000e18, new P.Action[](0));
        nodes[1].actions = _actions(_action(P.SELL, 0.1 ether, address(0)));
        nodes[2] = P.Node(P.BELOW_REFERENCE, 3, 4, 1_000, 2_000e18, new P.Action[](0));
        nodes[3].actions = _actions(_action(P.BUY, 5e6, address(0)));
        P.Program memory prog = _program(P.BASE_MAINNET, P.BASE_MAINNET, P.PRICE, nodes);
        bytes memory encoded = abi.encode(prog);

        vm.startPrank(OWNER);
        vault.authorize(wf, 1, encoded, "Ref no slide");
        agent.enable(wf, 1, encoded, "Ref no slide", uint64(block.number));
        vm.stopPrank();

        // First swap at $2,250 dispatches and opens a fixed 10-minute pending window.
        _sync(P.BASE_MAINNET, 10, 2_250e6);
        assertEq(system.requestCount(), 1);

        // Callback skipped/failed (no ReferenceSynced). After cooldown, a speculative swap dispatches
        // inside the original window, without sliding the pending deadline forward.
        vm.warp(t0 + 61);
        _sync(P.BASE_MAINNET, 11, 2_050e6);
        assertEq(system.requestCount(), 2, "speculative dispatch allowed inside original window");

        // Once the original LIFETIME window expires, non-matching swaps no longer loop every 60s.
        vm.warp(t0 + 10 minutes + 1);
        _sync(P.BASE_MAINNET, 12, 2_050e6);
        assertEq(system.requestCount(), 2, "expired pending window stops callback spam");
        vm.prank(OWNER);
        agent.disable(wf, 1);

        // Non-swap SEND reference workflow emits ReferenceSynced after seed and clears pending.
        bytes32 sendWf = keccak256("ref send sync");
        P.Node[] memory sendNodes = new P.Node[](3);
        sendNodes[0] = P.Node(P.ABOVE_REFERENCE, 1, 2, 1_000, 0, new P.Action[](0));
        sendNodes[1].actions = _actions(_action(P.SEND, 5e6, RECIPIENT));
        P.Program memory sendProg = _program(P.BASE_MAINNET, P.BASE_MAINNET, P.PRICE, sendNodes);
        bytes memory sendEncoded = abi.encode(sendProg);
        usdc.mint(address(vault), 20e6);
        vm.startPrank(OWNER);
        vault.authorize(sendWf, 1, sendEncoded, "Ref send");
        agent.enable(sendWf, 1, sendEncoded, "Ref send", uint64(block.number));
        vm.stopPrank();

        _sync(P.BASE_MAINNET, 13, 2_000e6);
        assertEq(system.requestCount(), 3);
        CallbackConfiguration memory seedReq = system.requestAt(2);
        bytes memory seedPayload = seedReq.payload;
        address sender = address(agent);
        assembly ("memory-safe") {
            mstore(add(seedPayload, 36), sender)
        }
        vm.prank(PROXY);
        (bool okSeed,) = address(vault).call{gas: seedReq.gasLimit}(seedPayload);
        assertTrue(okSeed);

        vm.warp(vm.getBlockTimestamp() + 61);
        pair.setReserves(2_300_000e6, 1_000 ether);
        ethUsd.setAnswer(2_300e8);
        _sync(P.BASE_MAINNET, 14, 2_300e6);
        assertEq(system.requestCount(), 4);

        CallbackConfiguration memory sendReq = system.requestAt(3);
        bytes memory sendPayload = sendReq.payload;
        assembly ("memory-safe") {
            mstore(add(sendPayload, 36), sender)
        }
        vm.expectEmit(true, true, false, true, address(vault));
        emit WorkflowVaultStorageV2.ReferenceSynced(sendWf, 1, 2_000e18);
        vm.prank(PROXY);
        (bool okSend,) = address(vault).call{gas: sendReq.gasLimit}(sendPayload);
        assertTrue(okSend);
        assertEq(usdc.balanceOf(RECIPIENT), 5e6);

        IReactive.LogRecord memory refLog;
        refLog.chain_id = P.BASE_MAINNET;
        refLog._contract = address(vault);
        refLog.topic_0 = REFERENCE_SYNCED;
        refLog.topic_1 = uint256(sendWf);
        refLog.topic_2 = 1;
        refLog.block_number = 300;
        refLog.tx_hash = 300;
        refLog.data = abi.encode(uint128(2_000e18));
        vm.prank(address(system));
        agent.react(refLog);

        vm.warp(vm.getBlockTimestamp() + 61);
        _sync(P.BASE_MAINNET, 15, 2_100e6);
        assertEq(system.requestCount(), 4, "ReferenceSynced cleared pending flag immediately");
    }

    function testPeakVerificationHandlesClockSkewPhaseLookupAndFallback() public {
        uint64 since = uint64(MONDAY + 1 hours);
        uint80 phase2 = uint80(2) << 64;
        // Phase 1 round 1 is NOT populated (reverts like live Unichain ETH/USD), phase 2 starts at `since`.
        ethUsd.setRound(phase2 | 1, 3_500e8, since, since, phase2 | 1);
        // Leave a gap of missing rounds (2..4) and populate rounds 5..10.
        for (uint80 r = 5; r <= 10; ++r) {
            ethUsd.setRound(phase2 | r, 3_200e8, since + (r * 10), since + (r * 10), phase2 | r);
        }
        usdcUsd.setRound(1, 1e8, since, since, 1);

        // 1. Active phase checked first even when phase 1 reverts, and binary search survives both
        //    multi-round gaps and single-round gaps (probing back from an empty mid round).
        assertTrue(
            validator.verifyPeakAt(
                address(ethUsd),
                address(usdcUsd),
                1e10,
                1e10,
                phase2 | 10,
                since + 45,
                since,
                3_500e18,
                1 hours,
                1 hours
            ),
            "active phase and gap probing succeed"
        );

        ethUsd.setRound(phase2 | 2, 3_400e8, since + 20, since + 20, phase2 | 2);
        ethUsd.setRound(phase2 | 4, 3_200e8, since + 40, since + 40, phase2 | 4);
        vm.warp(since + 100);
        // Binary search on [1..10] -> mid=6 (>since+25) -> head=5 -> mid=3 (empty) -> probe=2 (hit).
        assertTrue(
            validator.verifyPeakAt(
                address(ethUsd),
                address(usdcUsd),
                1e10,
                1e10,
                phase2 | 10,
                since + 25,
                since,
                3_400e18,
                1 hours,
                1 hours
            ),
            "single-round gap probes back to round 2"
        );

        // Stale usdcFeed round beyond usdcMaxAge + PEAK_CLOCK_SKEW (130s) returns false.
        vm.warp(since + 200);
        ethUsd.setRound(phase2 | 10, 3_200e8, since + 200, since + 200, phase2 | 10);
        assertFalse(
            validator.verifyPeakAt(
                address(ethUsd),
                address(usdcUsd),
                1e10,
                1e10,
                phase2 | 10,
                since + 200,
                since,
                3_200e18,
                1 hours,
                10
            ),
            "stale usdcFeed historical round rejected"
        );
        // Restore state for clock-skew checks below.
        ethUsd.setRound(phase2 | 10, 3_200e8, since + 100, since + 100, phase2 | 10);

        // 2. Reactive clock ahead by <= 2 minutes succeeds; > 2 minutes fails.
        vm.warp(since + 100);
        assertTrue(
            validator.verifyPeakAt(
                address(ethUsd),
                address(usdcUsd),
                1e10,
                1e10,
                phase2 | 10,
                uint64(vm.getBlockTimestamp() + 60),
                since,
                3_200e18,
                1 hours,
                1 hours
            ),
            "within PEAK_CLOCK_SKEW succeeds"
        );
        assertFalse(
            validator.verifyPeakAt(
                address(ethUsd),
                address(usdcUsd),
                1e10,
                1e10,
                phase2 | 10,
                uint64(vm.getBlockTimestamp() + 121),
                since,
                3_200e18,
                1 hours,
                1 hours
            ),
            "beyond PEAK_CLOCK_SKEW rejected"
        );

        // 3. Reverted usdcFeed latestRoundData returns false gracefully.
        usdcUsd.setReverts(true);
        assertFalse(
            validator.verifyPeakAt(
                address(ethUsd),
                address(usdcUsd),
                1e10,
                1e10,
                phase2 | 10,
                since + 50,
                since,
                3_200e18,
                1 hours,
                1 hours
            )
        );
        usdcUsd.setReverts(false);

        // 4. Vault _isPeakOracleConsistent falls back to verifyHistoricalPeak if verifyPeakAt returns false.
        bytes32 wf = keccak256("trailing fallback");
        P.Program memory prog = _program(
            P.BASE_MAINNET,
            P.BASE_MAINNET,
            P.PRICE,
            _branch(P.TRAILING, 1_000, _action(P.SELL, 0.1 ether, address(0)))
        );
        prog.once = true;
        vm.prank(OWNER);
        vault.authorize(wf, 1, abi.encode(prog), "Fallback");
        weth.mint(address(vault), 1 ether);
        pair.setReserves(3_100_000e6, 1_000 ether);
        ethUsd.setRound(phase2 | 10, 3_500e8, since + 105, since + 105, phase2 | 10);
        ethUsd.setRound(phase2 | 11, 3_100e8, since + 110, since + 110, phase2 | 11);
        vm.warp(since + 120);

        P.Run memory run = _run(wf, 55, P.BASE_MAINNET, 3_100e18);
        run.high = 3_500e18;
        run.highBlock = 50;
        // peakTime < since makes verifyPeakAt return false, but verifyHistoricalPeak sees phase2 | 10 at $3,500.
        run.observationId = P.priceEvidence(0, since - 10, false);
        vm.prank(PROXY);
        vault.execute(address(agent), wf, run);
        assertEq(
            vault.outcomes(_runId(wf, P.BASE_MAINNET, bytes32(uint256(55)), 0)),
            vault.CONFIRMED(),
            "historical fallback recovers peak"
        );
    }

    function testStalePreEnableAndPreResumePricesCannotFalseTriggerCrossing() public {
        // 1. Prior workflow records $1,800 in shared prices[BASE_MAINNET][pair].
        bytes32 priorWf = keccak256("prior price wf");
        P.Program memory priorProg = _program(
            P.BASE_MAINNET,
            P.BASE_MAINNET,
            P.PRICE,
            _branch(P.PRICE_AT_LEAST, 10_000e18, _action(P.ALERT, 0, address(0)))
        );
        vm.startPrank(OWNER);
        vault.authorize(priorWf, 1, abi.encode(priorProg), "Prior");
        agent.enable(priorWf, 1, abi.encode(priorProg), "Prior", uint64(block.number));
        vm.stopPrank();
        _sync(P.BASE_MAINNET, 10, 1_800e6);
        vm.prank(OWNER);
        agent.disable(priorWf, 1);

        // 2. New crossing workflow enabled later must NOT use stale $1,800 on first swap at $2,500.
        vm.warp(block.timestamp + 10 minutes);
        vm.roll(block.number + 20);
        bytes32 crossWf = keccak256("fresh crossing");
        P.Program memory crossProg = _program(
            P.BASE_MAINNET,
            P.BASE_MAINNET,
            P.PRICE,
            _branch(P.PRICE_RISES_THROUGH, 2_200e18, _action(P.SEND, 5e6, RECIPIENT))
        );
        bytes memory crossEncoded = abi.encode(crossProg);
        usdc.mint(address(vault), 20e6);
        vm.startPrank(OWNER);
        vault.authorizeWithWeeklyBudget(crossWf, 1, crossEncoded, "Fresh cross", 10e6, 0);
        agent.enableWithBudget(
            crossWf,
            1,
            crossEncoded,
            "Fresh cross",
            uint64(block.number),
            WorkflowAgentStorageV2.BudgetSeed(10e6, 0, 0, 0, uint64(MONDAY), 1)
        );
        vm.stopPrank();

        _sync(P.BASE_MAINNET, uint64(block.number + 1), 2_500e6);
        assertEq(system.requestCount(), 0, "stale pre-enable price must not trigger crossing");

        // Fresh post-enable crossing $2,100 -> $2,300 triggers cleanly.
        _sync(P.BASE_MAINNET, uint64(block.number + 2), 2_100e6);
        _sync(P.BASE_MAINNET, uint64(block.number + 3), 2_300e6);
        assertEq(system.requestCount(), 1, "fresh post-enable crossing triggers");

        // 3. Pausing and resuming resets crossing baseline so frozen pre-pause price does not trigger.
        IReactive.LogRecord memory pauseLog;
        pauseLog.chain_id = P.BASE_MAINNET;
        pauseLog._contract = address(vault);
        pauseLog.topic_0 = BUDGET_SYNCED;
        pauseLog.topic_1 = uint256(crossWf);
        pauseLog.data = abi.encode(
            uint96(10e6), uint96(0), uint128(10e6), uint128(0), uint64(MONDAY), uint32(1)
        );
        vm.prank(address(system));
        agent.react(pauseLog);
        assertTrue(agent.watchingPaused(crossWf));

        // Seed another workflow at $2,100 while crossWf is paused, then resume crossWf.
        bytes32 spyWf = keccak256("spy wf");
        vm.startPrank(OWNER);
        vault.authorize(spyWf, 1, abi.encode(priorProg), "Spy");
        agent.enable(spyWf, 1, abi.encode(priorProg), "Spy", uint64(block.number));
        vm.stopPrank();
        _sync(P.BASE_MAINNET, uint64(block.number + 4), 2_100e6);

        vm.warp(block.timestamp + 1 minutes);
        IReactive.LogRecord memory resumeLog;
        resumeLog.chain_id = P.BASE_MAINNET;
        resumeLog._contract = address(vault);
        resumeLog.topic_0 = BUDGET_SYNCED;
        resumeLog.topic_1 = uint256(crossWf);
        resumeLog.data = abi.encode(
            uint96(20e6), uint96(0), uint128(10e6), uint128(0), uint64(MONDAY), uint32(2)
        );
        vm.prank(address(system));
        agent.react(resumeLog);
        assertFalse(agent.watchingPaused(crossWf));

        _sync(P.BASE_MAINNET, uint64(block.number + 5), 2_300e6);
        assertEq(system.requestCount(), 1, "frozen pre-resume price must not trigger crossing");

        _sync(P.BASE_MAINNET, uint64(block.number + 6), 2_150e6);
        _sync(P.BASE_MAINNET, uint64(block.number + 7), 2_250e6);
        assertEq(system.requestCount(), 2, "fresh post-resume crossing triggers");
    }

    function testNonTrailingPriceWorkflowSkipsPeakTrackingAndVerification() public {
        bytes32 wf = keccak256("non trailing price");
        P.Program memory prog = _program(
            P.BASE_MAINNET,
            P.BASE_MAINNET,
            P.PRICE,
            _branch(P.PRICE_BELOW, 2_100e18, _action(P.ALERT, 0, address(0)))
        );
        bytes memory encoded = abi.encode(prog);
        vm.startPrank(OWNER);
        vault.authorize(wf, 1, encoded, "Non trailing");
        agent.enable(wf, 1, encoded, "Non trailing", uint64(block.number));
        vm.stopPrank();

        _sync(P.BASE_MAINNET, 10, 3_000e6);
        _sync(P.BASE_MAINNET, 11, 2_900e6);
        _sync(P.BASE_MAINNET, 12, 1_950e6);
        assertEq(system.requestCount(), 1);

        CallbackConfiguration memory req = system.requestAt(0);
        bytes memory payload = req.payload;
        address sender = address(agent);
        assembly ("memory-safe") {
            mstore(add(payload, 36), sender)
        }
        vm.expectCall(
            address(validator),
            abi.encodeWithSelector(WorkflowProgramValidatorV2.verifyPeakAt.selector),
            0
        );
        vm.prank(PROXY);
        (bool ok,) = address(vault).call{gas: req.gasLimit}(payload);
        assertTrue(ok);
        (uint128 peak,,,,,,,) = vault.workflowMemory(wf);
        assertEq(peak, 0, "non-trailing workflow never records peak");
    }

    function testExpiredPaymentWorkflowReleasesSlotForReplacement() public {
        bytes32 wf1 = keccak256("pay 1");
        bytes32 wf2 = keccak256("pay 2");
        bytes32 wf3 = keccak256("pay 3");

        P.Program memory p1 = _program(
            P.BASE_MAINNET, P.BASE_MAINNET, P.PAYMENT, _path(_action(P.ALERT, 0, address(0)))
        );
        p1.expires = uint64(block.timestamp + 100);
        vm.prank(OWNER);
        vault.authorize(wf1, 1, abi.encode(p1), "Pay 1");
        assertEq(vault.paymentWorkflow(), wf1);

        // Cannot replace while active and unexpired.
        P.Program memory p2 = _program(
            P.BASE_MAINNET, P.BASE_MAINNET, P.PAYMENT, _path(_action(P.ALERT, 0, address(0)))
        );
        p2.expires = uint64(block.timestamp + 300);
        vm.prank(OWNER);
        vm.expectRevert(WorkflowVaultStorageV2.InvalidAuthorization.selector);
        vault.authorize(wf2, 1, abi.encode(p2), "Pay 2");

        // Once expired, a new PAYMENT workflow can authorize directly without manual revoke.
        vm.warp(vm.getBlockTimestamp() + 150);
        vm.prank(OWNER);
        vault.authorize(wf2, 1, abi.encode(p2), "Pay 2");
        assertEq(vault.paymentWorkflow(), wf2);
        (,,, bool wf1Active) = vault.authorizations(wf1);
        assertFalse(wf1Active);

        // Settling an expired PAYMENT workflow clears paymentWorkflow immediately.
        vm.warp(vm.getBlockTimestamp() + 200);
        P.Run memory expRun = _run(wf2, 1, P.BASE_MAINNET, 10e6);
        vm.prank(PROXY);
        vault.execute(address(agent), wf2, expRun);
        assertEq(
            vault.outcomes(_runId(wf2, P.BASE_MAINNET, bytes32(uint256(1)), 0)), vault.EXPIRED()
        );
        assertEq(vault.paymentWorkflow(), bytes32(0));

        P.Program memory p3 = _program(
            P.BASE_MAINNET, P.BASE_MAINNET, P.PAYMENT, _path(_action(P.ALERT, 0, address(0)))
        );
        vm.prank(OWNER);
        vault.authorize(wf3, 1, abi.encode(p3), "Pay 3");
        assertEq(vault.paymentWorkflow(), wf3);
    }

    function testDynamicReferenceSeedUsesLivePriceObservationPreservesAmountAndStrictFields()
        public
    {
        // 1. Same-chain dynamic reference seeds from live ctx.price rather than run.observed.
        bytes32 wf = keccak256("dyn ref live price");
        P.Node[] memory nodes = new P.Node[](3);
        nodes[0] = P.Node(P.ABOVE_REFERENCE, 1, 2, 1_000, 0, new P.Action[](0));
        nodes[1].actions = _actions(_action(P.ALERT, 0, address(0)));
        P.Program memory prog = _program(P.BASE_MAINNET, P.BASE_MAINNET, P.PRICE, nodes);
        vm.prank(OWNER);
        vault.authorize(wf, 1, abi.encode(prog), "Dyn live");

        pair.setReserves(2_020_000e6, 1_000 ether);
        P.Run memory run = _run(wf, 1, P.BASE_MAINNET, 2_000e18);
        vm.prank(PROXY);
        vault.execute(address(agent), wf, run);
        (, uint128 refPrice,,,,,,) = vault.workflowMemory(wf);
        assertEq(refPrice, 2_020e18, "dynamic reference seeds to live spot price");

        // 2. TRANSFER with PRICE check logs transfer amount in Observation event.
        bytes32 xferWf = keccak256("xfer obs amount");
        P.Program memory xferProg = _program(
            P.BASE_MAINNET,
            P.BASE_MAINNET,
            P.TRANSFER,
            _branch(P.PRICE_AT_LEAST, 1_900e18, _action(P.ALERT, 0, address(0)))
        );
        xferProg.source = address(usdc);
        xferProg.subject = RECIPIENT;
        vm.prank(OWNER);
        vault.authorize(xferWf, 1, abi.encode(xferProg), "Xfer obs");

        P.Run memory xferRun = _run(xferWf, 2, P.BASE_MAINNET, 500e6);
        xferRun.actor = RECIPIENT;
        bytes32 xferRunId = _runId(xferWf, P.BASE_MAINNET, bytes32(uint256(2)), 0);
        vm.expectEmit(true, false, false, true, address(vault));
        emit WorkflowVaultStorageV2.Observation(xferRunId, 500e6, RECIPIENT);
        vm.prank(PROXY);
        vault.execute(address(agent), xferWf, xferRun);

        // 3. Unused source and subject fields are rejected by validateProgram.
        P.Program memory badSource = _program(
            P.BASE_MAINNET, P.BASE_MAINNET, P.SCHEDULE, _path(_action(P.ALERT, 0, address(0)))
        );
        badSource.source = address(usdc);
        vm.expectRevert(P.InvalidProgram.selector);
        validator.validateProgram(abi.encode(badSource));

        P.Program memory badSubject = _program(
            P.BASE_MAINNET, P.BASE_MAINNET, P.PRICE, _path(_action(P.ALERT, 0, address(0)))
        );
        badSubject.subject = RECIPIENT;
        vm.expectRevert(P.InvalidProgram.selector);
        validator.validateProgram(abi.encode(badSubject));

        P.Program memory badPaySubject = _program(
            P.BASE_MAINNET, P.BASE_MAINNET, P.PAYMENT, _path(_action(P.ALERT, 0, address(0)))
        );
        badPaySubject.subject = RECIPIENT;
        vm.expectRevert(P.InvalidProgram.selector);
        validator.validateProgram(abi.encode(badPaySubject));
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
