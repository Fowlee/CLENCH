-- CLENCH order + design storage
--
-- Run this once in the Supabase SQL editor (Dashboard -> SQL Editor -> New query).
-- Everything here is reached from the Netlify functions using the service role
-- key, never from the browser, so the tables stay locked to everyone else.

create extension if not exists pg_trgm;

/* ----- orders -----
 * One row per booking. The design lives in design_versions, so an order can be
 * refined after impression taking without losing what the customer sent.
 */
create table if not exists orders (
  id           uuid primary key default gen_random_uuid(),

  -- Short human reference, printed on the workshop sheet and quoted in email.
  -- Generated in booking.js, e.g. CL-8F3A.
  ref          text unique not null,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  -- Contact details, straight from the booking form.
  name         text not null,
  email        text not null,
  phone        text not null,
  sport        text not null,
  club         text,
  availability text,
  records      text,
  braces       text,
  message      text,

  -- Was the required "preferred design or colors" box. The design itself now
  -- carries that intent, so this is a free-text extra.
  notes        text,

  -- new -> impression -> printed -> delivered. Flipped from the dashboard.
  status       text not null default 'new',

  -- Unguessable string in the customer's own link. The link is the capability:
  -- whoever holds it sees the design, and nothing else about the order.
  view_token   text unique not null,

  -- Digits only, so a search for "4512" matches "+47 900 45 12".
  phone_digits text generated always as (regexp_replace(phone, '\D', '', 'g')) stored
);

/* ----- design_versions -----
 * Append-only. Version 1 is what the customer submitted and is never rewritten;
 * later rows are CLENCH's refinements. The newest row is what gets made.
 */
create table if not exists design_versions (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid not null references orders(id) on delete cascade,

  version    int not null,

  -- 'customer' for v1, 'clench' for anything saved from the dashboard.
  author     text not null default 'customer',

  created_at timestamptz not null default now(),

  -- The guard's base colour, as a hex string. Fabric doesn't know about it —
  -- it's the three.js material, so it has to be stored separately.
  base_color text not null,

  -- artCanvas.toJSON(): every text and image object, positions included.
  -- Enough on its own to rebuild both the 3D preview and the print file.
  canvas     jsonb not null,

  -- Paths inside the 'designs' storage bucket. Rendering the print file in the
  -- browser and keeping it means the dashboard never has to re-run Fabric.
  print_path text,
  thumb_path text,

  unique (order_id, version)
);

-- Search is "type part of an email or phone number", so plain btree indexes
-- can't help — a leading wildcard skips them. Trigram indexes can.
create index if not exists orders_email_trgm  on orders using gin (email gin_trgm_ops);
create index if not exists orders_phone_trgm  on orders using gin (phone_digits gin_trgm_ops);
create index if not exists orders_name_trgm   on orders using gin (name gin_trgm_ops);

-- The dashboard's default view: most recent first.
create index if not exists orders_created_idx on orders (created_at desc);

create index if not exists design_versions_order_idx
  on design_versions (order_id, version desc);

/* Row level security on with no policies at all: the anon key that ships in any
 * browser can read nothing. The service role key used by the Netlify functions
 * bypasses RLS, so the functions keep working. This is the lock on the door. */
alter table orders          enable row level security;
alter table design_versions enable row level security;

/* ----- storage -----
 * Private bucket for the print files and thumbnails. Functions sign short-lived
 * URLs when the dashboard needs to show one.
 */
insert into storage.buckets (id, name, public)
values ('designs', 'designs', false)
on conflict (id) do nothing;


/* ===== Added by the security and data-protection review, 20 Aug 2026 ===== */

/* ----- consent -----
 * Article 7(1) requires the controller to be able to demonstrate consent, and
 * Article 9 requires health-related processing to be consented to explicitly and
 * separately. A checkbox validated in the browser proves nothing, so what was
 * agreed and when is recorded here.
 *
 * The site never receives a scan or an impression — those go through the clinic.
 * What it holds is the customer's statement that one exists, and whether they're
 * in orthodontic treatment. That's still health data, so it gets its own opt-in.
 */
alter table orders
  add column if not exists consent_at        timestamptz,
  add column if not exists consent_text      text,
  add column if not exists health_consent_at timestamptz,
  add column if not exists health_consent_text text;

/* ----- retention -----
 * Article 5(1)(e): personal data may be kept no longer than necessary. This is
 * the date the row becomes eligible for deletion; booking.js sets it from
 * RETENTION_MONTHS. Sweep it with a scheduled job, or by hand until there is one:
 *
 *   delete from orders where delete_after < now();
 *
 * Deleting the row cascades to design_versions, but NOT to the files in the
 * storage bucket — use the dashboard's delete action, which removes both.
 */
alter table orders
  add column if not exists delete_after timestamptz;

create index if not exists orders_delete_after_idx on orders (delete_after);

/* ----- rate limiting -----
 * The booking endpoint and the dashboard login are both reachable by anyone.
 * Counts are kept against a salted hash of the caller's address, never the
 * address itself — a limiter shouldn't quietly become a log of who visited.
 */
create table if not exists rate_limits (
  id         bigserial primary key,
  bucket     text        not null,   -- 'booking' or 'login'
  client_key text        not null,   -- sha256(ip + RATE_LIMIT_PEPPER)
  created_at timestamptz not null default now()
);

create index if not exists rate_limits_lookup_idx
  on rate_limits (bucket, client_key, created_at desc);

alter table rate_limits enable row level security;

-- Nothing here is worth keeping once its window has passed.
-- delete from rate_limits where created_at < now() - interval '1 day';
