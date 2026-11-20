// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

/// @notice The ABI and limits shared by the V2 Agent and settlement Vaults.
library WorkflowProgramV2 {
    uint32 internal constant UNICHAIN_SEPOLIA = 1301;
    uint8 internal constant VERSION = 2;
    uint8 internal constant MAX_NODES = 15;
    uint8 internal constant MAX_DEPTH = 3;
    uint8 internal constant MAX_STEPS = 3;
    uint16 internal constant BPS = 10_000;

    uint8 internal constant SCHEDULE = 1;
    uint8 internal constant PAYMENT = 2;
    uint8 internal constant PRICE = 3;
    uint8 internal constant TRANSFER = 4;

    uint8 internal constant AMOUNT_AT_LEAST = 1;
    uint8 internal constant PRICE_AT_LEAST = 2;
    uint8 internal constant PRICE_BELOW = 3;
    uint8 internal constant PRICE_OUTSIDE = 4;
    uint8 internal constant DIP_BY = 5;
    uint8 internal constant TRAILING = 6;
    uint8 internal constant ABOVE_REFERENCE = 7;
    uint8 internal constant BELOW_REFERENCE = 8;
    uint8 internal constant USDC_BELOW = 9;
    uint8 internal constant INACTIVITY = 10;
    uint8 internal constant PRICE_RISES_THROUGH = 16;
    uint8 internal constant PRICE_FALLS_THROUGH = 17;
    uint8 internal constant PAYMENT_FROM = 18;
    uint8 internal constant PRICE_AT_MOST = 19;
    uint8 internal constant AMOUNT_ABOVE = 20;

    uint8 internal constant SEND = 1;
    uint8 internal constant BUY = 2;
    uint8 internal constant SELL = 3;
    uint8 internal constant REFILL = 4;
    uint8 internal constant ALERT = 8;
    uint8 internal constant INACTIVITY_PAYOUT = 10;

    uint8 internal constant FIXED = 0;
    uint8 internal constant PERCENT = 1;

    struct Action {
        uint8 kind;
        uint8 unit;
        uint96 amount;
        address account;
    }

    struct Node {
        uint8 check;
        uint8 yes;
        uint8 no;
        uint128 value;
        uint128 upper;
        Action[] actions;
    }

    struct Program {
        uint8 version;
        uint32 chain;
        uint8 trigger;
        uint32 interval;
        uint64 expires;
        address source;
        address subject;
        uint96 usdcCap;
        uint96 wethCap;
        uint16 slippage;
        bool once;
        Node[] nodes;
    }

    struct Run {
        uint64 epoch;
        bytes32 programHash;
        uint32 originChain;
        bytes32 originTransaction;
        uint64 originLogIndex;
        uint64 originBlock;
        uint64 expiresAt;
        uint256 observed;
        uint128 previous;
        uint128 high;
        uint64 highBlock;
        uint64 observationTime;
        uint64 activityTime;
        bytes32 observationId;
        address actor;
    }

    error InvalidProgram();

    /// @notice Decodes and validates a canonical program before it can be installed.
    function validate(bytes calldata encoded) internal pure returns (Program memory program) {
        if (encoded.length > 12_288) revert InvalidProgram();
        program = abi.decode(encoded, (Program));
        if (
            keccak256(encoded) != keccak256(abi.encode(program)) || program.version != VERSION
                || program.chain != UNICHAIN_SEPOLIA || program.trigger < SCHEDULE
                || program.trigger > TRANSFER || program.slippage > 1000
        ) revert InvalidProgram();
        if (program.trigger == SCHEDULE) {
            if (program.interval < 120 || program.interval > 30 days) revert InvalidProgram();
        } else if (program.interval != 0) {
            revert InvalidProgram();
        }
        if (program.trigger == TRANSFER && program.source == address(0)) revert InvalidProgram();

        uint256 count = program.nodes.length;
        if (count == 0 || count > MAX_NODES) revert InvalidProgram();
        uint8[MAX_NODES] memory depth;
        uint256[MAX_NODES] memory checks;
        depth[0] = 1;
        bool executable;
        bool payout;
        for (uint256 index; index < count; ++index) {
            if (depth[index] == 0) revert InvalidProgram();
            Node memory node = program.nodes[index];
            if (node.check == 0) {
                if (node.yes != 0 || node.no != 0 || node.value != 0 || node.upper != 0) {
                    revert InvalidProgram();
                }
                _actions(program, node.actions, checks[index]);
                if (node.actions.length == 1 && node.actions[0].kind == INACTIVITY_PAYOUT) {
                    if (payout) revert InvalidProgram();
                    payout = true;
                }
                executable = executable || node.actions.length != 0;
            } else {
                if (
                    node.actions.length != 0 || depth[index] > MAX_DEPTH || node.yes <= index
                        || node.no <= index || node.yes >= count || node.no >= count
                        || node.yes == node.no || depth[node.yes] != 0 || depth[node.no] != 0
                ) revert InvalidProgram();
                _condition(program, node);
                depth[node.yes] = depth[index] + 1;
                depth[node.no] = depth[index] + 1;
                checks[node.yes] = checks[index] | (uint256(1) << node.check);
                checks[node.no] = checks[index];
            }
        }
        if (!executable) revert InvalidProgram();
    }

    function _condition(Program memory program, Node memory node) private pure {
        uint8 check = node.check;
        if (
            check > AMOUNT_ABOVE || (check > INACTIVITY && check < PRICE_RISES_THROUGH)
                || (node.value == 0) != (check == PAYMENT_FROM)
        ) {
            revert InvalidProgram();
        }
        if (check == PRICE_OUTSIDE) {
            if (node.upper <= node.value) revert InvalidProgram();
        } else if (node.upper != 0 && check != ABOVE_REFERENCE && check != BELOW_REFERENCE) {
            revert InvalidProgram();
        }
        if (
            ((check == AMOUNT_AT_LEAST || check == AMOUNT_ABOVE)
                    && program.trigger != PAYMENT
                    && program.trigger != TRANSFER)
                || (check == PAYMENT_FROM
                    && (program.trigger != PAYMENT || program.subject == address(0)))
                || ((check == DIP_BY
                        || check == TRAILING
                        || check == ABOVE_REFERENCE
                        || check == BELOW_REFERENCE)
                    && node.value >= BPS)
                || ((check == PRICE_RISES_THROUGH
                        || check == PRICE_FALLS_THROUGH
                        || check == TRAILING
                        || check == ABOVE_REFERENCE
                        || check == BELOW_REFERENCE)
                    && program.trigger != PRICE) || (check == DIP_BY && program.trigger != SCHEDULE)
                || (check == INACTIVITY && (program.trigger != SCHEDULE || node.value < 1 days))
        ) revert InvalidProgram();
    }

    function _actions(Program memory program, Action[] memory actions, uint256 checks)
        private
        pure
    {
        if (actions.length > MAX_STEPS) revert InvalidProgram();
        uint256 usdc;
        uint256 weth;
        uint256 percent;
        bool swap;
        for (uint256 index; index < actions.length; ++index) {
            Action memory action = actions[index];
            uint8 kind = action.kind;
            if (kind == ALERT) {
                if (action.amount != 0 || action.unit != FIXED || action.account != address(0)) {
                    revert InvalidProgram();
                }
                continue;
            }
            if (
                (kind != INACTIVITY_PAYOUT && (kind < SEND || kind > REFILL)) || action.amount == 0
                    || (action.unit == PERCENT
                        && (program.trigger != PAYMENT || (kind != SEND && kind != BUY)))
                    || action.unit > PERCENT
            ) revert InvalidProgram();
            if (kind == BUY || kind == SELL) {
                if (swap || program.slippage == 0) {
                    revert InvalidProgram();
                }
                swap = true;
            }
            if (kind == SEND || kind == INACTIVITY_PAYOUT) {
                if (action.account == address(0)) revert InvalidProgram();
            } else if (action.account != address(0)) {
                revert InvalidProgram();
            }
            if (kind == REFILL && !_matches(checks, USDC_BELOW)) revert InvalidProgram();
            if (kind == INACTIVITY_PAYOUT) {
                if (!program.once || actions.length != 1 || !_matches(checks, INACTIVITY)) {
                    revert InvalidProgram();
                }
            } else if (_matches(checks, INACTIVITY)) {
                revert InvalidProgram();
            }
            if (action.unit == PERCENT) {
                percent += action.amount;
            } else if (kind == SELL) {
                weth += action.amount;
            } else {
                usdc += action.amount;
            }
        }
        if (
            usdc > program.usdcCap || weth > program.wethCap || percent > BPS
                || (percent > 0 && program.usdcCap == 0)
        ) revert InvalidProgram();
    }

    function _matches(uint256 checks, uint8 check) private pure returns (bool) {
        return (checks & (uint256(1) << check)) != 0;
    }

    function hasCheck(Program memory program, uint8 check) internal pure returns (bool) {
        for (uint256 index; index < program.nodes.length; ++index) {
            if (program.nodes[index].check == check) return true;
        }
        return false;
    }

    function runId(address agent, bytes32 workflow, Run calldata run)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(
            abi.encode(agent, workflow, run.originChain, run.originTransaction, run.originLogIndex)
        );
    }
}
