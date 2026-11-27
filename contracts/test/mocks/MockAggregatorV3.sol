// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

/// @notice Configurable Chainlink AggregatorV3 test double for price and sequencer uptime feeds.
contract MockAggregatorV3 {
    struct RoundData {
        int256 answer;
        uint256 startedAt;
        uint256 updatedAt;
        uint80 answeredInRound;
        bool exists;
    }

    uint8 private _decimals;
    uint80 private _roundId;
    int256 private _answer;
    uint256 private _startedAt;
    uint256 private _updatedAt;
    uint80 private _answeredInRound;
    bool private _reverts;
    bool private _decimalsReverts;
    mapping(uint80 => RoundData) private _rounds;

    constructor(uint8 decimals_, int256 answer_, uint256 startedAt_, uint256 updatedAt_) {
        _decimals = decimals_;
        _roundId = 1;
        _answer = answer_;
        _startedAt = startedAt_;
        _updatedAt = updatedAt_;
        _answeredInRound = 1;
        _rounds[1] = RoundData(answer_, startedAt_, updatedAt_, 1, true);
    }

    function setDecimals(uint8 decimals_) external {
        _decimals = decimals_;
    }

    function setAnswer(int256 answer_) external {
        _roundId += 1;
        _answer = answer_;
        _startedAt = block.timestamp;
        _updatedAt = block.timestamp;
        _answeredInRound = _roundId;
        _rounds[_roundId] = RoundData(answer_, _startedAt, _updatedAt, _answeredInRound, true);
    }

    function setRound(
        uint80 roundId_,
        int256 answer_,
        uint256 startedAt_,
        uint256 updatedAt_,
        uint80 answeredInRound_
    ) external {
        _roundId = roundId_;
        _answer = answer_;
        _startedAt = startedAt_;
        _updatedAt = updatedAt_;
        _answeredInRound = answeredInRound_;
        _rounds[roundId_] = RoundData(answer_, startedAt_, updatedAt_, answeredInRound_, true);
    }

    function setReverts(bool reverts_) external {
        _reverts = reverts_;
    }

    function setDecimalsReverts(bool decimalsReverts_) external {
        _decimalsReverts = decimalsReverts_;
    }

    function decimals() external view returns (uint8) {
        if (_decimalsReverts) revert("decimals");
        return _decimals;
    }

    function getRoundData(uint80 roundId_)
        external
        view
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        )
    {
        RoundData memory r = _rounds[roundId_];
        if (_reverts || !r.exists) revert("round");
        return (roundId_, r.answer, r.startedAt, r.updatedAt, r.answeredInRound);
    }

    function latestRoundData()
        external
        view
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        )
    {
        if (_reverts) revert("round");
        return (_roundId, _answer, _startedAt, _updatedAt, _answeredInRound);
    }
}
