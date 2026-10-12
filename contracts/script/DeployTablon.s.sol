// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/v2/PanalTablon.sol";

/// @notice Despliega PanalTablon: el tablon con reglas delante del escrow v2.
///
/// NO TOCA NADA DE LO QUE YA FUNCIONA. El escrow, el registry y la reputacion
/// siguen como estan: el tablon solo los llama. Los agentes no se registran
/// otra vez y conservan su reputacion. Si sale mal, se pausa (`setPaused`) y se
/// deja de ofrecer; el dinero que tenga dentro se sigue pudiendo cobrar.
///
/// EL DUEÑO ES EL MULTISIG, y desde el primer bloque, como en PanalNames. Con
/// el puede ajustar niveles y topes dentro de los limites fijos del contrato y
/// pausar las publicaciones nuevas; nunca mover dinero ni tocar encargos. Los
/// repartos de disputas (`attestResolution`) los firma el `arbitrator` del
/// escrow, que hoy es ese mismo multisig.
///
/// COMO SE FIRMA. Sin PRIVATE_KEY, se usa el firmante que le pases a forge:
///
///   forge script script/DeployTablon.s.sol:DeployTablon --rpc-url https://rpc.monad.xyz \
///     --broadcast --interactive        (o --account <keystore>, o --ledger)
///
/// ANTES DE DESPLEGAR, el ensayo contra mainnet:
///
///   forge test --match-contract PanalTablonFork --fork-url https://rpc.monad.xyz
///
/// Env opcionales (los defaults son los de Monad mainnet y los de BOARD.md):
///   ESCROW          - default 0xe138...bCe9 (PanalEscrowV2). Registry,
///                     reputacion, token y minimos se leen de el.
///   OWNER           - default 0xc384...1Fe0 (PanalMultisig)
///   NEWCOMER_JOBS   - encargos de novato en total (default 2, maximo 5)
///   CAP_MON_JOB / CAP_MON_TOTAL       - topes de la beta en MON (wei)
///   CAP_PANAL_JOB / CAP_PANAL_TOTAL   - topes de la beta en $PANAL (wei)
///
/// DESPUES DE DESPLEGAR:
///
///   1. Verificar el codigo en el explorador (verificacion/README.md).
///   2. Exportar la direccion al indexador, al SDK y a la web cuando esten
///      listos para leerlo. Mientras nadie lo ofrezca, el tablon de siempre
///      (`worker = address(0)` en el escrow) sigue funcionando igual.
contract DeployTablon is Script {
    address constant ESCROW_DEFAULT = 0xe138A9A492CFe27A13f8b7A6D312DA831791bCe9;
    address constant MULTISIG_DEFAULT = 0xc384C1F5D6716571DA84329BeAaE6F064C6b1Fe0;

    /// Topes de arranque, decididos el 12 de octubre de 2026 (BOARD.md §14):
    /// 500 MON por encargo y 1.000 en total, y su equivalente en $PANAL al
    /// precio de ese dia (1 $PANAL = 0,000242 MON). La multisig los cambia con
    /// `setCaps`, cada moneda por su lado.
    uint256 constant CAP_MON_JOB_DEFAULT = 500 ether;
    uint256 constant CAP_MON_TOTAL_DEFAULT = 1_000 ether;
    uint256 constant CAP_PANAL_JOB_DEFAULT = 2_066_000e18;
    uint256 constant CAP_PANAL_TOTAL_DEFAULT = 4_133_000e18;

    /// @notice Si una direccion es de verdad un contrato. Una cuenta con
    ///         delegacion EIP-7702 tiene 23 bytes de codigo y sigue siendo una
    ///         sola clave: ver DeployNames.s.sol.
    function _esContrato(address a) private view returns (bool) {
        bytes memory codigo = a.code;
        if (codigo.length == 0) return false;
        if (codigo.length == 23 && codigo[0] == 0xef && codigo[1] == 0x01 && codigo[2] == 0x00) return false;
        return true;
    }

    /// La tabla de BOARD.md §6.1: completadas, nota minima x100, encargos al dia.
    function _niveles() private pure returns (PanalTablon.Level[5] memory l) {
        l[0] = PanalTablon.Level(5, 400, 1);
        l[1] = PanalTablon.Level(30, 420, 5);
        l[2] = PanalTablon.Level(100, 440, 15);
        l[3] = PanalTablon.Level(300, 450, 40);
        l[4] = PanalTablon.Level(1000, 460, 100);
    }

    function run() external {
        address escrow = vm.envOr("ESCROW", ESCROW_DEFAULT);
        address owner = vm.envOr("OWNER", MULTISIG_DEFAULT);
        uint8 novatos = uint8(vm.envOr("NEWCOMER_JOBS", uint256(2)));
        PanalTablon.Caps memory mon = PanalTablon.Caps(
            vm.envOr("CAP_MON_JOB", CAP_MON_JOB_DEFAULT), vm.envOr("CAP_MON_TOTAL", CAP_MON_TOTAL_DEFAULT)
        );
        PanalTablon.Caps memory panal = PanalTablon.Caps(
            vm.envOr("CAP_PANAL_JOB", CAP_PANAL_JOB_DEFAULT), vm.envOr("CAP_PANAL_TOTAL", CAP_PANAL_TOTAL_DEFAULT)
        );

        require(_esContrato(escrow), "ESCROW no es un contrato");
        require(_esContrato(owner), "OWNER no es un contrato: revisa que sea el multisig");
        // Sin topes en la beta, un fallo se lo llevaria todo. Quitarlos es una
        // decision de despues de la auditoria, con `setCaps`, no de este script.
        require(mon.perJob > 0 && mon.total > 0, "faltan los topes de MON");
        require(panal.perJob > 0 && panal.total > 0, "faltan los topes de $PANAL");

        uint256 pk = vm.envOr("PRIVATE_KEY", uint256(0));
        if (pk == 0) vm.startBroadcast();
        else vm.startBroadcast(pk);
        PanalTablon tablon = new PanalTablon(escrow, owner, _niveles(), novatos, mon, panal);
        vm.stopBroadcast();

        console2.log("PanalTablon     ", address(tablon));
        console2.log("  escrow        ", address(tablon.escrow()));
        console2.log("  registry      ", address(tablon.registry()));
        console2.log("  reputacion    ", address(tablon.reputation()));
        console2.log("  $PANAL        ", tablon.PANAL_TOKEN());
        console2.log("  owner         ", tablon.owner());
        console2.log("  arbitro       ", ITablonEscrow(escrow).arbitrator());
        console2.log("  novatos       ", tablon.newcomerJobs());
        console2.log("  tope MON      ", mon.perJob, mon.total);
        console2.log("  tope $PANAL   ", panal.perJob, panal.total);
    }
}
