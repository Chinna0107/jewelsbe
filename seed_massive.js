const pool = require('./db');

async function seedMassive() {
  try {
    console.log('Adding is_festive column if it does not exist...');
    await pool.query('ALTER TABLE products ADD COLUMN IF NOT EXISTS is_festive BOOLEAN DEFAULT FALSE');

    const categories = [
      'Diyas', 'Idols', 'Rudraksha', 'Pooja Kits', 
      'Agarbatti', 'Bells', 'Kumkum', 'Flowers', 'Camphor'
    ];

    const materials = ['Brass', 'Copper', 'Silver-plated', 'Gold-plated', 'Panchaloha', 'Clay', 'Sandalwood', 'Marble', 'Crystal'];
    const adjectives = ['Premium', 'Traditional', 'Antique', 'Designer', 'Auspicious', 'Handcrafted', 'Sacred', 'Royal', 'Divine'];

    console.log('Generating products...');
    const allProducts = [];

    for (const cat of categories) {
      // Create exactly 10 products for this category
      for (let i = 1; i <= 10; i++) {
        const material = materials[Math.floor(Math.random() * materials.length)];
        const adjective = adjectives[Math.floor(Math.random() * adjectives.length)];
        const name = `${adjective} ${material} ${cat} ${i}`;
        const description = `This is a beautifully crafted ${name}, perfect for your daily prayers and special occasions. Made with high-quality materials to ensure lasting elegance.`;
        
        // Randomly assign flags (about 20-30% chance for each)
        const is_bestseller = Math.random() < 0.3;
        const is_trending = Math.random() < 0.3;
        const is_festive = Math.random() < 0.3;
        const is_offer = Math.random() < 0.2;

        const basePrice = Math.floor(Math.random() * 2000) + 200; // 200 to 2200

        let imageUrl = '';
        // Assign a default image URL based on category
        switch(cat) {
          case 'Diyas': imageUrl = 'https://images.unsplash.com/photo-1596489370390-3487c6b5b487?w=500&auto=format&fit=crop'; break;
          case 'Idols': imageUrl = 'https://images.unsplash.com/photo-1579970876113-68d7e974e645?w=500&auto=format&fit=crop'; break;
          case 'Rudraksha': imageUrl = 'https://images.unsplash.com/photo-1627854659422-b5e158d601b6?w=500&auto=format&fit=crop'; break;
          case 'Pooja Kits': imageUrl = 'https://images.unsplash.com/photo-1575003666013-16a49c693452?w=500&auto=format&fit=crop'; break;
          case 'Agarbatti': imageUrl = 'https://images.unsplash.com/photo-1616853744654-20b12bc5c30b?w=500&auto=format&fit=crop'; break;
          case 'Bells': imageUrl = 'https://images.unsplash.com/photo-1610486842790-2ffaf76722c8?w=500&auto=format&fit=crop'; break;
          case 'Kumkum': imageUrl = 'https://images.unsplash.com/photo-1583091171780-454199fc698b?w=500&auto=format&fit=crop'; break;
          case 'Flowers': imageUrl = 'https://images.unsplash.com/photo-1560965384-9dbb562fbef1?w=500&auto=format&fit=crop'; break;
          case 'Camphor': imageUrl = 'https://images.unsplash.com/photo-1626071537233-a33716ee454e?w=500&auto=format&fit=crop'; break;
          default: imageUrl = 'https://images.unsplash.com/photo-1596489370390-3487c6b5b487?w=500&auto=format&fit=crop';
        }

        allProducts.push({
          name,
          description,
          category: cat,
          color: material,
          price: basePrice,
          image_url: imageUrl,
          is_bestseller,
          is_trending,
          is_festive,
          is_offer
        });
      }
    }

    console.log(`Inserting ${allProducts.length} products...`);
    for (const p of allProducts) {
      const sizesJson = JSON.stringify([
        { size: 'Standard', price: p.price },
        { size: 'Large', price: Math.floor(p.price * 1.5) }
      ]);
      const imagesJson = JSON.stringify([p.image_url]);
      
      await pool.query(
        'INSERT INTO products (name, description, sizes, stock, image_url, images, color, category, is_active, is_bestseller, is_trending, is_festive, is_offer) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)',
        [p.name, p.description, sizesJson, 100, p.image_url, imagesJson, p.color, p.category, true, p.is_bestseller, p.is_trending, p.is_festive, p.is_offer]
      );
    }

    console.log('✅ Massive seeding complete!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Seeding failed:', err.message);
    process.exit(1);
  }
}

seedMassive();
