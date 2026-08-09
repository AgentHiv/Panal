// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title PanalPayments — liquidación de micropagos por llamada (x402)
/// @notice Cobra pagos de $PANAL por llamada HTTP, reparte la comisión del
///         protocolo y deja rastro on-chain de cada uso.
///
///         El escrow (PanalEscrowV2) cubre encargos discretos: importes altos,
///         entrega, disputa, auto-release de 72 h. Este contrato cubre lo
///         contrario: pagos diminutos y constantes, servidos al instante, sin
///         estado y sin custodia.
///
/// FLUJO (dos pasos, y el motivo importa)
///
///   1. UNA VEZ por pagador: autoriza a este contrato a mover su $PANAL, con
///      `approve` o con `permit` (EIP-2612, sin gas). Es un presupuesto: el
///      pagador decide cuánto expone y puede revocarlo cuando quiera.
///
///   2. POR CADA LLAMADA: el pagador firma un `PayCall` EIP-712 con cobrador,
///      importe, nonce y caducidad. El agente lo presenta aquí y cobra.
///
///      El paso 2 NO puede sustituirse por el `permit` a secas. Un permit
///      autoriza un *gasto* a este contrato, pero no dice A QUIÉN se paga: quien
///      viera esa firma en el mempool podría llamar poniéndose de cobrador y
///      quedarse el dinero. La firma `PayCall` ata pagador, cobrador, importe y
///      nonce en un mismo digest, así que no sirve para nada distinto de lo
///      que el pagador autorizó.
///
/// NONCES NO SECUENCIALES (a propósito)
///      El nonce de EIP-2612 es secuencial: dos llamadas en paralelo del mismo
///      pagador firman el mismo número y una revierte —justo el caso de uso de
///      un micropago—. Aquí el nonce es un uint256 cualquiera que el pagador
///      elige y que solo se puede gastar una vez, así que las llamadas
///      concurrentes no se estorban.
///
/// SIN CUSTODIA
///      El contrato nunca retiene fondos: mueve el neto al cobrador y la
///      comisión al treasury en la misma transacción. No hay saldos, no hay
///      `withdraw`, y no hay nada que rescatar si algo va mal.
///
/// SOLO $PANAL
///      El token se fija en el constructor y es inmutable. No es una limitación
///      accidental: el micropago sin gas depende de EIP-2612, y MON nativo
///      obligaría al pagador a mandar la transacción, que es justo lo que este
///      diseño elimina.
contract PanalPayments {
    // -----------------------------------------------------------------------
    // Constantes y estado
    // -----------------------------------------------------------------------

    /// @notice Tope duro de la comisión: 2,5 %, igual que el escrow.
    ///         El owner puede bajarla pero NUNCA subirla por encima de esto,
    ///         así que un owner comprometido no puede vaciar los pagos.
    uint256 public constant MAX_FEE_BPS = 250;

    /// @notice Token de pago (inmutable).
    address public immutable PANAL_TOKEN;

    /// @notice Destinatario de la comisión del protocolo.
    address public treasury;
    /// @notice Comisión actual en puntos básicos (<= MAX_FEE_BPS).
    uint256 public feeBps;
    /// @notice Puede ajustar treasury y comisión.
    address public owner;

    /// @notice nonces ya gastados por pagador. Impide reutilizar una firma.
    mapping(address => mapping(uint256 => bool)) public nonceUsed;

    // -----------------------------------------------------------------------
    // EIP-712
    // -----------------------------------------------------------------------

    bytes32 private constant _EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant _NAME_HASH = keccak256("PanalPayments");
    bytes32 private constant _VERSION_HASH = keccak256("1");

    /// @notice Tipo de la firma por llamada.
    bytes32 public constant PAY_CALL_TYPEHASH = keccak256(
        "PayCall(address payer,address payee,uint256 value,uint256 nonce,uint256 deadline,bytes32 resource)"
    );

    /// Cacheados para no recalcularlos en cada pago; si la cadena se bifurca y
    /// cambia el chainid, se recalcula (defensa estándar anti-replay entre forks).
    uint256 private immutable _CACHED_CHAIN_ID;
    bytes32 private immutable _CACHED_DOMAIN_SEPARATOR;

    // -----------------------------------------------------------------------
    // Eventos
    // -----------------------------------------------------------------------

    /// @notice Un pago por llamada liquidado. `resource` identifica qué se pagó
    ///         (p. ej. keccak256 de método+ruta), para que el indexador pueda
    ///         medir uso por agente y por endpoint.
    event CallPaid(
        address indexed payer,
        address indexed payee,
        uint256 value,
        uint256 fee,
        bytes32 indexed resource,
        uint256 nonce
    );
    event TreasuryUpdated(address indexed previous, address indexed current);
    event FeeUpdated(uint256 previousBps, uint256 currentBps);
    event OwnershipTransferred(address indexed previous, address indexed current);

    // -----------------------------------------------------------------------
    // Constructor
    // -----------------------------------------------------------------------

    constructor(address panalToken, address treasury_, uint256 feeBps_) {
        require(panalToken != address(0), "PanalPayments: token cero");
        require(panalToken.code.length > 0, "PanalPayments: token sin codigo");
        require(treasury_ != address(0), "PanalPayments: treasury cero");
        require(feeBps_ <= MAX_FEE_BPS, "PanalPayments: fee por encima del tope");

        PANAL_TOKEN = panalToken;
        treasury = treasury_;
        feeBps = feeBps_;
        owner = msg.sender;

        _CACHED_CHAIN_ID = block.chainid;
        _CACHED_DOMAIN_SEPARATOR = _buildDomainSeparator();

        emit OwnershipTransferred(address(0), msg.sender);
    }

    // -----------------------------------------------------------------------
    // Pago
    // -----------------------------------------------------------------------

    /// @notice Liquida un pago por llamada firmado por el pagador.
    /// @param resource Identificador de lo que se paga (informativo, va al evento).
    /// @param signature Firma EIP-712 de 65 bytes del `PayCall` por parte de `payer`.
    /// @return fee Comisión efectivamente enviada al treasury.
    function pay(
        address payer,
        address payee,
        uint256 value,
        uint256 nonce,
        uint256 deadline,
        bytes32 resource,
        bytes calldata signature
    ) external returns (uint256 fee) {
        require(block.timestamp <= deadline, "PanalPayments: autorizacion caducada");
        require(payer != address(0), "PanalPayments: pagador cero");
        require(payee != address(0), "PanalPayments: cobrador cero");
        require(payee != payer, "PanalPayments: pagador y cobrador iguales");
        require(value > 0, "PanalPayments: importe cero");
        require(!nonceUsed[payer][nonce], "PanalPayments: nonce ya usado");

        bytes32 digest = _hashPayCall(payer, payee, value, nonce, deadline, resource);
        require(_recover(digest, signature) == payer, "PanalPayments: firma invalida");

        // CEI: el nonce se marca ANTES de mover nada.
        nonceUsed[payer][nonce] = true;

        fee = (value * feeBps) / 10_000;
        uint256 net = value - fee;

        // Dos transferencias directas desde el pagador: el contrato no llega a
        // tener los fondos en ningun momento.
        _safeTransferFrom(payer, payee, net);
        if (fee > 0) _safeTransferFrom(payer, treasury, fee);

        emit CallPaid(payer, payee, value, fee, resource, nonce);
    }

    /// @notice `permit` + `pay` en una sola transacción, para el primer pago de
    ///         un pagador que aún no ha autorizado saldo a este contrato.
    /// @dev El permit se ejecuta en un `try`: si otra transacción se adelantó y
    ///      ya lo consumió, la autorización ya está puesta y el pago debe seguir
    ///      adelante igual. Revertir aquí permitiría bloquear pagos ajenos
    ///      simplemente adelantándose a ejecutar el permit.
    /// @param p Autorización de saldo EIP-2612 firmada por el pagador. Va en
    ///          una struct y no suelta porque con los parámetros planos la
    ///          función desborda la pila del EVM ("stack too deep").
    function permitAndPay(
        address payer,
        address payee,
        uint256 value,
        uint256 nonce,
        uint256 deadline,
        bytes32 resource,
        bytes calldata signature,
        PermitData calldata p
    ) external returns (uint256 fee) {
        try IERC20Permit(PANAL_TOKEN).permit(payer, address(this), p.value, p.deadline, p.v, p.r, p.s) {
            // autorización concedida
        } catch {
            // ya estaba concedida (o el permit no aplica): lo dirá el allowance
        }
        return this.pay(payer, payee, value, nonce, deadline, resource, signature);
    }

    /// @notice Parámetros de un `permit` EIP-2612 del pagador a este contrato.
    struct PermitData {
        uint256 value;
        uint256 deadline;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    // -----------------------------------------------------------------------
    // Vistas
    // -----------------------------------------------------------------------

    /// @notice Separador de dominio EIP-712 vigente.
    function DOMAIN_SEPARATOR() public view returns (bytes32) {
        return block.chainid == _CACHED_CHAIN_ID ? _CACHED_DOMAIN_SEPARATOR : _buildDomainSeparator();
    }

    /// @notice Digest que debe firmar el pagador. Expuesto para que los clientes
    ///         puedan comprobar su construcción sin reimplementarla a ciegas.
    function hashPayCall(
        address payer,
        address payee,
        uint256 value,
        uint256 nonce,
        uint256 deadline,
        bytes32 resource
    ) external view returns (bytes32) {
        return _hashPayCall(payer, payee, value, nonce, deadline, resource);
    }

    /// @notice Reparto que resultaría de un importe dado, con la comisión actual.
    function quote(uint256 value) external view returns (uint256 net, uint256 fee) {
        fee = (value * feeBps) / 10_000;
        net = value - fee;
    }

    // -----------------------------------------------------------------------
    // Administración
    // -----------------------------------------------------------------------

    modifier onlyOwner() {
        require(msg.sender == owner, "PanalPayments: solo owner");
        _;
    }

    function setTreasury(address newTreasury) external onlyOwner {
        require(newTreasury != address(0), "PanalPayments: treasury cero");
        emit TreasuryUpdated(treasury, newTreasury);
        treasury = newTreasury;
    }

    /// @notice Ajusta la comisión. El tope `MAX_FEE_BPS` es inmutable: es la
    ///         garantía que tienen los usuarios de que no se les puede subir sin
    ///         límite después de haber autorizado saldo.
    function setFeeBps(uint256 newFeeBps) external onlyOwner {
        require(newFeeBps <= MAX_FEE_BPS, "PanalPayments: fee por encima del tope");
        emit FeeUpdated(feeBps, newFeeBps);
        feeBps = newFeeBps;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "PanalPayments: owner cero");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    // -----------------------------------------------------------------------
    // Internos
    // -----------------------------------------------------------------------

    function _buildDomainSeparator() private view returns (bytes32) {
        return keccak256(
            abi.encode(_EIP712_DOMAIN_TYPEHASH, _NAME_HASH, _VERSION_HASH, block.chainid, address(this))
        );
    }

    function _hashPayCall(
        address payer,
        address payee,
        uint256 value,
        uint256 nonce,
        uint256 deadline,
        bytes32 resource
    ) private view returns (bytes32) {
        bytes32 structHash =
            keccak256(abi.encode(PAY_CALL_TYPEHASH, payer, payee, value, nonce, deadline, resource));
        return keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR(), structHash));
    }

    /// @dev ecrecover con las dos guardas de siempre: `s` en la mitad baja de la
    ///      curva (si no, cada firma tiene una gemela válida y el nonce no
    ///      bastaría para identificarla) y `v` en {27,28}.
    function _recover(bytes32 digest, bytes calldata signature) private pure returns (address) {
        require(signature.length == 65, "PanalPayments: firma no son 65 bytes");
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        require(
            uint256(s) <= 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0,
            "PanalPayments: firma maleable"
        );
        require(v == 27 || v == 28, "PanalPayments: v invalida");
        address signer = ecrecover(digest, v, r, s);
        require(signer != address(0), "PanalPayments: firma irrecuperable");
        return signer;
    }

    /// @dev `transferFrom` tolerante con tokens que no devuelven bool (mismo
    ///      estilo que el SafeERC20 manual de PanalEscrowV2: cero dependencias).
    function _safeTransferFrom(address from, address to, uint256 amount) private {
        (bool ok, bytes memory data) =
            PANAL_TOKEN.call(abi.encodeWithSelector(IERC20.transferFrom.selector, from, to, amount));
        require(ok && (data.length == 0 || abi.decode(data, (bool))), "PanalPayments: transferFrom fallo");
    }
}

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
