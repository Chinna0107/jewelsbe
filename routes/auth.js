const router = require('express').Router();
const pool = require('../db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const { OAuth2Client } = require('google-auth-library');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret';
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
});

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function sendOrderEmailToAdmin(orderNumber, total) {
  try {
    await transporter.sendMail({
      from: `"Houra Jewels" <${process.env.EMAIL_USER}>`,
      to: 'kancharlahemanth89@gmail.com',
      subject: `New Order Received - ${orderNumber}`,
      html: `
        <h2>New Order Placed (Auth User)!</h2>
        <p><strong>Order Number:</strong> ${orderNumber}</p>
        <p><strong>Total Amount:</strong> ₹${total}</p>
        <p>Please check the admin dashboard for more details.</p>
      `
    });
  } catch (err) {
    console.error('Email send failed:', err);
  }
}

async function sendOTPEmail(email, otp, name) {
  await transporter.sendMail({
    from: `"Houra Jewels" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: 'Your OTP for Houra Jewels Signup',
    html: `
      <div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:24px;border:1px solid #f0e0c0;border-radius:12px;">
        <h2 style="color:#b45309;">🙏 Welcome to Moksha Mandir</h2>
        <p>Hi <strong>${name}</strong>,</p>
        <p>Your OTP for account verification is:</p>
        <div style="font-size:36px;font-weight:bold;color:#ea580c;letter-spacing:8px;text-align:center;padding:16px;background:#fff7ed;border-radius:8px;margin:16px 0;">
          ${otp}
        </div>
        <p style="color:#6b7280;font-size:13px;">This OTP is valid for 10 minutes. Do not share it with anyone.</p>
      </div>
    `,
  });
}

// Middleware to verify JWT
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// POST /api/auth/signup - send OTP
router.post('/signup', async (req, res) => {
  const { name, email, phone, password } = req.body;
  if (!name || !email || !phone || !password)
    return res.status(400).json({ error: 'All fields are required' });

  try {
    const existing = await pool.query('SELECT id, is_verified FROM users WHERE email=$1', [email]);
    if (existing.rows.length && existing.rows[0].is_verified)
      return res.status(409).json({ error: 'Email already registered' });

    const hash = await bcrypt.hash(password, 10);
    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    if (existing.rows.length) {
      await pool.query(
        'UPDATE users SET name=$1, phone=$2, password_hash=$3 WHERE email=$4',
        [name, phone, hash, email]
      );
    } else {
      await pool.query(
        'INSERT INTO users (name, email, phone, password_hash) VALUES ($1,$2,$3,$4)',
        [name, email, phone, hash]
      );
    }

    await pool.query('DELETE FROM otps WHERE email=$1', [email]);
    await pool.query('INSERT INTO otps (email, otp, expires_at) VALUES ($1,$2,$3)', [email, otp, expiresAt]);

    await sendOTPEmail(email, otp, name);
    res.json({ message: 'OTP sent to your email' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/verify-otp
router.post('/verify-otp', async (req, res) => {
  const { email, otp } = req.body;
  if (!email || !otp) return res.status(400).json({ error: 'Email and OTP required' });

  try {
    const result = await pool.query(
      'SELECT * FROM otps WHERE email=$1 AND otp=$2 AND expires_at > NOW() ORDER BY created_at DESC LIMIT 1',
      [email, otp]
    );
    if (!result.rows.length) return res.status(400).json({ error: 'Invalid or expired OTP' });

    await pool.query('UPDATE users SET is_verified=TRUE WHERE email=$1', [email]);
    await pool.query('DELETE FROM otps WHERE email=$1', [email]);

    const user = await pool.query('SELECT id, name, email, phone, role FROM users WHERE email=$1', [email]);
    const u = user.rows[0];
    const token = jwt.sign({ id: u.id, email, role: u.role }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: u });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  try {
    const result = await pool.query('SELECT * FROM users WHERE email=$1', [email]);
    if (!result.rows.length) return res.status(401).json({ error: 'Invalid credentials' });

    const user = result.rows[0];
    if (!user.is_verified) return res.status(403).json({ error: 'Please verify your email first' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, phone: user.phone, role: user.role } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/google
router.post('/google', async (req, res) => {
  const { idToken } = req.body;
  if (!idToken) return res.status(400).json({ error: 'Access token required' });

  try {
    // We are passing access_token as idToken from frontend to avoid changing store signature
    const response = await require('axios').get('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${idToken}` }
    });
    const { email, name, picture } = response.data;

    if (!email) return res.status(400).json({ error: 'Email not found in Google account' });

    let result = await pool.query('SELECT * FROM users WHERE email=$1', [email]);
    let user;

    if (result.rows.length) {
      user = result.rows[0];
      // Update verified status and avatar if not already set
      if (!user.is_verified) {
        await pool.query('UPDATE users SET is_verified=TRUE, avatar_url=$1 WHERE id=$2', [picture, user.id]);
        user.is_verified = true;
        user.avatar_url = picture;
      }
    } else {
      // Create new user
      const insertRes = await pool.query(
        'INSERT INTO users (name, email, is_verified, avatar_url, role) VALUES ($1,$2,$3,$4,$5) RETURNING *',
        [name, email, true, picture, 'user']
      );
      user = insertRes.rows[0];
    }

    const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, phone: user.phone, role: user.role, avatar_url: user.avatar_url } });
  } catch (err) {
    console.error('Google Auth Error:', err);
    res.status(500).json({ error: 'Failed to authenticate with Google' });
  }
});

// GET /api/auth/profile
router.get('/profile', authMiddleware, async (req, res) => {
  try {
    const user = await pool.query(
      'SELECT id, name, email, phone, avatar_url, created_at FROM users WHERE id=$1',
      [req.user.id]
    );
    const addresses = await pool.query('SELECT * FROM addresses WHERE user_id=$1 ORDER BY is_default DESC', [req.user.id]);
    const orders = await pool.query('SELECT * FROM orders WHERE user_id=$1 ORDER BY created_at DESC', [req.user.id]);

    res.json({ user: user.rows[0], addresses: addresses.rows, orders: orders.rows });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/auth/profile
router.put('/profile', authMiddleware, async (req, res) => {
  const { name, phone } = req.body;
  try {
    const result = await pool.query(
      'UPDATE users SET name=$1, phone=$2 WHERE id=$3 RETURNING id, name, email, phone',
      [name, phone, req.user.id]
    );
    res.json({ user: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/address
router.post('/address', authMiddleware, async (req, res) => {
  const { name, line1, line2, city, state, pincode, mobile, is_default } = req.body;
  try {
    if (is_default) {
      await pool.query('UPDATE addresses SET is_default=FALSE WHERE user_id=$1', [req.user.id]);
    }
    const result = await pool.query(
      'INSERT INTO addresses (user_id, name, line1, line2, city, state, pincode, mobile, is_default) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',
      [req.user.id, name, line1, line2, city, state, pincode, mobile, is_default || false]
    );
    res.json({ address: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/orders
router.post('/orders', authMiddleware, async (req, res) => {
  const { items, address, total, coupon_code, payment_method, advance_paid, order_type, stripe_payment_intent_id } = req.body;

  if (!items || items.length === 0) {
    return res.status(400).json({ error: 'Cart is empty' });
  }

  try {
    const countRes = await pool.query(`SELECT COUNT(*) FROM orders`);
    const nextNum = parseInt(countRes.rows[0].count) + 1;
    const orderNumber = `HJ-${String(nextNum).padStart(6, '0')}`;
    const itemsJson = JSON.stringify(items);
    const addressJson = JSON.stringify(address || {});
    const pMethod = payment_method || 'prepaid';
    const advancePaid = pMethod === 'cod' ? 100 : (parseFloat(total) || 0);
    const oType = order_type === 'pickup' ? 'pickup' : 'shipping';

    const result = await pool.query(
      `INSERT INTO orders (user_id, order_number, total, items, address, status, payment_method, advance_paid, order_type, stripe_payment_intent_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [req.user.id, orderNumber, total, itemsJson, addressJson, 'pending', pMethod, advancePaid, oType, stripe_payment_intent_id || null]
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

    // Mark coupon as used for one_time coupons
    if (coupon_code && req.user?.id) {
      const couponRes = await pool.query('SELECT * FROM coupons WHERE code=$1', [coupon_code]);
      const coupon = couponRes.rows[0];
      if (coupon && coupon.usage_type === 'one_time') {
        await pool.query(
          'UPDATE coupons SET used_by = array_append(COALESCE(used_by, \'{}\'), $1::int) WHERE id=$2',
          [req.user.id, coupon.id]
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

// DELETE /api/auth/address/:id
router.delete('/address/:id', authMiddleware, async (req, res) => {
  try {
    await pool.query('DELETE FROM addresses WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    res.json({ message: 'Address deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/auth/change-password
router.put('/change-password', authMiddleware, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  try {
    const result = await pool.query('SELECT password_hash FROM users WHERE id=$1', [req.user.id]);
    const valid = await bcrypt.compare(currentPassword, result.rows[0].password_hash);
    if (!valid) return res.status(400).json({ error: 'Current password is incorrect' });
    const hash = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE users SET password_hash=$1 WHERE id=$2', [hash, req.user.id]);
    res.json({ message: 'Password changed' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/auth/me
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const user = await pool.query(
      'SELECT id, name, email, role FROM users WHERE id=$1',
      [req.user.id]
    );
    if (!user.rows.length) return res.status(404).json({ error: 'User not found' });
    res.json({ user: user.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});
// GET /api/auth/my-coupons
router.get('/my-coupons', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM coupons 
       WHERE is_active = true 
       AND (user_id IS NULL OR user_id = $1) 
       AND (expires_at IS NULL OR expires_at > NOW())
       AND (usage_type != 'one_time' OR NOT ($1::int = ANY(COALESCE(used_by, '{}'))))
       ORDER BY user_id NULLS LAST, created_at DESC`,
      [req.user.id]
    );
    res.json({ coupons: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/forgot-password — send OTP
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });
  try {
    const result = await pool.query('SELECT id, name FROM users WHERE email=$1', [email]);
    if (!result.rows[0]) return res.status(404).json({ error: 'No account found with this email' });
    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await pool.query('DELETE FROM otps WHERE email=$1', [email]);
    await pool.query('INSERT INTO otps (email, otp, expires_at) VALUES ($1,$2,$3)', [email, otp, expiresAt]);
    await transporter.sendMail({
      from: `"Houra Jewels" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: 'Reset Your Houra Jewels Password',
      html: `
        <div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:24px;border:1px solid #f0e0c0;border-radius:12px;">
          <h2 style="color:#b45309;">🔐 Password Reset</h2>
          <p>Hi <strong>${result.rows[0].name}</strong>,</p>
          <p>Your OTP to reset your password is:</p>
          <div style="font-size:36px;font-weight:bold;color:#ea580c;letter-spacing:8px;text-align:center;padding:16px;background:#fff7ed;border-radius:8px;margin:16px 0;">${otp}</div>
          <p style="color:#6b7280;font-size:13px;">Valid for 10 minutes. Do not share it with anyone.</p>
        </div>
      `,
    });
    res.json({ success: true, message: 'OTP sent to your email' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/reset-password — verify OTP + set new password
router.post('/reset-password', async (req, res) => {
  const { email, otp, newPassword } = req.body;
  if (!email || !otp || !newPassword) return res.status(400).json({ error: 'All fields required' });
  try {
    const otpRes = await pool.query('SELECT * FROM otps WHERE email=$1 AND otp=$2', [email, otp]);
    const record = otpRes.rows[0];
    if (!record) return res.status(400).json({ error: 'Invalid OTP' });
    if (new Date() > new Date(record.expires_at)) return res.status(400).json({ error: 'OTP expired' });
    const hash = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE users SET password_hash=$1 WHERE email=$2', [hash, email]);
    await pool.query('DELETE FROM otps WHERE email=$1', [email]);
    res.json({ success: true, message: 'Password reset successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.authMiddleware = authMiddleware;
