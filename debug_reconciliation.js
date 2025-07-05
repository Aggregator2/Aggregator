const { ReconciliationEngine, MockOnChainProvider } = require('./src/services/settlement/ReconciliationEngine');
const { BalanceTracker } = require('./src/services/settlement/BalanceTracker');

async function debugReconciliation() {
  console.log('🔍 Starting ReconciliationEngine debug...');
  
  const balanceTracker = new BalanceTracker();
  const reconciliationEngine = new ReconciliationEngine(balanceTracker, {
    schedule: 'MANUAL',
    tolerance: BigInt(100),
    autoResolve: true
  });
  
  const onChainProvider = new MockOnChainProvider();
  reconciliationEngine.setOnChainProvider(onChainProvider);
  
  console.log('✅ Setup complete');
  
  // Create 5 reports exactly like the test
  for (let i = 0; i < 5; i++) {
    console.log(`\n📊 Creating report ${i + 1}/5...`);
    
    await balanceTracker.processDeposit(`user${i}`, 'ETH', BigInt(10e8), `TX_${i}`);
    onChainProvider.setBalance(`user${i}`, 'ETH', BigInt(10e8));
    
    const report = await reconciliationEngine.performReconciliation();
    console.log(`   Report ID: ${report.id}`);
    console.log(`   Status: ${report.status}`);
    console.log(`   Discrepancies: ${report.discrepancies.length}`);
    
    const allReports = reconciliationEngine.getAllReports(10);
    console.log(`   Total reports stored: ${allReports.length}`);
  }
  
  console.log('\n🎯 Final check:');
  const reports = reconciliationEngine.getAllReports(3);
  console.log(`Expected 3 reports, got ${reports.length} reports`);
  
  const allReports = reconciliationEngine.getAllReports(10);
  console.log(`Total reports stored: ${allReports.length}`);
  console.log('Report IDs:', allReports.map(r => r.id));
}

debugReconciliation().catch(console.error);