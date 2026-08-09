// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PanalPayments} from "../../src/v2/PanalPayments.sol";
import {MockERC20Permit} from "./mocks/MockERC20Permit.sol";

/// @notice Tests de PanalPayments: liquidación de micropagos x402.
contract PanalPaymentsTest is Test {
    PanalPayments internal payments;
    MockERC20Permit internal token;

    uint256 internal payerKey = 0xA11CE;
    address internal payer;
    address internal agent = address(0xA6E7);
    address internal treasury = address(0x7BEA);
    address internal owner = address(this);

    uint256 internal constant PRICE = 0.002 ether; // 0,002 $PANAL
    bytes32 internal constant RESOURCE = keccak256("POST /x402/ask");

    function setUp() public {
        payer = vm.addr(payerKey);
        token = new MockERC20Permit("PANAL", "PANAL");
        payments = new PanalPayments(address(token), treasury, 250);

        token.mint(payer, 100 ether);
        vm.prank(payer);
        token.approve(address(payments), type(uint256).max);
    }

    // ---------------------------------------------------------------------
    // Utilidades
    // ---------------------------------------------------------------------

    function _sign(uint256 key, address payee, uint256 value, uint256 nonce, uint256 deadline)
        internal
        view
        returns (bytes memory)
    {
        bytes32 digest = payments.hashPayCall(vm.addr(key), payee, value, nonce, deadline, RESOURCE);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    // ---------------------------------------------------------------------
    // Camino feliz y reparto
    // ---------------------------------------------------------------------

    function test_PayGoesToAgentAndTreasury() public {
        uint256 deadline = block.timestamp + 300;
        bytes memory sig = _sign(payerKey, agent, PRICE, 1, deadline);

        uint256 fee = payments.pay(payer, agent, PRICE, 1, deadline, RESOURCE, sig);

        assertEq(fee, (PRICE * 250) / 10_000, "comision del 2,5%");
        assertEq(token.balanceOf(agent), PRICE - fee, "el agente cobra el neto");
        assertEq(token.balanceOf(treasury), fee, "el treasury cobra la comision");
        assertEq(token.balanceOf(payer), 100 ether - PRICE, "al pagador se le descuenta el total");
    }

    function test_ContractNeverHoldsFunds() public {
        uint256 deadline = block.timestamp + 300;
        payments.pay(payer, agent, PRICE, 1, deadline, RESOURCE, _sign(payerKey, agent, PRICE, 1, deadline));
        assertEq(token.balanceOf(address(payments)), 0, "el contrato no retiene nada");
    }

    function test_PayEmitsCallPaid() public {
        uint256 deadline = block.timestamp + 300;
        uint256 fee = (PRICE * 250) / 10_000;
        vm.expectEmit(true, true, true, true);
        emit PanalPayments.CallPaid(payer, agent, PRICE, fee, RESOURCE, 7);
        payments.pay(payer, agent, PRICE, 7, deadline, RESOURCE, _sign(payerKey, agent, PRICE, 7, deadline));
    }

    function test_QuoteMatchesActualSplit() public {
        (uint256 net, uint256 fee) = payments.quote(PRICE);
        uint256 deadline = block.timestamp + 300;
        uint256 realFee =
            payments.pay(payer, agent, PRICE, 1, deadline, RESOURCE, _sign(payerKey, agent, PRICE, 1, deadline));
        assertEq(realFee, fee, "quote coincide con la comision real");
        assertEq(token.balanceOf(agent), net, "quote coincide con el neto real");
    }

    function test_ZeroFeeSendsEverythingToAgent() public {
        payments.setFeeBps(0);
        uint256 deadline = block.timestamp + 300;
        payments.pay(payer, agent, PRICE, 1, deadline, RESOURCE, _sign(payerKey, agent, PRICE, 1, deadline));
        assertEq(token.balanceOf(agent), PRICE, "sin comision, todo al agente");
        assertEq(token.balanceOf(treasury), 0, "el treasury no recibe nada");
    }

    // ---------------------------------------------------------------------
    // LA propiedad de seguridad: la firma ata al cobrador
    // ---------------------------------------------------------------------

    /// Un permit a secas autoriza un gasto pero no dice a quién se paga: quien
    /// viera la firma podría cobrársela. Aquí el cobrador va dentro del digest.
    function test_SignatureCannotBeRedirectedToAnotherPayee() public {
        uint256 deadline = block.timestamp + 300;
        bytes memory sigForAgent = _sign(payerKey, agent, PRICE, 1, deadline);
        address ladron = address(0xBAD);

        vm.expectRevert("PanalPayments: firma invalida");
        payments.pay(payer, ladron, PRICE, 1, deadline, RESOURCE, sigForAgent);
    }

    function test_SignatureCannotBeReusedForBiggerAmount() public {
        uint256 deadline = block.timestamp + 300;
        bytes memory sig = _sign(payerKey, agent, PRICE, 1, deadline);
        vm.expectRevert("PanalPayments: firma invalida");
        payments.pay(payer, agent, PRICE * 10, 1, deadline, RESOURCE, sig);
    }

    function test_SignatureFromAnotherWalletReverts() public {
        uint256 deadline = block.timestamp + 300;
        bytes memory sig = _sign(0xB0B, agent, PRICE, 1, deadline);
        vm.expectRevert("PanalPayments: firma invalida");
        payments.pay(payer, agent, PRICE, 1, deadline, RESOURCE, sig);
    }

    function test_MalleableSignatureReverts() public {
        uint256 deadline = block.timestamp + 300;
        bytes32 digest = payments.hashPayCall(payer, agent, PRICE, 1, deadline, RESOURCE);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(payerKey, digest);
        // Gemela de la firma: s' = n - s, v invertida. Sin la guarda, sería
        // igual de valida y una firma tendria dos representaciones.
        uint256 n = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;
        bytes32 sFlipped = bytes32(n - uint256(s));
        uint8 vFlipped = v == 27 ? 28 : 27;
        vm.expectRevert("PanalPayments: firma maleable");
        payments.pay(payer, agent, PRICE, 1, deadline, RESOURCE, abi.encodePacked(r, sFlipped, vFlipped));
    }

    function test_BadSignatureLengthReverts() public {
        uint256 deadline = block.timestamp + 300;
        vm.expectRevert("PanalPayments: firma no son 65 bytes");
        payments.pay(payer, agent, PRICE, 1, deadline, RESOURCE, hex"abcd");
    }

    // ---------------------------------------------------------------------
    // Nonces: un solo uso, y NO secuenciales
    // ---------------------------------------------------------------------

    function test_SameNonceCannotBeSpentTwice() public {
        uint256 deadline = block.timestamp + 300;
        bytes memory sig = _sign(payerKey, agent, PRICE, 1, deadline);
        payments.pay(payer, agent, PRICE, 1, deadline, RESOURCE, sig);
        vm.expectRevert("PanalPayments: nonce ya usado");
        payments.pay(payer, agent, PRICE, 1, deadline, RESOURCE, sig);
    }

    /// El nonce secuencial de EIP-2612 hace colisionar las llamadas en paralelo
    /// del mismo pagador. Aquí son arbitrarios y el orden da igual.
    function test_ArbitraryNoncesInAnyOrder() public {
        uint256 deadline = block.timestamp + 300;
        payments.pay(payer, agent, PRICE, 999, deadline, RESOURCE, _sign(payerKey, agent, PRICE, 999, deadline));
        payments.pay(payer, agent, PRICE, 5, deadline, RESOURCE, _sign(payerKey, agent, PRICE, 5, deadline));
        payments.pay(payer, agent, PRICE, 12345, deadline, RESOURCE, _sign(payerKey, agent, PRICE, 12345, deadline));

        assertTrue(payments.nonceUsed(payer, 999));
        assertTrue(payments.nonceUsed(payer, 5));
        assertTrue(payments.nonceUsed(payer, 12345));
        assertFalse(payments.nonceUsed(payer, 6), "un nonce sin usar sigue libre");
        assertEq(token.balanceOf(agent), 3 * (PRICE - (PRICE * 250) / 10_000));
    }

    function test_NoncesAreIndependentPerPayer() public {
        uint256 otherKey = 0xB0B;
        address other = vm.addr(otherKey);
        token.mint(other, 10 ether);
        vm.prank(other);
        token.approve(address(payments), type(uint256).max);

        uint256 deadline = block.timestamp + 300;
        payments.pay(payer, agent, PRICE, 1, deadline, RESOURCE, _sign(payerKey, agent, PRICE, 1, deadline));
        // El mismo numero de nonce, otro pagador: debe funcionar.
        payments.pay(other, agent, PRICE, 1, deadline, RESOURCE, _sign(otherKey, agent, PRICE, 1, deadline));
        assertTrue(payments.nonceUsed(other, 1));
    }

    // ---------------------------------------------------------------------
    // Validaciones de entrada
    // ---------------------------------------------------------------------

    function test_ExpiredDeadlineReverts() public {
        uint256 deadline = block.timestamp + 300;
        bytes memory sig = _sign(payerKey, agent, PRICE, 1, deadline);
        vm.warp(deadline + 1);
        vm.expectRevert("PanalPayments: autorizacion caducada");
        payments.pay(payer, agent, PRICE, 1, deadline, RESOURCE, sig);
    }

    function test_ZeroValueReverts() public {
        uint256 deadline = block.timestamp + 300;
        bytes memory sig = _sign(payerKey, agent, 0, 1, deadline);
        vm.expectRevert("PanalPayments: importe cero");
        payments.pay(payer, agent, 0, 1, deadline, RESOURCE, sig);
    }

    function test_ZeroPayeeReverts() public {
        uint256 deadline = block.timestamp + 300;
        bytes memory sig = _sign(payerKey, address(0), PRICE, 1, deadline);
        vm.expectRevert("PanalPayments: cobrador cero");
        payments.pay(payer, address(0), PRICE, 1, deadline, RESOURCE, sig);
    }

    function test_PayingYourselfReverts() public {
        uint256 deadline = block.timestamp + 300;
        bytes memory sig = _sign(payerKey, payer, PRICE, 1, deadline);
        vm.expectRevert("PanalPayments: pagador y cobrador iguales");
        payments.pay(payer, payer, PRICE, 1, deadline, RESOURCE, sig);
    }

    function test_WithoutAllowanceReverts() public {
        vm.prank(payer);
        token.approve(address(payments), 0);
        uint256 deadline = block.timestamp + 300;
        bytes memory sig = _sign(payerKey, agent, PRICE, 1, deadline);
        vm.expectRevert("PanalPayments: transferFrom fallo");
        payments.pay(payer, agent, PRICE, 1, deadline, RESOURCE, sig);
    }

    function test_InsufficientBalanceReverts() public {
        uint256 deadline = block.timestamp + 300;
        bytes memory sig = _sign(payerKey, agent, 1_000 ether, 1, deadline);
        vm.expectRevert("PanalPayments: transferFrom fallo");
        payments.pay(payer, agent, 1_000 ether, 1, deadline, RESOURCE, sig);
    }

    // ---------------------------------------------------------------------
    // permitAndPay: primer pago sin autorización previa
    // ---------------------------------------------------------------------

    function _permitData(uint256 key, uint256 value, uint256 deadline)
        internal
        view
        returns (PanalPayments.PermitData memory)
    {
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"),
                vm.addr(key),
                address(payments),
                value,
                token.nonces(vm.addr(key)),
                deadline
            )
        );
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(key, keccak256(abi.encodePacked("\x19\x01", token.DOMAIN_SEPARATOR(), structHash)));
        return PanalPayments.PermitData(value, deadline, v, r, s);
    }

    function test_PermitAndPayWorksWithoutPriorApproval() public {
        address newPayer = vm.addr(0xC0FFEE);
        token.mint(newPayer, 10 ether);
        assertEq(token.allowance(newPayer, address(payments)), 0, "arranca sin autorizacion");

        uint256 deadline = block.timestamp + 300;
        payments.permitAndPay(
            newPayer,
            agent,
            PRICE,
            1,
            deadline,
            RESOURCE,
            _sign(0xC0FFEE, agent, PRICE, 1, deadline),
            _permitData(0xC0FFEE, 1 ether, deadline)
        );

        assertEq(token.balanceOf(agent), PRICE - (PRICE * 250) / 10_000, "el agente cobro");
        assertGt(token.allowance(newPayer, address(payments)), 0, "queda presupuesto para siguientes llamadas");
    }

    /// Si alguien se adelanta y ejecuta el permit, el pago debe seguir adelante:
    /// revertir permitiria bloquear pagos ajenos adelantandose a consumirlo.
    function test_PermitAndPaySurvivesFrontRunPermit() public {
        address newPayer = vm.addr(0xC0FFEE);
        token.mint(newPayer, 10 ether);
        uint256 deadline = block.timestamp + 300;
        PanalPayments.PermitData memory p = _permitData(0xC0FFEE, 1 ether, deadline);

        // Un tercero ejecuta el permit antes.
        vm.prank(address(0xF00D));
        token.permit(newPayer, address(payments), p.value, p.deadline, p.v, p.r, p.s);

        payments.permitAndPay(
            newPayer, agent, PRICE, 1, deadline, RESOURCE, _sign(0xC0FFEE, agent, PRICE, 1, deadline), p
        );
        assertEq(token.balanceOf(agent), PRICE - (PRICE * 250) / 10_000, "cobro igualmente");
    }

    // ---------------------------------------------------------------------
    // Administración
    // ---------------------------------------------------------------------

    function test_FeeCannotExceedHardCap() public {
        vm.expectRevert("PanalPayments: fee por encima del tope");
        payments.setFeeBps(251);
    }

    function test_ConstructorRejectsFeeAboveCap() public {
        vm.expectRevert("PanalPayments: fee por encima del tope");
        new PanalPayments(address(token), treasury, 10_000);
    }

    function test_LowerFeeIsAppliedImmediately() public {
        payments.setFeeBps(100); // 1 %: el descuento por pagar en $PANAL
        uint256 deadline = block.timestamp + 300;
        uint256 fee =
            payments.pay(payer, agent, PRICE, 1, deadline, RESOURCE, _sign(payerKey, agent, PRICE, 1, deadline));
        assertEq(fee, (PRICE * 100) / 10_000, "1 %");
    }

    function test_OnlyOwnerCanAdminister() public {
        vm.startPrank(address(0xBAD));
        vm.expectRevert("PanalPayments: solo owner");
        payments.setFeeBps(0);
        vm.expectRevert("PanalPayments: solo owner");
        payments.setTreasury(address(0xBAD));
        vm.expectRevert("PanalPayments: solo owner");
        payments.transferOwnership(address(0xBAD));
        vm.stopPrank();
    }

    function test_SetTreasuryRedirectsFees() public {
        address newTreasury = address(0xC0DE);
        payments.setTreasury(newTreasury);
        uint256 deadline = block.timestamp + 300;
        payments.pay(payer, agent, PRICE, 1, deadline, RESOURCE, _sign(payerKey, agent, PRICE, 1, deadline));
        assertEq(token.balanceOf(newTreasury), (PRICE * 250) / 10_000);
        assertEq(token.balanceOf(treasury), 0, "el anterior ya no cobra");
    }

    function test_ConstructorRejectsTokenWithoutCode() public {
        vm.expectRevert("PanalPayments: token sin codigo");
        new PanalPayments(address(0xDEAD), treasury, 250);
    }

    function test_DomainSeparatorChangesWithChainId() public {
        bytes32 before = payments.DOMAIN_SEPARATOR();
        vm.chainId(999);
        assertTrue(before != payments.DOMAIN_SEPARATOR(), "se recalcula si cambia la cadena");
    }

    /// Una firma de otra cadena no vale aquí: es la defensa anti-replay entre forks.
    function test_SignatureFromAnotherChainIsRejected() public {
        uint256 deadline = block.timestamp + 300;
        bytes memory sig = _sign(payerKey, agent, PRICE, 1, deadline);
        vm.chainId(999);
        vm.expectRevert("PanalPayments: firma invalida");
        payments.pay(payer, agent, PRICE, 1, deadline, RESOURCE, sig);
    }
}
