// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {Script, console2} from "forge-std/Script.sol";
import {IPayable} from "@reactive/interfaces/IPayable.sol";

import {AgentFactory} from "../src/agent/AgentFactory.sol";
import {ChainConfig} from "../src/chain/ChainConfig.sol";
import {RuleRegistry} from "../src/registry/RuleRegistry.sol";
import {IReactiveSystem} from "../src/shared/ReactiveTypes.sol";
import {VaultFactory} from "../src/vault/VaultFactory.sol";

/// @title Deploy
/// @notice Deploys the contracts used on the selected network and writes a draft
/// address record for comparison with the confirmed Foundry broadcast receipts.
contract Deploy is Script {
    struct Record {
        string contractName;
        address deployed;
    }

    function run() external {
        uint256 chainId = block.chainid;
        ChainConfig.Config memory config = ChainConfig.get(chainId);
        uint256 privateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(privateKey);
        string memory commitSha = vm.envOr("COMMIT_SHA", string("local"));

        vm.startBroadcast(privateKey);
        Record[] memory records;
        if (chainId == ChainConfig.LASNA) {
            address configuredRegistry = vm.envOr("DEPLOYED_RULE_REGISTRY", address(0));
            RuleRegistry registry;
            if (configuredRegistry == address(0)) {
                registry = new RuleRegistry();
                records = new Record[](2);
                records[0] = Record("RuleRegistry", address(registry));
            } else {
                registry = RuleRegistry(configuredRegistry);
                // Check that the prerequisite deployment is present on this chain.
                registry.listingCount();
                records = new Record[](1);
            }
            AgentFactory agentFactory =
                new AgentFactory(IReactiveSystem(config.systemContract), registry);
            records[records.length - 1] = Record("AgentFactory", address(agentFactory));
        } else {
            VaultFactory vaultFactory = new VaultFactory(IPayable(payable(config.callbackProxy)));
            records = new Record[](1);
            records[0] = Record("VaultFactory", address(vaultFactory));
        }
        vm.stopBroadcast();

        string memory explorer = chainId == ChainConfig.LASNA
            ? "https://lasna.reactscan.net"
            : "https://sepolia.uniscan.xyz";
        string memory path = string.concat(
            "../deployments/",
            chainId == ChainConfig.LASNA ? "lasna.pending.json" : "unichain-sepolia.pending.json"
        );
        vm.writeFile(path, _render(chainId, explorer, commitSha, deployer, records));

        for (uint256 i = 0; i < records.length; ++i) {
            console2.log(records[i].contractName, records[i].deployed);
        }
    }

    function _render(
        uint256 chainId,
        string memory explorer,
        string memory commitSha,
        address deployer,
        Record[] memory records
    ) private pure returns (string memory json) {
        json = string.concat(
            '{\n  "chainId": ',
            vm.toString(chainId),
            ',\n  "explorer": "',
            explorer,
            '",\n  "commit": "',
            commitSha,
            '",\n  "deployer": "',
            vm.toString(deployer),
            '",\n  "contracts": ['
        );
        for (uint256 i = 0; i < records.length; ++i) {
            json = string.concat(
                json,
                i == 0 ? "\n" : ",\n",
                '    { "name": "',
                records[i].contractName,
                '", "address": "',
                vm.toString(records[i].deployed),
                '", "chainId": ',
                vm.toString(chainId),
                ', "explorer": "',
                explorer,
                '" }'
            );
        }
        json = string.concat(json, "\n  ]\n}\n");
    }
}
