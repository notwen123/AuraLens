// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./MockERC20.sol";

/**
 * @title MockMYXRouter
 * @notice Simulates MYX V2 perpetual trading on BSC Testnet.
 *         - openPosition: takes USDT collateral, emits event, returns a positionId
 *         - closePosition: returns collateral + simulated PnL (±5% random-ish)
 *         - getPrice: returns a hardcoded mock price per pair
 *
 * This lets AuraLens run the full trade cycle on testnet with real txs.
 */
contract MockMYXRouter {
    MockERC20 public usdt;

    struct Position {
        bytes32 pair;
        bool isLong;
        uint256 size;       // in USDT (6 decimals scaled)
        uint256 collateral; // in USDT
        uint256 entryPrice; // 8 decimals
        uint256 openedAt;
        bool open;
    }

    mapping(bytes32 => Position) public positions;
    uint256 private _nonce;

    // Mock prices (8 decimals) — updated by owner for demo
    mapping(bytes32 => uint256) public mockPrices;

    event PositionOpened(
        bytes32 indexed positionId,
        bytes32 pair,
        bool isLong,
        uint256 size,
        uint256 collateral,
        uint256 entryPrice
    );

    event PositionClosed(
        bytes32 indexed positionId,
        int256 pnl,
        uint256 exitPrice
    );

    constructor(address _usdt) {
        usdt = MockERC20(_usdt);

        // Seed mock prices
        mockPrices[_pairKey("BTC_USDT")] = 67000_00000000; // $67,000
        mockPrices[_pairKey("ETH_USDT")] = 3500_00000000;  // $3,500
        mockPrices[_pairKey("BNB_USDT")] = 580_00000000;   // $580
        mockPrices[_pairKey("SOL_USDT")] = 175_00000000;   // $175
    }

    function openPosition(
        bytes32 pair,
        bool isLong,
        uint256 collateralDelta,
        uint256 sizeDelta,
        uint256 /* acceptablePrice */
    ) external returns (bytes32 positionId) {
        require(collateralDelta > 0, "zero collateral");

        // Pull collateral from caller
        usdt.transferFrom(msg.sender, address(this), collateralDelta);

        positionId = keccak256(abi.encodePacked(msg.sender, pair, block.timestamp, _nonce++));

        uint256 price = mockPrices[pair];
        if (price == 0) price = 100_00000000; // fallback $100

        positions[positionId] = Position({
            pair: pair,
            isLong: isLong,
            size: sizeDelta,
            collateral: collateralDelta,
            entryPrice: price,
            openedAt: block.timestamp,
            open: true
        });

        emit PositionOpened(positionId, pair, isLong, sizeDelta, collateralDelta, price);
    }

    function closePosition(
        bytes32 positionId,
        uint256 /* sizeDelta */,
        uint256 /* acceptablePrice */
    ) external returns (int256 pnl) {
        Position storage pos = positions[positionId];
        require(pos.open, "position not open");
        pos.open = false;

        uint256 exitPrice = mockPrices[pos.pair];
        if (exitPrice == 0) exitPrice = pos.entryPrice;

        // Simulate PnL: ±5% based on block timestamp parity (deterministic for demo)
        // In a real scenario this would be based on actual price movement
        bool profitable = (block.timestamp % 3) != 0; // ~67% win rate for demo
        uint256 pnlAbs = pos.collateral * 5 / 100; // 5% of collateral

        if (profitable) {
            pnl = int256(pnlAbs);
            usdt.mint(msg.sender, pos.collateral + pnlAbs);
        } else {
            pnl = -int256(pnlAbs);
            uint256 returnAmount = pos.collateral > pnlAbs ? pos.collateral - pnlAbs : 0;
            if (returnAmount > 0) {
                usdt.transfer(msg.sender, returnAmount);
            }
        }

        emit PositionClosed(positionId, pnl, exitPrice);
    }

    function getPrice(bytes32 pair) external view returns (uint256) {
        uint256 price = mockPrices[pair];
        return price > 0 ? price : 100_00000000;
    }

    function adjustLiquidityDepth(bytes32 /* pair */, uint256 /* depthBps */) external {
        // no-op on testnet — just accepts the call
    }

    function setMockPrice(string calldata pair, uint256 price) external {
        mockPrices[_pairKey(pair)] = price;
    }

    function _pairKey(string memory pair) internal pure returns (bytes32) {
        return keccak256(bytes(pair));
    }
}
