const router = require('express').Router();
const pool = require('../db');
const { authMiddleware } = require('./auth');

function adminOnly(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin access only' });
  next();
}

// GET /api/admin/dashboard/stats
router.get('/dashboard/stats', authMiddleware, adminOnly, async (req, res) => {
  try {
    const [users, orders, revenue] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM users WHERE role=$1', ['user']),
      pool.query('SELECT COUNT(*) FROM orders'),
      pool.query("SELECT COALESCE(SUM(total),0) as total FROM orders WHERE status != 'cancelled'"),
    ]);
    res.json({
      totalUsers: parseInt(users.rows[0].count),
      totalOrders: parseInt(orders.rows[0].count),
      totalRevenue: parseFloat(revenue.rows[0].total),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/users
router.get('/users', authMiddleware, adminOnly, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, email, phone, role, is_verified, created_at FROM users ORDER BY created_at DESC'
    );
    res.json({ users: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/admin/users/:id
router.delete('/users/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    await pool.query('DELETE FROM users WHERE id=$1 AND role != $2', [req.params.id, 'admin']);
    res.json({ message: 'User deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/orders
router.get('/orders', authMiddleware, adminOnly, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT o.*, u.name as user_name, u.email as user_email
       FROM orders o LEFT JOIN users u ON o.user_id = u.id
       ORDER BY o.created_at DESC`
    );
    res.json({ orders: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/admin/orders/:id/status
router.put('/orders/:id/status', authMiddleware, adminOnly, async (req, res) => {
  const { status } = req.body;
  try {
    const result = await pool.query(
      'UPDATE orders SET status=$1 WHERE id=$2 RETURNING *',
      [status, req.params.id]
    );
    res.json({ order: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/orders/:id/refund
const Stripe = require('stripe');
router.post('/orders/:id/refund', authMiddleware, adminOnly, async (req, res) => {
  const { refund_breakdown } = req.body;
  try {
    const orderRes = await pool.query('SELECT * FROM orders WHERE id=$1', [req.params.id]);
    const order = orderRes.rows[0];
    if (!order) return res.status(404).json({ error: 'Order not found' });

    const refundAmount = parseFloat(refund_breakdown?.total) || parseFloat(order.total) || 0;

    // Only attempt Stripe refund if paid via Stripe and has a payment intent
    let refundId = null;
    if (order.stripe_payment_intent_id) {
      const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
      const refund = await stripe.refunds.create({
        payment_intent: order.stripe_payment_intent_id,
        amount: Math.round(refundAmount * 100), // cents
      });
      refundId = refund.id;
    } else {
      // No payment intent stored — mark as manual refund
      refundId = `MANUAL-${Date.now()}`;
    }

    // Update order: cancelled + store refund info
    await pool.query(
      `UPDATE orders SET status='cancelled', refund_id=$1, refund_amount=$2, refund_breakdown=$3 WHERE id=$4`,
      [refundId, refundAmount, JSON.stringify(refund_breakdown || {}), req.params.id]
    );

    res.json({ success: true, refund_id: refundId, amount: refundAmount });
  } catch (err) {
    console.error('Refund error:', err);
    res.status(500).json({ error: err.message });
  }
});

const shiprocket = require('../utils/shiprocket');

// POST /api/admin/orders/:id/ship
router.post('/orders/:id/ship', authMiddleware, adminOnly, async (req, res) => {
  try {
    const orderRes = await pool.query('SELECT * FROM orders WHERE id=$1', [req.params.id]);
    const order = orderRes.rows[0];
    if (!order) return res.status(404).json({ error: 'Order not found' });

    let items = [];
    try { items = typeof order.items === 'string' ? JSON.parse(order.items) : (order.items || []); } catch(e) {}
    
    let address = {};
    try { address = typeof order.address === 'string' ? JSON.parse(order.address) : (order.address || {}); } catch(e) {}

    const orderItems = items.map(item => ({
      name: item.product?.name || 'Product',
      sku: item.variant?.size || 'Default',
      units: item.qty || 1,
      selling_price: item.variant?.price || item.product?.price || 0,
    }));

    const shiprocketPayload = {
      order_id: order.order_number || order.id.toString(),
      order_date: new Date(order.created_at).toISOString().split('T')[0],
      billing_customer_name: address.name || 'Customer',
      billing_last_name: '',
      billing_address: address.line1 || 'No Address',
      billing_city: address.city || 'City',
      billing_pincode: address.pincode || '110001',
      billing_state: address.state || 'State',
      billing_country: 'India',
      billing_email: order.user_email || 'test@test.com',
      billing_phone: order.user_phone || address.mobile || '9999999999',
      shipping_is_billing: true,
      order_items: orderItems,
      payment_method: order.payment_method === 'cod' ? 'COD' : 'Prepaid',
      sub_total: order.payment_method === 'cod' ? (order.total - (order.advance_paid || 0)) : order.total,
      length: 10,
      breadth: 10,
      height: 10,
      weight: 0.5
    };

    // 1. Create Custom Order in Shiprocket
    const srOrder = await shiprocket.createCustomOrder(shiprocketPayload);
    const shipmentId = srOrder.shipment_id || srOrder.payload?.shipment_id;
    if (!shipmentId) throw new Error('Shiprocket did not return a shipment_id');

    // 2. Generate AWB
    const awbRes = await shiprocket.assignAWB(shipmentId);
    const awbCode = awbRes.response?.data?.awb_code || awbRes.awb_code;

    // 3. Save to database
    await pool.query(
      'UPDATE orders SET tracking_id=$1, tracking_link=$2, status=$3 WHERE id=$4',
      [awbCode, `https://shiprocket.co/tracking/${awbCode}`, 'shipped', req.params.id]
    );

    res.json({ awb: awbCode, tracking_link: `https://shiprocket.co/tracking/${awbCode}` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// --- Products ---
router.get('/products', authMiddleware, adminOnly, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM products ORDER BY created_at DESC');
    res.json({ products: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/products', authMiddleware, adminOnly, async (req, res) => {
    const { name, description, stock, sizes, image_url, images, color, category, model, is_active, is_bestseller, is_trending, is_offer, is_festive, product_code, variants, reviews, details } = req.body;
    
    // Validate sizes/variants
    if ((!sizes || !Array.isArray(sizes) || sizes.length === 0) && (!variants || !Array.isArray(variants) || variants.length === 0)) {
      return res.status(400).json({ error: 'At least one size or variant with price is required.' });
    }

    try {
    const result = await pool.query(
      `INSERT INTO products 
       (name, description, stock, sizes, image_url, images, color, category, model, is_active, is_bestseller, is_trending, is_offer, is_festive, product_code, variants, reviews, details) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18) RETURNING *`,
      [
        name, description, stock, JSON.stringify(sizes || []), image_url, 
        JSON.stringify(images || []), color, category, model, 
        is_active ?? true,
        is_bestseller ?? false,
        is_trending ?? false,
        is_offer ?? false,
        is_festive ?? false,
        product_code || null,
        JSON.stringify(variants || []),
        JSON.stringify(reviews || []),
        JSON.stringify(details || [])
      ]
    );
    res.json({ product: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/products/:id', authMiddleware, adminOnly, async (req, res) => {
  const { name, description, sizes, stock, image_url, images, color, category, model, is_active, is_bestseller, is_trending, is_offer, is_festive, product_code, variants, reviews, details } = req.body;
  try {
    const sizesJson = Array.isArray(sizes) ? JSON.stringify(sizes) : '[]';
    const imagesJson = Array.isArray(images) ? JSON.stringify(images) : (image_url ? JSON.stringify([image_url]) : '[]');
    const variantsJson = Array.isArray(variants) ? JSON.stringify(variants) : '[]';
    const reviewsJson = Array.isArray(reviews) ? JSON.stringify(reviews) : '[]';
    const detailsJson = Array.isArray(details) ? JSON.stringify(details) : '[]';
    const result = await pool.query(
      'UPDATE products SET name=$1, description=$2, sizes=$3, stock=$4, image_url=$5, images=$6, color=$7, category=$8, model=$9, is_active=$10, is_bestseller=$11, is_trending=$12, is_offer=$13, is_festive=$14, product_code=$15, variants=$16, reviews=$17, details=$18 WHERE id=$19 RETURNING *',
      [name, description, sizesJson, stock, image_url, imagesJson, color, category, model || null, is_active, is_bestseller, is_trending, is_offer, is_festive, product_code || null, variantsJson, reviewsJson, detailsJson, req.params.id]
    );
    res.json({ product: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/products/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    await pool.query('DELETE FROM products WHERE id=$1', [req.params.id]);
    res.json({ message: 'Product deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Banners ---
router.get('/banners', authMiddleware, adminOnly, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM banners ORDER BY created_at DESC');
    res.json({ banners: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/banners', authMiddleware, adminOnly, async (req, res) => {
  const { title, image_url, link_url, is_active } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO banners (title, image_url, link_url, is_active) VALUES ($1, $2, $3, $4) RETURNING *',
      [title, image_url, link_url, is_active ?? true]
    );
    res.json({ banner: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/banners/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    await pool.query('DELETE FROM banners WHERE id=$1', [req.params.id]);
    res.json({ message: 'Banner deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Coupons ---
router.get('/coupons', authMiddleware, adminOnly, async (req, res) => {
  try {
    const result = await pool.query('SELECT c.*, u.name as user_name FROM coupons c LEFT JOIN users u ON c.user_id = u.id ORDER BY c.created_at DESC');
    res.json({ coupons: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/coupons', authMiddleware, adminOnly, async (req, res) => {
  const { code, discount_type, discount_value, min_order_value, is_active, expires_at, user_id, usage_type, min_type, min_qty } = req.body;
  try {
    const validExpiresAt = expires_at === '' ? null : expires_at;
    const targetUserId = user_id && user_id !== 'all' ? user_id : null;
    const result = await pool.query(
      'INSERT INTO coupons (code, discount_type, discount_value, min_order_value, is_active, expires_at, user_id, usage_type, min_type, min_qty) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',
      [code, discount_type || 'percentage', discount_value || 0, min_order_value || 0, is_active ?? true, validExpiresAt, targetUserId, usage_type || 'multiple', min_type || 'amount', min_qty || 0]
    );
    res.json({ coupon: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/coupons/:id', authMiddleware, adminOnly, async (req, res) => {
  const { code, discount_type, discount_value, min_order_value, is_active, expires_at, user_id, usage_type, min_type, min_qty } = req.body;
  try {
    const validExpiresAt = expires_at === '' ? null : expires_at;
    const targetUserId = user_id && user_id !== 'all' ? user_id : null;
    const result = await pool.query(
      'UPDATE coupons SET code=$1, discount_type=$2, discount_value=$3, min_order_value=$4, is_active=$5, expires_at=$6, user_id=$7, usage_type=$8, min_type=$9, min_qty=$10 WHERE id=$11 RETURNING *',
      [code, discount_type || 'percentage', discount_value || 0, min_order_value || 0, is_active ?? true, validExpiresAt, targetUserId, usage_type || 'multiple', min_type || 'amount', min_qty || 0, req.params.id]
    );
    res.json({ coupon: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/coupons/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    await pool.query('DELETE FROM coupons WHERE id=$1', [req.params.id]);
    res.json({ message: 'Coupon deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- CATEGORIES ---

// GET /api/admin/categories
router.get('/categories', authMiddleware, adminOnly, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM categories ORDER BY id ASC');
    res.json({ categories: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/admin/categories
router.post('/categories', authMiddleware, adminOnly, async (req, res) => {
  const { name, models, image_url } = req.body;
  try {
    const modelsJson = Array.isArray(models) ? JSON.stringify(models) : '[]';
    const result = await pool.query(
      'INSERT INTO categories (name, models, image_url) VALUES ($1, $2, $3) RETURNING *',
      [name, modelsJson, image_url]
    );
    res.json({ category: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/admin/categories/:id
router.put('/categories/:id', authMiddleware, adminOnly, async (req, res) => {
  const { name, models, image_url } = req.body;
  try {
    const modelsJson = Array.isArray(models) ? JSON.stringify(models) : '[]';
    const result = await pool.query(
      'UPDATE categories SET name=$1, models=$2, image_url=$3 WHERE id=$4 RETURNING *',
      [name, modelsJson, image_url, req.params.id]
    );
    res.json({ category: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/admin/categories/:id
router.delete('/categories/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    await pool.query('DELETE FROM categories WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});
// ================== OFFERS ==================

// GET /api/admin/offers
router.get('/offers', authMiddleware, adminOnly, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM offers ORDER BY created_at DESC');
    res.json({ offers: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/admin/offers
router.post('/offers', authMiddleware, adminOnly, async (req, res) => {
  const { title, discount_percentage, is_active } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO offers (title, discount_percentage, is_active) VALUES ($1, $2, $3) RETURNING *',
      [title, discount_percentage, is_active ?? true]
    );
    res.json({ offer: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/admin/offers/:id
router.put('/offers/:id', authMiddleware, adminOnly, async (req, res) => {
  const { title, discount_percentage, is_active } = req.body;
  try {
    const result = await pool.query(
      'UPDATE offers SET title=$1, discount_percentage=$2, is_active=$3 WHERE id=$4 RETURNING *',
      [title, discount_percentage, is_active, req.params.id]
    );
    res.json({ offer: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/admin/offers/:id
router.delete('/offers/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    await pool.query('DELETE FROM offers WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/admin/offers/:id/apply
router.post('/offers/:id/apply', authMiddleware, adminOnly, async (req, res) => {
  const { category, productIds } = req.body;
  try {
    if (category) {
      await pool.query('UPDATE products SET offer_id=$1 WHERE category=$2', [req.params.id, category]);
    } else if (productIds && productIds.length > 0) {
      await pool.query('UPDATE products SET offer_id=$1 WHERE id = ANY($2)', [req.params.id, productIds]);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});
// GET /api/admin/settings/shipping
router.get('/settings/shipping', authMiddleware, adminOnly, async (req, res) => {
  try {
    const result = await pool.query('SELECT value FROM settings WHERE key = $1', ['shipping']);
    const settings = result.rows[0]?.value || { flat_rate: 0, tax_mode: 'flat', tax_percentage: 0 };
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/admin/settings/shipping
router.post('/settings/shipping', authMiddleware, adminOnly, async (req, res) => {
  try {
    const existing = await pool.query('SELECT value FROM settings WHERE key = $1', ['shipping']);
    const current = existing.rows[0]?.value || {};
    const merged = { ...current, ...req.body };
    if (merged.flat_rate !== undefined) merged.flat_rate = parseFloat(merged.flat_rate) || 0;
    if (merged.tax_percentage !== undefined) merged.tax_percentage = parseFloat(merged.tax_percentage) || 0;
    if (merged.tax_mode !== undefined) merged.tax_mode = merged.tax_mode === 'pincode' ? 'pincode' : 'flat';
    await pool.query(
      'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()',
      ['shipping', JSON.stringify(merged)]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/admin/shipping-pincodes
router.get('/shipping-pincodes', authMiddleware, adminOnly, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM shipping_pincodes ORDER BY created_at DESC');
    res.json({ pincodes: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/admin/shipping-pincodes
router.post('/shipping-pincodes', authMiddleware, adminOnly, async (req, res) => {
  const { pincode, percentage } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO shipping_pincodes (pincode, percentage) VALUES ($1, $2) RETURNING *',
      [pincode, percentage]
    );
    res.json({ pincode: result.rows[0] });
  } catch (err) {
    // 23505 is unique violation
    if (err.code === '23505') return res.status(400).json({ error: 'Pincode already exists' });
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/admin/shipping-pincodes/:id
router.delete('/shipping-pincodes/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    await pool.query('DELETE FROM shipping_pincodes WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/admin/settings/announcement
router.get('/settings/announcement', authMiddleware, adminOnly, async (req, res) => {
  try {
    const result = await pool.query('SELECT value FROM settings WHERE key = $1', ['announcement_bar']);
    if (result.rows.length > 0) {
      res.json({ announcement: result.rows[0].value });
    } else {
      res.json({ announcement: { text: '', is_active: false, link: '' } });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/admin/settings/announcement
router.post('/settings/announcement', authMiddleware, adminOnly, async (req, res) => {
  const { text, is_active, link, items } = req.body;
  try {
    const value = JSON.stringify({ text, is_active, link, items: items || [] });
    await pool.query(
      `INSERT INTO settings (key, value) VALUES ('announcement_bar', $1)
       ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
      [value]
    );
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// --- REVIEWS ---

// GET /api/admin/reviews
router.get('/reviews', authMiddleware, adminOnly, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM reviews ORDER BY created_at DESC');
    res.json({ reviews: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/reviews
router.post('/reviews', authMiddleware, adminOnly, async (req, res) => {
  const { name, rating, review, is_active } = req.body;
  if (!name || !review) return res.status(400).json({ error: 'Name and review are required' });
  try {
    const result = await pool.query(
      'INSERT INTO reviews (name, rating, review, is_active) VALUES ($1, $2, $3, $4) RETURNING *',
      [name, rating || 5, review, is_active ?? true]
    );
    res.json({ review: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/admin/reviews/:id
router.put('/reviews/:id', authMiddleware, adminOnly, async (req, res) => {
  const { name, rating, review, is_active } = req.body;
  try {
    const result = await pool.query(
      'UPDATE reviews SET name=$1, rating=$2, review=$3, is_active=$4 WHERE id=$5 RETURNING *',
      [name, rating || 5, review, is_active ?? true, req.params.id]
    );
    res.json({ review: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/admin/reviews/:id
router.delete('/reviews/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    await pool.query('DELETE FROM reviews WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/settings/shipping-rate
router.post('/settings/shipping-rate', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { shipping_rate } = req.body;
    const existing = await pool.query('SELECT value FROM settings WHERE key=$1', ['shipping']);
    const current = existing.rows[0]?.value || {};
    const merged = { ...current, shipping_rate: parseFloat(shipping_rate) || 0 };
    await pool.query(
      'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value=$2, updated_at=NOW()',
      ['shipping', JSON.stringify(merged)]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/settings/tax
router.post('/settings/tax', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { tax_percentage } = req.body;
    const existing = await pool.query('SELECT value FROM settings WHERE key=$1', ['shipping']);
    const current = existing.rows[0]?.value || {};
    const merged = { ...current, tax_percentage: parseFloat(tax_percentage) || 0 };
    await pool.query(
      'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value=$2, updated_at=NOW()',
      ['shipping', JSON.stringify(merged)]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
