// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title PanalRegistryV2
/// @notice Registro de agentes IA del marketplace Panal sobre Monad, con soporte
///         de precio dual: MON nativo (currency == address(0)) o token $PANAL.
contract PanalRegistryV2 {
    struct Agent {
        address owner;        // dueno del agente (humano u otro agente)
        string metadataURI;   // descripcion/skills off-chain (IPFS/URL)
        uint256 pricePerTask; // unidades minimas de `currency` por tarea
        bool active;
        uint256 registeredAt;
        address currency;     // address(0) = MON nativo, PANAL_TOKEN = $PANAL (al final: ABI-compatible con v1)
    }

    /// @notice Token ERC-20 aceptado como moneda alternativa. address(0) = solo MON.
    address public immutable PANAL_TOKEN;

    mapping(address => Agent) private _agents;
    address[] private _agentList;

    event AgentRegistered(address indexed agent, address indexed owner, uint256 pricePerTask, address currency);
    event PriceUpdated(address indexed agent, uint256 newPrice, address currency);
    event MetadataUpdated(address indexed agent, string newMetadataURI);
    event ActiveUpdated(address indexed agent, bool active);

    modifier onlyAgentOwner(address agent) {
        require(_agents[agent].registeredAt != 0, "PanalRegistry: agent not registered");
        require(_agents[agent].owner == msg.sender, "PanalRegistry: not agent owner");
        _;
    }

    /// @param _panalToken token $PANAL aceptado. Si es address(0), solo se acepta MON nativo.
    constructor(address _panalToken) {
        if (_panalToken != address(0)) {
            require(_panalToken.code.length > 0, "PanalRegistry: token not contract");
        }
        PANAL_TOKEN = _panalToken;
    }

    /// @notice Registra un agente (msg.sender = direccion del agente).
    /// @param currency address(0) = MON nativo, o PANAL_TOKEN.
    function registerAgent(string calldata metadataURI, uint256 pricePerTask, address currency) external {
        require(_agents[msg.sender].registeredAt == 0, "PanalRegistry: already registered");
        _validateCurrency(currency);
        _agents[msg.sender] = Agent({
            owner: msg.sender,
            metadataURI: metadataURI,
            pricePerTask: pricePerTask,
            active: true,
            registeredAt: block.timestamp,
            currency: currency
        });
        _agentList.push(msg.sender);
        emit AgentRegistered(msg.sender, msg.sender, pricePerTask, currency);
    }

    function updatePrice(uint256 newPrice, address currency) external onlyAgentOwner(msg.sender) {
        _validateCurrency(currency);
        _agents[msg.sender].pricePerTask = newPrice;
        _agents[msg.sender].currency = currency;
        emit PriceUpdated(msg.sender, newPrice, currency);
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

    /// @notice Solo se acepta MON nativo (address(0)) o el token $PANAL fijado en el constructor.
    function _validateCurrency(address currency) internal view {
        require(currency == address(0) || currency == PANAL_TOKEN, "PanalRegistry: unsupported currency");
    }
}
