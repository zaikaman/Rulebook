// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {Test} from "forge-std/Test.sol";
import {IReactive} from "@reactive/interfaces/IReactive.sol";
import {ChainConfig} from "../../src/chain/ChainConfig.sol";
import {UnsupportedChain} from "../../src/shared/Errors.sol";
import {CallbackConfiguration} from "../../src/shared/ReactiveTypes.sol";
import {WorkflowAgentV2} from "../../src/workflow/v2/WorkflowAgentV2.sol";
import {WorkflowAgentFactoryV2} from "../../src/workflow/v2/WorkflowAgentFactoryV2.sol";
import {WorkflowProgramV2 as P} from "../../src/workflow/v2/WorkflowProgramV2.sol";
import {WorkflowProgramValidatorV2} from "../../src/workflow/v2/WorkflowProgramValidatorV2.sol";
import {WorkflowProtocolsV2} from "../../src/workflow/v2/WorkflowProtocolsV2.sol";
import {WorkflowVaultV2} from "../../src/workflow/v2/WorkflowVaultV2.sol";
import {WorkflowVaultFactoryV2} from "../../src/workflow/v2/WorkflowVaultFactoryV2.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockPair} from "../mocks/MockPair.sol";
import {MockRouter} from "../mocks/MockRouter.sol";
import {MockSystemContract} from "../mocks/MockSystemContract.sol";

contract WorkflowBaseSepoliaV2Test is Test {
    address private constant OWNER = address(0xA11CE);
    address private constant RECIPIENT = address(0xBEEF);
    address private constant SUBJECT = address(0x5EED);
    address private constant PROXY_BASE = address(0xBA5E);
    address private constant PROXY_UNI = address(0xCA11);
    bytes32 private constant WF_BASE = keccak256("base-workflow");
    bytes32 private constant WF_UNI = keccak256("uni-workflow");
    uint32 private constant LASNA = 5_318_007;
    uint256 private constant CRON = uint256(keccak256("Cron100(uint256)"));
    uint256 private constant SYNC = uint256(keccak256("Sync(uint112,uint112)"));
    uint256 private constant TRANSFER = uint256(keccak256("Transfer(address,address,uint256)"));
    uint256 private constant BUDGET_SYNCED =
        uint256(keccak256("BudgetSynced(bytes32,uint96,uint96,uint128,uint128,uint64,uint32)"));

    MockERC20 private baseUsdc;
    MockERC20 private baseWeth;
    MockPair private basePair;
    MockRouter private baseRouter;

    MockERC20 private uniUsdc;
    MockERC20 private uniWeth;
    MockPair private uniPair;
    MockRouter private uniRouter;

    MockSystemContract private system;
    WorkflowAgentV2 private agent;
    WorkflowVaultV2 private baseVault;
    WorkflowVaultV2 private uniVault;
    WorkflowProgramValidatorV2 private validator;

    function setUp() public {
        vm.warp(1_700_000_000);
        baseUsdc = new MockERC20("USDC", "USDC", 6);
        baseWeth = new MockERC20("WETH", "WETH", 18);
        basePair = new MockPair(address(baseUsdc), address(baseWeth));
        baseRouter = new MockRouter();
        baseRouter.setPair(address(basePair));
        baseUsdc.mint(address(baseRouter), 100_000e6);
        baseWeth.mint(address(baseRouter), 100 ether);

        uniUsdc = new MockERC20("USDC", "USDC", 6);
        uniWeth = new MockERC20("WETH", "WETH", 18);
        uniPair = new MockPair(address(uniUsdc), address(uniWeth));
        uniRouter = new MockRouter();
        uniRouter.setPair(address(uniPair));
        uniUsdc.mint(address(uniRouter), 100_000e6);
        uniWeth.mint(address(uniRouter), 100 ether);

        system = new MockSystemContract();
        vm.chainId(ChainConfig.LASNA);
        WorkflowAgentFactoryV2 agentFactory = new WorkflowAgentFactoryV2(system);
        vm.prank(OWNER);
        agent = WorkflowAgentV2(payable(agentFactory.create()));

        validator = new WorkflowProgramValidatorV2();
        baseVault = new WorkflowVaultV2(
            PROXY_BASE,
            OWNER,
            address(agent),
            P.BASE_SEPOLIA,
            WorkflowProtocolsV2.Networks(
                address(baseUsdc),
                address(baseWeth),
                address(baseRouter),
                address(basePair),
                0,
                address(0),
                address(0),
                address(0),
                0,
                0
            ),
            validator
        );
        uniVault = new WorkflowVaultV2(
            PROXY_UNI,
            OWNER,
            address(agent),
            P.UNICHAIN_SEPOLIA,
            WorkflowProtocolsV2.Networks(
                address(uniUsdc),
                address(uniWeth),
                address(uniRouter),
                address(uniPair),
                0,
                address(0),
                address(0),
                address(0),
                0,
                0
            ),
            validator
        );

        vm.startPrank(OWNER);
        agent.linkVault(P.BASE_SEPOLIA, address(baseVault));
        agent.linkVault(P.UNICHAIN_SEPOLIA, address(uniVault));
        vm.stopPrank();
    }

    function testChainConfigReturnsVerifiedBaseSepoliaAddresses() public {
        ChainConfig.Config memory cfg = ChainConfig.get(ChainConfig.BASE_SEPOLIA);
        assertEq(cfg.chainId, 84_532);
        assertEq(cfg.callbackProxy, 0x476F44b11F5C942c58f4c8E3d0300E5710743585);
        assertEq(cfg.router, 0x1689E7B1F10000AE47eBfE339a4f69dECd19F602);
        assertEq(cfg.weth, 0x4200000000000000000000000000000000000006);
        assertEq(cfg.usdc, 0x036CbD53842c5426634e7929541eC2318f3dCF7e);
        assertEq(cfg.pair, 0x0B9Ab53880be6fF805ebF8FBce515E5715ccE1bE);
        assertTrue(ChainConfig.isSupported(ChainConfig.BASE_SEPOLIA));
        assertTrue(ChainConfig.isFundsChain(ChainConfig.BASE_SEPOLIA));
        assertTrue(ChainConfig.isFundsChain(ChainConfig.UNICHAIN_SEPOLIA));
        assertFalse(ChainConfig.isFundsChain(ChainConfig.LASNA));
        assertFalse(ChainConfig.isSupported(1));

        vm.expectRevert(abi.encodeWithSelector(UnsupportedChain.selector, uint16(1)));
        this.readChainConfig(1);
    }

    function readChainConfig(uint256 id) external pure returns (ChainConfig.Config memory) {
        return ChainConfig.get(id);
    }

    function testVaultFactoryDeploysOnBaseSepoliaAndRejectsLasnaOrUnsupported() public {
        vm.chainId(ChainConfig.BASE_SEPOLIA);
        vm.expectRevert(WorkflowVaultFactoryV2.InactiveDeployment.selector);
        new WorkflowVaultFactoryV2();

        vm.etch(ChainConfig.baseSepolia().callbackProxy, hex"00");
        WorkflowVaultFactoryV2 factory = new WorkflowVaultFactoryV2();
        assertEq(factory.chain(), P.BASE_SEPOLIA);
        assertEq(factory.callbackProxy(), ChainConfig.baseSepolia().callbackProxy);
        vm.prank(OWNER);
        address deployed = factory.create(address(agent));
        assertEq(WorkflowVaultV2(payable(deployed)).chain(), P.BASE_SEPOLIA);

        vm.chainId(ChainConfig.LASNA);
        vm.expectRevert(WorkflowVaultFactoryV2.InactiveDeployment.selector);
        new WorkflowVaultFactoryV2();

        vm.chainId(999_999);
        vm.expectRevert(WorkflowVaultFactoryV2.InactiveDeployment.selector);
        new WorkflowVaultFactoryV2();
    }

    function testBaseSepoliaVaultSettlesSchedulePaymentAndPrice() public {
        // 1. Schedule SEND on Base Sepolia
        P.Program memory sched = _program(
            P.BASE_SEPOLIA, P.BASE_SEPOLIA, P.SCHEDULE, _path(_action(P.SEND, 1e6, RECIPIENT))
        );
        baseUsdc.mint(address(baseVault), 5e6);
        _enable(baseVault, WF_BASE, 1, sched, 2e6, 0);
        _cron(1);
        assertEq(system.requestCount(), 1);
        assertEq(system.requestAt(0).chainId, P.BASE_SEPOLIA);
        assertEq(system.requestAt(0).recipient, address(baseVault));
        _deliverRequest(0, baseVault, PROXY_BASE);
        assertEq(baseUsdc.balanceOf(RECIPIENT), 1e6);

        // 2. Payment on Base Sepolia
        P.Program memory pay = _program(
            P.BASE_SEPOLIA,
            P.BASE_SEPOLIA,
            P.PAYMENT,
            _branch(P.AMOUNT_AT_LEAST, 2e6, _action(P.SEND, 0.5e6, RECIPIENT))
        );
        _enable(baseVault, WF_BASE, 2, pay, 2e6, 0);
        IReactive.LogRecord memory paymentLog;
        paymentLog.chain_id = P.BASE_SEPOLIA;
        paymentLog._contract = ChainConfig.baseSepolia().usdc;
        paymentLog.topic_0 = TRANSFER;
        paymentLog.topic_1 = uint160(RECIPIENT);
        paymentLog.topic_2 = uint160(address(baseVault));
        paymentLog.block_number = block.number + 1;
        paymentLog.tx_hash = 201;
        paymentLog.data = abi.encode(3e6);
        vm.prank(address(system));
        agent.react(paymentLog);
        assertEq(system.requestCount(), 2);
        assertEq(system.requestAt(1).chainId, P.BASE_SEPOLIA);
        _deliverRequest(1, baseVault, PROXY_BASE);
        assertEq(baseUsdc.balanceOf(RECIPIENT), 1.5e6);

        // 3. Price BUY on Base Sepolia
        P.Program memory priceProg = _program(
            P.BASE_SEPOLIA,
            P.BASE_SEPOLIA,
            P.PRICE,
            _branch(P.PRICE_AT_MOST, 2e18, _action(P.BUY, 1e6, address(0)))
        );
        _enable(baseVault, WF_BASE, 3, priceProg, 4e6, 0);
        basePair.setReserves(1_900_000 * 10_000, 10_000 ether);
        _sync(P.BASE_SEPOLIA, 100, 1_900_000);
        assertEq(system.requestCount(), 3);
        assertEq(system.requestAt(2).chainId, P.BASE_SEPOLIA);
        _deliverRequest(2, baseVault, PROXY_BASE);
        assertGt(baseWeth.balanceOf(address(baseVault)), 0);
    }

    function testBaseSepoliaBudgetSyncPausesAndResumesWorkflow() public {
        P.Program memory sched = _program(
            P.BASE_SEPOLIA, P.BASE_SEPOLIA, P.SCHEDULE, _path(_action(P.SEND, 1e6, RECIPIENT))
        );
        baseUsdc.mint(address(baseVault), 5e6);
        _enable(baseVault, WF_BASE, 1, sched, 1e6, 0);

        // Inject exhausted budget from Base Sepolia Vault
        _injectBudget(P.BASE_SEPOLIA, address(baseVault), WF_BASE, 1e6, 1e6, 1);
        _cron(1);
        assertEq(system.requestCount(), 0);
        assertTrue(agent.watchingPaused(WF_BASE));

        // Raise budget on Base Sepolia Vault -> resumes watching
        _injectBudget(P.BASE_SEPOLIA, address(baseVault), WF_BASE, 2e6, 1e6, 2);
        assertFalse(agent.watchingPaused(WF_BASE));
        _cron(2);
        assertEq(system.requestCount(), 1);
        _deliverRequest(0, baseVault, PROXY_BASE);
        assertEq(baseUsdc.balanceOf(RECIPIENT), 1e6);
    }

    function testReauthorizingPriceOriginChainResetsPositionCursor() public {
        baseUsdc.mint(address(baseVault), 5e6);

        // Epoch 1 settles a PRICE workflow from Unichain Sepolia at a high origin block number.
        P.Program memory epoch1 = _program(
            P.BASE_SEPOLIA,
            P.UNICHAIN_SEPOLIA,
            P.PRICE,
            _branch(P.PRICE_AT_MOST, 2e18, _action(P.BUY, 1e6, address(0)))
        );
        _enable(baseVault, WF_BASE, 1, epoch1, 2e6, 0);
        uniPair.setReserves(1_900_000 * 10_000, 10_000 ether);
        _sync(P.UNICHAIN_SEPOLIA, 50_000, 1_900_000);
        _deliverRequest(0, baseVault, PROXY_BASE);

        // Epoch 2 updates the same workflow ID to watch Base Sepolia at a much lower origin block.
        P.Program memory epoch2 = _program(
            P.BASE_SEPOLIA,
            P.BASE_SEPOLIA,
            P.PRICE,
            _branch(P.PRICE_AT_MOST, 2e18, _action(P.BUY, 1e6, address(0)))
        );
        _enable(baseVault, WF_BASE, 2, epoch2, 2e6, 0);
        basePair.setReserves(1_900_000 * 10_000, 10_000 ether);
        _sync(P.BASE_SEPOLIA, 200, 1_900_000);
        _deliverRequest(1, baseVault, PROXY_BASE);
        assertGt(baseWeth.balanceOf(address(baseVault)), 0);
    }

    function testCrossChainBaseOriginToUnichainSettlementAndViceVersa() public {
        // A: Base Sepolia Transfer -> Lasna Agent -> Unichain Sepolia Vault
        P.Program memory baseToUni = _program(
            P.UNICHAIN_SEPOLIA,
            P.BASE_SEPOLIA,
            P.TRANSFER,
            _branch(P.AMOUNT_ABOVE, 5e6, _action(P.SEND, 1e6, RECIPIENT))
        );
        baseToUni.source = address(baseUsdc);
        baseToUni.subject = SUBJECT;
        uniUsdc.mint(address(uniVault), 5e6);

        // Make Unichain's originAfter high (e.g. block 50_000) while Base log has lower block (e.g. 100)
        // to prove cross-chain does not compare originChain block numbers against destination originAfter.
        vm.roll(50_000);
        _enable(uniVault, WF_UNI, 1, baseToUni, 1e6, 0);

        IReactive.LogRecord memory baseTransfer;
        baseTransfer.chain_id = P.BASE_SEPOLIA;
        baseTransfer._contract = address(baseUsdc);
        baseTransfer.topic_0 = TRANSFER;
        baseTransfer.topic_1 = uint160(SUBJECT);
        baseTransfer.topic_2 = uint160(RECIPIENT);
        baseTransfer.block_number = 100;
        baseTransfer.tx_hash = 777;
        baseTransfer.data = abi.encode(10e6);
        vm.prank(address(system));
        agent.react(baseTransfer);
        assertEq(system.requestCount(), 1);
        assertEq(system.requestAt(0).chainId, P.UNICHAIN_SEPOLIA);
        assertEq(system.requestAt(0).recipient, address(uniVault));
        _deliverRequest(0, uniVault, PROXY_UNI);
        assertEq(uniUsdc.balanceOf(RECIPIENT), 1e6);

        // B: Unichain Sepolia Price Sync -> Lasna Agent -> Base Sepolia Vault
        P.Program memory uniToBase = _program(
            P.BASE_SEPOLIA,
            P.UNICHAIN_SEPOLIA,
            P.PRICE,
            _branch(P.PRICE_AT_LEAST, 2.5e18, _action(P.SEND, 0.75e6, RECIPIENT))
        );
        baseUsdc.mint(address(baseVault), 5e6);
        _enable(baseVault, WF_BASE, 1, uniToBase, 1e6, 0);
        _sync(P.UNICHAIN_SEPOLIA, 100, 2_500_000);
        assertEq(system.requestCount(), 2);
        assertEq(system.requestAt(1).chainId, P.BASE_SEPOLIA);
        assertEq(system.requestAt(1).recipient, address(baseVault));
        _deliverRequest(1, baseVault, PROXY_BASE);
        assertEq(baseUsdc.balanceOf(RECIPIENT), 0.75e6);
    }

    function testCrossChainParkedTransferPreservesOriginChainOnRetry() public {
        P.Program memory crossTransfer = _program(
            P.UNICHAIN_SEPOLIA,
            P.BASE_SEPOLIA,
            P.TRANSFER,
            _branch(P.AMOUNT_ABOVE, 1e6, _action(P.SEND, 1e6, RECIPIENT))
        );
        crossTransfer.source = address(baseUsdc);
        crossTransfer.subject = SUBJECT;
        uniUsdc.mint(address(uniVault), 5e6);
        _enable(uniVault, WF_UNI, 1, crossTransfer, 1e6, 0);
        _injectBudget(P.UNICHAIN_SEPOLIA, address(uniVault), WF_UNI, 1e6, 1e6, 1);

        IReactive.LogRecord memory baseTransfer;
        baseTransfer.chain_id = P.BASE_SEPOLIA;
        baseTransfer._contract = address(baseUsdc);
        baseTransfer.topic_0 = TRANSFER;
        baseTransfer.topic_1 = uint160(SUBJECT);
        baseTransfer.topic_2 = uint160(RECIPIENT);
        baseTransfer.block_number = 500;
        baseTransfer.tx_hash = 888;
        baseTransfer.data = abi.encode(3e6);
        vm.prank(address(system));
        agent.react(baseTransfer);
        assertEq(system.requestCount(), 0);
        assertEq(agent.pendingRuns(WF_UNI), 1);

        _injectBudget(P.UNICHAIN_SEPOLIA, address(uniVault), WF_UNI, 2e6, 1e6, 2);
        assertEq(system.requestCount(), 1);
        assertEq(agent.pendingRuns(WF_UNI), 0);
        _deliverRequest(0, uniVault, PROXY_UNI);
        assertEq(uniUsdc.balanceOf(RECIPIENT), 1e6);
    }

    function testCrossChainValidationRejectsUnsupportedCombinations() public {
        P.Program memory badPayment = _program(
            P.UNICHAIN_SEPOLIA, P.BASE_SEPOLIA, P.PAYMENT, _path(_action(P.SEND, 1e6, RECIPIENT))
        );
        vm.expectRevert(P.InvalidProgram.selector);
        validator.validateProgram(abi.encode(badPayment));

        P.Program memory badTransfer = _program(
            P.UNICHAIN_SEPOLIA, P.BASE_SEPOLIA, P.TRANSFER, _path(_action(P.ALERT, 0, address(0)))
        );
        badTransfer.source = address(baseUsdc);
        badTransfer.subject = address(0);
        vm.expectRevert(P.InvalidProgram.selector);
        validator.validateProgram(abi.encode(badTransfer));

        P.Program memory badSchedule = _program(
            P.UNICHAIN_SEPOLIA, P.BASE_SEPOLIA, P.SCHEDULE, _path(_action(P.SEND, 1e6, RECIPIENT))
        );
        vm.expectRevert(P.InvalidProgram.selector);
        validator.validateProgram(abi.encode(badSchedule));
    }

    function testMultiChainInactivityTransferOnBaseResetsUnichainVaultAndViceVersa() public {
        // 1. Inactivity workflow on Unichain Sepolia Vault
        P.Program memory uniInactivity = _program(
            P.UNICHAIN_SEPOLIA,
            P.UNICHAIN_SEPOLIA,
            P.SCHEDULE,
            _branch(P.INACTIVITY, 1 days, _action(P.INACTIVITY_PAYOUT, 1e6, RECIPIENT))
        );
        uniInactivity.once = true;
        uniUsdc.mint(address(uniVault), 5e6);

        // Also enable a Base Sepolia Vault inactivity workflow
        P.Program memory baseInactivity = _program(
            P.BASE_SEPOLIA,
            P.BASE_SEPOLIA,
            P.SCHEDULE,
            _branch(P.INACTIVITY, 1 days, _action(P.INACTIVITY_PAYOUT, 1e6, RECIPIENT))
        );
        baseInactivity.once = true;
        baseUsdc.mint(address(baseVault), 5e6);

        uint256 start = vm.getBlockTimestamp();
        _enable(uniVault, WF_UNI, 1, uniInactivity, 0, 0);
        _enable(baseVault, WF_BASE, 1, baseInactivity, 0, 0);

        // Advance 20 hours, send owner USDC transfer on Base Sepolia (even at block 10 < Unichain block 1000)
        vm.warp(start + 20 hours);
        IReactive.LogRecord memory uniEarly;
        uniEarly.chain_id = P.UNICHAIN_SEPOLIA;
        uniEarly._contract = ChainConfig.unichainSepolia().usdc;
        uniEarly.topic_0 = TRANSFER;
        uniEarly.topic_1 = uint160(OWNER);
        uniEarly.topic_2 = uint160(RECIPIENT);
        uniEarly.block_number = 1000;
        uniEarly.tx_hash = 11;
        uniEarly.data = abi.encode(1e6);
        vm.prank(address(system));
        agent.react(uniEarly);

        vm.warp(start + 22 hours);
        IReactive.LogRecord memory baseActivity;
        baseActivity.chain_id = P.BASE_SEPOLIA;
        baseActivity._contract = ChainConfig.baseSepolia().usdc;
        baseActivity.topic_0 = TRANSFER;
        baseActivity.topic_1 = uint160(OWNER);
        baseActivity.topic_2 = uint160(RECIPIENT);
        baseActivity.block_number = 10;
        baseActivity.tx_hash = 12;
        baseActivity.data = abi.encode(1e6);
        vm.prank(address(system));
        agent.react(baseActivity);

        // At start + 1 day + 1 hour: 25h since start, 5h since uniEarly, only 3h since baseActivity -> must SKIP on BOTH Vaults!
        vm.warp(start + 1 days + 1 hours);
        _cron(1);
        assertEq(system.requestCount(), 2);
        _deliverRequest(0, uniVault, PROXY_UNI);
        _deliverRequest(1, baseVault, PROXY_BASE);
        assertEq(uniUsdc.balanceOf(RECIPIENT), 0);
        assertEq(baseUsdc.balanceOf(RECIPIENT), 0);

        // At start + 22 hours + 1 days + 1: more than 1 day since baseActivity -> enters grace period
        vm.warp(start + 22 hours + 1 days + 1 hours);
        _cron(2);
        assertEq(system.requestCount(), 4);
        _deliverRequest(2, uniVault, PROXY_UNI);
        _deliverRequest(3, baseVault, PROXY_BASE);

        bytes32 uniRunId = _runId(WF_UNI, LASNA, bytes32(block.number), 0);
        bytes32 baseRunId = _runId(WF_BASE, LASNA, bytes32(block.number), 0);
        assertEq(uniVault.outcomes(uniRunId), uniVault.IN_GRACE_PERIOD());
        assertEq(baseVault.outcomes(baseRunId), baseVault.IN_GRACE_PERIOD());

        // Owner USDC transfer on Unichain Sepolia resets inactivity on Base Vault as well
        vm.warp(start + 22 hours + 1 days + 13 hours);
        uniEarly.block_number = 2000;
        uniEarly.tx_hash = 13;
        vm.prank(address(system));
        agent.react(uniEarly);

        vm.warp(start + 22 hours + 1 days + 26 hours);
        _cron(3);
        assertEq(system.requestCount(), 6);
        _deliverRequest(4, uniVault, PROXY_UNI);
        _deliverRequest(5, baseVault, PROXY_BASE);
        assertEq(uniUsdc.balanceOf(RECIPIENT), 0, "Unichain activity did not reset");
        assertEq(baseUsdc.balanceOf(RECIPIENT), 0, "Unichain activity cleared Base grace period");
    }

    function testIsolatedPerChainSyncPriceTrackingWithoutCollision() public {
        P.Program memory uniPrice = _program(
            P.UNICHAIN_SEPOLIA,
            P.UNICHAIN_SEPOLIA,
            P.PRICE,
            _branch(P.PRICE_RISES_THROUGH, 2e18, _action(P.ALERT, 0, address(0)))
        );
        P.Program memory basePrice = _program(
            P.BASE_SEPOLIA,
            P.BASE_SEPOLIA,
            P.PRICE,
            _branch(P.PRICE_RISES_THROUGH, 2e18, _action(P.ALERT, 0, address(0)))
        );
        _enable(uniVault, WF_UNI, 1, uniPrice, 0, 0);
        _enable(baseVault, WF_BASE, 1, basePrice, 0, 0);

        // Unichain syncs 1.8 -> 2.2 (crosses 2.0), Base syncs 1.5 -> 1.7 (does NOT cross 2.0).
        // Even with interleaved Base Sync at higher block number, Unichain previousPrice must stay 1.8.
        uniPair.setReserves(1_800_000 * 10_000, 10_000 ether);
        basePair.setReserves(1_500_000 * 10_000, 10_000 ether);
        _sync(P.UNICHAIN_SEPOLIA, 10, 1_800_000);
        _sync(P.BASE_SEPOLIA, 500, 1_500_000);

        uniPair.setReserves(2_200_000 * 10_000, 10_000 ether);
        basePair.setReserves(1_700_000 * 10_000, 10_000 ether);
        _sync(P.BASE_SEPOLIA, 501, 1_700_000);
        _sync(P.UNICHAIN_SEPOLIA, 11, 2_200_000);

        assertEq(system.requestCount(), 4);
        // Request 2 is Base 1.7 (SKIPPED because < 2.0), Request 3 is Unichain 2.2 (CONFIRMED because previous was 1.8!)
        _deliverRequest(2, baseVault, PROXY_BASE);
        _deliverRequest(3, uniVault, PROXY_UNI);
        assertEq(
            baseVault.outcomes(_runId(WF_BASE, P.BASE_SEPOLIA, bytes32(uint256(501)), 0)),
            baseVault.SKIPPED()
        );
        assertEq(
            uniVault.outcomes(_runId(WF_UNI, P.UNICHAIN_SEPOLIA, bytes32(uint256(11)), 0)),
            uniVault.CONFIRMED()
        );
    }

    function _enable(
        WorkflowVaultV2 targetVault,
        bytes32 workflow,
        uint64 epoch,
        P.Program memory program,
        uint96 usdcLimit,
        uint96 wethLimit
    ) private {
        bytes memory encoded = abi.encode(program);
        vm.startPrank(OWNER);
        targetVault.authorizeWithWeeklyBudget(
            workflow, epoch, encoded, "Multi-chain workflow", usdcLimit, wethLimit
        );
        agent.enable(workflow, epoch, encoded, "Multi-chain workflow", uint64(block.number));
        vm.stopPrank();
    }

    function _cron(uint256 offset) private {
        uint256 number = block.number + offset;
        vm.roll(number);
        IReactive.LogRecord memory log;
        log.chain_id = LASNA;
        log._contract = ChainConfig.lasna().cronSource;
        log.topic_0 = CRON;
        log.topic_1 = number;
        log.block_number = number;
        log.tx_hash = number;
        vm.prank(address(system));
        agent.react(log);
    }

    function _sync(uint32 chainId, uint64 blockNum, uint112 quotePerWeth) private {
        ChainConfig.Config memory cfg = ChainConfig.get(chainId);
        IReactive.LogRecord memory log;
        log.chain_id = chainId;
        log._contract = cfg.pair;
        log.topic_0 = SYNC;
        log.block_number = blockNum;
        log.tx_hash = blockNum;
        log.data = abi.encode(quotePerWeth * 10_000, 10_000 ether);
        vm.prank(address(system));
        agent.react(log);
    }

    function _injectBudget(
        uint32 chainId,
        address targetVault,
        bytes32 workflow,
        uint96 usdcLimit,
        uint128 usdcSpent,
        uint32 revision
    ) private {
        IReactive.LogRecord memory log;
        log.chain_id = chainId;
        log._contract = targetVault;
        log.topic_0 = BUDGET_SYNCED;
        log.topic_1 = uint256(workflow);
        log.data = abi.encode(
            usdcLimit, uint96(0), usdcSpent, uint128(0), uint64(block.timestamp), revision
        );
        vm.prank(address(system));
        agent.react(log);
    }

    function _deliverRequest(uint256 index, WorkflowVaultV2 targetVault, address proxy) private {
        CallbackConfiguration memory request = system.requestAt(index);
        bytes memory payload = request.payload;
        address sender = address(agent);
        assembly ("memory-safe") {
            mstore(add(payload, 36), sender)
        }
        vm.prank(proxy);
        (bool success,) = address(targetVault).call{gas: request.gasLimit}(payload);
        assertTrue(success);
    }

    function _runId(bytes32 workflow, uint32 originChain, bytes32 txHash, uint64 logIndex)
        private
        view
        returns (bytes32)
    {
        return keccak256(abi.encode(address(agent), workflow, originChain, txHash, logIndex));
    }

    function _program(uint32 chain, uint32 originChain, uint8 trigger, P.Node[] memory nodes)
        private
        pure
        returns (P.Program memory program)
    {
        program.version = 2;
        program.chain = chain;
        program.originChain = originChain;
        program.trigger = trigger;
        program.interval = trigger == P.SCHEDULE ? 1 hours : 0;
        program.usdcCap = 2e6;
        program.wethCap = 0.1 ether;
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
        nodes[0] = P.Node(0, 0, 0, 0, 0, _actions(action));
    }

    function _branch(uint8 kind, uint128 value, P.Action memory action)
        private
        pure
        returns (P.Node[] memory nodes)
    {
        nodes = new P.Node[](3);
        nodes[0] = P.Node(kind, 1, 2, value, 0, new P.Action[](0));
        nodes[1] = P.Node(0, 0, 0, 0, 0, _actions(action));
    }

    function _actions(P.Action memory action) private pure returns (P.Action[] memory list) {
        list = new P.Action[](1);
        list[0] = action;
    }
}
