const pool = require('./db');

async function migrate() {
  await pool.query(`
    ALTER TABLE coupons 
    ADD COLUMN IF NOT EXISTS usage_type VARCHAR(20) DEFAULT 'multiple',
    ADD COLUMN IF NOT EXISTS min_type VARCHAR(20) DEFAULT 'amount',
    ADD COLUMN IF NOT EXISTS min_qty INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS used_by INTEGER[] DEFAULT '{}'
  `);
  console.log('Coupons migration done');
  pool.end();
}

migrate().catch(e => { console.error(e.message); pool.end(); });
