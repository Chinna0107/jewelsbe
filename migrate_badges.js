const pool = require('./db');

async function migrate() {
  try {
    console.log('Migrating products table to add badges...');
    await pool.query(`
      ALTER TABLE products
      ADD COLUMN IF NOT EXISTS is_bestseller BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS is_trending BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS is_offer BOOLEAN DEFAULT FALSE;
    `);
    console.log('✅ Migration successful!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  }
}

migrate();
