// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {RuleLib} from "../libraries/RuleLib.sol";
import {InvalidTemplateParams, NotOwner} from "../shared/Errors.sol";
import {IRuleRegistry} from "./IRuleRegistry.sol";

/// @title RuleRegistry
/// @notice Public listing of rule parameters.
/// @dev Holds no funds and has no execution path. The only writer is the Agent's owner: the
/// backend indexer never submits a listing (FR-052). `paramsHash` is derived from the rule the
/// Agent actually stores, so a clone rebuilt from a listing matches the author's rule exactly.
contract RuleRegistry is IRuleRegistry {
    /// @notice One public listing.
    struct Listing {
        address author;
        address agent;
        uint8 template;
        bytes32 paramsHash;
        string metadataURI;
        bool isPublic;
        uint64 createdAt;
    }

    /// @notice Emitted when an author publishes a rule.
    event RuleListed(
        address indexed author,
        address indexed agent,
        uint256 indexed ruleId,
        uint8 template,
        bytes32 paramsHash,
        string metadataURI
    );
    /// @notice Emitted when an author removes a listing.
    event RuleDelisted(address indexed author, address indexed agent, uint256 indexed ruleId);

    mapping(address => mapping(uint256 => Listing)) private _listings;
    mapping(address => mapping(uint256 => bool)) private _hasListing;

    /// @notice Number of live listings.
    uint256 public listingCount;

    /// @inheritdoc IRuleRegistry
    /// @dev The caller is either the owner's own transaction or the Agent itself, which only
    /// reaches here from `addRule` after its own `onlyAgentOwner` check.
    function list(address agent, uint256 ruleId, string calldata metadataURI) external {
        address author = IAgentRuleSource(agent).owner();
        if (msg.sender != author && msg.sender != agent) revert NotOwner();

        RuleLib.Rule memory rule = IAgentRuleSource(agent).getRule(ruleId);
        if (rule.template < 1 || rule.template > RuleLib.TEMPLATE_COUNT) {
            revert InvalidTemplateParams();
        }

        bool replacing = _hasListing[agent][ruleId];
        _listings[agent][ruleId] = Listing({
            author: author,
            agent: agent,
            template: rule.template,
            paramsHash: RuleLib.paramsHash(rule),
            metadataURI: metadataURI,
            isPublic: true,
            createdAt: uint64(block.timestamp)
        });
        _hasListing[agent][ruleId] = true;
        if (!replacing) {
            listingCount += 1;
        }
        emit RuleListed(
            author, agent, ruleId, rule.template, RuleLib.paramsHash(rule), metadataURI
        );
    }

    /// @notice Removes the caller's listing for `ruleId`.
    function delist(address agent, uint256 ruleId) external {
        Listing storage listing = _listings[agent][ruleId];
        if (listing.author != msg.sender) revert NotOwner();
        delete _listings[agent][ruleId];
        _hasListing[agent][ruleId] = false;
        listingCount -= 1;
        emit RuleDelisted(msg.sender, agent, ruleId);
    }

    /// @notice Returns the listing for `(agent, ruleId)`; a missing listing has `isPublic == false`.
    function getListing(address agent, uint256 ruleId)
        external
        view
        returns (Listing memory listing)
    {
        listing = _listings[agent][ruleId];
    }

    /// @notice True when `(agent, ruleId)` is currently listed.
    function isListed(address agent, uint256 ruleId) external view returns (bool listed) {
        listed = _hasListing[agent][ruleId];
    }
}

/// @notice The read-only Agent surface the registry trusts: owner and stored rule.
interface IAgentRuleSource {
    function owner() external view returns (address);

    function getRule(uint256 ruleId) external view returns (RuleLib.Rule memory rule);
}
