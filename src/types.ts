import * as sdk from "stellar-sdk"

export interface addLiquiditySoroswapArgs {
  amountADesired: string;
  amountAMin: string;
  amountBDesired: string;
  amountBMin: string;
  source: TestAccount;
  to: TestAccount;
  tokenA: string;
  tokenB: string;
}

export interface ApiErrorResponse {
  extras: {
    result_codes: {
      operations: string[];
      transaction: string;
    };
  };
}

export interface liquidityPoolWithdrawArgs {
  amount: string;
  minAmountA: string;
  minAmountB: string;
  poolAsset: sdk.LiquidityPoolAsset;
  source: TestAccount;
}

export interface mintTokensArgs {
  amount: string;
  contractId: string;
  destination: string;
  source: TestAccount;
}

export interface paymentArgs {
  amount: string;
  asset: sdk.Asset;
  from: TestAccount;
  to: string;
}

export interface removeLiquiditySoroswapArgs {
  amountAMin: string;
  amountBMin: string;
  liquidity: string;
  source: TestAccount;
  to: TestAccount;
  tokenA: string;
  tokenB: string;
}

export interface TestAccount {
  privateKey: string;
  publicKey: string;
}
