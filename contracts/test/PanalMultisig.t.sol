// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/PanalMultisig.sol";
import "../src/v2/PanalRegistryV2.sol";
import "../src/v2/PanalEscrowV2.sol";
import "../src/PanalReputation.sol";

/// @notice Contrato dummy para tests unitarios del multisig: guarda un valor y
///         puede configurarse para revertir (simula un call fallido del target).
contract MockTarget {
    uint256 public value;
    bool public shouldRevert;

    function setValue(uint256 v) external {
        require(!shouldRevert, "MockTarget: forced revert");
        value = v;
    }

    function setShouldRevert(bool r) external {
        shouldRevert = r;
    }
}

/// @notice Tests del PanalMultisig 2-de-3 + integracion real con PanalEscrowV2:
///         el multisig como arbitrator resolviendo una disputa via submit + confirm x2.
contract PanalMultisigTest is Test {
    PanalMultisig msig;
    MockTarget target;

    address ownerA = makeAddr("ownerA");
    address ownerB = makeAddr("ownerB");
    address ownerC = makeAddr("ownerC");
    address rando = makeAddr("rando");

    event Submit(uint256 indexed txId, address indexed proposer, address indexed target, bytes data);
    event Confirm(uint256 indexed txId, address indexed owner);
    event Revoke(uint256 indexed txId, address indexed owner);
    event Execute(uint256 indexed txId, address indexed executor, address indexed target);

    function setUp() public {
        msig = new PanalMultisig([ownerA, ownerB, ownerC]);
        target = new MockTarget();
    }

    function _submitSetValue(uint256 v) internal returns (uint256 txId) {
        vm.prank(ownerA);
        txId = msig.submit(address(target), abi.encodeWithSelector(MockTarget.setValue.selector, v));
    }

    // ------------------------------------------------------------------
    // Constructor
    // ------------------------------------------------------------------

    function test_ConstructorSetsOwners() public {
        assertTrue(msig.isOwner(ownerA));
        assertTrue(msig.isOwner(ownerB));
        assertTrue(msig.isOwner(ownerC));
        assertFalse(msig.isOwner(rando));
        assertEq(msig.owners(0), ownerA);
        assertEq(msig.owners(1), ownerB);
        assertEq(msig.owners(2), ownerC);
        assertEq(msig.txCount(), 0);
        assertEq(msig.REQUIRED(), 2);
    }

    function test_ConstructorRevertsOnZeroOwner() public {
        vm.expectRevert("PanalMultisig: zero owner");
        new PanalMultisig([ownerA, address(0), ownerC]);
    }

    function test_ConstructorRevertsOnDuplicateOwner() public {
        vm.expectRevert("PanalMultisig: duplicate owner");
        new PanalMultisig([ownerA, ownerB, ownerA]);
    }

    // ------------------------------------------------------------------
    // Flujo feliz: submit -> confirm -> confirm ejecuta
    // ------------------------------------------------------------------

    function test_HappyPathExecutesOnSecondConfirm() public {
        bytes memory data = abi.encodeWithSelector(MockTarget.setValue.selector, 42);

        vm.prank(ownerA);
        vm.expectEmit(true, true, true, true);
        emit Submit(0, ownerA, address(target), data);
        uint256 txId = msig.submit(address(target), data);
        assertEq(txId, 0);
        assertEq(msig.txCount(), 1);
        assertEq(target.value(), 0); // submit no ejecuta

        vm.prank(ownerA);
        vm.expectEmit(true, true, false, false);
        emit Confirm(txId, ownerA);
        msig.confirm(txId);
        assertEq(target.value(), 0); // 1 confirmacion no ejecuta

        vm.prank(ownerB);
        vm.expectEmit(true, true, false, false);
        emit Confirm(txId, ownerB);
        vm.expectEmit(true, true, true, false);
        emit Execute(txId, ownerB, address(target));
        msig.confirm(txId); // 2da confirmacion ejecuta

        assertEq(target.value(), 42);
        (address t, bytes memory d, uint8 confs, bool executed) = msig.getTx(txId);
        assertEq(t, address(target));
        assertEq(d, data);
        assertEq(confs, 2);
        assertTrue(executed);
        assertTrue(msig.isConfirmedBy(txId, ownerA));
        assertTrue(msig.isConfirmedBy(txId, ownerB));
        assertFalse(msig.isConfirmedBy(txId, ownerC));
    }

    function test_OneConfirmationDoesNotExecute() public {
        uint256 txId = _submitSetValue(7);
        vm.prank(ownerC);
        msig.confirm(txId);
        (, , uint8 confs, bool executed) = msig.getTx(txId);
        assertEq(confs, 1);
        assertFalse(executed);
        assertEq(target.value(), 0);
    }

    // ------------------------------------------------------------------
    // Revoke
    // ------------------------------------------------------------------

    function test_RevokeRemovesConfirmation() public {
        uint256 txId = _submitSetValue(7);
        vm.prank(ownerA);
        msig.confirm(txId);

        vm.prank(ownerA);
        vm.expectEmit(true, true, false, false);
        emit Revoke(txId, ownerA);
        msig.revoke(txId);

        (, , uint8 confs, bool executed) = msig.getTx(txId);
        assertEq(confs, 0);
        assertFalse(executed);
        assertFalse(msig.isConfirmedBy(txId, ownerA));

        // Tras revocar puede volver a confirmar y ejecutar con otro owner.
        vm.prank(ownerA);
        msig.confirm(txId);
        vm.prank(ownerB);
        msig.confirm(txId);
        assertEq(target.value(), 7);
    }

    function test_RevokeRevertsIfNotConfirmed() public {
        uint256 txId = _submitSetValue(7);
        vm.prank(ownerB);
        vm.expectRevert("PanalMultisig: not confirmed");
        msig.revoke(txId);
    }

    // ------------------------------------------------------------------
    // Permisos y guards
    // ------------------------------------------------------------------

    function test_NonOwnerCannotSubmitConfirmNorRevoke() public {
        vm.prank(rando);
        vm.expectRevert("PanalMultisig: not owner");
        msig.submit(address(target), abi.encodeWithSelector(MockTarget.setValue.selector, 1));

        uint256 txId = _submitSetValue(1);

        vm.prank(rando);
        vm.expectRevert("PanalMultisig: not owner");
        msig.confirm(txId);

        vm.prank(rando);
        vm.expectRevert("PanalMultisig: not owner");
        msig.revoke(txId);
    }

    function test_SubmitGuards() public {
        vm.prank(ownerA);
        vm.expectRevert("PanalMultisig: zero target");
        msig.submit(address(0), abi.encodeWithSelector(MockTarget.setValue.selector, 1));

        vm.prank(ownerA);
        vm.expectRevert("PanalMultisig: target not contract");
        msig.submit(rando, abi.encodeWithSelector(MockTarget.setValue.selector, 1)); // EOA

        vm.prank(ownerA);
        vm.expectRevert("PanalMultisig: empty data");
        msig.submit(address(target), "");
    }

    function test_ConfirmRevertsOnInvalidTx() public {
        vm.prank(ownerA);
        vm.expectRevert("PanalMultisig: invalid tx");
        msig.confirm(0);
    }

    function test_DoubleConfirmReverts() public {
        uint256 txId = _submitSetValue(7);
        vm.prank(ownerA);
        msig.confirm(txId);
        vm.prank(ownerA);
        vm.expectRevert("PanalMultisig: already confirmed");
        msig.confirm(txId);
    }

    function test_DoubleExecutionReverts() public {
        uint256 txId = _submitSetValue(7);
        vm.prank(ownerA);
        msig.confirm(txId);
        vm.prank(ownerB);
        msig.confirm(txId); // ejecuta
        assertTrue(msig.isConfirmedBy(txId, ownerB));

        vm.prank(ownerC);
        vm.expectRevert("PanalMultisig: already executed");
        msig.confirm(txId);
    }

    // ------------------------------------------------------------------
    // Call fallido: revierte y NO marca executed (permite reintentar)
    // ------------------------------------------------------------------

    function test_FailedCallRevertsAndStaysUnexecuted() public {
        target.setShouldRevert(true);
        uint256 txId = _submitSetValue(9);

        vm.prank(ownerA);
        msig.confirm(txId);

        // La 2da confirmacion dispara el call, que revierte y se propaga el motivo.
        vm.prank(ownerB);
        vm.expectRevert("MockTarget: forced revert");
        msig.confirm(txId);

        // Nada quedo persistido del intento fallido: sigue con 1 confirmacion.
        (, , uint8 confs, bool executed) = msig.getTx(txId);
        assertEq(confs, 1);
        assertFalse(executed);

        // Reintento: el target ya no falla, la misma tx termina ejecutando.
        target.setShouldRevert(false);
        vm.prank(ownerB);
        msig.confirm(txId);
        assertEq(target.value(), 9);
        (, , confs, executed) = msig.getTx(txId);
        assertEq(confs, 2);
        assertTrue(executed);
    }

    // ------------------------------------------------------------------
    // Integracion REAL: multisig como arbitrator de PanalEscrowV2
    // ------------------------------------------------------------------

    function test_Integration_ResolveDisputeViaMultisig() public {
        // Despliegue completo del protocolo v2 (solo MON nativo, como en anvil/mainnet
        // antes del token): RegistryV2 + Reputation + EscrowV2 con el multisig de arbitrator.
        PanalRegistryV2 registry = new PanalRegistryV2(address(0));
        PanalReputation reputation = new PanalReputation();
        PanalEscrowV2 escrow =
            new PanalEscrowV2(address(registry), address(reputation), makeAddr("treasury"), address(msig), address(0));
        reputation.setEscrow(address(escrow));
        assertEq(escrow.arbitrator(), address(msig));

        address client = makeAddr("client");
        address worker = makeAddr("worker");
        address treasury = makeAddr("treasury");

        vm.prank(worker);
        registry.registerAgent("ipfs://worker", 1 ether, address(0));

        vm.deal(client, 10 ether);
        vm.prank(client);
        uint256 taskId = escrow.createTask{value: 1 ether}(worker, keccak256("task"), block.timestamp + 1 days, address(0), 1 ether);

        vm.prank(worker);
        escrow.deliverResult(taskId, keccak256("result"));
        vm.prank(client);
        escrow.openDispute(taskId);

        // La EOA del dueno ya NO puede resolver: solo el multisig (arbitrator).
        vm.prank(ownerA);
        vm.expectRevert("PanalEscrow: not arbitrator");
        escrow.resolveDispute(taskId, 6000, 4);

        // Flujo operativo: ownerA propone resolveDispute(60% worker, rating 4), ownerB confirma y ejecuta.
        bytes memory data = abi.encodeWithSelector(PanalEscrowV2.resolveDispute.selector, taskId, 6000, 4);
        vm.prank(ownerA);
        uint256 txId = msig.submit(address(escrow), data);
        vm.prank(ownerA);
        msig.confirm(txId);
        vm.prank(ownerB);
        msig.confirm(txId); // 2da confirmacion ejecuta resolveDispute en el escrow

        (, , , bool executed) = msig.getTx(txId);
        assertTrue(executed);

        // Estado del escrow tras la resolucion: worker 60% - fee 2.5%, client 40%.
        (,,,,,,, PanalEscrowV2.Status st,) = escrow.tasks(taskId);
        assertEq(uint8(st), uint8(PanalEscrowV2.Status.Completed));

        uint256 workerGross = 0.6 ether;
        uint256 fee = (workerGross * 250) / 10_000; // 0.015 ether
        assertEq(escrow.pendingWithdrawals(address(0), worker), workerGross - fee); // 0.585 ether
        assertEq(escrow.pendingWithdrawals(address(0), treasury), fee);
        assertEq(escrow.pendingWithdrawals(address(0), client), 0.4 ether);

        // Reputacion registrada por el escrow con el rating del arbitro.
        PanalReputation.Reputation memory rep = reputation.getReputation(worker);
        assertEq(rep.tasksCompleted, 1);
        assertEq(rep.ratingSum, 4);

        // Retiro real de fondos (pull payment) para cerrar el ciclo.
        vm.prank(worker);
        escrow.withdraw(address(0));
        assertEq(worker.balance, 0.585 ether);
    }

    /// @notice Migracion: escrow desplegado con EOA de arbitrator -> transferArbitrator(multisig).
    function test_Integration_TransferArbitratorToMultisig() public {
        PanalRegistryV2 registry = new PanalRegistryV2(address(0));
        PanalReputation reputation = new PanalReputation();
        PanalEscrowV2 escrow =
            new PanalEscrowV2(address(registry), address(reputation), makeAddr("treasury"), ownerA, address(0));
        reputation.setEscrow(address(escrow));

        // El arbitrator actual (EOA) transfiere el rol al multisig.
        vm.prank(ownerA);
        escrow.transferArbitrator(address(msig));
        assertEq(escrow.arbitrator(), address(msig));

        // La EOA ya no puede resolver; el multisig si (via 2-de-3).
        address client = makeAddr("client2");
        address worker = makeAddr("worker2");
        vm.prank(worker);
        registry.registerAgent("ipfs://w2", 1 ether, address(0));
        vm.deal(client, 10 ether);
        vm.prank(client);
        uint256 taskId = escrow.createTask{value: 1 ether}(worker, keccak256("t"), block.timestamp + 1 days, address(0), 1 ether);
        vm.prank(worker);
        escrow.deliverResult(taskId, keccak256("r"));
        vm.prank(worker);
        escrow.openDispute(taskId);

        vm.prank(ownerA);
        vm.expectRevert("PanalEscrow: not arbitrator");
        escrow.resolveDispute(taskId, 5000, 3);

        bytes memory data = abi.encodeWithSelector(PanalEscrowV2.resolveDispute.selector, taskId, 10_000, 5);
        vm.prank(ownerB);
        uint256 txId = msig.submit(address(escrow), data);
        vm.prank(ownerB);
        msig.confirm(txId);
        vm.prank(ownerC);
        msig.confirm(txId);

        (,,,,,,, PanalEscrowV2.Status st,) = escrow.tasks(taskId);
        assertEq(uint8(st), uint8(PanalEscrowV2.Status.Completed));
        // 100% al worker menos fee: 0.975 ether.
        assertEq(escrow.pendingWithdrawals(address(0), worker), 0.975 ether);
    }
}
