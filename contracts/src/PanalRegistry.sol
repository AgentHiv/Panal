// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title PanalRegistry
/// @notice Registro de agentes IA del marketplace Panal sobre Monad.
contract PanalRegistry {
    struct Agent {
        address owner;        // dueno del agente (humano u otro agente)
        string metadataURI;   // descripcion/skills off-chain (IPFS/URL)
        uint256 pricePerTask; // wei de MON por tarea
        bool active;
        uint256 registeredAt;
    }

    mapping(address => Agent) private _agents;
    address[] private _agentList;

    event AgentRegistered(address indexed agent, address indexed owner, uint256 pricePerTask);
    event PriceUpdated(address indexed agent, uint256 newPrice);
    event MetadataUpdated(address indexed agent, string newMetadataURI);
    event ActiveUpdated(address indexed agent, bool active);

    modifier onlyAgentOwner(address agent) {
        require(_agents[agent].registeredAt != 0, "PanalRegistry: agent not registered");
        require(_agents[agent].owner == msg.sender, "PanalRegistry: not agent owner");
        _;
    }

    /// @notice Registra un agente (msg.sender = direccion del agente).
    function registerAgent(string calldata metadataURI, uint256 pricePerTask) external {
        require(_agents[msg.sender].registeredAt == 0, "PanalRegistry: already registered");
        _agents[msg.sender] = Agent({
            owner: msg.sender,
            metadataURI: metadataURI,
            pricePerTask: pricePerTask,
            active: true,
            registeredAt: block.timestamp
        });
        _agentList.push(msg.sender);
        emit AgentRegistered(msg.sender, msg.sender, pricePerTask);
    }

    function updatePrice(uint256 newPrice) external onlyAgentOwner(msg.sender) {
        _agents[msg.sender].pricePerTask = newPrice;
        emit PriceUpdated(msg.sender, newPrice);
    }

    function updateMetadata(string calldata newMetadataURI) external onlyAgentOwner(msg.sender) {
        _agents[msg.sender].metadataURI = newMetadataURI;
        emit MetadataUpdated(msg.sender, newMetadataURI);
    }

    function setActive(bool active) external onlyAgentOwner(msg.sender) {
        _agents[msg.sender].active = active;
        emit ActiveUpdated(msg.sender, active);
    }

    function getAgent(address agent) external view returns (Agent memory) {
        return _agents[agent];
    }

    function getAgentCount() external view returns (uint256) {
        return _agentList.length;
    }

    /// @notice Listado paginado de direcciones de agentes registrados.
    function getAgents(uint256 offset, uint256 limit) external view returns (address[] memory) {
        uint256 total = _agentList.length;
        if (offset >= total) return new address[](0);
        uint256 end = offset + limit;
        if (end > total) end = total;
        uint256 size = end - offset;
        address[] memory result = new address[](size);
        for (uint256 i = 0; i < size; i++) {
            result[i] = _agentList[offset + i];
        }
        return result;
    }

    function isActiveAgent(address agent) external view returns (bool) {
        return _agents[agent].registeredAt != 0 && _agents[agent].active;
    }
}
