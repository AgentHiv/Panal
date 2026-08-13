// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/PanalNames.sol";

/// @notice Despliega PanalNames: los nombres unicos de los agentes.
///
/// NO TOCA NADA DE LO QUE YA FUNCIONA. No hay que redesplegar el escrow, ni el
/// registry, ni la reputacion, y no se pierde historial: este contrato es
/// puramente aditivo. El escrow solo consulta precio, moneda y si el agente
/// esta activo; los nombres no le hacen falta. Si la politica sale mal se
/// despliega otro y se deja de leer este.
///
/// EL DUENO ES EL MULTISIG, y desde el primer bloque. Se pasa al constructor en
/// vez de desplegar y transferir despues: eso dejaria una ventana en la que
/// manda una sola clave, y un `transferOwnership` equivocado no tiene vuelta
/// atras. El multisig es 2 de 3, asi que mover una tarifa exigira dos firmas.
///
/// Env requeridas:
///   PRIVATE_KEY  - key del que despliega. NO queda como dueño de nada.
/// Env opcionales (los defaults son los de Monad mainnet, ya verificados):
///   PANAL_TOKEN  - default 0x2e2e...7777 ($PANAL)
///   REGISTRY     - default 0x89a8...Ac51 (PanalRegistryV2)
///   OWNER        - default 0xc384...1Fe0 (PanalMultisig, el `arbitrator` del escrow)
///   TREASURY     - default = OWNER
///   CAP_SHORT / CAP_MEDIUM / CAP_LONG - techo inmutable de cada tarifa
///   FEE_SHORT / FEE_MEDIUM / FEE_LONG - lo que se cobra al arrancar (default 0)
///   FEE_BPS      - comision de reventa en puntos basicos (default 50 = 0,5%)
///
/// DESPUES DE DESPLEGAR:
///
///   1. Exportar la direccion como PANAL_NAMES_ADDRESS en el .env del
///      indexador y reiniciarlo. Sin eso el indexador ni lo mira, que es el
///      comportamiento correcto mientras no exista.
///   2. Estrenar el multisig con algo inofensivo ANTES de depender de el. Su
///      txCount() esta en 0: nunca se ha ejecutado nada por el. Una buena
///      primera prueba es `fijarTarifas` con los mismos valores que ya tiene.
contract DeployNames is Script {
    address constant PANAL_TOKEN_DEFAULT = 0x2E2e44E7FA6178822D4397299F719e89d1a67777;
    address constant REGISTRY_DEFAULT = 0x89a812BFb1c35fc814ef25a3E6Ca75068B16Ac51;
    /// El multisig 2-de-3. Es el `arbitrator` de PanalEscrowV2; se comprobo
    /// llamandole a txCount() y leyendo sus tres owners.
    address constant MULTISIG_DEFAULT = 0xc384C1F5D6716571DA84329BeAaE6F064C6b1Fe0;

    /// Techo inmutable de cada tarifa. Es diez veces lo que se penso cobrar
    /// (5 / 3 / 1 $PANAL), que deja margen si el token se mueve y sigue lejos
    /// de un precio que expulse a nadie.
    uint256 constant CAP_SHORT_DEFAULT = 50e18; // 3 caracteres
    uint256 constant CAP_MEDIUM_DEFAULT = 30e18; // 4 caracteres
    uint256 constant CAP_LONG_DEFAULT = 10e18; // 5 o mas

    /// LO QUE SE COBRA AL ARRANCAR: NADA.
    ///
    /// Un agente recien creado tiene MON para gas y cero $PANAL —hoy, de los
    /// cuatro registrados, solo uno tiene saldo, y porque cobra en token—. Con
    /// tarifa desde el primer dia, el registro automatico del nombre fallaria
    /// para casi todos y los nombres se los quedaria quien ya tuviera tokens.
    ///
    /// Se sube con `fijarTarifas` cuando el $PANAL circule, con dos firmas del
    /// multisig y sin pasar del techo de arriba.
    uint256 constant FEE_SHORT_DEFAULT = 0;
    uint256 constant FEE_MEDIUM_DEFAULT = 0;
    uint256 constant FEE_LONG_DEFAULT = 0;

    uint256 constant FEE_BPS_DEFAULT = 50; // 0,5% de cada reventa

    /// @notice Si una direccion es de verdad un contrato.
    ///
    /// NO vale con `code.length > 0`. Desde EIP-7702, una cuenta normal puede
    /// delegar su comportamiento en una implementacion y entonces TIENE codigo:
    /// exactamente 23 bytes que empiezan por 0xef0100 y siguen con la direccion
    /// delegada. Tiene codigo y no es un contrato — por debajo sigue firmando
    /// una sola clave.
    ///
    /// Esto no es teorico aqui: la cartera del deployer y dos de los tres
    /// firmantes del multisig son smart wallets 7702, con la misma
    /// implementacion. Con la comprobacion ingenua, pasar cualquiera de ellas
    /// como OWNER colaba, y el contrato acababa mandado por una sola clave
    /// habiendo elegido el 2-de-3.
    function _esContrato(address a) private view returns (bool) {
        bytes memory codigo = a.code;
        if (codigo.length == 0) return false;
        if (codigo.length == 23 && codigo[0] == 0xef && codigo[1] == 0x01 && codigo[2] == 0x00) return false;
        return true;
    }

    /**
     * Los nombres que nadie puede reclamar.
     *
     * La marca, y las tres palabras con las que se suplanta a un proyecto
     * —soporte, oficial, ayuda— en los diez idiomas en los que se publica
     * Panal. Un agente llamado `soporte` que pida la clave privada a un
     * cliente es el fraude mas barato que existe aqui, y una vez reclamado el
     * nombre no hay forma de recuperarlo.
     *
     * EN SEIS DE LOS DIEZ IDIOMAS NO HAY PALABRA QUE RESERVAR. El contrato
     * solo acepta `a-z0-9-`, asi que 支持, поддержка o دعم no se pueden
     * escribir como nombre y nadie puede reclamarlas. Lo que si es reclamable
     * es su transliteracion, y es lo que va aqui: `zhichi`, `podderzhka`,
     * `daam`.
     *
     * Reservar de mas tiene un coste real: un agente legitimo que se llame asi
     * se queda sin su nombre. Por eso la lista es corta y no incluye variantes
     * dudosas.
     */
    function _reservados() private pure returns (string[] memory) {
        string[] memory r = new string[](27);
        uint256 i;

        // La marca.
        r[i++] = "panal";
        r[i++] = "panal-lat";

        // soporte
        r[i++] = "soporte"; // es, pt (suporte aparte)
        r[i++] = "suporte"; // pt
        r[i++] = "support"; // en, fr
        r[i++] = "podderzhka"; // ru, поддержка
        r[i++] = "sahayata"; // hi/bn, सहायता / সহায়তা
        r[i++] = "daam"; // ar, دعم
        r[i++] = "zhichi"; // zh, 支持
        r[i++] = "madad"; // ur/hi, مدد / मदद (vale tambien por "ayuda")

        // oficial
        r[i++] = "oficial"; // es, pt
        r[i++] = "official"; // en
        r[i++] = "officiel"; // fr
        r[i++] = "ofitsialnyy"; // ru, официальный
        r[i++] = "adhikarik"; // hi, आधिकारिक
        r[i++] = "rasmi"; // ar, رسمي
        r[i++] = "ofisiyal"; // bn, অফিসিয়াল
        r[i++] = "guanfang"; // zh, 官方
        r[i++] = "sarkari"; // ur, سرکاری

        // ayuda
        r[i++] = "ayuda"; // es
        r[i++] = "ajuda"; // pt
        r[i++] = "help"; // en
        r[i++] = "aide"; // fr
        r[i++] = "pomoshch"; // ru, помощь
        r[i++] = "musaada"; // ar, مساعدة
        r[i++] = "sahajjo"; // bn, সাহায্য
        r[i++] = "bangzhu"; // zh, 帮助

        require(i == r.length, "lista de reservados descuadrada");
        return r;
    }

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address token = vm.envOr("PANAL_TOKEN", PANAL_TOKEN_DEFAULT);
        address registry = vm.envOr("REGISTRY", REGISTRY_DEFAULT);
        address owner = vm.envOr("OWNER", MULTISIG_DEFAULT);
        address treasury = vm.envOr("TREASURY", owner);

        uint256[3] memory topes = [
            vm.envOr("CAP_SHORT", CAP_SHORT_DEFAULT),
            vm.envOr("CAP_MEDIUM", CAP_MEDIUM_DEFAULT),
            vm.envOr("CAP_LONG", CAP_LONG_DEFAULT)
        ];
        uint256[3] memory tarifas = [
            vm.envOr("FEE_SHORT", FEE_SHORT_DEFAULT),
            vm.envOr("FEE_MEDIUM", FEE_MEDIUM_DEFAULT),
            vm.envOr("FEE_LONG", FEE_LONG_DEFAULT)
        ];
        uint256 bps = vm.envOr("FEE_BPS", FEE_BPS_DEFAULT);

        // Que el registry sea un contrato se comprueba AQUI y no despues: con
        // una direccion mal puesta, `reclamar` revertiria para todo el mundo y
        // el contrato quedaria inservible sin forma de arreglarlo.
        require(_esContrato(registry), "REGISTRY no es un contrato");
        require(_esContrato(token), "PANAL_TOKEN no es un contrato");
        // El dueño va a tener que firmar dos veces: si no es un contrato, no es
        // el multisig, y el 2-de-3 que se decidio no existiria.
        require(_esContrato(owner), "OWNER no es un contrato: revisa que sea el multisig");

        vm.startBroadcast(pk);
        PanalNames names = new PanalNames(
            PanalNames.Config({
                panal: token,
                registry: registry,
                owner: owner,
                tesoreria: treasury,
                topes: topes,
                tarifas: tarifas,
                comisionBps: bps
            }),
            _reservados()
        );
        vm.stopBroadcast();

        console2.log("PanalNames    ", address(names));
        console2.log("  owner       ", names.owner());
        console2.log("  tesoreria   ", names.tesoreria());
        console2.log("  tarifa hoy  ", names.tarifaLargo(), "(0 = nombres gratis al arrancar)");
        console2.log("  techo 3     ", names.TOPE_CORTO());
        console2.log("  techo 4     ", names.TOPE_MEDIO());
        console2.log("  techo 5+    ", names.TOPE_LARGO());
        console2.log("  comision bps", names.comisionBps());
        console2.log("");
        console2.log("Ahora: PANAL_NAMES_ADDRESS=<direccion> en el .env del indexador y reiniciarlo.");
    }
}
