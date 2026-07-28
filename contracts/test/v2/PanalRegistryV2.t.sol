// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../../src/v2/PanalRegistryV2.sol";
import "./mocks/MockERC20.sol";

contract PanalRegistryV2Test is Test {
    PanalRegistryV2 registry;
    MockERC20 panal;
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    function setUp() public {
        panal = new MockERC20("Panal", "PANAL");
        registry = new PanalRegistryV2(address(panal));
    }

    function test_RegisterAgent() public {
        vm.prank(alice);
        registry.registerAgent("ipfs://alice-agent", 1 ether, address(0));

        PanalRegistryV2.Agent memory agent = registry.getAgent(alice);
        assertEq(agent.owner, alice);
        assertEq(agent.metadataURI, "ipfs://alice-agent");
        assertEq(agent.pricePerTask, 1 ether);
        assertEq(agent.currency, address(0));
        assertTrue(agent.active);
        assertEq(agent.registeredAt, block.timestamp);
        assertEq(registry.getAgentCount(), 1);
        assertTrue(registry.isActiveAgent(alice));
    }

    function test_RegisterAgentWithPanal() public {
        vm.prank(alice);
        registry.registerAgent("ipfs://alice-agent", 10e18, address(panal));

        PanalRegistryV2.Agent memory agent = registry.getAgent(alice);
        assertEq(agent.pricePerTask, 10e18);
        assertEq(agent.currency, address(panal));
        assertTrue(registry.isActiveAgent(alice));
    }

    function test_RegisterEmitsEvent() public {
        vm.expectEmit(true, true, false, true);
        emit PanalRegistryV2.AgentRegistered(alice, alice, 1 ether, address(0));
        vm.prank(alice);
        registry.registerAgent("ipfs://alice-agent", 1 ether, address(0));
    }

    function test_RegisterInvalidCurrencyReverts() public {
        address fakeToken = makeAddr("fakeToken");
        vm.prank(alice);
        vm.expectRevert("PanalRegistry: unsupported currency");
        registry.registerAgent("ipfs://alice-agent", 1 ether, fakeToken);
    }

    function test_DoubleRegisterReverts() public {
        vm.startPrank(alice);
        registry.registerAgent("ipfs://alice-agent", 1 ether, address(0));
        vm.expectRevert("PanalRegistry: already registered");
        registry.registerAgent("ipfs://otro", 2 ether, address(0));
        vm.stopPrank();
    }

    function test_UpdateOnlyOwner() public {
        vm.prank(alice);
        registry.registerAgent("ipfs://alice-agent", 1 ether, address(0));

        // bob no es owner del agente (ni siquiera esta registrado) => revierte
        vm.prank(bob);
        vm.expectRevert("PanalRegistry: agent not registered");
        registry.updatePrice(5 ether, address(0));

        vm.prank(bob);
        vm.expectRevert("PanalRegistry: agent not registered");
        registry.updateMetadata("ipfs://hack");

        vm.prank(bob);
        vm.expectRevert("PanalRegistry: agent not registered");
        registry.setActive(false);
    }

    function test_UpdateFunctions() public {
        vm.startPrank(alice);
        registry.registerAgent("ipfs://alice-agent", 1 ether, address(0));
        registry.updatePrice(2 ether, address(0));
        registry.updateMetadata("ipfs://v2");
        registry.setActive(false);
        vm.stopPrank();

        PanalRegistryV2.Agent memory agent = registry.getAgent(alice);
        assertEq(agent.pricePerTask, 2 ether);
        assertEq(agent.metadataURI, "ipfs://v2");
        assertFalse(agent.active);
        assertFalse(registry.isActiveAgent(alice));
    }

    function test_UpdatePriceCurrencySwitch() public {
        vm.startPrank(alice);
        registry.registerAgent("ipfs://alice-agent", 1 ether, address(0));
        registry.updatePrice(25e18, address(panal));
        vm.stopPrank();

        PanalRegistryV2.Agent memory agent = registry.getAgent(alice);
        assertEq(agent.pricePerTask, 25e18);
        assertEq(agent.currency, address(panal));
    }

    function test_UpdatePriceInvalidCurrencyReverts() public {
        vm.prank(alice);
        registry.registerAgent("ipfs://alice-agent", 1 ether, address(0));

        vm.prank(alice);
        vm.expectRevert("PanalRegistry: unsupported currency");
        registry.updatePrice(1 ether, makeAddr("fakeToken"));
    }

    function test_UpdateUnregisteredReverts() public {
        vm.prank(alice);
        vm.expectRevert("PanalRegistry: agent not registered");
        registry.updatePrice(1 ether, address(0));
    }

    function test_Pagination() public {
        for (uint256 i = 0; i < 5; i++) {
            address a = makeAddr(string.concat("agent", vm.toString(i)));
            vm.prank(a);
            registry.registerAgent("ipfs://meta", 1 ether, address(0));
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

    function test_ConstructorZeroTokenAllowed() public {
        // token = address(0): registry solo-MON, sin chequeo de bytecode
        PanalRegistryV2 nativeOnly = new PanalRegistryV2(address(0));
        assertEq(nativeOnly.PANAL_TOKEN(), address(0));

        vm.prank(alice);
        nativeOnly.registerAgent("ipfs://a", 1 ether, address(0));

        // cualquier currency no nativa revierte
        vm.prank(bob);
        vm.expectRevert("PanalRegistry: unsupported currency");
        nativeOnly.registerAgent("ipfs://b", 1 ether, address(panal));
    }

    function test_ConstructorEOATokenReverts() public {
        vm.expectRevert("PanalRegistry: token not contract");
        new PanalRegistryV2(makeAddr("eoa"));
    }
}
