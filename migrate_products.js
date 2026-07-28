const pool = require('./db');

async function run() {
  try {
    await pool.query(`
      ALTER TABLE products
      ADD COLUMN IF NOT EXISTS product_code VARCHAR(100),
      ADD COLUMN IF NOT EXISTS variants JSONB DEFAULT '[]',
      ADD COLUMN IF NOT EXISTS reviews JSONB DEFAULT '[]';
    `);
    console.log("Migration complete");
  } catch (err) {
    console.error(err);
  } finally {
    process.exit();
  }
}
run();
