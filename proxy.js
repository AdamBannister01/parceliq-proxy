
// ═══════════════════════════════════════════════════════════════════
// ParcelIQ — Backend Proxy Server
// Handles: Claude AI (PDF reports) + LightBox API (parcels/zoning/assessment)
//
// SETUP:
//   1. npm install express node-fetch cors
//   2. Set environment variables (never hardcode keys):
//        LIGHTBOX_KEY=your_key_here
//        LIGHTBOX_SECRET=your_secret_here
//        ANTHROPIC_KEY=sk-ant-...
//   3. node proxy.js
//
// DEPLOY TO RAILWAY/RENDER:
//   - Push this file to a GitHub repo
//   - Connect repo to Railway.app or Render.com
//   - Set the 3 env vars in their dashboard
//   - Done — get your public URL and paste into parceliq.html
// ═══════════════════════════════════════════════════════════════════

const express  = require('express');
const cors     = require('cors');

const app  = express();
const PORT = process.env.PORT || 3001;

// ── Keys — LightBox eval hardcoded, others via env
const LIGHTBOX_KEY    = 'r7aFcOWzIQo02lGf1WsfuL4x5lw8FhXxQ8rZJW0jRP55GONR';
const LIGHTBOX_SECRET = 'EBoeAhkdVUDGxmcMX75zcvmtN4AlMiP2zid3pRH1dVf3yGVE53ycAq9nb7FIew5h';
const ANTHROPIC_KEY   = process.env.ANTHROPIC_KEY;
const BATCHDATA_KEY   = process.env.BATCHDATA_KEY;   // BatchData (legacy)
const RENTCAST_KEY    = process.env.RENTCAST_KEY;     // Rentcast comps
const REAPI_KEY       = process.env.REAPI_KEY;        // RealEstateAPI SECRET key (used for skip trace auth)
const REAPI_SECRET    = process.env.REAPI_SECRET;     // RealEstateAPI PUBLIC key

const LIGHTBOX_BASE   = 'https://api.lightboxre.com/v1';
const ANTHROPIC_BASE  = 'https://api.anthropic.com/v1';
const BATCHDATA_BASE  = 'https://api.batchdata.com/api/v1';
const RENTCAST_BASE   = 'https://api.rentcast.io/v1';
const REAPI_BASE      = 'https://api.realestateapi.com/v2';

// ── Middleware
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// ── Startup check
if (!LIGHTBOX_KEY)   console.warn('⚠️  LIGHTBOX_KEY not set — LightBox endpoints will fail');
if (!ANTHROPIC_KEY)  console.warn('⚠️  ANTHROPIC_KEY not set — AI reports will fail');
if (!RENTCAST_KEY)   console.warn('⚠️  RENTCAST_KEY not set — Comps will fail');
if (!REAPI_KEY)      console.warn('⚠️  REAPI_KEY not set — Skip Trace & Listings will fail');

// ── Health check
app.get('/', (req, res) => {
  res.json({
    status:    'ParcelIQ proxy running',
    lightbox:  'evaluation (hardcoded)',
    claude:    !!ANTHROPIC_KEY,
    rentcast:  !!RENTCAST_KEY,
    reapi:     !!REAPI_KEY,
    time:      new Date().toISOString()
  });
});

// ════════════════════════════════════════════════════════
// LIGHTBOX — PARCELS
// GET /api/lightbox/parcels/geometry?lat=LAT&lon=LON
// Looks up parcel by lat/lon point — used on every map click
// ════════════════════════════════════════════════════════
app.get('/api/lightbox/parcels/geometry', async (req, res) => {
  const { lat, lon } = req.query;
  if (!lat || !lon) return res.status(400).json({ error: 'lat and lon required' });

  try {
    const wkt = `POINT(${lon} ${lat})`;
    const url = `${LIGHTBOX_BASE}/parcels/us/geometry?wkt=${encodeURIComponent(wkt)}&bufferDistance=50&bufferUnit=ft&limit=1`;
    console.log(`[LightBox Parcels] ${url}`);

    const r = await fetch(url, {
      headers: { 'x-api-key': LIGHTBOX_KEY, 'Accept': 'application/json' }
    });

    const data = await r.json();
    if (!r.ok) {
      console.error('[LightBox Parcels] Error:', r.status, data);
      return res.status(r.status).json(data);
    }
    res.json(data);
  } catch (err) {
    console.error('[LightBox Parcels] Exception:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════
// LIGHTBOX — PARCELS BY ADDRESS
// GET /api/lightbox/parcels/address?text=ADDRESS
// ════════════════════════════════════════════════════════
app.get('/api/lightbox/parcels/address', async (req, res) => {
  const { text } = req.query;
  if (!text) return res.status(400).json({ error: 'text required' });

  try {
    const url = `${LIGHTBOX_BASE}/parcels/address?text=${encodeURIComponent(text)}`;
    console.log(`[LightBox Parcels/Address] ${text}`);

    const r = await fetch(url, {
      headers: { 'x-api-key': LIGHTBOX_KEY, 'Accept': 'application/json' }
    });

    const data = await r.json();
    if (!r.ok) return res.status(r.status).json(data);
    res.json(data);
  } catch (err) {
    console.error('[LightBox Parcels/Address] Exception:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════
// LIGHTBOX — PARCEL BY LightBox ID
// GET /api/lightbox/parcels/:id
// ════════════════════════════════════════════════════════
app.get('/api/lightbox/parcels/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const url = `${LIGHTBOX_BASE}/parcels/us/${id}`;
    console.log(`[LightBox Parcel ID] ${id}`);

    const r = await fetch(url, {
      headers: { 'x-api-key': LIGHTBOX_KEY, 'Accept': 'application/json' }
    });

    const data = await r.json();
    if (!r.ok) return res.status(r.status).json(data);
    res.json(data);
  } catch (err) {
    console.error('[LightBox Parcel ID] Exception:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════
// LIGHTBOX — ADJACENT PARCELS (common ownership)
// GET /api/lightbox/parcels/:id/adjacent?commonOwnership=true
// ════════════════════════════════════════════════════════
app.get('/api/lightbox/parcels/:id/adjacent', async (req, res) => {
  const { id } = req.params;
  const { commonOwnership } = req.query;
  try {
    let url = `${LIGHTBOX_BASE}/parcels/_adjacent/us/${id}`;
    if (commonOwnership === 'true') url += '?commonOwnership=true';
    console.log(`[LightBox Adjacent] ${id} commonOwnership=${commonOwnership}`);

    const r = await fetch(url, {
      headers: { 'x-api-key': LIGHTBOX_KEY, 'Accept': 'application/json' }
    });

    const data = await r.json();
    if (!r.ok) return res.status(r.status).json(data);
    res.json(data);
  } catch (err) {
    console.error('[LightBox Adjacent] Exception:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════
// LIGHTBOX — ZONING BY PARCEL ID
// GET /api/lightbox/zoning/parcel/:id
// Returns: zoning code, category, permittedUse, setbacks, FAR,
//          building height, ordinanceUrl, jurisdiction
// ════════════════════════════════════════════════════════
app.get('/api/lightbox/zoning/parcel/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const url = `${LIGHTBOX_BASE}/zoning/_on/parcel/us/${id}`;
    console.log(`[LightBox Zoning] parcel ${id}`);

    const r = await fetch(url, {
      headers: { 'x-api-key': LIGHTBOX_KEY, 'Accept': 'application/json' }
    });

    const data = await r.json();
    if (!r.ok) return res.status(r.status).json(data);
    res.json(data);
  } catch (err) {
    console.error('[LightBox Zoning] Exception:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════
// LIGHTBOX — ZONING BY ADDRESS
// GET /api/lightbox/zoning/address?text=ADDRESS
// ════════════════════════════════════════════════════════
app.get('/api/lightbox/zoning/address', async (req, res) => {
  const { text } = req.query;
  if (!text) return res.status(400).json({ error: 'text required' });

  try {
    const url = `${LIGHTBOX_BASE}/zoning/address?text=${encodeURIComponent(text)}`;
    console.log(`[LightBox Zoning/Address] ${text}`);

    const r = await fetch(url, {
      headers: { 'x-api-key': LIGHTBOX_KEY, 'Accept': 'application/json' }
    });

    const data = await r.json();
    if (!r.ok) return res.status(r.status).json(data);
    res.json(data);
  } catch (err) {
    console.error('[LightBox Zoning/Address] Exception:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════
// LIGHTBOX — ASSESSMENT BY PARCEL ID
// GET /api/lightbox/assessment/parcel/:id
// Returns: owner details, full tax record, improvement value,
//          sale history, land use, school district, etc.
// ════════════════════════════════════════════════════════
app.get('/api/lightbox/assessment/parcel/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const url = `${LIGHTBOX_BASE}/assessments/_on/parcel/us/${id}`;
    console.log(`[LightBox Assessment] parcel ${id}`);

    const r = await fetch(url, {
      headers: { 'x-api-key': LIGHTBOX_KEY, 'Accept': 'application/json' }
    });

    const data = await r.json();
    if (!r.ok) return res.status(r.status).json(data);
    res.json(data);
  } catch (err) {
    console.error('[LightBox Assessment] Exception:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════
// LIGHTBOX — ASSESSMENT BY ADDRESS
// GET /api/lightbox/assessment/address?text=ADDRESS
// ════════════════════════════════════════════════════════
app.get('/api/lightbox/assessment/address', async (req, res) => {
  const { text } = req.query;
  if (!text) return res.status(400).json({ error: 'text required' });

  try {
    const url = `${LIGHTBOX_BASE}/assessments/address?text=${encodeURIComponent(text)}`;
    console.log(`[LightBox Assessment/Address] ${text}`);

    const r = await fetch(url, {
      headers: { 'x-api-key': LIGHTBOX_KEY, 'Accept': 'application/json' }
    });

    const data = await r.json();
    if (!r.ok) return res.status(r.status).json(data);
    res.json(data);
  } catch (err) {
    console.error('[LightBox Assessment/Address] Exception:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════
// CLAUDE AI — STREAMING MESSAGES
// POST /api/claude
// Body: standard Anthropic messages API payload
// Streams SSE back to the client
// ════════════════════════════════════════════════════════
app.post('/api/claude', async (req, res) => {
  try {
    const payload = { ...req.body, stream: true };
    console.log(`[Claude] model=${payload.model} max_tokens=${payload.max_tokens}`);

    const r = await fetch(`${ANTHROPIC_BASE}/messages`, {
      method:  'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(payload)
    });

    if (!r.ok) {
      const err = await r.json();
      console.error('[Claude] Error:', r.status, err);
      return res.status(r.status).json(err);
    }

    // Stream SSE directly back to browser
    res.setHeader('Content-Type',  'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection',    'keep-alive');

    const reader = r.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(decoder.decode(value, { stream: true }));
    }
    res.end();

  } catch (err) {
    console.error('[Claude] Exception:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════
// COMBINED ENRICHMENT ENDPOINT
// GET /api/enrich?lat=LAT&lon=LON
// Single call that fetches LightBox parcel + zoning + assessment
// in parallel and returns everything merged. Used by parceliq.html
// on every map click for maximum data with minimum round trips.
// ════════════════════════════════════════════════════════
app.get('/api/enrich', async (req, res) => {
  const { lat, lon } = req.query;
  if (!lat || !lon) return res.status(400).json({ error: 'lat and lon required' });

  console.log(`[Enrich] lat=${lat} lon=${lon}`);

  const result = { parcel: null, zoning: null, assessment: null, errors: {} };

  try {
    // ── Step 1: Get LightBox parcel (need LightBox ID for subsequent calls)
    const wkt = `POINT(${lon} ${lat})`;
    const parcelUrl = `${LIGHTBOX_BASE}/parcels/us/geometry?wkt=${encodeURIComponent(wkt)}&bufferDistance=50&bufferUnit=ft&limit=1`;
    const parcelRes = await fetch(parcelUrl, {
      headers: { 'x-api-key': LIGHTBOX_KEY, 'Accept': 'application/json' }
    });

    if (parcelRes.ok) {
      result.parcel = await parcelRes.json();
    } else {
      result.errors.parcel = `HTTP ${parcelRes.status}`;
      console.warn('[Enrich] Parcel failed:', parcelRes.status);
    }

    // ── Step 2: Extract LightBox parcel ID for zoning + assessment calls
    const lbId = result.parcel?.parcels?.[0]?.id || result.parcel?.parcels?.[0]?.['$ref']?.split('/').pop();

    if (lbId) {
      // ── Steps 3+4: Zoning and Assessment in parallel
      const [zoningRes, assessmentRes] = await Promise.allSettled([
        fetch(`${LIGHTBOX_BASE}/zoning/_on/parcel/us/${lbId}`, {
          headers: { 'x-api-key': LIGHTBOX_KEY, 'Accept': 'application/json' }
        }),
        fetch(`${LIGHTBOX_BASE}/assessments/_on/parcel/us/${lbId}`, {
          headers: { 'x-api-key': LIGHTBOX_KEY, 'Accept': 'application/json' }
        })
      ]);

      if (zoningRes.status === 'fulfilled' && zoningRes.value.ok) {
        result.zoning = await zoningRes.value.json();
      } else {
        result.errors.zoning = zoningRes.status === 'fulfilled'
          ? `HTTP ${zoningRes.value.status}` : zoningRes.reason?.message;
        console.warn('[Enrich] Zoning failed:', result.errors.zoning);
      }

      if (assessmentRes.status === 'fulfilled' && assessmentRes.value.ok) {
        result.assessment = await assessmentRes.value.json();
      } else {
        result.errors.assessment = assessmentRes.status === 'fulfilled'
          ? `HTTP ${assessmentRes.value.status}` : assessmentRes.reason?.message;
        console.warn('[Enrich] Assessment failed:', result.errors.assessment);
      }

      result.lightboxParcelId  = lbId;
      // Also capture Assessment ID — needed for history + owner portfolio calls
      result.lightboxAssessmentId = result.assessment?.assessments?.[0]?.id || null;
    } else {
      result.errors.zoning     = 'No LightBox parcel ID — cannot fetch zoning';
      result.errors.assessment = 'No LightBox parcel ID — cannot fetch assessment';
      console.warn('[Enrich] No LightBox parcel ID found in response');
    }

  } catch (err) {
    console.error('[Enrich] Exception:', err.message);
    result.errors.general = err.message;
  }

  res.json(result);
});

// ════════════════════════════════════════════════════════
// LIGHTBOX — HISTORICAL ASSESSED VALUE
// GET /api/lightbox/history/:assessmentId
// Returns 10+ years of land/improvement/total assessed values
// ════════════════════════════════════════════════════════
app.get('/api/lightbox/history/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const url = `${LIGHTBOX_BASE}/assessments/historicalassessedvalue/us/${id}`;
    console.log(`[LightBox History] ${id}`);
    const r = await fetch(url, { headers: { 'x-api-key': LIGHTBOX_KEY, 'Accept': 'application/json' } });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json(data);
    res.json(data);
  } catch (err) {
    console.error('[LightBox History] Exception:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════
// LIGHTBOX — OWNER PORTFOLIO
// GET /api/lightbox/portfolio/:assessmentId
// Returns ALL properties owned by the same owner
// ════════════════════════════════════════════════════════
app.get('/api/lightbox/portfolio/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const url = `${LIGHTBOX_BASE}/assessments/ownerportfolio/us/${id}`;
    console.log(`[LightBox Portfolio] ${id}`);
    const r = await fetch(url, { headers: { 'x-api-key': LIGHTBOX_KEY, 'Accept': 'application/json' } });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json(data);
    res.json(data);
  } catch (err) {
    console.error('[LightBox Portfolio] Exception:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════
// LIGHTBOX — ADJACENT PARCELS (common ownership)
// GET /api/lightbox/adjacent/:parcelId?commonOwnership=true
// Returns neighboring parcels — optionally filtered to same owner
// ════════════════════════════════════════════════════════
app.get('/api/lightbox/adjacent/:id', async (req, res) => {
  const { id } = req.params;
  const co = req.query.commonOwnership === 'true' ? '?commonOwnership=true' : '';
  try {
    const url = `${LIGHTBOX_BASE}/parcels/_adjacent/us/${id}${co}`;
    console.log(`[LightBox Adjacent] ${id} commonOwnership=${!!co}`);
    const r = await fetch(url, { headers: { 'x-api-key': LIGHTBOX_KEY, 'Accept': 'application/json' } });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json(data);
    res.json(data);
  } catch (err) {
    console.error('[LightBox Adjacent] Exception:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════
// REALESTATEAPI — SKIP TRACE
// POST /api/skiptrace
// Body: { address, city, state, zip, ownerName }
// Returns: phones, emails, mailing address
// ════════════════════════════════════════════════════════
app.post('/api/skiptrace', async (req, res) => {
  if (!REAPI_KEY) return res.status(503).json({ error: 'REAPI_KEY not configured — add to start.ps1' });
  const { address, city, state, zip, ownerName } = req.body;
  if (!address) return res.status(400).json({ error: 'address required' });

  // Parse owner name into first/last if provided
  const nameParts = (ownerName || '').trim().split(/\s+/);
  const fName = nameParts[0] || '';
  const lName = nameParts.slice(1).join(' ') || '';

  try {
    // Only include fields that have values — REAPI rejects empty strings
    const payload = { address };
    if (city)   payload.city  = city;
    if (state)  payload.state = state;
    if (zip)    payload.zip   = zip.split('-')[0];  // strip ZIP+4 (e.g. 75039-3104 → 75039)
    // REAPI does not accept name fields on skip trace
    console.log(`[REAPI Skip] ${address}, ${city} ${state}`);
    const r = await fetch(`${REAPI_BASE}/SkipTrace`, {
      method: 'POST',
      headers: {
        'x-api-key':    REAPI_KEY,
        'x-user-id':    REAPI_SECRET || '',
        'Content-Type': 'application/json',
        'Accept':       'application/json'
      },
      body: JSON.stringify(payload)
    });
    const data = await r.json();
    if (!r.ok) {
      console.error('[REAPI Skip] Error:', r.status, JSON.stringify(data).slice(0,300));
      return res.status(r.status).json(data);
    }
    res.json(data);
  } catch (err) {
    console.error('[REAPI Skip] Exception:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════
// RENTCAST — FOR-SALE LISTINGS (map layer + panel)
// GET /api/listings?lat=LAT&lon=LON&radius=MILES&limit=N&propertyType=TYPE
// Returns active for-sale listings near a point
// ════════════════════════════════════════════════════════
app.get('/api/listings', async (req, res) => {
  if (!RENTCAST_KEY) return res.status(503).json({ error: 'RENTCAST_KEY not configured' });
  const { lat, lon, radius = '1', limit = '50', propertyType } = req.query;
  if (!lat || !lon) return res.status(400).json({ error: 'lat and lon required' });

  try {
    let url = `${RENTCAST_BASE}/listings/sale?latitude=${lat}&longitude=${lon}&radius=${radius}&limit=${limit}&status=Active`;
    if (propertyType) url += `&propertyType=${encodeURIComponent(propertyType)}`;
    console.log(`[Rentcast Listings] lat=${lat} lon=${lon} r=${radius}mi`);
    const r = await fetch(url, {
      headers: { 'X-Api-Key': RENTCAST_KEY, 'Accept': 'application/json' }
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json(data);
    res.json(data);
  } catch (err) {
    console.error('[Rentcast Listings] Exception:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════
// RENTCAST — COMPS (comparable sales)
// GET /api/comps?address=ADDR&bedrooms=N&bathrooms=N&squareFootage=N
// Returns 5 closest comparable sold properties with AVM estimate
// ════════════════════════════════════════════════════════
app.get('/api/comps', async (req, res) => {
  if (!RENTCAST_KEY) return res.status(503).json({ error: 'RENTCAST_KEY not configured' });
  const { address, bedrooms, bathrooms, squareFootage, propertyType } = req.query;
  if (!address) return res.status(400).json({ error: 'address required' });

  try {
    let url = `${RENTCAST_BASE}/avm/value?address=${encodeURIComponent(address)}&compCount=5`;
    if (bedrooms)      url += `&bedrooms=${bedrooms}`;
    if (bathrooms)     url += `&bathrooms=${bathrooms}`;
    if (squareFootage) url += `&squareFootage=${squareFootage}`;
    if (propertyType)  url += `&propertyType=${encodeURIComponent(propertyType)}`;
    console.log(`[Rentcast Comps] ${address}`);
    const r = await fetch(url, {
      headers: { 'X-Api-Key': RENTCAST_KEY, 'Accept': 'application/json' }
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json(data);
    res.json(data);
  } catch (err) {
    console.error('[Rentcast Comps] Exception:', err.message);
    res.status(500).json({ error: err.message });
  }
});


// ── Regrid bbox parcel search — for vacant/zoning filters
app.get('/api/parcels-bbox', async (req, res) => {
  const { west, south, east, north, token } = req.query;
  if (!west || !south || !east || !north || !token)
    return res.status(400).json({ error: 'west, south, east, north, token required' });
  const latDiff = parseFloat(north) - parseFloat(south);
  const lonDiff = parseFloat(east) - parseFloat(west);
  if (latDiff > 0.05 || lonDiff > 0.05)
    return res.status(400).json({ error: 'Bbox too large — zoom in further' });
  try {
    const url = `https://app.regrid.com/api/v1/search.json?bbox=${west},${south},${east},${north}&limit=500&token=${encodeURIComponent(token)}`;
    console.log(`[Regrid BBox] ${west.slice(0,8)},${south.slice(0,8)} → ${east.slice(0,8)},${north.slice(0,8)}`);
    const r = await fetch(url, { headers: { 'Accept': 'application/json' } });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json(data);
    res.json(data);
  } catch (err) {
    console.error('[Regrid BBox] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Start
app.listen(PORT, () => {
  const ok = '✅ ready   ';
  const no = '❌ missing ';
  console.log(`
  ╔══════════════════════════════════════╗
  ║   ParcelIQ Proxy  →  :${PORT}           ║
  ║   LightBox  : ${LIGHTBOX_KEY  ? ok : no}    ║
  ║   Claude    : ${ANTHROPIC_KEY ? ok : no}    ║
  ║   Rentcast  : ${RENTCAST_KEY  ? ok : no}    ║
  ║   REAPI     : ${REAPI_KEY     ? ok : no}    ║
  ╚══════════════════════════════════════╝
  `);
});
