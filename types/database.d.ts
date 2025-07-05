// Type declarations for database modules

export interface QueryResult<T = any> {
  rows: T[];
  rowCount: number;
  command: string;
  fields: any[];
}

export interface PoolClient {
  query: (text: string, params?: any[]) => Promise<QueryResult>;
  release: () => void;
}

export interface TransactionClient extends PoolClient {
  query: (text: string, params?: any[]) => Promise<QueryResult>;
}

export interface Database {
  query: <T = any>(text: string, params?: any[]) => Promise<T[]>;
  queryOne: <T = any>(text: string, params?: any[]) => Promise<T | null>;
  transaction: <T>(callback: (client: TransactionClient) => Promise<T>) => Promise<T>;
}