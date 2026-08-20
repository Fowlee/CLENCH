# Where we left off

Paused 19 August 2026. Nothing is committed or pushed — it's all in the working tree.

## Setup: done and verified (20 Aug 2026)

All credentials are in `.env` and confirmed working against the real services:

- **Supabase** — `orders` and `design_versions` both answer, `designs` bucket exists and is private. The schema had already been run.
- **Secret key** accepted. (Note: `SUPABASE_URL` was originally the *dashboard* address; the API endpoint is `https://<project-ref>.supabase.co`.)
- **Brevo** — new key authenticates as `seb@clench.no`. Free plan, 300 sends/day, and each booking sends two emails.
- **Node 22.23.2** installed under nvm so `netlify-cli` runs. The default is deliberately still v20 — use `nvm use 22` in the shell where you run Netlify.

You do **not** need `netlify login` / `netlify link`: `.env` has everything, so `netlify dev` runs unlinked.

```bash
nvm use 22
npx netlify dev
```

## What's built

The full first phase — design → book → stored → emailed → found → printed.

| Area | Files |
| --- | --- |
| Storage | `db/schema.sql` — orders, append-only design_versions, trigram search indexes, private bucket |
| Booking | `netlify/functions/booking.js` — stores order + design v1, emails both sides with links and the print file attached |
| Customer link | `netlify/functions/design.js`, view mode in `designerPage.js` — `designer.html?d=<token>`, read-only, returns nothing identifying |
| Handoff | `scripts/designStore.js` — carries the design from designer to order form |
| Dashboard | `dashboard.html`, `dashboard.css`, `scripts/dashboard.js`, `netlify/functions/admin.js`, `netlify/functions/orders.js` |
| Shared | `designFormat.js` — canvas size and font list, so the designer and dashboard can't drift apart |

Changed along the way: `order.html` and `scripts/orderForm.js` now require a design and show it; `mouthguardDesigner.js` gained `snapshot()` and `lockToViewing()`; the required "preferred design or colors" box became an optional note.

## Tested end to end (20 Aug 2026)

The whole first phase was exercised against the real Supabase project and real Brevo sends, through `netlify dev`:

| Step | Result |
| --- | --- |
| Booking POST | Stored, both emails sent, refs `CL-2608-3519` and `CL-2608-9692` |
| Rows in Supabase | Order + design v1 for each, print and thumb uploaded to the bucket |
| Search, partial phone `4512` | Found both — matching the *middle* of `+47 900 45 12` |
| Search, partial email `gmail` | Found the right one |
| Order detail | Signed URLs for print and thumbnail both resolve |
| Status change | Persisted (`CL-2608-9692` was left on `impression` by the test) |
| Customer view link | Returns the design and the ref, and no name/email/phone |
| Print file download | HTTP 200, valid `image/png` |
| Auth | 401 without a session, 401 on a wrong password, cookie set on the right one |

Also tested earlier in headless Chrome: the designer boots and its tools work, view mode handles a bad token, the order page blocks correctly when there's no design, the dashboard falls back to sign-in.

**Two test orders are still in the database.** Handy for clicking around the dashboard; delete them before going live.

**Not yet checked by a human:** whether the two emails actually *look* right in an inbox, and whether the designer is usable on a real phone.

Two real bugs were found and fixed along the way:

1. With browser storage blocked, the order page showed neither the form nor the missing-design panel — a dead end on a now-mandatory step. `designStore.js` now has a timeout on IndexedDB and falls back to sessionStorage.
2. Signing into the dashboard appeared to do nothing. The login was actually succeeding; `.signin` had `display: grid`, which beats the `hidden` attribute's `display: none`, so the full-height panel stayed on top of the app forever. `.order-design` (flex) had the same fault on the order page. Both stylesheets now carry `[hidden] { display: none !important; }` — worth remembering, since both pages show and hide sections with that attribute.

## Consumer-readiness work (20 Aug 2026)

Both launch blockers are closed and verified.

**The model was 12 MB.** Designing is the only route to an order, so that download sat in front of every customer — roughly 20 seconds on a phone connection. Draco-compressed to **977 KB**, decoder loaded from the same CDN as three.js and pinned to the same version. Verified unchanged: the rendered guard measured 16460 opaque pixels against 16461 before, so the UV projection, the notch and the front-face-only artwork all survived. The uncompressed original is kept outside the repo until you're happy.

**No WebGL used to kill the page.** The renderer was constructed at module top level, so a browser without WebGL — old phone, hardware acceleration off, locked-down in-app browser — lost the design tools, the Continue button and the whole booking, silently. `MouthguardDesigner` now degrades: it shows an explanation in place of the guard and every method becomes a no-op. Verified with WebGL disabled — tools build, artwork draws, an order can still be placed. Those orders get a flat thumbnail composited from the artwork and guard colour instead of a 3D render.

**Designer fixes from phone testing:**

- Selection handles were drawn in canvas pixels on a 1024px backing store shown at ~350px, so a 14px handle arrived at 4.8px. They now scale to the displayed size: 24 CSS px visible with a 44 CSS px grab area on touch, 16px on desktop. Mid-edge handles are hidden on touch, so images scale from corners only and can't be stretched out of shape.
- The design canvas now sits on the guard's actual colour. A fixed backdrop made white artwork invisible while designing but correct on the guard.
- Layer controls (send back / bring forward / delete) under the canvas — previously the only way to reorder was to delete and re-add.
- The designer restores an in-progress design when you return from the booking form, instead of starting blank.
- `fitCanvasToPanel()` ran only on the text tab, and nothing forced a repaint on tab switch.

## Security and GDPR hardening (20 Aug 2026)

Full audit: https://claude.ai/code/artifact/52009d76-b547-432b-b7e3-47275411959f

**BEFORE ANYTHING WORKS AGAIN:** the schema changed. Open the Supabase SQL editor
and run the section of `db/schema.sql` headed *"Added by the security and
data-protection review"*. Until then the rate limiter can't reach its table and
fails closed, so bookings and dashboard logins both return 429. That is the
correct behaviour — an ungated mail sender is worse than a closed one — but it
does mean the site is shut until the SQL is run.

**Also set four environment variables in Netlify** (they're already in the local
`.env`): `BOOKING_SECRET`, `RATE_LIMIT_PEPPER`, and the rotated
`DASHBOARD_SECRET` and `DASHBOARD_PASSWORD`. The old password and secret were
disclosed in a development transcript and must not be reused.

### Fixed

| | What was wrong |
| --- | --- |
| **S1** | The booking endpoint sent mail from a DKIM-signed clench.no address to any recipient a request named, with no auth and no throttle — a spam relay wearing your own domain. Now needs a signed ticket from `/.netlify/functions/ticket`, capped at 5 per caller per hour. |
| **S2** | The client chose the `Content-Type` of stored files, so a booking could store `data:text/html` and have Supabase serve it as a web page. Now forced to `image/png` and the PNG magic bytes are checked. |
| **S3** | Canvas JSON was stored with only an `Array.isArray` check, then deserialised by Fabric inside the dashboard. Now type-whitelisted, capped at 40 objects, and image sources must be data URLs — no remote fetch from the admin's browser. |
| **S4 / G6** | Fabric, three.js, Draco and six Google fonts loaded from CDNs with no SRI. All self-hosted under `vendor/`, plus a strict CSP. Also removes the transfer of every visitor's IP to Google. |
| **S5** | Login had only a 1s delay; parallel guessing was unaffected. Now 10 attempts per 15 minutes. |
| **S6** | Refs are validated against `^CL-\d{4}-[0-9A-F]{4}$` rather than only URL-encoded. |
| **S7 / G9** | Supabase error bodies (which quote row data) were logged. Only the code and message now propagate. |
| **S8** | Secret comparison returned early on length mismatch, leaking password length. Both sides are now hashed to a fixed 32 bytes first. |
| **G1 / G2** | Consent was validated in the browser and never recorded. Now two explicit checkboxes — one for contact details, one for health data — enforced server-side, with the wording and timestamp stored from the server's own copy. |
| **G3** | `privacy.html` written and linked. Controller is Clench AS, org. nr 936 281 109; database confirmed EU; retention 24 months, matching `RETENTION_MONTHS`. |
| **G4** | `delete_after` set from `RETENTION_MONTHS` (default 24). Sweep with `delete from orders where delete_after < now()`. |
| **G5 / S11** | Erasure and export in the dashboard. Deletion removes the storage files too, which the database cascade does not reach. |

### Notes

- The site never receives dental scans or impressions — those go through the clinic. Only the customer's *statement* about their teeth is stored, which is still Article 9 health data but narrower than the audit first assumed. The old consent wording promised to store "dental records" and was wrong; it has been corrected.
- The CSP allows the inline import map by SHA-256 hash. **Editing that block, even its whitespace, breaks every page until the hash is regenerated** — the command is in `netlify.toml`.
- Verified under the new CSP: Fabric loads, all seven fonts build, the Draco-compressed guard renders identically (16460 px), no violations.

### Still open from the audit

- **Sign DPAs with Supabase, Brevo and Netlify.** `privacy.html` already tells customers these are in place, so this is now a statement that has to be made true rather than a nice-to-have.
- The FAQ at `order.html:204` promises to keep a record of the customer's teeth so they need scanning only once. That is the clinic's records, not this site's — but read alongside the notice's 24 months it looks contradictory, and a clarifying line would help.
- Check Fabric 5.3.0 against a current advisory feed — it parses untrusted JSON in the admin page.
- Retention settled at 24 months; `RETENTION_MONTHS` default and the notice agree.
- Schedule the retention sweep; there is no job yet.

## Still to decide

- **How long orders are kept.** The one GDPR question that isn't a config flag.
- **Can the client start a design himself?** For phone orders and walk-ins. Cheap now, awkward later.
- **Test the designer on a real phone.** Every booking now depends on dragging Fabric handles with a thumb.

## Deliberately not built yet

Phase 2: editing a saved design from the dashboard, reverting to the customer's original, and the proper print sheet using `images/print-zone.svg`. None of it can happen until people have actually come in for impressions, so it doesn't block launch.

Full spec: https://claude.ai/code/artifact/d6ae4aa3-9998-45bf-9b0f-63605e6ebe0a
