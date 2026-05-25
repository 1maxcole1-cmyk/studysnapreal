export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    return res.status(500).json({ error: 'Payment system is not set up yet. Please try again later.' });
  }

  try {
    const { email } = req.body || {};
    if (!email || !/.+@.+\..+/.test(email)) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }

    const auth = { headers: { Authorization: 'Bearer ' + key } };
    const clean = email.trim().toLowerCase();

    // Find Stripe customers with this email
    const custRes = await fetch(
      'https://api.stripe.com/v1/customers?limit=20&email=' + encodeURIComponent(clean),
      auth
    );
    if (!custRes.ok) {
      console.error('Stripe customers error:', await custRes.text());
      return res.status(502).json({ error: 'Could not reach the payment system. Please try again.' });
    }
    const customers = (await custRes.json()).data || [];

    // Check each customer for an active subscription
    let plan = 'free';
    for (const c of customers) {
      const subRes = await fetch(
        'https://api.stripe.com/v1/subscriptions?status=active&limit=20&customer=' + c.id,
        auth
      );
      if (!subRes.ok) continue;
      const subs = (await subRes.json()).data || [];
      for (const sub of subs) {
        const item = sub.items && sub.items.data && sub.items.data[0];
        const amount = item && item.price ? (item.price.unit_amount || 0) : 0;
        // Higher-priced plan = Premium; any other paid plan = Pro
        if (amount >= 700) plan = 'premium';
        else if (amount > 0 && plan !== 'premium') plan = 'pro';
      }
    }

    return res.status(200).json({ plan });
  } catch (err) {
    console.error('check-subscription error:', err);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
}
