// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract BridgeCtxc {
    address private _administrator;
    address private _operator;
    bool private _paused;

    constructor(address adminAddr, address operatorAddr) {
        _administrator = adminAddr;
        _operator = operatorAddr;
        _paused = false;
    }

    /**
     * @dev Throws if called by any account other than the administrator.
     */
    modifier onlyAdministrator() {
        require(
            _administrator == msg.sender,
            "caller is not the administrator"
        );
        _;
    }

    modifier onlyOperator() {
        require(_operator == msg.sender, "caller is not the operator");
        _;
    }

    /**
     * @dev Modifier to make a function callable only when the contract is not paused.
     *
     * Requirements:
     *
     * - The contract must not be paused.
     */
    modifier whenNotPaused() {
        require(!_paused, "Pausable: paused");
        _;
    }

    /**
     * @dev Modifier to make a function callable only when the contract is paused.
     *
     * Requirements:
     *
     * - The contract must be paused.
     */
    modifier whenPaused() {
        require(_paused, "Pauable: not paused");
        _;
    }

    /**
     * @dev Emmitted when the pause is triggered by `account`
     */
    event Paused(address account);

    /**
     * @dev Emmitted when the pause is lifted by `account`
     */
    event Unpasued(address account);

    event Deposit(address indexed from, address to, uint256 amount);
    event Withdraw(address indexed to, uint256 amount);
    event AdminChanged(address oldAddress, address newAddress);
    event OperatorChanged(address oldAddress, address newAddress);

    /**
     * @dev             deposit nativeToken(CTXC) into the contract
     * @param to        destination address on other chain
     * @param amount    value of transference
     */
    function deposit(address to, uint256 amount) public payable whenNotPaused {
        require(msg.value == amount, "Invalid deposit amount");
        emit Deposit(msg.sender, to, msg.value);
    }

    // withdraw nativaToken(CTXC) according to the information from the other chain. Called by the relayers.
    /**
     * @param to          bytes representation of destination address
     * @param amount      value of transference
     */
    function withdraw(address payable to, uint256 amount)
        public
        onlyOperator
        whenNotPaused
    {
        require(address(this).balance >= amount, "not enough nativa token");
        to.transfer(amount);
        emit Withdraw(to, amount);
    }

    function pause() public onlyAdministrator whenNotPaused {
        _paused = true;
        emit Paused(msg.sender);
    }

    function unpause() public onlyAdministrator whenPaused {
        _paused = false;
        emit Unpasued(msg.sender);
    }

    /**
     * @dev Transfers administration authority of the contract to a new account (`newAdministrator`).
     * Can only be called by the current administrator when paused.
     */
    function changeAdmin(address newAdministratorAddr)
        public
        virtual
        onlyAdministrator
        whenPaused
    {
        require(
            newAdministratorAddr != address(0),
            "new administrator is the zero address"
        );
        address oldAdmin = _administrator;
        _administrator = newAdministratorAddr;
        emit AdminChanged(oldAdmin, _administrator);
    }

    function changeOperator(address newOperatorAddr)
        external
        onlyAdministrator
        whenPaused
    {
        require(
            newOperatorAddr != address(0),
            "new relayer is the zero address"
        );
        address oldOperator = _operator;
        _operator = newOperatorAddr;
        emit OperatorChanged(oldOperator, _operator);
    }

    function administrator() external view returns (address) {
        return _administrator;
    }

    function paused() external view returns (bool) {
        return _paused;
    }
}
