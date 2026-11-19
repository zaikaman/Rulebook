// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {ChainConfig} from "../chain/ChainConfig.sol";
import {
    InvalidAmount,
    InvalidSecondary,
    InvalidTemplateParams,
    InvalidThreshold,
    UnknownTemplate,
    UnsupportedChain
} from "../shared/Errors.sol";

/// @title RuleLib
/// @notice The canonical `Rule` layout, its eight-slot packing, validation, and parameter hash.
/// @dev Field order is load-bearing: it packs into exactly eight slots (data-model.md §1.1).
library RuleLib {
    /// @notice Rule is active and may be evaluated.
    uint8 internal constant FLAG_ACTIVE = 0x01;
    /// @notice Rule fired once and must be re-armed (or cooled down) before firing again.
    uint8 internal constant FLAG_LATCHED = 0x02;
    /// @notice Rule is a mirror of another account's execution.
    uint8 internal constant FLAG_MIRRORED = 0x04;
    /// @notice Rule was cancelled. Additive to the three flags in data-model.md §1.1.
    uint8 internal constant FLAG_CANCELLED = 0x08;

    /// @notice Number of templates in the catalog.
    uint8 internal constant TEMPLATE_COUNT = 13;
    /// @notice Maximum active rules per Agent.
    uint256 internal constant MAX_ACTIVE_RULES = 5;
    uint256 internal constant DEFAULT_SCHEDULE = 1 days;

    struct Rule {
        uint8 template;
        uint16 chainId;
        uint8 flags;
        address pair;
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint256 threshold;
        uint256 secondary;
        uint64 lastRun;
        uint32 runs;
    }

    /// @notice Packs a rule into its canonical eight-slot representation.
    function pack(Rule memory rule) internal pure returns (bytes32[8] memory slots) {
        slots[0] = bytes32(uint256(rule.template) | (uint256(rule.chainId) << 8) | (uint256(rule.flags) << 24));
        slots[1] = bytes32(uint256(uint160(rule.pair)));
        slots[2] = bytes32(uint256(uint160(rule.tokenIn)));
        slots[3] = bytes32(uint256(uint160(rule.tokenOut)));
        slots[4] = bytes32(rule.amountIn);
        slots[5] = bytes32(rule.threshold);
        slots[6] = bytes32(rule.secondary);
        slots[7] = bytes32(uint256(rule.lastRun) | (uint256(rule.runs) << 64));
    }

    /// @notice Unpacks the canonical eight-slot representation back into a rule.
    function unpack(bytes32[8] memory slots) internal pure returns (Rule memory rule) {
        uint256 word = uint256(slots[0]);
        rule.template = uint8(word);
        rule.chainId = uint16(word >> 8);
        rule.flags = uint8(word >> 24);
        rule.pair = address(uint160(uint256(slots[1])));
        rule.tokenIn = address(uint160(uint256(slots[2])));
        rule.tokenOut = address(uint160(uint256(slots[3])));
        rule.amountIn = uint256(slots[4]);
        rule.threshold = uint256(slots[5]);
        rule.secondary = uint256(slots[6]);
        word = uint256(slots[7]);
        rule.lastRun = uint64(word);
        rule.runs = uint32(word >> 64);
    }

    /// @notice Validates every structural constraint a rule must satisfy before it is stored.
    /// @dev Time-dependent checks (expiry in the future, cooldown readiness) belong to callers.
    function validate(Rule memory rule) internal pure {
        if (rule.template < 1 || rule.template > TEMPLATE_COUNT) {
            revert UnknownTemplate(rule.template);
        }
        if (!ChainConfig.isSupported(rule.chainId)) revert UnsupportedChain(rule.chainId);

        if (isAlertTemplate(rule.template)) {
            if (rule.amountIn != 0) revert InvalidAmount();
        } else if (rule.amountIn == 0) {
            revert InvalidAmount();
        }

        if (isThresholdTemplate(rule.template) && rule.threshold == 0) revert InvalidThreshold();

        if (isPriceTemplate(rule.template) && rule.pair == address(0)) {
            revert InvalidTemplateParams();
        }

        if (isSwapTemplate(rule.template)) {
            if (rule.tokenIn == address(0) || rule.tokenOut == address(0)) {
                revert InvalidTemplateParams();
            }
            if (rule.tokenIn == rule.tokenOut) revert InvalidTemplateParams();
        }

        if (isBpsSecondaryTemplate(rule.template) && rule.secondary > 10_000) {
            revert InvalidSecondary();
        }
        if ((rule.template == 2 || rule.template == 6) && rule.secondary == 0) {
            revert InvalidSecondary();
        }
        if (rule.template == 12 && rule.secondary <= rule.threshold) revert InvalidSecondary();
        bool personal = rule.template >= 7 && rule.template <= 10;
        if (personal && rule.pair == address(0)) revert InvalidTemplateParams();
        if ((personal || rule.template == 13) && rule.tokenIn == address(0)) {
            revert InvalidTemplateParams();
        }
        if (isCronTemplate(rule.template)) {
            uint256 interval = rule.template == 2 || rule.template == 10 ? rule.threshold : rule.secondary;
            if (interval != 0 && (interval < 1 hours || interval > 30 days)) {
                revert InvalidSecondary();
            }
        }
        if (isExpiryTemplate(rule.template) && rule.secondary == 0) revert InvalidSecondary();
        if (rule.template == 10 && (rule.secondary < 1 || rule.secondary > 365)) {
            revert InvalidSecondary();
        }
    }

    /// @notice Stable hash of every user-chosen parameter, excluding runtime state.
    /// @dev Two rules with identical parameters share a hash, which is what makes cloning exact.
    function paramsHash(Rule memory rule) internal pure returns (bytes32 hash) {
        hash = keccak256(
            abi.encode(
                rule.template,
                rule.chainId,
                rule.pair,
                rule.tokenIn,
                rule.tokenOut,
                rule.amountIn,
                rule.threshold,
                rule.secondary
            )
        );
    }

    /// @notice Alert-only templates move no money.
    function isAlertTemplate(uint8 template) internal pure returns (bool) {
        return template == 11 || template == 12 || template == 13;
    }

    /// @notice Templates whose action is a swap, so `tokenOut` is mandatory.
    function isSwapTemplate(uint8 template) internal pure returns (bool) {
        return template >= 1 && template <= 6;
    }

    /// @notice Templates that compare against a cached pair price, so `pair` is mandatory.
    function isPriceTemplate(uint8 template) internal pure returns (bool) {
        return (template >= 1 && template <= 6) || template == 11 || template == 12;
    }

    /// @notice Templates whose condition uses a numeric threshold.
    function isThresholdTemplate(uint8 template) internal pure returns (bool) {
        return template == 3 || template == 4 || template == 5 || template == 6 || template == 8 || template == 9
            || template == 11 || template == 12 || template == 13;
    }

    /// @notice Templates whose `secondary` value is a basis-point band or trailing tolerance.
    function isBpsSecondaryTemplate(uint8 template) internal pure returns (bool) {
        return template == 2 || template == 5 || template == 6;
    }

    /// @notice Templates whose `secondary` value is an expiry timestamp.
    function isExpiryTemplate(uint8 template) internal pure returns (bool) {
        return template == 3 || template == 4;
    }

    /// @notice Templates driven by the cron subscription.
    function isCronTemplate(uint8 template) internal pure returns (bool) {
        return template == 1 || template == 2 || template == 7 || template == 10;
    }

    function schedule(Rule memory rule) internal pure returns (uint256) {
        uint256 value = rule.template == 2 || rule.template == 10 ? rule.threshold : rule.secondary;
        return value == 0 ? DEFAULT_SCHEDULE : value;
    }
}
