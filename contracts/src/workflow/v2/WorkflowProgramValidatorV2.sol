// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {WorkflowProgramV2 as P} from "./WorkflowProgramV2.sol";

/// @notice Shared stateless validator for the settlement Vaults on a chain.
contract WorkflowProgramValidatorV2 {
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
}
