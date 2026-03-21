import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = 'CarRecall <alerts@carrecall.app>';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { registration, email } = req.body ?? {};

  if (!registration || !email) {
    return res.status(400).json({ error: 'Missing registration or email' });
  }

  const reg = registration.toUpperCase().replace(/\s/g, '');

  // 1. Check DVSA recall API
  let recalls = [];
  try {
    const dvsa = await fetch(
      `https://driver-vehicle-standards.api.gov.uk/v1/recalls/${reg}`,
      { headers: { Accept: 'application/json' } }
    );
    if (dvsa.ok) {
      const data = await dvsa.json();
      recalls = data.recalls ?? [];
    }
  } catch (err) {
    console.error('DVSA API error', err);
    // Non-fatal — continue with empty recalls
  }

  const recallRefs = recalls.map(r => r.recallNumber ?? r.reference ?? '').filter(Boolean);
  const hasRecalls = recallRefs.length > 0;

  // 2. Upsert subscriber
  const { error: subError } = await supabase
    .from('recall_subscribers')
    .upsert(
      { email, registration: reg, confirmed: true },
      { onConflict: 'email,registration' }
    );

  if (subError) {
    console.error('Supabase subscriber error', subError);
    return res.status(500).json({ error: 'Failed to save subscription' });
  }

  // 3. Upsert snapshot
  const { error: snapError } = await supabase
    .from('recall_snapshots')
    .upsert(
      {
        registration: reg,
        recall_refs: recallRefs,
        last_checked: new Date().toISOString(),
        last_changed: new Date().toISOString()
      },
      { onConflict: 'registration' }
    );

  if (snapError) {
    console.error('Supabase snapshot error', snapError);
  }

  // 4. Send confirmation email
  const unsubscribeUrl = `https://www.carrecall.app/api/unsubscribe?reg=${encodeURIComponent(reg)}&email=${encodeURIComponent(email)}`;

  const recallBlock = hasRecalls
    ? `
      <div style="background:#2a1a0a;border:1px solid #f97316;border-radius:10px;padding:16px 20px;margin:24px 0;">
        <p style="color:#f97316;font-weight:600;margin:0 0 8px;">⚠️ Active recall found</p>
        <p style="color:#ccc;margin:0;font-size:14px;">Your vehicle currently has <strong style="color:#fff;">${recallRefs.length} open recall${recallRefs.length > 1 ? 's' : ''}</strong>. Contact your nearest franchised dealer to arrange a free repair.</p>
        <p style="margin:12px 0 0;"><a href="https://www.gov.uk/check-vehicle-recall" style="color:#f97316;font-size:14px;">View full recall details on gov.uk →</a></p>
      </div>`
    : `
      <div style="background:#0a1a0f;border:1px solid #22c55e;border-radius:10px;padding:16px 20px;margin:24px 0;">
        <p style="color:#22c55e;font-weight:600;margin:0 0 8px;">✓ No active recalls found</p>
        <p style="color:#ccc;margin:0;font-size:14px;">Your vehicle has no open safety recalls at this time. We'll email you immediately if that changes.</p>
      </div>`;

  const emailHtml = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#0d0d0d;font-family:'DM Sans',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0d0d0d;padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">

        <!-- Header -->
        <tr><td style="padding-bottom:32px;">
          <table cellpadding="0" cellspacing="0">
            <tr>
              <td style="background:#f97316;border-radius:7px;width:28px;height:28px;text-align:center;vertical-align:middle;">
                <span style="color:#fff;font-size:14px;">⚠</span>
              </td>
              <td style="padding-left:8px;font-size:17px;font-weight:600;color:#f0f0f0;letter-spacing:-0.02em;">CarRecall</td>
            </tr>
          </table>
        </td></tr>

        <!-- Title -->
        <tr><td style="padding-bottom:8px;">
          <h1 style="margin:0;font-size:26px;font-weight:600;color:#f0f0f0;letter-spacing:-0.02em;line-height:1.2;">You're signed up</h1>
        </td></tr>

        <!-- Reg pill -->
        <tr><td style="padding-bottom:24px;">
          <span style="display:inline-block;background:#1a1a1a;border:1px solid rgba(255,255,255,0.1);border-radius:999px;padding:6px 16px;font-family:monospace;font-size:15px;color:#f0f0f0;letter-spacing:0.08em;">${reg}</span>
        </td></tr>

        <!-- Intro -->
        <tr><td style="padding-bottom:8px;">
          <p style="margin:0;font-size:15px;color:#888;line-height:1.7;">We're now monitoring <strong style="color:#f0f0f0;">${reg}</strong> against the official DVSA recall database. Here's its current status:</p>
        </td></tr>

        <!-- Recall status block -->
        <tr><td>${recallBlock}</td></tr>

        <!-- What happens next -->
        <tr><td style="padding-top:8px;padding-bottom:32px;">
          <p style="margin:0 0 12px;font-size:15px;color:#888;line-height:1.7;">From now on we'll check your vehicle every day. <strong style="color:#f0f0f0;">You'll only hear from us if something changes.</strong> No spam, no noise.</p>
          <p style="margin:0;font-size:15px;color:#888;line-height:1.7;">Recall repairs are free by law — the manufacturer must fix your vehicle at no cost to you.</p>
        </td></tr>

        <!-- Divider -->
        <tr><td style="border-top:1px solid rgba(255,255,255,0.08);padding-top:24px;padding-bottom:24px;">
          <p style="margin:0;font-size:13px;color:#555;line-height:1.6;">
            Not you, or want to stop alerts?
            <a href="${unsubscribeUrl}" style="color:#f97316;text-decoration:none;">Unsubscribe here</a>.
            <br>CarRecall is a free service by <a href="https://alphapariah.studio" style="color:#555;">Alpha Pariah Studios</a>, Wrexham, Wales. ICO reg: ZC106985.
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: email,
        subject: `CarRecall — ${reg} is now being monitored`,
        html: emailHtml
      })
    });
  } catch (err) {
    console.error('Resend error', err);
    // Non-fatal — subscription is saved, email failure shouldn't block user
  }

  return res.status(200).json({
    message: hasRecalls
      ? `Signed up. Your vehicle currently has ${recallRefs.length} open recall${recallRefs.length > 1 ? 's' : ''} — check your email for details.`
      : 'Signed up. No current recalls found — we\'ll email you the moment anything changes.'
  });
}
