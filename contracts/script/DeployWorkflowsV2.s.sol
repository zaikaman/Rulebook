// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {Script, console2} from "forge-std/Script.sol";
import {ChainConfig} from "../src/chain/ChainConfig.sol";
import {IReactiveSystem} from "../src/shared/ReactiveTypes.sol";
import {WorkflowAgentFactoryV2} from "../src/workflow/v2/WorkflowAgentFactoryV2.sol";
import {WorkflowVaultFactoryV2} from "../src/workflow/v2/WorkflowVaultFactoryV2.sol";

contract DeployWorkflowsV2 is Script {
    error InactiveSystem();

    function run() external {
        vm.startBroadcast(vm.envUint("DEPLOYER_PRIVATE_KEY"));
        if (block.chainid == ChainConfig.LASNA) {
            address system = ChainConfig.lasna().systemContract;
            if (system.code.length == 0) revert InactiveSystem();
            console2.log(
                "WorkflowAgentFactoryV2",
                address(new WorkflowAgentFactoryV2(IReactiveSystem(system)))
            );
        } else {
            console2.log("WorkflowVaultFactoryV2", address(new WorkflowVaultFactoryV2()));
        }
        vm.stopBroadcast();
    }
}
