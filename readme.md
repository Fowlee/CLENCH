# Clench.no

Marketing website for **CLENCH**, a brand selling custom-fit, 3D-scanned mouthguards for athletes. The site introduces the brand, explains the fitting process, lets customers design their own guard, and books them in for impression taking.

Built to give CLENCH a fast, clean web presence ahead of launch — showcasing the product, the fitting process, and partner clinics/organizations.

## Stack

Plain HTML/CSS with a small amount of vanilla JavaScript (no frameworks, no build step). Even the Supabase calls go through `fetch`, so there is nothing to install:

**Public site**

- `index.html`, `order.html`, `process.html` — pages
- `scripts/siteChrome.js` — the shared header and footer, inserted synchronously as the page parses so the header paints before the content rather than dropping in after it
- `base.css` — site-wide styles
- `scripts/index.js` — header/footer injection, header behavior (scroll state, mobile nav), the logo banner and the gallery
- `scripts/orderForm.js` — booking form on `order.html`: validation, then posts to the booking function
- `images/`, `fonts/`, `samarbeid/` — static assets and partner logos

**Designer**

- `designer.html`, `designer.css`, `designerPage.js` — the design tool: colour, text and image on a Fabric canvas
- `mouthguardDesigner.js` — the three.js scene: loads `assets/mouthguard.glb`, projects UVs onto the guard's front face, and wears the Fabric canvas as a texture
- `designFormat.js` — canvas size and font list, shared by everything that draws a design
- `scripts/designStore.js` — carries the design from the designer to the booking form

**Dashboard**

- `dashboard.html`, `dashboard.css`, `scripts/dashboard.js` — CLENCH's own view: search orders, look at the guard, print it, move it along
- `db/schema.sql` — the Supabase tables, run once by hand

**Serverless**

- `netlify/functions/booking.js` — stores the order and emails CLENCH plus a copy to the customer, via Brevo
- `netlify/functions/design.js` — serves a design behind the link in the customer's confirmation email
- `netlify/functions/admin.js` — dashboard sign in / sign out
- `netlify/functions/orders.js` — dashboard search, order detail and status changes
- `netlify/functions/lib/` — shared helpers (Supabase over `fetch`, and the session cookie)

## How an order flows

1. The customer designs a guard on `designer.html`. Designing is required — there is no path to the booking form without it.
2. "Continue to booking" hands the design to `order.html` through browser storage. Nothing reaches the server yet, so browsing the designer creates no orders.
3. Submitting the booking sends the design and the contact details together. `booking.js` stores both and emails CLENCH and the customer.
4. The customer's email links to `designer.html?d=<token>` — their design, read only. The link doesn't expire.
5. CLENCH's email links into the dashboard, where the order can also be found by searching an email or phone number.
6. The client opens the order, turns the guard around, prints the flat artwork, and flips the status as it's made.

Designs are versioned. Version 1 is what the customer submitted and is never rewritten.

## Setup

### Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. Open **SQL Editor → New query**, paste `db/schema.sql`, and run it. That creates the tables, the search indexes and the private `designs` storage bucket.
3. Copy the project URL and the **service_role** key from **Project settings → API**.

Row level security is on with no policies, so the anon key can read nothing. Only the Netlify functions, using the service role key, can reach the data.

### Netlify environment variables

Site configuration → Environment variables:

| Variable | Required | Default | What it's for |
| --- | --- | --- | --- |
| `BREVO_APIKEY` | yes | — | Sending mail (`BREVO_API_KEY` also accepted) |
| `BOOKING_TO` | no | `post@clench.no` | Where bookings land |
| `BOOKING_FROM` | no | `post@clench.no` | Verified sender in Brevo |
| `SUPABASE_URL` | yes | — | `https://<project>.supabase.co` |
| `SUPABASE_SERVICE_KEY` | yes | — | Service role key. Server side only — never in the browser |
| `DASHBOARD_PASSWORD` | yes | — | What the client types to reach `/dashboard.html` |
| `DASHBOARD_SECRET` | yes | — | Long random string signing the session cookie |

Generate a secret with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Changing `DASHBOARD_SECRET` signs everybody out — that's how to revoke a session.

Mail goes through Brevo rather than Domeneshop because Netlify Functions run on AWS, and Domeneshop rejects Amazon IPs. `clench.no` must be verified in Brevo (DKIM records) for the sender address to work.

If the booking function can't be reached, the form falls back to opening the visitor's mail app with the booking pre-written. The design can't travel that way, so the fallback says so and keeps the design in the browser.

## Running locally

The pages fetch other things at runtime, so opening `index.html` from the filesystem (`file://`) won't work — serve the folder instead:

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

That covers the public pages and the designer. The booking flow, the customer's design link and the dashboard all need the serverless functions, which means the Netlify CLI and the environment variables above in a local `.env`:

```bash
npx netlify dev
```
