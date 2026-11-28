// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {MockSystemContract} from "./MockSystemContract.sol";

/// @notice Adds fee pricing getters for the isolated browser test chains.
contract BrowserFeeProvider is MockSystemContract {
    uint256 public constant _extraGas = 80_000;
    uint256 public constant _gasPriceCoeffPer1000 = 1_100;
}
