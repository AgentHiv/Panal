// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../../src/v2/PanalRegistryV2.sol";
import "../../src/v2/PanalEscrowV2.sol";
import "../../src/PanalReputation.sol";
import "./mocks/MockERC20.sol";
import "./mocks/MockFeeOnTransferERC20.sol";

/// @notice Tests de los fixes de auditoria v2 + PoCs de auditoria incorporados como
///         tests permanentes (ver audit-v2/INFORME-LOGICA.md e INFORME-REENTRANCY.md).
contract AuditFixesV2Test is Test {
    PanalRegistryV2 registry;
    PanalReputation reputation;
    PanalEscrowV2 escrow;
    MockERC20 panal;

    address client = makeAddr("client");
    address worker = makeAddr("worker");
    address treasury = makeAddr("treasury");
    address arbitrator = makeAddr("arbitrator");
    address rando = makeAddr("rando");

    bytes32 constant TASK_HASH = keccak256("task");
    bytes32 constant RESULT_HASH = keccak256("result");
    address constant NATIVE = address(0);

    function setUp() public {
        panal = new MockERC20("Panal", "PANAL");
        (registry, reputation, escrow) = _deployStack(address(panal));
        vm.prank(worker);
        registry.registerAgent("ipfs://worker", 100e18, address(panal));
        vm.deal(client, 100 ether);
        panal.mint(client, 1_000_000e18);
    }

    function _deployStack(address token)
        internal
        returns (PanalRegistryV2 reg, PanalReputation rep, PanalEscrowV2 esc)
    {
        reg = new PanalRegistryV2(token);
        rep = new PanalReputation();
        esc = new PanalEscrowV2(address(reg), address(rep), treasury, arbitrator, token);
        rep.setEscrow(address(esc));
    }

    // ---------------------------------------------------------------------
    // FIX LOG-03: self-task farming bloqueado en createTask y claimTask
    // ---------------------------------------------------------------------

    function test_SelfTaskCreateReverts() public {
        // el cliente registra su propio agente e intenta auto-asignarse la tarea
        vm.prank(client);
        registry.registerAgent("ipfs://client-agent", 1 ether, NATIVE);

        vm.prank(client);
        vm.expectRevert("no self-task");
        escrow.createTask{value: 1 ether}(client, TASK_HASH, block.timestamp + 1 days, NATIVE, 1 ether);

        // con worker distinto o abierta (worker == 0) sigue funcionando
        vm.prank(client);
        escrow.createTask{value: 1 ether}(worker, TASK_HASH, block.timestamp + 1 days, NATIVE, 1 ether);
        vm.prank(client);
        escrow.createTask{value: 1 ether}(address(0), TASK_HASH, block.timestamp + 1 days, NATIVE, 1 ether);
    }

    function test_SelfTaskClaimReverts() public {
        // el cliente registra su propio agente, crea tarea abierta e intenta reclamarla
        vm.prank(client);
        registry.registerAgent("ipfs://client-agent", 1 ether, NATIVE);

        vm.prank(client);
        uint256 taskId = escrow.createTask{value: 1 ether}(address(0), TASK_HASH, block.timestamp + 1 days, NATIVE, 1 ether);

        vm.prank(client);
        vm.expectRevert("no self-task");
        escrow.claimTask(taskId);

        // un worker distinto si puede reclamar
        vm.prank(worker);
        escrow.claimTask(taskId);
    }

    // ---------------------------------------------------------------------
    // FIX LOG-02: el constructor rechaza una reputation ya consumida
    // ---------------------------------------------------------------------

    function test_ConstructorConsumedReputationReverts() public {
        PanalReputation consumed = new PanalReputation();
        consumed.setEscrow(rando); // one-shot consumido (estado de la reputation v1 mainnet)

        vm.expectRevert("reputation already consumed");
        new PanalEscrowV2(address(registry), address(consumed), treasury, arbitrator, address(panal));

        // con reputation fresca el deploy funciona (ruta del DeployV2 rediseñado)
        PanalReputation fresh = new PanalReputation();
        PanalEscrowV2 ok = new PanalEscrowV2(address(registry), address(fresh), treasury, arbitrator, address(panal));
        fresh.setEscrow(address(ok));
        assertEq(fresh.escrow(), address(ok));
    }

    // ---------------------------------------------------------------------
    // FIX R-02: fee-on-transfer — se contabiliza el recibido real
    // ---------------------------------------------------------------------

    function test_FeeOnTransferAccountsNetReceived() public {
        MockFeeOnTransferERC20 fot = new MockFeeOnTransferERC20();
        (PanalRegistryV2 reg,, PanalEscrowV2 esc) = _deployStack(address(fot));
        vm.prank(worker);
        reg.registerAgent("ipfs://w", 100e18, address(fot));
        fot.mint(client, 1_000e18);

        vm.startPrank(client);
        fot.approve(address(esc), 100e18);
        uint256 taskId = esc.createTask(worker, TASK_HASH, block.timestamp + 1 days, address(fot), 100e18);
        vm.stopPrank();

        // recibido real: 95e18 (5% quemado) — contabilizado, no el declarado
        (,, uint256 amount,,,,,,) = esc.tasks(taskId);
        assertEq(amount, 95e18);
        assertEq(fot.balanceOf(address(esc)), 95e18);

        // ciclo completo contra el neto: worker y treasury cobran exacto, sin infracolateralizacion
        vm.prank(worker);
        esc.deliverResult(taskId, RESULT_HASH);
        vm.prank(client);
        esc.approveAndRelease(taskId, 5);

        uint256 fee = (95e18 * esc.FEE_BPS()) / 10_000; // 2.375e18
        uint256 workerPaid = 95e18 - fee;
        vm.prank(worker);
        esc.withdraw(address(fot));
        vm.prank(treasury);
        esc.withdraw(address(fot));
        assertEq(fot.balanceOf(worker), workerPaid - workerPaid / 20); // el token cobra fee tambien al retirar
        assertEq(esc.pendingWithdrawals(address(fot), worker), 0);
        assertEq(fot.balanceOf(address(esc)), 0); // totalmente colateralizado: nada queda atascado
    }

    function test_FeeOnTransferBelowMinimumReceivedReverts() public {
        MockFeeOnTransferERC20 fot = new MockFeeOnTransferERC20();
        (PanalRegistryV2 reg,, PanalEscrowV2 esc) = _deployStack(address(fot));
        vm.prank(worker);
        reg.registerAgent("ipfs://w", 1e18, address(fot));
        fot.mint(client, 1_000e18);

        // declarado = minimo (1e18), pero el recibido real (0.95e18) queda bajo el minimo
        vm.startPrank(client);
        fot.approve(address(esc), 1e18);
        vm.expectRevert("PanalEscrow: below minimum received");
        esc.createTask(worker, TASK_HASH, block.timestamp + 1 days, address(fot), 1e18);

        // declarando 2e18 el recibido (1.9e18) supera el minimo y se contabiliza el neto
        fot.approve(address(esc), 2e18);
        uint256 taskId = esc.createTask(worker, TASK_HASH, block.timestamp + 1 days, address(fot), 2e18);
        vm.stopPrank();
        (,, uint256 amount,,,,,,) = esc.tasks(taskId);
        assertEq(amount, 1.9e18);
    }

    // ---------------------------------------------------------------------
    // FIX R-03: createTask es nonReentrant — la reentrada del PoC ahora revierte
    // ---------------------------------------------------------------------

    function test_CreateTaskReentrancyBlocked() public {
        MockCallbackERC20 ct = new MockCallbackERC20();
        (PanalRegistryV2 reg2, PanalReputation rep2, PanalEscrowV2 esc2) = _deployStack2(address(ct));
        ReenterAttackerV2 attacker = new ReenterAttackerV2(esc2);
        ct.setCallbackTarget(address(attacker));
        rep2.setEscrow(address(esc2));
        vm.prank(worker);
        reg2.registerAgent("ipfs://w", 1e18, address(ct));

        uint256 amount = 10e18;
        ct.mint(client, amount);
        vm.startPrank(client);
        ct.approve(address(esc2), amount);
        esc2.createTask(worker, TASK_HASH, block.timestamp + 1 days, address(ct), amount);
        vm.stopPrank();

        // la reentrada se intento pero fue rechazada por el guard
        assertTrue(attacker.attempted());
        assertEq(keccak256(attacker.revertData()), keccak256(abi.encodeWithSignature("Error(string)", "PanalEscrow: reentrant call")));
        assertEq(esc2.getTaskCount(), 1); // solo la tarea externa
    }

    function _deployStack2(address token)
        internal
        returns (PanalRegistryV2 reg, PanalReputation rep, PanalEscrowV2 esc)
    {
        reg = new PanalRegistryV2(token);
        rep = new PanalReputation();
        esc = new PanalEscrowV2(address(reg), address(rep), treasury, arbitrator, token);
        // setEscrow lo hace el caller (el attacker se crea entre medias en el test)
    }

    // ---------------------------------------------------------------------
    // FIX LOG-04: getAgent vuelve a ser ABI-compatible con el decoder v1
    // ---------------------------------------------------------------------

    function decodeV1Agent(bytes calldata blob)
        external
        pure
        returns (address, string memory, uint256, bool, uint256)
    {
        return abi.decode(blob, (address, string, uint256, bool, uint256));
    }

    function test_GetAgentDecodesWithV1Abi() public view {
        PanalRegistryV2.Agent memory a = registry.getAgent(worker);
        // orden v2 post-fix: (owner, metadataURI, pricePerTask, active, registeredAt, currency)
        bytes memory blob = abi.encode(a.owner, a.metadataURI, a.pricePerTask, a.active, a.registeredAt, a.currency);
        // decoder estricto v1 (address,string,uint256,bool,uint256): ya NO revierte
        (address o, string memory uri, uint256 price, bool active, uint256 regAt) = this.decodeV1Agent(blob);
        assertEq(o, a.owner);
        assertEq(uri, a.metadataURI);
        assertEq(price, a.pricePerTask);
        assertEq(active, a.active);
        assertEq(regAt, a.registeredAt);
    }

    // ---------------------------------------------------------------------
    // PoC permanente LOG-05 (diseno heredado, documentado en runbook): disputa del
    // cliente tras entrega + arbitrator inactivo 14d => cliente recupera el 100%.
    // ---------------------------------------------------------------------

    function test_ClientDisputeTimeoutStealsDeliveredWork() public {
        vm.startPrank(client);
        panal.approve(address(escrow), 100e18);
        uint256 taskId = escrow.createTask(worker, TASK_HASH, block.timestamp + 1 days, address(panal), 100e18);
        vm.stopPrank();
        vm.prank(worker);
        escrow.deliverResult(taskId, RESULT_HASH);

        vm.prank(client);
        escrow.openDispute(taskId); // disputa sin merito (valida: status Delivered)
        vm.warp(block.timestamp + 14 days); // arbitrator inactivo
        vm.prank(rando);
        escrow.resolveStuckDispute(taskId); // permisionless

        assertEq(escrow.pendingWithdrawals(address(panal), client), 100e18); // cliente recupera todo
        assertEq(escrow.pendingWithdrawals(address(panal), worker), 0); // worker: 0
    }

    // ---------------------------------------------------------------------
    // PoC permanente LOG-08: cambiar currency con tasks activas es cosmetico
    // (el escrow nunca lee precio/currency del registry; completa en su moneda).
    // ---------------------------------------------------------------------

    function test_CurrencySwitchWithActiveTasksIsCosmetic() public {
        vm.prank(client);
        uint256 taskId = escrow.createTask{value: 1 ether}(worker, TASK_HASH, block.timestamp + 1 days, NATIVE, 1 ether);
        // el worker cambia su moneda a PANAL con la task nativa aun Open
        vm.prank(worker);
        registry.updatePrice(50e18, address(panal));
        // la task sigue completando en MON sin problema
        vm.prank(worker);
        escrow.deliverResult(taskId, RESULT_HASH);
        vm.prank(client);
        escrow.approveAndRelease(taskId, 5);
        assertEq(escrow.pendingWithdrawals(NATIVE, worker), 0.975 ether);
    }

    // ---------------------------------------------------------------------
    // PoC permanente R-04 (decision aceptada, paridad v1): MON forzado via
    // selfdestruct queda atrapado — no hay sweep ni receive.
    // ---------------------------------------------------------------------

    function test_ForcedNativeStaysTrapped() public {
        new SelfDestructorV2{value: 1 ether}(payable(address(escrow)));
        assertEq(address(escrow).balance, 1 ether);
        vm.expectRevert("PanalEscrow: nothing to withdraw");
        escrow.withdraw(NATIVE);
    }

    // ---------------------------------------------------------------------
    // PoC permanente (negativo) fee math: workerPaid + fee == amount, sin polvo.
    // ---------------------------------------------------------------------

    function test_FeeMathNoDust() public {
        uint256 amount = 3.333333333333333333 ether; // impar para redondeo
        vm.prank(client);
        uint256 taskId = escrow.createTask{value: amount}(worker, TASK_HASH, block.timestamp + 1 days, NATIVE, amount);
        vm.prank(worker);
        escrow.deliverResult(taskId, RESULT_HASH);
        vm.prank(client);
        escrow.approveAndRelease(taskId, 4);
        uint256 w = escrow.pendingWithdrawals(NATIVE, worker);
        uint256 t = escrow.pendingWithdrawals(NATIVE, treasury);
        assertEq(w + t, amount); // sin polvo
    }
}

/// @notice Atacante que intenta reentrar en createTask durante el callback del token.
contract ReenterAttackerV2 {
    PanalEscrowV2 public escrow;
    bool public attempted;
    bytes public revertData;

    constructor(PanalEscrowV2 _escrow) {
        escrow = _escrow;
    }

    function onTokenCallback(address token, uint256 amount) external {
        attempted = true;
        try escrow.createTask(address(0), bytes32(uint256(2)), block.timestamp + 1 days, token, amount) {
            revert("reentrancy succeeded");
        } catch (bytes memory data) {
            revertData = data;
        }
    }
}

contract SelfDestructorV2 {
    constructor(address payable target) payable {
        selfdestruct(target);
    }
}
