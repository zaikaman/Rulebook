// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {Script, console2} from "forge-std/Script.sol";
import {ChainConfig} from "../src/chain/ChainConfig.sol";
import {IReactiveSystem} from "../src/shared/ReactiveTypes.sol";
import {WorkflowDirectory} from "../src/workflow/WorkflowDirectory.sol";
import {WorkflowVaultFactory} from "../src/workflow/WorkflowVaultFactory.sol";

contract DeployWorkflows is Script {
    function run() external {
        ChainConfig.Config memory config = ChainConfig.get(block.chainid);
        vm.startBroadcast(vm.envUint("DEPLOYER_PRIVATE_KEY"));
        if (block.chainid == ChainConfig.LASNA) {
            console2.log(
                "WorkflowDirectory",
                address(new WorkflowDirectory(IReactiveSystem(config.systemContract)))
            );
        } else {
            console2.log(
                "WorkflowVaultFactory", address(new WorkflowVaultFactory(config.callbackProxy))
            );
        }
        vm.stopBroadcast();
    }
}

