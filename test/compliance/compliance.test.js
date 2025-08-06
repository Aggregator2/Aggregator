const { expect } = require('chai');
const sinon = require('sinon');
const KYCManager = require('../../lib/compliance/KYCManager');
const TransactionMonitor = require('../../lib/compliance/TransactionMonitor');
const RegulatoryReporting = require('../../lib/compliance/RegulatoryReporting');
const SmartCompliance = require('../../lib/compliance/SmartCompliance');

describe('Compliance System Tests', function() {
    describe('KYC Manager', function() {
        let kycManager;
        
        beforeEach(function() {
            kycManager = new KYCManager({
                provider: 'onfido',
                onfido: {
                    apiToken: 'test-token'
                }
            });
        });
        
        it('should create verification state machine', function() {
            const fsm = kycManager.createVerificationStateMachine('user-123');
            expect(fsm.state).to.equal('unverified');
            
            fsm.start();
            expect(fsm.state).to.equal('pending_documents');
        });
        
        it('should start verification process', async function() {
            const result = await kycManager.startVerification('user-123', {
                firstName: 'John',
                lastName: 'Doe',
                dateOfBirth: '1990-01-01',
                country: 'US'
            });
            
            expect(result).to.have.property('userId', 'user-123');
            expect(result).to.have.property('sessionId');
            expect(result).to.have.property('state', 'pending_documents');
        });
        
        it('should calculate risk score correctly', function() {
            const verification = {
                checks: [
                    {
                        type: 'document',
                        result: { authentic: true, confidence: 0.95 }
                    },
                    {
                        type: 'identity',
                        result: { match: true }
                    },
                    {
                        type: 'aml',
                        result: {
                            passed: true,
                            checks: {
                                sanctions: { match: false },
                                pep: { match: false },
                                adverseMedia: { found: false }
                            }
                        }
                    }
                ],
                userData: { country: 'US' }
            };
            
            const riskScore = kycManager.calculateRiskScore(verification);
            expect(riskScore.score).to.equal(0);
            expect(riskScore.level).to.equal('low');
        });
        
        it('should detect high risk countries', function() {
            const score = kycManager.getCountryRiskScore('IR');
            expect(score).to.equal(100);
            
            const usScore = kycManager.getCountryRiskScore('US');
            expect(usScore).to.equal(0);
        });
    });
    
    describe('Transaction Monitor', function() {
        let monitor;
        
        beforeEach(function() {
            monitor = new TransactionMonitor({
                thresholds: {
                    largeTransaction: 10000,
                    dailyLimit: 50000
                }
            });
        });
        
        it('should detect large transactions', async function() {
            const transaction = {
                id: 'tx-123',
                userId: 'user-123',
                amount: 15000,
                amountUSD: 15000,
                currency: 'USDC',
                fromAddress: '0xabc...',
                toAddress: '0xdef...',
                timestamp: Date.now()
            };
            
            const violations = await monitor.runAMLRules(transaction);
            const largeTransactionViolation = violations.find(v => v.rule.id === 'large_transaction');
            
            expect(largeTransactionViolation).to.exist;
            expect(largeTransactionViolation.rule.severity).to.equal('high');
        });
        
        it('should calculate overall risk correctly', function() {
            const transaction = {
                riskScore: { score: 50, level: 'medium' }
            };
            
            const violations = [
                { rule: { severity: 'high' } },
                { rule: { severity: 'medium' } }
            ];
            
            const patterns = [
                { type: 'washTrading', confidence: 0.8 }
            ];
            
            const risk = monitor.calculateOverallRisk(transaction, violations, patterns);
            
            expect(risk.score).to.be.above(100);
            expect(risk.action).to.equal('manual_review');
            expect(risk.requiresReporting).to.be.true;
        });
        
        it('should detect wash trading patterns', async function() {
            const detector = new monitor.patternDetectors.washTrading.constructor();
            const transaction = {
                userId: 'user-123',
                fromAddress: '0xabc',
                toAddress: '0xdef'
            };
            
            // Mock circular trade
            monitor.getUserTransactionHistory = async () => [
                {
                    id: 'tx-1',
                    fromAddress: '0xdef',
                    toAddress: '0xabc'
                }
            ];
            
            const result = await detector.detect(transaction, monitor);
            expect(result.detected).to.be.true;
            expect(result.confidence).to.equal(0.9);
        });
    });
    
    describe('Regulatory Reporting', function() {
        let reporting;
        
        beforeEach(function() {
            reporting = new RegulatoryReporting({
                fincen: { bsaId: 'TEST-BSA-123' },
                irs: { tin: '12-3456789' }
            });
        });
        
        it('should validate SAR data', async function() {
            const validSAR = {
                filingInstitution: { name: 'Test' },
                suspectInformation: { lastName: 'Doe' },
                suspiciousActivity: {},
                narrative: 'A'.repeat(101)
            };
            
            const validation = await reporting.validateSAR(validSAR);
            expect(validation.valid).to.be.true;
            
            const invalidSAR = { narrative: 'Too short' };
            const invalidValidation = await reporting.validateSAR(invalidSAR);
            expect(invalidValidation.valid).to.be.false;
            expect(invalidValidation.errors).to.have.length.above(0);
        });
        
        it('should calculate user tax summary', function() {
            const transactions = [
                { amount: 1000, fee: 10, timestamp: Date.now() },
                { amount: 2000, fee: 20, timestamp: Date.now() },
                { amount: 500, fee: 5, timestamp: Date.now() }
            ];
            
            const summary = reporting.calculateUserTaxSummary(transactions);
            
            expect(summary.grossAmount).to.equal(3500);
            expect(summary.fees).to.equal(35);
            expect(summary.netAmount).to.equal(3465);
            expect(summary.transactionCount).to.equal(3);
        });
        
        it('should detect suspicious patterns', function() {
            const transactions = [
                { id: 'tx-1', amount: 5000, timestamp: 1000 },
                { id: 'tx-2', amount: 5000, timestamp: 1030, userId: 'user-1' },
                { id: 'tx-3', amount: 5000, timestamp: 1060, userId: 'user-1' },
                { id: 'tx-4', amount: 10000, timestamp: 2000 },
                { id: 'tx-5', amount: 15000, timestamp: 3000 }
            ];
            
            const patterns = reporting.detectSuspiciousPatterns(transactions);
            
            const rapidPattern = patterns.find(p => p.type === 'rapid_succession');
            expect(rapidPattern).to.exist;
            
            const roundAmountPattern = patterns.find(p => p.type === 'round_amounts');
            expect(roundAmountPattern).to.exist;
        });
    });
    
    describe('Smart Compliance', function() {
        let compliance;
        
        beforeEach(function() {
            compliance = new SmartCompliance({
                geoBlocking: {
                    blockedCountries: ['KP', 'IR']
                },
                vpnDetection: {
                    threshold: 0.85
                }
            });
        });
        
        it('should check geo compliance', async function() {
            const context = {
                country: 'US',
                ip: '8.8.8.8'
            };
            
            const result = await compliance.checkGeoCompliance(context);
            expect(result.passed).to.be.true;
            
            const blockedContext = {
                country: 'KP'
            };
            
            const blockedResult = await compliance.checkGeoCompliance(blockedContext);
            expect(blockedResult.passed).to.be.false;
            expect(blockedResult.reason).to.equal('Country restricted');
        });
        
        it('should enforce token restrictions', async function() {
            const context = {
                token: 'USDC',
                country: 'US',
                userProfile: { type: 'retail' }
            };
            
            const result = await compliance.checkTokenCompliance(context);
            expect(result.passed).to.be.true;
        });
        
        it('should check transaction limits', async function() {
            compliance.getUserDailyVolume = async () => 40000;
            
            const context = {
                userId: 'user-123',
                amount: 20000,
                country: 'US',
                userProfile: { type: 'retail' }
            };
            
            const result = await compliance.checkTransactionLimits(context);
            expect(result.passed).to.be.false;
            expect(result.reason).to.include('daily limit');
        });
        
        it('should integrate all compliance checks', async function() {
            const transactionContext = {
                userId: 'user-123',
                amount: 5000,
                token: 'USDC',
                ip: '8.8.8.8',
                country: 'US'
            };
            
            const result = await compliance.checkCompliance(transactionContext);
            expect(result.allowed).to.be.true;
            expect(result.context).to.have.property('timestamp');
        });
    });
    
    describe('Integration Tests', function() {
        it('should handle complete KYC and transaction flow', async function() {
            // 1. Start KYC
            const kycManager = new KYCManager({ provider: 'onfido' });
            const kyc = await kycManager.startVerification('user-123', {
                firstName: 'John',
                lastName: 'Doe',
                country: 'US'
            });
            
            // 2. Check compliance for transaction
            const compliance = new SmartCompliance({});
            const complianceCheck = await compliance.checkCompliance({
                userId: 'user-123',
                amount: 5000,
                token: 'USDC',
                country: 'US'
            });
            
            expect(complianceCheck.allowed).to.be.true;
            
            // 3. Monitor transaction
            const monitor = new TransactionMonitor({});
            const monitoring = await monitor.monitorTransaction({
                id: 'tx-123',
                userId: 'user-123',
                amount: 5000,
                amountUSD: 5000,
                currency: 'USDC',
                fromAddress: '0xabc',
                toAddress: '0xdef'
            });
            
            expect(monitoring.status).to.not.equal('block');
            
            // 4. Generate reports if needed
            if (monitoring.riskLevel === 'high') {
                const reporting = new RegulatoryReporting({});
                const sar = await reporting.fileSAR({
                    userId: 'user-123',
                    violations: monitoring.violations,
                    totalAmount: 5000,
                    transactionCount: 1,
                    startDate: new Date(),
                    endDate: new Date()
                });
                
                expect(sar.reportId).to.exist;
            }
        });
    });
});

// Mock external services for testing
class MockVPNDetector {
    async detect(ip) {
        return {
            isVPN: false,
            confidence: 0.1
        };
    }
}

class MockChainanalysis {
    async getScore(transaction) {
        return {
            score: 25,
            categories: ['exchange'],
            cluster: 'coinbase'
        };
    }
}