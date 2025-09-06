// Minimal serverless function for Vercel (Node 18+ has global fetch).
// This version DOES NOT request review text (cheaper).
// It expects: { "leads": [ { "name": "...", "address": "...", "area_tag": "...", "website_or_instagram": "..." }, ... ] }

const GOOGLE_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
const PRIVATE_ACTION_KEY = process.env.PRIVATE_ACTION_KEY;

// Geocode an address to a Google place_id
async function geocodeToPlaceId(address) {
  const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
  url.searchParams.set('address', address);
  url.searchParams.set('key', GOOGLE_API_KEY);

  const r = await fetch(url);
  if (!r.ok) throw new Error(`Geocode failed: ${r.status} ${await r.text()}`);
  const data = await r.json();

  return data.results?.[0]?.place_id || null;
}

// Get place details (NO review text)
function detailsUrl(placeId) {
  return `https://places.googleapis.com/v1/places/${placeId}`;
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

// Vercel handler
export default async function handler(req, res) {
  try {
    // Basic auth so only your GPT can call this
    if (req.headers['x-api-key'] !== PRIVATE_ACTION_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const leads = Array.isArray(req.body?.leads) ? req.body.leads : [];
    if (!leads.length) return res.json({ items: [] });

    const results = [];

    // Simple, easy-to-follow loop (fast enough for 30 leads)
    for (const lead of leads) {
      if (!lead?.address) {
        results.push({ ...lead, _note: 'no address; cannot geocode' });
        continue;
      }

      const placeId = await geocodeToPlaceId(lead.address);
      if (!placeId) {
        results.push({ ...lead, _note: 'geocode failed; not found/ambiguous' });
        continue;
      }

      const det = await getPlaceDetails(placeId);

      results.push({
        ...lead,
        address: det.formattedAddress ?? lead.address ?? null,
        google_rating: det.rating ?? null,
        review_count: det.userRatingCount ?? 0
      });
    }

    res.json({ items: results });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
}
