// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/PanalNames.sol";

/// Token minimo con lo que usa PanalNames.
contract TokenFalso {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function dar(address a, uint256 v) external {
        balanceOf[a] += v;
    }

    function approve(address spender, uint256 v) external returns (bool) {
        allowance[msg.sender][spender] = v;
        return true;
    }

    function transferFrom(address from, address to, uint256 v) external returns (bool) {
        require(allowance[from][msg.sender] >= v, "allowance");
        require(balanceOf[from] >= v, "balance");
        allowance[from][msg.sender] -= v;
        balanceOf[from] -= v;
        balanceOf[to] += v;
        return true;
    }
}

contract RegistryFalso {
    mapping(address => bool) public activo;

    function setActivo(address a, bool v) external {
        activo[a] = v;
    }

    function isActiveAgent(address a) external view returns (bool) {
        return activo[a];
    }
}

contract PanalNamesTest is Test {
    PanalNames names;
    TokenFalso token;
    RegistryFalso registry;

    address tesoreria = makeAddr("tesoreria");
    address agente = makeAddr("agente");
    address otro = makeAddr("otro");
    address cualquiera = makeAddr("cualquiera");

    uint256 constant CORTO = 200_000e18;
    uint256 constant MEDIO = 40_000e18;
    uint256 constant LARGO = 10_000e18;

    function setUp() public {
        token = new TokenFalso();
        registry = new RegistryFalso();
        names = new PanalNames(address(token), address(registry), tesoreria, CORTO, MEDIO, LARGO);

        registry.setActivo(agente, true);
        registry.setActivo(otro, true);

        _fondear(agente);
        _fondear(otro);
        _fondear(cualquiera);
    }

    function _fondear(address a) private {
        token.dar(a, 5_000_000e18);
        vm.prank(a);
        token.approve(address(names), type(uint256).max);
    }

    // ── reclamar ────────────────────────────────────────────────────────────

    function test_reclamar_cobra_y_apunta_en_los_dos_sentidos() public {
        vm.prank(agente);
        names.reclamar("traductor", 1);

        assertEq(names.resolver("traductor"), agente);
        assertEq(names.nombreDe(agente), "traductor");
        assertEq(token.balanceOf(tesoreria), LARGO, "el alquiler va al tesoro");
    }

    function test_solo_un_agente_activo_puede_reclamar() public {
        vm.prank(cualquiera); // no esta en el registry
        vm.expectRevert("PanalNames: not an active agent");
        names.reclamar("traductor", 1);
    }

    function test_un_nombre_por_direccion() public {
        vm.startPrank(agente);
        names.reclamar("traductor", 1);
        vm.expectRevert("PanalNames: already has a name");
        names.reclamar("revisor", 1);
        vm.stopPrank();
    }

    /// Si se te pasa el plazo y nadie te lo quita, no te quedas atrapado sin
    /// poder pedir ninguno.
    function test_si_caduca_del_todo_puede_pedir_otro_sin_liberar_antes() public {
        vm.prank(agente);
        names.reclamar("traductor", 1);

        vm.warp(block.timestamp + 365 days + 90 days + 1);

        vm.prank(agente);
        names.reclamar("revisor", 1);

        assertEq(names.nombreDe(agente), "revisor");
        assertTrue(names.disponible("traductor"), "el viejo queda libre para otros");
    }

    function test_si_caduca_del_todo_puede_recuperar_el_suyo() public {
        vm.prank(agente);
        names.reclamar("traductor", 1);

        vm.warp(block.timestamp + 365 days + 90 days + 1);

        vm.prank(agente);
        names.reclamar("traductor", 1);
        assertEq(names.resolver("traductor"), agente);
    }

    /// En gracia todavia es suyo: lo que toca es renovar, no pedir otro.
    function test_en_gracia_no_se_le_suelta_el_nombre() public {
        vm.prank(agente);
        names.reclamar("traductor", 1);

        vm.warp(block.timestamp + 365 days + 89 days);

        vm.prank(agente);
        vm.expectRevert("PanalNames: already has a name");
        names.reclamar("revisor", 1);
    }

    function test_un_nombre_ocupado_no_se_puede_robar() public {
        vm.prank(agente);
        names.reclamar("traductor", 1);

        vm.prank(otro);
        vm.expectRevert("PanalNames: taken");
        names.reclamar("traductor", 1);
    }

    /// El caso que hace que el alquiler tenga sentido: lo abandonado vuelve al
    /// mercado, y el dueño anterior deja de tener nombre.
    function test_pasada_la_gracia_lo_coge_otro_y_el_anterior_se_queda_sin_nombre() public {
        vm.prank(agente);
        names.reclamar("traductor", 1);

        vm.warp(block.timestamp + 365 days + 90 days + 1);
        assertTrue(names.disponible("traductor"));

        vm.prank(otro);
        names.reclamar("traductor", 1);

        assertEq(names.resolver("traductor"), otro);
        assertEq(names.nombreDe(agente), "", "el anterior ya no lo tiene");

        // Y al quedarse sin nombre puede pedir otro.
        vm.prank(agente);
        names.reclamar("revisor", 1);
        assertEq(names.nombreDe(agente), "revisor");
    }

    function test_en_gracia_todavia_no_lo_coge_nadie() public {
        vm.prank(agente);
        names.reclamar("traductor", 1);

        vm.warp(block.timestamp + 365 days + 89 days);
        assertFalse(names.disponible("traductor"));

        vm.prank(otro);
        vm.expectRevert("PanalNames: taken");
        names.reclamar("traductor", 1);
    }

    /// Caducado no resuelve, aunque siga en gracia: si dejo de pagar, sus
    /// clientes no deben seguir mandandole encargos.
    function test_caducado_no_resuelve_aunque_este_en_gracia() public {
        vm.prank(agente);
        names.reclamar("traductor", 1);

        vm.warp(block.timestamp + 365 days + 1);
        assertEq(names.resolver("traductor"), address(0));
        assertEq(names.nombreDe(agente), "");

        (,, bool vigente, bool enGracia) = names.fichaDe("traductor");
        assertFalse(vigente);
        assertTrue(enGracia);
    }

    // ── renovar ─────────────────────────────────────────────────────────────

    function test_renueva_cualquiera_no_solo_el_dueno() public {
        vm.prank(agente);
        names.reclamar("traductor", 1);

        vm.prank(cualquiera); // ni es el dueño ni es agente registrado
        names.renovar("traductor", 1);

        assertEq(names.resolver("traductor"), agente, "sigue siendo del mismo");
        assertEq(token.balanceOf(cualquiera), 5_000_000e18 - LARGO, "pago el que renovo");
    }

    function test_renovar_antes_de_tiempo_no_pierde_lo_que_quedaba() public {
        vm.prank(agente);
        names.reclamar("traductor", 1);
        (, uint64 primera,,) = names.fichaDe("traductor");

        vm.warp(block.timestamp + 100 days);
        vm.prank(agente);
        names.renovar("traductor", 1);

        (, uint64 segunda,,) = names.fichaDe("traductor");
        assertEq(segunda, primera + 365 days, "suma sobre el vencimiento, no sobre hoy");
    }

    function test_pasada_la_gracia_ya_no_se_renueva() public {
        vm.prank(agente);
        names.reclamar("traductor", 1);

        vm.warp(block.timestamp + 365 days + 90 days + 1);
        vm.prank(agente);
        vm.expectRevert("PanalNames: expired");
        names.renovar("traductor", 1);
    }

    function test_no_se_puede_asegurar_un_nombre_un_siglo() public {
        vm.prank(agente);
        vm.expectRevert("PanalNames: bad years");
        names.reclamar("traductor", 6);
    }

    /// Renovando de cinco en cinco tampoco se acumula mas alla del tope.
    function test_renovar_no_acumula_por_encima_del_tope() public {
        vm.prank(agente);
        names.reclamar("traductor", 5);

        vm.prank(agente);
        vm.expectRevert("PanalNames: too far");
        names.renovar("traductor", 5);
    }

    // ── liberar ─────────────────────────────────────────────────────────────

    function test_liberar_lo_deja_libre_en_el_acto() public {
        vm.prank(agente);
        names.reclamar("traductor", 1);

        vm.prank(agente);
        names.liberar();

        assertTrue(names.disponible("traductor"));
        assertEq(names.nombreDe(agente), "");

        vm.prank(otro);
        names.reclamar("traductor", 1);
        assertEq(names.resolver("traductor"), otro);
    }

    // ── validacion: aqui es donde mueren los homoglifos ─────────────────────

    function test_rechaza_lo_que_no_sea_ascii_minuscula() public {
        string[6] memory malos = [
            "Traductor", // mayuscula
            unicode"trаductor", // la 'a' es cirilica U+0430
            unicode"traductór", // acento
            "tra ductor", // espacio
            "tra_ductor", // guion bajo
            unicode"traductor​" // espacio de ancho cero
        ];
        for (uint256 i = 0; i < malos.length; i++) {
            vm.prank(agente);
            vm.expectRevert("PanalNames: bad char");
            names.reclamar(malos[i], 1);
        }
    }

    function test_rechaza_guiones_que_enganan() public {
        vm.prank(agente);
        vm.expectRevert("PanalNames: edge hyphen");
        names.reclamar("-lint", 1);

        vm.prank(agente);
        vm.expectRevert("PanalNames: edge hyphen");
        names.reclamar("lint-", 1);

        vm.prank(agente);
        vm.expectRevert("PanalNames: double hyphen");
        names.reclamar("li--nt", 1);
    }

    function test_rechaza_largos_fuera_de_rango() public {
        vm.prank(agente);
        vm.expectRevert("PanalNames: bad length");
        names.reclamar("ab", 1);

        vm.prank(agente);
        vm.expectRevert("PanalNames: bad length");
        names.reclamar("abcdefghijklmnopqrstuvwxyz1234567", 1); // 33
    }

    function test_acepta_guion_interior_y_digitos() public {
        vm.prank(agente);
        names.reclamar("lex-panal2", 1);
        assertEq(names.resolver("lex-panal2"), agente);
    }

    // ── tarifas ─────────────────────────────────────────────────────────────

    function test_precio_por_tramo() public view {
        assertEq(names.tarifaDe("abc"), CORTO);
        assertEq(names.tarifaDe("abcd"), MEDIO);
        assertEq(names.tarifaDe("abcde"), LARGO);
        assertEq(names.tarifaDe("abcdefghijk"), LARGO);
    }

    function test_varios_anios_multiplican() public {
        vm.prank(agente);
        names.reclamar("traductor", 3);
        assertEq(token.balanceOf(tesoreria), LARGO * 3);
    }

    function test_el_multisig_puede_bajar_hasta_cero() public {
        names.fijarTarifas(0, 0, 0);

        vm.prank(agente);
        names.reclamar("traductor", 1);
        assertEq(token.balanceOf(tesoreria), 0, "gratis, sin tocar el token");
        assertEq(names.resolver("traductor"), agente);
    }

    /// El tope grabado al desplegar: se puede corregir el precio, no se puede
    /// convertir en un arma.
    function test_no_se_puede_pasar_del_tope() public {
        names.fijarTarifas(CORTO * 10, MEDIO * 10, LARGO * 10); // justo el tope, vale

        vm.expectRevert("PanalNames: over cap");
        names.fijarTarifas(CORTO * 10 + 1, MEDIO, LARGO);
    }

    function test_solo_el_owner_toca_las_tarifas() public {
        vm.prank(agente);
        vm.expectRevert("PanalNames: not owner");
        names.fijarTarifas(0, 0, 0);
    }

    function test_sin_saldo_no_hay_nombre() public {
        address pobre = makeAddr("pobre");
        registry.setActivo(pobre, true);
        vm.prank(pobre);
        token.approve(address(names), type(uint256).max);

        vm.prank(pobre);
        vm.expectRevert("balance");
        names.reclamar("traductor", 1);
    }
}
