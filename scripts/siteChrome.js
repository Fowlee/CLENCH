/* ===== HEADER AND FOOTER =====
 *
 * The shared chrome, held here as markup rather than in separate .html files.
 *
 * It used to live in header.html and footer.html and arrive by fetch() on
 * DOMContentLoaded — which meant the page painted its content first and the
 * header dropped in afterwards, a round trip later. On the order page that was
 * plainly visible: the form appeared, then the header pushed it down.
 *
 * Loading this as an ordinary blocking script placed directly after the header
 * placeholder means the header exists before the rest of the body is even
 * parsed. No fetch, no round trip, no shift.
 *
 * This file is now the single source for both. There is no header.html any
 * more — edit the markup here.
 */
(function () {
  const HEADER = `
<header class="site-header">
    <nav class="main-nav">
      <a href="index.html">ABOUT</a>
      <a href="designer.html">ORDER</a>
    </nav>
    <div class="logo"><img src="clench_r_red.svg" alt="Clench Logo"></div>

    <button class="hamburger" aria-label="Toggle navigation menu">
      <span></span>
      <span></span>
      <span></span>
    </button>

    <nav class="mobile-nav">
        <a href="index.html">ABOUT</a>
        <a href="designer.html">ORDER</a>
    </nav>

  </header>`;

  const FOOTER = `
<footer class="site-footer">
  <div class="footer-inner">

    <div class="footer-brand">
      <img class="footer-logo" src="clench_r_red.svg" alt="CLENCH" width="160" height="40">
      <p>
        Custom-fit mouthguards, 3D scanned and built in Norway
        for athletes who don’t compromise on protection.
      </p>
    </div>

    <nav class="footer-col" aria-label="Footer navigation">
      <h2>Site</h2>
      <a href="index.html">About</a>
      <a href="designer.html">Order</a>
      <a href="order.html#faq">FAQ</a>
      <a href="privacy.html">Privacy</a>
    </nav>

    <div class="footer-col">
      <h2>Contact</h2>
      <a href="mailto:post@clench.no">post@clench.no</a>
      <a href="designer.html">Book an appointment</a>

      <div class="footer-social">
        <span class="social-label">Follow</span>
        <a href="https://www.instagram.com/clenchguard/" target="_blank" rel="noopener"
           aria-label="CLENCH on Instagram">
          <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor"
               stroke-width="1.9" stroke-linecap="round" aria-hidden="true">
            <rect x="3" y="3" width="18" height="18" rx="5"/>
            <circle cx="12" cy="12" r="4"/>
            <circle cx="17.2" cy="6.8" r="1.1" fill="currentColor" stroke="none"/>
          </svg>
          <span>@clenchguard</span>
        </a>
      </div>
    </div>

  </div>

  <div class="footer-bottom">
    <p>&copy; <span id="footer-year">2026</span> CLENCH. All rights reserved.</p>
    <p>Clench AS &middot; Org.nr 936 281 109</p>
  </div>
</footer>`;

  /* Runs while the document is still being parsed, so the placeholder above
   * this script already exists and everything below it does not. */
  const header = document.getElementById('header-placeholder');
  if (header) header.innerHTML = HEADER;

  /* The footer placeholder sits at the end of the body and hasn't been parsed
   * yet, so it has to wait — but the markup is already here, so there's still
   * no request to make. */
  document.addEventListener('DOMContentLoaded', () => {
    const footer = document.getElementById('footer-placeholder');
    if (!footer) return;

    footer.innerHTML = FOOTER;

    // Keep the copyright year current without touching the markup
    const year = document.getElementById('footer-year');
    if (year) year.textContent = new Date().getFullYear();
  });
})();
