export interface Quote {
  sellToken: string;
  buyToken: string;
  sellAmount: string;
  buyAmount: string;
  validTo: number;
  nonce: number;
  maker: string;
}