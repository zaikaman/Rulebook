// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {PriceMath} from "../../libraries/PriceMath.sol";
import {IAggregatorV3} from "../../shared/Chainlink.sol";
import {IUniswapV2Factory, IUniswapV2Pair, IUniswapV2Router02} from "../../shared/UniswapV2.sol";
import {IUniswapV3Factory, IUniswapV3Pool, IV3SwapRouter} from "../../shared/UniswapV3.sol";
import {WorkflowProgramV2 as P} from "./WorkflowProgramV2.sol";

/// @notice Shared stateless validator for the Agent and settlement Vaults on a chain.
contract WorkflowProgramValidatorV2 {
    uint64 private constant SEQUENCER_GRACE_PERIOD = 1 hours;
    uint16 private constant MAX_PEAK_DEVIATION_BPS = 200;
    uint16 private constant MAX_PRICE_DEVIATION_BPS = 500;
    uint256 private constant MAX_PEAK_ORACLE_ROUNDS = 24;
    uint64 private constant WEEK = 7 days;
    uint64 private constant WEEK_SKEW = 10 minutes;
    uint256 private constant PATH_MASK_104 = (uint256(1) << 104) - 1;
    uint256 private constant ANY =
        0xa65f96fc951c35ead38878e0f0b7a3c744a6f5ccc1476b313353ce31712313ad;
    uint256 private constant CRON = uint256(keccak256("Cron100(uint256)"));
    uint256 private constant SYNC = uint256(keccak256("Sync(uint112,uint112)"));
    uint256 private constant SWAP_V3 =
        uint256(keccak256("Swap(address,address,int256,int256,uint160,uint128,int24)"));
    uint256 private constant TRANSFER = uint256(keccak256("Transfer(address,address,uint256)"));
    uint256 private constant CLOSED = uint256(keccak256("Closed(bytes32,uint64)"));
    uint256 private constant BUDGET_SYNCED =
        uint256(keccak256("BudgetSynced(bytes32,uint96,uint96,uint128,uint128,uint64,uint32)"));
    uint256 private constant REFERENCE_SYNCED =
        uint256(keccak256("ReferenceSynced(bytes32,uint64,uint128)"));
    uint256 private constant GRACE_STARTED =
        uint256(keccak256("GraceStarted(bytes32,uint64,uint64)"));
    uint256 private constant PEAK_SYNCED = uint256(keccak256("PeakSynced(bytes32,uint64,uint128)"));

    struct Filter {
        uint32 chain;
        address source;
        uint256 signature;
        uint256 topic1;
        uint256 topic2;
    }

    struct TriggerFilterParams {
        uint8 trigger;
        uint32 chain;
        uint32 originChain;
        uint32 automationChain;
        address cronSource;
        address vault;
        address originUsdc;
        address originPair;
        uint24 originPoolFee;
        address source;
        address subject;
        bool dip;
    }

    struct SwapQuoteParams {
        address router;
        address pair;
        address usdc;
        address weth;
        uint24 poolFee;
        bool marketVerified;
        bool usdcIsToken0;
        bool sell;
        uint256 amount;
        uint16 slippage;
        uint256 v3Spot;
        uint256 externalPrice;
        uint256 referencePrice;
    }

    error OracleUnavailable();
    error SequencerUnavailable();
    error InvalidMarket();
    error OraclePriceDeviation(uint256 observed, uint256 oracle);
    error SlippageExceeded(uint256 minOut, uint256 actual);

    function validateProgram(bytes calldata encoded) external pure returns (P.Program memory) {
        return P.validate(encoded);
    }

    function inspectForAgent(bytes calldata encoded) external pure returns (P.AgentPlan memory) {
        return P.inspectForAgent(encoded);
    }

    function canTriggerPrice(
        bytes calldata encoded,
        uint256 observed,
        uint256 previous,
        uint256 peak,
        uint256 referencePrice
    ) external pure returns (bool) {
        return P.canTriggerPrice(encoded, observed, previous, peak, referencePrice);
    }

    function canTriggerTransfer(bytes calldata encoded, uint256 observed, address actor)
        external
        pure
        returns (bool)
    {
        return P.canTriggerTransfer(encoded, observed, actor);
    }

    function decodePrice(uint24 poolFee, bool usdcIsToken0, bytes calldata data)
        external
        pure
        returns (uint128)
    {
        return P.decodePrice(poolFee, usdcIsToken0, data);
    }

    function readOracle(
        address ethUsdFeed,
        address usdcUsdFeed,
        address sequencerFeed,
        uint32 ethFeedMaxAge,
        uint32 usdcFeedMaxAge,
        uint256 ethFeedScale,
        uint256 usdcFeedScale
    ) external view returns (uint256 price, uint80 ethRoundId, uint256 usdcUsd) {
        if (sequencerFeed != address(0)) _requireSequencerUp(sequencerFeed);
        uint256 ethUsd;
        (ethUsd, ethRoundId) = _readFeedFull(ethUsdFeed, ethFeedMaxAge, ethFeedScale);
        if (usdcUsdFeed == address(0)) return (ethUsd, ethRoundId, 0);
        (usdcUsd,) = _readFeedFull(usdcUsdFeed, usdcFeedMaxAge, usdcFeedScale);
        price = Math.mulDiv(ethUsd, PriceMath.PRICE_SCALE, usdcUsd);
        if (price == 0) revert OracleUnavailable();
    }

    function verifyHistoricalPeak(
        address ethUsdFeed,
        bool hasUsdcFeed,
        uint256 ethFeedScale,
        uint80 latestRoundId,
        uint256 usdcUsd,
        uint256 peak,
        uint64 since
    ) external view returns (bool) {
        uint80 roundId = latestRoundId;
        for (uint256 i; i < MAX_PEAK_ORACLE_ROUNDS; ++i) {
            uint64 aggId = uint64(roundId);
            if (aggId <= 1) break;
            uint64 step = i < 8 ? 1 : (i < 16 ? 4 : 16);
            uint64 delta = step >= aggId ? aggId - 1 : step;
            roundId -= delta;
            uint80 rId;
            int256 answer;
            uint256 updatedAt;
            uint80 answeredInRound;
            try IAggregatorV3(ethUsdFeed).getRoundData(roundId) returns (
                uint80 r, int256 value, uint256, uint256 updated, uint80 answered
            ) {
                rId = r;
                answer = value;
                updatedAt = updated;
                answeredInRound = answered;
            } catch {
                break;
            }
            bool invalid = answeredInRound < roundId || rId != roundId || answer <= 0
                || updatedAt == 0 || updatedAt > block.timestamp
                || uint256(answer) > type(uint256).max / ethFeedScale;
            if (invalid) break;
            uint256 ethUsd = uint256(answer) * ethFeedScale;
            uint256 roundPrice =
                !hasUsdcFeed ? ethUsd : Math.mulDiv(ethUsd, PriceMath.PRICE_SCALE, usdcUsd);
            if (
                roundPrice != 0
                    && peak
                        <= Math.mulDiv(
                            roundPrice, PriceMath.BPS + MAX_PEAK_DEVIATION_BPS, PriceMath.BPS
                        )
            ) {
                return true;
            }
            if (updatedAt < since) break;
        }
        return false;
    }

    function _requireSequencerUp(address sequencerFeed) private view {
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
        if (
            status != 0 || startedAt == 0 || updatedAt == 0 || block.timestamp < startedAt
                || block.timestamp - startedAt <= SEQUENCER_GRACE_PERIOD
        ) {
            revert SequencerUnavailable();
        }
    }

    function _readFeedFull(address feed, uint32 maxAge, uint256 scale)
        private
        view
        returns (uint256, uint80)
    {
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
        if (uint256(answer) > type(uint256).max / scale) revert OracleUnavailable();
        return (uint256(answer) * scale, roundId);
    }

    /// @notice Reads the live Uniswap V2 or V3 spot price (USDC per WETH, 1e18).
    function readSpotPrice(
        address pair,
        address usdc,
        address weth,
        uint24 poolFee,
        bool marketVerified,
        bool usdcIsToken0
    ) external view returns (uint256 spot) {
        if (poolFee == 0) {
            (uint112 stable, uint112 wrapped) =
                _v2Reserves(pair, usdc, marketVerified, usdcIsToken0);
            if (stable == 0 || wrapped == 0) revert InvalidMarket();
            spot = PriceMath.usdcPerWeth(stable, wrapped);
        } else {
            spot = _v3Spot(pair, usdc, weth, marketVerified, usdcIsToken0);
        }
        if (spot == 0 || spot > type(uint128).max) revert InvalidMarket();
    }

    /// @notice Computes the slippage-protected minimum swap output against pool spot and Chainlink.
    function quoteSwapFloor(SwapQuoteParams calldata params) external view returns (uint256 floor) {
        if (params.router == address(0) || params.pair == address(0)) revert InvalidMarket();
        uint24 effectiveFee = params.poolFee == 0 ? PriceMath.V2_FEE_PPM : params.poolFee;
        uint256 spotQuote;
        if (params.poolFee == 0) {
            if (
                !params.marketVerified
                    && IUniswapV2Factory(IUniswapV2Router02(params.router).factory())
                            .getPair(params.usdc, params.weth) != params.pair
            ) {
                revert InvalidMarket();
            }
            (uint112 stable, uint112 wrapped) =
                _v2Reserves(params.pair, params.usdc, params.marketVerified, params.usdcIsToken0);
            spotQuote = params.sell
                ? PriceMath.expectedOut(params.amount, wrapped, stable)
                : PriceMath.expectedOut(params.amount, stable, wrapped);
        } else {
            if (
                !params.marketVerified
                    && IUniswapV3Factory(IV3SwapRouter(params.router).factory())
                            .getPool(params.usdc, params.weth, params.poolFee) != params.pair
            ) {
                revert InvalidMarket();
            }
            uint256 v3Spot = params.v3Spot != 0
                ? params.v3Spot
                : _v3Spot(
                    params.pair,
                    params.usdc,
                    params.weth,
                    params.marketVerified,
                    params.usdcIsToken0
                );
            spotQuote = PriceMath.quotedOut(params.sell, params.amount, v3Spot, params.poolFee);
        }
        floor = PriceMath.applySlippage(spotQuote, params.slippage);
        if (params.externalPrice != 0) {
            uint16 maxDeviation = params.slippage > MAX_PRICE_DEVIATION_BPS
                ? params.slippage
                : MAX_PRICE_DEVIATION_BPS;
            if (
                params.referencePrice != 0
                    && PriceMath.movedBy(params.referencePrice, params.externalPrice, maxDeviation)
            ) {
                revert OraclePriceDeviation(params.referencePrice, params.externalPrice);
            }
            uint256 oracleQuote =
                PriceMath.quotedOut(params.sell, params.amount, params.externalPrice, effectiveFee);
            uint256 oracleFloor = PriceMath.applySlippage(oracleQuote, params.slippage);
            if (oracleFloor == 0) revert InvalidMarket();
            if (oracleFloor > floor) floor = oracleFloor;
        }
        if (floor == 0) revert InvalidMarket();
        if (spotQuote < floor) revert SlippageExceeded(floor, spotQuote);
    }

    /// @notice True when every executable leaf would exceed the mirrored weekly budget at `asOf`.
    function budgetBlocks(
        uint96 usdcLimit,
        uint96 wethLimit,
        uint128 usdcSpent,
        uint128 wethSpent,
        uint64 weekStart,
        uint256[] calldata plan,
        uint256 observed,
        uint64 asOf
    ) external pure returns (bool) {
        if (asOf >= uint256(weekStart) + WEEK + WEEK_SKEW) {
            usdcSpent = 0;
            wethSpent = 0;
        }
        uint256 count = plan.length;
        if (count == 0) return false;
        for (uint256 index; index < count; ++index) {
            uint256 packed = plan[index];
            if ((packed >> 232) != 0) continue;
            uint256 usdc = packed & PATH_MASK_104;
            uint256 weth = (packed >> 104) & PATH_MASK_104;
            uint256 percent = (packed >> 208) & 0xffff;
            uint256 percents = (packed >> 224) & 0xff;
            if (percent != 0) {
                uint256 aggregated = Math.mulDiv(observed, percent, P.BPS);
                uint256 floorLoss = percents - 1;
                if (aggregated > floorLoss) {
                    uint256 part = aggregated - floorLoss;
                    usdc = part > type(uint256).max - usdc ? type(uint256).max : usdc + part;
                }
            }
            if (_exceeds(usdcLimit, usdcSpent, usdc)) continue;
            if (_exceeds(wethLimit, wethSpent, weth)) continue;
            return false;
        }
        return true;
    }

    function _exceeds(uint96 limit, uint128 spent, uint256 cost) private pure returns (bool) {
        if (cost == 0 || limit == 0) return false;
        if (spent >= limit) return true;
        return cost > uint256(limit) - uint256(spent);
    }

    /// @notice Builds the Agent's settlement and inactivity filters for a workflow.
    function settlementFilters(
        uint32 chain,
        address vault,
        address owner,
        uint8 flags,
        uint64 epoch,
        bytes32 workflow,
        uint32 primaryChain,
        address primaryUsdc,
        uint32 secondaryChain,
        address secondaryUsdc
    ) external pure returns (Filter[] memory list) {
        Filter[] memory raw = new Filter[](7);
        uint256 count;
        if ((flags & P.FLAG_SPENDS) != 0) {
            raw[count++] = Filter(chain, vault, BUDGET_SYNCED, uint256(workflow), ANY);
        }
        if ((flags & P.FLAG_ONCE) != 0) {
            raw[count++] = Filter(chain, vault, CLOSED, uint256(workflow), uint256(epoch));
        }
        if ((flags & P.FLAG_USES_REFERENCE) != 0) {
            raw[count++] = Filter(chain, vault, REFERENCE_SYNCED, uint256(workflow), uint256(epoch));
        }
        if ((flags & P.FLAG_TRAILING) != 0) {
            raw[count++] = Filter(chain, vault, PEAK_SYNCED, uint256(workflow), uint256(epoch));
        }
        if ((flags & P.FLAG_INACTIVITY) != 0) {
            raw[count++] = Filter(primaryChain, primaryUsdc, TRANSFER, uint160(owner), ANY);
            raw[count++] = Filter(secondaryChain, secondaryUsdc, TRANSFER, uint160(owner), ANY);
            raw[count++] = Filter(chain, vault, GRACE_STARTED, uint256(workflow), uint256(epoch));
        }
        return _trimFilters(raw, count);
    }

    /// @notice Builds the Agent's trigger filters that are removed while watching is paused.
    function triggerFilters(TriggerFilterParams calldata p)
        external
        pure
        returns (Filter[] memory list)
    {
        Filter[] memory raw = new Filter[](2);
        uint256 count;
        uint256 priceTopic = p.originPoolFee == 0 ? SYNC : SWAP_V3;
        if (p.trigger == P.SCHEDULE) {
            raw[count++] = Filter(p.automationChain, p.cronSource, CRON, ANY, ANY);
            if (p.dip) {
                raw[count++] = Filter(p.originChain, p.originPair, priceTopic, ANY, ANY);
            }
        } else if (p.trigger == P.PRICE) {
            raw[count++] = Filter(p.originChain, p.originPair, priceTopic, ANY, ANY);
        } else if (p.trigger == P.PAYMENT) {
            raw[count++] = Filter(p.originChain, p.originUsdc, TRANSFER, ANY, uint160(p.vault));
        } else if (p.trigger == P.TRANSFER) {
            uint160 destination = uint160(p.subject == address(0) ? p.vault : p.subject);
            if (p.subject != address(0)) {
                raw[count++] = Filter(p.originChain, p.source, TRANSFER, destination, ANY);
            }
            raw[count++] = Filter(p.originChain, p.source, TRANSFER, ANY, destination);
        }
        return _trimFilters(raw, count);
    }

    function _trimFilters(Filter[] memory raw, uint256 count)
        private
        pure
        returns (Filter[] memory list)
    {
        list = new Filter[](count);
        for (uint256 i; i < count; ++i) {
            list[i] = raw[i];
        }
    }

    function _v2Reserves(address pair, address usdc, bool marketVerified, bool usdcIsToken0)
        private
        view
        returns (uint112 stable, uint112 wrapped)
    {
        if (pair == address(0)) revert InvalidMarket();
        IUniswapV2Pair pool = IUniswapV2Pair(pair);
        (uint112 first, uint112 second,) = pool.getReserves();
        bool isUsdc0 = marketVerified ? usdcIsToken0 : pool.token0() == usdc;
        return isUsdc0 ? (first, second) : (second, first);
    }

    function _v3Spot(
        address pair,
        address usdc,
        address weth,
        bool marketVerified,
        bool usdcIsToken0
    ) private view returns (uint256 spot) {
        if (pair == address(0)) revert InvalidMarket();
        IUniswapV3Pool pool = IUniswapV3Pool(pair);
        (uint160 sqrtPriceX96,,,,,,) = pool.slot0();
        uint128 liq = pool.liquidity();
        bool isUsdc0;
        if (marketVerified) {
            isUsdc0 = usdcIsToken0;
        } else {
            address t0 = pool.token0();
            address t1 = pool.token1();
            isUsdc0 = t0 == usdc;
            if (!((isUsdc0 && t1 == weth) || (t0 == weth && t1 == usdc))) revert InvalidMarket();
        }
        if (
            liq == 0 || sqrtPriceX96 < PriceMath.MIN_SQRT_RATIO
                || sqrtPriceX96 >= PriceMath.MAX_SQRT_RATIO
        ) revert InvalidMarket();
        spot = PriceMath.usdcPerWethFromSqrtPriceX96(sqrtPriceX96, isUsdc0);
        if (spot == 0) revert InvalidMarket();
    }
}
