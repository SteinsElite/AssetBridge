// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract BridgeCtxc {
    address private _administrator;
    address private _operator;
    bool private _paused;

    // fee
    uint256 public feeDeposit;
    uint256 public feeWithdraw;
    uint256 public feebalance;
    // the min value to deposit or withdraw
    uint256 public minValue;

    constructor(address adminAddr, address operatorAddr) {
        _administrator = adminAddr;
        _operator = operatorAddr;
        _paused = false;
        feeDeposit = 0;
        feeWithdraw = 0;
        feebalance = 0;
        minValue = 0;
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
        require(amount >= minValue, "deposit amount too smaller");
        require(msg.value == amount, "Invalid deposit amount");
        uint256 v = msg.value - feeDeposit;
        emit Deposit(msg.sender, to, v);
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
        uint256 v = amount - feeWithdraw;
        to.transfer(v);
        emit Withdraw(to, v);
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

    function updateDepositFee(uint256 newFee) external onlyAdministrator whenPaused {
        require(newFee >=0, "invalid fee");
        feeDeposit = newFee;
    }

    function updateWithdrawFee(uint256 newFee) external onlyAdministrator whenPaused {
        require(newFee >=0, "invalid fee");
        feeWithdraw = newFee;
    }
    function updateMinValue(uint256 newValue) external onlyAdministrator {
        require(newValue >=0, "invalid value");
        minValue = newValue;
    }

    function administrator() external view returns (address) {
        return _administrator;
    }

    function paused() external view returns (bool) {
        return _paused;
    }

    // get the fee to the fee address
    function getFee(address payable feeAddr) external onlyAdministrator {
        require(feebalance > 0, "no fee to withdraw");
        feeAddr.transfer(feebalance);
        feebalance = 0;
    }
}
