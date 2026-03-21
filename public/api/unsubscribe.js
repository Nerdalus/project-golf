import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  const { reg, email } = req.query;

  if (!reg || !email) {
    return res.status(400).send('Invalid unsubscribe link.');
  }

  const { error } = await supabase
    .from('recall_subscribers')
    .delete()
    .eq('registration', reg.toUpperCase())
    .eq('email', email);

  if (error) {
    console.error('Unsubscribe error', error);
    return res.status(500).send('Something went wrong. Please email business@alphapariah.studio to be removed.');
  }

  // Redirect to a simple confirmation page
  return res.redirect(302, '/unsubscribed.html');
}
