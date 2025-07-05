import {
  KYCProvider,
  KYCVerificationResult,
  KYCStatus,
  DocumentType,
  KYCData
} from '../types';

/**
 * Mock KYC Provider for testing
 * In production, this would integrate with services like:
 * - Jumio
 * - Onfido
 * - Sumsub
 * - Persona
 */
export class MockKYCProvider implements KYCProvider {
  name = 'MockKYC';
  private verifications: Map<string, KYCVerificationResult> = new Map();

  async verify(data: Partial<KYCData>): Promise<KYCVerificationResult> {
    // Simulate API call delay
    await new Promise(resolve => setTimeout(resolve, 1000));

    const refId = `MOCK_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Mock verification logic
    let status: KYCStatus;
    let riskScore: number;

    if (!data.personalInfo) {
      status = KYCStatus.REJECTED;
      riskScore = 0;
    } else {
      // Simulate different outcomes
      const random = Math.random();
      if (random < 0.8) {
        status = KYCStatus.APPROVED;
        riskScore = Math.floor(Math.random() * 30); // Low risk
      } else if (random < 0.95) {
        status = KYCStatus.IN_REVIEW;
        riskScore = Math.floor(Math.random() * 50) + 30; // Medium risk
      } else {
        status = KYCStatus.REJECTED;
        riskScore = Math.floor(Math.random() * 30) + 70; // High risk
      }
    }

    const result: KYCVerificationResult = {
      status,
      refId,
      riskScore,
      details: {
        provider: this.name,
        timestamp: new Date().toISOString(),
        checks: {
          identity: status === KYCStatus.APPROVED,
          address: status === KYCStatus.APPROVED,
          age: true,
          sanctions: status !== KYCStatus.REJECTED
        }
      }
    };

    this.verifications.set(refId, result);
    return result;
  }

  async getStatus(refId: string): Promise<KYCStatus> {
    const verification = this.verifications.get(refId);
    if (!verification) {
      throw new Error('Verification not found');
    }

    // Simulate status updates for IN_REVIEW
    if (verification.status === KYCStatus.IN_REVIEW) {
      const random = Math.random();
      if (random < 0.7) {
        verification.status = KYCStatus.APPROVED;
      } else if (random < 0.9) {
        verification.status = KYCStatus.REJECTED;
      }
      // 10% remain in review
    }

    return verification.status;
  }

  async uploadDocument(
    userId: string,
    document: Buffer,
    type: DocumentType
  ): Promise<string> {
    // Simulate document upload
    await new Promise(resolve => setTimeout(resolve, 500));
    
    const documentId = `DOC_${Date.now()}_${type}`;
    
    // In real implementation, would upload to secure storage
    console.log(`Mock: Uploaded ${type} document for user ${userId}, size: ${document.length} bytes`);
    
    return documentId;
  }
}

/**
 * Example real provider implementation skeleton
 */
export class OnfidoKYCProvider implements KYCProvider {
  name = 'Onfido';
  private apiKey: string;
  private apiUrl: string;

  constructor(apiKey: string, sandbox: boolean = false) {
    this.apiKey = apiKey;
    this.apiUrl = sandbox 
      ? 'https://api.sandbox.onfido.com/v3' 
      : 'https://api.onfido.com/v3';
  }

  async verify(data: Partial<KYCData>): Promise<KYCVerificationResult> {
    // Real implementation would:
    // 1. Create applicant
    // 2. Upload documents
    // 3. Create check
    // 4. Return results

    throw new Error('Not implemented - example only');
  }

  async getStatus(refId: string): Promise<KYCStatus> {
    // Real implementation would query Onfido API
    throw new Error('Not implemented - example only');
  }

  async uploadDocument(
    userId: string,
    document: Buffer,
    type: DocumentType
  ): Promise<string> {
    // Real implementation would upload to Onfido
    throw new Error('Not implemented - example only');
  }
}