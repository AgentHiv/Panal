// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./PanalRegistryV2.sol";
import "../PanalReputation.sol";

/// @notice Interfaz ERC-20 minima (proyecto zero-dependencies).
interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @notice Vista minima de PanalReputation v1 para validar que su slot de escrow
///         (one-shot) aun no fue consumido por otro escrow.
interface PanalReputationV1Like {
    function escrow() external view returns (address);
}

/// @title PanalEscrowV2
/// @notice Escrow de tareas entre clientes y agentes IA, con fee del protocolo (2.5%)
///         y soporte dual de moneda: MON nativo (currency == address(0)) o token $PANAL.
///         Toda la contabilidad es por moneda y los pagos usan el patron pull payment.
contract PanalEscrowV2 {
    enum Status { Open, Delivered, Completed, Disputed, Cancelled }

    struct Task {
        address client;
        address worker;
        uint256 amount;      // unidades de `currency` bloqueadas (precio acordado)
        bytes32 taskHash;    // hash de la descripcion
        bytes32 resultHash;  // hash del resultado (0x0 hasta entrega)
        uint256 deadline;    // entrega limite
        uint256 createdAt;
        Status status;
        address currency;    // address(0) = MON nativo, PANAL_TOKEN = $PANAL
    }

    uint256 public constant FEE_BPS = 250;               // 2.5%
    uint256 public constant AUTO_RELEASE = 3 days;
    uint256 public constant DISPUTE_TIMEOUT = 14 days;
    uint256 public constant MIN_TASK_AMOUNT_NATIVE = 0.001 ether;
    uint256 public constant MIN_TASK_AMOUNT_TOKEN = 1e18; // 1 $PANAL (18 decimales)

    PanalRegistryV2 public immutable registry;
    PanalReputation public immutable reputation;
    /// @notice Token $PANAL aceptado. Debe coincidir con registry.PANAL_TOKEN().
    address public immutable PANAL_TOKEN;

    address public owner;
    address public treasury;
    address public arbitrator;

    Task[] public tasks;
    mapping(uint256 => uint256) public deliveredAt;
    mapping(uint256 => uint256) public disputedAt;
    /// @notice Saldos pull payment por moneda: token (address(0) = MON) => usuario => monto.
    mapping(address => mapping(address => uint256)) public pendingWithdrawals;

    uint256 private _locked = 1;

    event TaskCreated(
        uint256 indexed taskId, address indexed client, address indexed worker, uint256 amount, address currency
    );
    event TaskClaimed(uint256 indexed taskId, address indexed worker);
    event TaskDelivered(uint256 indexed taskId, bytes32 resultHash);
    event TaskCompleted(uint256 indexed taskId, address indexed worker, uint256 workerPaid, uint256 fee, uint8 rating);
    event TaskDisputed(uint256 indexed taskId, address indexed openedBy);
    event DisputeResolved(uint256 indexed taskId, uint256 workerPaid, uint256 clientRefunded, uint8 rating);
    event TaskCancelled(uint256 indexed taskId);
    event TreasuryUpdated(address indexed newTreasury);
    event ArbitratorTransferred(address indexed previousArbitrator, address indexed newArbitrator);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event Withdrawal(address indexed to, address indexed token, uint256 amount);

    modifier nonReentrant() {
        require(_locked == 1, "PanalEscrow: reentrant call");
        _locked = 2;
        _;
        _locked = 1;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "PanalEscrow: not owner");
        _;
    }

    constructor(address _registry, address _reputation, address _treasury, address _arbitrator, address _panalToken) {
        require(_registry != address(0) && _reputation != address(0), "PanalEscrow: zero address");
        require(_treasury != address(0), "PanalEscrow: zero treasury");
        require(_arbitrator != address(0), "PanalEscrow: zero arbitrator");
        require(_registry.code.length > 0 && _reputation.code.length > 0, "PanalEscrow: not contracts");
        if (_panalToken != address(0)) {
            require(_panalToken.code.length > 0, "PanalEscrow: token not contract");
        }
        require(PanalRegistryV2(_registry).PANAL_TOKEN() == _panalToken, "PanalEscrow: token mismatch");
        // La reputation debe estar fresca: si su one-shot setEscrow ya fue consumido por
        // otro escrow, este escrow quedaria huerfano (recordCompletion revertiria siempre).
        require(PanalReputationV1Like(_reputation).escrow() == address(0), "reputation already consumed");
        registry = PanalRegistryV2(_registry);
        reputation = PanalReputation(_reputation);
        PANAL_TOKEN = _panalToken;
        treasury = _treasury;
        arbitrator = _arbitrator;
        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    /// @notice Crea una tarea bloqueando fondos. worker == address(0) => abierta a cualquier agente.
    /// @param currency address(0) = MON nativo (amount debe ser == msg.value), o PANAL_TOKEN
    ///        (msg.value debe ser 0 y el cliente debe haber aprobado `amount` a este contrato).
    /// @param amount monto bloqueado en unidades de `currency` (== msg.value para tareas en MON).
    ///        Para tokens con fee-on-transfer se contabiliza lo realmente recibido.
    function createTask(address worker, bytes32 taskHash, uint256 deadline, address currency, uint256 amount)
        external
        payable
        nonReentrant
        returns (uint256 taskId)
    {
        require(currency == address(0) || currency == PANAL_TOKEN, "PanalEscrow: unsupported currency");
        require(deadline > block.timestamp, "PanalEscrow: invalid deadline");
        require(worker != msg.sender, "no self-task");
        if (worker != address(0)) {
            require(registry.isActiveAgent(worker), "PanalEscrow: worker not active agent");
        }

        if (currency == address(0)) {
            require(msg.value > 0, "PanalEscrow: no funds");
            require(msg.value >= MIN_TASK_AMOUNT_NATIVE, "PanalEscrow: below minimum");
            require(amount == msg.value, "PanalEscrow: amount mismatch");
        } else {
            require(msg.value == 0, "PanalEscrow: unexpected native value");
            require(amount >= MIN_TASK_AMOUNT_TOKEN, "PanalEscrow: below minimum");
            // Defensa fee-on-transfer: contabilizar el recibido real, no el declarado.
            uint256 balanceBefore = IERC20(PANAL_TOKEN).balanceOf(address(this));
            _safeTransferFrom(PANAL_TOKEN, msg.sender, address(this), amount);
            amount = IERC20(PANAL_TOKEN).balanceOf(address(this)) - balanceBefore;
            require(amount >= MIN_TASK_AMOUNT_TOKEN, "PanalEscrow: below minimum received");
        }

        taskId = tasks.length;
        tasks.push(Task({
            client: msg.sender,
            worker: worker,
            amount: amount,
            taskHash: taskHash,
            resultHash: bytes32(0),
            deadline: deadline,
            createdAt: block.timestamp,
            status: Status.Open,
            currency: currency
        }));
        emit TaskCreated(taskId, msg.sender, worker, amount, currency);
    }

    /// @notice Reclama una tarea abierta (worker == 0). El claimer debe ser agente activo.
    function claimTask(uint256 taskId) external {
        Task storage task = _getTask(taskId);
        require(task.status == Status.Open, "PanalEscrow: not open");
        require(task.worker == address(0), "PanalEscrow: task already assigned");
        require(msg.sender != task.client, "no self-task");
        require(registry.isActiveAgent(msg.sender), "PanalEscrow: not active agent");
        task.worker = msg.sender;
        emit TaskClaimed(taskId, msg.sender);
    }

    /// @notice El worker entrega el resultado antes del deadline.
    function deliverResult(uint256 taskId, bytes32 resultHash) external {
        Task storage task = _getTask(taskId);
        require(task.status == Status.Open, "PanalEscrow: not open");
        require(msg.sender == task.worker && task.worker != address(0), "PanalEscrow: not worker");
        require(block.timestamp <= task.deadline, "PanalEscrow: deadline passed");
        require(resultHash != bytes32(0), "PanalEscrow: empty result");
        task.resultHash = resultHash;
        task.status = Status.Delivered;
        deliveredAt[taskId] = block.timestamp;
        emit TaskDelivered(taskId, resultHash);
    }

    /// @notice El cliente aprueba: paga 97.5% al worker, 2.5% a treasury, registra rating (1-5).
    function approveAndRelease(uint256 taskId, uint8 rating) external nonReentrant {
        Task storage task = _getTask(taskId);
        require(msg.sender == task.client, "PanalEscrow: not client");
        require(task.status == Status.Delivered, "PanalEscrow: not delivered");
        require(rating >= 1 && rating <= 5, "PanalEscrow: invalid rating");
        _complete(taskId, task, rating);
    }

    /// @notice Cualquiera libera los fondos si pasaron AUTO_RELEASE desde la entrega (rating 5 implicito).
    function autoRelease(uint256 taskId) external nonReentrant {
        Task storage task = _getTask(taskId);
        require(task.status == Status.Delivered, "PanalEscrow: not delivered");
        require(block.timestamp >= deliveredAt[taskId] + AUTO_RELEASE, "PanalEscrow: too early");
        _complete(taskId, task, 5);
    }

    /// @notice Client o worker abren disputa. Solo tras la entrega (Delivered): el cliente
    ///         pre-entrega ya tiene cancelTask y el worker pre-entrega no tiene nada que disputar.
    function openDispute(uint256 taskId) external {
        Task storage task = _getTask(taskId);
        require(msg.sender == task.client || msg.sender == task.worker, "PanalEscrow: not party");
        require(task.status == Status.Delivered, "PanalEscrow: not delivered");
        task.status = Status.Disputed;
        disputedAt[taskId] = block.timestamp;
        emit TaskDisputed(taskId, msg.sender);
    }

    /// @notice Si el arbitrator no resuelve en DISPUTE_TIMEOUT, cualquiera puede reembolsar al cliente.
    function resolveStuckDispute(uint256 taskId) external nonReentrant {
        Task storage task = _getTask(taskId);
        require(task.status == Status.Disputed, "PanalEscrow: not disputed");
        require(block.timestamp >= disputedAt[taskId] + DISPUTE_TIMEOUT, "PanalEscrow: not stuck");
        task.status = Status.Cancelled;
        _credit(task.currency, task.client, task.amount);
        emit TaskCancelled(taskId);
    }

    /// @notice El arbitrator resuelve: workerShareBps del monto al worker (con fee), resto al client.
    function resolveDispute(uint256 taskId, uint256 workerShareBps, uint8 rating) external nonReentrant {
        Task storage task = _getTask(taskId);
        require(msg.sender == arbitrator, "PanalEscrow: not arbitrator");
        require(task.status == Status.Disputed, "PanalEscrow: not disputed");
        require(workerShareBps <= 10_000, "PanalEscrow: invalid share");
        require(rating >= 1 && rating <= 5, "PanalEscrow: invalid rating");

        address currency = task.currency;
        uint256 amount = task.amount;
        uint256 workerGross = (amount * workerShareBps) / 10_000;
        uint256 clientRefund = amount - workerGross;

        task.status = Status.Completed;

        uint256 workerPaid;
        uint256 fee;
        if (workerGross > 0) {
            require(task.worker != address(0), "PanalEscrow: no worker to pay");
            fee = (workerGross * FEE_BPS) / 10_000;
            workerPaid = workerGross - fee;
            _credit(currency, treasury, fee);
            _credit(currency, task.worker, workerPaid);
            reputation.recordCompletion(task.worker, rating, workerPaid);
        }
        if (clientRefund > 0) {
            _credit(currency, task.client, clientRefund);
        }
        emit DisputeResolved(taskId, workerPaid, clientRefund, rating);
    }

    /// @notice Cancela: solo client, si Open sin entrega y (deadline vencido o sin worker asignado).
    function cancelTask(uint256 taskId) external nonReentrant {
        Task storage task = _getTask(taskId);
        require(msg.sender == task.client, "PanalEscrow: not client");
        require(task.status == Status.Open, "PanalEscrow: not open");
        require(
            block.timestamp > task.deadline || task.worker == address(0),
            "PanalEscrow: cannot cancel yet"
        );
        task.status = Status.Cancelled;
        _credit(task.currency, task.client, task.amount);
        emit TaskCancelled(taskId);
    }

    function setTreasury(address newTreasury) external onlyOwner {
        require(newTreasury != address(0), "PanalEscrow: zero address");
        treasury = newTreasury;
        emit TreasuryUpdated(newTreasury);
    }

    function transferArbitrator(address newArbitrator) external {
        require(msg.sender == arbitrator || msg.sender == owner, "PanalEscrow: not authorized");
        require(newArbitrator != address(0), "PanalEscrow: zero arbitrator");
        emit ArbitratorTransferred(arbitrator, newArbitrator);
        arbitrator = newArbitrator;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "PanalEscrow: zero address");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function getTaskCount() external view returns (uint256) {
        return tasks.length;
    }

    function _getTask(uint256 taskId) internal view returns (Task storage) {
        require(taskId < tasks.length, "PanalEscrow: invalid task");
        return tasks[taskId];
    }

    function _complete(uint256 taskId, Task storage task, uint8 rating) internal {
        address currency = task.currency;
        uint256 amount = task.amount;
        uint256 fee = (amount * FEE_BPS) / 10_000;
        uint256 workerPaid = amount - fee;

        task.status = Status.Completed;

        _credit(currency, treasury, fee);
        _credit(currency, task.worker, workerPaid);

        reputation.recordCompletion(task.worker, rating, workerPaid);

        emit TaskCompleted(taskId, task.worker, workerPaid, fee, rating);
    }

    function _credit(address token, address to, uint256 amount) internal {
        if (amount > 0) pendingWithdrawals[token][to] += amount;
    }

    /// @notice Retira los fondos acreditados en una moneda (patron pull payment).
    /// @param token address(0) = MON nativo, o la direccion del token ERC-20.
    function withdraw(address token) external nonReentrant {
        uint256 amount = pendingWithdrawals[token][msg.sender];
        require(amount > 0, "PanalEscrow: nothing to withdraw");
        pendingWithdrawals[token][msg.sender] = 0;
        if (token == address(0)) {
            (bool ok, ) = msg.sender.call{value: amount}("");
            require(ok, "PanalEscrow: transfer failed");
        } else {
            _safeTransfer(token, msg.sender, amount);
        }
        emit Withdrawal(msg.sender, token, amount);
    }

    /// @notice Transferencia ERC-20 segura: acepta tokens que no devuelven bool (ej. USDT legacy).
    function _safeTransfer(address token, address to, uint256 amount) internal {
        (bool ok, bytes memory data) =
            token.call(abi.encodeWithSelector(IERC20.transfer.selector, to, amount));
        require(ok && (data.length == 0 || abi.decode(data, (bool))), "PanalEscrow: token transfer failed");
    }

    /// @notice transferFrom ERC-20 seguro: acepta tokens que no devuelven bool.
    function _safeTransferFrom(address token, address from, address to, uint256 amount) internal {
        (bool ok, bytes memory data) =
            token.call(abi.encodeWithSelector(IERC20.transferFrom.selector, from, to, amount));
        require(ok && (data.length == 0 || abi.decode(data, (bool))), "PanalEscrow: token transfer failed");
    }
}
