// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./BridgeToken.sol";

contract BridgeHeco {
    address private _admin;
    address private _relayer;
    bool private _paused;
    BridgeToken private _htxc;

    constructor(address adminAddr, address operatorAddr) {
        _admin = adminAddr;
        _relayer = operatorAddr;
        _htxc = new BridgeToken("HTXC", "HTXC");
        _paused = false;
    }

    /**
     * @dev Throws if called by any account other than the administrator.
     */
    modifier onlyAdministrator() {
        require(_admin == msg.sender, "caller is not the administrator");
        _;
    }

    modifier onlyOperator() {
        require(_relayer == msg.sender, "caller is not the operator");
        _;
    }

    modifier whenNotPaused() {
        require(!_paused, "pasuable: paused");
        _;
    }

    modifier whenPaused() {
        require(_paused, "pauable: unpaused");
        _;
    }

    event Deposit(address indexed from, address to, uint256 amount);
    event Withdraw(address indexed to, uint256 amount);
    event ChangeAdmin(address oldAddress, address newAddress);
    event Paused(address account);
    event Unpasued(address account);

    function depositToken(address to, uint256 amount) public whenNotPaused {
        require(
            _htxc.balanceOf(msg.sender) >= amount,
            "now enough token to deposit"
        );
        _htxc.burn(msg.sender, amount);
        emit Deposit(msg.sender, to, amount);
    }

    function withdrawToken(address to, uint256 amount)
        external
        onlyOperator
        whenNotPaused
    {
        _htxc.mint(to, amount);
        emit Withdraw(to, amount);
    }

    /**
     * @dev Transfers administration authority of the contract to a new account (`newAdministrator`).
     * Can only be called by the current administrator when paused.
     */
    function changeAdmin(address newAdminAddr)
        public
        onlyAdministrator
        whenPaused
    {
        require(
            newAdminAddr != address(0),
            "new administrator is the zero address"
        );
        address oldAdmin = _admin;
        _admin = newAdminAddr;
        emit ChangeAdmin(oldAdmin, _admin);
    }

    function changeOperator(address newOperatorAddr)
        external
        onlyAdministrator
        whenNotPaused
    {
        require(
            newOperatorAddr != address(0),
            "new operator is the zero address"
        );
        _relayer = newOperatorAddr;
    }

    function administrator() external view returns (address) {
        return _admin;
    }

    function pause() public onlyAdministrator whenNotPaused {
        _paused = true;
        emit Paused(msg.sender);
    }

    function unpause() public onlyAdministrator whenPaused {
        _paused = false;
        emit Unpasued(msg.sender);
    }

    function tokenAddress() external view returns (address) {
        return address(_htxc);
    }

    function paused() external view returns (bool) {
        return _paused;
    }
}
