const pool = require('./db');

async function seed() {
  try {
    console.log('Seeding categories and products...');

    // Clean existing
    await pool.query('DELETE FROM products');
    await pool.query('DELETE FROM categories');

    // 1. Insert Categories
    const catResult = await pool.query(`
      INSERT INTO categories (name, models, image_url)
      VALUES 
        ('Snacks', '["Mixture", "Murukku"]', 'https://res.cloudinary.com/rhprdf7l/image/upload/v1/snacks.jpg'),
        ('Sweets', '["Ladoo", "Halwa"]', 'https://res.cloudinary.com/rhprdf7l/image/upload/v1/sweets.jpg'),
        ('Pickles', '["Mango", "Tomato"]', 'https://res.cloudinary.com/rhprdf7l/image/upload/v1/pickles.jpg')
      RETURNING *;
    `);

    console.log('Categories seeded:', catResult.rowCount);

    // 2. Insert Products
    const productsData = [
      {
        name: 'Spicy Mixture',
        description: 'Authentic Andhra style spicy mixture with premium peanuts and garlic.',
        category: 'Snacks',
        model: 'Mixture',
        sizes: JSON.stringify([{ size: '250g', price: 120 }, { size: '500g', price: 220 }, { size: '1kg', price: 400 }]),
        image_url: 'https://res.cloudinary.com/rhprdf7l/image/upload/v1/mixture.jpg'
      },
      {
        name: 'Ghee Boondi Ladoo',
        description: 'Melt-in-mouth boondi ladoo made with pure desi ghee.',
        category: 'Sweets',
        model: 'Ladoo',
        sizes: JSON.stringify([{ size: '250g', price: 180 }, { size: '500g', price: 340 }]),
        image_url: 'https://res.cloudinary.com/rhprdf7l/image/upload/v1/ladoo.jpg'
      },
      {
        name: 'Avakaya Mango Pickle',
        description: 'Traditional summer special raw mango pickle mixed with mustard powder and sesame oil.',
        category: 'Pickles',
        model: 'Mango',
        sizes: JSON.stringify([{ size: '250g', price: 150 }, { size: '500g', price: 280 }]),
        image_url: 'https://res.cloudinary.com/rhprdf7l/image/upload/v1/mango.jpg'
      }
    ];

    for (let p of productsData) {
      await pool.query(`
        INSERT INTO products (name, description, category, model, sizes, image_url, stock, is_active)
        VALUES ($1, $2, $3, $4, $5, $6, 100, true)
      `, [p.name, p.description, p.category, p.model, p.sizes, p.image_url]);
    }
    
    console.log('Products seeded:', productsData.length);
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

seed();
