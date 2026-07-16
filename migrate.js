const pool = require('./db');
async function migrate() {
  try {
    await pool.query('ALTER TABLE orders ADD COLUMN tracking_id VARCHAR(255);');
    await pool.query('ALTER TABLE orders ADD COLUMN tracking_link VARCHAR(255);');
    console.log("Migration successful");
  } catch (err) {
    console.error(err);
  } finally {
    process.exit();
  }
}
migrate();
