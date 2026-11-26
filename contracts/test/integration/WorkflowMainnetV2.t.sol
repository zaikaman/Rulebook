// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {Test, Vm} from "forge-std/Test.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IReactive} from "@reactive/interfaces/IReactive.sol";
import {ChainConfig} from "../../src/chain/ChainConfig.sol";
import {PriceMath} from "../../src/libraries/PriceMath.sol";
import {IAggregatorV3} from "../../src/shared/Chainlink.sol";
import {UnsupportedChain} from "../../src/shared/Errors.sol";
import {CallbackConfiguration} from "../../src/shared/ReactiveTypes.sol";
import {
    IUniswapV2Factory,
    IUniswapV2Pair,
    IUniswapV2Router02
} from "../../src/shared/UniswapV2.sol";
import {IUniswapV3Factory, IUniswapV3Pool, IV3SwapRouter} from "../../src/shared/UniswapV3.sol";
import {WorkflowAgentV2} from "../../src/workflow/v2/WorkflowAgentV2.sol";
import {WorkflowAgentFactoryV2} from "../../src/workflow/v2/WorkflowAgentFactoryV2.sol";
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

contract WorkflowMainnetV2Test is Test {
    address private constant OWNER = address(0xA11CE);
    address private constant RECIPIENT = address(0xBEEF);
    address private constant PROXY = address(0xCA11);
    uint256 private constant MONDAY = 1_794_787_200;
    uint256 private constant CRON = uint256(keccak256("Cron100(uint256)"));
    uint256 private constant TRANSFER = uint256(keccak256("Transfer(address,address,uint256)"));
    uint256 private constant SYNC = uint256(keccak256("Sync(uint112,uint112)"));
    uint256 private constant SWAP_V3 =
        uint256(keccak256("Swap(address,address,int256,int256,uint160,uint128,int24)"));
    uint256 private constant BUDGET_SYNCED =
        uint256(keccak256("BudgetSynced(bytes32,uint96,uint96,uint128,uint128,uint64,uint32)"));
    uint32 private constant BASE_ETH_MAX_AGE = 3_600;
    uint32 private constant UNI_ETH_MAX_AGE = 90_000;
    uint32 private constant USDC_MAX_AGE = 90_000;
    uint24 private constant UNI_POOL_FEE = 3_000;
    uint128 private constant V3_LIQUIDITY = 71_711_040_367_497_809;

    MockERC20 private unichainUsdc;
    MockERC20 private unichainWeth;
    MockV3Pool private unichainPair;
    MockV3Router private unichainRouter;
    MockAggregatorV3 private uniEthUsd;
    MockAggregatorV3 private uniUsdcUsd;
    MockAggregatorV3 private uniSequencer;

    MockERC20 private baseUsdc;
    MockERC20 private baseWeth;
    MockPair private basePair;
    MockRouter private baseRouter;
    MockAggregatorV3 private baseEthUsd;
    MockAggregatorV3 private baseUsdcUsd;
    MockAggregatorV3 private baseSequencer;

    MockSystemContract private system;
    WorkflowAgentFactoryV2 private agentFactory;
    WorkflowAgentV2 private agent;
    WorkflowVaultV2 private unichainVault;
    WorkflowVaultV2 private baseVault;
    WorkflowProgramValidatorV2 private validator;

    function setUp() public {
        vm.warp(MONDAY + 1 hours);
        unichainUsdc = new MockERC20("USDC", "USDC", 6);
        unichainWeth = new MockERC20("WETH", "WETH", 18);
        unichainPair = new MockV3Pool(address(unichainUsdc), address(unichainWeth), UNI_POOL_FEE);
        unichainRouter = new MockV3Router();
        unichainRouter.setPool(
            address(unichainUsdc), address(unichainWeth), UNI_POOL_FEE, address(unichainPair)
        );
        unichainUsdc.mint(address(unichainRouter), 1_000_000e6);
        unichainWeth.mint(address(unichainRouter), 500 ether);
        unichainPair.setPrice(_sqrtPriceFor(2_000e18), V3_LIQUIDITY);
        uniEthUsd = new MockAggregatorV3(18, 2_000e18, MONDAY + 1 hours, MONDAY + 1 hours);
        uniUsdcUsd = new MockAggregatorV3(18, 1e18, MONDAY + 1 hours, MONDAY + 1 hours);
        uniSequencer = new MockAggregatorV3(0, 0, MONDAY - 1 hours, MONDAY);

        baseUsdc = new MockERC20("USDC", "USDC", 6);
        baseWeth = new MockERC20("WETH", "WETH", 18);
        basePair = new MockPair(address(baseUsdc), address(baseWeth));
        baseRouter = new MockRouter();
        baseRouter.setPair(address(basePair));
        baseUsdc.mint(address(baseRouter), 1_000_000e6);
        baseWeth.mint(address(baseRouter), 500 ether);
        basePair.setReserves(2_000_000e6, 1_000 ether);
        baseEthUsd = new MockAggregatorV3(8, 2_000e8, MONDAY + 1 hours, MONDAY + 1 hours);
        baseUsdcUsd = new MockAggregatorV3(8, 1e8, MONDAY + 1 hours, MONDAY + 1 hours);
        baseSequencer = new MockAggregatorV3(0, 0, MONDAY - 1 hours, MONDAY);

        system = new MockSystemContract();
        vm.chainId(ChainConfig.REACTIVE_MAINNET);
        agentFactory = new WorkflowAgentFactoryV2(system);
        vm.prank(OWNER);
        agent = WorkflowAgentV2(payable(agentFactory.create()));
        validator = new WorkflowProgramValidatorV2();

        unichainVault = new WorkflowVaultV2(
            PROXY,
            OWNER,
            address(agent),
            P.UNICHAIN_MAINNET,
            WorkflowProtocolsV2.Networks(
                address(unichainUsdc),
                address(unichainWeth),
                address(unichainRouter),
                address(unichainPair),
                UNI_POOL_FEE,
                address(uniEthUsd),
                address(uniUsdcUsd),
                address(uniSequencer),
                UNI_ETH_MAX_AGE,
                USDC_MAX_AGE
            ),
            validator
        );
        baseVault = new WorkflowVaultV2(
            PROXY,
            OWNER,
            address(agent),
            P.BASE_MAINNET,
            WorkflowProtocolsV2.Networks(
                address(baseUsdc),
                address(baseWeth),
                address(baseRouter),
                address(basePair),
                0,
                address(baseEthUsd),
                address(baseUsdcUsd),
                address(baseSequencer),
                BASE_ETH_MAX_AGE,
                USDC_MAX_AGE
            ),
            validator
        );

        vm.startPrank(OWNER);
        agent.linkVault(P.UNICHAIN_MAINNET, address(unichainVault));
        agent.linkVault(P.BASE_MAINNET, address(baseVault));
        vm.stopPrank();
    }

    function testChainConfigCoversAllSixNetworksAndEnvironmentIsolation() public {
        assertEq(agent.automationChain(), ChainConfig.REACTIVE_MAINNET);
        assertTrue(ChainConfig.isSupported(ChainConfig.REACTIVE_MAINNET));
        assertTrue(ChainConfig.isSupported(ChainConfig.UNICHAIN_MAINNET));
        assertTrue(ChainConfig.isSupported(ChainConfig.BASE_MAINNET));
        assertFalse(ChainConfig.isSupported(999));

        assertTrue(ChainConfig.isAutomationChain(ChainConfig.LASNA));
        assertTrue(ChainConfig.isAutomationChain(ChainConfig.REACTIVE_MAINNET));
        assertFalse(ChainConfig.isAutomationChain(ChainConfig.UNICHAIN_MAINNET));

        assertTrue(ChainConfig.isFundsChain(ChainConfig.UNICHAIN_MAINNET));
        assertTrue(ChainConfig.isFundsChain(ChainConfig.BASE_MAINNET));
        assertFalse(ChainConfig.isFundsChain(ChainConfig.REACTIVE_MAINNET));

        assertTrue(
            ChainConfig.isFundsChainFor(ChainConfig.REACTIVE_MAINNET, ChainConfig.UNICHAIN_MAINNET)
        );
        assertTrue(
            ChainConfig.isFundsChainFor(ChainConfig.REACTIVE_MAINNET, ChainConfig.BASE_MAINNET)
        );
        assertFalse(
            ChainConfig.isFundsChainFor(ChainConfig.REACTIVE_MAINNET, ChainConfig.UNICHAIN_SEPOLIA)
        );
        assertFalse(ChainConfig.isFundsChainFor(ChainConfig.LASNA, ChainConfig.UNICHAIN_MAINNET));
        assertFalse(ChainConfig.isFundsChainFor(ChainConfig.BASE_MAINNET, ChainConfig.BASE_MAINNET));

        ChainConfig.Config memory rm = ChainConfig.get(ChainConfig.REACTIVE_MAINNET);
        assertEq(rm.systemContract, 0x8888888888888888888888888888888888888888);
        assertEq(rm.cronSource, 0x0000000000000000000000000000000000fffFfF);

        ChainConfig.Config memory uni = ChainConfig.get(ChainConfig.UNICHAIN_MAINNET);
        assertEq(uni.callbackProxy, 0x754120EC7a6eF81E4c5c835AA603C63Da64693E6);
        assertEq(uni.router, 0x73855d06DE49d0fe4A9c42636Ba96c62da12FF9C);
        assertEq(uni.pair, 0x8927058918e3CFf6F55EfE45A58db1be1F069E49);
        assertEq(uni.poolFee, UNI_POOL_FEE);
        assertEq(uni.usdc, 0x078D782b760474a361dDA0AF3839290b0EF57AD6);
        assertEq(uni.ethUsdFeed, 0x41CFbbA7Be6E03fC43A19689b31852Af205da864);
        assertEq(uni.usdcUsdFeed, 0xbd1cD1518eFB92a92100da62D4C488c810dFd75b);
        assertEq(uni.sequencerFeed, 0x495639D9914e7D270c5dCC641BfB1d807423F813);
        assertEq(uni.ethFeedMaxAge, UNI_ETH_MAX_AGE);
        assertEq(uni.usdcFeedMaxAge, USDC_MAX_AGE);

        ChainConfig.Config memory base = ChainConfig.get(ChainConfig.BASE_MAINNET);
        assertEq(base.callbackProxy, 0xCc780DdE33f56f55dE778D42c930959374a4a068);
        assertEq(base.poolFee, 0);
        assertEq(base.usdc, 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913);
        assertEq(base.ethUsdFeed, 0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70);
        assertEq(base.usdcUsdFeed, 0x7e860098F58bBFC8648a4311b374B1D669a2bc6B);
        assertEq(base.sequencerFeed, 0xBCF85224fc0756B9Fa45aA7892530B47e10b6433);
        assertEq(base.ethFeedMaxAge, BASE_ETH_MAX_AGE);
        assertEq(base.usdcFeedMaxAge, USDC_MAX_AGE);

        vm.expectRevert(abi.encodeWithSelector(UnsupportedChain.selector, uint16(999)));
        this.getUnsupportedChain(999);
    }

    function getUnsupportedChain(uint256 id) external pure returns (ChainConfig.Config memory) {
        return ChainConfig.get(id);
    }

    function testVaultFactoryDeploysOnMainnetsAndRejectsAutomationOrUnsupported() public {
        vm.chainId(ChainConfig.REACTIVE_MAINNET);
        vm.expectRevert(WorkflowVaultFactoryV2.InactiveDeployment.selector);
        new WorkflowVaultFactoryV2();

        ChainConfig.Config memory uni = ChainConfig.unichainMainnet();
        vm.chainId(ChainConfig.UNICHAIN_MAINNET);
        vm.etch(uni.callbackProxy, hex"00");
        vm.expectRevert(WorkflowVaultFactoryV2.InactiveDeployment.selector);
        new WorkflowVaultFactoryV2();
        vm.etch(uni.ethUsdFeed, hex"00");
        vm.etch(uni.usdcUsdFeed, hex"00");
        vm.etch(uni.sequencerFeed, hex"00");
        vm.mockCall(
            uni.ethUsdFeed, abi.encodeCall(IAggregatorV3.decimals, ()), abi.encode(uint8(18))
        );
        vm.mockCall(
            uni.usdcUsdFeed, abi.encodeCall(IAggregatorV3.decimals, ()), abi.encode(uint8(18))
        );
        // Missing router/pair code on mainnet also rejects deployment.
        vm.expectRevert(WorkflowVaultFactoryV2.InactiveDeployment.selector);
        new WorkflowVaultFactoryV2();
        vm.etch(uni.router, hex"00");
        vm.expectRevert(WorkflowVaultFactoryV2.InactiveDeployment.selector);
        new WorkflowVaultFactoryV2();
        vm.etch(uni.pair, hex"00");
        vm.mockCall(uni.router, abi.encodeCall(IV3SwapRouter.factory, ()), abi.encode(uni.router));
        vm.mockCall(
            uni.router,
            abi.encodeCall(IUniswapV3Factory.getPool, (uni.usdc, uni.weth, uni.poolFee)),
            abi.encode(uni.pair)
        );
        vm.mockCall(uni.pair, abi.encodeCall(IUniswapV3Pool.token0, ()), abi.encode(uni.usdc));
        vm.mockCall(uni.pair, abi.encodeCall(IUniswapV3Pool.token1, ()), abi.encode(uni.weth));
        WorkflowVaultFactoryV2 uniFactory = new WorkflowVaultFactoryV2();
        assertEq(uniFactory.chain(), ChainConfig.UNICHAIN_MAINNET);
        assertEq(uniFactory.callbackProxy(), uni.callbackProxy);

        vm.prank(OWNER);
        WorkflowVaultV2 uniDeployed = WorkflowVaultV2(payable(uniFactory.create(address(agent))));
        assertTrue(uniFactory.implementation() != address(0));
        assertEq(uniDeployed.owner(), OWNER);
        assertEq(uniDeployed.agent(), address(agent));
        assertEq(uniDeployed.poolFee(), UNI_POOL_FEE);
        assertEq(uniDeployed.router(), uni.router);
        assertEq(uniDeployed.pair(), uni.pair);

        // Clone cannot be re-initialized, implementation cannot be initialized by non-factory,
        // and cloned vault recognizes callbackProxy as an authorized sender.
        vm.prank(OWNER);
        vm.expectRevert(WorkflowVaultV2.InvalidAuthorization.selector);
        uniDeployed.initialize(OWNER, address(agent));
        vm.prank(OWNER);
        vm.expectRevert(WorkflowVaultV2.InvalidAuthorization.selector);
        WorkflowVaultV2(payable(uniFactory.implementation())).initialize(OWNER, address(agent));
        P.Run memory probeRun;
        probeRun.originChain = P.UNICHAIN_MAINNET;
        probeRun.originTransaction = bytes32(uint256(1));
        vm.prank(OWNER);
        vm.expectRevert(WorkflowVaultV2.Unauthorized.selector);
        uniDeployed.execute(address(agent), keccak256("probe"), probeRun);
        vm.prank(uni.callbackProxy);
        uniDeployed.execute(address(agent), keccak256("probe"), probeRun);
        assertEq(
            uniDeployed.outcomes(
                keccak256(
                    abi.encode(
                        address(agent),
                        keccak256("probe"),
                        probeRun.originChain,
                        probeRun.originTransaction,
                        probeRun.originLogIndex
                    )
                )
            ),
            uniDeployed.SKIPPED()
        );

        ChainConfig.Config memory base = ChainConfig.baseMainnet();
        vm.chainId(ChainConfig.BASE_MAINNET);
        vm.etch(base.callbackProxy, hex"00");
        vm.etch(base.router, hex"00");
        vm.etch(base.pair, hex"00");
        vm.etch(base.ethUsdFeed, hex"00");
        vm.etch(base.sequencerFeed, hex"00");
        vm.expectRevert(WorkflowVaultFactoryV2.InactiveDeployment.selector);
        new WorkflowVaultFactoryV2();
        vm.etch(base.usdcUsdFeed, hex"00");
        vm.mockCall(
            base.ethUsdFeed, abi.encodeCall(IAggregatorV3.decimals, ()), abi.encode(uint8(8))
        );
        vm.mockCall(
            base.usdcUsdFeed, abi.encodeCall(IAggregatorV3.decimals, ()), abi.encode(uint8(8))
        );
        vm.mockCall(
            base.router, abi.encodeCall(IUniswapV2Router02.factory, ()), abi.encode(base.router)
        );
        vm.mockCall(
            base.router,
            abi.encodeCall(IUniswapV2Factory.getPair, (base.usdc, base.weth)),
            abi.encode(base.pair)
        );
        vm.mockCall(base.pair, abi.encodeCall(IUniswapV2Pair.token0, ()), abi.encode(base.usdc));
        vm.mockCall(base.pair, abi.encodeCall(IUniswapV2Pair.token1, ()), abi.encode(base.weth));
        WorkflowVaultFactoryV2 baseFactory = new WorkflowVaultFactoryV2();
        assertEq(baseFactory.chain(), ChainConfig.BASE_MAINNET);
        assertEq(baseFactory.callbackProxy(), base.callbackProxy);

        vm.prank(OWNER);
        address deployed = baseFactory.create(address(agent));
        WorkflowVaultV2 deployedVault = WorkflowVaultV2(payable(deployed));
        assertEq(deployedVault.chain(), P.BASE_MAINNET);
        assertEq(deployedVault.poolFee(), 0);
        assertEq(deployedVault.ethUsdFeed(), base.ethUsdFeed);
        assertEq(deployedVault.usdcUsdFeed(), base.usdcUsdFeed);
        assertEq(deployedVault.sequencerFeed(), base.sequencerFeed);
    }

    function testConstructorRejectsMissingMainnetOracleOrInconsistentFeedConfig() public {
        WorkflowProtocolsV2.Networks memory missingFeed = WorkflowProtocolsV2.Networks(
            address(baseUsdc),
            address(baseWeth),
            address(baseRouter),
            address(basePair),
            0,
            address(0),
            address(0),
            address(baseSequencer),
            BASE_ETH_MAX_AGE,
            USDC_MAX_AGE
        );
        vm.expectRevert(WorkflowProtocolsV2.InvalidMarket.selector);
        new WorkflowVaultV2(PROXY, OWNER, address(agent), P.BASE_MAINNET, missingFeed, validator);

        WorkflowProtocolsV2.Networks memory missingMainnetSeq = WorkflowProtocolsV2.Networks(
            address(unichainUsdc),
            address(unichainWeth),
            address(unichainRouter),
            address(unichainPair),
            UNI_POOL_FEE,
            address(uniEthUsd),
            address(uniUsdcUsd),
            address(0),
            UNI_ETH_MAX_AGE,
            USDC_MAX_AGE
        );
        vm.expectRevert(WorkflowProtocolsV2.InvalidMarket.selector);
        new WorkflowVaultV2(
            PROXY, OWNER, address(agent), P.UNICHAIN_MAINNET, missingMainnetSeq, validator
        );

        WorkflowProtocolsV2.Networks memory missingMainnetRouter = WorkflowProtocolsV2.Networks(
            address(unichainUsdc),
            address(unichainWeth),
            address(0),
            address(unichainPair),
            UNI_POOL_FEE,
            address(uniEthUsd),
            address(uniUsdcUsd),
            address(uniSequencer),
            UNI_ETH_MAX_AGE,
            USDC_MAX_AGE
        );
        vm.expectRevert(WorkflowProtocolsV2.InvalidMarket.selector);
        new WorkflowVaultV2(
            PROXY, OWNER, address(agent), P.UNICHAIN_MAINNET, missingMainnetRouter, validator
        );

        WorkflowProtocolsV2.Networks memory missingMainnetPair = WorkflowProtocolsV2.Networks(
            address(unichainUsdc),
            address(unichainWeth),
            address(unichainRouter),
            address(0),
            UNI_POOL_FEE,
            address(uniEthUsd),
            address(uniUsdcUsd),
            address(uniSequencer),
            UNI_ETH_MAX_AGE,
            USDC_MAX_AGE
        );
        vm.expectRevert(WorkflowProtocolsV2.InvalidMarket.selector);
        new WorkflowVaultV2(
            PROXY, OWNER, address(agent), P.UNICHAIN_MAINNET, missingMainnetPair, validator
        );

        WorkflowProtocolsV2.Networks memory invalidPoolFee = WorkflowProtocolsV2.Networks(
            address(unichainUsdc),
            address(unichainWeth),
            address(unichainRouter),
            address(unichainPair),
            1_000_000,
            address(uniEthUsd),
            address(uniUsdcUsd),
            address(uniSequencer),
            UNI_ETH_MAX_AGE,
            USDC_MAX_AGE
        );
        vm.expectRevert(WorkflowProtocolsV2.InvalidMarket.selector);
        new WorkflowVaultV2(
            PROXY, OWNER, address(agent), P.UNICHAIN_MAINNET, invalidPoolFee, validator
        );

        WorkflowProtocolsV2.Networks memory zeroEthMaxAge = WorkflowProtocolsV2.Networks(
            address(unichainUsdc),
            address(unichainWeth),
            address(unichainRouter),
            address(unichainPair),
            UNI_POOL_FEE,
            address(uniEthUsd),
            address(0),
            address(uniSequencer),
            0,
            0
        );
        vm.expectRevert(WorkflowProtocolsV2.InvalidMarket.selector);
        new WorkflowVaultV2(
            PROXY, OWNER, address(agent), P.UNICHAIN_MAINNET, zeroEthMaxAge, validator
        );

        WorkflowProtocolsV2.Networks memory zeroUsdcMaxAge = WorkflowProtocolsV2.Networks(
            address(unichainUsdc),
            address(unichainWeth),
            address(unichainRouter),
            address(unichainPair),
            UNI_POOL_FEE,
            address(uniEthUsd),
            address(uniUsdcUsd),
            address(uniSequencer),
            UNI_ETH_MAX_AGE,
            0
        );
        vm.expectRevert(WorkflowProtocolsV2.InvalidMarket.selector);
        new WorkflowVaultV2(
            PROXY, OWNER, address(agent), P.UNICHAIN_MAINNET, zeroUsdcMaxAge, validator
        );
    }

    function testAgentRejectsTestnetVaultLinksAndMixedEnvironmentPrograms() public {
        vm.prank(OWNER);
        vm.expectRevert(WorkflowAgentV2.InvalidWorkflow.selector);
        agent.linkVault(P.UNICHAIN_SEPOLIA, address(unichainVault));

        vm.prank(OWNER);
        vm.expectRevert(WorkflowAgentV2.InvalidWorkflow.selector);
        agent.linkVault(P.BASE_SEPOLIA, address(baseVault));

        P.Program memory mixed;
        mixed.version = 2;
        mixed.chain = P.UNICHAIN_MAINNET;
        mixed.originChain = P.UNICHAIN_SEPOLIA;
        mixed.trigger = P.PRICE;
        mixed.usdcCap = 1e6;
        mixed.slippage = 100;
        mixed.nodes = _branch(P.PRICE_AT_LEAST, 2e18, _action(P.ALERT, 0, address(0)));
        bytes memory encoded = abi.encode(mixed);

        vm.prank(OWNER);
        vm.expectRevert(P.InvalidProgram.selector);
        validator.validateProgram(encoded);
    }

    function testMainnetCrossChainPriceAndInactivityWorkAndPauseImmediatelyOnBudget() public {
        bytes32 priceWf = keccak256("mainnet cross price");
        P.Program memory priceProg = _program(
            P.UNICHAIN_MAINNET, P.BASE_MAINNET, P.PRICE, _path(_action(P.BUY, 1e6, address(0)))
        );
        _enable(priceWf, unichainVault, priceProg, 1e6, 0);
        unichainUsdc.mint(address(unichainVault), 3e6);
        unichainPair.setPrice(_sqrtPriceFor(2e18), V3_LIQUIDITY);
        uniEthUsd.setAnswer(2e18);

        IReactive.LogRecord memory syncLog;
        syncLog.chain_id = P.BASE_MAINNET;
        syncLog._contract = ChainConfig.baseMainnet().pair;
        syncLog.topic_0 = SYNC;
        syncLog.block_number = 100;
        syncLog.tx_hash = 100;
        syncLog.data = abi.encode(10_000 ether, 2_000_000 * 10_000);
        vm.prank(address(system));
        agent.react(syncLog);
        assertEq(system.requestCount(), 1);

        vm.recordLogs();
        _deliverRequest(0, address(unichainVault));
        _forwardBudget(P.UNICHAIN_MAINNET, address(unichainVault), priceWf);
        assertTrue(agent.watchingPaused(priceWf), "mainnet price pauses on exhaustion");
        assertGt(agent.wakeBlock(priceWf), 0);

        bytes32 inactWf = keccak256("mainnet inactivity");
        P.Program memory inactProg = _program(
            P.UNICHAIN_MAINNET,
            P.UNICHAIN_MAINNET,
            P.SCHEDULE,
            _branch(P.INACTIVITY, 1 days, _action(P.INACTIVITY_PAYOUT, 0.5e6, RECIPIENT))
        );
        inactProg.once = true;
        _enable(inactWf, unichainVault, inactProg, 1e6, 0);

        vm.warp(MONDAY + 2 days);
        IReactive.LogRecord memory baseTransfer;
        baseTransfer.chain_id = P.BASE_MAINNET;
        baseTransfer._contract = ChainConfig.baseMainnet().usdc;
        baseTransfer.topic_0 = TRANSFER;
        baseTransfer.topic_1 = uint160(OWNER);
        baseTransfer.topic_2 = uint160(RECIPIENT);
        baseTransfer.block_number = 200;
        baseTransfer.tx_hash = 200;
        baseTransfer.data = abi.encode(1e6);
        vm.prank(address(system));
        agent.react(baseTransfer);

        IReactive.LogRecord memory cronLog;
        cronLog.chain_id = ChainConfig.REACTIVE_MAINNET;
        cronLog._contract = ChainConfig.reactiveMainnet().cronSource;
        cronLog.topic_0 = CRON;
        cronLog.topic_1 = block.number + 1;
        cronLog.block_number = block.number + 1;
        cronLog.tx_hash = 300;
        vm.prank(address(system));
        agent.react(cronLog);
        assertEq(system.requestCount(), 2);

        CallbackConfiguration memory req = system.requestAt(1);
        (,, P.Run memory decoded) = abi.decode(_slice(req.payload, 4), (address, bytes32, P.Run));
        assertEq(decoded.activityTime, MONDAY + 2 days, "base USDC activity protects unichain");
    }

    function testSandwichAttackBlockedOnScheduleBuyAndSellForBaseAndUnichain() public {
        // 1. Base Mainnet (8-decimal Chainlink feeds): SCHEDULE BUY sandwich blocked.
        bytes32 baseBuyWf = keccak256("base schedule buy");
        _enable(
            baseBuyWf,
            baseVault,
            _program(
                P.BASE_MAINNET,
                P.BASE_MAINNET,
                P.SCHEDULE,
                _path(_action(P.BUY, 1_000e6, address(0)))
            ),
            2_000e6,
            0
        );
        baseUsdc.mint(address(baseVault), 2_000e6);
        // Attacker front-runs pool to 10,000 USDC/WETH (5x overvalued WETH -> 80% loss on buy).
        basePair.setReserves(10_000_000e6, 1_000 ether);
        uint256 expectedFloor =
            PriceMath.applySlippage(PriceMath.oracleExpectedOut(false, 1_000e6, 2_000e18), 100);
        uint256 spotQuote = PriceMath.expectedOut(1_000e6, 10_000_000e6, 1_000 ether);
        assertEq(
            _deliverAndExpectReason(
                baseVault,
                baseBuyWf,
                _run(baseBuyWf, 101, P.BASE_MAINNET, 0),
                baseVault.FAILED(),
                abi.encodeWithSelector(
                    WorkflowProtocolsV2.SlippageExceeded.selector, expectedFloor, spotQuote
                )
            ),
            baseVault.FAILED()
        );
        assertEq(baseRouter.swapCount(), 0);
        assertEq(baseUsdc.balanceOf(address(baseVault)), 2_000e6);
        (,, uint128 baseSpent,,,,,) = baseVault.weeklyBudget(baseBuyWf);
        assertEq(baseSpent, 0);

        // 2. Unichain Mainnet (18-decimal Chainlink feeds, Uniswap V3): SCHEDULE SELL sandwich blocked.
        bytes32 uniSellWf = keccak256("uni schedule sell");
        _enable(
            uniSellWf,
            unichainVault,
            _program(
                P.UNICHAIN_MAINNET,
                P.UNICHAIN_MAINNET,
                P.SCHEDULE,
                _path(_action(P.SELL, 0.1 ether, address(0)))
            ),
            0,
            1 ether
        );
        unichainWeth.mint(address(unichainVault), 1 ether);
        // Attacker dumps WETH into pool -> 500 USDC/WETH (75% loss on sell).
        unichainPair.setPrice(_sqrtPriceFor(500e18), V3_LIQUIDITY);
        assertEq(
            _deliver(unichainVault, uniSellWf, _run(uniSellWf, 102, P.UNICHAIN_MAINNET, 0)),
            unichainVault.FAILED()
        );
        assertEq(unichainRouter.swapCount(), 0);
        assertEq(unichainWeth.balanceOf(address(unichainVault)), 1 ether);
    }

    function testSandwichAttackBlockedOnPaymentAndTransferWorkflows() public {
        // 1. PAYMENT BUY on Base Mainnet (percent-based payment sweep).
        bytes32 payWf = keccak256("base payment buy");
        P.Program memory payProg = _program(
            P.BASE_MAINNET,
            P.BASE_MAINNET,
            P.PAYMENT,
            _path(P.Action(P.BUY, P.PERCENT, 5_000, address(0)))
        );
        payProg.usdcCap = 2_000e6;
        _enable(payWf, baseVault, payProg, 2_000e6, 0);
        baseUsdc.mint(address(baseVault), 2_000e6);
        basePair.setReserves(8_000_000e6, 1_000 ether);

        P.Run memory payRun = _run(payWf, 201, P.BASE_MAINNET, 1_000e6);
        assertEq(_deliver(baseVault, payWf, payRun), baseVault.FAILED());
        assertEq(baseRouter.swapCount(), 0);

        // Once arbitrage restores the pool, a new payment swaps cleanly.
        basePair.setReserves(2_000_000e6, 1_000 ether);
        assertEq(
            _deliver(baseVault, payWf, _run(payWf, 202, P.BASE_MAINNET, 1_000e6)),
            baseVault.CONFIRMED()
        );
        assertEq(baseRouter.swapCount(), 1);

        // 2. Cross-chain TRANSFER SELL on Unichain Mainnet (origin Transfer on Base).
        bytes32 xferWf = keccak256("uni transfer sell");
        P.Program memory xferProg = _program(
            P.UNICHAIN_MAINNET,
            P.BASE_MAINNET,
            P.TRANSFER,
            _branch(P.AMOUNT_ABOVE, 100e6, _action(P.SELL, 0.1 ether, address(0)))
        );
        xferProg.source = address(baseUsdc);
        xferProg.subject = RECIPIENT;
        _enable(xferWf, unichainVault, xferProg, 0, 1 ether);
        unichainWeth.mint(address(unichainVault), 1 ether);
        uint160 lowSqrt = _sqrtPriceFor(400e18);
        unichainPair.setPrice(lowSqrt, V3_LIQUIDITY);
        uint256 lowSpot = PriceMath.usdcPerWethFromSqrtPriceX96(lowSqrt, true);

        // Note: run.observed is USDC transfer amount (500e6), not a price; must not trigger OraclePriceDeviation.
        assertEq(
            _deliverAndExpectReason(
                unichainVault,
                xferWf,
                _run(xferWf, 203, P.BASE_MAINNET, 500e6),
                unichainVault.FAILED(),
                abi.encodeWithSelector(
                    WorkflowProtocolsV2.SlippageExceeded.selector,
                    PriceMath.applySlippage(
                        PriceMath.quotedOut(true, 0.1 ether, 2_000e18, UNI_POOL_FEE), 100
                    ),
                    PriceMath.quotedOut(true, 0.1 ether, lowSpot, UNI_POOL_FEE)
                )
            ),
            unichainVault.FAILED()
        );
        assertEq(unichainRouter.swapCount(), 0);

        unichainPair.setPrice(_sqrtPriceFor(2_000e18), V3_LIQUIDITY);
        assertEq(
            _deliver(unichainVault, xferWf, _run(xferWf, 204, P.BASE_MAINNET, 500e6)),
            unichainVault.CONFIRMED()
        );
        assertEq(unichainRouter.swapCount(), 1);
    }

    function testSameChainPriceStopLossHuntingBlockedByOracle() public {
        bytes32 slWf = keccak256("base stop loss");
        _enable(
            slWf,
            baseVault,
            _program(
                P.BASE_MAINNET,
                P.BASE_MAINNET,
                P.PRICE,
                _branch(P.PRICE_BELOW, 1_900e18, _action(P.SELL, 0.1 ether, address(0)))
            ),
            0,
            1 ether
        );
        baseWeth.mint(address(baseVault), 1 ether);
        // Attacker temporarily manipulates Base spot pool down to $1,000 while Chainlink stays $2,000.
        basePair.setReserves(1_000_000e6, 1_000 ether);
        assertEq(
            _deliver(baseVault, slWf, _run(slWf, 301, P.BASE_MAINNET, 1_000e18)), baseVault.FAILED()
        );
        assertEq(baseRouter.swapCount(), 0);
    }

    function testCrossChainPriceOriginManipulationAndDestSandwichBlocked() public {
        bytes32 crossWf = keccak256("cross price oracle check");
        _enable(
            crossWf,
            unichainVault,
            _program(
                P.UNICHAIN_MAINNET,
                P.BASE_MAINNET,
                P.PRICE,
                _branch(P.PRICE_BELOW, 1_950e18, _action(P.BUY, 1_000e6, address(0)))
            ),
            2_000e6,
            0
        );
        unichainUsdc.mint(address(unichainVault), 2_000e6);

        // Origin pool skewed to $1,500 while destination Chainlink oracle is $2,000 -> OraclePriceDeviation.
        assertEq(
            _deliverAndExpectReason(
                unichainVault,
                crossWf,
                _run(crossWf, 401, P.BASE_MAINNET, 1_500e18),
                unichainVault.FAILED(),
                abi.encodeWithSelector(
                    WorkflowProtocolsV2.OraclePriceDeviation.selector, 1_500e18, 2_000e18
                )
            ),
            unichainVault.FAILED()
        );
        assertEq(unichainRouter.swapCount(), 0);

        // Origin matches oracle within slippage (1_935 vs 1_940), but destination pool is sandwiched to $3,000 -> SlippageExceeded.
        uniEthUsd.setAnswer(1_940e18);
        unichainPair.setPrice(_sqrtPriceFor(3_000e18), V3_LIQUIDITY);
        assertEq(
            _deliver(unichainVault, crossWf, _run(crossWf, 402, P.BASE_MAINNET, 1_935e18)),
            unichainVault.FAILED()
        );
        assertEq(unichainRouter.swapCount(), 0);

        // When destination pool also matches (~$1,940), swap confirms.
        unichainPair.setPrice(_sqrtPriceFor(1_940e18), V3_LIQUIDITY);
        assertEq(
            _deliver(unichainVault, crossWf, _run(crossWf, 403, P.BASE_MAINNET, 1_935e18)),
            unichainVault.CONFIRMED()
        );
        assertEq(unichainRouter.swapCount(), 1);
    }

    function testCrossChainScheduleDipOriginManipulationBlocked() public {
        bytes32 dipWf = keccak256("cross dip");
        _enable(
            dipWf,
            unichainVault,
            _program(
                P.UNICHAIN_MAINNET,
                P.BASE_MAINNET,
                P.SCHEDULE,
                _branch(P.DIP_BY, 500, _action(P.BUY, 500e6, address(0)))
            ),
            1_000e6,
            0
        );
        unichainUsdc.mint(address(unichainVault), 1_000e6);

        P.Run memory dipRun = _run(dipWf, 501, P.BASE_MAINNET, 1_800e18);
        dipRun.previous = 2_000e18;
        dipRun.observationId = keccak256("skewed dip");
        // Origin claims 10% dip ($1,800) while destination oracle is $2,000 -> blocked.
        assertEq(
            _deliverAndExpectReason(
                unichainVault,
                dipWf,
                dipRun,
                unichainVault.FAILED(),
                abi.encodeWithSelector(
                    WorkflowProtocolsV2.OraclePriceDeviation.selector, 1_800e18, 2_000e18
                )
            ),
            unichainVault.FAILED()
        );
        assertEq(unichainRouter.swapCount(), 0);
    }

    function testCrossChainSchedulePriceBranchOriginManipulationBlocked() public {
        // Even when a cross-chain SCHEDULE reaches a swap via a PRICE_* node on the DIP_BY false
        // branch (ctx.dip == false), ctx.price is still checked against the oracle.
        bytes32 schedPriceWf = keccak256("cross sched price branch");
        P.Node[] memory nodes = new P.Node[](5);
        nodes[0] = P.Node(P.DIP_BY, 1, 2, 500, 0, new P.Action[](0));
        nodes[1].actions = new P.Action[](1);
        nodes[1].actions[0] = _action(P.BUY, 500e6, address(0));
        nodes[2] = P.Node(P.PRICE_BELOW, 3, 4, 1_900e18, 0, new P.Action[](0));
        nodes[3].actions = new P.Action[](1);
        nodes[3].actions[0] = _action(P.BUY, 500e6, address(0));
        _enable(
            schedPriceWf,
            unichainVault,
            _program(P.UNICHAIN_MAINNET, P.BASE_MAINNET, P.SCHEDULE, nodes),
            1_000e6,
            0
        );
        unichainUsdc.mint(address(unichainVault), 1_000e6);
        P.Run memory falseDipRun = _run(schedPriceWf, 502, P.BASE_MAINNET, 1_850e18);
        falseDipRun.previous = 1_860e18;
        falseDipRun.observationId = keccak256("false dip branch");
        assertEq(
            _deliverAndExpectReason(
                unichainVault,
                schedPriceWf,
                falseDipRun,
                unichainVault.FAILED(),
                abi.encodeWithSelector(
                    WorkflowProtocolsV2.OraclePriceDeviation.selector, 1_850e18, 2_000e18
                )
            ),
            unichainVault.FAILED()
        );
        assertEq(unichainRouter.swapCount(), 0);
    }

    function testSwapUsesTighterOfOracleFloorAndSpotFloor() public {
        bytes32 wf = keccak256("tighter floor");
        _enable(
            wf,
            baseVault,
            _program(
                P.BASE_MAINNET,
                P.BASE_MAINNET,
                P.SCHEDULE,
                _path(_action(P.BUY, 1_000e6, address(0)))
            ),
            5_000e6,
            0
        );
        baseUsdc.mint(address(baseVault), 5_000e6);

        // Case A: Pool is slightly better than oracle ($1,900/WETH vs $2,000/WETH oracle).
        // Spot floor exceeds oracle floor, so spot floor wins and protects against surplus extraction.
        basePair.setReserves(1_900_000e6, 1_000 ether);
        uint256 spotQuoteA = PriceMath.expectedOut(1_000e6, 1_900_000e6, 1_000 ether);
        uint256 spotFloorA = PriceMath.applySlippage(spotQuoteA, 100);
        uint256 oracleFloorA =
            PriceMath.applySlippage(PriceMath.oracleExpectedOut(false, 1_000e6, 2_000e18), 100);
        assertGt(spotFloorA, oracleFloorA);
        assertEq(_deliver(baseVault, wf, _run(wf, 601, P.BASE_MAINNET, 0)), baseVault.CONFIRMED());
        (, uint256 actualMinOutA,,) = baseRouter.lastSwap();
        assertEq(actualMinOutA, spotFloorA);

        // Case B: Pool is slightly worse than oracle within slippage tolerance ($2,010/WETH vs $2,000/WETH oracle).
        // Oracle floor exceeds spot floor, so oracle floor wins and passes because spotQuote >= oracleFloor.
        basePair.setReserves(2_010_000e6, 1_000 ether);
        uint256 spotQuoteB = PriceMath.expectedOut(1_000e6, 2_010_000e6, 1_000 ether);
        uint256 spotFloorB = PriceMath.applySlippage(spotQuoteB, 100);
        uint256 oracleFloorB =
            PriceMath.applySlippage(PriceMath.oracleExpectedOut(false, 1_000e6, 2_000e18), 100);
        assertGt(oracleFloorB, spotFloorB);
        assertGe(spotQuoteB, oracleFloorB);
        assertEq(_deliver(baseVault, wf, _run(wf, 602, P.BASE_MAINNET, 0)), baseVault.CONFIRMED());
        (, uint256 actualMinOutB,,) = baseRouter.lastSwap();
        assertEq(actualMinOutB, oracleFloorB);
    }

    function testUsdcDepegAdjustsOraclePriceAndOptionalUsdcFeedFallbackWorks() public {
        // When USDC depegs to $0.90 while ETH is $1,800, 1 ETH costs 2,000 depegged USDC.
        baseEthUsd.setAnswer(1_800e8);
        baseUsdcUsd.setAnswer(0.9e8);
        assertEq(baseVault.oraclePrice(), 2_000e18);

        // Testnet / no-oracle vault reports oraclePrice() == 0, and single-feed mainnet-like
        // config (usdcUsdFeed == address(0)) uses ETH/USD directly.
        WorkflowVaultV2 singleFeedVault = new WorkflowVaultV2(
            PROXY,
            OWNER,
            address(agent),
            P.UNICHAIN_MAINNET,
            WorkflowProtocolsV2.Networks(
                address(unichainUsdc),
                address(unichainWeth),
                address(unichainRouter),
                address(unichainPair),
                UNI_POOL_FEE,
                address(uniEthUsd),
                address(0),
                address(uniSequencer),
                UNI_ETH_MAX_AGE,
                0
            ),
            validator
        );
        assertEq(singleFeedVault.oraclePrice(), 2_000e18);

        WorkflowVaultV2 testnetVault = new WorkflowVaultV2(
            PROXY,
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
        assertEq(testnetVault.oraclePrice(), 0);
    }

    function testOracleFailureModesRevertCleanlyWithOracleUnavailableOrInvalidMarket() public {
        bytes32 wf = keccak256("oracle failures");
        _enable(
            wf,
            baseVault,
            _program(
                P.BASE_MAINNET, P.BASE_MAINNET, P.SCHEDULE, _path(_action(P.BUY, 100e6, address(0)))
            ),
            1_000e6,
            0
        );
        baseUsdc.mint(address(baseVault), 1_000e6);

        uint256 nowTs = vm.getBlockTimestamp();

        // 1. Stale ETH/USD feed (age > 3600s on Base).
        baseEthUsd.setRound(
            2, 2_000e8, nowTs - BASE_ETH_MAX_AGE - 1, nowTs - BASE_ETH_MAX_AGE - 1, 2
        );
        vm.expectRevert(WorkflowProtocolsV2.OracleUnavailable.selector);
        baseVault.oraclePrice();
        assertEq(_deliver(baseVault, wf, _run(wf, 701, P.BASE_MAINNET, 0)), baseVault.FAILED());

        // Restore ETH/USD; stale USDC/USD feed.
        baseEthUsd.setAnswer(2_000e8);
        baseUsdcUsd.setRound(2, 1e8, nowTs - USDC_MAX_AGE - 1, nowTs - USDC_MAX_AGE - 1, 2);
        vm.expectRevert(WorkflowProtocolsV2.OracleUnavailable.selector);
        baseVault.oraclePrice();
        baseUsdcUsd.setAnswer(1e8);

        // 2. Non-positive answer.
        baseEthUsd.setRound(2, 0, nowTs, nowTs, 2);
        vm.expectRevert(WorkflowProtocolsV2.OracleUnavailable.selector);
        baseVault.oraclePrice();
        baseEthUsd.setRound(2, -1, nowTs, nowTs, 2);
        vm.expectRevert(WorkflowProtocolsV2.OracleUnavailable.selector);
        baseVault.oraclePrice();

        // 3. Round ID zero or incomplete round (answeredInRound < roundId).
        baseEthUsd.setRound(0, 2_000e8, nowTs, nowTs, 0);
        vm.expectRevert(WorkflowProtocolsV2.OracleUnavailable.selector);
        baseVault.oraclePrice();
        baseEthUsd.setRound(5, 2_000e8, nowTs, nowTs, 4);
        vm.expectRevert(WorkflowProtocolsV2.OracleUnavailable.selector);
        baseVault.oraclePrice();

        // 4. updatedAt == 0 or updatedAt in the future.
        baseEthUsd.setRound(5, 2_000e8, nowTs, 0, 5);
        vm.expectRevert(WorkflowProtocolsV2.OracleUnavailable.selector);
        baseVault.oraclePrice();
        baseEthUsd.setRound(5, 2_000e8, nowTs, nowTs + 1, 5);
        vm.expectRevert(WorkflowProtocolsV2.OracleUnavailable.selector);
        baseVault.oraclePrice();

        // 5. Feed reverts on latestRoundData() or decimals() at construction.
        baseEthUsd.setAnswer(2_000e8);
        baseEthUsd.setReverts(true);
        vm.expectRevert(WorkflowProtocolsV2.OracleUnavailable.selector);
        baseVault.oraclePrice();
        baseEthUsd.setReverts(false);

        baseEthUsd.setDecimalsReverts(true);
        WorkflowProtocolsV2.Networks memory baseNet = WorkflowProtocolsV2.Networks(
            address(baseUsdc),
            address(baseWeth),
            address(baseRouter),
            address(basePair),
            0,
            address(baseEthUsd),
            address(baseUsdcUsd),
            address(baseSequencer),
            BASE_ETH_MAX_AGE,
            USDC_MAX_AGE
        );
        vm.expectRevert(WorkflowProtocolsV2.OracleUnavailable.selector);
        new WorkflowVaultV2(PROXY, OWNER, address(agent), P.BASE_MAINNET, baseNet, validator);
        baseEthUsd.setDecimalsReverts(false);

        // 6. Decimals > 18 reverts InvalidMarket at construction.
        baseEthUsd.setDecimals(19);
        vm.expectRevert(WorkflowProtocolsV2.InvalidMarket.selector);
        new WorkflowVaultV2(PROXY, OWNER, address(agent), P.BASE_MAINNET, baseNet, validator);
        baseEthUsd.setDecimals(8);

        // 7. Extreme USDC price scaling overflow or rounding ETH/USDC to 0 reverts OracleUnavailable.
        baseEthUsd.setAnswer(1);
        baseUsdcUsd.setAnswer(type(int256).max);
        vm.expectRevert(WorkflowProtocolsV2.OracleUnavailable.selector);
        baseVault.oraclePrice();
        baseUsdcUsd.setAnswer(1e30);
        vm.expectRevert(WorkflowProtocolsV2.OracleUnavailable.selector);
        baseVault.oraclePrice();
        baseEthUsd.setAnswer(2_000e8);
        baseUsdcUsd.setAnswer(1e8);
        assertEq(baseVault.oraclePrice(), 2_000e18);
    }

    function testSequencerUptimeAndGracePeriodEnforcement() public {
        bytes32 wf = keccak256("sequencer check");
        _enable(
            wf,
            baseVault,
            _program(
                P.BASE_MAINNET, P.BASE_MAINNET, P.SCHEDULE, _path(_action(P.BUY, 100e6, address(0)))
            ),
            1_000e6,
            0
        );
        baseUsdc.mint(address(baseVault), 1_000e6);
        uint256 nowTs = vm.getBlockTimestamp();

        // 1. Sequencer down (status = 1).
        baseSequencer.setRound(2, 1, nowTs - 2 hours, nowTs - 2 hours, 2);
        vm.expectRevert(WorkflowProtocolsV2.SequencerUnavailable.selector);
        baseVault.oraclePrice();
        assertEq(_deliver(baseVault, wf, _run(wf, 801, P.BASE_MAINNET, 0)), baseVault.FAILED());

        // 2. startedAt == 0 or updatedAt == 0 or startedAt > block.timestamp.
        baseSequencer.setRound(2, 0, 0, nowTs, 2);
        vm.expectRevert(WorkflowProtocolsV2.SequencerUnavailable.selector);
        baseVault.oraclePrice();
        baseSequencer.setRound(2, 0, nowTs - 2 hours, 0, 2);
        vm.expectRevert(WorkflowProtocolsV2.SequencerUnavailable.selector);
        baseVault.oraclePrice();
        baseSequencer.setRound(2, 0, nowTs + 1, nowTs, 2);
        vm.expectRevert(WorkflowProtocolsV2.SequencerUnavailable.selector);
        baseVault.oraclePrice();

        // 3. Reverting sequencer feed.
        baseSequencer.setReverts(true);
        vm.expectRevert(WorkflowProtocolsV2.SequencerUnavailable.selector);
        baseVault.oraclePrice();
        baseSequencer.setReverts(false);

        // 4. Sequencer recovered exactly 1 hour ago (still within grace period <= 1 hours).
        baseSequencer.setRound(2, 0, nowTs - 1 hours, nowTs - 1 hours, 2);
        vm.expectRevert(WorkflowProtocolsV2.SequencerUnavailable.selector);
        baseVault.oraclePrice();

        // 5. Advance 1 second past grace period; sequencer updatedAt may be old (> 1 day) without failing.
        uint256 afterGrace = nowTs + 1;
        vm.warp(afterGrace);
        baseEthUsd.setRound(3, 2_000e8, afterGrace, afterGrace, 3);
        baseUsdcUsd.setRound(3, 1e8, afterGrace, afterGrace, 3);
        assertEq(baseVault.oraclePrice(), 2_000e18);
        assertEq(_deliver(baseVault, wf, _run(wf, 802, P.BASE_MAINNET, 0)), baseVault.CONFIRMED());
        assertEq(baseRouter.swapCount(), 1);
    }

    function testMainnetOracleProtectedSwapFitsCallbackGasLimit() public {
        bytes32 wf = keccak256("gas check");
        _enable(
            wf,
            baseVault,
            _program(
                P.BASE_MAINNET, P.BASE_MAINNET, P.SCHEDULE, _path(_action(P.BUY, 100e6, address(0)))
            ),
            1_000e6,
            0
        );
        baseUsdc.mint(address(baseVault), 1_000e6);
        P.Run memory run = _run(wf, 901, P.BASE_MAINNET, 0);
        uint256 before = gasleft();
        vm.prank(PROXY);
        baseVault.execute(address(agent), wf, run);
        uint256 used = before - gasleft();
        assertEq(baseVault.outcomes(_runId(wf, run)), baseVault.CONFIRMED());
        assertLt(used, 850_000);
    }

    function testUnichainV3SwapSubscriptionAndPriceTriggers() public {
        bytes32 priceWf = keccak256("unichain v3 price");
        _enable(
            priceWf,
            unichainVault,
            _program(
                P.UNICHAIN_MAINNET,
                P.UNICHAIN_MAINNET,
                P.PRICE,
                _branch(P.PRICE_BELOW, 1_980e18, _action(P.BUY, 500e6, address(0)))
            ),
            2_000e6,
            0
        );
        bytes32 dipWf = keccak256("unichain v3 dip");
        _enable(
            dipWf,
            unichainVault,
            _program(
                P.UNICHAIN_MAINNET,
                P.UNICHAIN_MAINNET,
                P.SCHEDULE,
                _branch(P.DIP_BY, 200, _action(P.BUY, 500e6, address(0)))
            ),
            2_000e6,
            0
        );
        unichainUsdc.mint(address(unichainVault), 2_000e6);

        address realUniPool = ChainConfig.unichainMainnet().pair;
        assertTrue(system.isSubscribed(P.UNICHAIN_MAINNET, realUniPool, SWAP_V3));
        assertFalse(system.isSubscribed(P.UNICHAIN_MAINNET, realUniPool, SYNC));

        // Malformed, zero-liquidity, and out-of-bounds Swap logs are ignored cleanly.
        IReactive.LogRecord memory badLog;
        badLog.chain_id = P.UNICHAIN_MAINNET;
        badLog._contract = realUniPool;
        badLog.topic_0 = SWAP_V3;
        badLog.block_number = 10;
        badLog.tx_hash = 10;
        badLog.data = abi.encode(uint256(1), uint256(2)); // wrong length (64 != 160)
        vm.prank(address(system));
        agent.react(badLog);

        badLog.block_number = 11;
        badLog.tx_hash = 11;
        badLog.data = abi.encode(
            int256(0), int256(0), uint256(_sqrtPriceFor(2_000e18)), uint256(0), int24(0)
        );
        vm.prank(address(system));
        agent.react(badLog);

        badLog.block_number = 12;
        badLog.tx_hash = 12;
        badLog.data = abi.encode(
            int256(0),
            int256(0),
            uint256(PriceMath.MIN_SQRT_RATIO - 1),
            uint256(V3_LIQUIDITY),
            int24(0)
        );
        vm.prank(address(system));
        agent.react(badLog);
        assertEq(system.requestCount(), 0);

        // First valid V3 Swap sets baseline ($2,000/WETH) -> PRICE_BELOW 1980 is filtered without a callback.
        IReactive.LogRecord memory swap1;
        swap1.chain_id = P.UNICHAIN_MAINNET;
        swap1._contract = realUniPool;
        swap1.topic_0 = SWAP_V3;
        swap1.block_number = 20;
        swap1.tx_hash = 20;
        swap1.data = abi.encode(
            int256(-1_000e6),
            int256(0.5 ether),
            uint256(_sqrtPriceFor(2_000e18)),
            uint256(V3_LIQUIDITY),
            int24(200_300)
        );
        vm.prank(address(system));
        agent.react(swap1);
        assertEq(system.requestCount(), 0);
        assertEq(unichainRouter.swapCount(), 0);

        // Second V3 Swap moves price to $1,940/WETH (3% drop -> matches both PRICE_BELOW and DIP_BY 2%).
        uniEthUsd.setAnswer(1_940e18);
        unichainPair.setPrice(_sqrtPriceFor(1_940e18), V3_LIQUIDITY);
        IReactive.LogRecord memory swap2 = swap1;
        swap2.block_number = 21;
        swap2.tx_hash = 21;
        swap2.data = abi.encode(
            int256(1_000e6),
            int256(-0.515 ether),
            uint256(_sqrtPriceFor(1_940e18)),
            uint256(V3_LIQUIDITY),
            int24(200_600)
        );
        vm.prank(address(system));
        agent.react(swap2);
        assertEq(system.requestCount(), 1);
        _deliverRequest(0, address(unichainVault));
        assertEq(unichainRouter.swapCount(), 1);

        // Cron tick dispatches SCHEDULE + DIP_BY using the recorded V3 Swap state.
        IReactive.LogRecord memory cronLog;
        cronLog.chain_id = ChainConfig.REACTIVE_MAINNET;
        cronLog._contract = ChainConfig.reactiveMainnet().cronSource;
        cronLog.topic_0 = CRON;
        cronLog.topic_1 = block.number + 1;
        cronLog.block_number = block.number + 1;
        cronLog.tx_hash = 22;
        vm.prank(address(system));
        agent.react(cronLog);
        assertEq(system.requestCount(), 2);
        _deliverRequest(1, address(unichainVault));
        assertEq(unichainRouter.swapCount(), 2);
    }

    function testUnichainV3ExactInputSingleFloorsAndMarketChecks() public {
        bytes32 buyWf = keccak256("uni v3 buy floor");
        _enable(
            buyWf,
            unichainVault,
            _program(
                P.UNICHAIN_MAINNET,
                P.UNICHAIN_MAINNET,
                P.SCHEDULE,
                _path(_action(P.BUY, 1_000e6, address(0)))
            ),
            5_000e6,
            0
        );
        unichainUsdc.mint(address(unichainVault), 5_000e6);

        // Case A: Spot pool is better than oracle ($1,980 vs $2,000 oracle -> spot floor wins).
        uint160 sqrtA = _sqrtPriceFor(1_980e18);
        unichainPair.setPrice(sqrtA, V3_LIQUIDITY);
        uint256 spotA = PriceMath.usdcPerWethFromSqrtPriceX96(sqrtA, true);
        uint256 spotFloorA =
            PriceMath.applySlippage(PriceMath.quotedOut(false, 1_000e6, spotA, UNI_POOL_FEE), 100);
        uint256 oracleFloorA = PriceMath.applySlippage(
            PriceMath.quotedOut(false, 1_000e6, 2_000e18, UNI_POOL_FEE), 100
        );
        assertGt(spotFloorA, oracleFloorA);
        assertEq(
            _deliver(unichainVault, buyWf, _run(buyWf, 951, P.UNICHAIN_MAINNET, 0)),
            unichainVault.CONFIRMED()
        );
        (address tIn, address tOut, uint24 fee,, uint256 minOut,) = unichainRouter.lastSwap();
        assertEq(tIn, address(unichainUsdc));
        assertEq(tOut, address(unichainWeth));
        assertEq(fee, UNI_POOL_FEE);
        assertEq(minOut, spotFloorA);

        // Case B: Spot pool is slightly worse than oracle within tolerance ($2,010 vs $2,000 -> oracle floor wins).
        uint160 sqrtB = _sqrtPriceFor(2_010e18);
        unichainPair.setPrice(sqrtB, V3_LIQUIDITY);
        uint256 oracleFloorB = PriceMath.applySlippage(
            PriceMath.quotedOut(false, 1_000e6, 2_000e18, UNI_POOL_FEE), 100
        );
        assertEq(
            _deliver(unichainVault, buyWf, _run(buyWf, 952, P.UNICHAIN_MAINNET, 0)),
            unichainVault.CONFIRMED()
        );
        (,,,, uint256 minOutB,) = unichainRouter.lastSwap();
        assertEq(minOutB, oracleFloorB);

        // Case C: Vault post-swap check catches short router output even if router bypasses minOut.
        unichainRouter.setForcedOut(true, oracleFloorB - 1, true);
        assertEq(
            _deliverAndExpectReason(
                unichainVault,
                buyWf,
                _run(buyWf, 953, P.UNICHAIN_MAINNET, 0),
                unichainVault.FAILED(),
                abi.encodeWithSelector(
                    WorkflowProtocolsV2.SlippageExceeded.selector, oracleFloorB, oracleFloorB - 1
                )
            ),
            unichainVault.FAILED()
        );
        unichainRouter.setForcedOut(false, 0, false);

        // Case D: Zero liquidity or factory pool mismatch reverts InvalidMarket.
        unichainPair.setPrice(sqrtB, 0);
        assertEq(
            _deliverAndExpectReason(
                unichainVault,
                buyWf,
                _run(buyWf, 954, P.UNICHAIN_MAINNET, 0),
                unichainVault.FAILED(),
                abi.encodeWithSelector(WorkflowProtocolsV2.InvalidMarket.selector)
            ),
            unichainVault.FAILED()
        );

        unichainPair.setPrice(_sqrtPriceFor(2_000e18), V3_LIQUIDITY);
        unichainRouter.setPool(
            address(unichainUsdc), address(unichainWeth), UNI_POOL_FEE, address(0)
        );
        WorkflowProtocolsV2.Networks memory mismatchedPoolNet = WorkflowProtocolsV2.Networks(
            address(unichainUsdc),
            address(unichainWeth),
            address(unichainRouter),
            address(unichainPair),
            UNI_POOL_FEE,
            address(uniEthUsd),
            address(uniUsdcUsd),
            address(uniSequencer),
            UNI_ETH_MAX_AGE,
            USDC_MAX_AGE
        );
        vm.expectRevert(WorkflowProtocolsV2.InvalidMarket.selector);
        new WorkflowVaultV2(
            PROXY, OWNER, address(agent), P.UNICHAIN_MAINNET, mismatchedPoolNet, validator
        );
        unichainRouter.setPool(
            address(unichainUsdc), address(unichainWeth), UNI_POOL_FEE, address(unichainPair)
        );

        // Constructor rejects reverting factory/pair calls and wrong token pairs.
        vm.mockCallRevert(address(unichainRouter), abi.encodeCall(IV3SwapRouter.factory, ()), "bad");
        vm.expectRevert(WorkflowProtocolsV2.InvalidMarket.selector);
        new WorkflowVaultV2(
            PROXY, OWNER, address(agent), P.UNICHAIN_MAINNET, mismatchedPoolNet, validator
        );
        vm.clearMockedCalls();

        MockV3Pool wrongTokenPool =
            new MockV3Pool(address(unichainUsdc), address(baseWeth), UNI_POOL_FEE);
        unichainRouter.setPool(
            address(unichainUsdc), address(unichainWeth), UNI_POOL_FEE, address(wrongTokenPool)
        );
        WorkflowProtocolsV2.Networks memory wrongTokensNet = WorkflowProtocolsV2.Networks(
            address(unichainUsdc),
            address(unichainWeth),
            address(unichainRouter),
            address(wrongTokenPool),
            UNI_POOL_FEE,
            address(uniEthUsd),
            address(uniUsdcUsd),
            address(uniSequencer),
            UNI_ETH_MAX_AGE,
            USDC_MAX_AGE
        );
        vm.expectRevert(WorkflowProtocolsV2.InvalidMarket.selector);
        new WorkflowVaultV2(
            PROXY, OWNER, address(agent), P.UNICHAIN_MAINNET, wrongTokensNet, validator
        );
        unichainRouter.setPool(
            address(unichainUsdc), address(unichainWeth), UNI_POOL_FEE, address(unichainPair)
        );
    }

    function testUnichainV3NonSwapPriceTriggerAndTrailingPeakOracleGuardrail() public {
        bytes32 trailWf = keccak256("uni v3 trailing send");
        _enable(
            trailWf,
            unichainVault,
            _program(
                P.UNICHAIN_MAINNET,
                P.UNICHAIN_MAINNET,
                P.PRICE,
                _branch(P.TRAILING, 500, _action(P.SEND, 10e6, RECIPIENT))
            ),
            100e6,
            0
        );
        unichainUsdc.mint(address(unichainVault), 100e6);

        // 1. Manipulated run.observed (2,500 vs 2,000 oracle, +25%) fails BEFORE poisoning peak.
        assertEq(
            _deliverAndExpectReason(
                unichainVault,
                trailWf,
                _run(trailWf, 961, P.UNICHAIN_MAINNET, 2_500e18),
                unichainVault.FAILED(),
                abi.encodeWithSelector(
                    WorkflowProtocolsV2.OraclePriceDeviation.selector, 2_500e18, 2_000e18
                )
            ),
            unichainVault.FAILED()
        );
        (uint128 peakAfterManip,,,,,,,) = unichainVault.workflowMemory(trailWf);
        assertEq(peakAfterManip, 0);

        // 2. Valid run.observed (2,050) but manipulated live spot pool (1,850, -7.5%) fails on _price() even for SEND.
        uint160 manipSqrt = _sqrtPriceFor(1_850e18);
        uint256 manipSpot = PriceMath.usdcPerWethFromSqrtPriceX96(manipSqrt, true);
        unichainPair.setPrice(manipSqrt, V3_LIQUIDITY);
        assertEq(
            _deliverAndExpectReason(
                unichainVault,
                trailWf,
                _run(trailWf, 962, P.UNICHAIN_MAINNET, 2_050e18),
                unichainVault.FAILED(),
                abi.encodeWithSelector(
                    WorkflowProtocolsV2.OraclePriceDeviation.selector, manipSpot, 2_000e18
                )
            ),
            unichainVault.FAILED()
        );
        assertEq(unichainUsdc.balanceOf(RECIPIENT), 0);

        // 3. Legitimate peak at $2,050, then 5.37% drop to $1,940 (within 5% of $2,000 oracle) confirms SEND.
        unichainPair.setPrice(_sqrtPriceFor(2_050e18), V3_LIQUIDITY);
        assertEq(
            _deliver(unichainVault, trailWf, _run(trailWf, 963, P.UNICHAIN_MAINNET, 2_050e18)),
            unichainVault.SKIPPED()
        );
        (uint128 peakRecorded,,,,,,,) = unichainVault.workflowMemory(trailWf);
        assertEq(peakRecorded, 2_050e18);

        unichainPair.setPrice(_sqrtPriceFor(1_940e18), V3_LIQUIDITY);
        assertEq(
            _deliver(unichainVault, trailWf, _run(trailWf, 964, P.UNICHAIN_MAINNET, 1_940e18)),
            unichainVault.CONFIRMED()
        );
        assertEq(unichainUsdc.balanceOf(RECIPIENT), 10e6);
    }

    function testUnichainV3OracleProtectedSwapFitsCallbackGasLimit() public {
        bytes32 wf = keccak256("unichain v3 gas check");
        _enable(
            wf,
            unichainVault,
            _program(
                P.UNICHAIN_MAINNET,
                P.UNICHAIN_MAINNET,
                P.SCHEDULE,
                _path(_action(P.BUY, 100e6, address(0)))
            ),
            1_000e6,
            0
        );
        unichainUsdc.mint(address(unichainVault), 1_000e6);
        P.Run memory run = _run(wf, 971, P.UNICHAIN_MAINNET, 0);
        uint256 before = gasleft();
        vm.prank(PROXY);
        unichainVault.execute(address(agent), wf, run);
        uint256 used = before - gasleft();
        assertEq(unichainVault.outcomes(_runId(wf, run)), unichainVault.CONFIRMED());
        assertLt(used, 850_000);
    }

    function testOneBlockHighSpikeDoesNotPoisonTrailingPeak() public {
        bytes32 trailWf = keccak256("uni high spike guard");
        _enable(
            trailWf,
            unichainVault,
            _program(
                P.UNICHAIN_MAINNET,
                P.UNICHAIN_MAINNET,
                P.PRICE,
                _branch(P.TRAILING, 500, _action(P.SEND, 10e6, RECIPIENT))
            ),
            100e6,
            0
        );
        unichainUsdc.mint(address(unichainVault), 100e6);

        // Normal $2,000 observation carrying a 1-block $10,000 run.high spike:
        // does not revert and does not poison memory_.peak.
        P.Run memory spikedRun = _run(trailWf, 981, P.UNICHAIN_MAINNET, 2_000e18);
        spikedRun.high = 10_000e18;
        spikedRun.highBlock = uint64(block.number);
        assertEq(_deliver(unichainVault, trailWf, spikedRun), unichainVault.SKIPPED());
        (uint128 peakAfterSpike,,,,,,,) = unichainVault.workflowMemory(trailWf);
        assertEq(peakAfterSpike, 2_000e18);
        assertEq(unichainUsdc.balanceOf(RECIPIENT), 0);

        // Subsequent normal observation updates peak cleanly.
        unichainPair.setPrice(_sqrtPriceFor(2_040e18), V3_LIQUIDITY);
        P.Run memory normalRun = _run(trailWf, 982, P.UNICHAIN_MAINNET, 2_040e18);
        normalRun.high = 2_040e18;
        normalRun.highBlock = uint64(block.number);
        assertEq(_deliver(unichainVault, trailWf, normalRun), unichainVault.SKIPPED());
        (uint128 peakAfterNormal,,,,,,,) = unichainVault.workflowMemory(trailWf);
        assertEq(peakAfterNormal, 2_040e18);
    }

    function testCrossChainScheduleDipSendBlockedByOracleGuardrail() public {
        bytes32 dipSendWf = keccak256("cross dip send");
        _enable(
            dipSendWf,
            unichainVault,
            _program(
                P.UNICHAIN_MAINNET,
                P.BASE_MAINNET,
                P.SCHEDULE,
                _branch(P.DIP_BY, 500, _action(P.SEND, 10e6, RECIPIENT))
            ),
            100e6,
            0
        );
        unichainUsdc.mint(address(unichainVault), 100e6);

        P.Run memory dipRun = _run(dipSendWf, 991, P.BASE_MAINNET, 1_800e18);
        dipRun.previous = 2_000e18;
        dipRun.observationId = keccak256("cross dip send skewed");
        assertEq(
            _deliverAndExpectReason(
                unichainVault,
                dipSendWf,
                dipRun,
                unichainVault.FAILED(),
                abi.encodeWithSelector(
                    WorkflowProtocolsV2.OraclePriceDeviation.selector, 1_800e18, 2_000e18
                )
            ),
            unichainVault.FAILED()
        );
        assertEq(unichainUsdc.balanceOf(RECIPIENT), 0);
    }

    function testCrossChainPriceSwapAcceptsNormalOracleDispersionWithTightSlippage() public {
        bytes32 crossWf = keccak256("cross normal dispersion");
        P.Program memory prog = _program(
            P.UNICHAIN_MAINNET,
            P.BASE_MAINNET,
            P.PRICE,
            _branch(P.PRICE_BELOW, 1_990e18, _action(P.BUY, 500e6, address(0)))
        );
        prog.slippage = 50; // 0.5% user slippage
        _enable(crossWf, unichainVault, prog, 2_000e6, 0);
        unichainUsdc.mint(address(unichainVault), 2_000e6);

        // Origin is 0.7% below destination oracle (1_986 vs 2_000): within 5% guardrail even
        // though > 0.5% slippage, and destination V3 pool matches oracle so swap confirms.
        unichainPair.setPrice(_sqrtPriceFor(2_000e18), V3_LIQUIDITY);
        assertEq(
            _deliver(unichainVault, crossWf, _run(crossWf, 995, P.BASE_MAINNET, 1_986e18)),
            unichainVault.CONFIRMED()
        );
        assertEq(unichainRouter.swapCount(), 1);
    }

    function testMainnetFactoryRejectsFundsChainAndWakeBlockUsesFasterBlockTime() public {
        vm.chainId(ChainConfig.UNICHAIN_MAINNET);
        vm.expectRevert(WorkflowAgentFactoryV2.InactiveDeployment.selector);
        new WorkflowAgentFactoryV2(system);

        vm.expectRevert(WorkflowAgentV2.InvalidWorkflow.selector);
        new WorkflowAgentV2(system, address(agentFactory), validator);

        vm.chainId(ChainConfig.LASNA);
        WorkflowAgentFactoryV2 lasnaFactory = new WorkflowAgentFactoryV2(system);
        vm.prank(OWNER);
        WorkflowAgentV2 lasnaAgent = WorkflowAgentV2(payable(lasnaFactory.create()));
        WorkflowVaultV2 sepVault = new WorkflowVaultV2(
            PROXY,
            OWNER,
            address(lasnaAgent),
            P.UNICHAIN_SEPOLIA,
            WorkflowProtocolsV2.Networks(
                address(unichainUsdc),
                address(unichainWeth),
                address(unichainRouter),
                address(unichainPair),
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
        lasnaAgent.linkVault(P.UNICHAIN_SEPOLIA, address(sepVault));
        bytes memory sepEncoded = abi.encode(
            _program(
                P.UNICHAIN_SEPOLIA,
                P.UNICHAIN_SEPOLIA,
                P.SCHEDULE,
                _path(_action(P.SEND, 100e6, RECIPIENT))
            )
        );
        bytes32 sepWf = keccak256("lasna wake compare");
        sepVault.authorizeWithWeeklyBudget(sepWf, 1, sepEncoded, "Lasna", 10e6, 0);
        lasnaAgent.enable(sepWf, 1, sepEncoded, "Lasna", uint64(block.number));
        vm.stopPrank();

        bytes32 mainnetWf = keccak256("mainnet wake compare");
        _enable(
            mainnetWf,
            unichainVault,
            _program(
                P.UNICHAIN_MAINNET,
                P.UNICHAIN_MAINNET,
                P.SCHEDULE,
                _path(_action(P.SEND, 100e6, RECIPIENT))
            ),
            10e6,
            0
        );

        assertTrue(lasnaAgent.watchingPaused(sepWf));
        assertTrue(agent.watchingPaused(mainnetWf));
        // Mainnet uses 820ms/block vs 2000ms/block on Lasna, so the pinned wake block is further ahead.
        assertGt(agent.wakeBlock(mainnetWf), lasnaAgent.wakeBlock(sepWf));
    }

    function testSameBlockFlashLoanRoundTripDoesNotForgePreviousPriceForDipOrCrossings() public {
        bytes32 dipWf = keccak256("same block flash dip");
        _enable(
            dipWf,
            unichainVault,
            _program(
                P.UNICHAIN_MAINNET,
                P.UNICHAIN_MAINNET,
                P.SCHEDULE,
                _branch(P.DIP_BY, 500, _action(P.BUY, 100e6, address(0)))
            ),
            1_000e6,
            0
        );
        bytes32 fallWf = keccak256("same block flash fall");
        P.Program memory fallProg = _program(
            P.UNICHAIN_MAINNET,
            P.UNICHAIN_MAINNET,
            P.PRICE,
            _branch(P.PRICE_FALLS_THROUGH, 2_100e18, _action(P.SEND, 10e6, RECIPIENT))
        );
        fallProg.once = true;
        _enable(fallWf, unichainVault, fallProg, 100e6, 0);

        bytes32 riseWf = keccak256("same block flash rise");
        P.Program memory riseProg = _program(
            P.UNICHAIN_MAINNET,
            P.UNICHAIN_MAINNET,
            P.PRICE,
            _branch(P.PRICE_RISES_THROUGH, 1_900e18, _action(P.SEND, 10e6, RECIPIENT))
        );
        riseProg.once = true;
        _enable(riseWf, unichainVault, riseProg, 100e6, 0);

        unichainUsdc.mint(address(unichainVault), 1_000e6);
        address realUniPool = ChainConfig.unichainMainnet().pair;

        // Block 10: establish baseline $2,000.
        IReactive.LogRecord memory swap = _uniSwapLog(10, 0, _sqrtPriceFor(2_000e18));
        vm.prank(address(system));
        agent.react(swap);

        // Block 11: atomic flash-loan pushes price up to $2,500 (log_index 1) then back to $2,000 (log_index 2).
        IReactive.LogRecord memory flashUp = _uniSwapLog(11, 1, _sqrtPriceFor(2_500e18));
        IReactive.LogRecord memory flashBack = _uniSwapLog(11, 2, _sqrtPriceFor(2_000e18));
        vm.prank(address(system));
        agent.react(flashUp);
        vm.prank(address(system));
        agent.react(flashBack);
        assertEq(system.requestCount(), 0, "flash-loan round-trip dispatches zero price callbacks");

        // Block 11 second flash-loan down to $1,500 (log_index 3) and back to $2,000 (log_index 4).
        IReactive.LogRecord memory flashDown = _uniSwapLog(11, 3, _sqrtPriceFor(1_500e18));
        IReactive.LogRecord memory flashReturn = _uniSwapLog(11, 4, _sqrtPriceFor(2_000e18));
        vm.prank(address(system));
        agent.react(flashDown);
        vm.prank(address(system));
        agent.react(flashReturn);
        assertEq(
            system.requestCount(),
            0,
            "downward flash-loan round-trip dispatches zero price callbacks"
        );

        // Cron tick dispatches DIP_BY: run.previous must still be ~$2,000 (not $2,500).
        IReactive.LogRecord memory cronLog;
        cronLog.chain_id = ChainConfig.REACTIVE_MAINNET;
        cronLog._contract = ChainConfig.reactiveMainnet().cronSource;
        cronLog.topic_0 = CRON;
        cronLog.topic_1 = block.number + 1;
        cronLog.block_number = block.number + 1;
        cronLog.tx_hash = 9_999;
        vm.prank(address(system));
        agent.react(cronLog);
        assertEq(system.requestCount(), 1);
        CallbackConfiguration memory dipReq = system.requestAt(0);
        (,, P.Run memory decodedDip) =
            abi.decode(_slice(dipReq.payload, 4), (address, bytes32, P.Run));
        assertApproxEqRel(decodedDip.previous, 2_000e18, 0.001e18);
        _deliverRequest(0, address(unichainVault));

        assertEq(unichainRouter.swapCount(), 0);
        assertEq(unichainUsdc.balanceOf(RECIPIENT), 0);
        assertTrue(realUniPool != address(0));
    }

    function testCrossBlockManipulatedPreviousPriceBlockedByOracleOnVault() public {
        bytes32 dipWf = keccak256("vault guard prev dip");
        _enable(
            dipWf,
            unichainVault,
            _program(
                P.UNICHAIN_MAINNET,
                P.BASE_MAINNET,
                P.SCHEDULE,
                _branch(P.DIP_BY, 500, _action(P.BUY, 100e6, address(0)))
            ),
            1_000e6,
            0
        );
        bytes32 fallWf = keccak256("vault guard prev fall");
        P.Program memory fallProg = _program(
            P.UNICHAIN_MAINNET,
            P.BASE_MAINNET,
            P.PRICE,
            _branch(P.PRICE_FALLS_THROUGH, 2_100e18, _action(P.SEND, 10e6, RECIPIENT))
        );
        fallProg.once = true;
        _enable(fallWf, unichainVault, fallProg, 100e6, 0);

        bytes32 riseWf = keccak256("vault guard prev rise");
        P.Program memory riseProg = _program(
            P.UNICHAIN_MAINNET,
            P.BASE_MAINNET,
            P.PRICE,
            _branch(P.PRICE_RISES_THROUGH, 1_900e18, _action(P.SEND, 10e6, RECIPIENT))
        );
        riseProg.once = true;
        _enable(riseWf, unichainVault, riseProg, 100e6, 0);

        unichainUsdc.mint(address(unichainVault), 1_000e6);

        P.Run memory dipRun = _run(dipWf, 1_101, P.BASE_MAINNET, 2_000e18);
        dipRun.previous = 2_500e18;
        dipRun.observationId = keccak256("cross block spike dip");
        assertEq(
            _deliverAndExpectReason(
                unichainVault,
                dipWf,
                dipRun,
                unichainVault.FAILED(),
                abi.encodeWithSelector(
                    WorkflowProtocolsV2.OraclePriceDeviation.selector, 2_500e18, 2_000e18
                )
            ),
            unichainVault.FAILED()
        );

        P.Run memory fallRun = _run(fallWf, 1_102, P.BASE_MAINNET, 2_000e18);
        fallRun.previous = 2_500e18;
        assertEq(
            _deliverAndExpectReason(
                unichainVault,
                fallWf,
                fallRun,
                unichainVault.FAILED(),
                abi.encodeWithSelector(
                    WorkflowProtocolsV2.OraclePriceDeviation.selector, 2_500e18, 2_000e18
                )
            ),
            unichainVault.FAILED()
        );

        P.Run memory riseRun = _run(riseWf, 1_103, P.BASE_MAINNET, 2_000e18);
        riseRun.previous = 1_500e18;
        assertEq(
            _deliverAndExpectReason(
                unichainVault,
                riseWf,
                riseRun,
                unichainVault.FAILED(),
                abi.encodeWithSelector(
                    WorkflowProtocolsV2.OraclePriceDeviation.selector, 1_500e18, 2_000e18
                )
            ),
            unichainVault.FAILED()
        );

        assertEq(unichainRouter.swapCount(), 0);
        assertEq(unichainUsdc.balanceOf(RECIPIENT), 0);
        (,,, bool fallActive) = unichainVault.authorizations(fallWf);
        (,,, bool riseActive) = unichainVault.authorizations(riseWf);
        assertTrue(fallActive);
        assertTrue(riseActive);
    }

    function testSingleBlockFlashLoanOrWickDoesNotPoisonAgentHighsForTrailingRecovery() public {
        bytes32 trailWf = keccak256("agent high wick guard");
        P.Program memory prog = _program(
            P.UNICHAIN_MAINNET,
            P.UNICHAIN_MAINNET,
            P.PRICE,
            _branch(P.TRAILING, 500, _action(P.SEND, 10e6, RECIPIENT))
        );
        prog.once = true;
        _enable(trailWf, unichainVault, prog, 100e6, 0);
        unichainUsdc.mint(address(unichainVault), 100e6);

        // Block 10: baseline $2,000.
        vm.prank(address(system));
        agent.react(_uniSwapLog(10, 0, _sqrtPriceFor(2_000e18)));
        // Block 11: intra-block flash-loan spike to $10,000 then back to $2,000.
        vm.prank(address(system));
        agent.react(_uniSwapLog(11, 1, _sqrtPriceFor(10_000e18)));
        vm.prank(address(system));
        agent.react(_uniSwapLog(11, 2, _sqrtPriceFor(2_000e18)));
        // Block 12: 1-block cross-block spike wick to $10,000.
        vm.prank(address(system));
        agent.react(_uniSwapLog(12, 0, _sqrtPriceFor(10_000e18)));
        // Block 13: returns to $2,000 -> spikeWick suppresses $10,000 from highs[workflow].
        vm.prank(address(system));
        agent.react(_uniSwapLog(13, 0, _sqrtPriceFor(2_000e18)));

        // Block 14-16: legitimate rise to $2,060 (held >=2 blocks / closes block 14) then drop to $1,940.
        vm.prank(address(system));
        agent.react(_uniSwapLog(14, 0, _sqrtPriceFor(2_060e18)));
        uint256 peakReqIdx = system.requestCount();
        assertEq(peakReqIdx, 0, "spike and rise blocks emit zero wasted callbacks");
        vm.prank(address(system));
        agent.react(_uniSwapLog(15, 0, _sqrtPriceFor(1_940e18)));
        assertEq(system.requestCount(), 1, "drawdown dispatches once");

        CallbackConfiguration memory req = system.requestAt(peakReqIdx);
        (,, P.Run memory decoded) = abi.decode(_slice(req.payload, 4), (address, bytes32, P.Run));
        assertApproxEqRel(decoded.high, 2_060e18, 0.001e18);
        assertEq(decoded.highBlock, 14);

        // Out-of-order delivery (delivering drop directly without delivering peak callback first) still triggers TRAILING.
        uniEthUsd.setAnswer(1_970e18);
        unichainPair.setPrice(_sqrtPriceFor(1_940e18), V3_LIQUIDITY);
        _deliverRequest(peakReqIdx, address(unichainVault));
        assertEq(unichainUsdc.balanceOf(RECIPIENT), 10e6);
    }

    function testWorstCaseThreeActionPriceLeafCachesOracleAndAvoidsRedundantExternalCalls() public {
        bytes32 leafWf = keccak256("cached oracle 3 action leaf");
        P.Node[] memory nodes = new P.Node[](5);
        nodes[0] = P.Node(P.PRICE_FALLS_THROUGH, 1, 3, 2_010e18, 0, new P.Action[](0));
        nodes[1] = P.Node(P.TRAILING, 2, 4, 500, 0, new P.Action[](0));
        nodes[2].actions = new P.Action[](3);
        nodes[2].actions[0] = _action(P.BUY, 100e6, address(0));
        nodes[2].actions[1] = _action(P.SEND, 10e6, RECIPIENT);
        nodes[2].actions[2] = _action(P.SEND, 10e6, OWNER);
        _enable(
            leafWf,
            unichainVault,
            _program(P.UNICHAIN_MAINNET, P.UNICHAIN_MAINNET, P.PRICE, nodes),
            500e6,
            0
        );
        unichainUsdc.mint(address(unichainVault), 500e6);

        // Seed peak at $2,060.
        unichainPair.setPrice(_sqrtPriceFor(2_060e18), V3_LIQUIDITY);
        assertEq(
            _deliver(unichainVault, leafWf, _run(leafWf, 1_201, P.UNICHAIN_MAINNET, 2_060e18)),
            unichainVault.SKIPPED()
        );

        // Drop to $1,940 (within 5% of $2,000 oracle, >=5% below $2,060 peak, falls through $2,010).
        unichainPair.setPrice(_sqrtPriceFor(1_940e18), V3_LIQUIDITY);
        P.Run memory run = _run(leafWf, 1_202, P.UNICHAIN_MAINNET, 1_940e18);
        run.previous = 2_060e18;
        run.high = 2_060e18;
        run.highBlock = uint64(block.number);

        vm.expectCall(address(uniEthUsd), abi.encodeCall(IAggregatorV3.latestRoundData, ()), 1);
        vm.expectCall(address(uniUsdcUsd), abi.encodeCall(IAggregatorV3.latestRoundData, ()), 1);
        vm.expectCall(address(uniSequencer), abi.encodeCall(IAggregatorV3.latestRoundData, ()), 1);
        vm.expectCall(address(uniEthUsd), abi.encodeCall(IAggregatorV3.decimals, ()), 0);
        vm.expectCall(address(uniUsdcUsd), abi.encodeCall(IAggregatorV3.decimals, ()), 0);
        vm.expectCall(address(unichainRouter), abi.encodeCall(IV3SwapRouter.factory, ()), 0);

        uint256 before = gasleft();
        vm.prank(PROXY);
        unichainVault.execute(address(agent), leafWf, run);
        uint256 used = before - gasleft();
        assertEq(unichainVault.outcomes(_runId(leafWf, run)), unichainVault.CONFIRMED());
        assertEq(unichainRouter.swapCount(), 1);
        assertEq(unichainUsdc.balanceOf(RECIPIENT), 10e6);
        assertLt(used, 850_000);
    }

    function testAutomatedVaultRefillDoesNotResetInactivityTimer() public {
        bytes32 inactWf = keccak256("refill vs inactivity");
        P.Program memory inactProg = _program(
            P.UNICHAIN_MAINNET,
            P.UNICHAIN_MAINNET,
            P.SCHEDULE,
            _branch(P.INACTIVITY, 1 days, _action(P.INACTIVITY_PAYOUT, 10e6, RECIPIENT))
        );
        inactProg.once = true;
        _enable(inactWf, unichainVault, inactProg, 100e6, 0);
        unichainUsdc.mint(address(unichainVault), 100e6);

        uint256 start = vm.getBlockTimestamp();
        vm.warp(start + 12 hours);

        // Automated REFILL emits Transfer(OWNER, unichainVault, 100e6) -> must NOT reset lastActivity.
        IReactive.LogRecord memory refillTransfer;
        refillTransfer.chain_id = P.UNICHAIN_MAINNET;
        refillTransfer._contract = ChainConfig.unichainMainnet().usdc;
        refillTransfer.topic_0 = TRANSFER;
        refillTransfer.topic_1 = uint160(OWNER);
        refillTransfer.topic_2 = uint160(address(unichainVault));
        refillTransfer.block_number = 500;
        refillTransfer.tx_hash = 500;
        refillTransfer.data = abi.encode(100e6);
        vm.prank(address(system));
        agent.react(refillTransfer);

        vm.warp(start + 1 days + 1 minutes);
        IReactive.LogRecord memory cronLog;
        cronLog.chain_id = ChainConfig.REACTIVE_MAINNET;
        cronLog._contract = ChainConfig.reactiveMainnet().cronSource;
        cronLog.topic_0 = CRON;
        cronLog.topic_1 = block.number + 1;
        cronLog.block_number = block.number + 1;
        cronLog.tx_hash = 501;
        vm.prank(address(system));
        agent.react(cronLog);
        assertEq(system.requestCount(), 1);
        _deliverRequest(0, address(unichainVault));
        CallbackConfiguration memory req = system.requestAt(0);
        (,, P.Run memory decoded) = abi.decode(_slice(req.payload, 4), (address, bytes32, P.Run));
        assertEq(decoded.activityTime, 0);
        assertEq(unichainVault.outcomes(_runId(inactWf, decoded)), unichainVault.IN_GRACE_PERIOD());

        // Real user Transfer(OWNER, RECIPIENT, 1e6) DOES reset lastActivity.
        IReactive.LogRecord memory userTransfer = refillTransfer;
        userTransfer.topic_2 = uint160(RECIPIENT);
        userTransfer.block_number = 502;
        userTransfer.tx_hash = 502;
        userTransfer.data = abi.encode(1e6);
        vm.prank(address(system));
        agent.react(userTransfer);

        vm.warp(vm.getBlockTimestamp() + 1 hours + 1);
        cronLog.topic_1 = block.number + 2;
        cronLog.block_number = block.number + 2;
        cronLog.tx_hash = 503;
        vm.prank(address(system));
        agent.react(cronLog);
        _deliverRequest(1, address(unichainVault));
        CallbackConfiguration memory req2 = system.requestAt(1);
        (,, P.Run memory decoded2) = abi.decode(_slice(req2.payload, 4), (address, bytes32, P.Run));
        assertGt(decoded2.activityTime, 0);
        assertEq(unichainVault.outcomes(_runId(inactWf, decoded2)), unichainVault.SKIPPED());
    }

    function testStaleCrossChainDipObservationSkipsCleanlyDespiteOracleDivergence() public {
        bytes32 dipWf = keccak256("stale cross dip");
        _enable(
            dipWf,
            unichainVault,
            _program(
                P.UNICHAIN_MAINNET,
                P.BASE_MAINNET,
                P.SCHEDULE,
                _branch(P.DIP_BY, 500, _action(P.BUY, 100e6, address(0)))
            ),
            1_000e6,
            0
        );
        unichainUsdc.mint(address(unichainVault), 1_000e6);

        uint256 oldTime = vm.getBlockTimestamp();
        vm.warp(oldTime + 2 hours);
        uniEthUsd.setAnswer(2_000e18);
        uniUsdcUsd.setAnswer(1e18);

        P.Run memory staleDip = _run(dipWf, 1_301, P.BASE_MAINNET, 1_800e18);
        staleDip.previous = 2_000e18;
        staleDip.observationTime = uint64(oldTime);
        staleDip.observationId = keccak256("stale dip obs");

        vm.expectEmit(true, true, false, true, address(unichainVault));
        emit WorkflowVaultV2.Outcome(
            dipWf, _runId(dipWf, staleDip), 1, unichainVault.SKIPPED(), 2, bytes4(0)
        );
        assertEq(_deliver(unichainVault, dipWf, staleDip), unichainVault.SKIPPED());
        assertEq(unichainRouter.swapCount(), 0);
    }

    function _uniSwapLog(uint64 blockNum, uint64 logIdx, uint160 sqrtPriceX96)
        private
        pure
        returns (IReactive.LogRecord memory swap)
    {
        swap.chain_id = P.UNICHAIN_MAINNET;
        swap._contract = ChainConfig.unichainMainnet().pair;
        swap.topic_0 = SWAP_V3;
        swap.block_number = blockNum;
        swap.log_index = logIdx;
        swap.tx_hash = uint256(blockNum) * 100 + logIdx;
        swap.data = abi.encode(
            int256(1_000e6),
            int256(-0.5 ether),
            uint256(sqrtPriceX96),
            uint256(V3_LIQUIDITY),
            int24(0)
        );
    }

    function testCrossChainTransferWithPriceCheckUsesDestinationPriceNotTransferAmount() public {
        // 1. 6-decimal USDC transfer + AMOUNT_ABOVE + PRICE_AT_LEAST + BUY.
        bytes32 xferBuyWf = keccak256("cross transfer price buy");
        P.Node[] memory buyNodes = new P.Node[](5);
        buyNodes[0] = P.Node(P.AMOUNT_ABOVE, 1, 4, 100e6, 0, new P.Action[](0));
        buyNodes[1] = P.Node(P.PRICE_AT_LEAST, 2, 3, 1_950e18, 0, new P.Action[](0));
        buyNodes[2].actions = new P.Action[](1);
        buyNodes[2].actions[0] = _action(P.BUY, 200e6, address(0));
        P.Program memory xferBuyProg =
            _program(P.UNICHAIN_MAINNET, P.BASE_MAINNET, P.TRANSFER, buyNodes);
        xferBuyProg.source = address(baseUsdc);
        xferBuyProg.subject = RECIPIENT;
        _enable(xferBuyWf, unichainVault, xferBuyProg, 1_000e6, 0);
        unichainUsdc.mint(address(unichainVault), 1_000e6);

        IReactive.LogRecord memory xferLog;
        xferLog.chain_id = P.BASE_MAINNET;
        xferLog._contract = address(baseUsdc);
        xferLog.topic_0 = TRANSFER;
        xferLog.topic_1 = uint160(OWNER);
        xferLog.topic_2 = uint160(RECIPIENT);
        xferLog.block_number = 1_001;
        xferLog.tx_hash = 1_001;
        xferLog.data = abi.encode(500e6);
        vm.prank(address(system));
        agent.react(xferLog);
        assertEq(system.requestCount(), 1);
        _deliverRequest(0, address(unichainVault));
        assertEq(
            unichainVault.outcomes(
                _runId(xferBuyWf, _run(xferBuyWf, 1_001, P.BASE_MAINNET, 500e6))
            ),
            unichainVault.CONFIRMED()
        );
        assertEq(unichainRouter.swapCount(), 1);

        // 2. 18-decimal token transfer near oracle price must NOT misroute PRICE_BELOW.
        bytes32 xferBelowWf = keccak256("cross transfer price below");
        P.Program memory xferBelowProg = _program(
            P.UNICHAIN_MAINNET,
            P.BASE_MAINNET,
            P.TRANSFER,
            _branch(P.PRICE_BELOW, 1_950e18, _action(P.SEND, 50e6, RECIPIENT))
        );
        xferBelowProg.source = address(baseWeth);
        xferBelowProg.subject = RECIPIENT;
        _enable(xferBelowWf, unichainVault, xferBelowProg, 500e6, 0);
        unichainUsdc.mint(address(unichainVault), 500e6);

        assertEq(
            _deliver(
                unichainVault, xferBelowWf, _run(xferBelowWf, 1_002, P.BASE_MAINNET, 1_940 ether)
            ),
            unichainVault.SKIPPED()
        );
        assertEq(unichainUsdc.balanceOf(RECIPIENT), 0);

        // 3. Large 18-decimal transfer amount still confirms when live destination price is below threshold.
        uniEthUsd.setAnswer(1_900e18);
        unichainPair.setPrice(_sqrtPriceFor(1_900e18), V3_LIQUIDITY);
        assertEq(
            _deliver(
                unichainVault, xferBelowWf, _run(xferBelowWf, 1_003, P.BASE_MAINNET, 2_050 ether)
            ),
            unichainVault.CONFIRMED()
        );
        assertEq(unichainUsdc.balanceOf(RECIPIENT), 50e6);

        // 4. Destination spot manipulation is still blocked by _price() oracle guard.
        uniEthUsd.setAnswer(2_000e18);
        uint160 manipSqrt = _sqrtPriceFor(1_500e18);
        uint256 manipSpot = PriceMath.usdcPerWethFromSqrtPriceX96(manipSqrt, true);
        unichainPair.setPrice(manipSqrt, V3_LIQUIDITY);
        assertEq(
            _deliverAndExpectReason(
                unichainVault,
                xferBelowWf,
                _run(xferBelowWf, 1_004, P.BASE_MAINNET, 500 ether),
                unichainVault.FAILED(),
                abi.encodeWithSelector(
                    WorkflowProtocolsV2.OraclePriceDeviation.selector, manipSpot, 2_000e18
                )
            ),
            unichainVault.FAILED()
        );
        assertEq(unichainUsdc.balanceOf(RECIPIENT), 50e6);

        // 5. PRICE_OUTSIDE and PRICE_AT_MOST evaluate against live destination price, not transfer amount.
        unichainPair.setPrice(_sqrtPriceFor(2_000e18), V3_LIQUIDITY);
        bytes32 xferOutsideWf = keccak256("cross transfer price outside");
        P.Node[] memory outNodes =
            _branch(P.PRICE_OUTSIDE, 1_800e18, _action(P.SEND, 25e6, RECIPIENT));
        outNodes[0].upper = 2_200e18;
        P.Program memory xferOutsideProg =
            _program(P.UNICHAIN_MAINNET, P.BASE_MAINNET, P.TRANSFER, outNodes);
        xferOutsideProg.source = address(baseUsdc);
        xferOutsideProg.subject = RECIPIENT;
        _enable(xferOutsideWf, unichainVault, xferOutsideProg, 500e6, 0);

        assertEq(
            _deliver(
                unichainVault, xferOutsideWf, _run(xferOutsideWf, 1_005, P.BASE_MAINNET, 500e6)
            ),
            unichainVault.SKIPPED()
        );
        assertEq(unichainUsdc.balanceOf(RECIPIENT), 50e6);

        uniEthUsd.setAnswer(2_300e18);
        unichainPair.setPrice(_sqrtPriceFor(2_300e18), V3_LIQUIDITY);
        assertEq(
            _deliver(
                unichainVault,
                xferOutsideWf,
                _run(xferOutsideWf, 1_006, P.BASE_MAINNET, 2_000 ether)
            ),
            unichainVault.CONFIRMED()
        );
        assertEq(unichainUsdc.balanceOf(RECIPIENT), 75e6);

        bytes32 xferAtMostWf = keccak256("cross transfer price at most");
        P.Program memory xferAtMostProg = _program(
            P.UNICHAIN_MAINNET,
            P.BASE_MAINNET,
            P.TRANSFER,
            _branch(P.PRICE_AT_MOST, 2_100e18, _action(P.SEND, 10e6, RECIPIENT))
        );
        xferAtMostProg.source = address(baseUsdc);
        xferAtMostProg.subject = RECIPIENT;
        _enable(xferAtMostWf, unichainVault, xferAtMostProg, 500e6, 0);

        assertEq(
            _deliver(unichainVault, xferAtMostWf, _run(xferAtMostWf, 1_007, P.BASE_MAINNET, 100e6)),
            unichainVault.SKIPPED()
        );
        uniEthUsd.setAnswer(2_050e18);
        unichainPair.setPrice(_sqrtPriceFor(2_050e18), V3_LIQUIDITY);
        assertEq(
            _deliver(
                unichainVault, xferAtMostWf, _run(xferAtMostWf, 1_008, P.BASE_MAINNET, 3_000 ether)
            ),
            unichainVault.CONFIRMED()
        );
        assertEq(unichainUsdc.balanceOf(RECIPIENT), 85e6);
    }

    function _sqrtPriceFor(uint256 usdcPerWeth) private pure returns (uint160) {
        uint256 root = Math.sqrt(Math.mulDiv(1e30, 1e18, usdcPerWeth));
        return uint160(((uint256(1) << 96) * root) / 1e9);
    }

    function _enable(
        bytes32 id,
        WorkflowVaultV2 targetVault,
        P.Program memory program,
        uint96 usdcLimit,
        uint96 wethLimit
    ) private {
        bytes memory encoded = abi.encode(program);
        vm.startPrank(OWNER);
        targetVault.authorizeWithWeeklyBudget(id, 1, encoded, "Mainnet", usdcLimit, wethLimit);
        agent.enable(id, 1, encoded, "Mainnet", uint64(block.number));
        vm.stopPrank();
    }

    function _deliver(WorkflowVaultV2 targetVault, bytes32 id, P.Run memory run)
        private
        returns (uint8)
    {
        vm.prank(PROXY);
        targetVault.execute(address(agent), id, run);
        return targetVault.outcomes(_runId(id, run));
    }

    function _deliverAndExpectReason(
        WorkflowVaultV2 targetVault,
        bytes32 id,
        P.Run memory run,
        uint8 expectedStatus,
        bytes memory encodedRevert
    ) private returns (uint8) {
        bytes4 selector = bytes4(encodedRevert);
        vm.expectEmit(true, true, false, true, address(targetVault));
        emit WorkflowVaultV2.Outcome(
            id, _runId(id, run), run.epoch, expectedStatus, type(uint8).max, selector
        );
        return _deliver(targetVault, id, run);
    }

    function _deliverRequest(uint256 index, address targetVault) private {
        CallbackConfiguration memory request = system.requestAt(index);
        bytes memory payload = request.payload;
        address sender = address(agent);
        assembly ("memory-safe") {
            mstore(add(payload, 36), sender)
        }
        vm.prank(PROXY);
        (bool success,) = targetVault.call{gas: request.gasLimit}(payload);
        assertTrue(success);
    }

    function _forwardBudget(uint32 chain, address emitter, bytes32 workflow) private {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 index; index < logs.length; ++index) {
            if (logs[index].emitter != emitter || logs[index].topics[0] != bytes32(BUDGET_SYNCED)) {
                continue;
            }
            IReactive.LogRecord memory log;
            log.chain_id = chain;
            log._contract = emitter;
            log.topic_0 = BUDGET_SYNCED;
            log.topic_1 = uint256(workflow);
            log.data = logs[index].data;
            log.block_number = block.number;
            log.tx_hash = index + 1;
            log.log_index = index;
            vm.prank(address(system));
            agent.react(log);
        }
    }

    function _run(bytes32 workflow, uint256 txId, uint32 originChain, uint256 observed)
        private
        view
        returns (P.Run memory run)
    {
        (bytes32 programHash,,,,,,,,,,,,,,) = agent.entries(workflow);
        run.epoch = 1;
        run.programHash = programHash;
        run.originChain = originChain;
        run.originTransaction = bytes32(txId);
        run.originBlock = uint64(txId);
        run.expiresAt = uint64(block.timestamp + 10 minutes);
        run.observed = observed;
        run.observationTime = uint64(block.timestamp);
    }

    function _runId(bytes32 id, P.Run memory run) private view returns (bytes32) {
        return keccak256(
            abi.encode(
                address(agent), id, run.originChain, run.originTransaction, run.originLogIndex
            )
        );
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

    function _slice(bytes memory data, uint256 start) private pure returns (bytes memory result) {
        result = new bytes(data.length - start);
        for (uint256 i; i < result.length; ++i) {
            result[i] = data[start + i];
        }
    }
}
