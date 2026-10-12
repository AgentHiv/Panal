// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * Invariantes de PanalTablon (BOARD.md §7.4): el dinero cuadra pase lo que pase.
 *
 * Un `Handler` hace operaciones validas en cualquier orden —publicar en MON y en
 * $PANAL, en los dos modos y con vuelta a publicar; coger, ofertar (tambien por
 * encima del presupuesto), elegir, asignar solo; entregar, aprobar, disputar,
 * resolver y dar el reparto antes o despues del cierre; cerrar, retirar,
 * caducar, cobrar y dejar pasar el tiempo— contra el escrow v2 de verdad. Despues
 * de cada una, por cada moneda:
 *
 *   1. El dinero cuadra al wei:
 *        saldo del tablon + lo que el escrow le tiene acreditado
 *          == publicado + devoluciones sin cobrar + devoluciones de disputas
 *             resueltas que aun esperan su reparto.
 *      Con `<=` bastaria para que nadie se quede sin cobrar; con `==` tambien
 *      salta si el tablon se queda con algo que deberia haber devuelto.
 *   2. Las cuentas son la suma de los encargos: `posted` es lo publicado,
 *      `inEscrow` lo asignado y `owedTotal` lo que se debe a cada cliente.
 *   3. Nunca se reparte mas de lo que el escrow ha acreditado.
 *   4. Los encargos abiertos de cada agente son los suyos asignados.
 */

import "forge-std/Test.sol";
import "../../src/v2/PanalRegistryV2.sol";
import "../../src/v2/PanalEscrowV2.sol";
import "../../src/v2/PanalTablon.sol";
import "../../src/PanalReputation.sol";
import "./mocks/MockERC20.sol";

contract TablonHandler is Test {
    PanalTablon public tablon;
    PanalEscrowV2 public escrow;
    MockERC20 public panal;
    address public arbitrator;

    address[] public clientes;
    address[] public agentes;
    /// El reparto que dio el arbitro en cada encargo, para darlo igual en el tablon.
    mapping(uint256 => uint256) public reparto;
    mapping(uint256 => bool) public resuelto;

    mapping(bytes32 => uint256) public hechas;

    /// Clientes y agentes van en el constructor: una funcion publica para
    /// añadirlos la llamaria el fuzzer tambien.
    constructor(
        PanalTablon _tablon,
        PanalEscrowV2 _escrow,
        MockERC20 _panal,
        address _arbitrator,
        address[] memory _clientes,
        address[] memory _agentes
    ) {
        tablon = _tablon;
        escrow = _escrow;
        panal = _panal;
        arbitrator = _arbitrator;
        clientes = _clientes;
        agentes = _agentes;
    }

    function numClientes() external view returns (uint256) {
        return clientes.length;
    }

    function numAgentes() external view returns (uint256) {
        return agentes.length;
    }

    // ─────────────────────────────────────────── ayudas

    function _hay() internal view returns (bool) {
        return tablon.jobCount() > 0;
    }

    /// Casi siempre uno de los ocho ultimos, que son los que siguen vivos; a
    /// veces cualquiera, para tocar tambien los viejos.
    function _id(uint256 seed) internal view returns (uint256) {
        uint256 n = tablon.jobCount();
        if (seed % 5 == 0 || n <= 8) return (seed >> 8) % n;
        return n - 1 - ((seed >> 8) % 8);
    }

    function _moneda(uint256 seed) internal view returns (address) {
        return seed % 2 == 0 ? address(0) : address(panal);
    }

    // ─────────────────────────────────────────── operaciones

    function publicar(uint256 seed, uint256 cantidad) external {
        address c = clientes[seed % clientes.length];
        address moneda = _moneda(seed >> 8);
        uint256 amount = moneda == address(0) ? bound(cantidad, 0.001 ether, 40 ether) : bound(cantidad, 1e18, 40e18);
        PanalTablon.PostParams memory p;
        p.taskHash = keccak256(abi.encode(seed));
        p.currency = moneda;
        p.amount = amount;
        p.workDuration = uint64(bound(seed >> 16, 1 hours, 3 days));
        p.expiresAt = uint64(block.timestamp + 5 days);
        p.mode = (seed >> 24) % 3 == 0 ? PanalTablon.Mode.Immediate : PanalTablon.Mode.Selection;
        if (p.mode == PanalTablon.Mode.Selection) {
            p.applyWindow = 2 hours;
            p.chooseWindow = 1 days;
        }
        p.relist = (seed >> 32) % 4 == 0;
        vm.prank(c);
        try tablon.post{value: moneda == address(0) ? amount : 0}(p) {
            hechas["publicar"]++;
        } catch {}
    }

    function coger(uint256 agenteSeed, uint256 jobSeed) external {
        if (!_hay()) return;
        uint256 id = _id(jobSeed); // antes del prank: `_id` llama al tablon
        vm.prank(agentes[agenteSeed % agentes.length]);
        try tablon.take(id) {
            hechas["coger"]++;
        } catch {}
    }

    function ofertar(uint256 agenteSeed, uint256 jobSeed, uint256 precio) external {
        if (!_hay()) return;
        uint256 id = _id(jobSeed);
        PanalTablon.Job memory j = tablon.getJob(id);
        uint256 min = j.currency == address(0) ? 0.001 ether : 1e18;
        precio = bound(precio, min, j.amount * 2); // hasta el doble: tambien por encima
        vm.prank(agentes[agenteSeed % agentes.length]);
        try tablon.applyFor(id, precio, 0) {
            hechas["ofertar"]++;
        } catch {}
    }

    function elegir(uint256 jobSeed, uint256 ofertaSeed) external {
        if (!_hay()) return;
        uint256 id = _id(jobSeed);
        PanalTablon.Offer[] memory o = tablon.offers(id);
        if (o.length == 0) return;
        PanalTablon.Offer memory elegida = o[ofertaSeed % o.length];
        PanalTablon.Job memory j = tablon.getJob(id);
        uint256 diff = elegida.price > j.amount ? elegida.price - j.amount : 0;
        vm.prank(j.client);
        try tablon.choose{value: j.currency == address(0) ? diff : 0}(id, elegida.agent) {
            hechas["elegir"]++;
        } catch {}
    }

    function asignarSolo(uint256 jobSeed) external {
        if (!_hay()) return;
        try tablon.autoAssign(_id(jobSeed)) {
            hechas["asignarSolo"]++;
        } catch {}
    }

    function entregar(uint256 jobSeed) external {
        if (!_hay()) return;
        PanalTablon.Job memory j = tablon.getJob(_id(jobSeed));
        if (j.state != PanalTablon.State.Assigned) return;
        vm.prank(j.agent);
        try escrow.deliverResult(j.escrowTaskId, keccak256("hecho")) {
            hechas["entregar"]++;
        } catch {}
    }

    function aprobar(uint256 jobSeed, uint8 rating) external {
        if (!_hay()) return;
        uint256 id = _id(jobSeed);
        PanalTablon.Job memory j = tablon.getJob(id);
        vm.prank(j.client);
        try tablon.approve(id, uint8(bound(rating, 1, 5))) {
            hechas["aprobar"]++;
        } catch {}
    }

    function disputarYResolver(uint256 jobSeed, uint256 bps) external {
        if (!_hay()) return;
        uint256 id = _id(jobSeed);
        PanalTablon.Job memory j = tablon.getJob(id);
        vm.prank(j.client);
        try tablon.dispute(id) {} catch {
            return;
        }
        bps = bound(bps, 0, 10_000);
        vm.prank(arbitrator);
        escrow.resolveDispute(j.escrowTaskId, bps, 3);
        reparto[id] = bps;
        resuelto[id] = true;
        hechas["resolver"]++;
    }

    /// El reparto correcto, antes o despues del cierre.
    function darReparto(uint256 jobSeed) external {
        if (!_hay()) return;
        uint256 id = _id(jobSeed);
        if (!resuelto[id]) return;
        vm.prank(arbitrator);
        try tablon.attestResolution(id, reparto[id]) {
            hechas["reparto"]++;
        } catch {}
    }

    function cerrar(uint256 jobSeed) external {
        if (!_hay()) return;
        uint256 id = _id(jobSeed);
        try tablon.settle(id) {
            hechas["cerrar"]++;
            // Si volvio a publicarse, el reparto viejo ya no vale.
            if (tablon.getJob(id).state == PanalTablon.State.Posted) resuelto[id] = false;
        } catch {}
    }

    function retirar(uint256 jobSeed) external {
        if (!_hay() || jobSeed % 4 != 0) return; // menos a menudo: deja vivir a los demas
        uint256 id = _id(jobSeed);
        vm.prank(tablon.getJob(id).client);
        try tablon.withdrawJob(id) {
            hechas["retirar"]++;
        } catch {}
    }

    function caducar(uint256 jobSeed) external {
        if (!_hay()) return;
        try tablon.expire(_id(jobSeed)) {
            hechas["caducar"]++;
        } catch {}
    }

    function cobrar(uint256 clienteSeed, uint256 monedaSeed) external {
        vm.prank(clientes[clienteSeed % clientes.length]);
        try tablon.claim(_moneda(monedaSeed)) {
            hechas["cobrar"]++;
        } catch {}
    }

    /// Casi siempre poco, para que haya ofertas dentro de su ventana de 2 h; a
    /// veces mucho, para que lleguen plazos, las 72 h y los 14 dias.
    function pasarTiempo(uint256 segundos) external {
        uint256 tope = segundos % 5 == 0 ? 4 days : 40 minutes;
        vm.warp(block.timestamp + bound(segundos >> 8, 1 minutes, tope));
    }
}

contract PanalTablonInvariantsTest is Test {
    PanalRegistryV2 registry;
    PanalReputation reputation;
    PanalEscrowV2 escrow;
    MockERC20 panal;
    PanalTablon tablon;
    TablonHandler handler;
    address arbitrator = makeAddr("arbitrator");

    function setUp() public {
        vm.warp(1_800_000_000);
        panal = new MockERC20("Panal", "PANAL");
        registry = new PanalRegistryV2(address(panal));
        reputation = new PanalReputation();
        escrow =
            new PanalEscrowV2(address(registry), address(reputation), makeAddr("treasury"), arbitrator, address(panal));
        reputation.setEscrow(address(escrow));

        PanalTablon.Level[5] memory l;
        l[0] = PanalTablon.Level(5, 400, 1);
        l[1] = PanalTablon.Level(30, 420, 5);
        l[2] = PanalTablon.Level(100, 440, 15);
        l[3] = PanalTablon.Level(300, 450, 40);
        l[4] = PanalTablon.Level(1000, 460, 100);
        // Tope por encargo en las dos monedas, y total solo en $PANAL: asi se
        // ejercitan los topes sin que el MON se quede sin sitio.
        tablon = new PanalTablon(
            address(escrow), makeAddr("multisig"), l, 2, PanalTablon.Caps(30 ether, 0), PanalTablon.Caps(30e18, 300e18)
        );
        address[] memory clientes = new address[](3);
        address[] memory agentes = new address[](4);
        for (uint256 i; i < 3; i++) {
            address c = makeAddr(string.concat("cliente", vm.toString(i)));
            vm.deal(c, 1_000_000 ether);
            panal.mint(c, 1_000_000e18);
            vm.prank(c);
            panal.approve(address(tablon), type(uint256).max);
            clientes[i] = c;
        }
        // Un novato y agentes de niveles 1, 2 y 5, todos con la categoria 0.
        uint256[4] memory hechasAntes = [uint256(0), 5, 30, 1000];
        for (uint256 i; i < 4; i++) {
            address a = makeAddr(string.concat("agente", vm.toString(i)));
            vm.prank(a);
            registry.registerAgent("ipfs://agente", 1 ether, address(0));
            uint8[] memory cats = new uint8[](1);
            vm.prank(a);
            tablon.setCategories(cats);
            if (hechasAntes[i] > 0) {
                vm.mockCall(
                    address(reputation),
                    abi.encodeWithSelector(PanalReputation.getReputation.selector, a),
                    abi.encode(PanalReputation.Reputation(hechasAntes[i], 0, 480, 100))
                );
            }
            agentes[i] = a;
        }
        handler = new TablonHandler(tablon, escrow, panal, arbitrator, clientes, agentes);
        // Con `vm.prank` cambia quien llama, pero el MON sale del handler.
        vm.deal(address(handler), 1e30);
        targetContract(address(handler));
    }

    function _balance(address moneda) internal view returns (uint256) {
        return moneda == address(0) ? address(tablon).balance : panal.balanceOf(address(tablon));
    }

    function _comprobar(address moneda) internal view {
        (uint256 posted, uint256 inEscrow, uint256 owedTotal, uint256 pulled, uint256 attributed) =
            tablon.books(moneda);
        uint256 pendiente = escrow.pendingWithdrawals(moneda, address(tablon));

        uint256 sumaPublicado;
        uint256 sumaAsignado;
        uint256 sinRepartir;
        for (uint256 i; i < tablon.jobCount(); i++) {
            PanalTablon.Job memory j = tablon.getJob(i);
            if (j.currency != moneda) continue;
            if (j.state == PanalTablon.State.Posted) sumaPublicado += j.amount;
            if (j.state == PanalTablon.State.Assigned) sumaAsignado += j.amount;
            if (j.state == PanalTablon.State.Assigned || (j.state == PanalTablon.State.Closed && j.refundPending)) {
                (,,,,,,, PanalEscrowV2.Status st,) = escrow.tasks(j.escrowTaskId);
                if (st == PanalEscrowV2.Status.Completed && escrow.disputedAt(j.escrowTaskId) > 0) {
                    sinRepartir += j.amount - (j.amount * handler.reparto(i)) / 10_000;
                }
            }
        }

        // 1. Al wei.
        assertEq(_balance(moneda) + pendiente, posted + owedTotal + sinRepartir, "el dinero no cuadra");

        // 2. Las cuentas son la suma de los encargos.
        assertEq(posted, sumaPublicado, "posted no es lo publicado");
        assertEq(inEscrow, sumaAsignado, "inEscrow no es lo asignado");
        uint256 sumaDebida;
        for (uint256 i; i < handler.numClientes(); i++) {
            sumaDebida += tablon.owed(handler.clientes(i), moneda);
        }
        assertEq(owedTotal, sumaDebida, "owedTotal no es lo debido");

        // 3. Nada repartido sin acreditar.
        assertLe(attributed, pulled + pendiente, "repartido mas de lo acreditado");
    }

    /// forge-config: default.invariant.runs = 128
    /// forge-config: default.invariant.depth = 200
    function invariant_elMonCuadra() public view {
        _comprobar(address(0));
    }

    /// forge-config: default.invariant.runs = 128
    /// forge-config: default.invariant.depth = 200
    function invariant_elPanalCuadra() public view {
        _comprobar(address(panal));
    }

    /// forge-config: default.invariant.runs = 128
    /// forge-config: default.invariant.depth = 200
    function invariant_losAbiertosSonLosAsignados() public view {
        for (uint256 a; a < handler.numAgentes(); a++) {
            address agente = handler.agentes(a);
            uint256 asignados;
            for (uint256 i; i < tablon.jobCount(); i++) {
                PanalTablon.Job memory j = tablon.getJob(i);
                if (j.state == PanalTablon.State.Assigned && j.agent == agente) asignados++;
            }
            (,, uint16 open,,) = tablon.agentStats(agente);
            assertEq(open, asignados, "abiertos descuadrados");
        }
    }

    /// Cuantas operaciones de cada tipo llegaron a hacer algo. Solo con
    /// TABLON_RESUMEN=true, para no llenar el log de la CI.
    function afterInvariant() external view {
        if (!vm.envOr("TABLON_RESUMEN", false)) return;
        string[13] memory ops = [
            "publicar",
            "coger",
            "ofertar",
            "elegir",
            "asignarSolo",
            "entregar",
            "aprobar",
            "resolver",
            "reparto",
            "cerrar",
            "retirar",
            "caducar",
            "cobrar"
        ];
        for (uint256 i; i < ops.length; i++) {
            console.log(ops[i], handler.hechas(bytes32(bytes(ops[i]))));
        }
    }
}
