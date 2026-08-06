const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
});

async function sendOrderEmailToAdmin(orderNumber, total, address, items) {
  try {
    const addr = address || {};
    const itemRows = (items || []).map(i =>
      `<tr>
        <td style="padding:6px 8px;border-bottom:1px solid #f0e0c0">${i.product?.name || 'Item'}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #f0e0c0;text-align:center">${i.qty}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #f0e0c0;text-align:right">$${((i.variant?.price || i.product?.price || 0) * i.qty).toFixed(2)}</td>
      </tr>`
    ).join('');
    await transporter.sendMail({
      from: `"Houra Jewels" <${process.env.EMAIL_USER}>`,
      to: 'support@hourajewels.com',
      subject: `New Order Received - ${orderNumber}`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:24px;border:1px solid #f0e0c0;border-radius:12px">
          <h2 style="color:#08183A">🛍️ New Order — ${orderNumber}</h2>
          <p><strong>Total:</strong> $${total}</p>
          <h3 style="color:#b45309;margin-top:16px">Shipping Address</h3>
          <p style="margin:0">${addr.name || ''}</p>
          <p style="margin:0">${addr.line1 || ''}</p>
          <p style="margin:0">${[addr.city, addr.state, addr.pincode].filter(Boolean).join(', ')}</p>
          <p style="margin:0">${addr.country || ''}</p>
          <p style="margin:0">${addr.mobile || ''}</p>
          <h3 style="color:#b45309;margin-top:16px">Items</h3>
          <table style="width:100%;border-collapse:collapse;font-size:13px">
            <thead><tr style="background:#fff7ed">
              <th style="padding:6px 8px;text-align:left">Product</th>
              <th style="padding:6px 8px">Qty</th>
              <th style="padding:6px 8px;text-align:right">Price</th>
            </tr></thead>
            <tbody>${itemRows}</tbody>
          </table>
          <p style="margin-top:16px;color:#6b7280;font-size:12px">Check the admin dashboard for full details.</p>
        </div>
      `
    });
  } catch (err) {
    console.error('Email send failed:', err);
  }
}

module.exports = { transporter, sendOrderEmailToAdmin };
