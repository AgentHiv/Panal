// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../../src/v2/PanalTablon.sol";

/// Ensayo del despliegue contra una copia de Monad mainnet.
///
/// Las otras pruebas despliegan su propio escrow. Aqui PanalTablon se pone
/// delante del PanalEscrowV2 REAL y un agente que existe de verdad hace un
/// encargo entero, en MON y en $PANAL: si una direccion, el ABI de `tasks()` o
/// el de la reputacion real no encajaran, se veria aqui y no despues de
/// desplegar.
///
///   forge test --match-contract PanalTablonFork --fork-url https://rpc.monad.xyz
contract PanalTablonForkTest is Test {
    address constant ESCROW = 0xe138A9A492CFe27A13f8b7A6D312DA831791bCe9;
    address constant REGISTRY = 0x89a812BFb1c35fc814ef25a3E6Ca75068B16Ac51;
    address constant PANAL_TOKEN = 0x2E2e44E7FA6178822D4397299F719e89d1a67777;
    address constant MULTISIG = 0xc384C1F5D6716571DA84329BeAaE6F064C6b1Fe0;

    /// Agente real, registrado y activo en mainnet.
    address constant LINT = 0x1558cF6aed695F3F8AafE488058EfE28d216E69C;

    PanalTablon tablon;
    ITablonEscrow escrow = ITablonEscrow(ESCROW);
    address client = makeAddr("cliente-fork");

    function setUp() public {
        // Solo corre con --fork-url; sin fork no hay estado que probar.
        if (block.chainid != 143) return;

        PanalTablon.Level[5] memory l;
        l[0] = PanalTablon.Level(5, 400, 1);
        l[1] = PanalTablon.Level(30, 420, 5);
        l[2] = PanalTablon.Level(100, 440, 15);
        l[3] = PanalTablon.Level(300, 450, 40);
        l[4] = PanalTablon.Level(1000, 460, 100);
        tablon = new PanalTablon(
            ESCROW, MULTISIG, l, 2, PanalTablon.Caps(500 ether, 1000 ether), PanalTablon.Caps(2_066_000e18, 4_133_000e18)
        );

        uint8[] memory cats = new uint8[](1);
        vm.prank(LINT);
        tablon.setCategories(cats);

        vm.deal(client, 100 ether);
        deal(PANAL_TOKEN, client, 1_000e18);
        vm.prank(client);
        ITablonToken(PANAL_TOKEN).approve(address(tablon), type(uint256).max);
    }

    function _params(address currency, uint256 amount) internal view returns (PanalTablon.PostParams memory p) {
        p.taskHash = keccak256("encargo de prueba");
        p.currency = currency;
        p.amount = amount;
        p.workDuration = 1 days;
        p.expiresAt = uint64(block.timestamp + 7 days);
        p.mode = PanalTablon.Mode.Immediate;
    }

    function test_se_conecta_a_los_contratos_reales() public view {
        if (block.chainid != 143) return;
        assertEq(address(tablon.registry()), REGISTRY);
        assertEq(tablon.PANAL_TOKEN(), PANAL_TOKEN);
        assertEq(address(tablon.reputation()), 0xAa15923A93B7A2261D051F9F4302ca05e9a16701);
        assertEq(tablon.MIN_NATIVE(), 0.001 ether);
        assertEq(tablon.MIN_TOKEN(), 1e18);
    }

    function test_la_reputacion_real_da_un_nivel() public view {
        if (block.chainid != 143) return;
        TablonReputation memory r = tablon.reputation().getReputation(LINT);
        (uint8 level,) = tablon.levelOf(LINT);
        console.log("Lint: completadas", r.tasksCompleted, "nivel", level);
        if (r.tasksCompleted >= 5 && r.ratingCount > 0 && (r.ratingSum * 100) / r.ratingCount >= 400) {
            assertGe(level, 1);
        } else {
            assertEq(level, 0);
        }
    }

    function _deEntregaACobro(uint256 id, address currency, uint256 amount) internal {
        PanalTablon.Job memory j = tablon.getJob(id);
        (address c, address w, uint256 a,,,,,,) = escrow.tasks(j.escrowTaskId);
        assertEq(c, address(tablon), "en el escrow real el cliente es el tablon");
        assertEq(w, LINT, "la tarea nace asignada");
        assertEq(a, amount);

        uint256 antes = escrow.pendingWithdrawals(currency, LINT);
        vm.prank(LINT);
        IEscrowEntrega(ESCROW).deliverResult(j.escrowTaskId, keccak256("resultado"));
        vm.prank(client);
        tablon.approve(id, 5);
        assertEq(escrow.pendingWithdrawals(currency, LINT) - antes, amount - (amount * 250) / 10_000);
        assertEq(uint8(tablon.getJob(id).state), uint8(PanalTablon.State.Closed));
    }

    function test_un_agente_real_hace_un_encargo_en_MON() public {
        if (block.chainid != 143) return;
        PanalTablon.PostParams memory p = _params(address(0), 2 ether);
        vm.prank(client);
        uint256 id = tablon.post{value: 2 ether}(p);
        vm.prank(LINT);
        tablon.take(id);
        _deEntregaACobro(id, address(0), 2 ether);
    }

    function test_un_agente_real_hace_un_encargo_en_PANAL() public {
        if (block.chainid != 143) return;
        vm.prank(client);
        uint256 id = tablon.post(_params(PANAL_TOKEN, 100e18));
        vm.prank(LINT);
        tablon.take(id);
        assertEq(ITablonToken(PANAL_TOKEN).allowance(address(tablon), ESCROW), 0, "aprobacion a cero");
        _deEntregaACobro(id, PANAL_TOKEN, 100e18);
    }

    function test_sin_entrega_se_cancela_en_el_escrow_real_y_se_cobra() public {
        if (block.chainid != 143) return;
        vm.prank(client);
        uint256 id = tablon.post{value: 1 ether}(_params(address(0), 1 ether));
        vm.prank(LINT);
        tablon.take(id);
        vm.warp(block.timestamp + 1 days + 1);
        tablon.settle(id);
        uint256 antes = client.balance;
        vm.prank(client);
        tablon.claim(address(0));
        assertEq(client.balance - antes, 1 ether);
    }
}

interface IEscrowEntrega {
    function deliverResult(uint256 taskId, bytes32 resultHash) external;
}
