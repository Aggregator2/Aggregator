const { Anthropic } = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');

class ClaudeCodeAssistant {
    constructor() {
        this.anthropic = new Anthropic({
            apiKey: process.env.ANTHROPIC_API_KEY,
        });
        this.projectPath = '/workspace';
        this.logFile = '/workspace/claude-session.log';
        this.outputDir = '/workspace/.claude-output';
        
        // Create output directory if it doesn't exist
        if (!fs.existsSync(this.outputDir)) {
            fs.mkdirSync(this.outputDir, { recursive: true });
        }
    }

    async analyzeProject() {
        try {
            console.log('🔍 Analyzing Meta Aggregator 2.0 project...');
            
            // Read project structure
            const projectFiles = this.getProjectFiles();
            const prompt = this.buildAnalysisPrompt(projectFiles);
              const response = await this.anthropic.messages.create({
                model: "claude-3-5-sonnet-20241022",
                max_tokens: 4000,
                messages: [{ role: "user", content: prompt }],
                system: "You are a senior full-stack developer specializing in Next.js, TypeScript, Ethers.js, and React dApps. Focus on practical solutions and working code fixes."
            });

            const analysis = response.content[0].text;
            this.logToFile(`ANALYSIS COMPLETE`);
            this.logToFile(`Tokens used: Input(${response.usage.input_tokens}) + Output(${response.usage.output_tokens})`);
            this.logToFile(`Analysis: ${analysis}`);
            
            // Save analysis to separate file
            fs.writeFileSync(path.join(this.outputDir, 'analysis.md'), analysis);
            
            return analysis;
        } catch (error) {
            this.logToFile(`Error in analysis: ${error.message}`);
            throw error;
        }
    }

    async fixUIIssues() {
        const prompt = `
Analyze and fix these CRITICAL UI issues in the Meta Aggregator 2.0 dApp:

CRITICAL ERRORS TO FIX:
1. **Ethers.js v6 Compatibility** - Update API calls in components
2. **TypeScript Compilation** - Fix BigInt literals and imports  
3. **Component Props** - Fix prop mismatches causing render errors
4. **Missing Dependencies** - Move packages to correct dependencies
5. **Docker Build** - Ensure all assets are included

SPECIFIC FILES WITH ISSUES:
- components/SwapWidget.tsx (ethers.providers.Web3Provider → ethers.BrowserProvider)
- components/QuoteSummary.tsx (BigNumber.from → ethers.getBigInt, fix CountdownTimer props)
- utils/signOrder.ts (ethers v6 API updates)
- utils/verifySignature.ts (ethers v6 API updates)
- pages/api/orders.ts (ethers v6 API updates)
- tsconfig.json (target: "es6" → "es2020" for BigInt support)
- package.json (move ethers to dependencies)

CURRENT STATE:
- Next.js 15.3.2 with TypeScript
- Ethers.js v6 (needs API migration)
- Tailwind CSS for styling
- Docker deployment setup

PROVIDE:
1. **Exact file paths** to modify
2. **Complete code replacements** with proper imports
3. **Line-by-line fixes** for each issue
4. **Priority order** for implementation
5. **Testing commands** to verify fixes

Focus on making the UI components render without errors and the build process complete successfully.

Format your response with clear sections for each file and specific code blocks.
        `;

        try {
            console.log('🔧 Generating UI-specific fixes...');
              const response = await this.anthropic.messages.create({
                model: "claude-3-5-sonnet-20241022",
                max_tokens: 4000,
                messages: [{ role: "user", content: prompt }],
                system: "You are a senior React/Next.js developer specializing in TypeScript and ethers.js. Provide practical, working code fixes."
            });

            const fixes = response.content[0].text;
            this.logToFile(`UI FIXES GENERATED`);
            this.logToFile(`Tokens used: Input(${response.usage.input_tokens}) + Output(${response.usage.output_tokens})`);
            this.logToFile(`Fixes: ${fixes}`);
            
            // Save fixes to separate file
            fs.writeFileSync(path.join(this.outputDir, 'ui-fixes.md'), fixes);
            
            return fixes;
        } catch (error) {
            this.logToFile(`Error getting UI fixes: ${error.message}`);
            throw error;
        }
    }

    async generateSpecificFix(fileName, issue) {
        const prompt = `
Fix this specific issue in ${fileName}:

ISSUE: ${issue}

PROJECT: Meta Aggregator 2.0 (Next.js + Ethers.js v6 + TypeScript)

Provide:
1. Complete corrected file content
2. Explanation of changes
3. Any additional dependencies needed

Focus on ethers v6 compatibility and TypeScript correctness.
        `;

        try {            const response = await this.anthropic.messages.create({
                model: "claude-3-5-sonnet-20241022",
                max_tokens: 3000,
                messages: [{ role: "user", content: prompt }],
            });

            const fix = response.content[0].text;
            this.logToFile(`SPECIFIC FIX for ${fileName}: ${fix}`);
            
            return fix;
        } catch (error) {
            this.logToFile(`Error getting specific fix for ${fileName}: ${error.message}`);
            throw error;
        }
    }

    getProjectFiles() {
        const relevantFiles = [
            'package.json',
            'tsconfig.json',
            'next.config.js',
            'docker-compose.yml',
            'Dockerfile',
            '.env.local',
            'components/SwapWidget.tsx',
            'components/QuoteSummary.tsx',
            'components/MarketOrderWidget.tsx',
            'components/SwapWidget.module.css',
            'utils/escrowEventListener.js',
            'utils/signOrder.ts',
            'utils/verifySignature.ts',
            'pages/api/quote.ts',
            'pages/api/orders.ts',
            'pages/index.js',
            'App.tsx'
        ];

        const files = {};
        relevantFiles.forEach(file => {
            const filePath = path.join(this.projectPath, file);
            if (fs.existsSync(filePath)) {
                try {
                    files[file] = fs.readFileSync(filePath, 'utf8');
                } catch (error) {
                    this.logToFile(`Warning: Could not read ${file}: ${error.message}`);
                }
            }
        });

        return files;
    }

    buildAnalysisPrompt(files) {
        let prompt = `
ANALYZE Meta Aggregator 2.0 dApp - CRITICAL ISSUES FOCUS

This is a Next.js/TypeScript decentralized exchange aggregator with Docker deployment.

KNOWN CRITICAL ISSUES:
1. Ethers.js v6 breaking changes not applied
2. TypeScript compilation errors (BigInt literals)
3. React component prop type mismatches
4. Docker build failing (Next.js production issues)
5. Missing runtime dependencies

PROJECT FILES:
`;
        
        Object.entries(files).forEach(([filename, content]) => {
            // Truncate very long files to save tokens
            const truncatedContent = content.length > 2000 ? 
                content.substring(0, 2000) + '\n... [TRUNCATED] ...' : content;
            prompt += `\n=== ${filename} ===\n${truncatedContent}\n`;
        });

        prompt += `

ANALYSIS REQUIREMENTS:
1. Identify all ethers v5 → v6 breaking changes needed
2. Find TypeScript compilation blockers
3. Locate React prop type mismatches
4. Spot Docker/Next.js build issues
5. Check dependency problems

PRIORITIZE: Issues preventing build/compile/run.
        `;

        return prompt;
    }

    logToFile(message) {
        const timestamp = new Date().toISOString();
        const logEntry = `[${timestamp}] ${message}\n`;
        fs.appendFileSync(this.logFile, logEntry);
        console.log(logEntry.trim());
    }

    async getTokenUsageEstimate() {
        // Rough estimate based on project files
        const files = this.getProjectFiles();
        const totalChars = Object.values(files).join('').length;
        const estimatedTokens = Math.ceil(totalChars / 4); // Rough estimate: 4 chars per token
        
        console.log(`📊 Estimated input tokens: ~${estimatedTokens}`);
        console.log(`💰 Estimated cost: ~$${(estimatedTokens * 0.000003).toFixed(4)} (input) + output costs`);
        
        return estimatedTokens;
    }
}

module.exports = ClaudeCodeAssistant;
