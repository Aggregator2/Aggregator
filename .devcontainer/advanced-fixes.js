const { Anthropic } = require('@anthropic-ai/sdk');
const fs = require('fs');

async function getAdvancedUIFixes() {
    const anthropic = new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY || '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'
    });

    const prompt = `
As a senior React/Next.js developer, provide comprehensive implementation code for these SPECIFIC requirements in the Meta Aggregator 2.0 dApp:

## 1. API FAILURES & ERROR HANDLING
Implement these exact patterns:
- **Try-catch blocks** for network/gas price API calls
- **Loading states** with skeleton loaders during data fetches  
- **Smart contract errors** with error boundaries for transaction failures
- **Fallback options** for graceful degradation when APIs fail
- **User feedback** with clear error messages for failed operations

## 2. STATE MANAGEMENT IMPROVEMENTS
Implement these patterns:
- **Slippage persistence** ensuring slider values persist in trade execution
- **Transaction handling** with comprehensive error handling for reverted calls
- **State consistency** maintaining UI state during blockchain interactions

## 3. PERFORMANCE OPTIMIZATIONS  
Implement these patterns:
- **Gas price caching** to reduce API call frequency
- **Error recovery** with fallback mechanisms for API failures
- **Timeout handling** with appropriate timeouts for network requests

## 4. TYPESCRIPT TYPE SAFETY
Implement these patterns:
- **Type guards** for comprehensive API response validation
- **Type assertions** where necessary for safety
- **Component types** with strengthened prop types

## 5. REACT OPTIMIZATION
Implement these patterns:
- **Functional components** using hooks properly
- **Memoization** for expensive computations with useMemo/useCallback
- **Re-render optimization** to minimize unnecessary component re-renders
- **Context optimization** for React Context performance

## 6. TESTING IMPLEMENTATION
Provide code for:
- **Unit tests** for new functionality
- **Integration tests** for theme toggle, slippage slider, network tooltips
- **Error scenario testing** for error handling paths

Please provide COMPLETE, WORKING CODE for each section with:
1. Full component implementations
2. Custom hooks for state management
3. Error boundary components
4. Loading/skeleton components
5. Test files
6. Type definitions

Focus on Next.js 15, React 18, TypeScript, ethers.js v6, and Tailwind CSS.
`;

    try {
        console.log('🚀 Generating advanced UI fixes...');
        
        const response = await anthropic.messages.create({
            model: "claude-3-5-sonnet-20241022",
            max_tokens: 4000,
            messages: [{ role: "user", content: prompt }],
            system: "You are a senior full-stack developer specializing in React, Next.js, TypeScript, and Web3 development. Provide complete, production-ready code implementations."
        });

        const fixes = response.content[0].text;
        
        // Save to file
        fs.writeFileSync('.claude-output/advanced-ui-fixes.md', fixes);
        
        console.log('✅ Advanced UI fixes generated!');
        console.log(`📊 Tokens used: Input(${response.usage.input_tokens}) + Output(${response.usage.output_tokens})`);
        console.log('📁 Saved to: .claude-output/advanced-ui-fixes.md');
        
        return fixes;
        
    } catch (error) {
        console.error('❌ Error generating advanced fixes:', error.message);
        throw error;
    }
}

// Run if called directly
if (require.main === module) {
    getAdvancedUIFixes();
}

module.exports = { getAdvancedUIFixes };
