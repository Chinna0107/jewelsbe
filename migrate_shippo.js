const pool = require('./db');

async function runMigration() {
  try {
    console.log('Adding Shippo columns to orders table...');
    await pool.query(`
      ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS tracking_number VARCHAR(255),
      ADD COLUMN IF NOT EXISTS tracking_url TEXT,
      ADD COLUMN IF NOT EXISTS shipping_label_url TEXT;
    `);
    console.log('Migration successful.');
  } catch (err) {
    console.error('Migration failed:', err);
  } finally {
    pool.end();
  }
}

runMigration();
