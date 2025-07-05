const axios = require('axios');

const API_BASE_URL = 'http://localhost:3000/api';

async function testSettlementAPI() {
  console.log('Testing Settlement API endpoints...\n');
  
  try {
    // Test 1: Get settlement status
    console.log('1. Testing GET /api/settlement/status');
    try {
      const statusResponse = await axios.get(`${API_BASE_URL}/settlement/status`);
      console.log('✅ Status endpoint working!');
      console.log('Response:', JSON.stringify(statusResponse.data, null, 2));
      
      // Check required fields
      const { data } = statusResponse.data;
      if (data.status === 'active' && 
          data.pendingSettlements !== undefined &&
          data.lastSettlement !== undefined) {
        console.log('✅ All required fields present');
      } else {
        console.log('❌ Missing required fields');
      }
    } catch (error) {
      console.log('❌ Status endpoint failed:', error.response?.data || error.message);
    }
    
    console.log('\n---\n');
    
    // Test 2: Create settlement batch
    console.log('2. Testing POST /api/settlement/batch');
    try {
      const trades = [
        {
          id: 'trade1',
          buyerId: 'user1',
          sellerId: 'user2',
          baseAsset: 'ETH',
          quoteAsset: 'USDC',
          baseQuantity: '1000000000000000000', // 1 ETH
          quoteQuantity: '2500000000', // 2500 USDC
          timestamp: Date.now()
        },
        {
          id: 'trade2',
          buyerId: 'user3',
          sellerId: 'user1',
          baseAsset: 'BTC',
          quoteAsset: 'USDC',
          baseQuantity: '10000000', // 0.1 BTC
          quoteQuantity: '4500000000', // 45000 USDC
          timestamp: Date.now()
        }
      ];
      
      const batchResponse = await axios.post(`${API_BASE_URL}/settlement/batch`, {
        trades
      });
      
      console.log('✅ Batch creation successful!');
      console.log('Response:', JSON.stringify(batchResponse.data, null, 2));
      
      const batchId = batchResponse.data.data?.batchId;
      
      // Test 3: Get batch status
      if (batchId) {
        console.log('\n3. Testing GET /api/settlement/batch?batchId=' + batchId);
        const getBatchResponse = await axios.get(`${API_BASE_URL}/settlement/batch?batchId=${batchId}`);
        console.log('✅ Batch retrieval successful!');
        console.log('Response:', JSON.stringify(getBatchResponse.data, null, 2));
      }
      
    } catch (error) {
      console.log('❌ Batch endpoint failed:', error.response?.data || error.message);
    }
    
    console.log('\n---\n');
    
    // Test 4: Generate merkle proof
    console.log('4. Testing GET /api/settlement/proof');
    try {
      const proofResponse = await axios.get(`${API_BASE_URL}/settlement/proof`, {
        params: {
          settlementId: 'BATCH_test_123',
          userId: 'user1'
        }
      });
      
      console.log('✅ Proof generation successful!');
      console.log('Response:', JSON.stringify(proofResponse.data, null, 2));
      
      // Test 5: Verify proof
      if (proofResponse.data.data?.proof) {
        console.log('\n5. Testing POST /api/settlement/proof (verify)');
        const { root, leaves, path } = proofResponse.data.data.proof;
        
        const verifyResponse = await axios.post(`${API_BASE_URL}/settlement/proof`, {
          root,
          leaf: leaves[0],
          path
        });
        
        console.log('✅ Proof verification successful!');
        console.log('Response:', JSON.stringify(verifyResponse.data, null, 2));
      }
      
    } catch (error) {
      console.log('❌ Proof endpoint failed:', error.response?.data || error.message);
    }
    
    console.log('\n✅ All tests completed!');
    
  } catch (error) {
    console.error('Test failed:', error.message);
  }
}

// Run the tests
testSettlementAPI().catch(console.error);