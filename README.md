# Vercel Serverless Airdrop Webhook (Supabase) — Block21 (B21)

This package contains a Vercel serverless function that:
- Verifies a signed message (ethers.js)
- Enforces a timestamp TTL to reduce replay risk
- Stores verified registrations in Supabase (server-side Service Role key)

Files:
- `api/airdrop.js` (serverless function)
- `lib/supabase.js` (helper)
- `schema.sql` (SQL to create the table)
- `package.json` (dependencies)

Important environment variables (set these in Vercel Project > Settings > Environment Variables):
- SUPABASE_URL = https://your-project-ref.supabase.co
- SUPABASE_SERVICE_ROLE_KEY = (Service Role key from Supabase - server-only)
- REGISTRATION_TTL_SECONDS = 900  # optional (defaults to 900 seconds = 15 min)
- ALLOWED_ORIGIN = https://your-site.example  # optional, recommended for CORS

Security notes:
- Use the Supabase Service Role key ONLY on the server (Vercel functions). Do not expose it in the frontend.
- Verify signatures server-side before inserting records.
- Use the provided SQL to create the `registrations` table (and unique index).
- The server expects the signed `message` to contain a timestamp line, e.g.:
  Timestamp: 2025-10-23T14:00:00.000Z

Client-side message format (exact)
- To ensure the server can parse the timestamp, use this exact format when asking users to sign:

```
Block21 Airdrop Registration
Address: 0xabcdef...
Timestamp: 2025-12-31T23:59:59.000Z
Nonce: 123456
```

- Sign the entire message string with `personal_sign` (or `eth_sign`) from the user's wallet.
- Send POST to your Vercel function URL: `https://your-vercel-app.vercel.app/api/airdrop`
  Body (JSON):
  {
    "address": "0xabc...",
    "signature": "0x....",
    "message": "Block21 Airdrop Registration\nAddress: 0xabc...\nTimestamp: ...\nNonce: 12345",
    "chain": "polygon",
    "source": "landing-page"
  }

Steps to deploy (step-by-step)

1) Create Supabase project
- Go to https://app.supabase.com -> New project.
- Create the project and note the Project URL (SUPABASE_URL) and get the Service Role key (Settings -> API -> Service_role key). Keep the service key secret.

2) Create registrations table
- Open Supabase SQL Editor and run the SQL from `schema.sql`.
- This creates `registrations` with a unique index to prevent duplicates.

3) Prepare repository
- Place `api/airdrop.js` in `api/` at the root of your repo (Vercel serverless functions).
- Place `lib/supabase.js` if you use it.
- Ensure `package.json` includes `@supabase/supabase-js` and `ethers`.

4) Add environment variables in Vercel
- In your Vercel project, go to Settings -> Environment Variables.
- Add `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
- Optionally set `REGISTRATION_TTL_SECONDS` and `ALLOWED_ORIGIN`.

5) Deploy to Vercel
- Push the repo to GitHub/GitLab and link the project to Vercel.
- Vercel will install dependencies and deploy; function will be available at:
  https://your-vercel-app.vercel.app/api/airdrop

6) Update your frontend
- Use the exact message format above and call `personal_sign`.
- POST to your function URL with JSON (address, signature, message).
- On success you'll receive `{ ok: true }` and a record.

7) Server-side verification & distribution
- Use Supabase UI or SQL to export registered addresses for your distribution script.
- IMPORTANT: Always re-verify signature/ownership in your distribution script if you rely on stored data.

Production recommendations
- Use an admin-only endpoint with API key for exporting addresses.
- Add rate limiting (Cloudflare, Vercel Edge Middleware, or implement in Supabase by counting attempts).
- Monitor server logs on Vercel and Supabase.
- Consider adding replay-protection store (you can rely on the unique index + TTL check).
- In production, prefer verifying nonce server-generated rather than client timestamp if you want absolute protection:
  - Server issues a short-lived nonce to client, client signs the message containing that nonce, and server verifies both signature and nonce. This requires another endpoint to request nonce.

Support
If you want, I can:
- Provide a small Node script / Dockerfile to periodically export all verified addresses from Supabase to CSV for distribution.
- Provide a small admin serverless function to return counts & allow CSV download (protected by an admin token).
- Migrate to PlanetScale / Supabase + Prisma Data Proxy suggestion if you change DB.
