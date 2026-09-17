/* ===== ORDER FORM =====
 *
 * Validates the booking form and posts it to the Netlify function in
 * netlify/functions/booking.js, which emails CLENCH and sends the customer
 * a copy. Nothing sensitive lives here — the mail credentials sit in
 * Netlify's environment variables, server side.
 *
 * If the request fails (function down, offline, local file://) the form
 * falls back to opening the visitor's mail app with everything pre-written,
 * so a booking is never simply lost.
 *
 * The design itself is made on designer.html and handed over through
 * designStore.js. Every order carries one, so this page shows the missing-design
 * panel instead of the form if it can't find it.
 */
const BOOKING_ENDPOINT = '/.netlify/functions/booking';
const TICKET_ENDPOINT = '/.netlify/functions/ticket';

const CLENCH_EMAIL = 'post@clench.no';

function initOrderForm() {
  const form = document.getElementById('order-form');
  if (!form) return;

  const submit = document.getElementById('order-submit');
  const status = document.getElementById('form-status');

  // Set once the design is loaded; the form only appears after that.
  let design = null;

  /* Proof this booking came from a browser that loaded the page, fetched when
   * the form appears and sent back with the submission. The booking endpoint
   * sends mail from a verified clench.no address, so without this it would send
   * whatever a script asked it to, wherever the script wanted. */
  let bookingTicket = null;

  fetch(TICKET_ENDPOINT)
    .then(response => response.json())
    .then(data => { bookingTicket = data.ticket || null; })
    .catch(err => console.error('Could not get a booking ticket:', err));

  /* Nothing on this page makes sense without a design, so the form stays hidden
   * until one is found. Somebody who bookmarked order.html gets a way forward
   * rather than a form that would fail on submit. */
  window.ClenchDesign.load().then(saved => {
    const preview = document.getElementById('order-design');
    const missing = document.getElementById('order-missing');
    const loading = document.getElementById('order-loading');

    if (loading) loading.hidden = true;

    if (!saved) {
      if (missing) missing.hidden = false;
      return;
    }

    design = saved;
    form.hidden = false;

    if (preview && saved.thumb) {
      document.getElementById('order-design-thumb').src = saved.thumb;
      preview.hidden = false;
    }
  });

  function setStatus(message, kind) {
    status.textContent = message;
    status.className = 'form-status' + (kind ? ' is-' + kind : '');
  }

  function showError(field, message) {
    const slot = form.querySelector('[data-error-for="' + field.name + '"]');
    if (slot) slot.textContent = message;
    field.classList.add('has-error');
    field.setAttribute('aria-invalid', 'true');
  }

  function clearError(field) {
    const slot = form.querySelector('[data-error-for="' + field.name + '"]');
    if (slot) slot.textContent = '';
    field.classList.remove('has-error');
    field.removeAttribute('aria-invalid');
  }

  function validateField(field) {
    const value = (field.value || '').trim();

    if (field.type === 'checkbox') {
      if (field.required && !field.checked) {
        return 'Please tick this box to continue.';
      }
      return '';
    }

    if (field.required && !value) {
      return 'This field is required.';
    }

    if (field.type === 'email' && value && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) {
      return 'Please enter a valid email address.';
    }

    // Digits, spaces and the usual + ( ) - separators, at least 6 digits
    if (field.type === 'tel' && value) {
      const digits = value.replace(/\D/g, '');
      if (digits.length < 6 || /[^\d\s+()\-]/.test(value)) {
        return 'Please enter a valid phone number.';
      }
    }

    return '';
  }

  // Required fields plus anything optional that still has a format to check
  const validated = Array.from(
    form.querySelectorAll('input[required], select[required], textarea[required], input[type="tel"], input[type="email"]')
  );

  validated.forEach(field => {
    field.addEventListener('blur', () => {
      const error = validateField(field);
      if (error) showError(field, error);
      else clearError(field);
    });

    field.addEventListener('input', () => {
      if (field.classList.contains('has-error')) clearError(field);
    });
    field.addEventListener('change', () => {
      if (field.classList.contains('has-error')) clearError(field);
    });
  });

  function validateForm() {
    let firstInvalid = null;

    validated.forEach(field => {
      const error = validateField(field);
      if (error) {
        showError(field, error);
        if (!firstInvalid) firstInvalid = field;
      } else {
        clearError(field);
      }
    });

    if (firstInvalid) {
      firstInvalid.focus();
      setStatus('Please check the highlighted fields.', 'error');
      return false;
    }

    return true;
  }

  function collect() {
    const data = new FormData(form);
    const get = key => (data.get(key) || '').toString().trim();

    return {
      name: get('name'),
      email: get('email'),
      phone: get('phone'),
      sport: get('sport'),
      club: get('club') || '—',
      availability: get('availability') || '—',
      notes: get('notes') || '—',
      records: get('records'),
      braces: data.get('braces') ? 'Yes' : 'No',
      message: get('message') || '—',
      company: get('company'),

      /* Sent as plain booleans. The server keeps its own copy of the wording
         and records that, so what was agreed can't be rewritten from here. */
      consent: form.elements.consent.checked,
      healthConsent: form.elements.healthConsent.checked
    };
  }

  function summarise(booking) {
    return [
      'Name: ' + booking.name,
      'Email: ' + booking.email,
      'Phone: ' + booking.phone,
      'Sport: ' + booking.sport,
      'Club / team: ' + booking.club,
      'Preferred days / times: ' + booking.availability,
      'Design notes: ' + booking.notes,
      'Existing impression / scan: ' + booking.records,
      'Braces: ' + booking.braces,
      'Message: ' + booking.message,
      '',
      'I agree to CLENCH storing my contact details, and what I have said about',
      'my teeth and any orthodontic treatment, to produce my mouthguard.'
    ].join('\n');
  }

  // Couldn't reach the function: hand the booking to the mail app instead
  function mailtoFallback(booking) {
    const subject = 'Booking av avtrykk – CLENCH – ' + booking.name;
    const body = 'Hi CLENCH,\n\nI would like to book an appointment for impression taking.\n\n' +
      summarise(booking) + '\n';

    window.location.href = 'mailto:' + CLENCH_EMAIL +
      '?subject=' + encodeURIComponent(subject) +
      '&body=' + encodeURIComponent(body);

    setStatus('We couldn\'t send this from the website, so your email app is opening ' +
      'with the booking ready to send. Your design can\'t travel by email, so send ' +
      'that message and we\'ll reply — your design is still saved in this browser.',
      'success');
  }

  form.addEventListener('submit', event => {
    event.preventDefault();

    // Honeypot: only bots fill this in
    if ((form.elements.company.value || '').trim()) return;

    if (!validateForm()) return;

    if (!design) {
      setStatus('We lost your design somewhere. Please design your guard again.', 'error');
      return;
    }

    const booking = collect();
    const firstName = booking.name.split(' ')[0];

    submit.disabled = true;
    submit.textContent = 'SENDING…';
    setStatus('Sending your booking…');

    fetch(BOOKING_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // The design is the reason there's an order at all, so it travels with it
      body: JSON.stringify(Object.assign({}, booking, { design, ticket: bookingTicket }))
    })
      .then(res => res.json().then(data => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (!ok) {
          const refused = new Error(data.error || 'We couldn\'t send that booking.');
          refused.fromServer = true;
          throw refused;
        }

        form.reset();
        window.ClenchDesign.clear();
        submit.textContent = 'BOOKING SENT';
        setStatus(
          data.copySent
            ? 'Thanks, ' + firstName + '! Your booking is on its way and a copy is in your inbox. ' +
              'We\'ll reply with available times.'
            : 'Thanks, ' + firstName + '! Your booking is on its way. ' +
              'We couldn\'t send you a copy, but we have your request and will reply with available times.',
          'success'
        );
      })
      .catch(err => {
        console.error('Booking failed:', err);
        submit.disabled = false;
        submit.textContent = 'BOOK APPOINTMENT';

        /* Two very different failures. If the server answered and refused, it
         * told us why, and the customer can act on that — opening their mail
         * app instead would hide a fixable problem behind a vague message.
         * The mail fallback is only for a server we never reached at all. */
        if (err.fromServer) setStatus(err.message, 'error');
        else mailtoFallback(booking);
      });
  });
}

document.addEventListener('DOMContentLoaded', initOrderForm);
