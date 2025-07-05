import {
  AMLProvider,
  AMLCheck,
  AMLCheckType,
  AMLCheckStatus,
  AMLHit,
  TransactionData
} from '../types';

/**
 * Mock AML Provider for testing
 * In production, this would integrate with services like:
 * - ComplyAdvantage
 * - LexisNexis
 * - Refinitiv World-Check
 * - Dow Jones Risk & Compliance
 */
export class MockAMLProvider implements AMLProvider {
  name = 'MockAML';
  
  // Simulated sanctions list
  private sanctionsList = [
    'John Sanctioned',
    'Evil Corp',
    'Bad Actor LLC',
    'Sanctioned Bank'
  ];

  // Simulated PEP list
  private pepList = [
    'Political Figure',
    'Government Official',
    'High Risk Person'
  ];

  async checkSanctions(name: string, country?: string): Promise<AMLCheck> {
    // Simulate API call delay
    await new Promise(resolve => setTimeout(resolve, 500));

    const hits: AMLHit[] = [];
    const normalizedName = name.toLowerCase();

    // Check against sanctions list
    for (const sanctioned of this.sanctionsList) {
      if (this.fuzzyMatch(normalizedName, sanctioned.toLowerCase())) {
        hits.push({
          source: 'OFAC',
          matchScore: this.calculateMatchScore(normalizedName, sanctioned.toLowerCase()),
          matchedName: sanctioned,
          reason: 'Name appears on sanctions list',
          details: {
            listType: 'SDN',
            country: country || 'UNKNOWN',
            addedDate: '2023-01-01'
          },
          severity: 'CRITICAL'
        });
      }
    }

    // Simulate false positives
    if (Math.random() < 0.05) { // 5% false positive rate
      hits.push({
        source: 'UN_SANCTIONS',
        matchScore: 65,
        matchedName: name + ' (Similar)',
        reason: 'Potential name match',
        details: {
          listType: 'UN Consolidated',
          similarity: 'phonetic'
        },
        severity: 'MEDIUM'
      });
    }

    const check: AMLCheck = {
      userId: '',
      checkId: `CHK_${Date.now()}`,
      timestamp: new Date(),
      type: AMLCheckType.SANCTIONS,
      status: this.determineStatus(hits),
      riskScore: this.calculateRiskScore(hits),
      hits
    };

    return check;
  }

  async checkPEP(name: string): Promise<AMLCheck> {
    await new Promise(resolve => setTimeout(resolve, 300));

    const hits: AMLHit[] = [];
    const normalizedName = name.toLowerCase();

    // Check against PEP list
    for (const pep of this.pepList) {
      if (this.fuzzyMatch(normalizedName, pep.toLowerCase())) {
        hits.push({
          source: 'PEP_DATABASE',
          matchScore: this.calculateMatchScore(normalizedName, pep.toLowerCase()),
          matchedName: pep,
          reason: 'Politically Exposed Person',
          details: {
            position: 'Government Official',
            country: 'US',
            since: '2020-01-01'
          },
          severity: 'HIGH'
        });
      }
    }

    const check: AMLCheck = {
      userId: '',
      checkId: `CHK_${Date.now()}`,
      timestamp: new Date(),
      type: AMLCheckType.PEP,
      status: this.determineStatus(hits),
      riskScore: this.calculateRiskScore(hits),
      hits
    };

    return check;
  }

  async monitorTransaction(transaction: TransactionData): Promise<AMLCheck> {
    await new Promise(resolve => setTimeout(resolve, 200));

    const hits: AMLHit[] = [];
    const amount = parseFloat(transaction.amount);

    // Check for suspicious patterns
    if (amount > 9999 && amount < 10000) {
      hits.push({
        source: 'TRANSACTION_MONITORING',
        matchScore: 90,
        matchedName: transaction.userId,
        reason: 'Potential structuring - amount just below reporting threshold',
        details: {
          amount: transaction.amount,
          threshold: '10000',
          pattern: 'STRUCTURING'
        },
        severity: 'HIGH'
      });
    }

    // Check for rapid movement
    if (transaction.type === 'WITHDRAWAL' && amount > 50000) {
      hits.push({
        source: 'TRANSACTION_MONITORING',
        matchScore: 75,
        matchedName: transaction.userId,
        reason: 'Large withdrawal detected',
        details: {
          amount: transaction.amount,
          type: transaction.type
        },
        severity: 'MEDIUM'
      });
    }

    const check: AMLCheck = {
      userId: transaction.userId,
      checkId: `CHK_${Date.now()}`,
      timestamp: new Date(),
      type: AMLCheckType.TRANSACTION_MONITORING,
      status: this.determineStatus(hits),
      riskScore: this.calculateRiskScore(hits),
      hits
    };

    return check;
  }

  async batchCheck(entities: string[]): Promise<AMLCheck[]> {
    const results: AMLCheck[] = [];
    
    // Process in parallel with rate limiting
    const batchSize = 10;
    for (let i = 0; i < entities.length; i += batchSize) {
      const batch = entities.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(entity => this.checkSanctions(entity))
      );
      results.push(...batchResults);
    }
    
    return results;
  }

  private fuzzyMatch(str1: string, str2: string): boolean {
    // Simple fuzzy matching
    if (str1 === str2) return true;
    if (str1.includes(str2) || str2.includes(str1)) return true;
    
    // Check for common variations
    const variations1 = this.generateVariations(str1);
    const variations2 = this.generateVariations(str2);
    
    for (const v1 of variations1) {
      for (const v2 of variations2) {
        if (v1 === v2) return true;
      }
    }
    
    return false;
  }

  private generateVariations(name: string): string[] {
    const variations = [name];
    
    // Remove common suffixes
    variations.push(name.replace(/ (inc|llc|ltd|corp|company)$/i, ''));
    
    // Remove special characters
    variations.push(name.replace(/[^a-z0-9 ]/gi, ''));
    
    return variations;
  }

  private calculateMatchScore(str1: string, str2: string): number {
    if (str1 === str2) return 100;
    
    // Levenshtein distance based scoring
    const maxLen = Math.max(str1.length, str2.length);
    const distance = this.levenshteinDistance(str1, str2);
    
    return Math.round((1 - distance / maxLen) * 100);
  }

  private levenshteinDistance(str1: string, str2: string): number {
    const matrix: number[][] = [];
    
    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }
    
    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }
    
    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }
    
    return matrix[str2.length][str1.length];
  }

  private determineStatus(hits: AMLHit[]): AMLCheckStatus {
    if (hits.length === 0) return AMLCheckStatus.CLEAR;
    
    const hasCritical = hits.some(h => h.severity === 'CRITICAL');
    const hasHigh = hits.some(h => h.severity === 'HIGH');
    
    if (hasCritical) return AMLCheckStatus.BLOCKED;
    if (hasHigh) return AMLCheckStatus.FLAGGED;
    if (hits.length > 0) return AMLCheckStatus.PENDING_REVIEW;
    
    return AMLCheckStatus.CLEAR;
  }

  private calculateRiskScore(hits: AMLHit[]): number {
    if (hits.length === 0) return 0;
    
    let maxScore = 0;
    
    for (const hit of hits) {
      const severityMultiplier = {
        LOW: 0.25,
        MEDIUM: 0.5,
        HIGH: 0.75,
        CRITICAL: 1
      }[hit.severity];
      
      const score = hit.matchScore * severityMultiplier;
      maxScore = Math.max(maxScore, score);
    }
    
    return Math.round(maxScore);
  }
}

/**
 * Example real provider implementation skeleton
 */
export class ComplyAdvantageAMLProvider implements AMLProvider {
  name = 'ComplyAdvantage';
  private apiKey: string;
  private apiUrl = 'https://api.complyadvantage.com/v1';

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async checkSanctions(name: string, country?: string): Promise<AMLCheck> {
    // Real implementation would:
    // 1. Call ComplyAdvantage API
    // 2. Parse results
    // 3. Map to our AMLCheck format
    
    throw new Error('Not implemented - example only');
  }

  async checkPEP(name: string): Promise<AMLCheck> {
    throw new Error('Not implemented - example only');
  }

  async monitorTransaction(transaction: TransactionData): Promise<AMLCheck> {
    throw new Error('Not implemented - example only');
  }

  async batchCheck(entities: string[]): Promise<AMLCheck[]> {
    throw new Error('Not implemented - example only');
  }
}