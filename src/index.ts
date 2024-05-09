import * as sdk from "stellar-sdk";

import {
  addLiquiditySoroswapArgs,
  liquidityPoolWithdrawArgs,
  mintTokensArgs,
  paymentArgs,
  removeLiquiditySoroswapArgs,
  TestAccount
} from "./types";

import {
  getCurrentTimePlusOneHour,
  getLiquidityPoolId,
  getNetworkPassphrase,
  hexToByte,
  showErrorResultCodes,
  waitForConfirmation
} from "./utils.ts";

export class TxMaker {
    private horizonServer: sdk.Horizon.Server;
    private sorobanServer: sdk.SorobanRpc.Server;
    private friendbotURI: string;
    private routerContractAddress: string;
    private network: string;

    /**
     * Constructs a new instance of the `TxMaker` class.
     * @param horizonServer The Horizon server URL used for interacting with the Stellar network.
     * @param sorobanServer The Soroban server URL used for interacting with the Soroban network.
     * @param friendbotURI The URI for the friendbot service used for funding test accounts.
     * @param routerContractAddress The address of the router contract.
     * @param network The network used: Standalone or Testnet.
     */

    constructor(
        horizonServer: string,
        sorobanServer: string,
        friendbotURI: string,
        routerContractAddress: string,
        network: string
    ) {
        this.horizonServer = new sdk.Horizon.Server(horizonServer, {
            allowHttp: true
        });
        this.sorobanServer = new sdk.SorobanRpc.Server(sorobanServer, {
            allowHttp: true
        });
        this.friendbotURI = friendbotURI;
        this.routerContractAddress = routerContractAddress;
        this.network = network;
    }

    buildTx(source: sdk.Account, signer: sdk.Keypair, ...ops: sdk.xdr.Operation[]): sdk.Transaction {
        let tx: sdk.TransactionBuilder = new sdk.TransactionBuilder(source, {
            fee: sdk.BASE_FEE,
            networkPassphrase: getNetworkPassphrase(this.network),
        });

        ops.forEach((op) => tx.addOperation(op));

        const txBuilt: sdk.Transaction = tx.setTimeout(30).build();
        txBuilt.sign(signer);

        return txBuilt;
    }

    async fundAccount(account: TestAccount): Promise<void> {
        try {
            const response = await fetch(
                `${this.friendbotURI}${encodeURIComponent(
                    account.publicKey,
                )}`,
            );
            const responseJSON = await response.json();
            if (responseJSON.successful) {
                console.log("SUCCESS! You have a new account :)\n");
            } else {
                if (
                    responseJSON.detail ===
                    "createAccountAlreadyExist (AAAAAAAAAGT/////AAAAAQAAAAAAAAAA/////AAAAAA=)"
                ) {
                    console.log("Account already exists:");
                } else {
                    console.error("ERROR! :(\n", responseJSON);
                }
            }
        } catch (error) {
            console.error("ERROR!", error);
            showErrorResultCodes(error);
        }
    }

    async payment(args: paymentArgs): Promise<sdk.SorobanRpc.Api.GetSuccessfulTransactionResponse | sdk.SorobanRpc.Api.GetFailedTransactionResponse | { status: string; error: any }> {
        const sourceKeypair = sdk.Keypair.fromSecret(args.from.privateKey);
        const source = await this.horizonServer.loadAccount(args.from.publicKey);

        const ops = [
            sdk.Operation.payment({
                amount: args.amount,
                asset: args.asset,
                destination: args.to
            }),
        ];

        let tx = this.buildTx(source, sourceKeypair, ...ops);

        try {
            const submitTransactionResponse = await this.horizonServer.submitTransaction(tx);
            const confirmation = await waitForConfirmation(submitTransactionResponse.hash, this.sorobanServer);
            return confirmation;
        } catch (error) {
            console.error("ERROR!", error);
            showErrorResultCodes(error);
            return { status: "error", error: error };
        }
    }

    async liquidityPoolDeposit(
        source: sdk.Account,
        signer: sdk.Keypair,
        poolId: string,
        maxReserveA: string,
        maxReserveB: string
    ): Promise<any> {
        // Calculate the exact price of the assets
        const exactPrice = Number(maxReserveA) / Number(maxReserveB);

        // Calculate the minimum and maximum price with a 10% deviation
        const minPrice = exactPrice - exactPrice * 0.1;
        const maxPrice = exactPrice + exactPrice * 0.1;

        // Submit the transaction to deposit liquidity into the pool
        try {
            const txRes = await this.horizonServer.submitTransaction(
                this.buildTx(
                    source,
                    signer,
                    sdk.Operation.liquidityPoolDeposit({
                        liquidityPoolId: poolId,
                        maxAmountA: maxReserveA,
                        maxAmountB: maxReserveB,
                        minPrice: minPrice.toFixed(7),
                        maxPrice: maxPrice.toFixed(7),
                    })
                )
            );

            // Wait for confirmation of the transaction
            const confirmation = await waitForConfirmation(txRes.hash, this.sorobanServer);
            return confirmation;
        }catch(error) {
            console.error("ERROR!", error);
            showErrorResultCodes(error);
            return { status: "error", error: error };
        }
    }

    async liquidityPoolWithdraw(args: liquidityPoolWithdrawArgs) {

        const ops = sdk.Operation.liquidityPoolWithdraw({
          liquidityPoolId: getLiquidityPoolId(args.poolAsset),
          amount: args.amount,
          minAmountA: args.minAmountA,
          minAmountB: args.minAmountB,
        })
        const sourceKeypair = sdk.Keypair.fromSecret(args.source.privateKey)
        const source = await this.horizonServer.loadAccount(args.source.publicKey)
        let tx = this.buildTx(source, sourceKeypair, ops)
        try {
          const submitTransactionResponse = await this.horizonServer.submitTransaction(tx)
            const confirmation = await waitForConfirmation(submitTransactionResponse.hash, this.sorobanServer);
          return confirmation
        } catch (error) {
            console.error("ERROR!", error);
            showErrorResultCodes(error);
            return { status: "error", error: error };
        }
      }

    async mintTokens(args: mintTokensArgs): Promise<any> {
        const source = await this.sorobanServer.getAccount(args.source.publicKey);
        const sourceKeypair = sdk.Keypair.fromSecret(args.source.privateKey);
        const mintTokenArgs = [
            new sdk.Address(args.destination).toScVal(),
            sdk.nativeToScVal(Number(args.amount), { type: "i128" }),
        ];
        const op = sdk.Operation.invokeContractFunction({
            contract: args.contractId,
            function: "mint",
            args: mintTokenArgs,
        });

        let tx = this.buildTx(source, sourceKeypair, op);
        const preparedTransaction = await this.sorobanServer.prepareTransaction(tx);
        preparedTransaction.sign(sourceKeypair);
        try {
            const txRes = await this.sorobanServer.sendTransaction(preparedTransaction);
            const confirmation = await waitForConfirmation(txRes.hash, this.sorobanServer);
            return confirmation;
        } catch (error) {
            showErrorResultCodes(error);
            console.log("error:", error);
            return { status: "error", error: error };
        }
    }

    async addLiquiditySoroswap(args: addLiquiditySoroswapArgs): Promise<any> {
        const account = await this.sorobanServer.getAccount(args.source.publicKey);
        const sourceKeypair = sdk.Keypair.fromSecret(args.source.privateKey);

        const routerContract = new sdk.Contract(this.routerContractAddress);

        const scValParams = [
            new sdk.Address(args.tokenA).toScVal(),
            new sdk.Address(args.tokenB).toScVal(),
            sdk.nativeToScVal(Number(args.amountADesired), { type: "i128" }),
            sdk.nativeToScVal(Number(args.amountBDesired), { type: "i128" }),
            sdk.nativeToScVal(Number(args.amountAMin), { type: "i128" }),
            sdk.nativeToScVal(Number(args.amountBMin), { type: "i128" }),
            new sdk.Address(args.to.publicKey).toScVal(),
            sdk.nativeToScVal(getCurrentTimePlusOneHour(), { type: "u64" }),
        ];

        const op = routerContract.call("add_liquidity", ...scValParams);

        const transaction = this.buildTx(account, sourceKeypair, op);

        const preparedTransaction = await this.sorobanServer.prepareTransaction(transaction);
        preparedTransaction.sign(sourceKeypair);

        try {
            const txRes = await this.sorobanServer.sendTransaction(preparedTransaction);
            const confirmation = await waitForConfirmation(txRes.hash, this.sorobanServer);
            return confirmation;
        } catch (error) {
            showErrorResultCodes(error);
            console.error(error);
        }
    }

    async removeLiquiditySoroswap(args: removeLiquiditySoroswapArgs): Promise<any> {
        const source = await this.sorobanServer.getAccount(args.source.publicKey);
        const sourceKeypair = sdk.Keypair.fromSecret(args.source.privateKey);
        const routerContract = new sdk.Contract(this.routerContractAddress);

        const scValParams = [
            new sdk.Address(args.tokenA).toScVal(),
            new sdk.Address(args.tokenB).toScVal(),
            sdk.nativeToScVal(Number(args.liquidity), { type: "i128" }),
            sdk.nativeToScVal(Number(args.amountAMin), { type: "i128" }),
            sdk.nativeToScVal(Number(args.amountBMin), { type: "i128" }),
            new sdk.Address(args.to.publicKey).toScVal(),
            sdk.nativeToScVal(getCurrentTimePlusOneHour(), { type: "u64" }),
        ];

        const op = routerContract.call("remove_liquidity", ...scValParams);
        const transaction = this.buildTx(source, sourceKeypair, op);
        const preparedTransaction = await this.sorobanServer.prepareTransaction(transaction);
        preparedTransaction.sign(sourceKeypair);

        try {
            const txRes = await this.sorobanServer.sendTransaction(preparedTransaction);
            const confirmation = await waitForConfirmation(txRes.hash, this.sorobanServer);
            return confirmation;
        } catch (error) {
            showErrorResultCodes(error);
            console.error(error);
        }
    }

    async swapExactTokensForTokensSoroswap(args: {
        source: TestAccount,
        amountIn: string,
        amountOutMin: string,
        path: string[],
        to: TestAccount
    }): Promise<any> {
        const account = await this.sorobanServer.getAccount(args.source.publicKey);
        const sourceKeypair = sdk.Keypair.fromSecret(args.source.privateKey);

        const routerContract = new sdk.Contract(this.routerContractAddress);
        const path = args.path.map((token) => new sdk.Address(token));
        const scValParams = [
            sdk.nativeToScVal(Number(args.amountIn), { type: "i128" }),
            sdk.nativeToScVal(Number(args.amountOutMin), { type: "i128" }),
            sdk.nativeToScVal(path, { type: "Vec" }),
            new sdk.Address(args.to.publicKey).toScVal(),
            sdk.nativeToScVal(getCurrentTimePlusOneHour(), { type: "u64" }),
        ];

        const op = routerContract.call("swap_exact_tokens_for_tokens", ...scValParams);

        const transaction = this.buildTx(account, sourceKeypair, op);

        const preparedTransaction = await this.sorobanServer.prepareTransaction(transaction);
        preparedTransaction.sign(sourceKeypair);

        try {
            const txRes = await this.sorobanServer.sendTransaction(preparedTransaction);
            const confirmation = await waitForConfirmation(txRes.hash, this.sorobanServer);
            return confirmation;
        } catch (error) {
            showErrorResultCodes(error);
            console.error(error);
        }
    }
}