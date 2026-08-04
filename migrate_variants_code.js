const pool = require('./db');

async function migrateVariantsCode() {
  try {
    console.log('Starting migration to add code to product variants...');
    const result = await pool.query('SELECT id, variants, product_code FROM products');
    
    let updatedCount = 0;

    for (const row of result.rows) {
      let variants = row.variants;
      if (!variants || !Array.isArray(variants)) {
        continue;
      }

      let modified = false;
      const updatedVariants = variants.map((v, index) => {
        if (v && v.code === undefined) {
          modified = true;
          return {
            ...v,
            code: row.product_code ? `${row.product_code}-${v.color || index}` : ''
          };
        }
        return v;
      });

      if (modified) {
        await pool.query('UPDATE products SET variants = $1 WHERE id = $2', [JSON.stringify(updatedVariants), row.id]);
        updatedCount++;
      }
    }

    console.log(`Migration completed successfully! Updated ${updatedCount} products.`);
  } catch (err) {
    console.error('Migration failed:', err);
  } finally {
    process.exit(0);
  }
}

migrateVariantsCode();
