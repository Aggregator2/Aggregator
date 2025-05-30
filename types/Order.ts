export interface Order {
  sellToken: string;
  buyToken: string;
  sellAmount: string;
  buyAmount: string;
  validTo: number;
  user: string;
  receiver: string;
  appData: string;
  feeAmount: string;
  partiallyFillable: boolean;
  kind: string;
  signingScheme: string;
  wallet: string;
  nonce: number;
}

export interface SignedOrder extends Order {
  signature: string;
}