declare module 'tronweb' {
  interface TronWebConfig {
    fullHost?: string;
    headers?: Record<string, string>;
    privateKey?: string;
  }

  interface Contract {
    [key: string]: any;
  }

  interface Trx {
    getContract(address: string): Promise<Contract>;
    getBalance(address: string): Promise<number>;
    getAccount(address: string): Promise<any>;
    sign(transaction: any, privateKey?: string): Promise<any>;
    sendRawTransaction(signedTransaction: any): Promise<any>;
    getTransactionInfo(txId: string): Promise<any>;
  }

  interface Utils {
    isAddress(address: string): boolean;
    fromSun(amount: number | string): string;
    toSun(amount: number | string): string;
    crypto: {
      generateAccount(): { address: { base58: string; hex: string }; privateKey: string; publicKey: string };
    };
  }

  interface HttpProvider {
    new (url: string): any;
  }

  interface Providers {
    HttpProvider: HttpProvider;
  }

  class TronWeb {
    constructor(fullNode: any, solidityNode: any, eventServer: any, privateKey?: string);
    constructor(config: TronWebConfig);
    trx: Trx;
    utils: Utils;
    isConnected(): boolean;
    setAddress(address: string): void;
    static isAddress(address: string): boolean;
    static providers: Providers;
  }

  export = TronWeb;
}