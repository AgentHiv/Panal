// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "./PanalNames.t.sol";

/// Fuzzing de la validacion de nombres.
///
/// El contrato ya esta desplegado y es inmutable, asi que lo que interese
/// encontrar hay que encontrarlo con entradas que a nadie se le ocurren. Lo que
/// se busca no es que rechace lo que debe —eso lo cubren las pruebas normales—
/// sino que NINGUNA cadena provoque un panic: un desbordamiento, un acceso
/// fuera del array o una division por cero se manifiestan distinto que un
/// `require`, y son los que se cuelan.
///
/// El sitio que mas miedo daba: `require(b[i - 1] != "-")` dentro del bucle.
/// Con `i == 0` eso leeria b[-1]. Solo lo salva que un guion inicial ya se
/// rechazo antes del bucle, que es una dependencia entre dos lineas separadas y
/// justo el tipo de cosa que se rompe al editar.
contract PanalNamesFuzzTest is PanalNamesTest {
    /// @notice Ninguna cadena debe provocar un panic; como mucho un revert.
    function testFuzz_validar_nunca_revienta(string calldata entrada) public {
        vm.prank(agente);
        try names.reclamar(entrada) {
            // Lo acepto: entonces tiene que resolver, y su longitud estar en rango.
            uint256 largo = bytes(entrada).length;
            assertTrue(largo >= 3 && largo <= 32, "acepto un largo fuera de rango");
            assertEq(names.resolver(entrada), agente);
        } catch Error(string memory motivo) {
            // Un revert con mensaje es lo esperado: es la validacion hablando.
            bytes32 h = keccak256(bytes(motivo));
            assertTrue(
                h == keccak256("PanalNames: bad length") || h == keccak256("PanalNames: bad char")
                    || h == keccak256("PanalNames: edge hyphen") || h == keccak256("PanalNames: double hyphen")
                    || h == keccak256("PanalNames: taken") || h == keccak256("PanalNames: reserved")
                    || h == keccak256("PanalNames: already has a name"),
                string.concat("revert inesperado: ", motivo)
            );
        } catch (bytes memory raw) {
            // Aqui es donde dolerian los panics: 0x4e487b71 es su selector.
            if (raw.length >= 4) {
                bytes4 sel = bytes4(raw);
                assertTrue(sel != bytes4(0x4e487b71), "PANIC: la validacion tiene un fallo aritmetico o de indice");
            }
            revert("revert sin motivo");
        }
    }

    /// Lo que acepta tiene que ser exactamente `[a-z0-9-]`, sin guion al borde
    /// ni doble. Si algo se colara, dos nombres podrian leerse igual.
    function testFuzz_lo_aceptado_es_siempre_limpio(string calldata entrada) public {
        vm.prank(agente);
        try names.reclamar(entrada) {
            bytes memory b = bytes(entrada);
            assertTrue(b[0] != "-" && b[b.length - 1] != "-", "acepto un guion al borde");
            for (uint256 i = 0; i < b.length; i++) {
                bytes1 c = b[i];
                bool ok = (c >= 0x61 && c <= 0x7a) || (c >= 0x30 && c <= 0x39) || c == 0x2d;
                assertTrue(ok, "acepto un caracter que no es a-z0-9-");
                if (c == 0x2d && i > 0) assertTrue(b[i - 1] != "-", "acepto un guion doble");
            }
        } catch {
            // Rechazado: nada que comprobar.
        }
    }

    /// La comision jamas puede dejar al vendedor con mas de lo que pago el
    /// comprador, ni a la tesoreria con mas del tope.
    function testFuzz_la_comision_nunca_se_pasa(uint256 precio) public {
        precio = bound(precio, 1e15, 1_000_000e18);

        vm.prank(agente);
        names.reclamar("traductor");
        vm.warp(block.timestamp + 365 days);
        vm.prank(agente);
        names.ponerEnVenta(precio);

        token.dar(otro, precio);
        uint256 antesVendedor = token.balanceOf(agente);
        uint256 antesTesoro = token.balanceOf(tesoreria);

        vm.prank(otro);
        names.comprar("traductor");

        uint256 alVendedor = token.balanceOf(agente) - antesVendedor;
        uint256 alTesoro = token.balanceOf(tesoreria) - antesTesoro;

        assertEq(alVendedor + alTesoro, precio, "el reparto no cuadra con lo pagado");
        assertLe(alTesoro * 10_000, precio * names.TOPE_COMISION_BPS(), "la comision paso del tope");
    }
}
