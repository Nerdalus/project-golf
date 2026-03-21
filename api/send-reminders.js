import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const resend = new Resend(process.env.RESEND_API_KEY);

export default async function handler(req, res) {
  const today = new Date();

  const { data: reminders, error } = await supabase
    .from('mot_reminders')
    .select('*');

  if (error) {
    console.error('Supabase fetch error', error);
    return res.status(500).json({ error: 'Failed to fetch reminders' });
  }

  for (const reminder of reminders) {
    const expiry = new Date(reminder.mot_expiry_date);
    const daysLeft = Math.ceil((expiry - today) / (1000 * 60 * 60 * 24));

    if (daysLeft === 30 && !reminder.sent_30) {
      await sendEmail(reminder, daysLeft);
      await markSent(reminder.id, 'sent_30');
    } else if (daysLeft === 14 && !reminder.sent_14) {
      await sendEmail(reminder, daysLeft);
      await markSent(reminder.id, 'sent_14');
    } else if (daysLeft === 7 && !reminder.sent_7) {
      await sendEmail(reminder, daysLeft);
      await markSent(reminder.id, 'sent_7');
    }
  }

  return res.status(200).json({ success: true });
}

async function sendEmail(reminder, daysLeft) {
  await resend.emails.send({
    from: 'CarRecall <reminders@www.carrecall.app>',
    to: reminder.email,
    subject: `Your MOT expires in ${daysLeft} days — ${reminder.reg}`,
    html: `
      <p>Hi,</p>
      <p>This is a reminder that the MOT for <strong>${reminder.reg}</strong> expires in <strong>${daysLeft} days</strong>.</p>
      <p>Don't leave it too late — book your MOT now to stay legal on the road.</p>
      <p><a href="https://www.www.carrecall.app">Check your MOT status at CarRecall</a></p>
      <p style="color:#888;font-size:12px;">You're receiving this because you signed up for Car Recalls at www.carrecall.app.</p>
    `,
  });
}

async function markSent(id, field) {
  await supabase
    .from('mot_reminders')
    .update({ [field]: true })
    .eq('id', id);
}