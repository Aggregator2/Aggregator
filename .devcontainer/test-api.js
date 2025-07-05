require('dotenv').config();
const { Anthropic } = require('@anthropic-ai/sdk');

async function testClaudeAPI() {
    console.log('🧪 Testing Claude API connection...');
    
    const apiKey = process.env.ANTHROPIC_API_KEY;
    
    if (!apiKey) {
        console.error('❌ No API key found!');
        return false;
    }
    
    console.log('✅ API key configured');
    
    try {
        const anthropic = new Anthropic({
            apiKey: apiKey,
        });        const response = await anthropic.messages.create({
            model: "claude-3-5-sonnet-20241022",
            max_tokens: 100,
            messages: [{ 
                role: "user", 
                content: "Hello! Can you help me fix TypeScript and ethers.js issues in a Next.js project?" 
            }],
        });

        console.log('✅ API connection successful!');
        console.log('🤖 Claude response:', response.content[0].text.substring(0, 100) + '...');
        console.log('📊 Tokens used:', response.usage.input_tokens + response.usage.output_tokens);
        console.log('💰 Estimated cost: $' + ((response.usage.input_tokens + response.usage.output_tokens) * 0.000003).toFixed(6));
        
        return true;
    } catch (error) {
        console.error('❌ API test failed:', error.message);
        
        if (error.message.includes('credit')) {
            console.error('💳 Check your Anthropic API credits');
        } else if (error.message.includes('auth')) {
            console.error('🔑 Check your API key');
        }
        
        return false;
    }
}

if (require.main === module) {
    testClaudeAPI();
}

module.exports = { testClaudeAPI };
