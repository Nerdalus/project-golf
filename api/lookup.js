// Cache the token in memory between invocations (warm functions only)
let cachedToken = null;
let tokenExpiry = 0;

async function getMOTToken() {
  const now = Date.now();
  if (cachedToken && now < tokenExpiry) return cachedToken;

  const tokenUrl = `https://login.microsoftonline.com/${process.env.MOT_TENANT_ID}/oauth2/v2.0/token`;

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: process.env.MOT_CLIENT_ID,
    client_secret: process.env.MOT_CLIENT_SECRET,
    scope: 'https://tapi.dvsa.gov.uk/.default',
  });

  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) throw new Error('Failed to get MOT auth token');

  const data = await res.json();
  cachedToken = data.access_token;
  // Expire 60 seconds early to be safe (tokens last 60 mins)
  tokenExpiry = now + (data.expires_in - 60) * 1000;
  return cachedToken;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { reg } = req.body ?? {};
  if (!reg || typeof reg !== 'string') {
    return res.status(400).json({ error: 'No registration provided' });
  }

  const registration = reg.replace(/\s/g, '').toUpperCase();

  if (!/^[A-Z0-9]{2,7}$/.test(registration)) {
    return res.status(400).json({ error: 'Invalid registration format' });
  }

  try {
    // Get MOT Bearer token first (cached after first call)
    const motToken = await getMOTToken();

    // Hit both APIs in parallel
    const [vesRes, motRes] = await Promise.all([
      fetch('https://driver-vehicle-licensing.api.gov.uk/vehicle-enquiry/v1/vehicles', {
        method: 'POST',
        headers: {
          'x-api-key': process.env.DVLA_API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ registrationNumber: registration }),
      }),
      fetch(`https://history.mot.api.gov.uk/v1/trade/vehicles/registration/${registration}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${motToken}`,
          'X-API-Key': process.env.MOT_API_KEY,
          'Accept': 'application/json',
        },
      }),
    ]);

    if (!vesRes.ok) {
      const err = await vesRes.json().catch(() => ({}));
      return res.status(vesRes.status).json({
        error: err.message || 'Vehicle not found',
      });
    }

    const vesData = await vesRes.json();

    let motStatus = null;
    let motExpiryDate = null;
    let advisories = [];

    if (motRes.ok) {
      const motData = await motRes.json();
      const vehicle = Array.isArray(motData) ? motData[0] : motData;
      const tests = vehicle?.motTests ?? [];

      const latestPass = tests.find(t => t.testResult === 'PASSED');
      if (latestPass) {
        motStatus = 'Valid';
        motExpiryDate = latestPass.expiryDate ?? null;
      } else if (tests.length > 0) {
        motStatus = 'Not valid';
      }

      const latestTest = tests[0];
      advisories = latestTest?.defects
        ?.filter(d => d.type === 'ADVISORY')
        .map(d => d.text) ?? [];
    }

    if (motExpiryDate) {
      motExpiryDate = motExpiryDate.replace(/\./g, '-');
    }

    return res.status(200).json({
      make: vesData.make ?? null,
      colour: vesData.colour ?? null,
      yearOfManufacture: vesData.yearOfManufacture ?? null,
      fuelType: vesData.fuelType ?? null,
      taxStatus: vesData.taxStatus ?? null,
      taxDueDate: vesData.taxDueDate ?? null,
      motStatus,
      motExpiryDate,
      advisories,
    });
  } catch (err) {
    console.error('lookup error', err);
    return res.status(500).json({ error: 'Lookup failed — please try again' });
  }
}