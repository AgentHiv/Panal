// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/PanalNames.sol";

/// Ensayo del despliegue contra una copia de Monad mainnet.
///
/// Las otras pruebas usan un registry y un token de mentira, asi que verifican
/// la logica pero no que las DIRECCIONES sean las correctas. Aqui se despliega
/// sobre el estado real de la cadena y se hace reclamar a un agente que existe
/// de verdad. Si el registry estuviera mal puesto, `isActiveAgent` devolveria
/// false para todo el mundo y el contrato quedaria inservible sin arreglo
/// posible; eso se ve aqui y no despues de pagar el despliegue.
///
///   forge test --match-contract PanalNamesFork --fork-url https://rpc.monad.xyz
contract PanalNamesForkTest is Test {
    address constant PANAL_TOKEN = 0x2E2e44E7FA6178822D4397299F719e89d1a67777;
    address constant REGISTRY = 0x89a812BFb1c35fc814ef25a3E6Ca75068B16Ac51;
    address constant MULTISIG = 0xc384C1F5D6716571DA84329BeAaE6F064C6b1Fe0;

    /// Agentes reales, registrados y activos en mainnet.
    address constant LINT = 0x1558cF6aed695F3F8AafE488058EfE28d216E69C;
    address constant SPEC = 0x7Fb3fC7e8b8c0b1748FbB94e1CD5a9b5620296F6;

    PanalNames names;

    function setUp() public {
        // Solo corre con --fork-url; sin fork no hay estado que probar.
        if (block.chainid != 143) return;

        string[] memory reservados = new string[](3);
        reservados[0] = "panal";
        reservados[1] = "soporte";
        reservados[2] = "bangzhu";

        names = new PanalNames(
            PanalNames.Config({
                panal: PANAL_TOKEN,
                registry: REGISTRY,
                owner: MULTISIG,
                tesoreria: MULTISIG,
                topes: [uint256(50e18), 30e18, 10e18],
                tarifas: [uint256(0), 0, 0],
                comisionBps: 50
            }),
            reservados
        );
    }

    function test_un_agente_real_de_mainnet_reclama_su_nombre() public {
        if (block.chainid != 143) return;

        // Sin un solo $PANAL, que es la situacion de Lint hoy.
        vm.prank(LINT);
        names.reclamar("lint");

        assertEq(names.resolver("lint"), LINT, "el registry real responde");
        assertEq(names.nombreDe(LINT), "lint");

        vm.prank(SPEC);
        names.reclamar("spec");
        assertEq(names.resolver("spec"), SPEC);
    }

    function test_una_direccion_que_no_es_agente_no_reclama() public {
        if (block.chainid != 143) return;

        // El propio multisig: manda en el contrato y aun asi no puede reclamar,
        // porque no es un agente registrado. Para eso existe asignarReservado.
        vm.prank(MULTISIG);
        vm.expectRevert("PanalNames: not an active agent");
        names.reclamar("cualquiera");
    }

    function test_lo_reservado_aguanta_contra_un_agente_real() public {
        if (block.chainid != 143) return;

        vm.prank(LINT);
        vm.expectRevert("PanalNames: reserved");
        names.reclamar("panal");

        vm.prank(LINT);
        vm.expectRevert("PanalNames: reserved");
        names.reclamar("soporte");
    }

    function test_el_multisig_puede_entregar_la_marca_al_agente_oficial() public {
        if (block.chainid != 143) return;

        vm.prank(MULTISIG);
        names.asignarReservado("panal", LINT);
        assertEq(names.resolver("panal"), LINT);
    }

    function test_el_dueno_es_el_multisig_y_solo_el_manda() public {
        if (block.chainid != 143) return;

        assertEq(names.owner(), MULTISIG);

        vm.expectRevert("PanalNames: not owner");
        names.fijarTarifas(1, 1, 1);

        vm.prank(MULTISIG);
        names.fijarTarifas(1e18, 1e18, 1e18);
        assertEq(names.tarifaLargo(), 1e18);
    }
}
