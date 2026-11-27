// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {Script, console2} from "forge-std/Script.sol";
import {ChainConfig} from "../src/chain/ChainConfig.sol";
import {IReactiveSystem} from "../src/shared/ReactiveTypes.sol";
import {WorkflowAgentFactoryV2} from "../src/workflow/v2/WorkflowAgentFactoryV2.sol";
import {WorkflowAgentReactV2} from "../src/workflow/v2/WorkflowAgentReactV2.sol";
import {WorkflowAgentV2} from "../src/workflow/v2/WorkflowAgentV2.sol";
import {WorkflowProgramValidatorV2} from "../src/workflow/v2/WorkflowProgramValidatorV2.sol";
import {WorkflowProtocolsV2} from "../src/workflow/v2/WorkflowProtocolsV2.sol";
import {WorkflowVaultFactoryV2} from "../src/workflow/v2/WorkflowVaultFactoryV2.sol";
import {WorkflowVaultV2} from "../src/workflow/v2/WorkflowVaultV2.sol";

contract DeployWorkflowsV2 is Script {
    error InactiveSystem();

    function run() external {
        vm.startBroadcast(vm.envUint("DEPLOYER_PRIVATE_KEY"));
        WorkflowProgramValidatorV2 validator = new WorkflowProgramValidatorV2();
        console2.log("WorkflowProgramValidatorV2", address(validator));
        if (ChainConfig.isAutomationChain(block.chainid)) {
            address system = ChainConfig.get(block.chainid).systemContract;
            if (system.code.length == 0) revert InactiveSystem();
            WorkflowAgentReactV2 reactModule =
                new WorkflowAgentReactV2(IReactiveSystem(system), validator);
            console2.log("WorkflowAgentReactV2", address(reactModule));
            WorkflowAgentV2 impl =
                new WorkflowAgentV2(IReactiveSystem(system), validator, address(reactModule));
            console2.log("WorkflowAgentV2", address(impl));
            WorkflowAgentFactoryV2 factory =
                new WorkflowAgentFactoryV2(IReactiveSystem(system), validator, address(impl));
            console2.log("WorkflowAgentFactoryV2", address(factory));
        } else {
            ChainConfig.Config memory config = ChainConfig.get(block.chainid);
            WorkflowProtocolsV2.Networks memory market = WorkflowProtocolsV2.Networks(
                config.usdc,
                config.weth,
                config.router,
                config.pair,
                config.poolFee,
                config.ethUsdFeed,
                config.usdcUsdFeed,
                config.sequencerFeed,
                config.ethFeedMaxAge,
                config.usdcFeedMaxAge
            );
            WorkflowVaultV2 impl = new WorkflowVaultV2(
                config.callbackProxy,
                address(0),
                address(0),
                uint32(block.chainid),
                market,
                validator
            );
            console2.log("WorkflowVaultV2", address(impl));
            WorkflowVaultFactoryV2 factory = new WorkflowVaultFactoryV2(validator, address(impl));
            console2.log("WorkflowVaultFactoryV2", address(factory));
        }
        vm.stopBroadcast();
    }
}
