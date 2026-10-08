// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * Invariantes del escrow: el dinero que tiene el contrato es, al wei, el que
 * debe.
 *
 * Las 213 pruebas unitarias comprueban caminos concretos que alguien pensó.
 * Esto comprueba lo que nadie pensó: un `Handler` hace miles de operaciones
 * válidas en cualquier orden —crear en MON y en $PANAL, coger del tablón,
 * entregar, aprobar, liberar por tiempo, disputar, resolver, cancelar, retirar
 * y hacer pasar días— y después de cada una Foundry exige que se cumpla:
 *
 *     saldo del escrow == lo bloqueado en tareas vivas + lo acreditado a todos
 *
 * por cada moneda por separado. Si alguna combinación crea o pierde un solo
 * wei —una comisión que se cobra dos veces, un reembolso que no descuenta, una
 * retirada que no pone a cero—, esto falla con la secuencia exacta que lo
 * provoca.
 *
 * Añadido el 2026-10-08, con el escrow ya en mainnet: no cambia el contrato,
 * vigila el que hay.
 */

import "forge-std/Test.sol";
import "../../src/v2/PanalRegistryV2.sol";
import "../../src/v2/PanalEscrowV2.sol";
import "../../src/PanalReputation.sol";
import "./mocks/MockERC20.sol";

contract EscrowHandler is Test {
    PanalEscrowV2 public escrow;
    MockERC20 public panal;
    address public arbitrator;
    address public treasury;

    address[] public clientes;
    address[] public trabajadores;
    /// Todos los que pueden tener algo acreditado: para sumar y para retirar.
    address[] public cuentas;

    /// Cuántas llamadas de cada tipo llegaron a hacer algo, para el resumen.
    mapping(bytes32 => uint256) public hechas;

    constructor(PanalEscrowV2 _escrow, MockERC20 _panal, address _arbitrator, address _treasury, PanalRegistryV2 registry) {
        escrow = _escrow;
        panal = _panal;
        arbitrator = _arbitrator;
        treasury = _treasury;
        for (uint256 i; i < 3; i++) {
            address c = makeAddr(string.concat("cliente", vm.toString(i)));
            address w = makeAddr(string.concat("trabajador", vm.toString(i)));
            clientes.push(c);
            trabajadores.push(w);
            cuentas.push(c);
            cuentas.push(w);
            vm.prank(w);
            registry.registerAgent("ipfs://trabajador", 1e18, address(_panal));
        }
        cuentas.push(_treasury);
    }

    function numCuentas() external view returns (uint256) {
        return cuentas.length;
    }

    // ---- Utilidades ---------------------------------------------------------

    function _tarea(uint256 semilla) internal view returns (bool hay, uint256 id) {
        uint256 n = escrow.getTaskCount();
        if (n == 0) return (false, 0);
        return (true, semilla % n);
    }

    function _estado(uint256 id)
        internal
        view
        returns (address client, address worker, uint256 deadline, PanalEscrowV2.Status st)
    {
        (client, worker,,,, deadline,, st,) = escrow.tasks(id);
    }

    // ---- Acciones -----------------------------------------------------------

    function crear(uint256 sCliente, uint256 sTrabajador, bool enToken, bool alTablon, uint256 importe, uint256 plazo)
        external
    {
        address cliente = clientes[sCliente % clientes.length];
        address trabajador = alTablon ? address(0) : trabajadores[sTrabajador % trabajadores.length];
        // Plazos largos y saltos de tiempo cortos: si no, casi todo caduca antes
        // de entregarse y los caminos de después (liberar, disputar) no se pisan.
        plazo = bound(plazo, 1 days, 60 days);
        if (enToken) {
            importe = bound(importe, 1e18, 1_000_000e18);
            panal.mint(cliente, importe);
            vm.startPrank(cliente);
            panal.approve(address(escrow), importe);
            escrow.createTask(trabajador, keccak256("encargo"), block.timestamp + plazo, address(panal), importe);
            vm.stopPrank();
        } else {
            importe = bound(importe, 0.001 ether, 1_000 ether);
            vm.deal(cliente, importe);
            vm.prank(cliente);
            escrow.createTask{value: importe}(trabajador, keccak256("encargo"), block.timestamp + plazo, address(0), importe);
        }
        hechas["crear"]++;
    }

    function coger(uint256 sTarea, uint256 sTrabajador) external {
        (bool hay, uint256 id) = _tarea(sTarea);
        if (!hay) return;
        (address client, address worker,, PanalEscrowV2.Status st) = _estado(id);
        address quien = trabajadores[sTrabajador % trabajadores.length];
        if (st != PanalEscrowV2.Status.Open || worker != address(0) || quien == client) return;
        vm.prank(quien);
        escrow.claimTask(id);
        hechas["coger"]++;
    }

    /// Crear con trabajador y entregar en la misma llamada: es el camino feliz
    /// de casi todos los encargos reales, y sin él los de después se pisan poco.
    function crearYEntregar(uint256 sCliente, uint256 sTrabajador, bool enToken, uint256 importe) external {
        this.crear(sCliente, sTrabajador, enToken, false, importe, 7 days);
        uint256 id = escrow.getTaskCount() - 1;
        (, address worker,,) = _estado(id);
        vm.prank(worker);
        escrow.deliverResult(id, keccak256("entrega"));
        hechas["entregar"]++;
    }

    function entregar(uint256 sTarea) external {
        (bool hay, uint256 id) = _tarea(sTarea);
        if (!hay) return;
        (, address worker, uint256 deadline, PanalEscrowV2.Status st) = _estado(id);
        if (st != PanalEscrowV2.Status.Open || worker == address(0) || block.timestamp > deadline) return;
        vm.prank(worker);
        escrow.deliverResult(id, keccak256("entrega"));
        hechas["entregar"]++;
    }

    function aprobar(uint256 sTarea, uint8 valoracion) external {
        (bool hay, uint256 id) = _tarea(sTarea);
        if (!hay) return;
        (address client,,, PanalEscrowV2.Status st) = _estado(id);
        if (st != PanalEscrowV2.Status.Delivered) return;
        vm.prank(client);
        escrow.approveAndRelease(id, uint8(bound(valoracion, 1, 5)));
        hechas["aprobar"]++;
    }

    function liberarPorTiempo(uint256 sTarea) external {
        (bool hay, uint256 id) = _tarea(sTarea);
        if (!hay) return;
        (,,, PanalEscrowV2.Status st) = _estado(id);
        if (st != PanalEscrowV2.Status.Delivered) return;
        if (block.timestamp < escrow.deliveredAt(id) + escrow.AUTO_RELEASE()) {
            vm.warp(escrow.deliveredAt(id) + escrow.AUTO_RELEASE());
        }
        escrow.autoRelease(id);
        hechas["liberar"]++;
    }

    function disputar(uint256 sTarea, bool porElTrabajador) external {
        (bool hay, uint256 id) = _tarea(sTarea);
        if (!hay) return;
        (address client, address worker,, PanalEscrowV2.Status st) = _estado(id);
        if (st != PanalEscrowV2.Status.Delivered) return;
        vm.prank(porElTrabajador ? worker : client);
        escrow.openDispute(id);
        hechas["disputar"]++;
    }

    function resolver(uint256 sTarea, uint256 parteBps, uint8 valoracion) external {
        (bool hay, uint256 id) = _tarea(sTarea);
        if (!hay) return;
        (,,, PanalEscrowV2.Status st) = _estado(id);
        if (st != PanalEscrowV2.Status.Disputed) return;
        vm.prank(arbitrator);
        escrow.resolveDispute(id, bound(parteBps, 0, 10_000), uint8(bound(valoracion, 1, 5)));
        hechas["resolver"]++;
    }

    function resolverAtascada(uint256 sTarea) external {
        (bool hay, uint256 id) = _tarea(sTarea);
        if (!hay) return;
        (,,, PanalEscrowV2.Status st) = _estado(id);
        if (st != PanalEscrowV2.Status.Disputed) return;
        if (block.timestamp < escrow.disputedAt(id) + escrow.DISPUTE_TIMEOUT()) {
            vm.warp(escrow.disputedAt(id) + escrow.DISPUTE_TIMEOUT());
        }
        escrow.resolveStuckDispute(id);
        hechas["atascada"]++;
    }

    function cancelar(uint256 sTarea) external {
        (bool hay, uint256 id) = _tarea(sTarea);
        if (!hay) return;
        (address client, address worker, uint256 deadline, PanalEscrowV2.Status st) = _estado(id);
        if (st != PanalEscrowV2.Status.Open) return;
        if (worker != address(0) && block.timestamp <= deadline) vm.warp(deadline + 1);
        vm.prank(client);
        escrow.cancelTask(id);
        hechas["cancelar"]++;
    }

    function retirar(uint256 sCuenta, bool enToken) external {
        address quien = cuentas[sCuenta % cuentas.length];
        address moneda = enToken ? address(panal) : address(0);
        if (escrow.pendingWithdrawals(moneda, quien) == 0) return;
        vm.prank(quien);
        escrow.withdraw(moneda);
        hechas["retirar"]++;
    }

    function pasarElTiempo(uint256 segundos) external {
        vm.warp(block.timestamp + bound(segundos, 1, 12 hours));
    }
}

contract PanalEscrowV2InvariantTest is StdInvariant, Test {
    PanalRegistryV2 registry;
    PanalReputation reputation;
    PanalEscrowV2 escrow;
    MockERC20 panal;
    EscrowHandler handler;

    address treasury = makeAddr("tesoreria");
    address arbitrator = makeAddr("arbitro");

    function setUp() public {
        panal = new MockERC20("Panal", "PANAL");
        registry = new PanalRegistryV2(address(panal));
        reputation = new PanalReputation();
        escrow = new PanalEscrowV2(address(registry), address(reputation), treasury, arbitrator, address(panal));
        reputation.setEscrow(address(escrow));
        handler = new EscrowHandler(escrow, panal, arbitrator, treasury, registry);
        targetContract(address(handler));
    }

    /// Lo bloqueado en tareas que todavía pueden mover dinero, por moneda.
    function _bloqueado(address moneda) internal view returns (uint256 total) {
        uint256 n = escrow.getTaskCount();
        for (uint256 i; i < n; i++) {
            (,, uint256 amount,,,,, PanalEscrowV2.Status st, address currency) = escrow.tasks(i);
            if (currency != moneda) continue;
            if (
                st == PanalEscrowV2.Status.Open || st == PanalEscrowV2.Status.Delivered
                    || st == PanalEscrowV2.Status.Disputed
            ) total += amount;
        }
    }

    /// Lo acreditado y aún sin retirar, por moneda, sumado entre todos.
    function _acreditado(address moneda) internal view returns (uint256 total) {
        uint256 n = handler.numCuentas();
        for (uint256 i; i < n; i++) {
            total += escrow.pendingWithdrawals(moneda, handler.cuentas(i));
        }
    }

    /// EL invariante: ni un wei de más ni de menos, en MON.
    /// forge-config: default.invariant.runs = 128
    /// forge-config: default.invariant.depth = 200
    function invariant_elMonCuadra() public view {
        assertEq(address(escrow).balance, _bloqueado(address(0)) + _acreditado(address(0)), "MON descuadrado");
    }

    /// Y lo mismo en $PANAL.
    /// forge-config: default.invariant.runs = 128
    /// forge-config: default.invariant.depth = 200
    function invariant_elPanalCuadra() public view {
        assertEq(
            panal.balanceOf(address(escrow)),
            _bloqueado(address(panal)) + _acreditado(address(panal)),
            "$PANAL descuadrado"
        );
    }

    /// Una tarea entregada o cerrada por entrega lleva siempre su huella.
    /// forge-config: default.invariant.runs = 128
    /// forge-config: default.invariant.depth = 200
    function invariant_loEntregadoTieneHuella() public view {
        uint256 n = escrow.getTaskCount();
        for (uint256 i; i < n; i++) {
            (,,,, bytes32 resultHash,,, PanalEscrowV2.Status st,) = escrow.tasks(i);
            if (st == PanalEscrowV2.Status.Delivered || st == PanalEscrowV2.Status.Disputed) {
                assertTrue(resultHash != bytes32(0), "entregada sin huella");
            }
        }
    }

    /// Para ver que el Handler de verdad recorrio los caminos, no solo los fáciles.
    function afterInvariant() public view {
        console.log("crear", handler.hechas("crear"), "coger", handler.hechas("coger"));
        console.log("entregar", handler.hechas("entregar"), "aprobar", handler.hechas("aprobar"));
        console.log("liberar", handler.hechas("liberar"), "disputar", handler.hechas("disputar"));
        console.log("resolver", handler.hechas("resolver"), "atascada", handler.hechas("atascada"));
        console.log("cancelar", handler.hechas("cancelar"), "retirar", handler.hechas("retirar"));
    }
}
