// Mock database for when SQLite is not available
class MockDatabase {
  constructor() {
    this.settlements = new Map();
  }

  async all(query, params) {
    // Mock implementation - return empty results
    console.log('Mock database query:', query.substring(0, 50) + '...');
    return [];
  }

  async exec(query) {
    console.log('Mock database exec:', query.substring(0, 50) + '...');
    return { changes: 0 };
  }

  async run(query, params) {
    console.log('Mock database run:', query.substring(0, 50) + '...');
    return { changes: 1, lastID: Date.now() };
  }
}

let db = null;

async function getDatabase() {
  if (!db) {
    try {
      // Try to use sqlite if available
      const sqlite3 = require('sqlite3').verbose();
      const { open } = require('sqlite');
      const path = require('path');
      
      const dbPath = path.join(process.cwd(), 'prisma', 'dev.db');
      db = await open({
        filename: dbPath,
        driver: sqlite3.Database
      });
      
      // Create tables if they don't exist
      await db.exec(`
        CREATE TABLE IF NOT EXISTS order_settlements (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          order_id TEXT NOT NULL,
          settlement_id TEXT NOT NULL,
          status TEXT NOT NULL,
          settlement_proof TEXT,
          settled_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        
        CREATE INDEX IF NOT EXISTS idx_order_settlements_order_id ON order_settlements(order_id);
      `);
      
      console.log('✅ SQLite database initialized');
    } catch (error) {
      console.warn('⚠️  SQLite not available, using mock database');
      db = new MockDatabase();
    }
  }
  
  return db;
}

module.exports = { getDatabase };