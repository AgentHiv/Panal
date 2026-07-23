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

        uint256 workerBefore = worker.balance;
        uint256 treasuryBefore = treasury.balance;

        vm.prank(client);
        escrow.approveAndRelease(taskId, 4);

        uint256 expectedFee = (PRICE * escrow.FEE_BPS()) / 10_000; // 2.5%
        uint256 expectedPay = PRICE - expectedFee;
        assertEq(expectedFee, 0.025 ether);
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
        vm.expectRevert("PanalEscrow: not arbitrator");
        escrow.transferArbitrator(rando);

        vm.prank(arbitrator);
        escrow.transferArbitrator(rando);
        assertEq(escrow.arbitrator(), rando);
    }
}
