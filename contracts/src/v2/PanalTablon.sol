// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Lo que PanalTablon usa del escrow v2 desplegado. Solo su ABI
///         publica: el escrow no se toca ni se redespliega.
interface ITablonEscrow {
    function createTask(address worker, bytes32 taskHash, uint256 deadline, address currency, uint256 amount)
        external
        payable
        returns (uint256 taskId);
    function approveAndRelease(uint256 taskId, uint8 rating) external;
    function autoRelease(uint256 taskId) external;
    function openDispute(uint256 taskId) external;
    function resolveStuckDispute(uint256 taskId) external;
    function cancelTask(uint256 taskId) external;
    function withdraw(address token) external;
    function tasks(uint256 taskId)
        external
        view
        returns (
            address client,
            address worker,
            uint256 amount,
            bytes32 taskHash,
            bytes32 resultHash,
            uint256 deadline,
            uint256 createdAt,
            uint8 status,
            address currency
        );
    function deliveredAt(uint256 taskId) external view returns (uint256);
    function disputedAt(uint256 taskId) external view returns (uint256);
    function pendingWithdrawals(address token, address account) external view returns (uint256);
    function arbitrator() external view returns (address);
    function registry() external view returns (address);
    function reputation() external view returns (address);
    function PANAL_TOKEN() external view returns (address);
    function MIN_TASK_AMOUNT_NATIVE() external view returns (uint256);
    function MIN_TASK_AMOUNT_TOKEN() external view returns (uint256);
    function AUTO_RELEASE() external view returns (uint256);
    function DISPUTE_TIMEOUT() external view returns (uint256);
}

interface ITablonRegistry {
    function isActiveAgent(address agent) external view returns (bool);
}

/// @notice Misma forma que `PanalReputation.Reputation`.
struct TablonReputation {
    uint256 tasksCompleted;
    uint256 totalEarned;
    uint256 ratingSum;
    uint256 ratingCount;
}

interface ITablonReputation {
    function getReputation(address agent) external view returns (TablonReputation memory);
}

interface ITablonToken {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
}

/// @title PanalTablon
/// @notice Un tablon con reglas delante de PanalEscrowV2. La especificacion
///         completa esta en contracts/BOARD.md.
///
///         El dinero espera aqui, no en el escrow. Cuando un agente pasa las
///         reglas (nivel, cupo, categoria, sanciones, campaña), este contrato
///         crea la tarea del escrow YA ASIGNADA a ese agente: nunca hay una
///         tarea abierta que un bot pueda coger saltandose las reglas. Desde
///         ahi manda el escrow de siempre: entrega, 72 h, disputas, reputacion.
///
///         En el escrow, el cliente de estas tareas es este contrato. La persona
///         actua a traves de el y cobra sus devoluciones con `claim()`.
///
///         La administracion (la multisig) ajusta niveles y topes dentro de
///         limites fijos y pausa las publicaciones nuevas. Nunca mueve dinero
///         ni toca encargos.
///
///         Los fallos son errores con nombre, que ocupan mucho menos que los
///         textos. Los motivos de `canTake` si son texto: son los que se le
///         enseñan al agente antes de gastar gas, y `NotAllowed` los repite.
contract PanalTablon {
    // ─────────────────────────────────────────────────────────── tipos

    enum Mode { Immediate, Selection }
    enum State { Posted, Assigned, Closed, Withdrawn, Expired }

    struct Job {
        address client;
        Mode mode;
        State state;
        uint8 category;
        bool experiencedOnly;
        bool relist;
        bool attested;       // el arbitro ha dado un reparto para la disputa
        bool refundPending;  // cerrado, esperando ese reparto para devolver
        address currency;    // address(0) = MON
        uint256 amount;      // presupuesto mientras esta publicado; precio una vez asignado
        bytes32 taskHash;    // keccak256 del encargo privado (el que se ancla)
        bytes32 advertHash;  // hash del anuncio publico firmado (vive en el buzon)
        bytes32 campaignId;  // 0 = sin campaña
        uint64 postedAt;
        uint64 expiresAt;
        uint64 workDuration; // plazo de entrega desde la asignacion
        uint64 applyWindow;  // seleccion: tiempo para ofertar
        uint64 chooseWindow; // seleccion: tiempo del cliente para elegir
        uint16 workerShareBps;
        address agent;
        uint256 escrowTaskId;
    }

    /// @notice Los parametros de `post()`, en un struct porque son catorce.
    struct PostParams {
        bytes32 taskHash;
        bytes32 advertHash;
        uint8 category;
        address currency;
        uint256 amount;
        uint64 workDuration;
        uint64 expiresAt;
        Mode mode;
        uint64 applyWindow;
        uint64 chooseWindow;
        bool experiencedOnly;
        bool relist;
        bytes32 campaignId;
        uint8 campaignCapPerAgent;
    }

    struct Offer {
        address agent;
        uint8 level;         // al ofertar; solo para desplazar a la mas debil
        uint64 workDuration;
        uint64 seq;          // orden de llegada; se renueva si cambia la oferta
        uint256 price;
    }

    /// @notice Un nivel de la tabla. El 0 no esta: es el de los novatos.
    struct Level {
        uint32 minCompleted;
        uint16 minRating;    // media x100: 400 = 4,0 estrellas
        uint16 dailyCap;
    }

    struct Caps {
        uint256 perJob;      // 0 = sin tope
        uint256 total;       // 0 = sin tope
    }

    struct AgentStats {
        uint32 day;          // dia UTC de `takenToday`
        uint16 takenToday;
        uint16 open;         // encargos del tablon en curso
        uint8 newcomerUsed;  // encargos cogidos siendo nivel 0
        uint64 suspendedUntil;
        uint64[3] strikes;   // las tres ultimas faltas; [2] la mas reciente
    }

    struct Campaign {
        address owner;
        uint8 capPerAgent;
    }

    /// @notice Las cuentas de cada moneda.
    struct Books {
        uint256 posted;      // depositos de encargos sin asignar
        uint256 inEscrow;    // precio de los asignados aun sin cerrar
        uint256 owedTotal;   // devoluciones sin cobrar
        uint256 pulled;      // retirado del escrow, acumulado
        uint256 attributed;  // devoluciones del escrow ya repartidas, acumulado
    }

    // ─────────────────────────────────────────────────────────── errores

    error NotAllowed(string reason);
    error NotClient();
    error NotOwner();
    error NotArbitrator();
    error OnlyEscrow();
    error Reentrant();
    error InvalidJob();
    error WrongMode();
    error WrongState();
    error Expired();
    error NotExpired();
    error OffersOpen();
    error OffersClosed();
    error ClientChoosing();
    error NoOffer();
    error OffersFull();
    error NoValidOffer();
    error NotFinished();
    error NothingToClaim();
    error NoResolvedDispute();
    error InvalidShare();
    error RefundNotCredited();
    error IsPaused();
    error UnsupportedCurrency();
    error BelowMinimum();
    error OverPerJobCap();
    error OverTotalCap();
    error InvalidTimes();
    error TooSlow();
    error InvalidCategories();
    error AmountMismatch();
    error UnexpectedValue();
    error TransferFailed();
    error EscrowAmountMismatch();
    error InvalidCampaign();
    error InvalidLevels();
    error TooManyNewcomerJobs();
    error InvalidSetup();

    // ─────────────────────────────────────────────────────────── constantes

    uint256 public constant MAX_CATEGORIES = 3;
    uint256 public constant MAX_OFFERS = 50;
    uint16 public constant MAX_DAILY_CAP = 100;
    uint16 public constant MIN_RATING_FLOOR = 350;
    uint8 public constant MAX_NEWCOMER_JOBS = 5;
    uint256 public constant SUSPENSION = 7 days;
    uint256 public constant LONG_SUSPENSION = 30 days;
    uint256 public constant STRIKE_WINDOW = 90 days;
    /// @notice Por debajo de esta parte, el agente ha perdido la disputa.
    uint256 public constant LOST_DISPUTE_BPS = 5_000;

    // Estados del escrow (PanalEscrowV2.Status)
    uint8 private constant ESCROW_OPEN = 0;
    uint8 private constant ESCROW_DELIVERED = 1;
    uint8 private constant ESCROW_COMPLETED = 2;
    uint8 private constant ESCROW_DISPUTED = 3;
    uint8 private constant ESCROW_CANCELLED = 4;

    // ─────────────────────────────────────────────────────────── estado

    ITablonEscrow public immutable escrow;
    ITablonRegistry public immutable registry;
    ITablonReputation public immutable reputation;
    address public immutable PANAL_TOKEN;
    uint256 public immutable MIN_NATIVE;
    uint256 public immutable MIN_TOKEN;
    uint256 internal immutable _autoRelease;
    uint256 internal immutable _disputeTimeout;

    address public owner;
    bool public paused;
    uint8 public newcomerJobs;
    /// @notice La tabla de niveles: `levels(0)` es el nivel 1.
    Level[5] public levels;

    mapping(address => Caps) public caps;
    mapping(address => Books) public books;
    /// @notice Devoluciones por cobrar: cliente => moneda => cantidad.
    mapping(address => mapping(address => uint256)) public owed;

    Job[] internal _jobs;
    mapping(uint256 => Offer[]) internal _offers;
    uint64 internal _offerSeq;

    /// @notice Cupos, encargos abiertos, novato y sancion de cada agente. Las
    ///         faltas no salen aqui: van en el evento `Strike`.
    mapping(address => AgentStats) public agentStats;
    /// @notice Categorias de cada agente como mapa de bits: el bit c encendido
    ///         es la categoria c.
    mapping(address => uint256) public categoryMask;

    mapping(bytes32 => Campaign) public campaigns;
    mapping(bytes32 => mapping(address => uint8)) public campaignTaken;

    uint256 private _locked = 1;

    // ─────────────────────────────────────────────────────────── eventos

    event JobPosted(
        uint256 indexed jobId,
        address indexed client,
        uint8 indexed category,
        address currency,
        uint256 amount,
        Mode mode,
        bytes32 campaignId
    );
    event Applied(uint256 indexed jobId, address indexed agent, uint8 level, uint256 price, uint64 workDuration);
    event OfferWithdrawn(uint256 indexed jobId, address indexed agent);
    event JobAssigned(
        uint256 indexed jobId, address indexed agent, uint256 escrowTaskId, uint256 price, bool byClient
    );
    event JobWithdrawn(uint256 indexed jobId);
    event JobExpired(uint256 indexed jobId);
    event JobRelisted(uint256 indexed jobId);
    event JobSettled(uint256 indexed jobId, uint256 refundToClient, bool penalized);
    event RefundPending(uint256 indexed jobId);
    event ResolutionAttested(uint256 indexed jobId, uint256 workerShareBps);
    event Strike(address indexed agent, uint8 strikesIn90Days, uint64 suspendedUntil);
    event Credited(address indexed client, address indexed currency, uint256 amount);
    event Claimed(address indexed client, address indexed currency, uint256 amount);
    event CategoriesSet(address indexed agent, uint8[] categories);
    event LevelsChanged(Level[5] levels);
    event NewcomerJobsChanged(uint8 jobs);
    event PausedSet(bool paused);
    event CapsChanged(address indexed currency, uint256 perJob, uint256 total);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    // ─────────────────────────────────────────────────────────── modificadores

    modifier nonReentrant() {
        if (_locked != 1) revert Reentrant();
        _locked = 2;
        _;
        _locked = 1;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    // ─────────────────────────────────────────────────────────── constructor

    /// @param escrow_ el PanalEscrowV2 desplegado. Registry, reputacion, token y
    ///        minimos se leen de el, asi que no pueden quedar desparejados.
    /// @param owner_ la multisig, desde el primer bloque.
    constructor(
        address escrow_,
        address owner_,
        Level[5] memory levels_,
        uint8 newcomerJobs_,
        Caps memory monCaps_,
        Caps memory panalCaps_
    ) {
        if (escrow_.code.length == 0 || owner_ == address(0)) revert InvalidSetup();
        escrow = ITablonEscrow(escrow_);
        registry = ITablonRegistry(ITablonEscrow(escrow_).registry());
        reputation = ITablonReputation(ITablonEscrow(escrow_).reputation());
        PANAL_TOKEN = ITablonEscrow(escrow_).PANAL_TOKEN();
        MIN_NATIVE = ITablonEscrow(escrow_).MIN_TASK_AMOUNT_NATIVE();
        MIN_TOKEN = ITablonEscrow(escrow_).MIN_TASK_AMOUNT_TOKEN();
        _autoRelease = ITablonEscrow(escrow_).AUTO_RELEASE();
        _disputeTimeout = ITablonEscrow(escrow_).DISPUTE_TIMEOUT();

        owner = owner_;
        emit OwnershipTransferred(address(0), owner_);

        _setLevels(levels_);
        _setNewcomerJobs(newcomerJobs_);
        _setCaps(address(0), monCaps_.perJob, monCaps_.total);
        if (PANAL_TOKEN != address(0)) _setCaps(PANAL_TOKEN, panalCaps_.perJob, panalCaps_.total);
    }

    /// @notice Solo entra MON del escrow, al retirar devoluciones.
    receive() external payable {
        if (msg.sender != address(escrow)) revert OnlyEscrow();
    }

    // ─────────────────────────────────────────────────────────── cliente

    /// @notice Publica un encargo dejando el deposito aqui.
    function post(PostParams calldata p) external payable nonReentrant returns (uint256 jobId) {
        if (paused) revert IsPaused();
        _requireCurrency(p.currency);
        if (p.amount < _minAmount(p.currency)) revert BelowMinimum();
        _requirePerJobCap(p.currency, p.amount);
        _requireTotalCap(p.currency, p.amount);
        if (p.workDuration == 0 || p.expiresAt <= block.timestamp) revert InvalidTimes();
        if (p.mode == Mode.Selection) {
            if (p.applyWindow == 0) revert InvalidTimes();
            if (uint256(p.expiresAt) < block.timestamp + p.applyWindow + p.chooseWindow) revert InvalidTimes();
        }
        if (p.campaignId != bytes32(0)) _joinCampaign(p.campaignId, p.campaignCapPerAgent);

        _receive(p.currency, msg.sender, p.amount);

        jobId = _jobs.length;
        Job storage job = _jobs.push();
        job.client = msg.sender;
        job.mode = p.mode;
        job.category = p.category;
        job.experiencedOnly = p.experiencedOnly;
        job.relist = p.relist;
        job.currency = p.currency;
        job.amount = p.amount;
        job.taskHash = p.taskHash;
        job.advertHash = p.advertHash;
        job.campaignId = p.campaignId;
        job.postedAt = uint64(block.timestamp);
        job.expiresAt = p.expiresAt;
        job.workDuration = p.workDuration;
        if (p.mode == Mode.Selection) {
            job.applyWindow = p.applyWindow;
            job.chooseWindow = p.chooseWindow;
        }
        books[p.currency].posted += p.amount;

        emit JobPosted(jobId, msg.sender, p.category, p.currency, p.amount, p.mode, p.campaignId);
    }

    /// @notice Retira un encargo que nadie tiene todavia. Vuelve entero.
    function withdrawJob(uint256 jobId) external nonReentrant {
        Job storage job = _job(jobId);
        if (msg.sender != job.client) revert NotClient();
        if (job.state != State.Posted) revert WrongState();
        job.state = State.Withdrawn;
        _unpost(jobId, job);
        emit JobWithdrawn(jobId);
    }

    /// @notice Seleccion: el cliente elige una oferta. Si esta por encima del
    ///         presupuesto, manda la diferencia exacta; si esta por debajo, la
    ///         diferencia le queda para cobrar.
    function choose(uint256 jobId, address agent) external payable nonReentrant {
        Job storage job = _selectionJob(jobId);
        if (msg.sender != job.client) revert NotClient();
        if (block.timestamp < _applyEnd(job)) revert OffersOpen();
        if (block.timestamp > job.expiresAt) revert Expired();

        Offer[] storage list = _offers[jobId];
        uint256 i = _findOffer(list, agent);
        if (i == list.length) revert NoOffer();
        Offer memory o = list[i];
        uint8 level = _requireAllowed(agent, job);

        if (o.price > job.amount) {
            // Dinero nuevo: el tope por encargo mira el precio final y el
            // total, solo la diferencia que entra.
            uint256 diff = o.price - job.amount;
            _requirePerJobCap(job.currency, o.price);
            _requireTotalCap(job.currency, diff);
            _receive(job.currency, msg.sender, diff);
            books[job.currency].posted += diff;
            job.amount = o.price;
        } else if (msg.value != 0) {
            revert UnexpectedValue();
        }
        _assign(jobId, job, agent, o.price, o.workDuration, level, true);
    }

    /// @notice El cliente aprueba la entrega y califica (1-5). Lo cierra a la vez.
    function approve(uint256 jobId, uint8 rating) external nonReentrant {
        Job storage job = _assignedJob(jobId);
        if (msg.sender != job.client) revert NotClient();
        escrow.approveAndRelease(job.escrowTaskId, rating);
        _settle(jobId, job);
    }

    /// @notice El cliente abre una disputa sobre la entrega.
    function dispute(uint256 jobId) external nonReentrant {
        Job storage job = _assignedJob(jobId);
        if (msg.sender != job.client) revert NotClient();
        escrow.openDispute(job.escrowTaskId);
    }

    /// @notice Cobra las devoluciones de una moneda.
    function claim(address currency) external nonReentrant {
        uint256 amount = owed[msg.sender][currency];
        if (amount == 0) revert NothingToClaim();
        owed[msg.sender][currency] = 0;
        books[currency].owedTotal -= amount;
        _ensureBalance(currency, amount);
        _send(currency, msg.sender, amount);
        emit Claimed(msg.sender, currency, amount);
    }

    // ─────────────────────────────────────────────────────────── agente

    /// @notice Declara hasta 3 categorias. Sustituye a las anteriores.
    function setCategories(uint8[] calldata categories) external {
        if (categories.length > MAX_CATEGORIES) revert InvalidCategories();
        uint256 mask;
        for (uint256 i; i < categories.length; i++) {
            uint256 bit = uint256(1) << categories[i];
            if (mask & bit != 0) revert InvalidCategories();
            mask |= bit;
        }
        categoryMask[msg.sender] = mask;
        emit CategoriesSet(msg.sender, categories);
    }

    /// @notice Inmediato: el primero que pasa las reglas se lo queda.
    function take(uint256 jobId) external nonReentrant {
        Job storage job = _postedJob(jobId);
        if (job.mode != Mode.Immediate) revert WrongMode();
        if (block.timestamp > job.expiresAt) revert Expired();
        uint8 level = _requireAllowed(msg.sender, job);
        _assign(jobId, job, msg.sender, job.amount, job.workDuration, level, false);
    }

    /// @notice Seleccion: oferta con precio y plazo. Volver a llamar la cambia.
    /// @param workDuration 0 = el plazo del encargo.
    function applyFor(uint256 jobId, uint256 price, uint64 workDuration) external {
        Job storage job = _selectionJob(jobId);
        if (block.timestamp >= _applyEnd(job)) revert OffersClosed();
        uint8 level = _requireAllowed(msg.sender, job);
        if (price < _minAmount(job.currency)) revert BelowMinimum();
        _requirePerJobCap(job.currency, price);
        if (workDuration == 0) workDuration = job.workDuration;
        if (workDuration > job.workDuration) revert TooSlow();

        Offer[] storage list = _offers[jobId];
        Offer memory o =
            Offer({agent: msg.sender, level: level, workDuration: workDuration, seq: ++_offerSeq, price: price});
        uint256 i = _findOffer(list, msg.sender);
        if (i < list.length) {
            list[i] = o;
        } else if (list.length < MAX_OFFERS) {
            list.push(o);
        } else {
            // Lleno: solo entra desplazando a la mas debil (nivel mas bajo; a
            // igualdad, precio mas alto). Llenar la lista con agentes de usar y
            // tirar no deja fuera a los buenos.
            uint256 w;
            for (uint256 j = 1; j < list.length; j++) {
                if (list[j].level < list[w].level || (list[j].level == list[w].level && list[j].price > list[w].price))
                {
                    w = j;
                }
            }
            if (!(level > list[w].level || (level == list[w].level && price < list[w].price))) revert OffersFull();
            emit OfferWithdrawn(jobId, list[w].agent);
            list[w] = o;
        }
        emit Applied(jobId, msg.sender, level, price, workDuration);
    }

    /// @notice Retira la oferta mientras la ventana sigue abierta.
    function withdrawOffer(uint256 jobId) external {
        Job storage job = _selectionJob(jobId);
        if (block.timestamp >= _applyEnd(job)) revert OffersClosed();
        Offer[] storage list = _offers[jobId];
        uint256 i = _findOffer(list, msg.sender);
        if (i == list.length) revert NoOffer();
        list[i] = list[list.length - 1];
        list.pop();
        emit OfferWithdrawn(jobId, msg.sender);
    }

    // ─────────────────────────────────────────────────────────── cualquiera

    /// @notice Seleccion sin eleccion del cliente: gana el nivel mas alto; a
    ///         igualdad, el precio mas bajo, el plazo mas corto y el primero en
    ///         ofertar. Las ofertas por encima del presupuesto no cuentan, y se
    ///         salta a quien ya no pasa las reglas.
    function autoAssign(uint256 jobId) external nonReentrant {
        Job storage job = _selectionJob(jobId);
        if (block.timestamp < _applyEnd(job) + job.chooseWindow) revert ClientChoosing();
        if (block.timestamp > job.expiresAt) revert Expired();

        Offer[] storage list = _offers[jobId];
        uint256 n = list.length;
        uint256 best = n; // n = ninguna todavia
        uint8 bestLevel;
        for (uint256 i; i < n; i++) {
            if (list[i].price > job.amount) continue;
            (string memory reason, uint8 level) = _check(list[i].agent, job);
            if (bytes(reason).length != 0) continue;
            if (best == n || _better(level, list[i], bestLevel, list[best])) {
                best = i;
                bestLevel = level;
            }
        }
        if (best == n) revert NoValidOffer();
        Offer storage o = list[best];
        _assign(jobId, job, o.agent, o.price, o.workDuration, bestLevel, false);
    }

    /// @notice Cierra las cuentas de un encargo que ha terminado en el escrow.
    ///         Si el escrow se puede adelantar, lo adelanta: cancela un encargo
    ///         sin entregar pasado el plazo, libera una entrega pasadas 72 h y
    ///         devuelve una disputa atascada 14 dias. Asi la sancion no depende
    ///         de que el cliente se acuerde.
    function settle(uint256 jobId) external nonReentrant {
        _settle(jobId, _assignedJob(jobId));
    }

    /// @notice Devuelve el deposito si nadie lo cogio a tiempo.
    function expire(uint256 jobId) external nonReentrant {
        Job storage job = _postedJob(jobId);
        if (block.timestamp <= job.expiresAt) revert NotExpired();
        job.state = State.Expired;
        _unpost(jobId, job);
        emit JobExpired(jobId);
    }

    // ─────────────────────────────────────────────────────────── arbitro

    /// @notice El reparto de una disputa resuelta. El escrow solo lo emite en un
    ///         evento, que un contrato no puede leer, asi que el arbitro (la
    ///         misma multisig que decidio el reparto) lo da aqui. Se puede
    ///         corregir mientras no se haya aplicado; aplicado, es definitivo.
    function attestResolution(uint256 jobId, uint256 workerShareBps) external nonReentrant {
        if (msg.sender != escrow.arbitrator()) revert NotArbitrator();
        if (workerShareBps > 10_000) revert InvalidShare();
        Job storage job = _job(jobId);
        if (!(job.state == State.Assigned || (job.state == State.Closed && job.refundPending))) revert WrongState();
        (,, uint8 status) = _escrowTask(job.escrowTaskId);
        if (status != ESCROW_COMPLETED || escrow.disputedAt(job.escrowTaskId) == 0) revert NoResolvedDispute();

        job.attested = true;
        job.workerShareBps = uint16(workerShareBps);
        emit ResolutionAttested(jobId, workerShareBps);

        // Si ya estaba cerrado esperando el reparto, se termina ahora. Si el
        // reparto pide mas de lo que el escrow ha acreditado, revierte aqui y
        // el arbitro lo ve.
        if (job.state == State.Closed) _finishDispute(jobId, job);
    }

    // ─────────────────────────────────────────────────────────── administracion

    function setLevels(Level[5] calldata levels_) external onlyOwner {
        _setLevels(levels_);
    }

    function setNewcomerJobs(uint8 jobs_) external onlyOwner {
        _setNewcomerJobs(jobs_);
    }

    /// @notice Solo frena `post()`. Todo lo demas sigue funcionando.
    function setPaused(bool paused_) external onlyOwner {
        paused = paused_;
        emit PausedSet(paused_);
    }

    /// @notice Topes de la beta por moneda (0 = sin tope). Solo afectan al
    ///         dinero que entra despues: no tocan ningun encargo.
    function setCaps(address currency, uint256 perJob, uint256 total) external onlyOwner {
        _setCaps(currency, perJob, total);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert InvalidSetup();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    // ─────────────────────────────────────────────────────────── lecturas

    function jobCount() external view returns (uint256) {
        return _jobs.length;
    }

    function getJob(uint256 jobId) external view returns (Job memory) {
        return _job(jobId);
    }

    function offers(uint256 jobId) external view returns (Offer[] memory) {
        return _offers[jobId];
    }

    /// @return level de 0 a 5.
    /// @return dailyCap encargos por dia (0 en el nivel 0, que va por `newcomerJobs`).
    function levelOf(address agent) external view returns (uint8 level, uint16 dailyCap) {
        level = _level(agent);
        if (level > 0) dailyCap = levels[level - 1].dailyCap;
    }

    /// @notice Si puede coger (inmediato) u ofertar (seleccion) ahora, y por que no.
    function canTake(address agent, uint256 jobId) external view returns (bool ok, string memory reason) {
        if (jobId >= _jobs.length) return (false, "invalid job");
        Job storage job = _jobs[jobId];
        if (job.state != State.Posted) return (false, "not posted");
        if (block.timestamp > job.expiresAt) return (false, "expired");
        if (job.mode == Mode.Selection && block.timestamp >= _applyEnd(job)) return (false, "offers closed");
        (reason,) = _check(agent, job);
        ok = bytes(reason).length == 0;
    }

    // ─────────────────────────────────────────────────────────── reglas

    /// @dev Las reglas de §6.5 menos el estado y las fechas del encargo, que
    ///      comprueba quien llama. Devuelve "" si pasa, y el nivel actual.
    function _check(address agent, Job storage job) internal view returns (string memory, uint8) {
        if (!registry.isActiveAgent(agent)) return ("not an active agent", 0);
        if (agent == job.client) return ("own job", 0);
        if (categoryMask[agent] & (uint256(1) << job.category) == 0) return ("category not declared", 0);
        AgentStats storage s = agentStats[agent];
        if (s.suspendedUntil > block.timestamp) return ("suspended", 0);

        uint8 level = _level(agent);
        if (level == 0) {
            if (job.experiencedOnly) return ("experienced only", 0);
            if (s.newcomerUsed >= newcomerJobs) return ("no newcomer jobs left", 0);
            if (s.open > 0) return ("newcomer job in progress", 0);
        } else {
            uint16 cap = levels[level - 1].dailyCap;
            if (s.day == _today() && s.takenToday >= cap) return ("daily quota used", level);
            if (s.open >= cap) return ("too many open", level);
        }

        bytes32 campaign = job.campaignId;
        if (campaign != bytes32(0) && campaignTaken[campaign][agent] >= campaigns[campaign].capPerAgent) {
            return ("campaign cap reached", level);
        }
        return ("", level);
    }

    function _requireAllowed(address agent, Job storage job) internal view returns (uint8 level) {
        string memory reason;
        (reason, level) = _check(agent, job);
        if (bytes(reason).length != 0) revert NotAllowed(reason);
    }

    function _level(address agent) internal view returns (uint8) {
        TablonReputation memory r = reputation.getReputation(agent);
        uint256 rating = r.ratingCount == 0 ? 0 : (r.ratingSum * 100) / r.ratingCount;
        for (uint8 l = 5; l > 0; l--) {
            Level storage lv = levels[l - 1];
            if (r.tasksCompleted >= lv.minCompleted && rating >= lv.minRating) return l;
        }
        return 0;
    }

    function _better(uint8 la, Offer storage a, uint8 lb, Offer storage b) internal view returns (bool) {
        if (la != lb) return la > lb;
        if (a.price != b.price) return a.price < b.price;
        if (a.workDuration != b.workDuration) return a.workDuration < b.workDuration;
        return a.seq < b.seq;
    }

    /// @dev Indice de la oferta del agente, o `list.length` si no tiene.
    function _findOffer(Offer[] storage list, address agent) internal view returns (uint256 i) {
        for (; i < list.length; i++) {
            if (list[i].agent == agent) return i;
        }
    }

    function _today() internal view returns (uint32) {
        return uint32(block.timestamp / 1 days);
    }

    function _applyEnd(Job storage job) internal view returns (uint256) {
        return uint256(job.postedAt) + job.applyWindow;
    }

    // ─────────────────────────────────────────────────────────── asignar

    /// @dev `job.amount` es el deposito que hay para este encargo: `price` va al
    ///      escrow y lo que pase del precio vuelve al cliente.
    function _assign(
        uint256 jobId,
        Job storage job,
        address agent,
        uint256 price,
        uint64 workDuration,
        uint8 level,
        bool byClient
    ) internal {
        _countTaken(agent, job.campaignId, level);

        address currency = job.currency;
        uint256 deposit = job.amount;
        books[currency].posted -= deposit;
        books[currency].inEscrow += price;
        if (deposit > price) _owe(job.client, currency, deposit - price);

        job.amount = price;
        job.agent = agent;
        job.state = State.Assigned;
        delete _offers[jobId];

        uint256 tid = _createEscrowTask(job, agent, price, block.timestamp + workDuration);
        job.escrowTaskId = tid;
        emit JobAssigned(jobId, agent, tid, price, byClient);
    }

    /// @dev Cupo del dia, encargos abiertos, novato y campaña.
    function _countTaken(address agent, bytes32 campaignId, uint8 level) internal {
        AgentStats storage s = agentStats[agent];
        uint32 today = _today();
        if (s.day != today) {
            s.day = today;
            s.takenToday = 0;
        }
        s.takenToday += 1;
        s.open += 1;
        if (level == 0) s.newcomerUsed += 1;
        if (campaignId != bytes32(0)) campaignTaken[campaignId][agent] += 1;
    }

    /// @dev La tarea del escrow, ya a nombre del agente. En $PANAL se aprueba
    ///      al escrow esa cantidad y ni un wei mas, y se deja a cero despues.
    function _createEscrowTask(Job storage job, address agent, uint256 price, uint256 deadline)
        internal
        returns (uint256 tid)
    {
        address currency = job.currency;
        // Un encargo vuelto a publicar puede tener su dinero aun en el escrow.
        _ensureBalance(currency, price);
        if (currency == address(0)) {
            tid = escrow.createTask{value: price}(agent, job.taskHash, deadline, address(0), price);
        } else {
            _safeCall(currency, abi.encodeCall(ITablonToken.approve, (address(escrow), price)));
            tid = escrow.createTask(agent, job.taskHash, deadline, currency, price);
            if (ITablonToken(currency).allowance(address(this), address(escrow)) != 0) {
                _safeCall(currency, abi.encodeCall(ITablonToken.approve, (address(escrow), 0)));
            }
        }
        (uint256 escrowAmount,,) = _escrowTask(tid);
        if (escrowAmount != price) revert EscrowAmountMismatch();
    }

    // ─────────────────────────────────────────────────────────── cerrar

    function _settle(uint256 jobId, Job storage job) internal {
        uint256 tid = job.escrowTaskId;
        (, uint256 deadline, uint8 status) = _escrowTask(tid);

        // Adelantar el escrow si ya se puede.
        if (status == ESCROW_OPEN && block.timestamp > deadline) {
            escrow.cancelTask(tid);
            status = ESCROW_CANCELLED;
        } else if (status == ESCROW_DELIVERED && block.timestamp >= escrow.deliveredAt(tid) + _autoRelease) {
            escrow.autoRelease(tid);
            status = ESCROW_COMPLETED;
        } else if (status == ESCROW_DISPUTED && block.timestamp >= escrow.disputedAt(tid) + _disputeTimeout)
        {
            escrow.resolveStuckDispute(tid);
            status = ESCROW_CANCELLED;
        }
        if (status != ESCROW_COMPLETED && status != ESCROW_CANCELLED) revert NotFinished();

        address agent = job.agent;
        address currency = job.currency;
        uint256 price = job.amount;
        agentStats[agent].open -= 1;
        books[currency].inEscrow -= price;
        job.state = State.Closed;

        if (status == ESCROW_CANCELLED) {
            // Todo vuelve. Sin entrega es culpa del agente; con entrega es una
            // disputa que el arbitro no resolvio en 14 dias, y no lo es. Esta
            // devolucion es segura: el escrow acaba de acreditar `price`.
            books[currency].attributed += price;
            bool noDelivery = escrow.deliveredAt(tid) == 0;
            if (noDelivery) _strike(agent, true);
            if (noDelivery && job.relist) {
                emit JobSettled(jobId, 0, true);
                _relist(jobId, job, price);
            } else {
                _owe(job.client, currency, price);
                emit JobSettled(jobId, price, noDelivery);
            }
        } else if (escrow.disputedAt(tid) == 0) {
            emit JobSettled(jobId, 0, false);
        } else {
            // Disputa resuelta: la parte del agente se cierra ya; la devolucion
            // espera a un reparto que quepa en lo acreditado.
            job.refundPending = true;
            if (job.attested && _fits(currency, _disputeRefund(job))) _finishDispute(jobId, job);
            else emit RefundPending(jobId);
        }
    }

    function _disputeRefund(Job storage job) internal view returns (uint256) {
        return job.amount - (job.amount * job.workerShareBps) / 10_000;
    }

    function _finishDispute(uint256 jobId, Job storage job) internal {
        uint256 refund = _disputeRefund(job);
        job.refundPending = false;
        if (refund > 0) {
            if (!_fits(job.currency, refund)) revert RefundNotCredited();
            books[job.currency].attributed += refund;
            _owe(job.client, job.currency, refund);
        }
        bool lost = job.workerShareBps < LOST_DISPUTE_BPS;
        if (lost) _strike(job.agent, false);
        emit JobSettled(jobId, refund, lost);
    }

    function _relist(uint256 jobId, Job storage job, uint256 deposit) internal {
        uint64 listing = job.expiresAt - job.postedAt;
        job.state = State.Posted;
        job.amount = deposit;
        job.agent = address(0);
        job.attested = false;
        job.refundPending = false;
        job.postedAt = uint64(block.timestamp);
        job.expiresAt = uint64(block.timestamp) + listing;
        books[job.currency].posted += deposit;
        emit JobRelisted(jobId);
    }

    /// @dev 7 dias fuera por no entregar; 30 con 3 faltas en 90 dias.
    function _strike(address agent, bool suspend) internal {
        AgentStats storage s = agentStats[agent];
        s.strikes[0] = s.strikes[1];
        s.strikes[1] = s.strikes[2];
        s.strikes[2] = uint64(block.timestamp);

        uint8 recent;
        for (uint256 i; i < 3; i++) {
            if (s.strikes[i] != 0 && block.timestamp - s.strikes[i] <= STRIKE_WINDOW) recent++;
        }
        uint256 until;
        if (recent >= 3) until = block.timestamp + LONG_SUSPENSION;
        else if (suspend) until = block.timestamp + SUSPENSION;
        if (until > s.suspendedUntil) s.suspendedUntil = uint64(until);
        emit Strike(agent, recent, s.suspendedUntil);
    }

    // ─────────────────────────────────────────────────────────── dinero

    function _unpost(uint256 jobId, Job storage job) internal {
        books[job.currency].posted -= job.amount;
        _owe(job.client, job.currency, job.amount);
        delete _offers[jobId];
    }

    function _owe(address client, address currency, uint256 amount) internal {
        owed[client][currency] += amount;
        books[currency].owedTotal += amount;
        emit Credited(client, currency, amount);
    }

    /// @dev Si una devolucion de disputa cabe en lo que el escrow ha acreditado
    ///      de verdad a este contrato y aun no se ha repartido.
    function _fits(address currency, uint256 amount) internal view returns (bool) {
        Books storage b = books[currency];
        return b.attributed + amount <= b.pulled + escrow.pendingWithdrawals(currency, address(this));
    }

    /// @dev Si no hay bastante aqui, trae lo que el escrow tenga acreditado.
    function _ensureBalance(address currency, uint256 needed) internal {
        uint256 balance =
            currency == address(0) ? address(this).balance : ITablonToken(currency).balanceOf(address(this));
        if (balance >= needed) return;
        uint256 pending = escrow.pendingWithdrawals(currency, address(this));
        if (pending == 0) return;
        books[currency].pulled += pending;
        escrow.withdraw(currency);
    }

    /// @dev Cobra al que llama exactamente `amount`. En $PANAL mide lo recibido:
    ///      un token que cobre por transferir no cuadraria las cuentas.
    function _receive(address currency, address from, uint256 amount) internal {
        if (currency == address(0)) {
            if (msg.value != amount) revert AmountMismatch();
        } else {
            if (msg.value != 0) revert UnexpectedValue();
            uint256 before = ITablonToken(currency).balanceOf(address(this));
            _safeCall(currency, abi.encodeCall(ITablonToken.transferFrom, (from, address(this), amount)));
            if (ITablonToken(currency).balanceOf(address(this)) - before != amount) revert AmountMismatch();
        }
    }

    function _send(address currency, address to, uint256 amount) internal {
        if (currency == address(0)) {
            (bool ok,) = to.call{value: amount}("");
            if (!ok) revert TransferFailed();
        } else {
            _safeCall(currency, abi.encodeCall(ITablonToken.transfer, (to, amount)));
        }
    }

    /// @dev Acepta tokens que no devuelven bool, como el escrow.
    function _safeCall(address token, bytes memory data) internal {
        (bool ok, bytes memory ret) = token.call(data);
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert TransferFailed();
    }

    // ─────────────────────────────────────────────────────────── lecturas internas

    function _escrowTask(uint256 tid) internal view returns (uint256 amount, uint256 deadline, uint8 status) {
        (,, amount,,, deadline,, status,) = escrow.tasks(tid);
    }

    function _job(uint256 jobId) internal view returns (Job storage) {
        if (jobId >= _jobs.length) revert InvalidJob();
        return _jobs[jobId];
    }

    function _postedJob(uint256 jobId) internal view returns (Job storage job) {
        job = _job(jobId);
        if (job.state != State.Posted) revert WrongState();
    }

    function _assignedJob(uint256 jobId) internal view returns (Job storage job) {
        job = _job(jobId);
        if (job.state != State.Assigned) revert WrongState();
    }

    function _selectionJob(uint256 jobId) internal view returns (Job storage job) {
        job = _postedJob(jobId);
        if (job.mode != Mode.Selection) revert WrongMode();
    }

    function _requireCurrency(address currency) internal view {
        if (currency != address(0) && (currency != PANAL_TOKEN || PANAL_TOKEN == address(0))) {
            revert UnsupportedCurrency();
        }
    }

    function _minAmount(address currency) internal view returns (uint256) {
        return currency == address(0) ? MIN_NATIVE : MIN_TOKEN;
    }

    function _requirePerJobCap(address currency, uint256 amount) internal view {
        uint256 perJob = caps[currency].perJob;
        if (perJob != 0 && amount > perJob) revert OverPerJobCap();
    }

    /// @dev El total cuenta lo publicado y lo que esta en el escrow por encargos
    ///      del tablon: lo que se perderia si este contrato tuviera un fallo.
    function _requireTotalCap(address currency, uint256 extra) internal view {
        uint256 total = caps[currency].total;
        Books storage b = books[currency];
        if (total != 0 && b.posted + b.inEscrow + extra > total) revert OverTotalCap();
    }

    function _joinCampaign(bytes32 id, uint8 cap) internal {
        Campaign storage c = campaigns[id];
        if (c.owner == address(0)) {
            if (cap == 0) revert InvalidCampaign();
            c.owner = msg.sender;
            c.capPerAgent = cap;
        } else if (c.owner != msg.sender || c.capPerAgent != cap) {
            revert InvalidCampaign();
        }
    }

    /// @dev Limites fijos: nunca mas de 100 al dia, umbrales que suben, y una
    ///      nota minima de 3,5 como poco.
    function _setLevels(Level[5] memory levels_) internal {
        for (uint256 i; i < 5; i++) {
            Level memory lv = levels_[i];
            if (lv.dailyCap == 0 || lv.dailyCap > MAX_DAILY_CAP) revert InvalidLevels();
            if (lv.minRating < MIN_RATING_FLOOR || lv.minRating > 500) revert InvalidLevels();
            if (i == 0) {
                if (lv.minCompleted == 0) revert InvalidLevels();
            } else {
                Level memory prev = levels_[i - 1];
                if (lv.minCompleted <= prev.minCompleted) revert InvalidLevels();
                if (lv.minRating < prev.minRating || lv.dailyCap < prev.dailyCap) revert InvalidLevels();
            }
            levels[i] = lv;
        }
        emit LevelsChanged(levels_);
    }

    function _setNewcomerJobs(uint8 jobs_) internal {
        if (jobs_ > MAX_NEWCOMER_JOBS) revert TooManyNewcomerJobs();
        newcomerJobs = jobs_;
        emit NewcomerJobsChanged(jobs_);
    }

    function _setCaps(address currency, uint256 perJob, uint256 total) internal {
        _requireCurrency(currency);
        caps[currency] = Caps(perJob, total);
        emit CapsChanged(currency, perJob, total);
    }
}
