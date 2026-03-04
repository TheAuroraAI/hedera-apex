// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockHACPToken
 * @notice ERC20 mock for the HACP token in Hardhat tests.
 *         Minting is public for test convenience.
 */
contract MockHACPToken is ERC20 {
    constructor() ERC20("HACP Token", "HACP") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
