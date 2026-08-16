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
 */
const BOOKING_ENDPOINT = '/.netlify/functions/booking';

const CLENCH_EMAIL = 'seb@clench.no';

function initOrderForm() {
  const form = document.getElementById('order-form');
  if (!form) return;

  const submit = document.getElementById('order-submit');
  const status = document.getElementById('form-status');

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
      design: get('design'),
      records: get('records'),
      braces: data.get('braces') ? 'Yes' : 'No',
      message: get('message') || '—',
      company: get('company')
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
      'Preferred design or colors: ' + booking.design,
      'Existing impression / scan: ' + booking.records,
      'Braces: ' + booking.braces,
      'Message: ' + booking.message
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
      'with the booking ready to send. Send it and we\'ll get back to you with available times.',
      'success');
  }

  form.addEventListener('submit', event => {
    event.preventDefault();

    // Honeypot: only bots fill this in
    if ((form.elements.company.value || '').trim()) return;

    if (!validateForm()) return;

    const booking = collect();
    const firstName = booking.name.split(' ')[0];

    submit.disabled = true;
    submit.textContent = 'SENDING…';
    setStatus('Sending your booking…');

    fetch(BOOKING_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(booking)
    })
      .then(res => res.json().then(data => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (!ok) throw new Error(data.error || 'Request failed');

        form.reset();
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
        mailtoFallback(booking);
      });
  });
}

document.addEventListener('DOMContentLoaded', initOrderForm);
