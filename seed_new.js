const pool = require('./db');

async function seed() {
  try {
    console.log('Clearing existing categories and products...');
    await pool.query('TRUNCATE TABLE products RESTART IDENTITY CASCADE');
    await pool.query('TRUNCATE TABLE categories RESTART IDENTITY CASCADE');

    const categories = [
      { name: 'Diyas', image_url: 'https://images.unsplash.com/photo-1596489370390-3487c6b5b487?w=500&auto=format&fit=crop' },
      { name: 'Idols', image_url: 'https://images.unsplash.com/photo-1579970876113-68d7e974e645?w=500&auto=format&fit=crop' },
      { name: 'Rudraksha', image_url: 'https://images.unsplash.com/photo-1627854659422-b5e158d601b6?w=500&auto=format&fit=crop' },
      { name: 'Pooja Kits', image_url: 'https://images.unsplash.com/photo-1575003666013-16a49c693452?w=500&auto=format&fit=crop' },
      { name: 'Agarbatti', image_url: 'https://images.unsplash.com/photo-1616853744654-20b12bc5c30b?w=500&auto=format&fit=crop' },
      { name: 'Bells', image_url: 'https://images.unsplash.com/photo-1610486842790-2ffaf76722c8?w=500&auto=format&fit=crop' },
      { name: 'Kumkum', image_url: 'https://images.unsplash.com/photo-1583091171780-454199fc698b?w=500&auto=format&fit=crop' },
      { name: 'Flowers', image_url: 'https://images.unsplash.com/photo-1560965384-9dbb562fbef1?w=500&auto=format&fit=crop' },
      { name: 'Camphor', image_url: 'https://images.unsplash.com/photo-1626071537233-a33716ee454e?w=500&auto=format&fit=crop' }
    ];

    console.log('Seeding categories...');
    for (const cat of categories) {
      await pool.query(
        'INSERT INTO categories (name, models, image_url) VALUES ($1, $2, $3)',
        [cat.name, '[]', cat.image_url]
      );
    }

    console.log('Seeding products...');
    const productsData = [
      {
        name: 'Brass Kuber Diya',
        description: 'Traditional brass diya for daily pooja.',
        category: 'Diyas',
        color: 'Gold',
        price: 250,
        image_url: 'https://images.unsplash.com/photo-1596489370390-3487c6b5b487?w=500&auto=format&fit=crop'
      },
      {
        name: 'Ganesha Idol (Small)',
        description: 'Beautifully crafted Lord Ganesha idol.',
        category: 'Idols',
        color: 'Antique Gold',
        price: 1500,
        image_url: 'https://images.unsplash.com/photo-1579970876113-68d7e974e645?w=500&auto=format&fit=crop'
      },
      {
        name: 'Panchamukhi Rudraksha',
        description: 'Original 5 Mukhi Rudraksha mala.',
        category: 'Rudraksha',
        color: 'Brown',
        price: 850,
        image_url: 'https://images.unsplash.com/photo-1627854659422-b5e158d601b6?w=500&auto=format&fit=crop'
      },
      {
        name: 'Complete Pooja Kit',
        description: 'All essential items for a complete pooja.',
        category: 'Pooja Kits',
        color: 'Mixed',
        price: 2100,
        image_url: 'https://images.unsplash.com/photo-1575003666013-16a49c693452?w=500&auto=format&fit=crop'
      },
      {
        name: 'Sandalwood Agarbatti',
        description: 'Premium quality sandalwood incense sticks.',
        category: 'Agarbatti',
        color: 'Brown',
        price: 120,
        image_url: 'https://images.unsplash.com/photo-1616853744654-20b12bc5c30b?w=500&auto=format&fit=crop'
      }
    ];

    for (const p of productsData) {
      const sizesJson = JSON.stringify([
        { size: 'Small', price: p.price },
        { size: 'Medium', price: p.price * 1.5 }
      ]);
      const imagesJson = JSON.stringify([p.image_url]);
      
      await pool.query(
        'INSERT INTO products (name, description, sizes, stock, image_url, images, color, category, is_active) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
        [p.name, p.description, sizesJson, 50, p.image_url, imagesJson, p.color, p.category, true]
      );
    }

    console.log('✅ Seeding complete!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Seeding failed:', err.message);
    process.exit(1);
  }
}

seed();
