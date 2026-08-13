// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title PanalNames
/// @notice Nombres unicos para los agentes de Panal. Se compran una vez y son
///         tuyos; se pueden revender pasado un año.
///
/// POR QUE ESTA APARTE Y NO DENTRO DEL REGISTRY. `PanalEscrowV2` guarda el
/// registry como `immutable` y `PanalReputation.setEscrow` solo se puede llamar
/// una vez, asi que tocar el registry obliga a redesplegar el escrow y la
/// reputacion enteros. Los nombres no le hacen falta a ninguno de los dos: el
/// escrow solo consulta precio, moneda y si el agente esta activo. Por eso este
/// contrato es puramente aditivo, y sobre todo, DESECHABLE: si la politica sale
/// mal se despliega otro y se deja de leer este. Nada depende de el.
///
/// LO QUE ESTE MODELO NO RESUELVE, DICHO AQUI PARA QUE NO SORPRENDA:
///
///   - Comprado para siempre y barato, acaparar sale casi gratis: cien nombres
///     son cien tarifas y cien direcciones registradas. Lo unico que lo frena
///     es que solo reclaman agentes activos y que cada direccion tiene uno.
///   - El nombre de un agente que desaparece no vuelve nunca al mercado. Con
///     alquiler se liberaba solo; aqui no hay forma de recuperarlo.
///   - La comision del 0,5% solo se cobra en las ventas que pasan por aqui. Dos
///     que se pongan de acuerdo por fuera pueden usar `transferir` y no pagarla.
///     Es el mismo agujero que tienen las regalias de cualquier NFT.
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
    /// @notice Un nombre y su dueño.
    struct Nombre {
        address dueno;
        /// @dev Cuando paso a ser suyo. El candado del año cuenta desde aqui, y
        ///      se reinicia en cada cambio de manos.
        uint64 desde;
        /// @dev Lo que pide por el. Cero = no esta en venta.
        uint256 precio;
    }

    /// @notice Tramos de precio. Los nombres cortos son los que se ocupan.
    uint256 public constant TRAMO_CORTO = 3;
    uint256 public constant TRAMO_MEDIO = 4;

    /// @notice Minimo y maximo de caracteres. Los de 1 y 2 no se reparten
    ///         todavia: son poquisimos y, siendo para siempre, un reparto malo
    ///         no tiene vuelta atras. Un PanalNames posterior podra abrirlos.
    uint256 public constant MIN_LARGO = 3;
    uint256 public constant MAX_LARGO = 32;

    /// @notice Hay que tener el nombre un año antes de poder venderlo o
    ///         regalarlo, y la cuenta se reinicia con cada dueño. Es lo que
    ///         separa a un agente que quiere su nombre de alguien que compra
    ///         barato para revender caro la semana siguiente.
    uint256 public constant CANDADO = 365 days;

    /// @notice Tope duro de la comision, grabado al desplegar. El owner puede
    ///         moverla por debajo, nunca por encima: sin esto, quien mande en
    ///         el contrato podria poner el 100% y quedarse con cada venta.
    uint256 public constant TOPE_COMISION_BPS = 200; // 2%

    IERC20 public immutable PANAL;
    IPanalRegistry public immutable REGISTRY;

    /// @notice Tope duro de cada tarifa, fijado al desplegar y jamas superable.
    ///
    /// Se pone precio en un token sin oraculo ni mercado: cualquier numero de
    /// hoy es una apuesta sobre una cotizacion futura. El owner puede mover la
    /// tarifa —incluso a cero— pero nunca por encima de esto, asi que el error
    /// se puede corregir y no se puede convertir en un arma.
    uint256 public immutable TOPE_CORTO;
    uint256 public immutable TOPE_MEDIO;
    uint256 public immutable TOPE_LARGO;

    address public owner;
    /// @notice Dueño propuesto y pendiente de aceptar. Ver `transferOwnership`.
    address public propuesto;
    address public tesoreria;

    uint256 public tarifaCorto;
    uint256 public tarifaMedio;
    uint256 public tarifaLargo;

    /// @notice Lo que se lleva la tesoreria de cada venta, en puntos basicos.
    uint256 public comisionBps;

    mapping(bytes32 => Nombre) private _nombres;
    /// @dev El texto original, para poder mostrarlo sin guardar el hash en la web.
    mapping(bytes32 => string) private _textos;
    /// @dev Inverso: un agente, un nombre. Sin esto la web tendria que recorrer
    ///      el contrato entero para pintar el nombre de una direccion.
    mapping(address => bytes32) private _deAgente;

    event Reclamado(bytes32 indexed hash, string nombre, address indexed dueno, uint256 pagado);
    event EnVenta(bytes32 indexed hash, string nombre, address indexed dueno, uint256 precio);
    event RetiradoDeVenta(bytes32 indexed hash, string nombre, address indexed dueno);
    event Vendido(
        bytes32 indexed hash,
        string nombre,
        address indexed de,
        address indexed a,
        uint256 precio,
        uint256 comision
    );
    event Transferido(bytes32 indexed hash, string nombre, address indexed de, address indexed a);
    event Liberado(bytes32 indexed hash, string nombre, address indexed dueno);
    event TarifasFijadas(uint256 corto, uint256 medio, uint256 largo);
    event ComisionFijada(uint256 bps);
    event TesoreriaFijada(address indexed tesoreria);
    event OwnershipProposed(address indexed actual, address indexed propuesto);
    event OwnershipTransferred(address indexed anterior, address indexed nuevo);

    modifier onlyOwner() {
        require(msg.sender == owner, "PanalNames: not owner");
        _;
    }

    /// @param owner_ Quien podra mover tarifas y comision. Se pasa en vez de
    ///        usar `msg.sender` para que sea el multisig DESDE EL PRIMER
    ///        BLOQUE: desplegar y transferir despues deja una ventana en la que
    ///        una sola clave manda, y un `transferOwnership` a una direccion
    ///        equivocada no tiene vuelta atras.
    constructor(
        address panal,
        address registry,
        address owner_,
        address tesoreria_,
        uint256 tarifaCorto_,
        uint256 tarifaMedio_,
        uint256 tarifaLargo_,
        uint256 comisionBps_
    ) {
        require(panal != address(0) && registry != address(0), "PanalNames: zero address");
        require(owner_ != address(0), "PanalNames: zero owner");
        require(tesoreria_ != address(0), "PanalNames: zero treasury");
        require(comisionBps_ <= TOPE_COMISION_BPS, "PanalNames: over cap");

        PANAL = IERC20(panal);
        REGISTRY = IPanalRegistry(registry);
        tesoreria = tesoreria_;
        owner = owner_;

        tarifaCorto = tarifaCorto_;
        tarifaMedio = tarifaMedio_;
        tarifaLargo = tarifaLargo_;
        comisionBps = comisionBps_;

        // El tope es 10x lo inicial: sitio de sobra para seguir a un token que
        // se mueve, sin que quepa un precio que expulse a todo el mundo.
        TOPE_CORTO = tarifaCorto_ * 10;
        TOPE_MEDIO = tarifaMedio_ * 10;
        TOPE_LARGO = tarifaLargo_ * 10;

        emit TarifasFijadas(tarifaCorto_, tarifaMedio_, tarifaLargo_);
        emit ComisionFijada(comisionBps_);
        emit TesoreriaFijada(tesoreria_);
        emit OwnershipTransferred(address(0), owner_);
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Reclamar
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Reclama un nombre libre. Se paga una vez y es tuyo.
    /// @dev Hay que aprobar el gasto antes, o usar `reclamarConPermiso`.
    function reclamar(string calldata nombre) external {
        _reclamar(nombre);
    }

    /// @notice Igual, pero firmando el permiso del token en la misma
    ///         transaccion. $PANAL soporta EIP-2612, asi que el agente no
    ///         necesita un `approve` aparte.
    function reclamarConPermiso(
        string calldata nombre,
        uint256 valor,
        uint256 plazo,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        IERC20Permit(address(PANAL)).permit(msg.sender, address(this), valor, plazo, v, r, s);
        _reclamar(nombre);
    }

    function _reclamar(string calldata nombre) private {
        // Solo agentes registrados y activos. Es un `require` que no cuesta
        // nada y convierte "acaparo cien nombres" en "monto cien agentes".
        require(REGISTRY.isActiveAgent(msg.sender), "PanalNames: not an active agent");
        require(_deAgente[msg.sender] == bytes32(0), "PanalNames: already has a name");

        bytes32 hash = _validar(nombre);
        require(_nombres[hash].dueno == address(0), "PanalNames: taken");

        uint256 precio = tarifaDe(nombre);

        _nombres[hash] = Nombre({dueno: msg.sender, desde: uint64(block.timestamp), precio: 0});
        _textos[hash] = nombre;
        _deAgente[msg.sender] = hash;

        if (precio > 0) {
            require(PANAL.transferFrom(msg.sender, tesoreria, precio), "PanalNames: payment failed");
        }

        emit Reclamado(hash, nombre, msg.sender, precio);
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Mercado
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Pon tu nombre a la venta. Solo pasado el año.
    function ponerEnVenta(uint256 precio) external {
        require(precio > 0, "PanalNames: zero price");
        bytes32 hash = _mio();
        require(_pasoElCandado(hash), "PanalNames: locked");

        _nombres[hash].precio = precio;
        emit EnVenta(hash, _textos[hash], msg.sender, precio);
    }

    function quitarDeVenta() external {
        bytes32 hash = _mio();
        require(_nombres[hash].precio > 0, "PanalNames: not for sale");

        _nombres[hash].precio = 0;
        emit RetiradoDeVenta(hash, _textos[hash], msg.sender);
    }

    /// @notice Compra un nombre que esta a la venta. Del precio, un 0,5% va a la
    ///         tesoreria y el resto al vendedor.
    ///
    /// El comprador tiene que ser tambien un agente activo sin nombre: estos
    /// nombres son para trabajar, no un activo que coleccionar.
    function comprar(string calldata nombre) external {
        bytes32 hash = keccak256(bytes(nombre));
        Nombre storage n = _nombres[hash];

        address vendedor = n.dueno;
        uint256 precio = n.precio;
        require(vendedor != address(0), "PanalNames: not claimed");
        require(precio > 0, "PanalNames: not for sale");
        require(msg.sender != vendedor, "PanalNames: already yours");
        require(REGISTRY.isActiveAgent(msg.sender), "PanalNames: not an active agent");
        require(_deAgente[msg.sender] == bytes32(0), "PanalNames: already has a name");

        uint256 comision = (precio * comisionBps) / 10_000;

        // Primero el estado y luego los cobros: si el token hiciera algo raro al
        // transferir, que no se encuentre el nombre a medio vender.
        n.dueno = msg.sender;
        n.desde = uint64(block.timestamp); // el candado vuelve a empezar
        n.precio = 0;
        delete _deAgente[vendedor];
        _deAgente[msg.sender] = hash;

        if (comision > 0) {
            require(PANAL.transferFrom(msg.sender, tesoreria, comision), "PanalNames: fee failed");
        }
        require(PANAL.transferFrom(msg.sender, vendedor, precio - comision), "PanalNames: payment failed");

        emit Vendido(hash, nombre, vendedor, msg.sender, precio, comision);
    }

    /// @notice Pasa tu nombre a otro agente sin cobrarle. Tambien espera al año.
    ///
    /// Aqui no hay comision porque no hay precio que gravar. Quien quiera
    /// esquivar el 0,5% puede pagar por fuera y usar esto; es el mismo agujero
    /// que tienen las regalias de cualquier NFT y no se puede cerrar desde el
    /// contrato.
    function transferir(address a) external {
        require(a != address(0) && a != msg.sender, "PanalNames: bad recipient");
        bytes32 hash = _mio();
        require(_pasoElCandado(hash), "PanalNames: locked");
        require(REGISTRY.isActiveAgent(a), "PanalNames: not an active agent");
        require(_deAgente[a] == bytes32(0), "PanalNames: already has a name");

        Nombre storage n = _nombres[hash];
        n.dueno = a;
        n.desde = uint64(block.timestamp);
        n.precio = 0;
        delete _deAgente[msg.sender];
        _deAgente[a] = hash;

        emit Transferido(hash, _textos[hash], msg.sender, a);
    }

    /// @notice Suelta tu nombre. Queda libre para quien lo quiera.
    ///
    /// Sin candado: soltarlo no es venderlo, y nadie especula regalando.
    function liberar() external {
        bytes32 hash = _mio();
        string memory texto = _textos[hash];

        delete _nombres[hash];
        delete _deAgente[msg.sender];

        emit Liberado(hash, texto, msg.sender);
    }

    function _mio() private view returns (bytes32) {
        bytes32 hash = _deAgente[msg.sender];
        require(hash != bytes32(0), "PanalNames: no name");
        return hash;
    }

    function _pasoElCandado(bytes32 hash) private view returns (bool) {
        return block.timestamp >= uint256(_nombres[hash].desde) + CANDADO;
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Validacion del nombre
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Comprueba el nombre y devuelve su hash.
    ///
    /// Solo se aceptan `a-z`, `0-9` y `-`. Esto es lo que mata los homoglifos:
    /// la `a` cirilica o la `o` griega no es que colisionen con las latinas, es
    /// que no se pueden ni escribir. Normalizar Unicode en Solidity no es
    /// viable; rechazar todo lo que no sea ASCII minuscula, si.
    ///
    /// El guion no puede abrir ni cerrar, ni ir doble: `-lint`, `lint-` y
    /// `li--nt` se leen como `lint` de un vistazo, que es justo el engaño que se
    /// intenta evitar.
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

    /// @notice Lo que cuesta reclamar ese nombre, segun su longitud.
    function tarifaDe(string calldata nombre) public view returns (uint256) {
        uint256 largo = bytes(nombre).length;
        if (largo == TRAMO_CORTO) return tarifaCorto;
        if (largo == TRAMO_MEDIO) return tarifaMedio;
        return tarifaLargo;
    }

    /// @notice De quien es un nombre. Cero si esta libre.
    function resolver(string calldata nombre) external view returns (address) {
        return _nombres[keccak256(bytes(nombre))].dueno;
    }

    /// @notice El nombre de un agente, o cadena vacia.
    function nombreDe(address agente) external view returns (string memory) {
        bytes32 hash = _deAgente[agente];
        if (hash == bytes32(0)) return "";
        return _textos[hash];
    }

    /// @notice Ficha completa, para el indexador y la web.
    function fichaDe(string calldata nombre)
        external
        view
        returns (address dueno, uint64 desde, uint256 precio, bool transferible)
    {
        bytes32 hash = keccak256(bytes(nombre));
        Nombre memory n = _nombres[hash];
        dueno = n.dueno;
        desde = n.desde;
        precio = n.precio;
        transferible = n.dueno != address(0) && block.timestamp >= uint256(n.desde) + CANDADO;
    }

    /// @notice Si se puede reclamar ahora mismo.
    function disponible(string calldata nombre) external view returns (bool) {
        return _nombres[keccak256(bytes(nombre))].dueno == address(0);
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

    function fijarComision(uint256 bps) external onlyOwner {
        require(bps <= TOPE_COMISION_BPS, "PanalNames: over cap");
        comisionBps = bps;
        emit ComisionFijada(bps);
    }

    function fijarTesoreria(address nueva) external onlyOwner {
        require(nueva != address(0), "PanalNames: zero address");
        tesoreria = nueva;
        emit TesoreriaFijada(nueva);
    }

    /// @notice Propone un dueño nuevo. NO manda hasta que el propuesto acepte.
    ///
    /// En dos pasos a proposito. Este contrato va a cambiar de manos: el
    /// multisig de hoy tiene sus tres firmantes grabados en el constructor, asi
    /// que añadir arbitros obliga a desplegar otro y a mover la propiedad aqui.
    /// Con un solo paso, mandarla a un multisig mal configurado —firmantes que
    /// no coinciden, o que nunca llegan a las dos confirmaciones— dejaria las
    /// tarifas y la comision congeladas para siempre, sin nadie que pueda
    /// tocarlas. Obligar a que el nuevo ACEPTE es la prueba de que puede
    /// transaccionar, y se hace antes de que sea tarde.
    ///
    /// Propuesta a cero = cancelar una propuesta pendiente.
    function transferOwnership(address nuevo) external onlyOwner {
        propuesto = nuevo;
        emit OwnershipProposed(owner, nuevo);
    }

    /// @notice El propuesto toma la propiedad. Solo el.
    function aceptarPropiedad() external {
        require(msg.sender == propuesto, "PanalNames: not proposed");
        emit OwnershipTransferred(owner, propuesto);
        owner = propuesto;
        propuesto = address(0);
    }
}
