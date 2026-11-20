// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

library WorkflowProgram {
    uint8 internal constant PAYMENT = 1;
    uint8 internal constant SCHEDULE = 2;
    uint8 internal constant PRICE = 3;
    uint8 internal constant SEND = 1;
    uint8 internal constant SWAP = 2;
    uint8 internal constant ALERT = 3;
    uint8 internal constant FIXED = 0;
    uint8 internal constant PERCENT = 1;
    uint256 internal constant MAX_NODES = 15;

    error InvalidProgram();
    error InvalidRunAmount();

    struct Action {
        uint8 kind;
        uint8 unit;
        uint96 amount;
        address recipient;
    }

    /// @dev Lower indexes always point forward. A zero threshold marks a terminal path.
    struct Node {
        uint128 threshold;
        uint8 yes;
        uint8 no;
        Action[] actions;
    }

    struct Program {
        uint8 version;
        uint8 trigger;
        uint128 target;
        bool rising;
        uint96 spendLimit;
        uint16 slippage;
        Node[] nodes;
    }

    struct Run {
        bytes32 id;
        uint64 epoch;
        bytes32 programHash;
        uint8 leaf;
        uint256 originChainId;
        bytes32 originTransaction;
        uint256 originLogIndex;
        uint256 originBlock;
        uint256 observed;
        uint64 expiresAt;
    }

    function decode(bytes memory encoded) internal pure returns (Program memory program) {
        program = abi.decode(encoded, (Program));
    }

    function validate(bytes calldata encoded, address vault)
        internal
        pure
        returns (Program memory program)
    {
        if (encoded.length > 12_288) revert InvalidProgram();
        program = decode(encoded);
        if (keccak256(encoded) != keccak256(abi.encode(program))) revert InvalidProgram();
        if (
            program.version != 1 || program.trigger < PAYMENT || program.trigger > PRICE
                || program.slippage > 1_000
        ) {
            revert InvalidProgram();
        }
        if (program.trigger != PRICE && program.rising) revert InvalidProgram();
        if (program.trigger == PAYMENT && program.target != 0) revert InvalidProgram();
        if (
            program.trigger == SCHEDULE
                && (program.target < 1 hours
                    || program.target > 30 days
                    || program.target % 1 hours != 0)
        ) {
            revert InvalidProgram();
        }
        if (program.trigger == PRICE && program.target == 0) revert InvalidProgram();

        uint256 count = program.nodes.length;
        if (count == 0 || count > MAX_NODES) revert InvalidProgram();
        uint8[15] memory depth;
        depth[0] = 1;
        bool hasAction;
        for (uint256 i; i < count; ++i) {
            Node memory node = program.nodes[i];
            if (depth[i] == 0) revert InvalidProgram();
            if (node.threshold == 0) {
                if (node.yes != 0 || node.no != 0) revert InvalidProgram();
                if (node.actions.length > 0) hasAction = true;
                _validateActions(program, node.actions, vault);
            } else {
                if (
                    program.trigger == SCHEDULE || node.actions.length != 0 || depth[i] > 3
                        || node.yes <= i || node.no <= i || node.yes >= count || node.no >= count
                        || node.yes == node.no || depth[node.yes] != 0 || depth[node.no] != 0
                ) revert InvalidProgram();
                depth[node.yes] = depth[i] + 1;
                depth[node.no] = depth[i] + 1;
            }
        }
        if (!hasAction) revert InvalidProgram();
    }

    function _validateActions(Program memory program, Action[] memory actions, address vault)
        private
        pure
    {
        if (actions.length > 3) revert InvalidProgram();
        uint256 fixedTotal;
        uint256 percentTotal;
        bool swapped;
        for (uint256 i; i < actions.length; ++i) {
            Action memory action = actions[i];
            if (action.kind == ALERT) {
                if (action.unit != FIXED || action.amount != 0 || action.recipient != address(0)) {
                    revert InvalidProgram();
                }
                continue;
            }
            if (action.kind == SEND) {
                if (action.recipient == address(0) || action.recipient == vault) {
                    revert InvalidProgram();
                }
            } else if (action.kind == SWAP) {
                if (swapped || action.recipient != address(0) || program.slippage == 0) {
                    revert InvalidProgram();
                }
                swapped = true;
            } else {
                revert InvalidProgram();
            }
            if (action.amount == 0) revert InvalidProgram();
            if (action.unit == FIXED) {
                fixedTotal += action.amount;
            } else if (action.unit == PERCENT && program.trigger == PAYMENT) {
                percentTotal += action.amount;
            } else {
                revert InvalidProgram();
            }
        }
        if (
            fixedTotal > program.spendLimit || percentTotal > 10_000
                || (percentTotal > 0 && program.spendLimit == 0)
        ) {
            revert InvalidProgram();
        }
    }

    function path(Program memory program, uint256 observed) internal pure returns (uint8 leaf) {
        while (program.nodes[leaf].threshold != 0) {
            Node memory node = program.nodes[leaf];
            leaf = observed >= node.threshold ? node.yes : node.no;
        }
    }

    function runId(address agent, bytes32 workflowId, Run memory run)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                agent, workflowId, run.originChainId, run.originTransaction, run.originLogIndex
            )
        );
    }

    function amountFor(Action memory action, uint256 observed)
        internal
        pure
        returns (uint256 amount)
    {
        amount = action.unit == PERCENT
            ? Math.mulDiv(observed, action.amount, 10_000)
            : action.amount;
        if (amount == 0) revert InvalidRunAmount();
    }

    function shape(Program memory program) internal pure returns (bytes32) {
        bytes32 digest = keccak256(abi.encode(program.version, program.trigger, program.rising));
        for (uint256 i; i < program.nodes.length; ++i) {
            Node memory node = program.nodes[i];
            digest = keccak256(abi.encode(digest, node.yes, node.no, node.actions.length));
            for (uint256 j; j < node.actions.length; ++j) {
                digest = keccak256(abi.encode(digest, node.actions[j].kind, node.actions[j].unit));
            }
        }
        return digest;
    }
}

