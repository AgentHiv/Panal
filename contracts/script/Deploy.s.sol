// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/PanalRegistry.sol";
import "../src/PanalReputation.sol";
import "../src/PanalEscrow.sol";

/// @notice Despliega el protocolo Panal: Registry -> Reputation -> Escrow, y hace setEscrow.
/// Env requeridas: PRIVATE_KEY. Opcionales: TREASURY, ARBITRATOR (default = deployer).
contract Deploy is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address treasury = vm.envOr("TREASURY", deployer);
        address arbitrator = vm.envOr("ARBITRATOR", deployer);

        vm.startBroadcast(deployerKey);

        PanalRegistry registry = new PanalRegistry();
        console.log("PanalRegistry:", address(registry));

        PanalReputation reputation = new PanalReputation();
        console.log("PanalReputation:", address(reputation));

        PanalEscrow escrow = new PanalEscrow(address(registry), address(reputation), treasury, arbitrator);
        console.log("PanalEscrow:", address(escrow));

        reputation.setEscrow(address(escrow));

        vm.stopBroadcast();

        console.log("Treasury:", treasury);
        console.log("Arbitrator:", arbitrator);
    }
}
