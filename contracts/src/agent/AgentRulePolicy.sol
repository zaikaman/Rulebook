// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {ChainConfig} from "../chain/ChainConfig.sol";
import {RuleLib} from "../libraries/RuleLib.sol";

import {InvalidTemplateParams, MirrorDepthNotAllowed, TokenMismatch} from "../shared/Errors.sol";

interface IAgentDirectory {
    function agentOf(address owner) external view returns (address);
}

interface IAgentRuleView {
    function owner() external view returns (address);
    function getVault(uint256 chainId) external view returns (address);
    function getRule(uint256 ruleId) external view returns (RuleLib.Rule memory);
}

/// @notice One system-contract subscription a rule depends on, kept so it can be released.
struct Subscription {
    bytes32 key;
    uint256 chainId;
    address source;
    uint256 topic0;
    uint256 topic1;
    uint256 topic2;
}

/// @notice Stateless validation and subscription criteria used by an Agent implementation.
contract AgentRulePolicy {
    uint256 private constant ANY_TOPIC =
        0xa65f96fc951c35ead38878e0f0b7a3c744a6f5ccc1476b313353ce31712313ad;
    bytes32 private constant SYNC_TOPIC = keccak256("Sync(uint112,uint112)");
    bytes32 private constant HOURLY_CRON_TOPIC = keccak256("Cron100(uint256)");
    bytes32 private constant DAILY_CRON_TOPIC = keccak256("Cron10000(uint256)");
    bytes32 private constant GRID_SETTLED_TOPIC = keccak256("GridSettled(uint256,uint32)");
    bytes32 private constant TRANSFER_TOPIC = keccak256("Transfer(address,address,uint256)");
    bytes32 private constant BALANCES_TOPIC =
        keccak256("Balances(address,uint256,address,uint256)");
    bytes32 private constant SWAP_FUNDS_TOPIC =
        keccak256("ScheduledSwapFunds(address,uint256,uint256,uint256,uint32)");

    function validate(RuleLib.Rule calldata rule) external pure {
        RuleLib.validate(rule);
    }

    /// @dev Which system subscriptions a rule needs, at most three per template.
    /// @dev Subscription keys are shared, so two rules on the same pair (or the same cron tick)
    /// hold one system subscription between them (T167).
    function subscriptionsFor(
        uint256 ruleId,
        RuleLib.Rule calldata rule,
        address vault,
        address owner
    ) external pure returns (Subscription[3] memory subs) {
        uint256 slot;
        if (RuleLib.isCronTemplate(rule.template)) {
            uint256 schedule = RuleLib.schedule(rule);
            bytes32 topic = schedule < 1 days ? HOURLY_CRON_TOPIC : DAILY_CRON_TOPIC;
            subs[slot++] = Subscription({
                key: topic,
                chainId: ChainConfig.LASNA,
                source: ChainConfig.lasna().cronSource,
                topic0: uint256(topic),
                topic1: ANY_TOPIC,
                topic2: ANY_TOPIC
            });
        }
        if (RuleLib.isPriceTemplate(rule.template) && rule.template != 1) {
            subs[slot++] = Subscription({
                key: keccak256(abi.encode("sync", rule.pair)),
                chainId: rule.chainId,
                source: rule.pair,
                topic0: uint256(SYNC_TOPIC),
                topic1: ANY_TOPIC,
                topic2: ANY_TOPIC
            });
        }
        if (rule.template == 6) {
            subs[slot++] = Subscription({
                key: keccak256(abi.encode(GRID_SETTLED_TOPIC, vault, ruleId)),
                chainId: rule.chainId,
                source: vault,
                topic0: uint256(GRID_SETTLED_TOPIC),
                topic1: ruleId,
                topic2: ANY_TOPIC
            });
        }
        if (rule.template == 8 || rule.template == 13) {
            subs[slot++] = Subscription({
                key: keccak256(abi.encode("transfer", rule.tokenIn, vault)),
                chainId: rule.chainId,
                source: rule.tokenIn,
                topic0: uint256(TRANSFER_TOPIC),
                topic1: ANY_TOPIC,
                topic2: uint256(uint160(vault))
            });
        }
        if (rule.template == 9 || (rule.template <= 2 && vault != address(0))) {
            bytes32 topic = rule.template == 9 ? BALANCES_TOPIC : SWAP_FUNDS_TOPIC;
            subs[slot++] = Subscription({
                key: keccak256(abi.encode(topic, vault, rule.chainId)),
                chainId: rule.chainId,
                source: vault,
                topic0: uint256(topic),
                topic1: ANY_TOPIC,
                topic2: ANY_TOPIC
            });
        }
        if (rule.template == 10) {
            subs[slot++] = Subscription({
                key: keccak256(abi.encode("activity", owner, rule.tokenIn)),
                chainId: rule.chainId,
                source: rule.tokenIn,
                topic0: uint256(TRANSFER_TOPIC),
                topic1: uint256(uint160(owner)),
                topic2: ANY_TOPIC
            });
        }
    }

    /// @dev Reads the leader's rule on Lasna. The destination also verifies its own allowlist.
    function validateMirrorSource(
        address factory,
        address followerVault,
        uint256 leaderChainId,
        address leaderAgent,
        address leaderVault,
        uint256 leaderRuleId,
        address tokenIn
    ) external view returns (RuleLib.Rule memory source) {
        if (
            leaderChainId != ChainConfig.UNICHAIN_SEPOLIA || followerVault == address(0)
                || leaderVault == address(0) || leaderAgent.code.length == 0
        ) revert InvalidTemplateParams();
        if (leaderAgent == msg.sender || leaderVault == followerVault) {
            revert MirrorDepthNotAllowed();
        }
        IAgentRuleView leader = IAgentRuleView(leaderAgent);
        address leaderOwner = leader.owner();
        if (
            leaderOwner == IAgentRuleView(msg.sender).owner()
                || IAgentDirectory(factory).agentOf(leaderOwner) != address(leader)
        ) {
            revert MirrorDepthNotAllowed();
        }
        if (leader.getVault(leaderChainId) != leaderVault) {
            revert InvalidTemplateParams();
        }
        source = leader.getRule(leaderRuleId);
        if ((source.flags & RuleLib.FLAG_MIRRORED) != 0) revert MirrorDepthNotAllowed();
        if (
            source.chainId != leaderChainId || !RuleLib.isSwapTemplate(source.template)
                || (source.flags & RuleLib.FLAG_ACTIVE) == 0 || source.pair == address(0)
        ) revert InvalidTemplateParams();
        if (source.tokenIn != tokenIn) revert TokenMismatch(source.tokenIn, tokenIn);
    }
}
