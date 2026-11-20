// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {IReactiveSystem} from "../../shared/ReactiveTypes.sol";
import {WorkflowAgentV2} from "./WorkflowAgentV2.sol";

/// @notice Creates a separate V2 Agent for each wallet on Lasna.
contract WorkflowAgentFactoryV2 {
    event AgentCreated(address indexed owner, address indexed agent);
    event Published(
        uint256 indexed listing,
        address indexed owner,
        address indexed agent,
        bytes32 workflow,
        bytes32 programHash,
        uint32 chain,
        string title,
        string description
    );
    event Unpublished(uint256 indexed listing);

    error InvalidListing();

    struct Listing {
        address owner;
        address agent;
        bytes32 workflow;
        bytes32 programHash;
        bool visible;
    }

    address public immutable implementation;
    mapping(address => address) public agentOf;
    mapping(uint256 => Listing) public listings;
    mapping(address => mapping(bytes32 => mapping(bytes32 => uint256))) private listingByVersion;
    uint256 public listingCount;

    constructor(IReactiveSystem system) {
        implementation = address(new WorkflowAgentV2(system, address(this)));
    }

    function create() external returns (address agent) {
        agent = agentOf[msg.sender];
        if (agent != address(0)) return agent;
        agent = Clones.clone(implementation);
        WorkflowAgentV2(payable(agent)).initialize(msg.sender);
        agentOf[msg.sender] = agent;
        emit AgentCreated(msg.sender, agent);
    }

    function publish(bytes32 workflow, string calldata description) external returns (uint256 id) {
        address agent = agentOf[msg.sender];
        if (
            agent == address(0) || bytes(description).length == 0 || bytes(description).length > 280
        ) {
            revert InvalidListing();
        }
        (bytes32 hash, uint32 chain, string memory title) =
            WorkflowAgentV2(payable(agent)).publication(workflow);
        id = listingByVersion[agent][workflow][hash];
        if (id == 0) {
            id = ++listingCount;
            listingByVersion[agent][workflow][hash] = id;
            listings[id] = Listing(msg.sender, agent, workflow, hash, true);
        } else {
            if (listings[id].visible) revert InvalidListing();
            listings[id].visible = true;
        }
        emit Published(id, msg.sender, agent, workflow, hash, chain, title, description);
    }

    function listingOf(address agent, bytes32 workflow, bytes32 hash)
        external
        view
        returns (uint256)
    {
        return listingByVersion[agent][workflow][hash];
    }

    function unpublish(uint256 id) external {
        Listing storage listing = listings[id];
        if (listing.owner != msg.sender || !listing.visible) revert InvalidListing();
        listing.visible = false;
        emit Unpublished(id);
    }
}
