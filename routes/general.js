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
      from: `"Moksha Mandir" <${process.env.EMAIL_USER}>`,
      to: 'sakethkotha48@gmail.com',
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

// POST /api/general/orders (Checkout)
router.post('/orders', async (req, res) => {
  const { items, address, total, coupon_code, payment_method, advance_paid } = req.body;
  
  if (!items || items.length === 0) {
    return res.status(400).json({ error: 'Cart is empty' });
  }

  try {
    const orderNumber = `ORD-${Date.now()}`;
    const itemsJson = JSON.stringify(items);
    const addressJson = JSON.stringify(address);
    const pMethod = payment_method || 'prepaid';
    const advancePaid = pMethod === 'cod' ? 100 : (parseFloat(total) || 0);
    
    const result = await pool.query(
      `INSERT INTO orders (order_number, total, items, address, status, payment_method, advance_paid)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [orderNumber, total, itemsJson, addressJson, 'pending', pMethod, advancePaid]
    );
    
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

module.exports = router;
