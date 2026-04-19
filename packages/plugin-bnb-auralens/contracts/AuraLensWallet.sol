// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title AuraLensWallet
 * @notice Permissioned treasury wallet for the AuraLens AI hedge fund.
 *         Enforces spending caps, timelocks, and emits on-chain decision proofs.
 *
 * Security model:
 * - Only the designated agent address can initiate trades
 * - Max spend per trade: 1% of treasury (enforced on-chain)
 * - Minimum timelock between trades: 30 seconds
 * - Owner (multisig) can pause, update caps, or withdraw
 * - All actions emit events for full on-chain auditability
 */

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract AuraLensWallet is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ── State ─────────────────────────────────────────────────────────────────

    address public agentAddress;
    address public usdtToken;

    uint256 public maxTradeBps = 100;       // 1% in basis points
    uint256 public timelockSeconds = 30;
    uint256 public lastTradeAt;
    bool public paused;

    uint256 public totalTradesExecuted;
    uint256 public totalPnlUsd;             // scaled by 1e6 (USDT decimals)
    uint256 public totalBuybacksUsd;

    // ── Events ────────────────────────────────────────────────────────────────

    event TradeAuthorized(
        bytes32 indexed tradeId,
        address indexed agent,
        uint256 amountUsd,
        string pair,
        bool isLong,
        uint256 timestamp
    );

    event TradeSettled(
        bytes32 indexed tradeId,
        int256 pnlUsd,
        bool isProfit,
        uint256 timestamp
    );

    event InvoiceIssued(
        bytes32 indexed invoiceId,
        bytes32 indexed tradeId,
        uint256 grossPnlUsd,
        uint256 performanceFeeUsd,
        uint256 netPnlUsd,
        uint256 timestamp
    );

    event BuybackExecuted(
        bytes32 indexed tradeId,
        uint256 amountUsd,
        uint256 auraAmount,
        address indexed auraToken,
        uint256 timestamp
    );

    event DecisionProof(
        bytes32 indexed tradeId,
        string pair,
        string direction,
        uint256 confidence,    // scaled 0-10000 (bps)
        uint256 agreementScore,
        string analystReasoning,
        string sentimentReasoning,
        uint256 timestamp
    );

    event AgentUpdated(address indexed oldAgent, address indexed newAgent);
    event CapUpdated(uint256 oldBps, uint256 newBps);
    event Paused(address by);
    event Unpaused(address by);

    // ── Modifiers ─────────────────────────────────────────────────────────────

    modifier onlyAgent() {
        require(msg.sender == agentAddress, "AuraLens: not agent");
        _;
    }

    modifier notPaused() {
        require(!paused, "AuraLens: paused");
        _;
    }

    modifier timelockPassed() {
        require(
            block.timestamp >= lastTradeAt + timelockSeconds,
            "AuraLens: timelock active"
        );
        _;
    }

    // ── Constructor ───────────────────────────────────────────────────────────

    constructor(
        address _agent,
        address _usdtToken,
        address _owner
    ) Ownable(_owner) {
        agentAddress = _agent;
        usdtToken = _usdtToken;
    }

    // ── Agent Functions ───────────────────────────────────────────────────────

    /**
     * @notice Authorize a trade and transfer funds to the MYX router.
     * @dev Enforces spending cap (maxTradeBps of treasury) and timelock.
     */
    function authorizeTrade(
        bytes32 tradeId,
        address myx_router,
        uint256 amountUsd,
        string calldata pair,
        bool isLong,
        bytes calldata tradeCalldata
    ) external onlyAgent notPaused timelockPassed nonReentrant returns (bool) {
        uint256 treasury = IERC20(usdtToken).balanceOf(address(this));
        uint256 maxAmount = (treasury * maxTradeBps) / 10000;

        require(amountUsd <= maxAmount, "AuraLens: exceeds spending cap");
        require(amountUsd > 0, "AuraLens: zero amount");
        require(myx_router != address(0), "AuraLens: invalid router");

        lastTradeAt = block.timestamp;
        totalTradesExecuted++;

        // Transfer collateral to MYX router
        IERC20(usdtToken).safeTransfer(myx_router, amountUsd);

        // Execute trade on MYX V2
        (bool success, ) = myx_router.call(tradeCalldata);
        require(success, "AuraLens: MYX call failed");

        emit TradeAuthorized(
            tradeId,
            agentAddress,
            amountUsd,
            pair,
            isLong,
            block.timestamp
        );

        return true;
    }

    /**
     * @notice Record trade settlement and emit on-chain proof.
     */
    function settleTrade(
        bytes32 tradeId,
        int256 pnlUsd
    ) external onlyAgent {
        if (pnlUsd > 0) {
            totalPnlUsd += uint256(pnlUsd);
        }

        emit TradeSettled(tradeId, pnlUsd, pnlUsd > 0, block.timestamp);
    }

    /**
     * @notice Issue an on-chain Profit-Sharing Invoice.
     */
    function issueInvoice(
        bytes32 invoiceId,
        bytes32 tradeId,
        uint256 grossPnlUsd,
        uint256 performanceFeeUsd,
        uint256 netPnlUsd
    ) external onlyAgent {
        require(grossPnlUsd > 0, "AuraLens: no profit");
        require(performanceFeeUsd <= grossPnlUsd, "AuraLens: fee exceeds profit");

        emit InvoiceIssued(
            invoiceId,
            tradeId,
            grossPnlUsd,
            performanceFeeUsd,
            netPnlUsd,
            block.timestamp
        );
    }

    /**
     * @notice Record $AURA buyback execution.
     */
    function recordBuyback(
        bytes32 tradeId,
        uint256 amountUsd,
        uint256 auraAmount,
        address auraToken
    ) external onlyAgent {
        totalBuybacksUsd += amountUsd;

        emit BuybackExecuted(
            tradeId,
            amountUsd,
            auraAmount,
            auraToken,
            block.timestamp
        );
    }

    /**
     * @notice Log on-chain decision proof from DGrid consensus.
     * @dev This is the KYA (Know Your Agent) compliance record.
     */
    function logDecisionProof(
        bytes32 tradeId,
        string calldata pair,
        string calldata direction,
        uint256 confidence,
        uint256 agreementScore,
        string calldata analystReasoning,
        string calldata sentimentReasoning
    ) external onlyAgent {
        emit DecisionProof(
            tradeId,
            pair,
            direction,
            confidence,
            agreementScore,
            analystReasoning,
            sentimentReasoning,
            block.timestamp
        );
    }

    // ── Owner Functions ───────────────────────────────────────────────────────

    function setAgent(address _agent) external onlyOwner {
        emit AgentUpdated(agentAddress, _agent);
        agentAddress = _agent;
    }

    function setMaxTradeBps(uint256 _bps) external onlyOwner {
        require(_bps <= 500, "AuraLens: cap too high (max 5%)");
        emit CapUpdated(maxTradeBps, _bps);
        maxTradeBps = _bps;
    }

    function setTimelockSeconds(uint256 _seconds) external onlyOwner {
        require(_seconds >= 10, "AuraLens: timelock too short");
        timelockSeconds = _seconds;
    }

    function pause() external onlyOwner {
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused(msg.sender);
    }

    function emergencyWithdraw(address token, uint256 amount) external onlyOwner {
        IERC20(token).safeTransfer(owner(), amount);
    }

    // ── View Functions ────────────────────────────────────────────────────────

    function treasuryBalance() external view returns (uint256) {
        return IERC20(usdtToken).balanceOf(address(this));
    }

    function maxTradeAmount() external view returns (uint256) {
        uint256 treasury = IERC20(usdtToken).balanceOf(address(this));
        return (treasury * maxTradeBps) / 10000;
    }

    function timelockRemaining() external view returns (uint256) {
        if (block.timestamp >= lastTradeAt + timelockSeconds) return 0;
        return (lastTradeAt + timelockSeconds) - block.timestamp;
    }

    receive() external payable {}
}
