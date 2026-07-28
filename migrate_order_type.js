const pool = require('./db');

async function run() {
  try {
    await pool.query(`
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_type VARCHAR(20) DEFAULT 'shipping';
    `);
    console.log("Migration complete: order_type added to orders");
  } catch (err) {
    console.error(err);
  } finally {
    process.exit();
  }
}
run();
