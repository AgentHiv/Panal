// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/v2/PanalPayments.sol";

/// @notice Despliega PanalPayments, el raíl de cobro por llamada (x402).
///
/// Tres cosas se fijan aquí y conviene entenderlas antes de firmar:
///
///   1. `PANAL_TOKEN` es INMUTABLE. Apuntar al token equivocado no se arregla:
///      hay que desplegar otro contrato. El script comprueba que la dirección
///      tenga código y que responda a `DOMAIN_SEPARATOR()`, porque sin soporte
///      de EIP-2612 el flujo `permitAndPay` no funcionaría y el fallo solo se
///      vería con el primer pago real.
///   2. `treasury` y `feeBps` SÍ se pueden cambiar luego, pero solo el owner, y
///      `feeBps` nunca por encima de `MAX_FEE_BPS` (2,5 %), que es constante.
///   3. **El owner es quien despliega.** A diferencia del multisig —donde el
///      deployer no se quedaba con nada—, aquí `msg.sender` hereda `setFeeBps`,
///      `setTreasury` y `transferOwnership`. Si vas a desplegar desde una
///      wallet desechable, define `OWNER` para cederlo en la misma ejecución.
///
/// Uso:
///   PRIVATE_KEY=0x… TREASURY=0x… FEE_BPS=250 \
///     forge script script/DeployPayments.s.sol --rpc-url $RPC --broadcast
///
/// Opcionales:
///   PANAL_TOKEN  por defecto el $PANAL de mainnet
///   OWNER        si se define, se transfiere la propiedad tras desplegar
contract DeployPayments is Script {
    address constant PANAL_MAINNET = 0x2E2e44E7FA6178822D4397299F719e89d1a67777;

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address token = vm.envOr("PANAL_TOKEN", PANAL_MAINNET);
        address treasury = vm.envAddress("TREASURY");
        uint256 feeBps = vm.envOr("FEE_BPS", uint256(250));
        address newOwner = vm.envOr("OWNER", address(0));

        require(token.code.length > 0, "El token no tiene codigo en esta red");
        require(treasury != address(0), "TREASURY no puede ser la direccion cero");
        require(feeBps <= 250, "FEE_BPS por encima del tope inmutable (250 = 2,5%)");

        // Sin permit, `permitAndPay` no sirve y el primer pago de cada cliente
        // exigiria un approve aparte. Mejor enterarse ahora que en produccion.
        (bool ok, ) = token.staticcall(abi.encodeWithSignature("DOMAIN_SEPARATOR()"));
        require(ok, "El token no expone DOMAIN_SEPARATOR(): no soporta EIP-2612");

        console.log("Deployer (sera el owner):", deployer);
        console.log("Token $PANAL:", token);
        console.log("Treasury (cobra la comision):", treasury);
        console.log("Comision inicial (bps):", feeBps);

        vm.startBroadcast(deployerKey);
        PanalPayments payments = new PanalPayments(token, treasury, feeBps);
        if (newOwner != address(0) && newOwner != deployer) {
            payments.transferOwnership(newOwner);
            console.log("Propiedad transferida a:", newOwner);
        }
        vm.stopBroadcast();

        console.log("PanalPayments:", address(payments));
        console.log("Owner final:", payments.owner());
        console.log("");
        console.log("Comprueba antes de cablear nada:");
        console.log("  cast call <ADDR> \"PANAL_TOKEN()(address)\" --rpc-url $RPC");
        console.log("  cast call <ADDR> \"treasury()(address)\" --rpc-url $RPC");
        console.log("  cast call <ADDR> \"feeBps()(uint256)\" --rpc-url $RPC");
        console.log("  cast call <ADDR> \"MAX_FEE_BPS()(uint256)\" --rpc-url $RPC");
    }
}
