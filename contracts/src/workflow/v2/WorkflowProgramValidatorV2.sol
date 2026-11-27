// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {PriceMath} from "../../libraries/PriceMath.sol";
import {IAggregatorV3} from "../../shared/Chainlink.sol";
import {WorkflowProgramV2 as P} from "./WorkflowProgramV2.sol";

/// @notice Shared stateless validator for the settlement Vaults on a chain.
contract WorkflowProgramValidatorV2 {
    uint64 private constant SEQUENCER_GRACE_PERIOD = 1 hours;
    uint16 private constant MAX_PEAK_DEVIATION_BPS = 200;
    uint256 private constant MAX_PEAK_ORACLE_ROUNDS = 16;

    error OracleUnavailable();
    error SequencerUnavailable();

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
            if (uint64(roundId) <= 1) break;
            roundId -= 1;
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
}
