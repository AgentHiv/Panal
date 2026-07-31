// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/PanalMultisig.sol";

/// @notice Interfaz minima del EscrowV2 para la migracion opcional del rol de arbitro.
interface PanalEscrowV2Like {
    function arbitrator() external view returns (address);
    function owner() external view returns (address);
    function transferArbitrator(address newArbitrator) external;
}

/// @notice Despliega el PanalMultisig 2-de-3 para el rol de `arbitrator` de PanalEscrowV2
///         (mainnet: 0xe138A9A492CFe27A13f8b7A6D312DA831791bCe9).
///
/// Por defecto SOLO despliega e imprime logs y los comandos `cast` para operarlo;
/// NO toca el escrow. La migracion es opt-in y exige dos pasos conscientes:
///
///   1) Deploy (seguro, sin efectos sobre el escrow):
///        OWNER_A=0x... OWNER_B=0x... OWNER_C=0x... PRIVATE_KEY=0x... \
///        forge script script/DeployMultisig.s.sol --rpc-url $RPC --broadcast
///
///   2) Migracion OPCIONAL del arbitrator (irreversible para la EOA actual):
///        ademas exportar ESCROW_V2=0xe138A9A492CFe27A13f8b7A6D312DA831791bCe9
///        y (si la key del broadcaster no es el arbitrator/owner actual y se quiere
///        ejecutar la transferencia desde la EOA que SI lo es) TRANSFER_KEY=0x...
///
///      El script solo ejecuta `transferArbitrator(multisig)` si ESCROW_V2 esta
///      definido Y alguna de las keys disponibles (PRIVATE_KEY o TRANSFER_KEY) es
///      el arbitrator o el owner actual del escrow. En caso contrario, solo loguea
///      el comando cast para hacerlo a mano:
///        cast send $ESCROW_V2 "transferArbitrator(address)" <MULTISIG> \
///          --rpc-url $RPC --private-key <KEY_DEL_ARBITRATOR_U_OWNER_ACTUAL>
///
///      AVISO: una vez transferido, la EOA anterior ya NO puede resolver disputas;
///      solo el multisig via submit + confirm de 2 owners.
///
/// Env requeridas:
///   PRIVATE_KEY - key del deployer/broadcaster.
///   OWNER_A / OWNER_B / OWNER_C - los 3 owners del multisig (distintos, no zero).
/// Env opcionales:
///   ESCROW_V2   - si se define, intenta la migracion del arbitrator.
///   TRANSFER_KEY - key alternativa autorizada (arbitrator u owner del escrow) para
///                  ejecutar transferArbitrator si PRIVATE_KEY no lo esta.
contract DeployMultisig is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address ownerA = vm.envAddress("OWNER_A");
        address ownerB = vm.envAddress("OWNER_B");
        address ownerC = vm.envAddress("OWNER_C");

        console.log("Deployer:", deployer);
        console.log("Owner A:", ownerA);
        console.log("Owner B:", ownerB);
        console.log("Owner C:", ownerC);

        vm.startBroadcast(deployerKey);
        PanalMultisig msig = new PanalMultisig([ownerA, ownerB, ownerC]);
        vm.stopBroadcast();

        console.log("PanalMultisig:", address(msig));

        address escrowAddr = vm.envOr("ESCROW_V2", address(0));
        if (escrowAddr == address(0)) {
            console.log("ESCROW_V2 no definido: solo deploy. Para migrar el arbitrator:");
            console.log("  cast send <ESCROW_V2> \"transferArbitrator(address)\" <MULTISIG> --rpc-url $RPC --private-key <KEY>");
            return;
        }

        PanalEscrowV2Like escrow = PanalEscrowV2Like(escrowAddr);
        address currentArbitrator = escrow.arbitrator();
        address escrowOwner = escrow.owner();
        console.log("EscrowV2:", escrowAddr);
        console.log("Arbitrator actual:", currentArbitrator);
        console.log("Owner del escrow:", escrowOwner);

        if (currentArbitrator == address(msig)) {
            console.log("El multisig YA es el arbitrator: nada que hacer.");
            return;
        }

        // transferArbitrator solo la puede llamar el arbitrator o el owner actual.
        uint256 transferKey;
        bool canTransfer;
        if (deployer == currentArbitrator || deployer == escrowOwner) {
            transferKey = deployerKey;
            canTransfer = true;
        } else {
            uint256 altKey = vm.envOr("TRANSFER_KEY", uint256(0));
            if (altKey != 0) {
                address alt = vm.addr(altKey);
                if (alt == currentArbitrator || alt == escrowOwner) {
                    transferKey = altKey;
                    canTransfer = true;
                }
            }
        }

        if (!canTransfer) {
            console.log("Ninguna key disponible es arbitrator/owner del escrow: NO se migra.");
            console.log("Ejecutar manualmente con la key autorizada:");
            console.log("  cast send <ESCROW_V2> \"transferArbitrator(address)\" <MULTISIG> --rpc-url $RPC --private-key <KEY>");
            return;
        }

        vm.startBroadcast(transferKey);
        escrow.transferArbitrator(address(msig));
        vm.stopBroadcast();

        console.log("Migracion completada: arbitrator del EscrowV2 = PanalMultisig");
        console.log("AVISO: la EOA anterior ya NO puede resolver disputas.");
    }
}
