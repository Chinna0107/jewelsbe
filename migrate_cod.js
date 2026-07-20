const pool = require('./db');

async function migrate() {
  console.log('Running COD migration...');
  try {
    await pool.query(`
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_method VARCHAR(20) DEFAULT 'prepaid';
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS advance_paid NUMERIC(10,2) DEFAULT 0;
    `);
    console.log('✅ Migration complete: payment_method and advance_paid columns added to orders table');
    process.exit(0);
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    process.exit(1);
  }
}

migrate();
