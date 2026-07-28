const router = require('express').Router();
const pool = require('../db');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
});

async function sendOrderEmailToAdmin(orderNumber, total) {
  try {
    await transporter.sendMail({
      from: `"Houra Jewels" <${process.env.EMAIL_USER}>`,
      to: 'kancharlahemanth89@gmail.com',
      subject: `New Order Received - ${orderNumber}`,
      html: `
        <h2>New Order Placed (Guest)!</h2>
        <p><strong>Order Number:</strong> ${orderNumber}</p>
        <p><strong>Total Amount:</strong> ₹${total}</p>
        <p>Please check the admin dashboard for more details.</p>
      `
    });
  } catch (err) {
    console.error('Email send failed:', err);
  }
}

// GET /api/general/db-test
router.get('/db-test', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.json({ time: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/general/categories
router.get('/categories', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM categories ORDER BY id ASC');
    res.json({ categories: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/general/products
router.get('/products', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM products WHERE is_active = true ORDER BY id DESC');
    res.json({ products: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/general/products/:id/reviews
router.post('/products/:id/reviews', async (req, res) => {
  const { name, rating, comment, color, size } = req.body;
  if (!name || !rating || !comment) {
    return res.status(400).json({ error: 'Name, rating, and comment are required' });
  }
  
  try {
    const productRes = await pool.query('SELECT reviews FROM products WHERE id = $1', [req.params.id]);
    if (productRes.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }
    
    let currentReviews = productRes.rows[0].reviews || [];
    if (typeof currentReviews === 'string') {
      try { currentReviews = JSON.parse(currentReviews); } catch(e) { currentReviews = []; }
    }
    
    const newReview = {
      name,
      rating: Number(rating),
      comment,
      color: color || null,
      size: size || null,
      date: new Date().toISOString()
    };
    
    currentReviews.push(newReview);
    
    await pool.query(
      'UPDATE products SET reviews = $1 WHERE id = $2',
      [JSON.stringify(currentReviews), req.params.id]
    );
    
    res.json({ success: true, review: newReview });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to submit review' });
  }
});

// POST /api/general/orders (Checkout)
router.post('/orders', async (req, res) => {
  const { items, address, total, coupon_code, payment_method, advance_paid, order_type } = req.body;
  
  if (!items || items.length === 0) {
    return res.status(400).json({ error: 'Cart is empty' });
  }

  try {
    const orderNumber = `ORD-${Date.now()}`;
    const itemsJson = JSON.stringify(items);
    const addressJson = JSON.stringify(address || {});
    const pMethod = payment_method || 'prepaid';
    const advancePaid = pMethod === 'cod' ? 100 : (parseFloat(total) || 0);
    const oType = order_type === 'pickup' ? 'pickup' : 'shipping';
    
    const result = await pool.query(
      `INSERT INTO orders (order_number, total, items, address, status, payment_method, advance_paid, order_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [orderNumber, total, itemsJson, addressJson, 'pending', pMethod, advancePaid, oType]
    );
    
    // Reduce Stock Logic
    for (const item of items) {
      if (item.product && item.product.id) {
        const prodRes = await pool.query('SELECT variants FROM products WHERE id=$1', [item.product.id]);
        let variants = [];
        try { variants = typeof prodRes.rows[0]?.variants === 'string' ? JSON.parse(prodRes.rows[0].variants) : (prodRes.rows[0]?.variants || []); } catch(e){}

        let updated = false;
        const itemColor = (item.variant?.color || item.product?.color || '').toString().toLowerCase().trim();
        const itemSize = (item.variant?.size || '').toString().trim();

        for (let v of variants) {
          const vColor = (v.color || '').toString().toLowerCase().trim();
          const colorMatch = !itemColor || !vColor || vColor === itemColor;
          if (colorMatch) {
            for (let s of (v.sizes || [])) {
              const sSize = (s.size || '').toString().trim();
              if (!itemSize || sSize === itemSize) {
                s.stock = Math.max(0, parseInt(s.stock || 0) - parseInt(item.qty || 1));
                updated = true;
              }
            }
          }
        }

        if (updated) {
          await pool.query('UPDATE products SET variants=$1 WHERE id=$2', [JSON.stringify(variants), item.product.id]);
        }
      }
    }

    // Mark coupon as used for one_time coupons (only for logged-in users)
    if (coupon_code) {
      const couponRes = await pool.query('SELECT * FROM coupons WHERE code=$1', [coupon_code]);
      const coupon = couponRes.rows[0];
      if (coupon && coupon.usage_type === 'one_time' && result.rows[0].user_id) {
        await pool.query(
          'UPDATE coupons SET used_by = array_append(COALESCE(used_by, \'{}\'), $1::int) WHERE id=$2',
          [result.rows[0].user_id, coupon.id]
        );
      }
    }

    // Send email to admin
    sendOrderEmailToAdmin(orderNumber, total);
    
    res.json({ success: true, order: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to place order' });
  }
});

// POST /api/general/razorpay/order
router.post('/razorpay/order', async (req, res) => {
  const { amount } = req.body;
  if (!amount) {
    return res.status(400).json({ error: 'Amount is required' });
  }

  try {
    const razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });

    const options = {
      amount: Math.round(amount * 100), // amount in the smallest currency unit
      currency: 'INR',
      receipt: `receipt_${Date.now()}`
    };

    const order = await razorpay.orders.create(options);
    res.json({ success: true, order });
  } catch (err) {
    console.error('Razorpay order creation error:', err);
    res.status(500).json({ error: 'Failed to create Razorpay order' });
  }
});

// POST /api/general/razorpay/verify
router.post('/razorpay/verify', async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({ error: 'Missing payment details' });
  }

  try {
    const generated_signature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(razorpay_order_id + '|' + razorpay_payment_id)
      .digest('hex');

    if (generated_signature === razorpay_signature) {
      res.json({ success: true, message: 'Payment verified successfully' });
    } else {
      res.status(400).json({ error: 'Invalid signature' });
    }
  } catch (err) {
    console.error('Razorpay verification error:', err);
    res.status(500).json({ error: 'Verification failed' });
  }
});

// GET /api/general/banners
router.get('/banners', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM banners WHERE is_active = true ORDER BY created_at DESC');
    res.json({ banners: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/general/validate-coupon
router.post('/validate-coupon', async (req, res) => {
  const { code, cartValue, cartQty, user_id } = req.body;
  try {
    const result = await pool.query('SELECT * FROM coupons WHERE code=$1 AND is_active=true', [code]);
    const coupon = result.rows[0];

    if (!coupon) return res.status(404).json({ error: 'Invalid or inactive coupon code' });

    if (coupon.user_id && String(coupon.user_id) !== String(user_id)) {
      return res.status(403).json({ error: 'This coupon is not valid for your account' });
    }

    if (coupon.expires_at && new Date() > new Date(coupon.expires_at)) {
      return res.status(400).json({ error: 'Coupon has expired' });
    }

    // One-time usage check
    if (coupon.usage_type === 'one_time') {
      if (!user_id) return res.status(400).json({ error: 'Please login to use this coupon' });
      const usedBy = (coupon.used_by || []).map(Number);
      if (usedBy.includes(parseInt(user_id))) {
        return res.status(400).json({ error: 'You have already used this coupon' });
      }
    }

    // Min requirement check
    if (coupon.min_type === 'qty') {
      if ((cartQty || 0) < (coupon.min_qty || 0)) {
        return res.status(400).json({ error: `Minimum ${coupon.min_qty} item(s) required for this coupon` });
      }
    } else {
      if ((cartValue || 0) < (coupon.min_order_value || 0)) {
        return res.status(400).json({ error: `Minimum order value for this coupon is ₹${coupon.min_order_value}` });
      }
    }

    res.json({ success: true, coupon });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/general/offers
router.get('/offers', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM offers WHERE is_active=true ORDER BY created_at DESC');
    res.json({ offers: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/general/shipping
router.get('/shipping', async (req, res) => {
  try {
    const [settingsRes, pincodesRes] = await Promise.all([
      pool.query('SELECT value FROM settings WHERE key = $1', ['shipping']),
      pool.query('SELECT pincode, percentage FROM shipping_pincodes ORDER BY pincode ASC')
    ]);
    const settings = settingsRes.rows[0]?.value || { flat_rate: 0, tax_mode: 'flat', tax_percentage: 0 };
    res.json({ settings, pincodes: pincodesRes.rows });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});
// GET /api/general/settings/announcement
router.get('/settings/announcement', async (req, res) => {
  try {
    const result = await pool.query('SELECT value FROM settings WHERE key = $1', ['announcement_bar']);
    if (result.rows.length > 0) {
      res.json({ announcement: result.rows[0].value });
    } else {
      res.json({ announcement: { text: '', is_active: false, link: '' } });
    }
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
