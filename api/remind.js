// /api/remind.js
// Stub — wire up to your email provider (Resend, Postmark, etc.)
// Receives: { email: string, reg: string }
// Store in DB / queue a reminder job 30 days before MOT expiry

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email, reg } = req.body ?? {};
  if (!email || !reg) {
    return res.status(400).json({ error: 'Missing email or reg' });
  }

  // TODO: persist { email, reg, createdAt } to your store (e.g. Vercel KV, PlanetScale, Supabase)
  // TODO: schedule reminder email 30 days before motExpiryDate

  console.log(`Reminder requested: ${reg} → ${email}`);
  return res.status(200).json({ ok: true });
}
