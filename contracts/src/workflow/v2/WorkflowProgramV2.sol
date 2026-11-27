// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {PriceMath} from "../../libraries/PriceMath.sol";

/// @notice The ABI and limits shared by the V2 Agent and settlement Vaults.
library WorkflowProgramV2 {
    uint32 internal constant UNICHAIN_SEPOLIA = 1301;
    uint32 internal constant BASE_SEPOLIA = 84_532;
    uint32 internal constant LASNA = 5_318_007;
    uint32 internal constant UNICHAIN_MAINNET = 130;
    uint32 internal constant BASE_MAINNET = 8453;
    uint32 internal constant REACTIVE_MAINNET = 1597;
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
        uint32 originChain;
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

    uint8 internal constant FLAG_DIP = 1;
    uint8 internal constant FLAG_INACTIVITY = 2;
    uint8 internal constant FLAG_ONCE = 4;
    uint8 internal constant FLAG_SPENDS = 8;
    uint8 internal constant FLAG_USES_REFERENCE = 16;
    uint8 internal constant FLAG_TRAILING = 32;

    struct AgentPlan {
        uint32 chain;
        uint32 originChain;
        uint8 trigger;
        uint32 interval;
        uint64 expires;
        address source;
        address subject;
        uint8 flags;
        uint256[] paths;
    }

    error InvalidProgram();

    function isFundsChain(uint32 chainId) internal pure returns (bool) {
        return chainId == UNICHAIN_SEPOLIA || chainId == BASE_SEPOLIA || chainId == UNICHAIN_MAINNET
            || chainId == BASE_MAINNET;
    }

    function isSameEnvironment(uint32 a, uint32 b) internal pure returns (bool) {
        if (
            (a == UNICHAIN_SEPOLIA || a == BASE_SEPOLIA)
                && (b == UNICHAIN_SEPOLIA || b == BASE_SEPOLIA)
        ) {
            return true;
        }
        return (a == UNICHAIN_MAINNET || a == BASE_MAINNET)
            && (b == UNICHAIN_MAINNET || b == BASE_MAINNET);
    }

    /// @notice Decodes and validates a canonical program before it can be installed.
    function validate(bytes calldata encoded) internal pure returns (Program memory program) {
        if (encoded.length > 12_288) revert InvalidProgram();
        program = abi.decode(encoded, (Program));
        if (
            keccak256(encoded) != keccak256(abi.encode(program)) || program.version != VERSION
                || !isFundsChain(program.chain) || !isFundsChain(program.originChain)
                || !isSameEnvironment(program.chain, program.originChain)
                || program.trigger < SCHEDULE || program.trigger > TRANSFER
                || program.slippage > 1000
        ) revert InvalidProgram();
        if (program.trigger == SCHEDULE) {
            if (program.interval < 120 || program.interval > 30 days) revert InvalidProgram();
        } else if (program.interval != 0) {
            revert InvalidProgram();
        }
        if (program.trigger == PAYMENT && program.originChain != program.chain) {
            revert InvalidProgram();
        }
        if (program.trigger == TRANSFER) {
            if (
                program.source == address(0)
                    || (program.originChain != program.chain && program.subject == address(0))
            ) revert InvalidProgram();
        }

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
        if (
            program.trigger == SCHEDULE && program.originChain != program.chain
                && !hasCheck(program, DIP_BY)
        ) revert InvalidProgram();
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

    /// @notice Validates `encoded` and returns the flat metadata and leaf costs the Agent needs.
    function inspectForAgent(bytes calldata encoded) internal pure returns (AgentPlan memory plan) {
        Program memory program = validate(encoded);
        plan.chain = program.chain;
        plan.originChain = program.originChain;
        plan.trigger = program.trigger;
        plan.interval = program.interval;
        plan.expires = program.expires;
        plan.source = program.source;
        plan.subject = program.subject;
        uint8 flags = program.once ? FLAG_ONCE : 0;

        uint256 leafCount;
        for (uint256 index; index < program.nodes.length; ++index) {
            uint8 check = program.nodes[index].check;
            if (check == 0) {
                leafCount += 1;
            } else if (check == DIP_BY && program.originChain != program.chain) {
                flags |= FLAG_DIP;
            } else if (check == INACTIVITY) {
                flags |= FLAG_INACTIVITY;
            } else if (check == ABOVE_REFERENCE || check == BELOW_REFERENCE) {
                flags |= FLAG_USES_REFERENCE;
            } else if (check == TRAILING) {
                flags |= FLAG_TRAILING;
            }
        }

        plan.paths = new uint256[](leafCount);
        uint256 pathIndex;
        for (uint256 index; index < program.nodes.length; ++index) {
            Node memory node = program.nodes[index];
            if (node.check != 0) continue;
            uint256 usdc;
            uint256 weth;
            uint256 percent;
            uint256 percents;
            bool empty = node.actions.length == 0;
            for (uint256 step; step < node.actions.length; ++step) {
                Action memory action = node.actions[step];
                if (action.kind == ALERT) continue;
                flags |= FLAG_SPENDS;
                if (action.unit == PERCENT) {
                    percent += action.amount;
                    percents += 1;
                } else if (action.kind == SELL) {
                    weth += action.amount;
                } else if (action.kind == REFILL) {
                    usdc += 1;
                } else {
                    usdc += action.amount;
                }
            }
            plan.paths[pathIndex++] = usdc | (weth << 104) | (percent << 208) | (percents << 224)
                | (empty ? (uint256(1) << 232) : 0);
        }
        plan.flags = flags;
    }

    /// @notice Conservative pre-check for PRICE workflows before dispatching a callback.
    /// @dev Returns false only when no executable leaf can match the observed price state. Any
    /// condition that depends on destination-only state (such as USDC balance or an unseeded
    /// dynamic reference price) keeps both outgoing branches reachable.
    function canTriggerPrice(
        bytes calldata encoded,
        uint256 observed,
        uint256 previous,
        uint256 peak,
        uint256 referencePrice
    ) internal pure returns (bool) {
        Program memory program = abi.decode(encoded, (Program));
        if (program.trigger != PRICE || observed == 0) return false;
        return _canTriggerPriceNode(program.nodes, 0, observed, previous, peak, referencePrice);
    }

    function _canTriggerPriceNode(
        Node[] memory nodes,
        uint8 cursor,
        uint256 observed,
        uint256 previous,
        uint256 peak,
        uint256 referencePrice
    ) private pure returns (bool) {
        Node memory node = nodes[cursor];
        uint8 check = node.check;
        if (check == 0) return node.actions.length != 0;

        bool known = true;
        bool matched;
        uint256 threshold = node.value;
        if (check == PRICE_AT_LEAST) {
            matched = observed >= threshold;
        } else if (check == PRICE_AT_MOST) {
            matched = observed <= threshold;
        } else if (check == PRICE_BELOW) {
            matched = observed < threshold;
        } else if (check == PRICE_OUTSIDE) {
            matched = observed < threshold || observed > node.upper;
        } else if (check == PRICE_RISES_THROUGH) {
            matched = previous != 0 && previous < threshold && observed >= threshold;
        } else if (check == PRICE_FALLS_THROUGH) {
            matched = previous != 0 && previous >= threshold && observed < threshold;
        } else if (check == TRAILING) {
            uint256 effectivePeak = peak > observed ? peak : observed;
            matched = observed <= Math.mulDiv(effectivePeak, BPS - threshold, BPS);
            if (!matched && _hasHigherPeakPath(nodes, 0, effectivePeak)) {
                known = false;
            }
        } else if (check == ABOVE_REFERENCE || check == BELOW_REFERENCE) {
            if (referencePrice == type(uint256).max) {
                known = false;
            } else {
                uint256 refPrice = referencePrice != 0 ? referencePrice : node.upper;
                if (refPrice == 0) {
                    return _hasExecutableLeaf(nodes, node.yes) || _hasExecutableLeaf(nodes, node.no);
                }
                referencePrice = refPrice;
                matched = check == ABOVE_REFERENCE
                    ? observed >= Math.mulDiv(refPrice, BPS + threshold, BPS)
                    : observed <= Math.mulDiv(refPrice, BPS - threshold, BPS);
            }
        } else {
            known = false;
        }

        if (known) {
            return _canTriggerPriceNode(
                nodes, matched ? node.yes : node.no, observed, previous, peak, referencePrice
            );
        }
        return _canTriggerPriceNode(nodes, node.yes, observed, previous, peak, referencePrice)
            || _canTriggerPriceNode(nodes, node.no, observed, previous, peak, referencePrice);
    }

    function _hasExecutableLeaf(Node[] memory nodes, uint8 cursor) private pure returns (bool) {
        Node memory node = nodes[cursor];
        if (node.check == 0) return node.actions.length != 0;
        return _hasExecutableLeaf(nodes, node.yes) || _hasExecutableLeaf(nodes, node.no);
    }

    /// @dev True when an executable leaf outside TRAILING.yes could have settled at a price above
    /// `effectivePeak` (raising Vault `memory_.peak` above the Agent's `highs[workflow]`).
    function _hasHigherPeakPath(Node[] memory nodes, uint8 cursor, uint256 effectivePeak)
        private
        pure
        returns (bool)
    {
        Node memory node = nodes[cursor];
        if (node.check == 0) return node.actions.length != 0;
        if (node.check == TRAILING) {
            return _hasHigherPeakPath(nodes, node.no, effectivePeak);
        }
        bool yesReachable = true;
        if (
            (node.check == PRICE_AT_MOST || node.check == PRICE_BELOW)
                && node.value <= effectivePeak
        ) {
            yesReachable = false;
        }
        return (yesReachable && _hasHigherPeakPath(nodes, node.yes, effectivePeak))
            || _hasHigherPeakPath(nodes, node.no, effectivePeak);
    }

    /// @notice Conservative pre-check for PAYMENT and TRANSFER workflows before parking or dispatching.
    function canTriggerTransfer(bytes calldata encoded, uint256 observed, address actor)
        internal
        pure
        returns (bool)
    {
        Program memory program = abi.decode(encoded, (Program));
        if ((program.trigger != PAYMENT && program.trigger != TRANSFER) || observed == 0) {
            return false;
        }
        return _canTriggerTransferNode(program, 0, observed, actor);
    }

    function _canTriggerTransferNode(
        Program memory program,
        uint8 cursor,
        uint256 observed,
        address actor
    ) private pure returns (bool) {
        Node memory node = program.nodes[cursor];
        uint8 check = node.check;
        if (check == 0) {
            if (node.actions.length == 0) return false;
            uint256 totalUsdc;
            for (uint256 i; i < node.actions.length; ++i) {
                Action memory action = node.actions[i];
                if (action.kind == ALERT) continue;
                uint256 addition;
                if (action.unit == PERCENT) {
                    addition = Math.mulDiv(observed, action.amount, BPS);
                    if (addition == 0) return false;
                } else if (action.kind == REFILL) {
                    addition = 1;
                } else if (action.kind != SELL) {
                    addition = action.amount;
                }
                totalUsdc = addition > type(uint256).max - totalUsdc
                    ? type(uint256).max
                    : totalUsdc + addition;
            }
            if (totalUsdc > program.usdcCap || (program.trigger == PAYMENT && totalUsdc > observed))
            {
                return false;
            }
            return true;
        }
        if (check == AMOUNT_AT_LEAST) {
            return _canTriggerTransferNode(
                program, observed >= node.value ? node.yes : node.no, observed, actor
            );
        }
        if (check == AMOUNT_ABOVE) {
            return _canTriggerTransferNode(
                program, observed > node.value ? node.yes : node.no, observed, actor
            );
        }
        if (check == PAYMENT_FROM) {
            return _canTriggerTransferNode(
                program, actor == program.subject ? node.yes : node.no, observed, actor
            );
        }
        return _canTriggerTransferNode(program, node.yes, observed, actor)
            || _canTriggerTransferNode(program, node.no, observed, actor);
    }

    /// @notice Decodes a Uniswap V2 Sync or V3 Swap log payload into a 1e18-scaled USDC-per-WETH price.
    function decodePrice(uint24 poolFee, bool usdcIsToken0, bytes calldata data)
        internal
        pure
        returns (uint128)
    {
        uint256 observed;
        if (poolFee == 0) {
            if (data.length != 64) return 0;
            (uint256 first, uint256 second) = abi.decode(data, (uint256, uint256));
            if (
                first == 0 || second == 0 || first > type(uint112).max || second > type(uint112).max
            ) {
                return 0;
            }
            observed = usdcIsToken0
                ? PriceMath.usdcPerWeth(uint112(first), uint112(second))
                : PriceMath.usdcPerWeth(uint112(second), uint112(first));
        } else {
            if (data.length != 160) return 0;
            (,, uint256 sqrtPriceRaw, uint256 liquidityRaw,) =
                abi.decode(data, (int256, int256, uint256, uint256, int256));
            if (
                sqrtPriceRaw < PriceMath.MIN_SQRT_RATIO || sqrtPriceRaw >= PriceMath.MAX_SQRT_RATIO
                    || liquidityRaw == 0 || liquidityRaw > type(uint128).max
            ) return 0;
            observed = PriceMath.usdcPerWethFromSqrtPriceX96(uint160(sqrtPriceRaw), usdcIsToken0);
        }
        if (observed == 0 || observed > type(uint128).max) return 0;
        return uint128(observed);
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
