// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/PanalRegistry.sol";

contract PanalRegistryTest is Test {
    PanalRegistry registry;
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    function setUp() public {
        registry = new PanalRegistry();
    }

    function test_RegisterAgent() public {
        vm.prank(alice);
        registry.registerAgent("ipfs://alice-agent", 1 ether);

        PanalRegistry.Agent memory agent = registry.getAgent(alice);
        assertEq(agent.owner, alice);
        assertEq(agent.metadataURI, "ipfs://alice-agent");
        assertEq(agent.pricePerTask, 1 ether);
        assertTrue(agent.active);
        assertEq(agent.registeredAt, block.timestamp);
        assertEq(registry.getAgentCount(), 1);
        assertTrue(registry.isActiveAgent(alice));
    }

    function test_RegisterEmitsEvent() public {
        vm.expectEmit(true, true, false, true);
        emit PanalRegistry.AgentRegistered(alice, alice, 1 ether);
        vm.prank(alice);
        registry.registerAgent("ipfs://alice-agent", 1 ether);
    }

    function test_DoubleRegisterReverts() public {
        vm.startPrank(alice);
        registry.registerAgent("ipfs://alice-agent", 1 ether);
        vm.expectRevert("PanalRegistry: already registered");
        registry.registerAgent("ipfs://otro", 2 ether);
        vm.stopPrank();
    }

    function test_UpdateOnlyOwner() public {
        vm.prank(alice);
        registry.registerAgent("ipfs://alice-agent", 1 ether);

        // bob no es owner del agente (ni siquiera esta registrado) => revierte
        vm.prank(bob);
        vm.expectRevert("PanalRegistry: agent not registered");
        registry.updatePrice(5 ether);

        vm.prank(bob);
        vm.expectRevert("PanalRegistry: agent not registered");
        registry.updateMetadata("ipfs://hack");

        vm.prank(bob);
        vm.expectRevert("PanalRegistry: agent not registered");
        registry.setActive(false);
    }

    function test_UpdateFunctions() public {
        vm.startPrank(alice);
        registry.registerAgent("ipfs://alice-agent", 1 ether);
        registry.updatePrice(2 ether);
        registry.updateMetadata("ipfs://v2");
        registry.setActive(false);
        vm.stopPrank();

        PanalRegistry.Agent memory agent = registry.getAgent(alice);
        assertEq(agent.pricePerTask, 2 ether);
        assertEq(agent.metadataURI, "ipfs://v2");
        assertFalse(agent.active);
        assertFalse(registry.isActiveAgent(alice));
    }

    function test_UpdateUnregisteredReverts() public {
        vm.prank(alice);
        vm.expectRevert("PanalRegistry: agent not registered");
        registry.updatePrice(1 ether);
    }

    function test_Pagination() public {
        for (uint256 i = 0; i < 5; i++) {
            address a = makeAddr(string.concat("agent", vm.toString(i)));
            vm.prank(a);
            registry.registerAgent("ipfs://meta", 1 ether);
        }
        assertEq(registry.getAgentCount(), 5);

        address[] memory page1 = registry.getAgents(0, 2);
        assertEq(page1.length, 2);

        address[] memory page2 = registry.getAgents(2, 2);
        assertEq(page2.length, 2);

        address[] memory page3 = registry.getAgents(4, 10);
        assertEq(page3.length, 1);

        address[] memory empty = registry.getAgents(5, 2);
        assertEq(empty.length, 0);

        address[] memory all = registry.getAgents(0, 100);
        assertEq(all.length, 5);
        assertEq(all[0], makeAddr(string.concat("agent", vm.toString(uint256(0)))));
        assertEq(all[4], makeAddr(string.concat("agent", vm.toString(uint256(4)))));
    }
}
