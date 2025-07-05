#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const schemaPath = path.join(__dirname, '../prisma/schema.prisma');
let schema = fs.readFileSync(schemaPath, 'utf8');

// Replace all enum references with String type
const enumReplacements = {
  'UserRole': 'String',
  'OrderStatus': 'String', 
  'MarketMakerStatus': 'String',
  'RFQStatus': 'String',
  'QuoteStatus': 'String',
  'OrderFlowType': 'String',
  'FeeType': 'String',
  'InventoryEventType': 'String'
};

// Replace enum field types
for (const [enumName, replacement] of Object.entries(enumReplacements)) {
  // Replace field definitions like "role UserRole" with "role String"
  const fieldRegex = new RegExp(`(\\s+\\w+\\s+)${enumName}(\\s+)`, 'g');
  schema = schema.replace(fieldRegex, `$1${replacement}$2`);
  
  // Replace default values like "@default(USER)" with "@default("USER")"
  schema = schema.replace(/@default\(([A-Z_]+)\)/g, (match, value) => {
    // Check if this is an enum value (all uppercase with underscores)
    if (/^[A-Z_]+$/.test(value)) {
      return `@default("${value}")`;
    }
    return match;
  });
}

// Comment out enum definitions instead of removing them
schema = schema.replace(/^enum\s+\w+\s*{[\s\S]*?^}/gm, (match) => {
  return match.split('\n').map(line => '// ' + line).join('\n');
});

// Write the modified schema
fs.writeFileSync(schemaPath, schema);

console.log('✅ Schema converted for SQLite compatibility');
console.log('📝 Enum definitions have been commented out');
console.log('🔄 All enum fields converted to String type');
console.log('🔧 Default enum values wrapped in quotes');