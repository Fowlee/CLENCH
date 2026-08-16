# Clench.no

Marketing website for **CLENCH**, a brand selling custom-fit, 3D-scanned mouthguards for athletes. The site introduces the brand, explains the fitting process, and lets customers start an order.

Built to give CLENCH a fast, clean web presence ahead of launch — showcasing the product, the fitting process, and partner clinics/organizations.

## Stack

Plain HTML/CSS with a small amount of vanilla JavaScript (no frameworks, no build step):

- `index.html`, `order.html`, `process.html` — pages
- `header.html`, `footer.html` — shared header and footer, injected at runtime via `fetch()`
- `base.css` — site-wide styles
- `scripts/index.js` — header/footer injection, header behavior (scroll state, mobile nav) and a scrolling logo banner
- `scripts/orderForm.js` — booking form on `order.html`: validation, then posts to the booking function
- `netlify/functions/booking.js` — serverless endpoint that emails the booking to CLENCH and a copy to the customer, via Brevo

## Booking form

`order.html` posts to `/.netlify/functions/booking`. The function needs these environment
variables (Netlify → Site configuration → Environment variables):

| Variable | Required | Default |
| --- | --- | --- |
| `BREVO_APIKEY` | yes | — (`BREVO_API_KEY` also accepted) |
| `BOOKING_TO` | no | `post@clench.no` |
| `BOOKING_FROM` | no | `post@clench.no` |

Mail goes through Brevo rather than Domeneshop because Netlify Functions run on AWS,
and Domeneshop rejects Amazon IPs. `clench.no` must be verified in Brevo (DKIM records)
for the sender address to work.

If the function can't be reached, the form falls back to opening the visitor's mail app
with the booking pre-written, so a submission is never lost.
- `images/`, `fonts/`, `Samarbeid/` — static assets and partner logos

## Running locally

Because the header is loaded via `fetch('/header.html')`, opening `index.html` directly from the filesystem (`file://`) won't load it — serve the folder instead:

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

Any static file server works equally well (e.g. `npx serve`).
