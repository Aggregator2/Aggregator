import { RequestClient } from '../utils/request';
import { 
  Settlement, 
  SettlementProof, 
  SettlementStatus,
  PaginatedResponse, 
  ApiResponse 
} from '../types';
import { ValidationError } from '../types/errors';

export class SettlementsAPI {
  constructor(private client: RequestClient) {}

  /**
   * Get user's settlements
   */
  async list(filter?: {
    status?: SettlementStatus;
    currency?: string;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
    offset?: number;
  }): Promise<PaginatedResponse<Settlement>> {
    const response = await this.client.get<PaginatedResponse<Settlement>>(
      '/settlements',
      filter
    );

    return {
      ...response,
      data: response.data.map(settlement => this.parseSettlement(settlement))
    };
  }

  /**
   * Get settlement by ID
   */
  async get(settlementId: string): Promise<Settlement> {
    if (!settlementId) {
      throw new ValidationError('Settlement ID is required');
    }

    const response = await this.client.get<ApiResponse<Settlement>>(
      `/settlements/${settlementId}`
    );
    
    return this.parseSettlement(response.data);
  }

  /**
   * Get settlement proof
   */
  async getProof(settlementId: string): Promise<SettlementProof> {
    if (!settlementId) {
      throw new ValidationError('Settlement ID is required');
    }

    const response = await this.client.get<ApiResponse<SettlementProof>>(
      `/settlements/${settlementId}/proof`
    );

    return response.data;
  }

  /**
   * Verify settlement proof
   */
  async verifyProof(proof: SettlementProof): Promise<{
    valid: boolean;
    merkleRoot: string;
    leafHash: string;
    onChainVerified?: boolean;
    blockNumber?: number;
    txHash?: string;
  }> {
    const response = await this.client.post<ApiResponse<any>>(
      '/settlements/verify-proof',
      proof
    );

    return response.data;
  }

  /**
   * Get pending settlement balance
   */
  async getPendingBalance(currency?: string): Promise<{
    balances: Array<{
      currency: string;
      amount: string;
      lastUpdate: Date;
    }>;
    totalUsdValue: string;
  }> {
    const response = await this.client.get<ApiResponse<any>>(
      '/settlements/pending',
      currency ? { currency } : undefined
    );

    return {
      ...response.data,
      balances: response.data.balances.map((b: any) => ({
        ...b,
        lastUpdate: new Date(b.lastUpdate)
      }))
    };
  }

  /**
   * Get settlement history statistics
   */
  async getStats(filter?: {
    currency?: string;
    startDate?: Date;
    endDate?: Date;
  }): Promise<{
    totalSettled: string;
    totalSettlements: number;
    averageSettlementTime: number;
    successRate: string;
    byCurrency: Record<string, {
      amount: string;
      count: number;
    }>;
  }> {
    const response = await this.client.get<ApiResponse<any>>(
      '/settlements/stats',
      filter
    );

    return response.data;
  }

  /**
   * Request manual settlement (if enabled)
   */
  async requestSettlement(currency: string): Promise<{
    message: string;
    estimatedTime: string;
    minimumAmount?: string;
  }> {
    if (!currency) {
      throw new ValidationError('Currency is required');
    }

    const response = await this.client.post<ApiResponse<any>>(
      '/settlements/request',
      { currency }
    );

    return response.data;
  }

  /**
   * Get settlement configuration
   */
  async getConfig(): Promise<{
    settlementInterval: string;
    supportedCurrencies: string[];
    minimumAmounts: Record<string, string>;
    settlementSchedule: Array<{
      currency: string;
      nextSettlement: Date;
    }>;
  }> {
    const response = await this.client.get<ApiResponse<any>>('/settlements/config');

    return {
      ...response.data,
      settlementSchedule: response.data.settlementSchedule.map((s: any) => ({
        ...s,
        nextSettlement: new Date(s.nextSettlement)
      }))
    };
  }

  /**
   * Parse settlement from API response
   */
  private parseSettlement(settlement: any): Settlement {
    return {
      ...settlement,
      createdAt: new Date(settlement.createdAt),
      completedAt: settlement.completedAt ? new Date(settlement.completedAt) : undefined
    };
  }
}