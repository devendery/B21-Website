-- Supabase SQL schema: run in Supabase SQL editor (or psql) to create the registrations table
-- This creates a uniqueness constraint on lower(address) + chain to avoid duplicates (case-insensitive).

create table if not exists public.registrations (
  id uuid default gen_random_uuid() primary key,
  address text not null,
  signature text,
  message text,
  chain text default 'polygon',
  source text,
  timestamp timestamptz,
  verified_at timestamptz,
  created_at timestamptz default now()
);

-- Create a functional index for case-insensitive uniqueness on address+chain
create unique index if not exists ux_registrations_address_chain on public.registrations ((lower(address)), chain);