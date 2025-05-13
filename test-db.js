const { Client } = require('pg');

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // Required for Supabase
});

client.connect()
  .then(() => {
    console.log('✅ Connected to Supabase DB successfully');
    return client.end();
  })
  .catch(err => {
    console.error('❌ Failed to connect to DB:', err.message);
  });