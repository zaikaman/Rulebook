// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {InvalidTemplateParams, NotOwner} from "../shared/Errors.sol";

/// @title RuleRegistry
/// @notice Public listing of rule parameters on Unichain Sepolia.
/// @dev Holds no funds and has no execution path. Only the listing author may write.
contract RuleRegistry {
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

    /// @notice Publishes `ruleId` for the agent the caller owns.
    function list(
        uint8 template,
        bytes32 paramsHash,
        string calldata metadataURI,
        address agent,
        uint256 ruleId
    ) external {
        address author = IAgentOwnable(agent).owner();
        if (msg.sender != author) revert NotOwner();
        if (template < 1 || template > 13 || paramsHash == bytes32(0)) {
            revert InvalidTemplateParams();
        }
        bool replacing = _hasListing[agent][ruleId];
        _listings[agent][ruleId] = Listing({
            author: author,
            agent: agent,
            template: template,
            paramsHash: paramsHash,
            metadataURI: metadataURI,
            isPublic: true,
            createdAt: uint64(block.timestamp)
        });
        _hasListing[agent][ruleId] = true;
        if (!replacing) {
            listingCount += 1;
        }
        emit RuleListed(author, agent, ruleId, template, paramsHash, metadataURI);
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

interface IAgentOwnable {
    function owner() external view returns (address);
}
