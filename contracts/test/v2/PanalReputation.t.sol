// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../../src/PanalReputation.sol";

/// @notice Port directo de los tests v1 de PanalReputation (contrato conservado sin cambios en v2).
contract PanalReputationTest is Test {
    PanalReputation reputation;
    address escrow = makeAddr("escrow");
    address agent = makeAddr("agent");
    address rando = makeAddr("rando");

    function setUp() public {
        reputation = new PanalReputation();
        reputation.setEscrow(escrow);
    }

    function test_OnlyEscrowCanRecord() public {
        vm.prank(rando);
        vm.expectRevert("PanalReputation: not escrow");
        reputation.recordCompletion(agent, 5, 1 ether);
    }

    function test_SetEscrowOnlyOnce() public {
        vm.expectRevert("PanalReputation: escrow already set");
        reputation.setEscrow(rando);
    }

    function test_SetEscrowOnlyOwner() public {
        PanalReputation fresh = new PanalReputation();
        vm.prank(rando);
        vm.expectRevert("PanalReputation: not owner");
        fresh.setEscrow(escrow);
    }

    function test_InvalidRatingReverts() public {
        vm.prank(escrow);
        vm.expectRevert("PanalReputation: invalid rating");
        reputation.recordCompletion(agent, 0, 0);

        vm.prank(escrow);
        vm.expectRevert("PanalReputation: invalid rating");
        reputation.recordCompletion(agent, 6, 0);
    }

    function test_ScoreMath() public {
        assertEq(reputation.getScore(agent), 0); // sin ratings => 0

        vm.startPrank(escrow);
        reputation.recordCompletion(agent, 5, 1 ether);
        reputation.recordCompletion(agent, 4, 2 ether);
        reputation.recordCompletion(agent, 4, 0.5 ether);
        vm.stopPrank();

        // avg = 13/3 = 4.333... => x100 = 433
        assertEq(reputation.getScore(agent), 433);

        PanalReputation.Reputation memory rep = reputation.getReputation(agent);
        assertEq(rep.tasksCompleted, 3);
        assertEq(rep.totalEarned, 3.5 ether);
        assertEq(rep.ratingSum, 13);
        assertEq(rep.ratingCount, 3);
    }

    function test_ScoreExact() public {
        vm.startPrank(escrow);
        reputation.recordCompletion(agent, 5, 0);
        reputation.recordCompletion(agent, 5, 0);
        vm.stopPrank();
        assertEq(reputation.getScore(agent), 500);
    }
}
