import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = 'CarRecall <alerts@carrecall.app>';

export default async function handler(req, res) {
  // Only allow Vercel cron or internal calls
  if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorised' });
  }

  // 1. Get all confirmed subscribers
  const { data: subscribers, error: subError } = await supabase
    .from('recall_subscribers')
    .select('email, registration')
    .eq('confirmed', true);

  if (subError) {
    console.error('Failed to fetch subscribers', subError);
    return res.status(500).json({ error: 'Failed to fetch subscribers' });
  }

  // Deduplicate registrations so we only call DVSA once per reg
  const uniqueRegs = [...new Set(subscribers.map(s => s.registration))];

  let alerted = 0;
  let checked = 0;

  for (const reg of uniqueRegs) {
    try {
      // 2. Fetch current recalls from DVSA
      const dvsa = await fetch(
        `https://driver-vehicle-standards.api.gov.uk/v1/recalls/${reg}`,
        { headers: { Accept: 'application/json' } }
      );

      if (!dvsa.ok) continue;

      const data = await dvsa.json();
      const liveRecalls = data.recalls ?? [];
      const liveRefs = liveRecalls.map(r => r.recallNumber ?? r.reference ?? '').filter(Boolean);

      // 3. Get stored snapshot
      const { data: snapshot } = await supabase
        .from('recall_snapshots')
        .select('recall_refs')
        .eq('registration', reg)
        .single();

      const storedRefs = snapshot?.recall_refs ?? [];

      // 4. Find new recalls not in snapshot
      const newRefs = liveRefs.filter(ref => !storedRefs.includes(ref));

      checked++;

      if (newRefs.length === 0) {
        // No change — just update last_checked
        await supabase
          .from('recall_snapshots')
          .update({ last_checked: new Date().toISOString() })
          .eq('registration', reg);
        continue;
      }

      // 5. New recalls found — update snapshot
      await supabase
        .from('recall_snapshots')
        .upsert({
          registration: reg,
          recall_refs: liveRefs,
          last_checked: new Date().toISOString(),
          last_changed: new Date().toISOString()
        }, { onConflict: 'registration' });

      // 6. Get the new recall details for the email
      const newRecallDetails = liveRecalls.filter(r =>
        newRefs.includes(r.recallNumber ?? r.reference ?? '')
      );

      // 7. Email all subscribers for this reg
      const regSubscribers = subscribers.filter(s => s.registration === reg);

      for (const subscriber of regSubscribers) {
        const unsubscribeUrl = `https://www.carrecall.app/api/unsubscribe?reg=${encodeURIComponent(reg)}&email=${encodeURIComponent(subscriber.email)}`;

        const recallListHtml = newRecallDetails.map(r => `
          <div style="background:#1a1a1a;border-radius:8px;padding:12px 16px;margin-bottom:10px;">
            <p style="margin:0 0 4px;font-size:13px;color:#555;font-family:monospace;">${r.recallNumber ?? r.reference ?? 'REF UNKNOWN'}</p>
            <p style="margin:0;font-size:14px;color:#f0f0f0;line-height:1.6;">${r.defectDescription ?? r.description ?? 'See gov.uk for full details'}</p>
          </div>`
        ).join('');

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

        <!-- Alert banner -->
        <tr><td style="padding-bottom:24px;">
          <div style="background:#2a1a0a;border:1px solid #f97316;border-radius:12px;padding:20px 24px;">
            <p style="margin:0 0 4px;font-size:13px;font-weight:600;color:#f97316;text-transform:uppercase;letter-spacing:0.06em;">Safety recall alert</p>
            <h1 style="margin:0;font-size:24px;font-weight:600;color:#f0f0f0;letter-spacing:-0.02em;line-height:1.2;">A recall has been issued for your vehicle</h1>
          </div>
        </td></tr>

        <!-- Reg pill -->
        <tr><td style="padding-bottom:20px;">
          <span style="display:inline-block;background:#1a1a1a;border:1px solid rgba(255,255,255,0.1);border-radius:999px;padding:6px 16px;font-family:monospace;font-size:15px;color:#f0f0f0;letter-spacing:0.08em;">${reg}</span>
        </td></tr>

        <!-- Intro -->
        <tr><td style="padding-bottom:20px;">
          <p style="margin:0;font-size:15px;color:#888;line-height:1.7;">A new safety recall has been issued for <strong style="color:#f0f0f0;">${reg}</strong>. Here ${newRecallDetails.length === 1 ? 'is the detail' : 'are the details'}:</p>
        </td></tr>

        <!-- Recall details -->
        <tr><td style="padding-bottom:24px;">${recallListHtml}</td></tr>

        <!-- What to do -->
        <tr><td style="padding-bottom:32px;">
          <div style="background:#0a1a0f;border:1px solid #22c55e;border-radius:10px;padding:16px 20px;">
            <p style="margin:0 0 8px;font-size:14px;font-weight:600;color:#22c55e;">What to do next</p>
            <p style="margin:0 0 10px;font-size:14px;color:#ccc;line-height:1.6;">Contact your nearest franchised dealer for this make of vehicle and quote the recall reference above. <strong style="color:#fff;">The repair is free by law</strong> — the manufacturer must fix your vehicle at no cost to you.</p>
            <a href="https://www.gov.uk/check-vehicle-recall" style="color:#22c55e;font-size:14px;text-decoration:none;">View full recall on gov.uk →</a>
          </div>
        </td></tr>

        <!-- Divider -->
        <tr><td style="border-top:1px solid rgba(255,255,255,0.08);padding-top:24px;">
          <p style="margin:0;font-size:13px;color:#555;line-height:1.6;">
            You're receiving this because you signed up at carrecall.app.
            <a href="${unsubscribeUrl}" style="color:#f97316;text-decoration:none;">Unsubscribe</a>.
            <br>CarRecall by <a href="https://alphapariah.studio" style="color:#555;">Alpha Pariah Studios</a>, Wrexham, Wales. ICO reg: ZC106985.
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${RESEND_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            from: FROM_EMAIL,
            to: subscriber.email,
            subject: `⚠️ Safety recall issued for ${reg}`,
            html: emailHtml
          })
        });

        alerted++;
      }
    } catch (err) {
      console.error(`Error processing ${reg}:`, err);
    }
  }

  return res.status(200).json({
    checked,
    alerted,
    message: `Checked ${checked} vehicles, sent ${alerted} alerts`
  });
}
