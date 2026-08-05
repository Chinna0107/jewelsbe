const pool = require('./db');
async function migrate() {
  await pool.query(`ALTER TABLE otps ADD COLUMN IF NOT EXISTS type VARCHAR(10) DEFAULT 'email'`);
  console.log('otps migration done');
  pool.end();
}
migrate().catch(e => { console.error(e.message); pool.end(); });
