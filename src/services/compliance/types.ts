export interface KYCData {
  userId: string;
  status: KYCStatus;
  level: KYCLevel;
  submittedAt?: Date;
  verifiedAt?: Date;
  expiresAt?: Date;
  documents: KYCDocument[];
  personalInfo?: PersonalInfo;
  businessInfo?: BusinessInfo;
  riskScore?: number;
  rejectionReason?: string;
  provider?: string;
  providerRefId?: string;
}

export enum KYCStatus {
  NOT_STARTED = 'NOT_STARTED',
  PENDING = 'PENDING',
  IN_REVIEW = 'IN_REVIEW',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  EXPIRED = 'EXPIRED',
  SUSPENDED = 'SUSPENDED'
}

export enum KYCLevel {
  BASIC = 'BASIC',           // Email verification only
  STANDARD = 'STANDARD',     // ID verification
  ENHANCED = 'ENHANCED',     // ID + proof of address
  INSTITUTIONAL = 'INSTITUTIONAL' // Full business verification
}

export interface KYCDocument {
  type: DocumentType;
  status: 'PENDING' | 'VERIFIED' | 'REJECTED';
  uploadedAt: Date;
  verifiedAt?: Date;
  documentId: string;
  rejectionReason?: string;
}

export enum DocumentType {
  PASSPORT = 'PASSPORT',
  DRIVERS_LICENSE = 'DRIVERS_LICENSE',
  NATIONAL_ID = 'NATIONAL_ID',
  PROOF_OF_ADDRESS = 'PROOF_OF_ADDRESS',
  BANK_STATEMENT = 'BANK_STATEMENT',
  BUSINESS_LICENSE = 'BUSINESS_LICENSE',
  ARTICLES_OF_INCORPORATION = 'ARTICLES_OF_INCORPORATION'
}

export interface PersonalInfo {
  firstName: string;
  lastName: string;
  dateOfBirth: Date;
  nationality: string;
  residenceCountry: string;
  address: Address;
  taxId?: string;
  occupation?: string;
  sourceOfFunds?: string;
}

export interface BusinessInfo {
  companyName: string;
  registrationNumber: string;
  incorporationCountry: string;
  businessAddress: Address;
  businessType: string;
  ownership: OwnershipInfo[];
  directors: PersonalInfo[];
  natureOfBusiness: string;
  expectedVolume: string;
}

export interface Address {
  street: string;
  city: string;
  state?: string;
  postalCode: string;
  country: string;
}

export interface OwnershipInfo {
  owner: PersonalInfo;
  percentage: number;
  isPEP: boolean; // Politically Exposed Person
}

// AML Types
export interface AMLCheck {
  userId: string;
  checkId: string;
  timestamp: Date;
  type: AMLCheckType;
  status: AMLCheckStatus;
  riskScore: number;
  hits: AMLHit[];
  nextCheckDate?: Date;
}

export enum AMLCheckType {
  SANCTIONS = 'SANCTIONS',
  PEP = 'PEP',
  ADVERSE_MEDIA = 'ADVERSE_MEDIA',
  WATCHLIST = 'WATCHLIST',
  TRANSACTION_MONITORING = 'TRANSACTION_MONITORING'
}

export enum AMLCheckStatus {
  CLEAR = 'CLEAR',
  PENDING_REVIEW = 'PENDING_REVIEW',
  FLAGGED = 'FLAGGED',
  BLOCKED = 'BLOCKED'
}

export interface AMLHit {
  source: string;
  matchScore: number;
  matchedName: string;
  reason: string;
  details: Record<string, any>;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}

// Surveillance Types
export interface SurveillanceAlert {
  alertId: string;
  timestamp: Date;
  type: AlertType;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  userId?: string;
  pairId?: string;
  pattern: string;
  details: Record<string, any>;
  status: AlertStatus;
  assignedTo?: string;
  resolution?: AlertResolution;
}

export enum AlertType {
  WASH_TRADING = 'WASH_TRADING',
  SPOOFING = 'SPOOFING',
  LAYERING = 'LAYERING',
  FRONT_RUNNING = 'FRONT_RUNNING',
  MARKET_MANIPULATION = 'MARKET_MANIPULATION',
  UNUSUAL_VOLUME = 'UNUSUAL_VOLUME',
  RAPID_PRICE_MOVEMENT = 'RAPID_PRICE_MOVEMENT',
  STRUCTURING = 'STRUCTURING',
  LARGE_TRANSACTION = 'LARGE_TRANSACTION',
  VELOCITY_BREACH = 'VELOCITY_BREACH'
}

export enum AlertStatus {
  NEW = 'NEW',
  INVESTIGATING = 'INVESTIGATING',
  ESCALATED = 'ESCALATED',
  RESOLVED = 'RESOLVED',
  FALSE_POSITIVE = 'FALSE_POSITIVE'
}

export interface AlertResolution {
  resolvedAt: Date;
  resolvedBy: string;
  outcome: 'LEGITIMATE' | 'SUSPICIOUS' | 'VIOLATION';
  notes: string;
  actionsTaken: string[];
  reportFiled?: boolean;
}

// Reporting Types
export interface RegulatoryReport {
  reportId: string;
  type: ReportType;
  period: ReportPeriod;
  generatedAt: Date;
  submittedAt?: Date;
  status: ReportStatus;
  jurisdiction: string;
  data: Record<string, any>;
  format: 'JSON' | 'XML' | 'CSV' | 'PDF';
  filePath?: string;
}

export enum ReportType {
  SAR = 'SAR',                    // Suspicious Activity Report
  CTR = 'CTR',                    // Currency Transaction Report
  STR = 'STR',                    // Suspicious Transaction Report
  TRADE_REPORT = 'TRADE_REPORT',
  VOLUME_REPORT = 'VOLUME_REPORT',
  AUDIT_REPORT = 'AUDIT_REPORT',
  COMPLIANCE_SUMMARY = 'COMPLIANCE_SUMMARY'
}

export interface ReportPeriod {
  start: Date;
  end: Date;
  frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'ANNUAL' | 'AD_HOC';
}

export enum ReportStatus {
  DRAFT = 'DRAFT',
  GENERATED = 'GENERATED',
  REVIEWED = 'REVIEWED',
  SUBMITTED = 'SUBMITTED',
  ACKNOWLEDGED = 'ACKNOWLEDGED',
  REJECTED = 'REJECTED'
}

// Compliance Rules
export interface ComplianceRule {
  ruleId: string;
  name: string;
  description: string;
  category: RuleCategory;
  enabled: boolean;
  jurisdiction?: string[];
  conditions: RuleCondition[];
  actions: RuleAction[];
  priority: number;
  createdAt: Date;
  updatedAt: Date;
}

export enum RuleCategory {
  KYC = 'KYC',
  AML = 'AML',
  TRADING = 'TRADING',
  WITHDRAWAL = 'WITHDRAWAL',
  DEPOSIT = 'DEPOSIT',
  REPORTING = 'REPORTING'
}

export interface RuleCondition {
  field: string;
  operator: 'EQ' | 'NE' | 'GT' | 'GTE' | 'LT' | 'LTE' | 'IN' | 'NOT_IN' | 'CONTAINS';
  value: any;
  combineWith?: 'AND' | 'OR';
}

export interface RuleAction {
  type: 'BLOCK' | 'FLAG' | 'REQUIRE_APPROVAL' | 'NOTIFY' | 'LOG' | 'ESCALATE';
  params?: Record<string, any>;
}

// Integration Providers
export interface KYCProvider {
  name: string;
  verify(data: Partial<KYCData>): Promise<KYCVerificationResult>;
  getStatus(refId: string): Promise<KYCStatus>;
  uploadDocument(userId: string, document: Buffer, type: DocumentType): Promise<string>;
}

export interface KYCVerificationResult {
  status: KYCStatus;
  refId: string;
  riskScore?: number;
  details?: Record<string, any>;
}

export interface AMLProvider {
  name: string;
  checkSanctions(name: string, country?: string): Promise<AMLCheck>;
  checkPEP(name: string): Promise<AMLCheck>;
  monitorTransaction(transaction: TransactionData): Promise<AMLCheck>;
  batchCheck(entities: string[]): Promise<AMLCheck[]>;
}

export interface TransactionData {
  userId: string;
  amount: string;
  currency: string;
  type: 'DEPOSIT' | 'WITHDRAWAL' | 'TRADE';
  timestamp: Date;
  counterparty?: string;
  metadata?: Record<string, any>;
}