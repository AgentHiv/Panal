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
    address tercero = makeAddr("tercero");
    address cualquiera = makeAddr("cualquiera");

    uint256 constant CORTO = 5e18;
    uint256 constant MEDIO = 3e18;
    uint256 constant LARGO = 1e18;
    uint256 constant COMISION = 50; // 0,5%

    uint256 constant SALDO = 10_000e18;

    function setUp() public {
        token = new TokenFalso();
        registry = new RegistryFalso();
        names = new PanalNames(address(token), address(registry), address(this), tesoreria, CORTO, MEDIO, LARGO, COMISION);

        registry.setActivo(agente, true);
        registry.setActivo(otro, true);
        registry.setActivo(tercero, true);

        _fondear(agente);
        _fondear(otro);
        _fondear(tercero);
        _fondear(cualquiera);
    }

    function _fondear(address a) private {
        token.dar(a, SALDO);
        vm.prank(a);
        token.approve(address(names), type(uint256).max);
    }

    // ── reclamar ────────────────────────────────────────────────────────────

    function test_reclamar_cobra_una_vez_y_apunta_en_los_dos_sentidos() public {
        vm.prank(agente);
        names.reclamar("traductor");

        assertEq(names.resolver("traductor"), agente);
        assertEq(names.nombreDe(agente), "traductor");
        assertEq(token.balanceOf(tesoreria), LARGO, "la tarifa va al tesoro");
    }

    /// Es para siempre: no caduca ni hay que renovar.
    function test_el_nombre_no_caduca() public {
        vm.prank(agente);
        names.reclamar("traductor");

        vm.warp(block.timestamp + 3650 days);
        assertEq(names.resolver("traductor"), agente);
        assertEq(names.nombreDe(agente), "traductor");
        assertFalse(names.disponible("traductor"));
    }

    function test_solo_un_agente_activo_puede_reclamar() public {
        vm.prank(cualquiera);
        vm.expectRevert("PanalNames: not an active agent");
        names.reclamar("traductor");
    }

    function test_un_nombre_por_direccion() public {
        vm.startPrank(agente);
        names.reclamar("traductor");
        vm.expectRevert("PanalNames: already has a name");
        names.reclamar("revisor");
        vm.stopPrank();
    }

    function test_un_nombre_ocupado_no_se_puede_reclamar() public {
        vm.prank(agente);
        names.reclamar("traductor");

        vm.prank(otro);
        vm.expectRevert("PanalNames: taken");
        names.reclamar("traductor");
    }

    function test_precio_por_tramo() public view {
        assertEq(names.tarifaDe("abc"), CORTO);
        assertEq(names.tarifaDe("abcd"), MEDIO);
        assertEq(names.tarifaDe("abcde"), LARGO);
        assertEq(names.tarifaDe("abcdefghijk"), LARGO);
    }

    // ── el candado del año ──────────────────────────────────────────────────

    function test_antes_del_ano_no_se_vende() public {
        vm.prank(agente);
        names.reclamar("traductor");

        vm.warp(block.timestamp + 364 days);
        vm.prank(agente);
        vm.expectRevert("PanalNames: locked");
        names.ponerEnVenta(100e18);
    }

    function test_antes_del_ano_tampoco_se_regala() public {
        vm.prank(agente);
        names.reclamar("traductor");

        vm.warp(block.timestamp + 364 days);
        vm.prank(agente);
        vm.expectRevert("PanalNames: locked");
        names.transferir(otro);
    }

    function test_cumplido_el_ano_ya_se_puede_poner_en_venta() public {
        vm.prank(agente);
        names.reclamar("traductor");

        vm.warp(block.timestamp + 365 days);
        vm.prank(agente);
        names.ponerEnVenta(100e18);

        (,, uint256 precio, bool transferible) = names.fichaDe("traductor");
        assertEq(precio, 100e18);
        assertTrue(transferible);
    }

    /// El candado se reinicia con cada dueño: comprar barato para revender la
    /// semana siguiente no funciona.
    function test_el_candado_vuelve_a_empezar_con_el_comprador() public {
        _vender("traductor", agente, otro, 100e18);

        vm.prank(otro);
        vm.expectRevert("PanalNames: locked");
        names.ponerEnVenta(500e18);

        vm.warp(block.timestamp + 365 days);
        vm.prank(otro);
        names.ponerEnVenta(500e18);
        (,, uint256 precio,) = names.fichaDe("traductor");
        assertEq(precio, 500e18);
    }

    // ── venta ───────────────────────────────────────────────────────────────

    function test_vender_cobra_el_medio_por_ciento_y_el_resto_al_vendedor() public {
        uint256 precio = 1_000e18;
        uint256 comision = precio * COMISION / 10_000; // 5e18

        uint256 antesVendedor = token.balanceOf(agente);
        _vender("traductor", agente, otro, precio);

        assertEq(names.resolver("traductor"), otro, "cambia de dueno");
        assertEq(names.nombreDe(agente), "", "el vendedor se queda sin nombre");
        assertEq(names.nombreDe(otro), "traductor");

        assertEq(token.balanceOf(tesoreria), LARGO + comision, "la tarifa inicial mas la comision");
        // Menos LARGO porque el vendedor pago su tarifa al reclamarlo.
        assertEq(
            token.balanceOf(agente), antesVendedor - LARGO + precio - comision, "al vendedor, menos la comision"
        );
        assertEq(token.balanceOf(otro), SALDO - precio, "el comprador paga el precio entero");
    }

    function test_tras_vender_el_vendedor_puede_pedir_otro_nombre() public {
        _vender("traductor", agente, otro, 100e18);

        vm.prank(agente);
        names.reclamar("revisor");
        assertEq(names.nombreDe(agente), "revisor");
    }

    function test_no_se_compra_lo_que_no_esta_en_venta() public {
        vm.prank(agente);
        names.reclamar("traductor");

        vm.prank(otro);
        vm.expectRevert("PanalNames: not for sale");
        names.comprar("traductor");
    }

    function test_el_comprador_tiene_que_ser_agente_activo_y_sin_nombre() public {
        vm.prank(agente);
        names.reclamar("traductor");
        vm.warp(block.timestamp + 365 days);
        vm.prank(agente);
        names.ponerEnVenta(100e18);

        vm.prank(cualquiera);
        vm.expectRevert("PanalNames: not an active agent");
        names.comprar("traductor");

        vm.prank(otro);
        names.reclamar("revisor");
        vm.prank(otro);
        vm.expectRevert("PanalNames: already has a name");
        names.comprar("traductor");
    }

    function test_quitar_de_venta() public {
        vm.prank(agente);
        names.reclamar("traductor");
        vm.warp(block.timestamp + 365 days);

        vm.prank(agente);
        names.ponerEnVenta(100e18);
        vm.prank(agente);
        names.quitarDeVenta();

        vm.prank(otro);
        vm.expectRevert("PanalNames: not for sale");
        names.comprar("traductor");
    }

    /// Vendido una vez, deja de estar en venta: si no, el siguiente lo compraria
    /// al mismo precio al comprador que acaba de pagarlo.
    function test_tras_venderse_deja_de_estar_en_venta() public {
        _vender("traductor", agente, otro, 100e18);

        vm.prank(tercero);
        vm.expectRevert("PanalNames: not for sale");
        names.comprar("traductor");
    }

    function test_comision_a_cero_no_toca_la_tesoreria() public {
        names.fijarComision(0);

        _vender("traductor", agente, otro, 1_000e18);
        // Solo la tarifa de reclamarlo: de la venta no se llevo nada.
        assertEq(token.balanceOf(tesoreria), LARGO, "sin comision");
    }

    /// El tope de la comision no se puede pasar: quien mande en el contrato no
    /// puede quedarse con las ventas.
    function test_la_comision_tiene_tope() public {
        names.fijarComision(200); // el tope, vale
        vm.expectRevert("PanalNames: over cap");
        names.fijarComision(201);
    }

    /// El dueño es quien se le pasa al constructor, no quien despliega. En
    /// mainnet sera el multisig, y desde el primer bloque: desplegar y
    /// transferir despues deja una ventana en la que manda una sola clave.
    function test_el_dueno_es_el_del_constructor_no_el_que_despliega() public {
        address multisig = makeAddr("multisig");
        PanalNames otro_ = new PanalNames(
            address(token), address(registry), multisig, tesoreria, CORTO, MEDIO, LARGO, COMISION
        );

        assertEq(otro_.owner(), multisig, "el owner es el multisig");

        // Y quien lo desplego no manda.
        vm.expectRevert("PanalNames: not owner");
        otro_.fijarTarifas(0, 0, 0);

        vm.prank(multisig);
        otro_.fijarTarifas(0, 0, 0);
        assertEq(otro_.tarifaLargo(), 0);
    }

    // ── el traspaso de propiedad, que va a pasar de verdad ─────────────────

    /// Se migrará: el multisig de hoy tiene los firmantes grabados en el
    /// constructor, así que añadir árbitros obliga a desplegar otro.
    function test_el_traspaso_necesita_que_el_nuevo_acepte() public {
        address multisigNuevo = makeAddr("multisigNuevo");

        names.transferOwnership(multisigNuevo);
        assertEq(names.owner(), address(this), "todavia no manda el nuevo");
        assertEq(names.propuesto(), multisigNuevo);

        // Y el viejo sigue mandando mientras tanto.
        names.fijarComision(10);

        vm.prank(multisigNuevo);
        names.aceptarPropiedad();

        assertEq(names.owner(), multisigNuevo, "ahora si");
        assertEq(names.propuesto(), address(0), "la propuesta se consume");

        vm.expectRevert("PanalNames: not owner");
        names.fijarComision(20);
    }

    function test_solo_acepta_el_propuesto() public {
        names.transferOwnership(otro);

        vm.prank(agente);
        vm.expectRevert("PanalNames: not proposed");
        names.aceptarPropiedad();
    }

    /// Lo que salva el traspaso a un multisig mal configurado: si el destino no
    /// puede transaccionar, nunca acepta y la propiedad no se pierde.
    function test_si_el_nuevo_no_acepta_el_viejo_sigue_mandando() public {
        names.transferOwnership(makeAddr("multisigRoto"));

        names.fijarTarifas(1, 1, 1);
        assertEq(names.tarifaLargo(), 1, "el dueno de siempre sigue pudiendo");
    }

    function test_una_propuesta_se_puede_cancelar() public {
        names.transferOwnership(otro);
        names.transferOwnership(address(0));

        vm.prank(otro);
        vm.expectRevert("PanalNames: not proposed");
        names.aceptarPropiedad();
    }

    function test_no_se_despliega_sin_dueno() public {
        vm.expectRevert("PanalNames: zero owner");
        new PanalNames(address(token), address(registry), address(0), tesoreria, CORTO, MEDIO, LARGO, COMISION);
    }

    function test_solo_el_owner_toca_la_comision() public {
        vm.prank(agente);
        vm.expectRevert("PanalNames: not owner");
        names.fijarComision(0);
    }

    // ── transferir y liberar ────────────────────────────────────────────────

    function test_transferir_pasado_el_ano() public {
        vm.prank(agente);
        names.reclamar("traductor");
        vm.warp(block.timestamp + 365 days);

        vm.prank(agente);
        names.transferir(otro);

        assertEq(names.resolver("traductor"), otro);
        assertEq(names.nombreDe(agente), "");
        assertEq(names.nombreDe(otro), "traductor");
    }

    function test_no_se_transfiere_a_quien_ya_tiene_nombre() public {
        vm.prank(agente);
        names.reclamar("traductor");
        vm.prank(otro);
        names.reclamar("revisor");
        vm.warp(block.timestamp + 365 days);

        vm.prank(agente);
        vm.expectRevert("PanalNames: already has a name");
        names.transferir(otro);
    }

    /// Soltarlo no es venderlo: no hay que esperar el año.
    function test_liberar_no_espera_al_ano() public {
        vm.prank(agente);
        names.reclamar("traductor");

        vm.prank(agente);
        names.liberar();

        assertTrue(names.disponible("traductor"));
        assertEq(names.nombreDe(agente), "");

        vm.prank(otro);
        names.reclamar("traductor");
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
            names.reclamar(malos[i]);
        }
    }

    function test_rechaza_guiones_que_enganan() public {
        vm.prank(agente);
        vm.expectRevert("PanalNames: edge hyphen");
        names.reclamar("-lint");

        vm.prank(agente);
        vm.expectRevert("PanalNames: edge hyphen");
        names.reclamar("lint-");

        vm.prank(agente);
        vm.expectRevert("PanalNames: double hyphen");
        names.reclamar("li--nt");
    }

    function test_rechaza_largos_fuera_de_rango() public {
        vm.prank(agente);
        vm.expectRevert("PanalNames: bad length");
        names.reclamar("ab");

        vm.prank(agente);
        vm.expectRevert("PanalNames: bad length");
        names.reclamar("abcdefghijklmnopqrstuvwxyz1234567"); // 33
    }

    function test_acepta_guion_interior_y_digitos() public {
        vm.prank(agente);
        names.reclamar("lex-panal2");
        assertEq(names.resolver("lex-panal2"), agente);
    }

    // ── tarifas ─────────────────────────────────────────────────────────────

    function test_el_owner_puede_bajar_hasta_cero() public {
        names.fijarTarifas(0, 0, 0);

        vm.prank(agente);
        names.reclamar("traductor");
        assertEq(token.balanceOf(tesoreria), 0, "gratis, sin tocar el token");
        assertEq(names.resolver("traductor"), agente);
    }

    function test_no_se_puede_pasar_del_tope() public {
        names.fijarTarifas(CORTO * 10, MEDIO * 10, LARGO * 10); // justo el tope, vale

        vm.expectRevert("PanalNames: over cap");
        names.fijarTarifas(CORTO * 10 + 1, MEDIO, LARGO);
    }

    function test_sin_saldo_no_hay_nombre() public {
        address pobre = makeAddr("pobre");
        registry.setActivo(pobre, true);
        vm.prank(pobre);
        token.approve(address(names), type(uint256).max);

        vm.prank(pobre);
        vm.expectRevert("balance");
        names.reclamar("traductor");
    }

    // ── utilidad ────────────────────────────────────────────────────────────

    function _vender(string memory nombre, address de, address a, uint256 precio) private {
        vm.prank(de);
        names.reclamar(nombre);
        vm.warp(block.timestamp + 365 days);
        vm.prank(de);
        names.ponerEnVenta(precio);
        vm.prank(a);
        names.comprar(nombre);
    }
}
