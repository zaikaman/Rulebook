// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {PriceMath} from "../../libraries/PriceMath.sol";
import {IAggregatorV3} from "../../shared/Chainlink.sol";
import {IUniswapV2Factory, IUniswapV2Pair, IUniswapV2Router02} from "../../shared/UniswapV2.sol";
import {IUniswapV3Factory, IV3SwapRouter} from "../../shared/UniswapV3.sol";
import {WorkflowProgramValidatorV2} from "./WorkflowProgramValidatorV2.sol";

/// @notice Settlement-chain reads and protocol calls. External money destinations are pinned at deployment.
abstract contract WorkflowProtocolsV2 {
    using SafeERC20 for IERC20;

    uint64 public constant SEQUENCER_GRACE_PERIOD = 1 hours;
    uint16 public constant MAX_PRICE_DEVIATION_BPS = 500;
    uint16 public constant MAX_PEAK_DEVIATION_BPS = 200;

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

    struct MarketCache {
        uint256 oraclePrice;
        uint256 v3SpotPrice;
        uint256 usdcUsd;
        uint80 ethRoundId;
        bool oracleLoaded;
        bool v3SpotLoaded;
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
    uint256 private immutable ethFeedScale;
    uint256 private immutable usdcFeedScale;
    WorkflowProgramValidatorV2 public immutable validator;
    bool internal immutable marketVerified;
    bool private immutable usdcIsToken0;

    constructor(Networks memory cfg, WorkflowProgramValidatorV2 validator_) {
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
        ethFeedScale = cfg.ethUsdFeed != address(0) ? _feedScale(cfg.ethUsdFeed) : 0;
        usdcFeedScale = cfg.usdcUsdFeed != address(0) ? _feedScale(cfg.usdcUsdFeed) : 0;

        bool verified;
        bool isUsdc0;
        if (
            cfg.router != address(0) && cfg.pair != address(0) && cfg.router.code.length > 0
                && cfg.pair.code.length > 0
        ) {
            address factoryAddr = _staticAddress(
                cfg.router, abi.encodeWithSelector(IUniswapV2Router02.factory.selector)
            );
            address resolved = cfg.poolFee == 0
                ? _staticAddress(
                    factoryAddr, abi.encodeCall(IUniswapV2Factory.getPair, (cfg.usdc, cfg.weth))
                )
                : _staticAddress(
                    factoryAddr,
                    abi.encodeCall(IUniswapV3Factory.getPool, (cfg.usdc, cfg.weth, cfg.poolFee))
                );
            if (resolved != cfg.pair) revert InvalidMarket();
            address t0 =
                _staticAddress(cfg.pair, abi.encodeWithSelector(IUniswapV2Pair.token0.selector));
            address t1 =
                _staticAddress(cfg.pair, abi.encodeWithSelector(IUniswapV2Pair.token1.selector));
            bool validTokens =
                (t0 == cfg.usdc && t1 == cfg.weth) || (t0 == cfg.weth && t1 == cfg.usdc);
            if (!validTokens) revert InvalidMarket();
            verified = true;
            isUsdc0 = (t0 == cfg.usdc);
        }
        validator = validator_;
        marketVerified = verified;
        usdcIsToken0 = isUsdc0;
    }

    function _staticAddress(address target, bytes memory data) private view returns (address) {
        (bool ok, bytes memory ret) = target.staticcall(data);
        if (!ok || ret.length < 32) revert InvalidMarket();
        return abi.decode(ret, (address));
    }

    function _feedScale(address feed) private view returns (uint256) {
        uint8 feedDecimals;
        try IAggregatorV3(feed).decimals() returns (uint8 dec) {
            feedDecimals = dec;
        } catch {
            revert OracleUnavailable();
        }
        if (feedDecimals > 18) revert InvalidMarket();
        return 10 ** (18 - feedDecimals);
    }

    /// @notice External oracle USDC-per-WETH price (1e18), or 0 when no feed is configured.
    function oraclePrice() external view returns (uint256) {
        if (ethUsdFeed == address(0)) return 0;
        return _oraclePrice();
    }

    function _cachedOraclePrice(MarketCache memory cache) internal view returns (uint256) {
        if (ethUsdFeed == address(0)) return 0;
        if (!cache.oracleLoaded) {
            (uint256 price, uint80 ethRoundId, uint256 usdcUsd) = _oraclePriceFull();
            cache.oraclePrice = price;
            cache.ethRoundId = ethRoundId;
            cache.usdcUsd = usdcUsd;
            cache.oracleLoaded = true;
        }
        return cache.oraclePrice;
    }

    function _isPeakOracleConsistent(MarketCache memory cache, uint256 peak, uint64 since)
        internal
        view
        returns (bool)
    {
        if (ethUsdFeed == address(0)) return true;
        uint256 latest = _cachedOraclePrice(cache);
        if (peak <= Math.mulDiv(latest, PriceMath.BPS + MAX_PEAK_DEVIATION_BPS, PriceMath.BPS)) {
            return true;
        }
        return validator.verifyHistoricalPeak(
            ethUsdFeed,
            usdcUsdFeed != address(0),
            ethFeedScale,
            cache.ethRoundId,
            cache.usdcUsd,
            peak,
            since
        );
    }

    function _guardOraclePrice(MarketCache memory cache, uint256 observed) internal view {
        if (ethUsdFeed == address(0)) return;
        uint256 externalPrice = _cachedOraclePrice(cache);
        if (PriceMath.movedBy(observed, externalPrice, MAX_PRICE_DEVIATION_BPS)) {
            revert OraclePriceDeviation(observed, externalPrice);
        }
    }

    function _price(MarketCache memory cache) internal view returns (uint256) {
        uint256 spot;
        if (poolFee != 0 && cache.v3SpotLoaded) {
            spot = cache.v3SpotPrice;
        } else {
            spot = validator.readSpotPrice(pair, usdc, weth, poolFee, marketVerified, usdcIsToken0);
            if (poolFee != 0) {
                cache.v3SpotPrice = spot;
                cache.v3SpotLoaded = true;
            }
        }
        _guardOraclePrice(cache, spot);
        return spot;
    }

    function _oraclePrice() internal view returns (uint256 price) {
        (price,,) = _oraclePriceFull();
    }

    function _oraclePriceFull()
        private
        view
        returns (uint256 price, uint80 ethRoundId, uint256 usdcUsd)
    {
        return validator.readOracle(
            ethUsdFeed,
            usdcUsdFeed,
            sequencerFeed,
            ethFeedMaxAge,
            usdcFeedMaxAge,
            ethFeedScale,
            usdcFeedScale
        );
    }

    function _swap(
        MarketCache memory cache,
        bool sell,
        uint256 amount,
        uint16 slippage,
        uint64 expiresAt,
        uint256 referencePrice
    ) internal returns (uint256 received) {
        uint256 externalPrice = ethUsdFeed != address(0) ? _cachedOraclePrice(cache) : 0;
        uint256 floor = validator.quoteSwapFloor(
            WorkflowProgramValidatorV2.SwapQuoteParams({
                router: router,
                pair: pair,
                usdc: usdc,
                weth: weth,
                poolFee: poolFee,
                marketVerified: marketVerified,
                usdcIsToken0: usdcIsToken0,
                sell: sell,
                amount: amount,
                slippage: slippage,
                v3Spot: poolFee != 0 && cache.v3SpotLoaded ? cache.v3SpotPrice : 0,
                externalPrice: externalPrice,
                referencePrice: referencePrice
            })
        );
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
            cache.v3SpotLoaded = false;
        }
        token.forceApprove(router, 0);
        if (received < floor) revert SlippageExceeded(floor, received);
    }
}
