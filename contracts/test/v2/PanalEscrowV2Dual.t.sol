// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../../src/v2/PanalRegistryV2.sol";
import "../../src/v2/PanalEscrowV2.sol";
import "../../src/PanalReputation.sol";
import "./mocks/MockERC20.sol";

/// @notice Tests nuevos de v2: escrow dual MON nativo + token $PANAL.
contract PanalEscrowV2DualTest is Test {
    PanalRegistryV2 registry;
    PanalReputation reputation;
    PanalEscrowV2 escrow;
    MockERC20 panal;

    address client = makeAddr("client");
    address worker = makeAddr("worker");
    address treasury = makeAddr("treasury");
    address arbitrator = makeAddr("arbitrator");
    address rando = makeAddr("rando");

    uint256 constant PRICE_NATIVE = 1 ether;
    uint256 constant PRICE_TOKEN = 100e18; // 100 $PANAL
    bytes32 constant TASK_HASH = keccak256("task description");
    bytes32 constant RESULT_HASH = keccak256("result");
    address constant NATIVE = address(0);

    function setUp() public {
        panal = new MockERC20("Panal", "PANAL");
        registry = new PanalRegistryV2(address(panal));
        reputation = new PanalReputation();
        escrow = new PanalEscrowV2(address(registry), address(reputation), treasury, arbitrator, address(panal));
        reputation.setEscrow(address(escrow));

        vm.prank(worker);
        registry.registerAgent("ipfs://worker", PRICE_TOKEN, address(panal));

        vm.deal(client, 100 ether);
        panal.mint(client, 10_000e18);
        panal.mint(rando, 10_000e18);
    }

    function _createTokenTask() internal returns (uint256 taskId) {
        vm.startPrank(client);
        panal.approve(address(escrow), PRICE_TOKEN);
        taskId = escrow.createTask(worker, TASK_HASH, block.timestamp + 1 days, address(panal), PRICE_TOKEN);
        vm.stopPrank();
    }

    function _createTokenDelivered() internal returns (uint256 taskId) {
        taskId = _createTokenTask();
        vm.prank(worker);
        escrow.deliverResult(taskId, RESULT_HASH);
    }

    function test_CreateTaskTokenPullsExactAmount() public {
        uint256 clientBefore = panal.balanceOf(client);
        uint256 taskId = _createTokenTask();

        assertEq(taskId, 0);
        assertEq(panal.balanceOf(address(escrow)), PRICE_TOKEN);
        assertEq(panal.balanceOf(client), clientBefore - PRICE_TOKEN);
        assertEq(address(escrow).balance, 0); // no se toco MON

        (address c, address w, uint256 amount,,,,, PanalEscrowV2.Status st, address currency) = escrow.tasks(taskId);
        assertEq(c, client);
        assertEq(w, worker);
        assertEq(amount, PRICE_TOKEN);
        assertEq(currency, address(panal));
        assertEq(uint8(st), uint8(PanalEscrowV2.Status.Open));
    }

    function test_CreateTaskTokenExactApprove() public {
        // approve exacto: funciona
        vm.startPrank(client);
        panal.approve(address(escrow), PRICE_TOKEN);
        escrow.createTask(worker, TASK_HASH, block.timestamp + 1 days, address(panal), PRICE_TOKEN);
        vm.stopPrank();
        assertEq(panal.allowance(client, address(escrow)), 0); // allowance consumido
    }

    function test_CreateTaskTokenWithoutApproveReverts() public {
        vm.prank(client);
        vm.expectRevert("PanalEscrow: token transfer failed");
        escrow.createTask(worker, TASK_HASH, block.timestamp + 1 days, address(panal), PRICE_TOKEN);
    }

    function test_CreateTaskTokenInsufficientApproveReverts() public {
        vm.startPrank(client);
        panal.approve(address(escrow), PRICE_TOKEN - 1);
        vm.expectRevert("PanalEscrow: token transfer failed");
        escrow.createTask(worker, TASK_HASH, block.timestamp + 1 days, address(panal), PRICE_TOKEN);
        vm.stopPrank();
    }

    function test_CreateTaskTokenWithNativeValueReverts() public {
        vm.startPrank(client);
        panal.approve(address(escrow), PRICE_TOKEN);
        vm.expectRevert("PanalEscrow: unexpected native value");
        escrow.createTask{value: 1 wei}(worker, TASK_HASH, block.timestamp + 1 days, address(panal), PRICE_TOKEN);
        vm.stopPrank();
    }

    function test_TokenMinAmount() public {
        uint256 min = escrow.MIN_TASK_AMOUNT_TOKEN();
        assertEq(min, 1e18);

        vm.startPrank(client);
        panal.approve(address(escrow), min);
        vm.expectRevert("PanalEscrow: below minimum");
        escrow.createTask(worker, TASK_HASH, block.timestamp + 1 days, address(panal), min - 1);
        vm.stopPrank();

        // exactamente el minimo funciona
        vm.startPrank(client);
        panal.approve(address(escrow), min);
        uint256 taskId = escrow.createTask(worker, TASK_HASH, block.timestamp + 1 days, address(panal), min);
        vm.stopPrank();
        (,, uint256 amount,,,,,,) = escrow.tasks(taskId);
        assertEq(amount, min);
    }

    function test_TokenApproveAndReleaseExactFee() public {
        uint256 taskId = _createTokenDelivered();

        vm.prank(client);
        escrow.approveAndRelease(taskId, 4);

        uint256 expectedFee = (PRICE_TOKEN * escrow.FEE_BPS()) / 10_000; // 2.5 PANAL
        uint256 expectedPay = PRICE_TOKEN - expectedFee;
        assertEq(expectedFee, 2.5e18);

        assertEq(escrow.pendingWithdrawals(address(panal), worker), expectedPay);
        assertEq(escrow.pendingWithdrawals(address(panal), treasury), expectedFee);
        // moneda nativa intacta
        assertEq(escrow.pendingWithdrawals(NATIVE, worker), 0);
        assertEq(escrow.pendingWithdrawals(NATIVE, treasury), 0);

        vm.prank(worker);
        escrow.withdraw(address(panal));
        vm.prank(treasury);
        escrow.withdraw(address(panal));

        assertEq(panal.balanceOf(worker), expectedPay);
        assertEq(panal.balanceOf(treasury), expectedFee);
        assertEq(panal.balanceOf(address(escrow)), 0);

        PanalReputation.Reputation memory rep = reputation.getReputation(worker);
        assertEq(rep.tasksCompleted, 1);
        assertEq(rep.ratingSum, 4);
        assertEq(rep.totalEarned, expectedPay);
    }

    function test_WithdrawCurrencyIsolation() public {
        // task 0 en PANAL, task 1 en MON, mismo worker/client
        uint256 taskToken = _createTokenDelivered();
        vm.prank(client);
        uint256 taskNative =
            escrow.createTask{value: PRICE_NATIVE}(worker, TASK_HASH, block.timestamp + 1 days, NATIVE, PRICE_NATIVE);
        vm.prank(worker);
        escrow.deliverResult(taskNative, RESULT_HASH);

        vm.startPrank(client);
        escrow.approveAndRelease(taskToken, 5);
        escrow.approveAndRelease(taskNative, 5);
        vm.stopPrank();

        uint256 feeT = (PRICE_TOKEN * escrow.FEE_BPS()) / 10_000;
        uint256 feeN = (PRICE_NATIVE * escrow.FEE_BPS()) / 10_000;

        // retirar PANAL no toca el saldo en MON y viceversa
        uint256 workerMonBefore = worker.balance;
        vm.prank(worker);
        escrow.withdraw(address(panal));
        assertEq(panal.balanceOf(worker), PRICE_TOKEN - feeT);
        assertEq(worker.balance, workerMonBefore); // MON intacto
        assertEq(escrow.pendingWithdrawals(NATIVE, worker), PRICE_NATIVE - feeN);

        vm.prank(worker);
        escrow.withdraw(NATIVE);
        assertEq(worker.balance, workerMonBefore + PRICE_NATIVE - feeN);
        assertEq(escrow.pendingWithdrawals(address(panal), worker), 0);

        // doble retiro en cualquiera de las dos monedas revierte
        vm.prank(worker);
        vm.expectRevert("PanalEscrow: nothing to withdraw");
        escrow.withdraw(address(panal));
        vm.prank(worker);
        vm.expectRevert("PanalEscrow: nothing to withdraw");
        escrow.withdraw(NATIVE);
    }

    function test_FullDualFlowSameAccounts() public {
        // mismas cuentas, una task por moneda, en paralelo
        uint256 taskToken = _createTokenTask();
        vm.prank(client);
        uint256 taskNative =
            escrow.createTask{value: PRICE_NATIVE}(worker, TASK_HASH, block.timestamp + 1 days, NATIVE, PRICE_NATIVE);

        vm.startPrank(worker);
        escrow.deliverResult(taskToken, RESULT_HASH);
        escrow.deliverResult(taskNative, RESULT_HASH);
        vm.stopPrank();

        // aprueba la de PANAL con rating 4, auto-release de la de MON (rating 5)
        vm.prank(client);
        escrow.approveAndRelease(taskToken, 4);

        vm.warp(block.timestamp + escrow.AUTO_RELEASE());
        vm.prank(rando);
        escrow.autoRelease(taskNative);

        uint256 feeT = (PRICE_TOKEN * escrow.FEE_BPS()) / 10_000;
        uint256 feeN = (PRICE_NATIVE * escrow.FEE_BPS()) / 10_000;
        assertEq(escrow.pendingWithdrawals(address(panal), worker), PRICE_TOKEN - feeT);
        assertEq(escrow.pendingWithdrawals(NATIVE, worker), PRICE_NATIVE - feeN);
        assertEq(escrow.pendingWithdrawals(address(panal), treasury), feeT);
        assertEq(escrow.pendingWithdrawals(NATIVE, treasury), feeN);

        // reputacion combinada: 2 tareas, ratings 4 y 5 => score 450
        PanalReputation.Reputation memory rep = reputation.getReputation(worker);
        assertEq(rep.tasksCompleted, 2);
        assertEq(rep.ratingSum, 9);
        assertEq(rep.totalEarned, (PRICE_TOKEN - feeT) + (PRICE_NATIVE - feeN));
        assertEq(reputation.getScore(worker), 450);
    }

    function test_TokenDisputeAndResolve() public {
        uint256 taskId = _createTokenDelivered();

        vm.prank(worker);
        escrow.openDispute(taskId);

        vm.prank(arbitrator);
        escrow.resolveDispute(taskId, 5_000, 3);

        uint256 workerGross = PRICE_TOKEN / 2;
        uint256 fee = (workerGross * escrow.FEE_BPS()) / 10_000;
        assertEq(escrow.pendingWithdrawals(address(panal), worker), workerGross - fee);
        assertEq(escrow.pendingWithdrawals(address(panal), treasury), fee);
        assertEq(escrow.pendingWithdrawals(address(panal), client), PRICE_TOKEN / 2);

        uint256 clientBefore = panal.balanceOf(client);
        vm.prank(client);
        escrow.withdraw(address(panal));
        vm.prank(worker);
        escrow.withdraw(address(panal));
        vm.prank(treasury);
        escrow.withdraw(address(panal));

        assertEq(panal.balanceOf(client), clientBefore + PRICE_TOKEN / 2);
        assertEq(panal.balanceOf(worker), workerGross - fee);
        assertEq(panal.balanceOf(treasury), fee);
        assertEq(panal.balanceOf(address(escrow)), 0);

        PanalReputation.Reputation memory rep = reputation.getReputation(worker);
        assertEq(rep.tasksCompleted, 1);
        assertEq(rep.ratingSum, 3);
    }

    function test_TokenResolveStuckDispute() public {
        uint256 taskId = _createTokenDelivered();
        vm.prank(client);
        escrow.openDispute(taskId);

        vm.expectRevert("PanalEscrow: not stuck");
        escrow.resolveStuckDispute(taskId);

        vm.warp(block.timestamp + escrow.DISPUTE_TIMEOUT());
        vm.prank(rando);
        escrow.resolveStuckDispute(taskId);

        (,,,,,,, PanalEscrowV2.Status st,) = escrow.tasks(taskId);
        assertEq(uint8(st), uint8(PanalEscrowV2.Status.Cancelled));
        assertEq(escrow.pendingWithdrawals(address(panal), client), PRICE_TOKEN);

        uint256 clientBefore = panal.balanceOf(client);
        vm.prank(client);
        escrow.withdraw(address(panal));
        assertEq(panal.balanceOf(client), clientBefore + PRICE_TOKEN);
        assertEq(panal.balanceOf(address(escrow)), 0);
    }

    function test_TokenCancelUnclaimedTask() public {
        vm.startPrank(client);
        panal.approve(address(escrow), PRICE_TOKEN);
        uint256 taskId = escrow.createTask(address(0), TASK_HASH, block.timestamp + 1 days, address(panal), PRICE_TOKEN);
        vm.stopPrank();

        uint256 clientBefore = panal.balanceOf(client);
        vm.prank(client);
        escrow.cancelTask(taskId);
        assertEq(escrow.pendingWithdrawals(address(panal), client), PRICE_TOKEN);
        vm.prank(client);
        escrow.withdraw(address(panal));
        assertEq(panal.balanceOf(client), clientBefore + PRICE_TOKEN);
    }

    function test_TokenOpenTaskClaim() public {
        address worker2 = makeAddr("worker2");
        vm.prank(worker2);
        registry.registerAgent("ipfs://worker2", PRICE_TOKEN, address(panal));

        vm.startPrank(client);
        panal.approve(address(escrow), PRICE_TOKEN);
        uint256 taskId = escrow.createTask(address(0), TASK_HASH, block.timestamp + 1 days, address(panal), PRICE_TOKEN);
        vm.stopPrank();

        vm.prank(worker2);
        escrow.claimTask(taskId);
        (, address w,,,,,,,) = escrow.tasks(taskId);
        assertEq(w, worker2);

        vm.prank(worker2);
        escrow.deliverResult(taskId, RESULT_HASH);
        vm.prank(client);
        escrow.approveAndRelease(taskId, 5);

        uint256 fee = (PRICE_TOKEN * escrow.FEE_BPS()) / 10_000;
        assertEq(escrow.pendingWithdrawals(address(panal), worker2), PRICE_TOKEN - fee);
    }

    function test_MixedApproveReleaseRatings() public {
        // task 0 PANAL rating 2, task 1 MON rating 5: reputacion agrega ambas
        uint256 taskToken = _createTokenDelivered();
        vm.prank(client);
        uint256 taskNative =
            escrow.createTask{value: PRICE_NATIVE}(worker, TASK_HASH, block.timestamp + 1 days, NATIVE, PRICE_NATIVE);
        vm.prank(worker);
        escrow.deliverResult(taskNative, RESULT_HASH);

        vm.startPrank(client);
        escrow.approveAndRelease(taskToken, 2);
        escrow.approveAndRelease(taskNative, 5);
        vm.stopPrank();

        // score = (2+5)/2 * 100 = 350
        assertEq(reputation.getScore(worker), 350);

        uint256 feeT = (PRICE_TOKEN * escrow.FEE_BPS()) / 10_000;
        uint256 feeN = (PRICE_NATIVE * escrow.FEE_BPS()) / 10_000;
        PanalReputation.Reputation memory rep = reputation.getReputation(worker);
        assertEq(rep.tasksCompleted, 2);
        assertEq(rep.totalEarned, (PRICE_TOKEN - feeT) + (PRICE_NATIVE - feeN));
    }

    function test_TokenCreateTaskInactiveWorkerReverts() public {
        vm.startPrank(client);
        panal.approve(address(escrow), PRICE_TOKEN);
        vm.expectRevert("PanalEscrow: worker not active agent");
        escrow.createTask(rando, TASK_HASH, block.timestamp + 1 days, address(panal), PRICE_TOKEN);
        vm.stopPrank();
    }
}
