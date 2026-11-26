// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {PriceMath} from "../../libraries/PriceMath.sol";
import {IAggregatorV3} from "../../shared/Chainlink.sol";
import {IUniswapV2Factory, IUniswapV2Pair, IUniswapV2Router02} from "../../shared/UniswapV2.sol";
import {IUniswapV3Factory, IUniswapV3Pool, IV3SwapRouter} from "../../shared/UniswapV3.sol";

/// @notice Settlement-chain reads and protocol calls. External money destinations are pinned at deployment.
abstract contract WorkflowProtocolsV2 {
    using SafeERC20 for IERC20;

    uint64 public constant SEQUENCER_GRACE_PERIOD = 1 hours;
    uint16 public constant MAX_PRICE_DEVIATION_BPS = 500;

    struct Networks {
        address usdc;
        address weth;
        address router;
        address pair;
        uint24 poolFee;
        address ethUsdFeed;
        address usdcUsdFeed;
        address sequencerFeed;
        uint32 ethFeedMaxAge;
        uint32 usdcFeedMaxAge;
    }

    error InvalidMarket();
    error NoLongerEligible();
    error OracleUnavailable();
    error SequencerUnavailable();
    error OraclePriceDeviation(uint256 observed, uint256 oracle);
    error SlippageExceeded(uint256 minOut, uint256 actual);

    address public immutable usdc;
    address public immutable weth;
    address public immutable router;
    address public immutable pair;
    uint24 public immutable poolFee;
    address public immutable ethUsdFeed;
    address public immutable usdcUsdFeed;
    address public immutable sequencerFeed;
    uint32 public immutable ethFeedMaxAge;
    uint32 public immutable usdcFeedMaxAge;

    constructor(Networks memory cfg) {
        if (
            cfg.usdc == address(0) || cfg.poolFee >= PriceMath.FEE_PPM_DENOMINATOR
                || (cfg.ethUsdFeed != address(0) && cfg.ethFeedMaxAge == 0)
                || (cfg.usdcUsdFeed != address(0)
                    && (cfg.ethUsdFeed == address(0) || cfg.usdcFeedMaxAge == 0))
                || (cfg.sequencerFeed != address(0) && cfg.ethUsdFeed == address(0))
        ) revert InvalidMarket();
        usdc = cfg.usdc;
        weth = cfg.weth;
        router = cfg.router;
        pair = cfg.pair;
        poolFee = cfg.poolFee;
        ethUsdFeed = cfg.ethUsdFeed;
        usdcUsdFeed = cfg.usdcUsdFeed;
        sequencerFeed = cfg.sequencerFeed;
        ethFeedMaxAge = cfg.ethFeedMaxAge;
        usdcFeedMaxAge = cfg.usdcFeedMaxAge;
    }

    /// @notice External oracle USDC-per-WETH price (1e18), or 0 when no feed is configured.
    function oraclePrice() external view returns (uint256) {
        if (ethUsdFeed == address(0)) return 0;
        return _oraclePrice();
    }

    function _reserves() internal view returns (uint112 stable, uint112 wrapped) {
        if (pair == address(0)) revert InvalidMarket();
        IUniswapV2Pair pool = IUniswapV2Pair(pair);
        (uint112 first, uint112 second,) = pool.getReserves();
        return pool.token0() == usdc ? (first, second) : (second, first);
    }

    function _v3SpotPrice() internal view returns (uint256) {
        if (pair == address(0)) revert InvalidMarket();
        IUniswapV3Pool pool = IUniswapV3Pool(pair);
        (uint160 sqrtPriceX96,,,,,,) = pool.slot0();
        uint128 liq = pool.liquidity();
        address t0 = pool.token0();
        address t1 = pool.token1();
        bool usdcIsToken0 = t0 == usdc;
        bool validTokens = (usdcIsToken0 && t1 == weth) || (t0 == weth && t1 == usdc);
        if (
            !validTokens || liq == 0 || sqrtPriceX96 < PriceMath.MIN_SQRT_RATIO
                || sqrtPriceX96 >= PriceMath.MAX_SQRT_RATIO
        ) revert InvalidMarket();
        uint256 spot = PriceMath.usdcPerWethFromSqrtPriceX96(sqrtPriceX96, usdcIsToken0);
        if (spot == 0) revert InvalidMarket();
        return spot;
    }

    function _isOracleConsistent(uint256 observed) internal view returns (bool) {
        if (ethUsdFeed == address(0)) return true;
        return !PriceMath.movedBy(observed, _oraclePrice(), MAX_PRICE_DEVIATION_BPS);
    }

    function _guardOraclePrice(uint256 observed) internal view {
        if (ethUsdFeed == address(0)) return;
        uint256 externalPrice = _oraclePrice();
        if (PriceMath.movedBy(observed, externalPrice, MAX_PRICE_DEVIATION_BPS)) {
            revert OraclePriceDeviation(observed, externalPrice);
        }
    }

    function _price() internal view returns (uint256) {
        uint256 spot;
        if (poolFee == 0) {
            (uint112 stable, uint112 wrapped) = _reserves();
            if (stable == 0 || wrapped == 0) revert InvalidMarket();
            spot = PriceMath.usdcPerWeth(stable, wrapped);
        } else {
            spot = _v3SpotPrice();
        }
        _guardOraclePrice(spot);
        return spot;
    }

    function _oraclePrice() internal view returns (uint256) {
        if (sequencerFeed != address(0)) _requireSequencerUp();
        uint256 ethUsd = _readFeed(ethUsdFeed, ethFeedMaxAge);
        if (usdcUsdFeed == address(0)) return ethUsd;
        uint256 usdcUsd = _readFeed(usdcUsdFeed, usdcFeedMaxAge);
        uint256 price = Math.mulDiv(ethUsd, PriceMath.PRICE_SCALE, usdcUsd);
        if (price == 0) revert OracleUnavailable();
        return price;
    }

    function _requireSequencerUp() private view {
        int256 status;
        uint256 startedAt;
        uint256 updatedAt;
        try IAggregatorV3(sequencerFeed).latestRoundData() returns (
            uint80, int256 answer, uint256 started, uint256 updated, uint80
        ) {
            status = answer;
            startedAt = started;
            updatedAt = updated;
        } catch {
            revert SequencerUnavailable();
        }
        // Sequencer status 0 means up; 1 means down. Only check grace period after startedAt,
        // without imposing a short staleness bound on updatedAt since status feeds update rarely.
        if (
            status != 0 || startedAt == 0 || updatedAt == 0 || block.timestamp < startedAt
                || block.timestamp - startedAt <= SEQUENCER_GRACE_PERIOD
        ) {
            revert SequencerUnavailable();
        }
    }

    function _readFeed(address feed, uint32 maxAge) private view returns (uint256) {
        uint80 roundId;
        int256 answer;
        uint256 updatedAt;
        uint80 answeredInRound;
        try IAggregatorV3(feed).latestRoundData() returns (
            uint80 round, int256 value, uint256, uint256 updated, uint80 answered
        ) {
            roundId = round;
            answer = value;
            updatedAt = updated;
            answeredInRound = answered;
        } catch {
            revert OracleUnavailable();
        }
        if (
            roundId == 0 || answeredInRound < roundId || answer <= 0 || updatedAt == 0
                || updatedAt > block.timestamp || block.timestamp - updatedAt > maxAge
        ) {
            revert OracleUnavailable();
        }
        uint8 feedDecimals;
        try IAggregatorV3(feed).decimals() returns (uint8 dec) {
            feedDecimals = dec;
        } catch {
            revert OracleUnavailable();
        }
        if (feedDecimals > 18) revert InvalidMarket();
        uint256 scale = 10 ** (18 - feedDecimals);
        if (uint256(answer) > type(uint256).max / scale) revert OracleUnavailable();
        return uint256(answer) * scale;
    }

    function _swap(
        bool sell,
        uint256 amount,
        uint16 slippage,
        uint64 expiresAt,
        uint256 referencePrice
    ) internal returns (uint256 received) {
        if (router == address(0) || pair == address(0)) revert InvalidMarket();
        uint24 effectiveFee = poolFee == 0 ? PriceMath.V2_FEE_PPM : poolFee;
        uint256 spotQuote;
        if (poolFee == 0) {
            IUniswapV2Router02 exchange = IUniswapV2Router02(router);
            if (IUniswapV2Factory(exchange.factory()).getPair(usdc, weth) != pair) {
                revert InvalidMarket();
            }
            (uint112 stable, uint112 wrapped) = _reserves();
            spotQuote = sell
                ? PriceMath.expectedOut(amount, wrapped, stable)
                : PriceMath.expectedOut(amount, stable, wrapped);
        } else {
            if (
                IUniswapV3Factory(IV3SwapRouter(router).factory()).getPool(usdc, weth, poolFee)
                    != pair
            ) revert InvalidMarket();
            spotQuote = PriceMath.quotedOut(sell, amount, _v3SpotPrice(), poolFee);
        }
        uint256 floor = PriceMath.applySlippage(spotQuote, slippage);
        if (ethUsdFeed != address(0)) {
            uint256 externalPrice = _oraclePrice();
            uint16 maxDeviation =
                slippage > MAX_PRICE_DEVIATION_BPS ? slippage : MAX_PRICE_DEVIATION_BPS;
            if (
                referencePrice != 0
                    && PriceMath.movedBy(referencePrice, externalPrice, maxDeviation)
            ) {
                revert OraclePriceDeviation(referencePrice, externalPrice);
            }
            uint256 oracleQuote = PriceMath.quotedOut(sell, amount, externalPrice, effectiveFee);
            uint256 oracleFloor = PriceMath.applySlippage(oracleQuote, slippage);
            if (oracleFloor == 0) revert InvalidMarket();
            if (oracleFloor > floor) floor = oracleFloor;
        }
        if (floor == 0) revert InvalidMarket();
        if (spotQuote < floor) revert SlippageExceeded(floor, spotQuote);
        address tokenIn = sell ? weth : usdc;
        address tokenOut = sell ? usdc : weth;
        IERC20 token = IERC20(tokenIn);
        token.forceApprove(router, amount);
        if (poolFee == 0) {
            address[] memory path = new address[](2);
            path[0] = tokenIn;
            path[1] = tokenOut;
            uint256[] memory amounts = IUniswapV2Router02(router)
                .swapExactTokensForTokens(amount, floor, path, address(this), expiresAt);
            received = amounts[1];
        } else {
            received = IV3SwapRouter(router)
                .exactInputSingle(
                    IV3SwapRouter.ExactInputSingleParams({
                        tokenIn: tokenIn,
                        tokenOut: tokenOut,
                        fee: poolFee,
                        recipient: address(this),
                        amountIn: amount,
                        amountOutMinimum: floor,
                        sqrtPriceLimitX96: 0
                    })
                );
        }
        token.forceApprove(router, 0);
        if (received < floor) revert SlippageExceeded(floor, received);
    }
}
