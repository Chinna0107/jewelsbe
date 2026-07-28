const pool = require('./db');

async function run() {
  try {
    await pool.query(`
      ALTER TABLE products
      ADD COLUMN IF NOT EXISTS details JSONB DEFAULT '[]';
    `);
    console.log("Migration complete");
  } catch (err) {
    console.error(err);
  } finally {
    process.exit();
  }
}
run();
