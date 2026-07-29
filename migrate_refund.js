const pool = require('./db');

async function migrate() {
  try {
    await pool.query(`
      ALTER TABLE orders
        ADD COLUMN IF NOT EXISTS stripe_payment_intent_id VARCHAR(255),
        ADD COLUMN IF NOT EXISTS refund_id VARCHAR(255),
        ADD COLUMN IF NOT EXISTS refund_amount NUMERIC(10,2),
        ADD COLUMN IF NOT EXISTS refund_breakdown JSONB,
        ADD COLUMN IF NOT EXISTS shipping_fee NUMERIC(10,2) DEFAULT 0,
        ADD COLUMN IF NOT EXISTS tax_amount NUMERIC(10,2) DEFAULT 0;
    `);
    console.log('✅ Refund columns added to orders table');
    process.exit(0);
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    process.exit(1);
  }
}

migrate();
