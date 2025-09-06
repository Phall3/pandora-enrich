// api/enrich.js  (CommonJS, no review text)
const GOOGLE_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
const PRIVATE_ACTION_KEY = process.env.PRIVATE_ACTION_KEY;

// small helper to read JSON when body isn't auto-parsed
function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); }
    });
  });
}

async function geocodeToPlaceId(address) {
  const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
  url.searchParams.set('address', address);
  url.searchParams.set('key', GOOGLE_API_KEY);
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Geocode failed: ${r.status} ${await r.text()}`);
  const data = await r.json();
  return data.results?.[0]?.place_id || null;
}

function detailsUrl(id) {
  return `https://places.googleapis.com/v1/places/${id}`;
}

async function getPlaceDetails(placeId) {
  const fieldMask = [
    'id',
    'displayName',
    'formattedAddress',
    'rating',
    'userRatingCount'
  ].join(',');
  const r = await fetch(detailsUrl(placeId), {
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': GOOGLE_API_KEY,
      'X-Goog-FieldMask': fieldMask
    }
  });
  if (!r.ok) throw new Error(`Details failed: ${r.status} ${await r.text()}`);
  return r.json();
}

module.exports = async (req, res) => {
  // quick health check in browser
  if (req.method === 'GET') return res.status(200).json({ ok: true });

  // CORS preflight (optional)
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Api-Key');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS, GET');
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (req.headers['x-api-key'] !== PRIVATE_ACTION_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const body = req.body && typeof req.body === 'object' ? req.body : await readJson(req);
  const leads = Array.isArray(body?.leads) ? body.leads : [];
  if (!leads.length) return res.json({ items: [] });

  const items = [];
  for (const lead of leads) {
    if (!lead?.address) {
      items.push({ ...lead, _note: 'no address; cannot geocode' });
      continue;
    }
    const pid = await geocodeToPlaceId(lead.address);
    if (!pid) {
      items.push({ ...lead, _note: 'geocode failed; not found/ambiguous' });
      continue;
    }
    const det = await getPlaceDetails(pid);
    items.push({
      ...lead,
      address: det.formattedAddress ?? lead.address ?? null,
      google_rating: det.rating ?? null,
      review_count: det.userRatingCount ?? 0
    });
  }
  res.json({ items });
};

