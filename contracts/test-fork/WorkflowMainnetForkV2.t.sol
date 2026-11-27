// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ChainConfig} from "../src/chain/ChainConfig.sol";
import {PriceMath} from "../src/libraries/PriceMath.sol";
import {IUniswapV2Pair} from "../src/shared/UniswapV2.sol";
import {IUniswapV3Pool} from "../src/shared/UniswapV3.sol";
import {WorkflowProgramV2 as P} from "../src/workflow/v2/WorkflowProgramV2.sol";
import {WorkflowProgramValidatorV2} from "../src/workflow/v2/WorkflowProgramValidatorV2.sol";
import {WorkflowProtocolsV2} from "../src/workflow/v2/WorkflowProtocolsV2.sol";
import {WorkflowVaultFactoryV2} from "../src/workflow/v2/WorkflowVaultFactoryV2.sol";
import {WorkflowVaultV2} from "../src/workflow/v2/WorkflowVaultV2.sol";

contract WorkflowMainnetForkV2Test is Test {
    address private constant OWNER = address(0xA11CE);
    address private constant AGENT = address(0xA9E7);
    address private immutable RECIPIENT_A = makeAddr("forkRecipientA");
    address private immutable RECIPIENT_B = makeAddr("forkRecipientB");
    uint64 private constant CALLBACK_GAS = 1_200_000;

    function testUnichainMainnetForkWorstCaseThreeActionPriceLeafFitsCallbackGas() public {
        vm.createSelectFork("https://mainnet.unichain.org");
        ChainConfig.Config memory cfg = ChainConfig.unichainMainnet();
        WorkflowProgramValidatorV2 validator = new WorkflowProgramValidatorV2();
        WorkflowVaultV2 impl = new WorkflowVaultV2(
            cfg.callbackProxy,
            address(0),
            address(0),
            uint32(cfg.chainId),
            _market(cfg),
            validator
        );
        WorkflowVaultFactoryV2 factory = new WorkflowVaultFactoryV2(validator, address(impl));
        vm.prank(OWNER);
        WorkflowVaultV2 vault = WorkflowVaultV2(payable(factory.create(AGENT)));

        IUniswapV3Pool pool = IUniswapV3Pool(cfg.pair);
        (uint160 sqrtPriceX96,,,,,,) = pool.slot0();
        uint256 spot =
            PriceMath.usdcPerWethFromSqrtPriceX96(sqrtPriceX96, pool.token0() == cfg.usdc);
        assertGt(spot, 0);

        P.Node[] memory nodes = _worstCaseNodes(spot);
        P.Program memory prog = P.Program({
            version: 2,
            chain: P.UNICHAIN_MAINNET,
            originChain: P.UNICHAIN_MAINNET,
            trigger: P.PRICE,
            interval: 0,
            expires: 0,
            source: address(0),
            subject: address(0),
            usdcCap: 12e6,
            wethCap: 0,
            slippage: 500,
            once: true,
            nodes: nodes
        });
        bytes memory encoded = abi.encode(prog);
        bytes32 wf = keccak256("unichain fork 3 action");
        vm.prank(OWNER);
        vault.authorizeWithWeeklyBudget(wf, 1, encoded, "Uni Fork", 50e6, 0);

        deal(cfg.usdc, address(vault), 20e6);

        P.Run memory run = P.Run({
            epoch: 1,
            programHash: keccak256(encoded),
            originChain: P.UNICHAIN_MAINNET,
            originTransaction: bytes32(uint256(1)),
            originLogIndex: 0,
            originBlock: uint64(block.number + 1),
            expiresAt: uint64(block.timestamp + 10 minutes),
            observed: spot,
            previous: uint128(spot + 1e18),
            high: uint128(spot + 1e18),
            highBlock: uint64(block.number + 1),
            observationTime: uint64(block.timestamp),
            activityTime: 0,
            observationId: bytes32(0),
            actor: address(0)
        });

        uint256 before = gasleft();
        vm.prank(cfg.callbackProxy);
        vault.execute{gas: CALLBACK_GAS}(AGENT, wf, run);
        uint256 used = before - gasleft();
        emit log_named_uint("Unichain Mainnet fork 3-action PRICE leaf gas", used);

        bytes32 runId = keccak256(
            abi.encode(AGENT, wf, run.originChain, run.originTransaction, run.originLogIndex)
        );
        assertEq(vault.outcomes(runId), vault.CONFIRMED());
        assertGt(IERC20(cfg.weth).balanceOf(address(vault)), 0);
        assertEq(IERC20(cfg.usdc).balanceOf(RECIPIENT_A), 1e6);
        assertEq(IERC20(cfg.usdc).balanceOf(RECIPIENT_B), 1e6);
        assertLt(used, CALLBACK_GAS);
    }

    function testBaseMainnetForkWorstCaseThreeActionPriceLeafFitsCallbackGas() public {
        vm.createSelectFork("https://mainnet.base.org");
        ChainConfig.Config memory cfg = ChainConfig.baseMainnet();
        WorkflowProgramValidatorV2 validator = new WorkflowProgramValidatorV2();
        WorkflowVaultV2 impl = new WorkflowVaultV2(
            cfg.callbackProxy,
            address(0),
            address(0),
            uint32(cfg.chainId),
            _market(cfg),
            validator
        );
        WorkflowVaultFactoryV2 factory = new WorkflowVaultFactoryV2(validator, address(impl));
        vm.prank(OWNER);
        WorkflowVaultV2 vault = WorkflowVaultV2(payable(factory.create(AGENT)));

        IUniswapV2Pair pair = IUniswapV2Pair(cfg.pair);
        (uint112 r0, uint112 r1,) = pair.getReserves();
        uint256 spot = pair.token0() == cfg.usdc
            ? PriceMath.usdcPerWeth(r0, r1)
            : PriceMath.usdcPerWeth(r1, r0);
        assertGt(spot, 0);

        P.Node[] memory nodes = _worstCaseNodes(spot);
        P.Program memory prog = P.Program({
            version: 2,
            chain: P.BASE_MAINNET,
            originChain: P.BASE_MAINNET,
            trigger: P.PRICE,
            interval: 0,
            expires: 0,
            source: address(0),
            subject: address(0),
            usdcCap: 12e6,
            wethCap: 0,
            slippage: 500,
            once: true,
            nodes: nodes
        });
        bytes memory encoded = abi.encode(prog);
        bytes32 wf = keccak256("base fork 3 action");
        vm.prank(OWNER);
        vault.authorizeWithWeeklyBudget(wf, 1, encoded, "Base Fork", 50e6, 0);

        deal(cfg.usdc, address(vault), 20e6);

        P.Run memory run = P.Run({
            epoch: 1,
            programHash: keccak256(encoded),
            originChain: P.BASE_MAINNET,
            originTransaction: bytes32(uint256(1)),
            originLogIndex: 0,
            originBlock: uint64(block.number + 1),
            expiresAt: uint64(block.timestamp + 10 minutes),
            observed: spot,
            previous: uint128(spot + 1e18),
            high: uint128((spot * 105) / 100),
            highBlock: uint64(block.number + 1),
            observationTime: uint64(block.timestamp),
            activityTime: 0,
            observationId: bytes32(0),
            actor: address(0)
        });

        uint256 before = gasleft();
        vm.prank(cfg.callbackProxy);
        vault.execute{gas: CALLBACK_GAS}(AGENT, wf, run);
        uint256 used = before - gasleft();
        emit log_named_uint("Base Mainnet fork 3-action PRICE leaf gas", used);

        bytes32 runId = keccak256(
            abi.encode(AGENT, wf, run.originChain, run.originTransaction, run.originLogIndex)
        );
        assertEq(vault.outcomes(runId), vault.CONFIRMED());
        assertGt(IERC20(cfg.weth).balanceOf(address(vault)), 0);
        assertEq(IERC20(cfg.usdc).balanceOf(RECIPIENT_A), 1e6);
        assertEq(IERC20(cfg.usdc).balanceOf(RECIPIENT_B), 1e6);
        assertLt(used, CALLBACK_GAS);
    }

    function _market(ChainConfig.Config memory cfg)
        private
        pure
        returns (WorkflowProtocolsV2.Networks memory)
    {
        return WorkflowProtocolsV2.Networks(
            cfg.usdc,
            cfg.weth,
            cfg.router,
            cfg.pair,
            cfg.poolFee,
            cfg.ethUsdFeed,
            cfg.usdcUsdFeed,
            cfg.sequencerFeed,
            cfg.ethFeedMaxAge,
            cfg.usdcFeedMaxAge
        );
    }

    function _worstCaseNodes(uint256 spot) private view returns (P.Node[] memory nodes) {
        nodes = new P.Node[](7);
        nodes[0] = P.Node(P.PRICE_AT_LEAST, 1, 4, 1, 0, new P.Action[](0));
        nodes[1] = P.Node(P.PRICE_FALLS_THROUGH, 2, 5, uint128(spot + 1e18), 0, new P.Action[](0));
        nodes[2] = P.Node(P.PRICE_BELOW, 3, 6, uint128(spot * 2), 0, new P.Action[](0));
        nodes[3].actions = new P.Action[](3);
        nodes[3].actions[0] = P.Action(P.BUY, P.FIXED, 10e6, address(0));
        nodes[3].actions[1] = P.Action(P.SEND, P.FIXED, 1e6, RECIPIENT_A);
        nodes[3].actions[2] = P.Action(P.SEND, P.FIXED, 1e6, RECIPIENT_B);
    }
}
