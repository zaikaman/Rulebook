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
/// @notice Deploys both factories and the registry on the configured chain and records every
/// address in `deployments/<chain>.json` with chain id, commit SHA, deployer, and explorer link.
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
        RuleRegistry registry = new RuleRegistry();
        AgentFactory agentFactory = new AgentFactory(IReactiveSystem(config.systemContract));
        VaultFactory vaultFactory = new VaultFactory(IPayable(payable(config.callbackProxy)));
        vm.stopBroadcast();

        Record[] memory records = new Record[](3);
        records[0] = Record("RuleRegistry", address(registry));
        records[1] = Record("AgentFactory", address(agentFactory));
        records[2] = Record("VaultFactory", address(vaultFactory));

        string memory explorer =
            chainId == 5318007 ? "https://reactscan.net" : "https://sepolia.uniscan.xyz";
        string memory path = string.concat(
            "../deployments/", chainId == 5318007 ? "lasna.json" : "unichain-sepolia.json"
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
