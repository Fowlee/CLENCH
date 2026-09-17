function initHeader() {
  const header = document.querySelector('.site-header');
  const blackBar = document.querySelector('.black-bar');
  const hamburger = document.querySelector('.hamburger');

  if (!header) return; // nothing to do if header isn't there

  function handleScroll() {
    if (!blackBar) return; // guard in case this page has no black bar
    const blackBarTop = blackBar.getBoundingClientRect().top;

    if (blackBarTop <= 0) {
      header.classList.add('scrolled-black');
    } else {
      header.classList.remove('scrolled-black');
    }
  }

  window.addEventListener('scroll', handleScroll);

  if (hamburger) {
    hamburger.addEventListener('click', () => {
      hamburger.classList.toggle('active');
      header.classList.toggle('menu-open');
    });
  }

  const mobileLinks = document.querySelectorAll('.mobile-nav a');
  mobileLinks.forEach(link => {
    link.addEventListener('click', () => {
      if (hamburger) hamburger.classList.remove('active');
      header.classList.remove('menu-open');
    });
  });
}

function initBanner() {
  const track = document.getElementById('banner-track');
  if (!track) return;

  const originalItems = Array.from(track.children);

  // Clone once so we have a seamless loop
  originalItems.forEach(img => {
    track.appendChild(img.cloneNode(true));
  });

  const gap = parseFloat(getComputedStyle(track).gap) || 64;
  let offset = 0;
  let setWidth = 0;
  const speed = 0.5; // px per frame

  function measureAndAnimate() {
    const firstItem = track.children[0];
    const lastOriginal = track.children[originalItems.length - 1];
    setWidth =
      lastOriginal.getBoundingClientRect().right -
      firstItem.getBoundingClientRect().left +
      gap;

    function step() {
      offset += speed;
      if (offset >= setWidth) offset -= setWidth;
      track.style.transform = `translateX(${-offset}px)`;
      requestAnimationFrame(step);
    }

    requestAnimationFrame(step);
  }

  // Wait for all images to load before measuring widths
  const images = Array.from(track.querySelectorAll('img'));
  let loaded = 0;
  function onLoad() {
    loaded++;
    if (loaded === images.length) measureAndAnimate();
  }
  images.forEach(img => {
    if (img.complete) { onLoad(); }
    else { img.addEventListener('load', onLoad); img.addEventListener('error', onLoad); }
  });
}

// Gallery carousel images — add/remove/reorder filenames here (all live in images/)
const GALLERY_IMAGES = [
  'img-3792.webp', 'img-4336.webp', 'img-4742.webp', 'img-3912.webp',
  'img-4778.webp', 'img-4165.webp', 'img-4537.webp', 'img-3787.webp',
  'img-4748.webp', 'img-3798.webp', 'img-4338.webp',
  'img-4781.webp', 'img-4626.webp', 'img-4167.webp', 'img-4539.webp',
  'img-3797.webp', 'img-3919.webp', 'img-3794.webp', 'b0000fad-d31c-4220-a5a0-f7ef185be45d.webp'
];

function initGallery() {
  const track = document.getElementById('gallery-track');
  if (!track) return;

  const prev = document.getElementById('gallery-prev');
  const next = document.getElementById('gallery-next');
  const bar = document.getElementById('gallery-progress');
  const current = document.getElementById('gallery-current');
  const total = document.getElementById('gallery-total');

  // Build the slides
  GALLERY_IMAGES.forEach((file, i) => {
    const slide = document.createElement('li');
    slide.className = 'carousel-slide';

    const img = document.createElement('img');
    img.src = 'images/' + file;
    img.alt = 'CLENCH custom mouthguard, photo ' + (i + 1);
    img.decoding = 'async';
    img.loading = i < 3 ? 'eager' : 'lazy'; // first row is above the fold-ish

    slide.appendChild(img);
    track.appendChild(slide);
  });

  if (total) total.textContent = GALLERY_IMAGES.length;

  // Width of one slide + the gap between slides
  function step() {
    const slide = track.querySelector('.carousel-slide');
    if (!slide) return track.clientWidth;
    const gap = parseFloat(getComputedStyle(track).gap) || 0;
    return slide.getBoundingClientRect().width + gap;
  }

  function update() {
    const max = track.scrollWidth - track.clientWidth;
    const ratio = max > 0 ? track.scrollLeft / max : 0;

    if (bar) bar.style.width = (ratio * 100) + '%';

    if (current) {
      const size = step();
      const perView = Math.max(1, Math.round(track.clientWidth / size));
      const count = GALLERY_IMAGES.length;

      // first visible slide, clamped so the last page doesn't overshoot
      let first = Math.round(track.scrollLeft / size) + 1;
      first = Math.min(Math.max(first, 1), Math.max(1, count - perView + 1));
      const last = Math.min(count, first + perView - 1);

      // show a range when more than one slide is on screen
      current.textContent = last > first ? first + '–' + last : String(first);
    }

    // 1px slack so rounding doesn't leave a button stuck enabled
    if (prev) prev.disabled = track.scrollLeft <= 1;
    if (next) next.disabled = track.scrollLeft >= max - 1;
  }

  function scrollByStep(direction) {
    track.scrollBy({ left: direction * step(), behavior: 'smooth' });
  }

  if (prev) prev.addEventListener('click', () => scrollByStep(-1));
  if (next) next.addEventListener('click', () => scrollByStep(1));

  track.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); scrollByStep(-1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); scrollByStep(1); }
  });

  let ticking = false;
  track.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => { update(); ticking = false; });
  }, { passive: true });

  window.addEventListener('resize', update);
  update();
}

// with defer this runs after HTML is parsed
/* The header and footer are already in the document by now — scripts/siteChrome.js
 * puts them there during parsing, rather than fetching them afterwards. All that
 * is left is to attach the behaviour. */
document.addEventListener('DOMContentLoaded', () => {
  initHeader();
  initBanner();
  initGallery();
});

