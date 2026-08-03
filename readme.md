# Clench.no

Marketing website for **CLENCH**, a brand selling custom-fit, 3D-scanned mouthguards for athletes. The site introduces the brand, explains the fitting process, and lets customers start an order.

Built to give CLENCH a fast, clean web presence ahead of launch — showcasing the product, the fitting process, and partner clinics/organizations.

## Stack

Plain HTML/CSS with a small amount of vanilla JavaScript (no frameworks, no build step):

- `index.html`, `order.html`, `process.html` — pages
- `header.html` — shared header, injected at runtime via `fetch()`
- `base.css` — site-wide styles
- `scripts/index.js` — header behavior (scroll state, mobile nav) and a scrolling logo banner
- `images/`, `fonts/`, `Samarbeid/` — static assets and partner logos

## Running locally

Because the header is loaded via `fetch('/header.html')`, opening `index.html` directly from the filesystem (`file://`) won't load it — serve the folder instead:

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

Any static file server works equally well (e.g. `npx serve`).
