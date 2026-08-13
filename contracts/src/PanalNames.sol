// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title PanalNames
/// @notice Nombres unicos para los agentes de Panal. Se alquilan, no se venden.
///
/// POR QUE ESTA APARTE Y NO DENTRO DEL REGISTRY. `PanalEscrowV2` guarda el
/// registry como `immutable` y `PanalReputation.setEscrow` solo se puede llamar
/// una vez, asi que tocar el registry obliga a redesplegar el escrow y la
/// reputacion enteros. Los nombres no le hacen falta a ninguno de los dos: el
/// escrow solo consulta precio, moneda y si el agente esta activo. Por eso este
/// contrato es puramente aditivo, y sobre todo, DESECHABLE: si la politica sale
/// mal se despliega otro y se deja de leer este. Nada depende de el.
///
/// POR QUE ALQUILER Y NO VENTA. Es la unica decision que no se puede rectificar
/// despues. Vendido para siempre, el que ocupa un nombre paga una vez y lo
/// retiene gratis de por vida, y el nombre de un agente muerto queda bloqueado
/// para siempre. Con alquiler, acaparar cuesta todos los años y lo abandonado
/// vuelve solo al mercado.
interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

interface IERC20Permit {
    function permit(
        address owner,
        address spender,
        uint256 value,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;
}

interface IPanalRegistry {
    function isActiveAgent(address agent) external view returns (bool);
}

contract PanalNames {
    /// @notice Un nombre alquilado.
    struct Nombre {
        address dueno;
        /// @dev Cuando deja de ser suyo. Despues quedan GRACIA dias en los que
        ///      solo el puede renovar; pasados esos, lo coge cualquiera.
        uint64 expira;
    }

    /// @notice Tramos de precio. Los nombres cortos son los que se ocupan.
    uint256 public constant TRAMO_CORTO = 3;
    uint256 public constant TRAMO_MEDIO = 4;

    /// @notice Minimo y maximo de caracteres. Los de 1 y 2 no se reparten
    ///         todavia: son poquisimos y no hay forma de recuperarlos si el
    ///         reparto sale mal. Un PanalNames posterior podra abrirlos.
    uint256 public constant MIN_LARGO = 3;
    uint256 public constant MAX_LARGO = 32;

    /// @notice Tras caducar, el dueño conserva 90 dias para renovar sin que
    ///         nadie pueda quitarselo. Un descuido no deberia costar un nombre
    ///         que ya usan sus clientes.
    uint256 public constant GRACIA = 90 days;

    /// @notice Tope de años que se pueden pagar de golpe. Sin esto, alguien
    ///         asegura un nombre por un siglo al precio de hoy justo antes de
    ///         que el multisig lo suba.
    uint256 public constant MAX_ANIOS = 5;

    uint256 private constant ANIO = 365 days;

    IERC20 public immutable PANAL;
    IPanalRegistry public immutable REGISTRY;

    /// @notice Tope duro de cada tarifa, fijado al desplegar y jamas superable.
    ///
    /// Se pone precio en un token sin oraculo ni mercado: cualquier numero de
    /// hoy es una apuesta sobre una cotizacion futura. El multisig puede mover
    /// la tarifa —incluso a cero— pero nunca por encima de esto, asi que el
    /// error se puede corregir y no se puede convertir en un arma.
    uint256 public immutable TOPE_CORTO;
    uint256 public immutable TOPE_MEDIO;
    uint256 public immutable TOPE_LARGO;

    address public owner;
    address public tesoreria;

    uint256 public tarifaCorto;
    uint256 public tarifaMedio;
    uint256 public tarifaLargo;

    mapping(bytes32 => Nombre) private _nombres;
    /// @dev El texto original, para poder mostrarlo sin guardar el hash en la web.
    mapping(bytes32 => string) private _textos;
    /// @dev Inverso: un agente, un nombre. Sin esto la web tendria que recorrer
    ///      el contrato entero para pintar el nombre de una direccion.
    mapping(address => bytes32) private _deAgente;

    event Reclamado(bytes32 indexed hash, string nombre, address indexed dueno, uint64 expira, uint256 pagado);
    event Renovado(bytes32 indexed hash, string nombre, address indexed dueno, uint64 expira, uint256 pagado);
    event Liberado(bytes32 indexed hash, string nombre, address indexed dueno);
    event TarifasFijadas(uint256 corto, uint256 medio, uint256 largo);
    event TesoreriaFijada(address indexed tesoreria);
    event OwnershipTransferred(address indexed anterior, address indexed nuevo);

    modifier onlyOwner() {
        require(msg.sender == owner, "PanalNames: not owner");
        _;
    }

    constructor(
        address panal,
        address registry,
        address tesoreria_,
        uint256 tarifaCorto_,
        uint256 tarifaMedio_,
        uint256 tarifaLargo_
    ) {
        require(panal != address(0) && registry != address(0), "PanalNames: zero address");
        require(tesoreria_ != address(0), "PanalNames: zero treasury");

        PANAL = IERC20(panal);
        REGISTRY = IPanalRegistry(registry);
        tesoreria = tesoreria_;
        owner = msg.sender;

        tarifaCorto = tarifaCorto_;
        tarifaMedio = tarifaMedio_;
        tarifaLargo = tarifaLargo_;

        // El tope es 10x lo inicial: sitio de sobra para seguir a un token que
        // se mueve, sin que quepa un precio que expulse a todo el mundo.
        TOPE_CORTO = tarifaCorto_ * 10;
        TOPE_MEDIO = tarifaMedio_ * 10;
        TOPE_LARGO = tarifaLargo_ * 10;

        emit TarifasFijadas(tarifaCorto_, tarifaMedio_, tarifaLargo_);
        emit TesoreriaFijada(tesoreria_);
        emit OwnershipTransferred(address(0), msg.sender);
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Reclamar y renovar
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Reclama un nombre libre para `msg.sender`, por `anios` años.
    /// @dev Hay que aprobar el gasto antes, o usar `reclamarConPermiso`.
    function reclamar(string calldata nombre, uint256 anios) external {
        _reclamar(nombre, anios);
    }

    /// @notice Igual, pero firmando el permiso del token en la misma
    ///         transaccion. $PANAL soporta EIP-2612, asi que el agente no
    ///         necesita un `approve` aparte.
    function reclamarConPermiso(
        string calldata nombre,
        uint256 anios,
        uint256 valor,
        uint256 plazo,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        IERC20Permit(address(PANAL)).permit(msg.sender, address(this), valor, plazo, v, r, s);
        _reclamar(nombre, anios);
    }

    /// @notice Renueva un nombre. **Puede pagarlo cualquiera**, no solo el
    ///         dueño: perder el nombre por un descuido con la cartera vacia
    ///         seria absurdo cuando sus clientes ya lo usan.
    function renovar(string calldata nombre, uint256 anios) external {
        require(anios >= 1 && anios <= MAX_ANIOS, "PanalNames: bad years");

        bytes32 hash = _validar(nombre);
        Nombre storage n = _nombres[hash];
        require(n.dueno != address(0), "PanalNames: not claimed");
        // Pasada la gracia ya no es suyo: hay que reclamarlo, no renovarlo, o
        // el dueño anterior podria retenerlo indefinidamente sin usarlo.
        require(block.timestamp <= uint256(n.expira) + GRACIA, "PanalNames: expired");

        uint256 precio = tarifaDe(nombre) * anios;
        _cobrar(precio);

        // Desde su vencimiento, no desde hoy: si renuevas con antelacion no
        // pierdes lo que te quedaba.
        uint256 desde = block.timestamp > n.expira ? block.timestamp : n.expira;
        uint256 expira = desde + anios * ANIO;
        require(expira <= block.timestamp + MAX_ANIOS * ANIO, "PanalNames: too far");
        n.expira = uint64(expira);

        emit Renovado(hash, nombre, n.dueno, n.expira, precio);
    }

    /// @notice Suelta tu nombre. Queda libre en el acto, sin gracia: lo estas
    ///         soltando a proposito.
    function liberar() external {
        bytes32 hash = _deAgente[msg.sender];
        require(hash != bytes32(0), "PanalNames: no name");

        string memory texto = _textos[hash];
        delete _nombres[hash];
        delete _deAgente[msg.sender];

        emit Liberado(hash, texto, msg.sender);
    }

    function _reclamar(string calldata nombre, uint256 anios) private {
        require(anios >= 1 && anios <= MAX_ANIOS, "PanalNames: bad years");
        // Solo agentes registrados y activos. Es un `require` que no cuesta
        // nada y convierte "acaparo cien nombres" en "monto cien agentes".
        require(REGISTRY.isActiveAgent(msg.sender), "PanalNames: not an active agent");

        // Si el nombre que tenia ya se le paso de largo —caducado Y fuera de
        // gracia— se suelta solo. Sin esto queda atrapado: no puede pedir otro
        // porque "ya tiene uno", ni recuperar el suyo por lo mismo, y la salida
        // seria llamar a `liberar()` antes, que no lo adivina nadie. En gracia
        // no se suelta: ahi todavia es suyo y lo que toca es renovar.
        bytes32 mio = _deAgente[msg.sender];
        if (mio != bytes32(0) && block.timestamp > uint256(_nombres[mio].expira) + GRACIA) {
            delete _nombres[mio];
            delete _deAgente[msg.sender];
            mio = bytes32(0);
        }
        require(mio == bytes32(0), "PanalNames: already has a name");

        bytes32 hash = _validar(nombre);
        Nombre storage n = _nombres[hash];
        if (n.dueno != address(0)) {
            require(block.timestamp > uint256(n.expira) + GRACIA, "PanalNames: taken");
            // El anterior dueño lo pierde aqui. Sin esto se quedaria con el
            // inverso apuntando a un nombre que ya es de otro.
            delete _deAgente[n.dueno];
        }

        uint256 precio = tarifaDe(nombre) * anios;
        _cobrar(precio);

        uint64 expira = uint64(block.timestamp + anios * ANIO);
        _nombres[hash] = Nombre({dueno: msg.sender, expira: expira});
        _textos[hash] = nombre;
        _deAgente[msg.sender] = hash;

        emit Reclamado(hash, nombre, msg.sender, expira, precio);
    }

    function _cobrar(uint256 precio) private {
        if (precio == 0) return; // el multisig puede dejarlo gratis
        require(PANAL.transferFrom(msg.sender, tesoreria, precio), "PanalNames: payment failed");
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Validacion del nombre
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Comprueba el nombre y devuelve su hash.
    ///
    /// Solo se aceptan `a-z`, `0-9` y `-`. Esto es lo que mata los homoglifos:
    /// la `і` cirilica o la `l` griega no es que colisionen con las latinas, es
    /// que no se pueden ni escribir. Normalizar Unicode en Solidity no es
    /// viable; rechazar todo lo que no sea ASCII minuscula, si.
    ///
    /// El guion no puede abrir ni cerrar, ni ir doble: `-lint`, `lint-` y
    /// `li--nt` se leen como `lint` de un vistazo, que es justo el engaño que
    /// se intenta evitar.
    function _validar(string calldata nombre) private pure returns (bytes32) {
        bytes memory b = bytes(nombre);
        uint256 largo = b.length;
        require(largo >= MIN_LARGO && largo <= MAX_LARGO, "PanalNames: bad length");
        require(b[0] != "-" && b[largo - 1] != "-", "PanalNames: edge hyphen");

        for (uint256 i = 0; i < largo; i++) {
            bytes1 c = b[i];
            bool ok = (c >= 0x61 && c <= 0x7a) // a-z
                || (c >= 0x30 && c <= 0x39) // 0-9
                || c == 0x2d; // -
            require(ok, "PanalNames: bad char");
            if (c == 0x2d) require(b[i - 1] != "-", "PanalNames: double hyphen");
        }

        return keccak256(b);
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Consultas
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Lo que cuesta un año de ese nombre, segun su longitud.
    function tarifaDe(string calldata nombre) public view returns (uint256) {
        uint256 largo = bytes(nombre).length;
        if (largo == TRAMO_CORTO) return tarifaCorto;
        if (largo == TRAMO_MEDIO) return tarifaMedio;
        return tarifaLargo;
    }

    /// @notice Quien es hoy el dueño efectivo. Cero si esta libre o caducado.
    ///
    /// Un nombre caducado NO resuelve, aunque siga en gracia: si dejo de pagar,
    /// sus clientes no deben seguir mandandole encargos como si nada.
    function resolver(string calldata nombre) external view returns (address) {
        Nombre memory n = _nombres[keccak256(bytes(nombre))];
        if (n.dueno == address(0) || block.timestamp > n.expira) return address(0);
        return n.dueno;
    }

    /// @notice El nombre de un agente, o cadena vacia.
    function nombreDe(address agente) external view returns (string memory) {
        bytes32 hash = _deAgente[agente];
        if (hash == bytes32(0)) return "";
        if (block.timestamp > _nombres[hash].expira) return "";
        return _textos[hash];
    }

    /// @notice Ficha completa, para el indexador.
    function fichaDe(string calldata nombre)
        external
        view
        returns (address dueno, uint64 expira, bool vigente, bool enGracia)
    {
        Nombre memory n = _nombres[keccak256(bytes(nombre))];
        dueno = n.dueno;
        expira = n.expira;
        vigente = n.dueno != address(0) && block.timestamp <= n.expira;
        enGracia = n.dueno != address(0) && block.timestamp > n.expira
            && block.timestamp <= uint256(n.expira) + GRACIA;
    }

    /// @notice Si se puede reclamar ahora mismo.
    function disponible(string calldata nombre) external view returns (bool) {
        Nombre memory n = _nombres[keccak256(bytes(nombre))];
        if (n.dueno == address(0)) return true;
        return block.timestamp > uint256(n.expira) + GRACIA;
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Administracion (el multisig)
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Mueve las tarifas. Hacia abajo, libremente; hacia arriba, nunca
    ///         por encima del tope grabado al desplegar.
    function fijarTarifas(uint256 corto, uint256 medio, uint256 largo) external onlyOwner {
        require(corto <= TOPE_CORTO && medio <= TOPE_MEDIO && largo <= TOPE_LARGO, "PanalNames: over cap");
        tarifaCorto = corto;
        tarifaMedio = medio;
        tarifaLargo = largo;
        emit TarifasFijadas(corto, medio, largo);
    }

    function fijarTesoreria(address nueva) external onlyOwner {
        require(nueva != address(0), "PanalNames: zero address");
        tesoreria = nueva;
        emit TesoreriaFijada(nueva);
    }

    function transferOwnership(address nuevo) external onlyOwner {
        require(nuevo != address(0), "PanalNames: zero address");
        emit OwnershipTransferred(owner, nuevo);
        owner = nuevo;
    }
}
