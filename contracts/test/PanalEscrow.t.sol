// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/PanalRegistry.sol";
import "../src/PanalReputation.sol";
import "../src/PanalEscrow.sol";

contract PanalEscrowTest is Test {
    PanalRegistry registry;
    PanalReputation reputation;
    PanalEscrow escrow;

    address client = makeAddr("client");
    address worker = makeAddr("worker");
    address treasury = makeAddr("treasury");
    address arbitrator = makeAddr("arbitrator");
    address rando = makeAddr("rando");

    uint256 constant PRICE = 1 ether;
    bytes32 constant TASK_HASH = keccak256("task description");
    bytes32 constant RESULT_HASH = keccak256("result");

    function setUp() public {
        registry = new PanalRegistry();
        reputation = new PanalReputation();
        escrow = new PanalEscrow(address(registry), address(reputation), treasury, arbitrator);
        reputation.setEscrow(address(escrow));

        vm.prank(worker);
        registry.registerAgent("ipfs://worker", PRICE);

        vm.deal(client, 100 ether);
        vm.deal(rando, 100 ether);
    }

    function _createAssigned() internal returns (uint256 taskId) {
        vm.prank(client);
        taskId = escrow.createTask{value: PRICE}(worker, TASK_HASH, block.timestamp + 1 days);
    }

    function _createDelivered() internal returns (uint256 taskId) {
        taskId = _createAssigned();
        vm.prank(worker);
        escrow.deliverResult(taskId, RESULT_HASH);
    }

    function test_CreateTaskLocksFunds() public {
        uint256 balBefore = address(escrow).balance;
        uint256 taskId = _createAssigned();
        assertEq(taskId, 0);
        assertEq(address(escrow).balance, balBefore + PRICE);

        (address c, address w, uint256 amount, bytes32 th, bytes32 rh, uint256 dl, uint256 ca, PanalEscrow.Status st) =
            escrow.tasks(taskId);
        assertEq(c, client);
        assertEq(w, worker);
        assertEq(amount, PRICE);
        assertEq(th, TASK_HASH);
        assertEq(rh, bytes32(0));
        assertEq(dl, block.timestamp + 1 days);
        assertEq(ca, block.timestamp);
        assertEq(uint8(st), uint8(PanalEscrow.Status.Open));
    }

    function test_CreateTaskZeroValueReverts() public {
        vm.prank(client);
        vm.expectRevert("PanalEscrow: no funds");
        escrow.createTask{value: 0}(worker, TASK_HASH, block.timestamp + 1 days);
    }

    function test_CreateTaskInactiveWorkerReverts() public {
        vm.prank(client);
        vm.expectRevert("PanalEscrow: worker not active agent");
        escrow.createTask{value: PRICE}(rando, TASK_HASH, block.timestamp + 1 days);
    }

    function test_CreateOpenTaskAndClaim() public {
        vm.prank(client);
        uint256 taskId = escrow.createTask{value: PRICE}(address(0), TASK_HASH, block.timestamp + 1 days);

        vm.prank(rando);
        vm.expectRevert("PanalEscrow: not active agent");
        escrow.claimTask(taskId);

        vm.prank(worker);
        escrow.claimTask(taskId);
        (, address w,,,,,,) = escrow.tasks(taskId);
        assertEq(w, worker);

        vm.prank(worker);
        vm.expectRevert("PanalEscrow: task already assigned");
        escrow.claimTask(taskId);
    }

    function test_DeliverResult() public {
        uint256 taskId = _createAssigned();

        vm.prank(rando);
        vm.expectRevert("PanalEscrow: not worker");
        escrow.deliverResult(taskId, RESULT_HASH);

        vm.prank(worker);
        escrow.deliverResult(taskId, RESULT_HASH);
        (,,,, bytes32 rh,,, PanalEscrow.Status st) = escrow.tasks(taskId);
        assertEq(rh, RESULT_HASH);
        assertEq(uint8(st), uint8(PanalEscrow.Status.Delivered));
        assertEq(escrow.deliveredAt(taskId), block.timestamp);
    }

    function test_DeliverAfterDeadlineReverts() public {
        uint256 taskId = _createAssigned();
        vm.warp(block.timestamp + 2 days);
        vm.prank(worker);
        vm.expectRevert("PanalEscrow: deadline passed");
        escrow.deliverResult(taskId, RESULT_HASH);
    }

    function test_ApproveAndReleaseExactFee() public {
        uint256 taskId = _createDelivered();

        vm.prank(client);
        escrow.approveAndRelease(taskId, 4);

        uint256 expectedFee = (PRICE * escrow.FEE_BPS()) / 10_000; // 2.5%
        uint256 expectedPay = PRICE - expectedFee;
        assertEq(expectedFee, 0.025 ether);

        // pagos pull: fondos acreditados, no enviados
        assertEq(escrow.pendingWithdrawals(worker), expectedPay);
        assertEq(escrow.pendingWithdrawals(treasury), expectedFee);
        assertEq(address(escrow).balance, PRICE);

        uint256 workerBefore = worker.balance;
        uint256 treasuryBefore = treasury.balance;

        vm.prank(worker);
        escrow.withdraw();
        vm.prank(treasury);
        escrow.withdraw();

        assertEq(worker.balance, workerBefore + expectedPay);
        assertEq(treasury.balance, treasuryBefore + expectedFee);
        assertEq(address(escrow).balance, 0);

        PanalReputation.Reputation memory rep = reputation.getReputation(worker);
        assertEq(rep.tasksCompleted, 1);
        assertEq(rep.ratingSum, 4);
        assertEq(rep.ratingCount, 1);
        assertEq(rep.totalEarned, expectedPay);
    }

    function test_ApproveNotClientReverts() public {
        uint256 taskId = _createDelivered();
        vm.prank(rando);
        vm.expectRevert("PanalEscrow: not client");
        escrow.approveAndRelease(taskId, 5);
    }

    function test_ApproveInvalidRatingReverts() public {
        uint256 taskId = _createDelivered();
        vm.prank(client);
        vm.expectRevert("PanalEscrow: invalid rating");
        escrow.approveAndRelease(taskId, 0);
        vm.prank(client);
        vm.expectRevert("PanalEscrow: invalid rating");
        escrow.approveAndRelease(taskId, 6);
    }

    function test_AutoReleaseAfter3Days() public {
        uint256 taskId = _createDelivered();

        vm.expectRevert("PanalEscrow: too early");
        escrow.autoRelease(taskId);

        vm.warp(block.timestamp + escrow.AUTO_RELEASE());

        uint256 workerBefore = worker.balance;
        uint256 treasuryBefore = treasury.balance;

        vm.prank(rando); // cualquiera puede llamar
        escrow.autoRelease(taskId);

        uint256 expectedFee = (PRICE * escrow.FEE_BPS()) / 10_000;
        assertEq(escrow.pendingWithdrawals(worker), PRICE - expectedFee);
        assertEq(escrow.pendingWithdrawals(treasury), expectedFee);

        vm.prank(worker);
        escrow.withdraw();
        vm.prank(treasury);
        escrow.withdraw();

        assertEq(worker.balance, workerBefore + PRICE - expectedFee);
        assertEq(treasury.balance, treasuryBefore + expectedFee);

        // rating implicito 5
        assertEq(reputation.getScore(worker), 500);
    }

    function test_DisputeAndResolve5050() public {
        uint256 taskId = _createDelivered();

        vm.prank(worker);
        escrow.openDispute(taskId);

        vm.prank(client);
        vm.expectRevert("PanalEscrow: not arbitrator");
        escrow.resolveDispute(taskId, 5_000, 3);

        uint256 workerBefore = worker.balance;
        uint256 clientBefore = client.balance;
        uint256 treasuryBefore = treasury.balance;

        vm.prank(arbitrator);
        escrow.resolveDispute(taskId, 5_000, 3);

        uint256 workerGross = PRICE / 2;
        uint256 fee = (workerGross * escrow.FEE_BPS()) / 10_000;
        assertEq(escrow.pendingWithdrawals(worker), workerGross - fee);
        assertEq(escrow.pendingWithdrawals(treasury), fee);
        assertEq(escrow.pendingWithdrawals(client), PRICE / 2);
        assertEq(address(escrow).balance, PRICE);

        vm.prank(worker);
        escrow.withdraw();
        vm.prank(treasury);
        escrow.withdraw();
        vm.prank(client);
        escrow.withdraw();

        assertEq(worker.balance, workerBefore + workerGross - fee);
        assertEq(treasury.balance, treasuryBefore + fee);
        assertEq(client.balance, clientBefore + PRICE / 2);
        assertEq(address(escrow).balance, 0);

        PanalReputation.Reputation memory rep = reputation.getReputation(worker);
        assertEq(rep.tasksCompleted, 1);
        assertEq(rep.ratingSum, 3);
    }

    function test_OpenDisputeAccess() public {
        uint256 taskId = _createAssigned();
        vm.prank(rando);
        vm.expectRevert("PanalEscrow: not party");
        escrow.openDispute(taskId);
        vm.prank(client);
        escrow.openDispute(taskId);
    }

    function test_CancelUnclaimedTask() public {
        vm.prank(client);
        uint256 taskId = escrow.createTask{value: PRICE}(address(0), TASK_HASH, block.timestamp + 1 days);

        uint256 clientBefore = client.balance;
        vm.prank(client);
        escrow.cancelTask(taskId);
        assertEq(escrow.pendingWithdrawals(client), PRICE);
        assertEq(address(escrow).balance, PRICE);
        vm.prank(client);
        escrow.withdraw();
        assertEq(client.balance, clientBefore + PRICE);
        assertEq(address(escrow).balance, 0);
    }

    function test_CancelAfterDeadline() public {
        uint256 taskId = _createAssigned();

        // antes del deadline con worker asignado: revierte
        vm.prank(client);
        vm.expectRevert("PanalEscrow: cannot cancel yet");
        escrow.cancelTask(taskId);

        vm.warp(block.timestamp + 2 days);
        uint256 clientBefore = client.balance;
        vm.prank(client);
        escrow.cancelTask(taskId);
        assertEq(escrow.pendingWithdrawals(client), PRICE);
        vm.prank(client);
        escrow.withdraw();
        assertEq(client.balance, clientBefore + PRICE);
    }

    function test_CancelNotClientReverts() public {
        vm.prank(client);
        uint256 taskId = escrow.createTask{value: PRICE}(address(0), TASK_HASH, block.timestamp + 1 days);
        vm.prank(rando);
        vm.expectRevert("PanalEscrow: not client");
        escrow.cancelTask(taskId);
    }

    function test_SetTreasuryOnlyOwner() public {
        vm.prank(rando);
        vm.expectRevert("PanalEscrow: not owner");
        escrow.setTreasury(rando);

        escrow.setTreasury(rando);
        assertEq(escrow.treasury(), rando);
    }

    function test_TransferArbitrator() public {
        vm.prank(rando);
        vm.expectRevert("PanalEscrow: not authorized");
        escrow.transferArbitrator(rando);

        vm.prank(arbitrator);
        escrow.transferArbitrator(rando);
        assertEq(escrow.arbitrator(), rando);
    }

    function test_TransferArbitratorByOwner() public {
        vm.prank(address(this)); // owner es el deployer (este contrato de test)
        escrow.transferArbitrator(rando);
        assertEq(escrow.arbitrator(), rando);

        vm.prank(rando);
        vm.expectRevert("PanalEscrow: zero arbitrator");
        escrow.transferArbitrator(address(0));
    }

    function test_ResolveDisputeInvalidRatingZeroShareReverts() public {
        uint256 taskId = _createDelivered();
        vm.prank(worker);
        escrow.openDispute(taskId);

        // rating invalido revierte incluso con workerShareBps == 0 (validacion fuera del if)
        vm.prank(arbitrator);
        vm.expectRevert("PanalEscrow: invalid rating");
        escrow.resolveDispute(taskId, 0, 0);

        vm.prank(arbitrator);
        vm.expectRevert("PanalEscrow: invalid rating");
        escrow.resolveDispute(taskId, 0, 6);

        // con rating valido y share 0: todo al cliente
        vm.prank(arbitrator);
        escrow.resolveDispute(taskId, 0, 1);
        assertEq(escrow.pendingWithdrawals(client), PRICE);
        assertEq(escrow.pendingWithdrawals(worker), 0);
    }

    function test_ResolveDisputeNoWorkerReverts() public {
        // tarea Open sin worker (abierta a cualquiera), el client abre disputa
        vm.prank(client);
        uint256 taskId = escrow.createTask{value: PRICE}(address(0), TASK_HASH, block.timestamp + 1 days);
        vm.prank(client);
        escrow.openDispute(taskId);

        vm.prank(arbitrator);
        vm.expectRevert("PanalEscrow: no worker to pay");
        escrow.resolveDispute(taskId, 5_000, 3);

        // con workerShareBps == 0 si resuelve: reembolso completo al cliente
        vm.prank(arbitrator);
        escrow.resolveDispute(taskId, 0, 1);
        assertEq(escrow.pendingWithdrawals(client), PRICE);
    }

    function test_ResolveStuckDispute() public {
        uint256 taskId = _createDelivered();
        vm.prank(client);
        escrow.openDispute(taskId);
        assertEq(escrow.disputedAt(taskId), block.timestamp);

        vm.expectRevert("PanalEscrow: not stuck");
        escrow.resolveStuckDispute(taskId);

        vm.warp(block.timestamp + escrow.DISPUTE_TIMEOUT());
        vm.prank(rando); // cualquiera puede liberar
        escrow.resolveStuckDispute(taskId);

        (,,,,,,, PanalEscrow.Status st) = escrow.tasks(taskId);
        assertEq(uint8(st), uint8(PanalEscrow.Status.Cancelled));
        assertEq(escrow.pendingWithdrawals(client), PRICE);

        uint256 clientBefore = client.balance;
        vm.prank(client);
        escrow.withdraw();
        assertEq(client.balance, clientBefore + PRICE);
    }

    function test_WithdrawZeroBalanceReverts() public {
        vm.prank(rando);
        vm.expectRevert("PanalEscrow: nothing to withdraw");
        escrow.withdraw();
    }

    function test_DoubleWithdrawReverts() public {
        uint256 taskId = _createDelivered();
        vm.prank(client);
        escrow.approveAndRelease(taskId, 5);

        vm.prank(worker);
        escrow.withdraw();

        vm.prank(worker);
        vm.expectRevert("PanalEscrow: nothing to withdraw");
        escrow.withdraw();
    }

    function test_RevertingReceiverDoesNotBlockProtocol() public {
        RevertingReceiver badWorker = new RevertingReceiver(address(escrow), address(registry));

        badWorker.registerAsAgent("ipfs://bad", PRICE);

        // ciclo completo con worker que revierte en receive()
        vm.prank(client);
        uint256 taskId = escrow.createTask{value: PRICE}(address(badWorker), TASK_HASH, block.timestamp + 1 days);
        badWorker.deliver(taskId, RESULT_HASH);
        vm.prank(client);
        escrow.approveAndRelease(taskId, 5); // NO revierte: patrón pull

        uint256 expectedFee = (PRICE * escrow.FEE_BPS()) / 10_000;
        uint256 expectedPay = PRICE - expectedFee;
        assertEq(escrow.pendingWithdrawals(address(badWorker)), expectedPay);

        // un tercero NO puede retirar los fondos del badWorker
        vm.prank(rando);
        vm.expectRevert("PanalEscrow: nothing to withdraw");
        escrow.withdraw();

        // el receptor que revierte no puede retirar, pero el protocolo no queda bloqueado
        vm.expectRevert("PanalEscrow: transfer failed");
        badWorker.withdraw();
        assertEq(escrow.pendingWithdrawals(address(badWorker)), expectedPay); // saldo restaurado tras revert

        // treasury si puede cobrar su fee
        vm.prank(treasury);
        escrow.withdraw();
        assertEq(treasury.balance, expectedFee);

        // el protocolo sigue operativo para otras tareas
        uint256 taskId2 = _createDelivered();
        vm.prank(client);
        escrow.approveAndRelease(taskId2, 4);
        assertEq(escrow.pendingWithdrawals(worker), PRICE - expectedFee);
    }

    function test_CreateTaskBelowMinimumReverts() public {
        vm.prank(client);
        vm.expectRevert("PanalEscrow: below minimum");
        escrow.createTask{value: 0.0005 ether}(worker, TASK_HASH, block.timestamp + 1 days);

        // exactamente el mínimo funciona
        vm.prank(client);
        uint256 taskId = escrow.createTask{value: 0.001 ether}(worker, TASK_HASH, block.timestamp + 1 days);
        (,, uint256 amount,,,,,) = escrow.tasks(taskId);
        assertEq(amount, 0.001 ether);
    }
}

/// @notice Worker cuyo receive() revierte siempre (regresion FIX-1: pagos pull).
contract RevertingReceiver {
    PanalEscrow escrow;
    PanalRegistry registry;

    constructor(address _escrow, address _registry) {
        escrow = PanalEscrow(_escrow);
        registry = PanalRegistry(_registry);
    }

    function registerAsAgent(string memory uri, uint256 price) external {
        registry.registerAgent(uri, price);
    }

    function deliver(uint256 taskId, bytes32 resultHash) external {
        escrow.deliverResult(taskId, resultHash);
    }

    function withdraw() external {
        escrow.withdraw();
    }

    receive() external payable {
        revert("no ETH accepted");
    }
}
