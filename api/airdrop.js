// Vercel serverless function: api/airdrop.js
// Verifies signature with ethers.js and stores verified registration in Supabase.
// Expects POST JSON: { address, signature, message, chain?, source? }
// Message must include a timestamp line: "Timestamp: 2025-01-01T12:00:00.000Z"
// TTL (max allowed age) is enforced server-side to reduce replay risk.
//
// Required env vars on Vercel (set in Project > Settings > Environment Variables):
// - SUPABASE_URL
// - SUPABASE_SERVICE_ROLE_KEY  (server-only, never expose publicly)
// - REGISTRATION_TTL_SECONDS (optional, default 900 seconds = 15 minutes)
// - ALLOWED_ORIGIN (optional, e.g. https://your-site.example)
//
const { createClient } = require('@supabase/supabase-js');
const { ethers } = require('ethers');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const REGISTRATION_TTL_SECONDS = Number(process.env.REGISTRATION_TTL_SECONDS || 900); // default 15 min
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env var');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  // Keep fetch available for edge runtimes - Vercel Node supports this
  global: { fetch }
});

// Helper: simple CORS
function setCors(res) {
  if (ALLOWED_ORIGIN) {
    res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

/**
 * Parse timestamp from message.
 * Expected to find a line: Timestamp: ISO_STRING
 */
function parseTimestampFromMessage(message) {
  if (!message || typeof message !== 'string') return null;
  const lines = message.split(/\r?\n/).map(l => l.trim());
  for (const line of lines) {
    // accept "Timestamp:" or "Time:" variants
    if (/^timestamp\s*:/i.test(line) || /^time\s*:/i.test(line)) {
      const parts = line.split(':');
      // join rest after first colon
      const rest = line.replace(/^timestamp\s*:\s*/i, '').replace(/^time\s*:\s*/i, '');
      const date = new Date(rest);
      if (!isNaN(date.getTime())) return date;
    }
  }
  return null;
}

/**
 * Validate payload shape & fields
 */
function validatePayload(body) {
  if (!body) return 'Request body missing';
  const { address, signature, message } = body;
  if (!address || !signature || !message) return 'address, signature and message are required';
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) return 'invalid address format';
  return null;
}

/**
 * Main handler
 */
module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let body = req.body;
  // Vercel may parse JSON already; ensure we have an object
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { /* handled below */ }
  }

  const validationError = validatePayload(body);
  if (validationError) return res.status(400).json({ error: validationError });

  const { address, signature, message, chain = 'polygon', source = '' } = body;

  try {
    // Parse timestamp from message and check TTL
    const ts = parseTimestampFromMessage(message);
    if (!ts) {
      return res.status(400).json({ error: 'Message must include a valid Timestamp: ISO string' });
    }
    const now = Date.now();
    const ageSeconds = (now - ts.getTime()) / 1000;
    if (ageSeconds < 0 || ageSeconds > REGISTRATION_TTL_SECONDS) {
      return res.status(400).json({ error: `Timestamp out of acceptable range. Max age ${REGISTRATION_TTL_SECONDS} seconds.` });
    }

    // Recover signer from message & signature
    let recovered;
    try {
      recovered = ethers.utils.verifyMessage(message, signature);
    } catch (verifyErr) {
      console.error('verifyMessage error', verifyErr);
      return res.status(400).json({ error: 'Signature verification failed' });
    }

    if (recovered.toLowerCase() !== address.toLowerCase()) {
      return res.status(400).json({ error: 'Signature does not match address' });
    }

    // Prevent duplicates: try insert with unique constraint (address + chain)
    // Table should have a unique index on lower(address) + chain
    const payload = {
      address: address.toLowerCase(),
      signature,
      message,
      chain,
      source,
      timestamp: ts.toISOString(),
      verified_at: new Date().toISOString()
    };

    // Use insert with upsert behavior or ignore conflict
    // We attempt to insert; if conflict constraint triggers, return conflict info
    const { data, error } = await supabase
      .from('registrations')
      .insert([payload])
      .select()
      .limit(1);

    if (error) {
      // If conflict or duplicate, Supabase returns error; try to detect unique violation
      // Return friendly message
      console.warn('Supabase insert error', error);
      // Check if existing record present
      const { data: existing } = await supabase
        .from('registrations')
        .select('id,address,created_at,verified_at')
        .eq('address', address.toLowerCase())
        .eq('chain', chain)
        .limit(1);

      if (existing && existing.length) {
        return res.status(200).json({ ok: true, message: 'Address already registered', registered: existing[0] });
      }

      return res.status(500).json({ error: 'db_error', detail: error.message || error });
    }

    return res.status(200).json({ ok: true, registered: data && data[0] ? data[0] : null });
  } catch (err) {
    console.error('Unexpected error', err);
    return res.status(500).json({ error: 'server_error' });
  }
};