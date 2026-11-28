// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {IERC1822Proxiable} from "@openzeppelin/contracts/interfaces/draft-IERC1822.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {ERC1967Utils} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Utils.sol";
import {ChainConfig} from "../../chain/ChainConfig.sol";
import {IReactiveSystem} from "../../shared/ReactiveTypes.sol";
import {WorkflowAgentV2} from "./WorkflowAgentV2.sol";
import {WorkflowProgramValidatorV2} from "./WorkflowProgramValidatorV2.sol";

/// @notice Creates a separate V2 Agent proxy for each wallet on this Reactive automation network.
contract WorkflowAgentFactoryV2 {
    event AgentCreated(address indexed owner, address indexed agent);
    event ImplementationApproved(address indexed implementation, bool current);
    event ImplementationRevoked(address indexed implementation);
    event AdminTransferStarted(address indexed currentAdmin, address indexed pendingAdmin);
    event AdminUpdated(address indexed previousAdmin, address indexed nextAdmin);
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

    error InactiveDeployment();
    error InvalidListing();
    error Unauthorized();
    error InvalidImplementation();

    struct Listing {
        address owner;
        address agent;
        bytes32 workflow;
        bytes32 programHash;
        bool visible;
    }

    address public admin;
    address public pendingAdmin;
    address public implementation;
    WorkflowProgramValidatorV2 public immutable validator;
    mapping(address => bool) public approvedImplementation;
    mapping(address => address) public agentOf;
    mapping(uint256 => Listing) public listings;
    mapping(address => mapping(bytes32 => mapping(bytes32 => uint256))) private listingByVersion;
    uint256 public listingCount;

    constructor(
        IReactiveSystem system,
        WorkflowProgramValidatorV2 validator_,
        address implementation_
    ) {
        if (
            !ChainConfig.isAutomationChain(block.chainid) || address(system) == address(0)
                || address(validator_) == address(0) || address(validator_).code.length == 0
        ) revert InactiveDeployment();
        admin = msg.sender;
        validator = validator_;
        _approveImplementation(implementation_, true);
    }

    modifier onlyAdmin() {
        if (msg.sender != admin) revert Unauthorized();
        _;
    }

    function approveImplementation(address impl, bool makeCurrent) external onlyAdmin {
        _approveImplementation(impl, makeCurrent);
    }

    function revokeImplementation(address impl) external onlyAdmin {
        if (!approvedImplementation[impl] || impl == implementation) {
            revert InvalidImplementation();
        }
        approvedImplementation[impl] = false;
        emit ImplementationRevoked(impl);
    }

    function setAdmin(address nextAdmin) external onlyAdmin {
        if (nextAdmin == address(0)) revert Unauthorized();
        pendingAdmin = nextAdmin;
        emit AdminTransferStarted(admin, nextAdmin);
    }

    function acceptAdmin() external {
        if (msg.sender != pendingAdmin) revert Unauthorized();
        address previous = admin;
        admin = msg.sender;
        delete pendingAdmin;
        emit AdminUpdated(previous, admin);
    }

    function _approveImplementation(address impl, bool makeCurrent) private {
        if (impl == address(0) || impl.code.length == 0) revert InvalidImplementation();
        (bool okUuid, bytes memory uuidData) =
            impl.staticcall(abi.encodeCall(IERC1822Proxiable.proxiableUUID, ()));
        if (
            !okUuid || uuidData.length != 32
                || abi.decode(uuidData, (bytes32)) != ERC1967Utils.IMPLEMENTATION_SLOT
        ) {
            revert InvalidImplementation();
        }
        (bool okChain, bytes memory chainData) =
            impl.staticcall(abi.encodeWithSignature("automationChain()"));
        if (
            !okChain || chainData.length != 32
                || abi.decode(chainData, (uint256)) != uint256(block.chainid)
        ) {
            revert InvalidImplementation();
        }
        approvedImplementation[impl] = true;
        if (makeCurrent) {
            implementation = impl;
        }
        emit ImplementationApproved(impl, makeCurrent);
    }

    function create() external returns (address agent) {
        agent = agentOf[msg.sender];
        if (agent != address(0)) return agent;
        agent = address(
            new ERC1967Proxy(
                implementation, abi.encodeCall(WorkflowAgentV2.initialize, (msg.sender))
            )
        );
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
