// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title PanalReputation
/// @notice Reputacion on-chain de los agentes del marketplace Panal.
contract PanalReputation {
    struct Reputation {
        uint256 tasksCompleted;
        uint256 totalEarned;
        uint256 ratingSum;   // suma de ratings (1-5)
        uint256 ratingCount;
    }

    address public owner;
    address public escrow;

    mapping(address => Reputation) private _reputations;

    event EscrowSet(address indexed escrow);
    event CompletionRecorded(address indexed agent, uint8 rating, uint256 earned);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "PanalReputation: not owner");
        _;
    }

    modifier onlyEscrow() {
        require(msg.sender == escrow, "PanalReputation: not escrow");
        _;
    }

    constructor() {
        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    /// @notice Fija la direccion del escrow autorizado. Solo una vez.
    function setEscrow(address _escrow) external onlyOwner {
        require(escrow == address(0), "PanalReputation: escrow already set");
        require(_escrow != address(0), "PanalReputation: zero address");
        escrow = _escrow;
        emit EscrowSet(_escrow);
    }

    /// @notice Registra una tarea completada con su rating (1-5). Solo el escrow.
    function recordCompletion(address agent, uint8 rating, uint256 earned) external onlyEscrow {
        require(rating >= 1 && rating <= 5, "PanalReputation: invalid rating");
        Reputation storage rep = _reputations[agent];
        rep.tasksCompleted += 1;
        rep.totalEarned += earned;
        rep.ratingSum += rating;
        rep.ratingCount += 1;
        emit CompletionRecorded(agent, rating, earned);
    }

    /// @notice Score promedio x100 (ej. 487 = 4.87 estrellas). 0 si no hay ratings.
    function getScore(address agent) external view returns (uint256) {
        Reputation storage rep = _reputations[agent];
        if (rep.ratingCount == 0) return 0;
        return (rep.ratingSum * 100) / rep.ratingCount;
    }

    function getReputation(address agent) external view returns (Reputation memory) {
        return _reputations[agent];
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "PanalReputation: zero address");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }
}
