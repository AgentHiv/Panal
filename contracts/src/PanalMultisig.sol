// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title PanalMultisig
/// @notice Multisig 2-de-3 minimalista (zero-dependencies) pensado para ocupar el
///         rol de `arbitrator` de PanalEscrowV2: resolver disputas ya no depende de
///         una unica clave (EOA), sino del acuerdo de 2 de 3 owners.
///
///         Flujo: un owner propone con `submit(target, data)`, cualquier owner
///         (incluido el proponente) confirma con `confirm(id)` y al llegar a la
///         SEGUNDA confirmacion la transaccion se ejecuta en la misma llamada
///         (`target.call(data)`). Si el call revierte, todo revierte y la tx queda
///         NO ejecutada, por lo que puede reintentarse la confirmacion o proponerse
///         una tx nueva. `revoke(id)` retira la confirmacion propia antes de ejecutar.
///
///         Decision de diseno: 2 confirmaciones bastan porque el quorum es 2-de-3;
///         la confirmacion del proponente NO es automatica en `submit` (submit solo
///         registra la propuesta), asi que ejecutar exige siempre dos llamadas
///         `confirm` de owners distintos (el mapping impide confirmar dos veces).
contract PanalMultisig {
    /// @notice Confirmaciones necesarias para ejecutar (quorum 2-de-3).
    uint8 public constant REQUIRED = 2;

    struct Tx {
        address target;      // contrato a llamar (ej. PanalEscrowV2)
        bytes data;          // calldata (ej. resolveDispute(taskId, workerPct, rating))
        uint8 confirmations; // cantidad de owners que confirmaron
        bool executed;       // true una vez ejecutada (one-shot)
    }

    /// @notice Los 3 owners fijados en el constructor (inmutables).
    address[3] public owners;
    /// @notice Lookup O(1) de pertenencia: address => es owner.
    mapping(address => bool) public isOwner;

    Tx[] private _txs;
    /// @notice txId => owner => ya confirmo.
    mapping(uint256 => mapping(address => bool)) public confirmed;

    event Submit(uint256 indexed txId, address indexed proposer, address indexed target, bytes data);
    event Confirm(uint256 indexed txId, address indexed owner);
    event Revoke(uint256 indexed txId, address indexed owner);
    event Execute(uint256 indexed txId, address indexed executor, address indexed target);

    modifier onlyOwner() {
        require(isOwner[msg.sender], "PanalMultisig: not owner");
        _;
    }

    /// @param _owners las 3 direcciones owner: distintas entre si y no zero.
    constructor(address[3] memory _owners) {
        for (uint256 i = 0; i < 3; i++) {
            address o = _owners[i];
            require(o != address(0), "PanalMultisig: zero owner");
            require(!isOwner[o], "PanalMultisig: duplicate owner");
            isOwner[o] = true;
            owners[i] = o;
        }
    }

    /// @notice Propone una transaccion. No confirma automaticamente: ejecutar
    ///         siempre requiere dos `confirm` de owners distintos.
    /// @param target contrato destino (no zero, con bytecode).
    /// @param data calldata no vacio.
    /// @return txId id autoincremental de la transaccion (empezando en 0).
    function submit(address target, bytes calldata data) external onlyOwner returns (uint256 txId) {
        require(target != address(0), "PanalMultisig: zero target");
        require(target.code.length > 0, "PanalMultisig: target not contract");
        require(data.length > 0, "PanalMultisig: empty data");

        txId = _txs.length;
        _txs.push(Tx({target: target, data: data, confirmations: 0, executed: false}));
        emit Submit(txId, msg.sender, target, data);
    }

    /// @notice Confirma una tx pendiente. Al alcanzar REQUIRED confirmaciones se
    ///         ejecuta `target.call(data)` en la misma llamada; si el call falla,
    ///         toda la transaccion revierte (la tx queda NO ejecutada y las
    ///         confirmaciones de este intento se descartan con el revert).
    function confirm(uint256 txId) external onlyOwner {
        Tx storage txn = _getTx(txId);
        require(!txn.executed, "PanalMultisig: already executed");
        require(!confirmed[txId][msg.sender], "PanalMultisig: already confirmed");

        confirmed[txId][msg.sender] = true;
        txn.confirmations += 1;
        emit Confirm(txId, msg.sender);

        if (txn.confirmations >= REQUIRED) {
            // Checks-effects-interactions: marcar ejecutada ANTES del call externo.
            txn.executed = true;
            emit Execute(txId, msg.sender, txn.target);
            (bool ok, bytes memory returndata) = txn.target.call(txn.data);
            if (!ok) {
                // Propagar el motivo del revert del destino si lo hay.
                assembly {
                    revert(add(returndata, 32), mload(returndata))
                }
            }
        }
    }

    /// @notice Retira la confirmacion propia de una tx aun no ejecutada.
    function revoke(uint256 txId) external onlyOwner {
        Tx storage txn = _getTx(txId);
        require(!txn.executed, "PanalMultisig: already executed");
        require(confirmed[txId][msg.sender], "PanalMultisig: not confirmed");

        confirmed[txId][msg.sender] = false;
        txn.confirmations -= 1;
        emit Revoke(txId, msg.sender);
    }

    /// @notice Devuelve (target, data, confirmations, executed) de una tx.
    function getTx(uint256 txId) external view returns (address target, bytes memory data, uint8 confirmations, bool executed) {
        Tx storage txn = _getTx(txId);
        return (txn.target, txn.data, txn.confirmations, txn.executed);
    }

    /// @notice true si `owner` ya confirmo la tx `txId`.
    function isConfirmedBy(uint256 txId, address owner) external view returns (bool) {
        _getTx(txId);
        return confirmed[txId][owner];
    }

    /// @notice Cantidad total de transacciones propuestas.
    function txCount() external view returns (uint256) {
        return _txs.length;
    }

    function _getTx(uint256 txId) internal view returns (Tx storage) {
        require(txId < _txs.length, "PanalMultisig: invalid tx");
        return _txs[txId];
    }
}
