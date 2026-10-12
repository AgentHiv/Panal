// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * PanalTablon contra el escrow v2 de verdad (registry, reputacion y escrow
 * desplegados aqui con el mismo codigo que en mainnet), con un $PANAL de
 * prueba. Cada regla de BOARD.md §6.5 tiene su prueba con su motivo, y cada
 * camino del dinero de §7 la suya.
 *
 * Los niveles salen de la reputacion. Para no tener que completar mil tareas,
 * `_rep()` hace que `getReputation` devuelva lo que haga falta; el resto del
 * escrow y de la reputacion funciona de verdad.
 */

import "forge-std/Test.sol";
import "../../src/v2/PanalRegistryV2.sol";
import "../../src/v2/PanalEscrowV2.sol";
import "../../src/v2/PanalTablon.sol";
import "../../src/PanalReputation.sol";
import "./mocks/MockERC20.sol";
import "./mocks/MockFeeOnTransferERC20.sol";

/// Un cliente que intenta volver a entrar al cobrar.
contract ClienteReentrante {
    PanalTablon public tablon;
    bool public intentar;

    constructor(PanalTablon _tablon) {
        tablon = _tablon;
    }

    function publicar(PanalTablon.PostParams calldata p) external payable returns (uint256) {
        return tablon.post{value: msg.value}(p);
    }

    function retirar(uint256 jobId) external {
        tablon.withdrawJob(jobId);
    }

    function cobrar() external {
        intentar = true;
        tablon.claim(address(0));
    }

    receive() external payable {
        if (intentar) {
            intentar = false;
            tablon.claim(address(0));
        }
    }
}

contract PanalTablonTest is Test {
    PanalRegistryV2 registry;
    PanalReputation reputation;
    PanalEscrowV2 escrow;
    MockERC20 panal;
    PanalTablon tablon;

    address client = makeAddr("client");
    address client2 = makeAddr("client2");
    address treasury = makeAddr("treasury");
    address arbitrator = makeAddr("arbitrator");
    address multisig = makeAddr("multisig");
    address rando = makeAddr("rando");

    address constant MON = address(0);
    uint8 constant VIDEO = 0;
    uint8 constant TRANSLATION = 2;
    bytes32 constant RESULT = keccak256("result");

    PanalTablon.Mode constant IMMEDIATE = PanalTablon.Mode.Immediate;
    PanalTablon.Mode constant SELECTION = PanalTablon.Mode.Selection;

    function setUp() public {
        vm.warp(1_800_000_000); // 2027-01-15 08:00 UTC
        panal = new MockERC20("Panal", "PANAL");
        registry = new PanalRegistryV2(address(panal));
        reputation = new PanalReputation();
        escrow = new PanalEscrowV2(address(registry), address(reputation), treasury, arbitrator, address(panal));
        reputation.setEscrow(address(escrow));
        tablon = new PanalTablon(
            address(escrow),
            multisig,
            _levels(),
            2,
            PanalTablon.Caps(500 ether, 1000 ether),
            PanalTablon.Caps(2_066_000e18, 4_133_000e18)
        );

        for (uint256 i; i < 2; i++) {
            address c = i == 0 ? client : client2;
            vm.deal(c, 10_000 ether);
            panal.mint(c, 10_000_000e18);
            vm.prank(c);
            panal.approve(address(tablon), type(uint256).max);
        }
    }

    // ─────────────────────────────────────────────────────── ayudas

    function _levels() internal pure returns (PanalTablon.Level[5] memory l) {
        l[0] = PanalTablon.Level(5, 400, 1);
        l[1] = PanalTablon.Level(30, 420, 5);
        l[2] = PanalTablon.Level(100, 440, 15);
        l[3] = PanalTablon.Level(300, 450, 40);
        l[4] = PanalTablon.Level(1000, 460, 100);
    }

    /// Un agente registrado, activo y con la categoria de video.
    function _agent(string memory name) internal returns (address a) {
        a = makeAddr(name);
        vm.prank(a);
        registry.registerAgent("ipfs://agente", 1 ether, MON);
        uint8[] memory cats = new uint8[](1);
        cats[0] = VIDEO;
        vm.prank(a);
        tablon.setCategories(cats);
    }

    /// Un agente con `completed` tareas y una media de `rating`/100 estrellas.
    function _agent(string memory name, uint256 completed, uint256 rating) internal returns (address a) {
        a = _agent(name);
        _rep(a, completed, rating);
    }

    function _rep(address a, uint256 completed, uint256 rating) internal {
        vm.mockCall(
            address(reputation),
            abi.encodeWithSelector(PanalReputation.getReputation.selector, a),
            abi.encode(PanalReputation.Reputation(completed, 0, rating, 100))
        );
    }

    function _params(address currency, uint256 amount, PanalTablon.Mode mode)
        internal
        view
        returns (PanalTablon.PostParams memory p)
    {
        p.taskHash = keccak256("brief");
        p.advertHash = keccak256("advert");
        p.category = VIDEO;
        p.currency = currency;
        p.amount = amount;
        p.workDuration = 1 days;
        p.expiresAt = uint64(block.timestamp + 7 days);
        p.mode = mode;
        if (mode == SELECTION) {
            p.applyWindow = 2 hours;
            p.chooseWindow = 24 hours;
        }
    }

    function _post(PanalTablon.PostParams memory p) internal returns (uint256) {
        return _postAs(client, p);
    }

    function _postAs(address who, PanalTablon.PostParams memory p) internal returns (uint256) {
        vm.prank(who);
        return tablon.post{value: p.currency == MON ? p.amount : 0}(p);
    }

    function _post(address currency, uint256 amount, PanalTablon.Mode mode) internal returns (uint256) {
        return _post(_params(currency, amount, mode));
    }

    function _take(address agent, uint256 jobId) internal {
        vm.prank(agent);
        tablon.take(jobId);
    }

    function _apply(address agent, uint256 jobId, uint256 price, uint64 duration) internal {
        vm.prank(agent);
        tablon.applyFor(jobId, price, duration);
    }

    function _job(uint256 jobId) internal view returns (PanalTablon.Job memory) {
        return tablon.getJob(jobId);
    }

    function _deliver(uint256 jobId) internal {
        PanalTablon.Job memory j = _job(jobId);
        vm.prank(j.agent);
        escrow.deliverResult(j.escrowTaskId, RESULT);
    }

    function _approve(uint256 jobId) internal {
        vm.prank(client);
        tablon.approve(jobId, 5);
    }

    function _disputeAndResolve(uint256 jobId, uint256 workerBps) internal {
        _deliver(jobId);
        vm.prank(client);
        tablon.dispute(jobId);
        uint256 tid = _job(jobId).escrowTaskId; // fuera del prank: getJob es otra llamada
        vm.prank(arbitrator);
        escrow.resolveDispute(tid, workerBps, 3);
    }

    function _notAllowed(string memory reason) internal {
        vm.expectRevert(abi.encodeWithSelector(PanalTablon.NotAllowed.selector, reason));
    }

    function _assertReason(address agent, uint256 jobId, string memory expected) internal view {
        (bool ok, string memory reason) = tablon.canTake(agent, jobId);
        assertFalse(ok, "no deberia poder");
        assertEq(reason, expected);
    }

    function _stats(address agent)
        internal
        view
        returns (uint16 takenToday, uint16 open, uint8 newcomerUsed, uint64 suspendedUntil)
    {
        (, takenToday, open, newcomerUsed, suspendedUntil) = tablon.agentStats(agent);
    }

    function _escrowStatus(uint256 jobId) internal view returns (PanalEscrowV2.Status st) {
        (,,,,,,, st,) = escrow.tasks(_job(jobId).escrowTaskId);
    }

    // ─────────────────────────────────────────────────────── despliegue

    function test_lee_del_escrow_todo_lo_que_no_puede_quedar_desparejado() public view {
        assertEq(address(tablon.escrow()), address(escrow));
        assertEq(address(tablon.registry()), address(registry));
        assertEq(address(tablon.reputation()), address(reputation));
        assertEq(tablon.PANAL_TOKEN(), address(panal));
        assertEq(tablon.MIN_NATIVE(), 0.001 ether);
        assertEq(tablon.MIN_TOKEN(), 1e18);
        assertEq(tablon.owner(), multisig);
        assertEq(tablon.newcomerJobs(), 2);
        (uint256 perJob, uint256 total) = tablon.caps(MON);
        assertEq(perJob, 500 ether);
        assertEq(total, 1000 ether);
        (perJob, total) = tablon.caps(address(panal));
        assertEq(perJob, 2_066_000e18);
        assertEq(total, 4_133_000e18);
        (uint32 c, uint16 r, uint16 d) = tablon.levels(4);
        assertEq(c, 1000);
        assertEq(r, 460);
        assertEq(d, 100);
    }

    function test_sin_escrow_o_sin_dueno_no_se_despliega() public {
        vm.expectRevert(PanalTablon.InvalidSetup.selector);
        new PanalTablon(rando, multisig, _levels(), 2, PanalTablon.Caps(0, 0), PanalTablon.Caps(0, 0));
        vm.expectRevert(PanalTablon.InvalidSetup.selector);
        new PanalTablon(address(escrow), address(0), _levels(), 2, PanalTablon.Caps(0, 0), PanalTablon.Caps(0, 0));
    }

    // ─────────────────────────────────────────────────────── camino feliz

    function test_inmediato_en_MON_de_punta_a_punta() public {
        address a = _agent("agente", 5, 400);
        uint256 id = _post(MON, 10 ether, IMMEDIATE);
        assertEq(address(tablon).balance, 10 ether);
        (uint256 posted,,,,) = tablon.books(MON);
        assertEq(posted, 10 ether);

        _take(a, id);
        PanalTablon.Job memory j = _job(id);
        assertEq(uint8(j.state), uint8(PanalTablon.State.Assigned));
        assertEq(j.agent, a);
        (address c, address w, uint256 amount,,, uint256 deadline,,,) = escrow.tasks(j.escrowTaskId);
        assertEq(c, address(tablon), "en el escrow el cliente es el tablon");
        assertEq(w, a, "y la tarea nace ya asignada");
        assertEq(amount, 10 ether);
        assertEq(deadline, block.timestamp + 1 days);
        assertEq(address(tablon).balance, 0);

        _deliver(id);
        _approve(id);
        assertEq(uint8(_job(id).state), uint8(PanalTablon.State.Closed));
        assertEq(escrow.pendingWithdrawals(MON, a), 9.75 ether, "97,5 % al agente");
        assertEq(escrow.pendingWithdrawals(MON, treasury), 0.25 ether);
        (, uint16 open,,) = _stats(a);
        assertEq(open, 0);
        (posted,,,,) = tablon.books(MON);
        assertEq(posted, 0);
    }

    function test_seleccion_en_PANAL_con_oferta_mas_barata() public {
        address a = _agent("a", 30, 420);
        address b = _agent("b", 30, 420);
        uint256 id = _post(address(panal), 1000e18, SELECTION);

        _apply(a, id, 800e18, 12 hours);
        _apply(b, id, 900e18, 0);
        PanalTablon.Offer[] memory o = tablon.offers(id);
        assertEq(o.length, 2);
        assertEq(o[1].workDuration, 1 days, "0 = el plazo del encargo");

        vm.prank(client);
        vm.expectRevert(PanalTablon.OffersOpen.selector);
        tablon.choose(id, b);

        vm.warp(block.timestamp + 2 hours);
        vm.prank(client);
        tablon.choose(id, b);

        assertEq(tablon.owed(client, address(panal)), 100e18, "la diferencia vuelve al cliente");
        (,, uint256 amount,,, uint256 deadline,,,) = escrow.tasks(_job(id).escrowTaskId);
        assertEq(amount, 900e18);
        assertEq(deadline, block.timestamp + 1 days);
        assertEq(panal.allowance(address(tablon), address(escrow)), 0, "aprobacion a cero");
        assertEq(tablon.offers(id).length, 0);

        _deliver(id);
        _approve(id);
        uint256 antes = panal.balanceOf(client);
        vm.prank(client);
        tablon.claim(address(panal));
        assertEq(panal.balanceOf(client) - antes, 100e18);
    }

    function test_oferta_por_encima_del_presupuesto_solo_si_el_cliente_pone_la_diferencia() public {
        address a = _agent("a", 30, 420);
        uint256 id = _post(MON, 10 ether, SELECTION);
        _apply(a, id, 15 ether, 0);
        vm.warp(block.timestamp + 26 hours);

        vm.expectRevert(PanalTablon.NoValidOffer.selector);
        tablon.autoAssign(id);

        vm.prank(client);
        vm.expectRevert(PanalTablon.AmountMismatch.selector);
        tablon.choose{value: 4 ether}(id, a);

        vm.prank(client);
        tablon.choose{value: 5 ether}(id, a);
        (,, uint256 amount,,,,,,) = escrow.tasks(_job(id).escrowTaskId);
        assertEq(amount, 15 ether);
        assertEq(tablon.owed(client, MON), 0);
        assertEq(address(tablon).balance, 0);
    }

    function test_diferencia_en_PANAL_con_transferFrom() public {
        address a = _agent("a", 30, 420);
        uint256 id = _post(address(panal), 100e18, SELECTION);
        _apply(a, id, 150e18, 0);
        vm.warp(block.timestamp + 2 hours);
        uint256 antes = panal.balanceOf(client);

        vm.prank(client);
        vm.expectRevert(PanalTablon.UnexpectedValue.selector);
        tablon.choose{value: 1 ether}(id, a);

        vm.prank(client);
        tablon.choose(id, a);
        assertEq(antes - panal.balanceOf(client), 50e18);
        (,, uint256 amount,,,,,,) = escrow.tasks(_job(id).escrowTaskId);
        assertEq(amount, 150e18);
    }

    function test_elegir_una_oferta_por_debajo_no_admite_MON() public {
        address a = _agent("a", 30, 420);
        uint256 id = _post(MON, 10 ether, SELECTION);
        _apply(a, id, 8 ether, 0);
        vm.warp(block.timestamp + 2 hours);
        vm.prank(client);
        vm.expectRevert(PanalTablon.UnexpectedValue.selector);
        tablon.choose{value: 1 ether}(id, a);
    }

    function test_solo_el_cliente_elige_y_solo_entre_las_ofertas() public {
        address a = _agent("a", 30, 420);
        address b = _agent("b", 30, 420);
        uint256 id = _post(MON, 10 ether, SELECTION);
        _apply(a, id, 10 ether, 0);
        vm.warp(block.timestamp + 2 hours);

        vm.prank(rando);
        vm.expectRevert(PanalTablon.NotClient.selector);
        tablon.choose(id, a);

        vm.prank(client);
        vm.expectRevert(PanalTablon.NoOffer.selector);
        tablon.choose(id, b);
    }

    // ─────────────────────────────────────────────────────── asignacion automatica

    function test_autoAssign_nivel_luego_precio_luego_plazo_luego_el_primero() public {
        address l1 = _agent("l1", 5, 400);
        address caro = _agent("caro", 30, 420);
        address lento = _agent("lento", 30, 420);
        address rapido = _agent("rapido", 30, 420);
        address tarde = _agent("tarde", 30, 420);
        uint256 id = _post(MON, 10 ether, SELECTION);

        _apply(l1, id, 1 ether, 1 hours); // el mas barato, pero nivel 1
        _apply(caro, id, 9 ether, 0);
        _apply(lento, id, 8 ether, 1 days);
        _apply(rapido, id, 8 ether, 12 hours);
        _apply(tarde, id, 8 ether, 12 hours); // empata con `rapido` y llego despues

        vm.warp(block.timestamp + 2 hours);
        vm.expectRevert(PanalTablon.ClientChoosing.selector);
        tablon.autoAssign(id);

        vm.warp(block.timestamp + 24 hours);
        vm.prank(rando);
        tablon.autoAssign(id);
        assertEq(_job(id).agent, rapido);
        assertEq(tablon.owed(client, MON), 2 ether);
    }

    function test_cambiar_la_oferta_renueva_su_turno() public {
        address a = _agent("a", 30, 420);
        address b = _agent("b", 30, 420);
        uint256 id = _post(MON, 10 ether, SELECTION);
        _apply(a, id, 8 ether, 0);
        _apply(b, id, 8 ether, 0);
        _apply(a, id, 8 ether, 0); // la misma oferta otra vez: pasa detras de b
        assertEq(tablon.offers(id).length, 2);

        vm.warp(block.timestamp + 26 hours);
        tablon.autoAssign(id);
        assertEq(_job(id).agent, b);
    }

    function test_autoAssign_salta_a_quien_ya_no_pasa_las_reglas() public {
        address mejor = _agent("mejor", 300, 450);
        address otro = _agent("otro", 30, 420);
        uint256 id = _post(MON, 10 ether, SELECTION);
        _apply(mejor, id, 10 ether, 0);
        _apply(otro, id, 10 ether, 0);

        vm.prank(mejor);
        registry.setActive(false);
        vm.warp(block.timestamp + 26 hours);
        tablon.autoAssign(id);
        assertEq(_job(id).agent, otro);
    }

    function test_el_cliente_no_puede_elegir_a_quien_ya_no_pasa_las_reglas() public {
        address a = _agent("a", 5, 400); // nivel 1: uno al dia
        uint256 id1 = _post(MON, 1 ether, SELECTION);
        uint256 id2 = _post(MON, 1 ether, SELECTION);
        _apply(a, id1, 1 ether, 0);
        _apply(a, id2, 1 ether, 0);
        vm.warp(block.timestamp + 2 hours);
        vm.prank(client);
        tablon.choose(id1, a);

        vm.prank(client);
        _notAllowed("daily quota used");
        tablon.choose(id2, a);
    }

    // ─────────────────────────────────────────────────────── ofertas

    function test_cincuenta_ofertas_y_la_siguiente_desplaza_a_la_mas_debil() public {
        uint256 id = _post(MON, 10 ether, SELECTION);
        address primero;
        for (uint256 i; i < 50; i++) {
            address n = _agent(string.concat("novato", vm.toString(i)));
            if (i == 0) primero = n;
            _apply(n, id, 10 ether, 0);
        }
        assertEq(tablon.offers(id).length, 50);

        address otro = _agent("novato50");
        vm.prank(otro);
        vm.expectRevert(PanalTablon.OffersFull.selector);
        tablon.applyFor(id, 10 ether, 0); // igual de debil: no entra

        vm.expectEmit(true, true, false, false, address(tablon));
        emit PanalTablon.OfferWithdrawn(id, primero);
        _apply(otro, id, 9 ether, 0); // mas barata: desplaza a la primera de las caras
        assertEq(tablon.offers(id).length, 50);

        address veterano = _agent("veterano", 30, 420);
        _apply(veterano, id, 20 ether, 0); // nivel mas alto: entra aunque pida mas
        PanalTablon.Offer[] memory o = tablon.offers(id);
        bool esta;
        for (uint256 i; i < o.length; i++) {
            if (o[i].agent == veterano) esta = true;
        }
        assertTrue(esta);
    }

    function test_retirar_la_oferta_mientras_la_ventana_sigue_abierta() public {
        address a = _agent("a", 30, 420);
        uint256 id = _post(MON, 10 ether, SELECTION);
        _apply(a, id, 9 ether, 0);
        vm.prank(a);
        tablon.withdrawOffer(id);
        assertEq(tablon.offers(id).length, 0);

        vm.prank(a);
        vm.expectRevert(PanalTablon.NoOffer.selector);
        tablon.withdrawOffer(id);

        _apply(a, id, 9 ether, 0);
        vm.warp(block.timestamp + 2 hours);
        vm.prank(a);
        vm.expectRevert(PanalTablon.OffersClosed.selector);
        tablon.withdrawOffer(id);
        vm.prank(a);
        vm.expectRevert(PanalTablon.OffersClosed.selector);
        tablon.applyFor(id, 8 ether, 0);
    }

    function test_limites_de_una_oferta() public {
        address a = _agent("a", 30, 420);
        uint256 id = _post(MON, 10 ether, SELECTION);
        vm.startPrank(a);
        vm.expectRevert(PanalTablon.BelowMinimum.selector);
        tablon.applyFor(id, 0.0001 ether, 0);
        vm.expectRevert(PanalTablon.OverPerJobCap.selector);
        tablon.applyFor(id, 501 ether, 0);
        vm.expectRevert(PanalTablon.TooSlow.selector);
        tablon.applyFor(id, 5 ether, 2 days);
        vm.stopPrank();

        uint256 inmediato = _post(MON, 10 ether, IMMEDIATE);
        vm.prank(a);
        vm.expectRevert(PanalTablon.WrongMode.selector);
        tablon.applyFor(inmediato, 5 ether, 0);
        vm.prank(a);
        vm.expectRevert(PanalTablon.WrongMode.selector);
        tablon.take(id);
    }

    // ─────────────────────────────────────────────────────── retirar y caducar

    function test_retirar_un_encargo_sin_asignar_devuelve_todo() public {
        uint256 id = _post(MON, 10 ether, IMMEDIATE);
        vm.prank(rando);
        vm.expectRevert(PanalTablon.NotClient.selector);
        tablon.withdrawJob(id);

        vm.prank(client);
        tablon.withdrawJob(id);
        assertEq(uint8(_job(id).state), uint8(PanalTablon.State.Withdrawn));
        assertEq(tablon.owed(client, MON), 10 ether);

        uint256 antes = client.balance;
        vm.prank(client);
        tablon.claim(MON);
        assertEq(client.balance - antes, 10 ether);

        vm.prank(client);
        vm.expectRevert(PanalTablon.NothingToClaim.selector);
        tablon.claim(MON);
    }

    function test_caduca_si_nadie_lo_coge() public {
        address a = _agent("a", 5, 400);
        uint256 id = _post(address(panal), 50e18, IMMEDIATE);
        vm.expectRevert(PanalTablon.NotExpired.selector);
        tablon.expire(id);

        vm.warp(block.timestamp + 7 days + 1);
        vm.prank(a);
        vm.expectRevert(PanalTablon.Expired.selector);
        tablon.take(id);

        vm.prank(rando);
        tablon.expire(id);
        assertEq(tablon.owed(client, address(panal)), 50e18);
        vm.expectRevert(PanalTablon.WrongState.selector);
        tablon.expire(id);
    }

    // ─────────────────────────────────────────────────────── las reglas, una a una

    function test_regla_agente_activo() public {
        address nadie = makeAddr("nadie");
        uint8[] memory cats = new uint8[](1);
        vm.prank(nadie);
        tablon.setCategories(cats);
        uint256 id = _post(MON, 1 ether, IMMEDIATE);
        _assertReason(nadie, id, "not an active agent");
        _notAllowed("not an active agent");
        _take(nadie, id);
    }

    function test_regla_su_propio_encargo() public {
        vm.prank(client);
        registry.registerAgent("ipfs://cliente", 1 ether, MON);
        uint8[] memory cats = new uint8[](1);
        vm.prank(client);
        tablon.setCategories(cats);
        _rep(client, 30, 420);
        uint256 id = _post(MON, 1 ether, IMMEDIATE);
        _assertReason(client, id, "own job");
        _notAllowed("own job");
        _take(client, id);
    }

    function test_regla_categoria() public {
        address a = _agent("a", 30, 420);
        uint8[] memory cats = new uint8[](1);
        cats[0] = TRANSLATION;
        vm.prank(a);
        tablon.setCategories(cats);
        uint256 id = _post(MON, 1 ether, IMMEDIATE);
        _assertReason(a, id, "category not declared");
        _notAllowed("category not declared");
        _take(a, id);
    }

    function test_regla_solo_con_experiencia() public {
        address novato = _agent("novato");
        PanalTablon.PostParams memory p = _params(MON, 1 ether, IMMEDIATE);
        p.experiencedOnly = true;
        uint256 id = _post(p);
        _assertReason(novato, id, "experienced only");
        _notAllowed("experienced only");
        _take(novato, id);
    }

    function test_regla_cupo_del_dia_y_cambio_de_dia_UTC() public {
        address a = _agent("a", 5, 400); // nivel 1: 1 al dia
        uint256 id1 = _post(MON, 1 ether, IMMEDIATE);
        uint256 id2 = _post(MON, 1 ether, IMMEDIATE);
        _take(a, id1);
        _deliver(id1);
        _approve(id1);

        _assertReason(a, id2, "daily quota used");
        _notAllowed("daily quota used");
        _take(a, id2);

        // 2027-01-15 08:00 UTC: el dia siguiente empieza en 16 h, no en 24.
        vm.warp(block.timestamp + 16 hours);
        _take(a, id2);
    }

    function test_regla_abiertos_a_la_vez() public {
        address a = _agent("a", 5, 400);
        uint256 id1 = _post(MON, 1 ether, IMMEDIATE);
        PanalTablon.PostParams memory p = _params(MON, 1 ether, IMMEDIATE);
        p.expiresAt = uint64(block.timestamp + 30 days);
        uint256 id2 = _post(p);
        _take(a, id1);
        vm.warp(block.timestamp + 16 hours); // otro dia, pero el primero sigue abierto
        _assertReason(a, id2, "too many open");
        _notAllowed("too many open");
        _take(a, id2);
    }

    function test_nivel_2_coge_cinco_al_dia() public {
        address a = _agent("a", 30, 420);
        for (uint256 i; i < 5; i++) {
            _take(a, _post(MON, 1 ether, IMMEDIATE));
        }
        uint256 sexto = _post(MON, 1 ether, IMMEDIATE);
        _notAllowed("daily quota used");
        _take(a, sexto);
        (uint16 today,,,) = _stats(a);
        assertEq(today, 5);
    }

    function test_novato_dos_en_total_y_de_uno_en_uno() public {
        address n = _agent("novato");
        uint256 id1 = _post(MON, 1 ether, IMMEDIATE);
        uint256 id2 = _post(MON, 1 ether, IMMEDIATE);
        uint256 id3 = _post(MON, 1 ether, IMMEDIATE);
        (,, uint8 usados,) = _stats(n);
        assertEq(usados, 0);

        _take(n, id1);
        _assertReason(n, id2, "newcomer job in progress");
        _notAllowed("newcomer job in progress");
        _take(n, id2);

        _deliver(id1);
        _approve(id1);
        _take(n, id2);
        _deliver(id2);
        _approve(id2);
        (,, usados,) = _stats(n);
        assertEq(usados, tablon.newcomerJobs(), "ha gastado los dos");

        // Dos completadas de verdad en la reputacion: sigue en nivel 0.
        (uint8 level,) = tablon.levelOf(n);
        assertEq(level, 0);
        _assertReason(n, id3, "no newcomer jobs left");

        // La multisig puede subirlo (hasta 5).
        vm.prank(multisig);
        tablon.setNewcomerJobs(3);
        _take(n, id3);
    }

    function test_campana_con_tope_por_agente() public {
        address a = _agent("a", 30, 420);
        PanalTablon.PostParams memory p = _params(MON, 1 ether, IMMEDIATE);
        p.campaignId = keccak256("evento-octubre");
        p.campaignCapPerAgent = 2;
        uint256 id1 = _post(p);
        uint256 id2 = _post(p);
        uint256 id3 = _post(p);
        _take(a, id1);
        _take(a, id2);
        _assertReason(a, id3, "campaign cap reached");
        _notAllowed("campaign cap reached");
        _take(a, id3);

        // La campaña es de quien la creo, con su tope.
        vm.deal(client2, 10 ether);
        vm.prank(client2);
        vm.expectRevert(PanalTablon.InvalidCampaign.selector);
        tablon.post{value: 1 ether}(p);
        p.campaignCapPerAgent = 3;
        vm.prank(client);
        vm.expectRevert(PanalTablon.InvalidCampaign.selector);
        tablon.post{value: 1 ether}(p);
        p.campaignId = keccak256("otra");
        p.campaignCapPerAgent = 0;
        vm.prank(client);
        vm.expectRevert(PanalTablon.InvalidCampaign.selector);
        tablon.post{value: 1 ether}(p);
    }

    function test_canTake_explica_el_estado_del_encargo() public {
        address a = _agent("a", 30, 420);
        (bool ok, string memory reason) = tablon.canTake(a, 99);
        assertEq(reason, "invalid job");

        uint256 id = _post(MON, 1 ether, SELECTION);
        (ok,) = tablon.canTake(a, id);
        assertTrue(ok);
        vm.warp(block.timestamp + 2 hours);
        _assertReason(a, id, "offers closed");
        vm.warp(block.timestamp + 7 days);
        _assertReason(a, id, "expired");
        tablon.expire(id);
        _assertReason(a, id, "not posted");
    }

    function test_niveles_segun_la_reputacion() public {
        address a = _agent("a");
        uint256[2][7] memory casos = [
            [uint256(4), 500], // menos de 5: nivel 0
            [uint256(5), 399], // 5 pero por debajo de 4,0: nivel 0
            [uint256(5), 400],
            [uint256(30), 419], // 30 pero por debajo de 4,2: nivel 1
            [uint256(100), 440],
            [uint256(300), 450],
            [uint256(1000), 460]
        ];
        uint8[7] memory esperado = [0, 0, 1, 1, 3, 4, 5];
        for (uint256 i; i < 7; i++) {
            _rep(a, casos[i][0], casos[i][1]);
            (uint8 level, uint16 cap) = tablon.levelOf(a);
            assertEq(level, esperado[i]);
            if (level == 5) assertEq(cap, 100);
        }
    }

    function test_categorias_hasta_tres_sin_repetir() public {
        uint8[] memory cuatro = new uint8[](4);
        cuatro[1] = 1;
        cuatro[2] = 2;
        cuatro[3] = 3;
        vm.expectRevert(PanalTablon.InvalidCategories.selector);
        tablon.setCategories(cuatro);

        uint8[] memory repetidas = new uint8[](2);
        repetidas[0] = 7;
        repetidas[1] = 7;
        vm.expectRevert(PanalTablon.InvalidCategories.selector);
        tablon.setCategories(repetidas);

        uint8[] memory tres = new uint8[](3);
        tres[0] = 0;
        tres[1] = 9;
        tres[2] = 255;
        vm.prank(rando);
        tablon.setCategories(tres);
        assertEq(tablon.categoryMask(rando), 1 | (1 << 9) | (1 << 255));
    }

    // ─────────────────────────────────────────────────────── sanciones

    function test_sin_entrega_7_dias_fuera_y_settle_cancela_en_el_escrow() public {
        address a = _agent("a", 30, 420);
        uint256 id = _post(MON, 3 ether, IMMEDIATE);
        _take(a, id);

        vm.expectRevert(PanalTablon.NotFinished.selector);
        tablon.settle(id);

        vm.warp(block.timestamp + 1 days + 1);
        vm.prank(rando); // no hace falta el cliente
        tablon.settle(id);

        assertEq(uint8(_escrowStatus(id)), uint8(PanalEscrowV2.Status.Cancelled));
        assertEq(tablon.owed(client, MON), 3 ether);
        (,,, uint64 until) = _stats(a);
        assertEq(until, block.timestamp + 7 days);

        uint256 otro = _post(MON, 1 ether, IMMEDIATE);
        _assertReason(a, otro, "suspended");
        vm.warp(block.timestamp + 7 days);
        _take(a, otro);

        // Y el cliente cobra: el tablon trae el dinero del escrow.
        uint256 antes = client.balance;
        vm.prank(client);
        tablon.claim(MON);
        assertEq(client.balance - antes, 3 ether);
    }

    function _fallar(address a) internal {
        PanalTablon.PostParams memory p = _params(MON, 1 ether, IMMEDIATE);
        uint256 id = _post(p);
        _take(a, id);
        vm.warp(block.timestamp + 1 days + 1);
        tablon.settle(id);
    }

    function test_tres_faltas_en_90_dias_son_30_dias_fuera() public {
        address a = _agent("a", 30, 420);
        _fallar(a);
        vm.warp(block.timestamp + 7 days);
        _fallar(a);
        vm.warp(block.timestamp + 7 days);
        _fallar(a);
        (,,, uint64 until) = _stats(a);
        assertEq(until, block.timestamp + 30 days);
    }

    function test_tres_faltas_repartidas_en_mas_de_90_dias_son_7() public {
        address a = _agent("a", 30, 420);
        _fallar(a);
        vm.warp(block.timestamp + 50 days);
        _fallar(a);
        vm.warp(block.timestamp + 50 days);
        _fallar(a);
        (,,, uint64 until) = _stats(a);
        assertEq(until, block.timestamp + 7 days);
    }

    function test_volver_a_publicar_si_no_entrega() public {
        address a = _agent("a", 30, 420);
        address b = _agent("b", 30, 420);
        PanalTablon.PostParams memory p = _params(MON, 4 ether, IMMEDIATE);
        p.relist = true;
        uint256 id = _post(p);
        _take(a, id);
        vm.warp(block.timestamp + 1 days + 1);

        vm.expectEmit(true, false, false, false, address(tablon));
        emit PanalTablon.JobRelisted(id);
        tablon.settle(id);

        PanalTablon.Job memory j = _job(id);
        assertEq(uint8(j.state), uint8(PanalTablon.State.Posted));
        assertEq(j.amount, 4 ether);
        assertEq(j.expiresAt, block.timestamp + 7 days, "vuelve con su plazo de publicacion entero");
        assertEq(tablon.owed(client, MON), 0, "no se devuelve: se vuelve a publicar");
        assertEq(address(tablon).balance, 0);
        assertEq(escrow.pendingWithdrawals(MON, address(tablon)), 4 ether);

        _take(b, id); // el dinero viene del escrow
        (,,, uint256 pulled,) = tablon.books(MON);
        assertEq(pulled, 4 ether);
        (,, uint256 amount,,,,,,) = escrow.tasks(_job(id).escrowTaskId);
        assertEq(amount, 4 ether);
    }

    // ─────────────────────────────────────────────────────── disputas

    function test_disputa_perdida_reparto_despues_del_settle() public {
        address a = _agent("a", 30, 420);
        uint256 id = _post(MON, 10 ether, IMMEDIATE);
        _take(a, id);
        _disputeAndResolve(id, 3_000);

        vm.expectEmit(true, false, false, false, address(tablon));
        emit PanalTablon.RefundPending(id);
        tablon.settle(id);
        PanalTablon.Job memory j = _job(id);
        assertEq(uint8(j.state), uint8(PanalTablon.State.Closed));
        assertTrue(j.refundPending);
        (, uint16 open,,) = _stats(a);
        assertEq(open, 0, "la parte del agente se cierra ya");

        vm.prank(arbitrator);
        tablon.attestResolution(id, 3_000);
        assertEq(tablon.owed(client, MON), 7 ether);
        assertFalse(_job(id).refundPending);
        (,,, uint64 until) = _stats(a);
        assertEq(until, 0, "perder una disputa es una falta, no una suspension");

        uint256 antes = client.balance;
        vm.prank(client);
        tablon.claim(MON);
        assertEq(client.balance - antes, 7 ether);
    }

    function test_disputa_ganada_reparto_antes_del_settle() public {
        address a = _agent("a", 30, 420);
        uint256 id = _post(address(panal), 1000e18, IMMEDIATE);
        _take(a, id);
        _disputeAndResolve(id, 7_000);
        vm.prank(arbitrator);
        tablon.attestResolution(id, 7_000);

        vm.expectEmit(true, false, false, true, address(tablon));
        emit PanalTablon.JobSettled(id, 300e18, false);
        tablon.settle(id);
        assertEq(tablon.owed(client, address(panal)), 300e18);
    }

    function test_disputa_abierta_por_el_agente() public {
        address a = _agent("a", 30, 420);
        uint256 id = _post(MON, 2 ether, IMMEDIATE);
        _take(a, id);
        _deliver(id);
        uint256 tid = _job(id).escrowTaskId;
        vm.prank(a);
        escrow.openDispute(tid);
        vm.prank(arbitrator);
        escrow.resolveDispute(tid, 10_000, 4);
        vm.prank(arbitrator);
        tablon.attestResolution(id, 10_000);
        tablon.settle(id);
        assertEq(tablon.owed(client, MON), 0);
        assertEq(uint8(_job(id).state), uint8(PanalTablon.State.Closed));
    }

    function test_disputa_atascada_14_dias_lo_devuelve_todo_sin_sancion() public {
        address a = _agent("a", 30, 420);
        uint256 id = _post(MON, 2 ether, IMMEDIATE);
        _take(a, id);
        _deliver(id);
        vm.prank(client);
        tablon.dispute(id);

        vm.warp(block.timestamp + 14 days);
        tablon.settle(id);
        assertEq(uint8(_escrowStatus(id)), uint8(PanalEscrowV2.Status.Cancelled));
        assertEq(tablon.owed(client, MON), 2 ether);
        (,,, uint64 until) = _stats(a);
        assertEq(until, 0);
    }

    function test_liberacion_a_las_72_h_desde_settle() public {
        address a = _agent("a", 30, 420);
        uint256 id = _post(MON, 2 ether, IMMEDIATE);
        _take(a, id);
        _deliver(id);
        vm.expectRevert(PanalTablon.NotFinished.selector);
        tablon.settle(id);
        vm.warp(block.timestamp + 3 days);
        tablon.settle(id);
        assertEq(uint8(_escrowStatus(id)), uint8(PanalEscrowV2.Status.Completed));
        assertEq(escrow.pendingWithdrawals(MON, a), 1.95 ether);
    }

    function test_solo_el_cliente_aprueba_y_disputa() public {
        address a = _agent("a", 30, 420);
        uint256 id = _post(MON, 2 ether, IMMEDIATE);
        _take(a, id);
        _deliver(id);
        vm.startPrank(rando);
        vm.expectRevert(PanalTablon.NotClient.selector);
        tablon.approve(id, 5);
        vm.expectRevert(PanalTablon.NotClient.selector);
        tablon.dispute(id);
        vm.stopPrank();
    }

    // ─────────────────────────────────────────────────────── el reparto del arbitro

    function test_reparto_solo_del_arbitro_y_con_disputa_resuelta() public {
        address a = _agent("a", 30, 420);
        uint256 id = _post(MON, 2 ether, IMMEDIATE);
        _take(a, id);

        vm.prank(rando);
        vm.expectRevert(PanalTablon.NotArbitrator.selector);
        tablon.attestResolution(id, 5_000);

        vm.startPrank(arbitrator);
        vm.expectRevert(PanalTablon.InvalidShare.selector);
        tablon.attestResolution(id, 10_001);
        vm.expectRevert(PanalTablon.NoResolvedDispute.selector);
        tablon.attestResolution(id, 5_000);
        vm.stopPrank();

        _deliver(id);
        _approve(id); // completado sin disputa
        vm.prank(arbitrator);
        vm.expectRevert(PanalTablon.WrongState.selector);
        tablon.attestResolution(id, 5_000);
    }

    function test_un_reparto_que_pide_mas_de_lo_acreditado_no_pasa_y_se_corrige() public {
        address a = _agent("a", 30, 420);
        uint256 id = _post(MON, 2 ether, IMMEDIATE);
        _take(a, id);
        _disputeAndResolve(id, 10_000); // todo al agente: al tablon no vuelve nada
        tablon.settle(id);

        vm.prank(arbitrator);
        vm.expectRevert(PanalTablon.RefundNotCredited.selector);
        tablon.attestResolution(id, 0); // "todo al cliente": falso

        vm.prank(arbitrator);
        tablon.attestResolution(id, 10_000);
        assertEq(tablon.owed(client, MON), 0);
        assertFalse(_job(id).refundPending);

        vm.prank(arbitrator);
        vm.expectRevert(PanalTablon.WrongState.selector);
        tablon.attestResolution(id, 10_000); // aplicado: definitivo
    }

    function test_un_reparto_equivocado_antes_del_settle_no_bloquea_el_cierre() public {
        address a = _agent("a", 30, 420);
        uint256 id = _post(MON, 2 ether, IMMEDIATE);
        _take(a, id);
        _disputeAndResolve(id, 5_000);
        vm.prank(arbitrator);
        tablon.attestResolution(id, 0); // pide 2 MON y solo hay 1 acreditado

        tablon.settle(id); // cierra la parte del agente igualmente
        assertTrue(_job(id).refundPending);
        (, uint16 open,,) = _stats(a);
        assertEq(open, 0);

        vm.prank(arbitrator);
        tablon.attestResolution(id, 5_000);
        assertEq(tablon.owed(client, MON), 1 ether);
    }

    // ─────────────────────────────────────────────────────── topes

    function test_topes_por_encargo_y_total() public {
        vm.prank(client);
        vm.expectRevert(PanalTablon.OverPerJobCap.selector);
        tablon.post{value: 501 ether}(_params(MON, 501 ether, IMMEDIATE));

        _post(MON, 500 ether, IMMEDIATE);
        _post(MON, 500 ether, IMMEDIATE);
        vm.prank(client);
        vm.expectRevert(PanalTablon.OverTotalCap.selector);
        tablon.post{value: 1 ether}(_params(MON, 1 ether, IMMEDIATE));

        // En $PANAL van aparte.
        _post(address(panal), 2_066_000e18, IMMEDIATE);
    }

    function test_el_total_cuenta_tambien_lo_que_esta_en_el_escrow() public {
        address a = _agent("a", 30, 420);
        uint256 id = _post(MON, 500 ether, IMMEDIATE);
        _take(a, id);
        _post(MON, 500 ether, IMMEDIATE);
        vm.prank(client);
        vm.expectRevert(PanalTablon.OverTotalCap.selector);
        tablon.post{value: 1 ether}(_params(MON, 1 ether, IMMEDIATE));

        _deliver(id);
        _approve(id); // cerrado: deja sitio
        _post(MON, 1 ether, IMMEDIATE);
    }

    function test_la_diferencia_de_una_oferta_tambien_respeta_los_topes() public {
        address a = _agent("a", 30, 420);
        _post(MON, 500 ether, IMMEDIATE);
        _post(MON, 499 ether, IMMEDIATE);
        uint256 id = _post(MON, 1 ether, SELECTION);
        _apply(a, id, 2 ether, 0);
        vm.warp(block.timestamp + 2 hours);
        vm.prank(client);
        vm.expectRevert(PanalTablon.OverTotalCap.selector);
        tablon.choose{value: 1 ether}(id, a);

        vm.prank(multisig);
        tablon.setCaps(MON, 1 ether, 0); // sin tope total, pero 1 por encargo
        vm.prank(client);
        vm.expectRevert(PanalTablon.OverPerJobCap.selector);
        tablon.choose{value: 1 ether}(id, a);
    }

    function test_cambiar_los_topes_no_toca_los_encargos() public {
        address a = _agent("a", 30, 420);
        uint256 id = _post(MON, 400 ether, IMMEDIATE);

        vm.prank(rando);
        vm.expectRevert(PanalTablon.NotOwner.selector);
        tablon.setCaps(MON, 1 ether, 1 ether);

        vm.prank(multisig);
        tablon.setCaps(MON, 10 ether, 10 ether);
        _take(a, id); // ya estaba dentro: sigue

        vm.prank(client);
        vm.expectRevert(PanalTablon.OverPerJobCap.selector);
        tablon.post{value: 11 ether}(_params(MON, 11 ether, IMMEDIATE));

        vm.prank(multisig);
        tablon.setCaps(MON, 0, 0); // sin topes
        _post(MON, 2000 ether, IMMEDIATE);

        vm.prank(multisig);
        vm.expectRevert(PanalTablon.UnsupportedCurrency.selector);
        tablon.setCaps(rando, 0, 0);
    }

    // ─────────────────────────────────────────────────────── administracion

    function test_la_tabla_de_niveles_tiene_limites_fijos() public {
        PanalTablon.Level[5] memory l = _levels();
        vm.startPrank(multisig);

        l[4].dailyCap = 101;
        vm.expectRevert(PanalTablon.InvalidLevels.selector);
        tablon.setLevels(l);

        l = _levels();
        l[0].minRating = 349;
        vm.expectRevert(PanalTablon.InvalidLevels.selector);
        tablon.setLevels(l);

        l = _levels();
        l[2].minCompleted = 30; // igual que el nivel 2
        vm.expectRevert(PanalTablon.InvalidLevels.selector);
        tablon.setLevels(l);

        l = _levels();
        l[3].dailyCap = 10; // por debajo del nivel 3
        vm.expectRevert(PanalTablon.InvalidLevels.selector);
        tablon.setLevels(l);

        l = _levels();
        l[0].minCompleted = 0;
        vm.expectRevert(PanalTablon.InvalidLevels.selector);
        tablon.setLevels(l);

        l = _levels();
        l[0] = PanalTablon.Level(3, 380, 2);
        tablon.setLevels(l);
        vm.stopPrank();

        address a = _agent("a", 3, 380);
        (uint8 level, uint16 cap) = tablon.levelOf(a);
        assertEq(level, 1);
        assertEq(cap, 2);

        vm.prank(rando);
        vm.expectRevert(PanalTablon.NotOwner.selector);
        tablon.setLevels(l);
    }

    function test_novatos_hasta_cinco() public {
        vm.prank(multisig);
        vm.expectRevert(PanalTablon.TooManyNewcomerJobs.selector);
        tablon.setNewcomerJobs(6);
    }

    function test_la_pausa_solo_frena_las_publicaciones() public {
        address a = _agent("a", 30, 420);
        uint256 id = _post(MON, 1 ether, IMMEDIATE);
        uint256 otro = _post(MON, 1 ether, IMMEDIATE);
        vm.prank(multisig);
        tablon.setPaused(true);

        vm.prank(client);
        vm.expectRevert(PanalTablon.IsPaused.selector);
        tablon.post{value: 1 ether}(_params(MON, 1 ether, IMMEDIATE));

        _take(a, id);
        vm.prank(client);
        tablon.withdrawJob(otro);
        vm.prank(client);
        tablon.claim(MON);
    }

    function test_cambiar_de_dueno() public {
        vm.prank(multisig);
        tablon.transferOwnership(rando);
        assertEq(tablon.owner(), rando);
        vm.prank(rando);
        vm.expectRevert(PanalTablon.InvalidSetup.selector);
        tablon.transferOwnership(address(0));
    }

    // ─────────────────────────────────────────────────────── el dinero

    function test_publicar_con_datos_que_no_cuadran() public {
        PanalTablon.PostParams memory p = _params(MON, 1 ether, IMMEDIATE);
        vm.startPrank(client);
        vm.expectRevert(PanalTablon.AmountMismatch.selector);
        tablon.post{value: 0.5 ether}(p);

        p.amount = 0.0001 ether;
        vm.expectRevert(PanalTablon.BelowMinimum.selector);
        tablon.post{value: 0.0001 ether}(p);

        p = _params(address(panal), 10e18, IMMEDIATE);
        vm.expectRevert(PanalTablon.UnexpectedValue.selector);
        tablon.post{value: 1}(p);

        p.currency = rando;
        vm.expectRevert(PanalTablon.UnsupportedCurrency.selector);
        tablon.post(p);

        p = _params(MON, 1 ether, IMMEDIATE);
        p.workDuration = 0;
        vm.expectRevert(PanalTablon.InvalidTimes.selector);
        tablon.post{value: 1 ether}(p);

        p = _params(MON, 1 ether, IMMEDIATE);
        p.expiresAt = uint64(block.timestamp);
        vm.expectRevert(PanalTablon.InvalidTimes.selector);
        tablon.post{value: 1 ether}(p);

        p = _params(MON, 1 ether, SELECTION);
        p.applyWindow = 0;
        vm.expectRevert(PanalTablon.InvalidTimes.selector);
        tablon.post{value: 1 ether}(p);

        p = _params(MON, 1 ether, SELECTION);
        p.expiresAt = uint64(block.timestamp + 25 hours); // antes de que acabe la eleccion
        vm.expectRevert(PanalTablon.InvalidTimes.selector);
        tablon.post{value: 1 ether}(p);
        vm.stopPrank();
    }

    function test_solo_entra_MON_del_escrow() public {
        vm.deal(rando, 1 ether);
        vm.prank(rando);
        (bool ok,) = address(tablon).call{value: 1 ether}("");
        assertFalse(ok);
    }

    function test_cobrar_no_admite_reentrada() public {
        ClienteReentrante malo = new ClienteReentrante(tablon);
        vm.deal(address(malo), 0);
        PanalTablon.PostParams memory p = _params(MON, 1 ether, IMMEDIATE);
        uint256 id = malo.publicar{value: 1 ether}(p);
        malo.retirar(id);

        vm.expectRevert(PanalTablon.TransferFailed.selector);
        malo.cobrar();
        assertEq(tablon.owed(address(malo), MON), 1 ether, "sigue debiendose entero");
    }

    function test_un_token_con_comision_al_transferir_no_cuadra() public {
        MockFeeOnTransferERC20 fot = new MockFeeOnTransferERC20();
        PanalRegistryV2 r2 = new PanalRegistryV2(address(fot));
        PanalReputation rep2 = new PanalReputation();
        PanalEscrowV2 e2 = new PanalEscrowV2(address(r2), address(rep2), treasury, arbitrator, address(fot));
        rep2.setEscrow(address(e2));
        PanalTablon t2 =
            new PanalTablon(address(e2), multisig, _levels(), 2, PanalTablon.Caps(0, 0), PanalTablon.Caps(0, 0));

        fot.mint(client, 1000e18);
        vm.startPrank(client);
        fot.approve(address(t2), type(uint256).max);
        vm.expectRevert(PanalTablon.AmountMismatch.selector);
        t2.post(_params(address(fot), 100e18, IMMEDIATE));
        vm.stopPrank();
    }
}
