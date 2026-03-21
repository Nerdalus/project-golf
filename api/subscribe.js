import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { reg, email, motExpiryDate } = req.body ?? {};

  if (!reg || !email || !motExpiryDate) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const { error } = await supabase
    .from('mot_reminders')
    .upsert({ reg, email, mot_expiry_date: motExpiryDate }, { onConflict: 'reg,email' });

  if (error) {
    console.error('Supabase error', error);
    return res.status(500).json({ error: 'Failed to save reminder' });
  }

  return res.status(200).json({ success: true });
}