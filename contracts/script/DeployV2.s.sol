// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/v2/PanalRegistryV2.sol";
import "../src/v2/PanalEscrowV2.sol";
import "../src/PanalReputation.sol";

/// @notice Despliega el protocolo Panal v2 (escrow dual MON + $PANAL):
///         RegistryV2 -> EscrowV2 (usando la Reputation existente) -> reputation.setEscrow(escrowV2).
///
/// Env requeridas:
///   PRIVATE_KEY  - key del deployer; DEBE ser el owner de la PanalReputation existente
///                  (setEscrow revierte si no, o si el escrow ya fue fijado: migracion one-shot).
/// Env opcionales (defaults documentados de Monad mainnet):
///   REPUTATION   - default 0xadAd5582B2023aAE7a89d42d6aF0B530c6C3e4D6 (PanalReputation v1 mainnet)
///   PANAL_TOKEN  - default 0x2e2e44e7fa6178822d4397299f719e89d1a67777 ($PANAL mainnet)
///   TREASURY     - default = deployer
///   ARBITRATOR   - default = deployer
///
/// Testnet: exportar REPUTATION y PANAL_TOKEN con las direcciones desplegadas en testnet.
contract DeployV2 is Script {
    // Defaults de Monad mainnet (ver contracts/V2.md y MAINNET.md)
    address constant DEFAULT_REPUTATION = 0xadAd5582B2023aAE7a89d42d6aF0B530c6C3e4D6;
    address constant DEFAULT_PANAL_TOKEN = 0x2E2e44E7FA6178822D4397299F719e89d1a67777;

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address reputationAddr = vm.envOr("REPUTATION", DEFAULT_REPUTATION);
        address panalToken = vm.envOr("PANAL_TOKEN", DEFAULT_PANAL_TOKEN);
        address treasury = vm.envOr("TREASURY", deployer);
        address arbitrator = vm.envOr("ARBITRATOR", deployer);

        console.log("Deployer:", deployer);
        console.log("Using PanalReputation:", reputationAddr);
        console.log("Using PANAL_TOKEN:", panalToken);

        vm.startBroadcast(deployerKey);

        PanalRegistryV2 registry = new PanalRegistryV2(panalToken);
        console.log("PanalRegistryV2:", address(registry));

        PanalEscrowV2 escrow =
            new PanalEscrowV2(address(registry), reputationAddr, treasury, arbitrator, panalToken);
        console.log("PanalEscrowV2:", address(escrow));

        PanalReputation(reputationAddr).setEscrow(address(escrow));
        console.log("PanalReputation.escrow fijado a EscrowV2 (migracion completada)");

        vm.stopBroadcast();

        console.log("Treasury:", treasury);
        console.log("Arbitrator:", arbitrator);
    }
}
