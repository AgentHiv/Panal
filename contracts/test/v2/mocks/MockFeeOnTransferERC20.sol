// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Mock ERC-20 con fee-on-transfer del 5% (quemado) en transfer y transferFrom.
///         Para tests de defensa R-02: el escrow debe contabilizar lo realmente recibido.
contract MockFeeOnTransferERC20 {
    string public constant name = "FeeToken";
    string public constant symbol = "FEE";
    uint8 public constant decimals = 18;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 amount);
    event Approval(address indexed owner, address indexed spender, uint256 amount);

    function mint(address to, uint256 amount) external {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _move(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= amount, "MockFeeOnTransfer: insufficient allowance");
        allowance[from][msg.sender] = allowed - amount;
        _move(from, to, amount);
        return true;
    }

    function _move(address from, address to, uint256 amount) internal {
        require(balanceOf[from] >= amount, "MockFeeOnTransfer: insufficient balance");
        uint256 fee = amount / 20; // 5% quemado
        balanceOf[from] -= amount;
        balanceOf[to] += amount - fee;
        totalSupply -= fee;
        emit Transfer(from, to, amount - fee);
    }
}

/// @notice Token que da callback a un atacante durante transferFrom (test R-03).
contract MockCallbackERC20 {
    uint8 public constant decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    address public callbackTarget;
    bool public inCallback;

    function setCallbackTarget(address target) external {
        callbackTarget = target;
    }

    function mint(address to, uint256 amount) external {
        totalSupply += amount;
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "MockCallback: insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= amount && balanceOf[from] >= amount, "MockCallback: insufficient");
        allowance[from][msg.sender] = allowed - amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        if (!inCallback && callbackTarget != address(0)) {
            inCallback = true;
            (bool ok, bytes memory data) =
                callbackTarget.call(abi.encodeWithSignature("onTokenCallback(address,uint256)", address(this), amount));
            if (!ok) {
                assembly {
                    revert(add(data, 32), mload(data))
                }
            }
        }
        return true;
    }
}
