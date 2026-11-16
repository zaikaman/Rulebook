// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

/// @notice Uniswap V2 pair double with settable reserves and a real `Sync` event.
contract MockPair {
    event Sync(uint112 reserve0, uint112 reserve1);

    address public immutable token0;
    address public immutable token1;

    uint112 private _reserve0;
    uint112 private _reserve1;
    uint32 private _blockTimestampLast;

    constructor(address token0_, address token1_) {
        token0 = token0_;
        token1 = token1_;
    }

    function setReserves(uint112 reserve0_, uint112 reserve1_) external {
        _reserve0 = reserve0_;
        _reserve1 = reserve1_;
        _blockTimestampLast = uint32(block.timestamp);
        emit Sync(reserve0_, reserve1_);
    }

    function getReserves() external view returns (uint112, uint112, uint32) {
        return (_reserve0, _reserve1, _blockTimestampLast);
    }
}
