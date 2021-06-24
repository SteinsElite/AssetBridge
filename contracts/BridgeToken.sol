// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import "./lib/ERC20.sol";

contract BridgeToken is ERC20 {
    // bridge destination contract is the only administrator could directly mint and burn the ZTXC
    // it should be immutable due to the bridge will not update
    address private _admin;

    constructor(string memory name_, string memory symbol_)
        ERC20(name_, symbol_)
    {
        _admin = msg.sender;
    }

    modifier onlyAdmin() {
        require(_admin == msg.sender, " caller is not the administrator");
        _;
    }

    function mint(address to, uint256 amount) external onlyAdmin {
        _mint(to, amount);
    }

    function burn(address to, uint256 amount) external onlyAdmin {
        _burn(to, amount);
    }

    function admin() external view returns (address) {
        return _admin;
    }
}
