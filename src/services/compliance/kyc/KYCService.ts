import { EventEmitter } from 'events';
import {
  KYCData,
  KYCStatus,
  KYCLevel,
  KYCProvider,
  KYCVerificationResult,
  DocumentType,
  PersonalInfo,
  BusinessInfo
} from '../types';

export interface KYCServiceConfig {
  providers: KYCProvider[];
  requiredLevel: KYCLevel;
  expirationDays: number;
  autoRecheck: boolean;
  webhookUrl?: string;
}

export class KYCService extends EventEmitter {
  private providers: Map<string, KYCProvider> = new Map();
  private kycData: Map<string, KYCData> = new Map();
  private config: KYCServiceConfig;

  constructor(config: KYCServiceConfig) {
    super();
    this.config = config;
    config.providers.forEach(provider => {
      this.providers.set(provider.name, provider);
    });
  }

  async initiateKYC(
    userId: string,
    level: KYCLevel,
    personalInfo?: PersonalInfo,
    businessInfo?: BusinessInfo
  ): Promise<KYCData> {
    const existingKYC = this.kycData.get(userId);
    
    if (existingKYC && existingKYC.status === KYCStatus.APPROVED) {
      if (!this.isExpired(existingKYC)) {
        return existingKYC;
      }
    }

    const kycData: KYCData = {
      userId,
      status: KYCStatus.PENDING,
      level,
      submittedAt: new Date(),
      documents: [],
      personalInfo,
      businessInfo
    };

    this.kycData.set(userId, kycData);
    this.emit('kyc:initiated', { userId, level });

    // Auto-verify if using primary provider
    if (this.providers.size > 0 && (personalInfo || businessInfo)) {
      const primaryProvider = Array.from(this.providers.values())[0];
      await this.verifyWithProvider(userId, primaryProvider.name);
    }

    return kycData;
  }

  async verifyWithProvider(userId: string, providerName: string): Promise<KYCVerificationResult> {
    const kycData = this.kycData.get(userId);
    if (!kycData) {
      throw new Error('KYC not initiated for user');
    }

    const provider = this.providers.get(providerName);
    if (!provider) {
      throw new Error(`Provider ${providerName} not found`);
    }

    kycData.status = KYCStatus.IN_REVIEW;
    kycData.provider = providerName;

    try {
      const result = await provider.verify(kycData);
      
      kycData.status = result.status;
      kycData.providerRefId = result.refId;
      kycData.riskScore = result.riskScore;

      if (result.status === KYCStatus.APPROVED) {
        kycData.verifiedAt = new Date();
        kycData.expiresAt = new Date(
          Date.now() + this.config.expirationDays * 24 * 60 * 60 * 1000
        );
        this.emit('kyc:approved', { userId, provider: providerName });
      } else if (result.status === KYCStatus.REJECTED) {
        kycData.rejectionReason = result.details?.reason;
        this.emit('kyc:rejected', { userId, reason: kycData.rejectionReason });
      }

      this.kycData.set(userId, kycData);
      return result;
    } catch (error) {
      kycData.status = KYCStatus.PENDING;
      this.emit('kyc:error', { userId, error: error.message });
      throw error;
    }
  }

  async uploadDocument(
    userId: string,
    document: Buffer,
    type: DocumentType
  ): Promise<string> {
    const kycData = this.kycData.get(userId);
    if (!kycData) {
      throw new Error('KYC not initiated for user');
    }

    if (!kycData.provider) {
      throw new Error('No KYC provider selected');
    }

    const provider = this.providers.get(kycData.provider);
    if (!provider) {
      throw new Error('Provider not available');
    }

    const documentId = await provider.uploadDocument(userId, document, type);

    kycData.documents.push({
      type,
      status: 'PENDING',
      uploadedAt: new Date(),
      documentId
    });

    this.kycData.set(userId, kycData);
    this.emit('kyc:document:uploaded', { userId, type, documentId });

    return documentId;
  }

  async checkStatus(userId: string): Promise<KYCData | null> {
    const kycData = this.kycData.get(userId);
    if (!kycData) {
      return null;
    }

    // Update status from provider if in review
    if (kycData.status === KYCStatus.IN_REVIEW && kycData.provider && kycData.providerRefId) {
      const provider = this.providers.get(kycData.provider);
      if (provider) {
        try {
          const status = await provider.getStatus(kycData.providerRefId);
          if (status !== kycData.status) {
            kycData.status = status;
            this.kycData.set(userId, kycData);
            this.emit('kyc:status:changed', { userId, status });
          }
        } catch (error) {
          console.error('Error checking KYC status:', error);
        }
      }
    }

    return kycData;
  }

  isVerified(userId: string, requiredLevel?: KYCLevel): boolean {
    const kycData = this.kycData.get(userId);
    if (!kycData) return false;

    const level = requiredLevel || this.config.requiredLevel;
    
    return (
      kycData.status === KYCStatus.APPROVED &&
      this.compareLevels(kycData.level, level) >= 0 &&
      !this.isExpired(kycData)
    );
  }

  private isExpired(kycData: KYCData): boolean {
    if (!kycData.expiresAt) return false;
    return kycData.expiresAt < new Date();
  }

  private compareLevels(level1: KYCLevel, level2: KYCLevel): number {
    const levels = [KYCLevel.BASIC, KYCLevel.STANDARD, KYCLevel.ENHANCED, KYCLevel.INSTITUTIONAL];
    return levels.indexOf(level1) - levels.indexOf(level2);
  }

  async requireKYC(userId: string, level: KYCLevel): Promise<void> {
    if (!this.isVerified(userId, level)) {
      throw new Error(`KYC level ${level} required for this operation`);
    }
  }

  getKYCData(userId: string): KYCData | null {
    return this.kycData.get(userId) || null;
  }

  async bulkCheck(userIds: string[]): Promise<Map<string, KYCData | null>> {
    const results = new Map<string, KYCData | null>();
    
    for (const userId of userIds) {
      results.set(userId, await this.checkStatus(userId));
    }
    
    return results;
  }

  // Admin functions
  async overrideStatus(userId: string, status: KYCStatus, reason?: string): Promise<void> {
    const kycData = this.kycData.get(userId);
    if (!kycData) {
      throw new Error('KYC not found for user');
    }

    const previousStatus = kycData.status;
    kycData.status = status;
    
    if (status === KYCStatus.APPROVED) {
      kycData.verifiedAt = new Date();
      kycData.expiresAt = new Date(
        Date.now() + this.config.expirationDays * 24 * 60 * 60 * 1000
      );
    } else if (status === KYCStatus.REJECTED || status === KYCStatus.SUSPENDED) {
      kycData.rejectionReason = reason;
    }

    this.kycData.set(userId, kycData);
    this.emit('kyc:admin:override', { userId, previousStatus, newStatus: status, reason });
  }

  // Webhook handler for provider updates
  async handleWebhook(payload: any): Promise<void> {
    // Implementation depends on provider webhook format
    this.emit('kyc:webhook', payload);
  }
}