// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./PanalRegistry.sol";
import "./PanalReputation.sol";

/// @title PanalEscrow
/// @notice Escrow de tareas entre clientes y agentes IA, con fee del protocolo (2.5%).
contract PanalEscrow {
    enum Status { Open, Delivered, Completed, Disputed, Cancelled }

    struct Task {
        address client;
        address worker;
        uint256 amount;      // wei bloqueados (precio acordado)
        bytes32 taskHash;    // hash de la descripcion
        bytes32 resultHash;  // hash del resultado (0x0 hasta entrega)
        uint256 deadline;    // entrega limite
        uint256 createdAt;
        Status status;
    }

    uint256 public constant FEE_BPS = 250;        // 2.5%
    uint256 public constant AUTO_RELEASE = 3 days;

    PanalRegistry public immutable registry;
    PanalReputation public immutable reputation;

    address public owner;
    address public treasury;
    address public arbitrator;

    Task[] public tasks;
    mapping(uint256 => uint256) public deliveredAt;

    uint256 private _locked = 1;

    event TaskCreated(uint256 indexed taskId, address indexed client, address indexed worker, uint256 amount);
    event TaskClaimed(uint256 indexed taskId, address indexed worker);
    event TaskDelivered(uint256 indexed taskId, bytes32 resultHash);
    event TaskCompleted(uint256 indexed taskId, address indexed worker, uint256 workerPaid, uint256 fee, uint8 rating);
    event TaskDisputed(uint256 indexed taskId, address indexed openedBy);
    event DisputeResolved(uint256 indexed taskId, uint256 workerPaid, uint256 clientRefunded, uint8 rating);
    event TaskCancelled(uint256 indexed taskId);
    event TreasuryUpdated(address indexed newTreasury);
    event ArbitratorTransferred(address indexed previousArbitrator, address indexed newArbitrator);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

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

    constructor(address _registry, address _reputation, address _treasury, address _arbitrator) {
        require(_registry != address(0) && _reputation != address(0), "PanalEscrow: zero address");
        require(_treasury != address(0), "PanalEscrow: zero treasury");
        require(_arbitrator != address(0), "PanalEscrow: zero arbitrator");
        registry = PanalRegistry(_registry);
        reputation = PanalReputation(_reputation);
        treasury = _treasury;
        arbitrator = _arbitrator;
        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    /// @notice Crea una tarea bloqueando msg.value. worker == address(0) => abierta a cualquier agente.
    function createTask(address worker, bytes32 taskHash, uint256 deadline)
        external
        payable
        returns (uint256 taskId)
    {
        require(msg.value > 0, "PanalEscrow: no funds");
        require(deadline > block.timestamp, "PanalEscrow: invalid deadline");
        if (worker != address(0)) {
            require(registry.isActiveAgent(worker), "PanalEscrow: worker not active agent");
        }
        taskId = tasks.length;
        tasks.push(Task({
            client: msg.sender,
            worker: worker,
            amount: msg.value,
            taskHash: taskHash,
            resultHash: bytes32(0),
            deadline: deadline,
            createdAt: block.timestamp,
            status: Status.Open
        }));
        emit TaskCreated(taskId, msg.sender, worker, msg.value);
    }

    /// @notice Reclama una tarea abierta (worker == 0). El claimer debe ser agente activo.
    function claimTask(uint256 taskId) external {
        Task storage task = _getTask(taskId);
        require(task.status == Status.Open, "PanalEscrow: not open");
        require(task.worker == address(0), "PanalEscrow: task already assigned");
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

    /// @notice Client o worker abren disputa.
    function openDispute(uint256 taskId) external {
        Task storage task = _getTask(taskId);
        require(msg.sender == task.client || msg.sender == task.worker, "PanalEscrow: not party");
        require(task.status == Status.Open || task.status == Status.Delivered, "PanalEscrow: invalid status");
        task.status = Status.Disputed;
        emit TaskDisputed(taskId, msg.sender);
    }

    /// @notice El arbitrator resuelve: workerShareBps del monto al worker (con fee), resto al client.
    function resolveDispute(uint256 taskId, uint256 workerShareBps, uint8 rating) external nonReentrant {
        Task storage task = _getTask(taskId);
        require(msg.sender == arbitrator, "PanalEscrow: not arbitrator");
        require(task.status == Status.Disputed, "PanalEscrow: not disputed");
        require(workerShareBps <= 10_000, "PanalEscrow: invalid share");

        uint256 amount = task.amount;
        uint256 workerGross = (amount * workerShareBps) / 10_000;
        uint256 clientRefund = amount - workerGross;

        task.status = Status.Completed;

        uint256 workerPaid;
        uint256 fee;
        if (workerGross > 0) {
            fee = (workerGross * FEE_BPS) / 10_000;
            workerPaid = workerGross - fee;
            _send(treasury, fee);
            _send(task.worker, workerPaid);
            require(rating >= 1 && rating <= 5, "PanalEscrow: invalid rating");
            reputation.recordCompletion(task.worker, rating, workerPaid);
        }
        if (clientRefund > 0) {
            _send(task.client, clientRefund);
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
        uint256 amount = task.amount;
        _send(task.client, amount);
        emit TaskCancelled(taskId);
    }

    function setTreasury(address newTreasury) external onlyOwner {
        require(newTreasury != address(0), "PanalEscrow: zero address");
        treasury = newTreasury;
        emit TreasuryUpdated(newTreasury);
    }

    function transferArbitrator(address newArbitrator) external {
        require(msg.sender == arbitrator, "PanalEscrow: not arbitrator");
        require(newArbitrator != address(0), "PanalEscrow: zero address");
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
        uint256 amount = task.amount;
        uint256 fee = (amount * FEE_BPS) / 10_000;
        uint256 workerPaid = amount - fee;

        task.status = Status.Completed;

        _send(treasury, fee);
        _send(task.worker, workerPaid);

        reputation.recordCompletion(task.worker, rating, workerPaid);

        emit TaskCompleted(taskId, task.worker, workerPaid, fee, rating);
    }

    function _send(address to, uint256 amount) internal {
        (bool ok, ) = to.call{value: amount}("");
        require(ok, "PanalEscrow: transfer failed");
    }
}
