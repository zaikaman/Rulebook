// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {IReactiveSystem} from "../shared/ReactiveTypes.sol";
import {WorkflowAgent, IWorkflowDirectory} from "./WorkflowAgent.sol";

/// @notice Creates one Agent per owner and records immutable versions of public workflows.
contract WorkflowDirectory is IWorkflowDirectory {
    struct Listing {
        address author;
        address agent;
        bytes32 workflowId;
        bytes32 programHash;
        bytes32 shape;
        bool visible;
    }

    error InvalidListing();

    event WorkflowAgentCreated(address indexed owner, address indexed agent);
    event WorkflowPublished(
        uint256 indexed listingId,
        address indexed author,
        address indexed agent,
        bytes32 workflowId,
        bytes32 programHash,
        bytes32 shape,
        string title,
        string description
    );
    event WorkflowUnpublished(uint256 indexed listingId);
    event WorkflowCopied(
        uint256 indexed listingId, address indexed owner, bytes32 indexed workflowId
    );

    address public immutable implementation;
    mapping(address => address) public agentOf;
    mapping(uint256 => Listing) public listings;
    mapping(address => mapping(bytes32 => mapping(bytes32 => uint256))) public listingOf;
    mapping(uint256 => mapping(address => bool)) public copied;
    mapping(address => mapping(bytes32 => uint256[])) private _versions;
    uint256 public listingCount;

    constructor(IReactiveSystem system) {
        implementation = address(new WorkflowAgent(system, this));
    }

    function create() external returns (address agent) {
        agent = agentOf[msg.sender];
        if (agent != address(0)) return agent;
        agent = Clones.clone(implementation);
        WorkflowAgent(payable(agent)).initialize(msg.sender);
        agentOf[msg.sender] = agent;
        emit WorkflowAgentCreated(msg.sender, agent);
    }

    function publish(bytes32 workflowId, string calldata title, string calldata description)
        external
        returns (uint256 listingId)
    {
        address agent = agentOf[msg.sender];
        if (
            agent == address(0) || bytes(title).length == 0 || bytes(title).length > 80
                || bytes(description).length == 0 || bytes(description).length > 280
        ) revert InvalidListing();
        (bytes32 programHash, bytes32 shape) = WorkflowAgent(payable(agent)).publication(workflowId);
        listingId = listingOf[agent][workflowId][programHash];
        if (listingId == 0) {
            listingId = ++listingCount;
            listingOf[agent][workflowId][programHash] = listingId;
            listings[listingId] = Listing(msg.sender, agent, workflowId, programHash, shape, true);
            _versions[agent][workflowId].push(listingId);
        } else {
            if (listings[listingId].visible) revert InvalidListing();
            listings[listingId].visible = true;
        }
        emit WorkflowPublished(
            listingId, msg.sender, agent, workflowId, programHash, shape, title, description
        );
    }

    function unpublish(uint256 listingId) external {
        Listing storage listing = listings[listingId];
        if (listing.author != msg.sender || !listing.visible) revert InvalidListing();
        listing.visible = false;
        emit WorkflowUnpublished(listingId);
    }

    function publishedVersions(address agent, bytes32 workflowId)
        external
        view
        returns (uint256[] memory)
    {
        return _versions[agent][workflowId];
    }

    function recordCopy(uint256 listingId, address owner, bytes32 workflowId, bytes32 shape)
        external
    {
        Listing storage listing = listings[listingId];
        if (agentOf[owner] != msg.sender || !listing.visible || listing.shape != shape) {
            revert InvalidListing();
        }
        if (owner == listing.author || copied[listingId][owner]) return;
        copied[listingId][owner] = true;
        emit WorkflowCopied(listingId, owner, workflowId);
    }
}

