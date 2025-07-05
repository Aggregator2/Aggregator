const fs = require('fs');
const path = require('path');

// Files with EOF errors
const filesToCheck = [
  'pages/api/analytics/profits.ts',
  'pages/api/channels/[channelId]/settle.js',
  'pages/api/channels/[channelId]/state.js', 
  'pages/api/channels/[channelId]/trade.js',
  'pages/api/channels/create.js'
];

filesToCheck.forEach(file => {
  const filePath = path.join(__dirname, file);
  try {
    let content = fs.readFileSync(filePath, 'utf8');
    
    // Ensure file ends with newline
    if (!content.endsWith('\n')) {
      content += '\n';
      fs.writeFileSync(filePath, content);
      console.log(`Fixed EOF for ${file}`);
    }
  } catch (error) {
    console.error(`Error processing ${file}:`, error.message);
  }
});

console.log('Build error fixes complete');