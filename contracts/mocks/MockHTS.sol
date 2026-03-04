// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title MockHTS
 * @notice Mock Hedera Token Service precompile for testing.
 *         Deployed at 0x167 in Hardhat tests.
 *         Always returns SUCCESS (responseCode = 22).
 */
contract MockHTS {
    // HTS SUCCESS response code
    int64 constant SUCCESS = 22;

    /**
     * @notice Mock transferFrom — always returns SUCCESS (22).
     */
    function transferFrom(
        address, /* token */
        address, /* from */
        address, /* to */
        int64    /* amount */
    ) external pure returns (int64) {
        return SUCCESS;
    }

    /**
     * @notice Mock transferToken — always returns SUCCESS (22).
     */
    function transferToken(
        address, /* token */
        address, /* from */
        address, /* to */
        int64    /* amount */
    ) external pure returns (int64) {
        return SUCCESS;
    }
}
