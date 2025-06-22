export interface Quote {
  userAddress: string;
  quoteId: number;
  content: string;
  sellToken: string;
  buyToken: string;
  sellAmount: string;
  buyAmount: string;
  validTo: number;
  maker: string;
}