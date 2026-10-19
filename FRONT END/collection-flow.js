(function () {
  'use strict';

  var form = document.getElementById('collectionRequestForm');
  var overlay = document.getElementById('requestCollection');
  var modal = document.querySelector('.request-modal');
  if (!form || !overlay || !modal) return;

  var API = 'http://localhost:3000/api/collection-requests';
  var step = 1;
  var map;
  var marker;
  var submittedRequest;
  var focusBeforeClose;
  var steps = Array.prototype.slice.call(form.querySelectorAll('.request-step'));
  var indicators = Array.prototype.slice.call(document.querySelectorAll('[data-step-indicator]'));
  var fields = {
    name: document.getElementById('requestName'),
    phone: document.getElementById('requestPhone'),
    district: document.getElementById('requestDistrict'),
    landmark: document.getElementById('requestLandmark'),
    latitude: document.getElementById('requestLatitude'),
    longitude: document.getElementById('requestLongitude')
  };
  var success = document.getElementById('requestSuccess');

  function value(field) { return field.value.trim(); }
  function selected(name) {
    var input = form.querySelector('input[name="' + name + '"]:checked');
    return input ? input.value : '';
  }
  function displayStep(number) {
    step = number;
    steps.forEach(function (panel) { panel.hidden = Number(panel.dataset.step) !== step; });
    indicators.forEach(function (item) {
      var n = Number(item.dataset.stepIndicator);
      item.classList.toggle('is-active', n === step);
      item.classList.toggle('is-complete', n < step);
      var dot = item.querySelector('.stepper-dot');
      if (dot) dot.innerHTML = n < step ? '<i class="fas fa-check" aria-hidden="true"></i>' : String(n);
      var small = item.querySelector('small');
      if (small) small.textContent = 'STEP ' + n + (n === step ? ' (ACTIVE)' : '');
    });
    document.getElementById('stepCount').textContent = 'Step ' + step + ' of 3';
    document.getElementById('nextStep').hidden = step === 3;
    document.getElementById('requestSubmit').hidden = step !== 3;
    document.getElementById('backStep').hidden = step === 1;
    document.getElementById('cancelRequest').hidden = step !== 1;
    if (step === 2) {
      document.getElementById('contactSummary').textContent = value(fields.name) + '  •  +251 ' + value(fields.phone);
      ensureMap();
      window.setTimeout(function () { if (map) map.invalidateSize(); }, 80);
    }
    if (step === 3) updateReview();
    modal.scrollTop = 0;
  }
  function ensureMap() {
    if (map || !window.L) return;
    map = L.map('requestMap', { scrollWheelZoom: false }).setView([8.54, 39.27], 14);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(map);
    map.on('click', function (event) { setCoordinates(event.latlng.lat, event.latlng.lng, 'Collection point selected on map.'); });
    if (fields.latitude.value && fields.longitude.value) setCoordinates(Number(fields.latitude.value), Number(fields.longitude.value), 'Saved collection point.');
  }
  function setCoordinates(lat, lng, message) {
    fields.latitude.value = Number(lat).toFixed(6);
    fields.longitude.value = Number(lng).toFixed(6);
    document.getElementById('requestCoordinatesErr').textContent = '';
    if (map) {
      var point = [Number(lat), Number(lng)];
      if (marker) marker.setLatLng(point);
      else marker = L.marker(point, { draggable: true }).addTo(map);
      marker.off('dragend').on('dragend', function (event) {
        var p = event.target.getLatLng();
        setCoordinates(p.lat, p.lng, 'Pinpoint adjusted.');
      });
      map.panTo(point);
    }
    document.getElementById('requestLocationStatus').textContent = message + ' ' + Number(lat).toFixed(5) + ', ' + Number(lng).toFixed(5);
  }
  function updateReview() {
    document.getElementById('reviewContact').textContent = value(fields.name);
    document.getElementById('reviewPhone').textContent = '+251 ' + value(fields.phone);
    document.getElementById('reviewLocation').textContent = value(fields.district).replace(/\s*\([^)]*\)/, '');
    document.getElementById('reviewLandmark').textContent = value(fields.landmark);
  }
  function setError(id, message) { document.getElementById(id).textContent = message || ''; }
  function validPhone(text) { return /^[0-9\s()+.-]{7,25}$/.test(text) && text.replace(/\D/g, '').length >= 7; }
  function validateContact() {
    var ok = true;
    setError('requestNameErr', ''); setError('requestPhoneErr', '');
    if (value(fields.name).length < 2) { setError('requestNameErr', 'Enter your full name.'); ok = false; }
    if (!validPhone(value(fields.phone))) { setError('requestPhoneErr', 'Enter a valid phone number.'); ok = false; }
    if (!ok) form.querySelector('.field-error:not(:empty)')?.previousElementSibling?.querySelector('input')?.focus();
    return ok;
  }
  function validateLocation() {
    var ok = true;
    setError('requestDistrictErr', ''); setError('requestLandmarkErr', ''); setError('requestCoordinatesErr', '');
    if (!value(fields.district)) { setError('requestDistrictErr', 'Choose your sub-city or kebele.'); ok = false; }
    if (value(fields.landmark).length < 3) { setError('requestLandmarkErr', 'Add a street or nearby landmark.'); ok = false; }
    var lat = Number(fields.latitude.value); var lng = Number(fields.longitude.value);
    if (!fields.latitude.value || !fields.longitude.value || !Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
      setError('requestCoordinatesErr', 'Select the pickup point on the map or enter valid coordinates.'); ok = false;
    }
    return ok;
  }
  function setOpen(open) {
    if (open) {
      focusBeforeClose = document.activeElement;
      overlay.classList.remove('is-closed');
      document.body.classList.add('request-modal-open');
      window.setTimeout(function () { fields.name.focus(); }, 20);
    } else {
      overlay.classList.add('is-closed');
      document.body.classList.remove('request-modal-open');
      if (focusBeforeClose && focusBeforeClose.focus) focusBeforeClose.focus();
    }
  }
  document.querySelectorAll('a[href="#requestCollection"]').forEach(function (link) {
    link.addEventListener('click', function (event) { event.preventDefault(); setOpen(true); });
  });
  document.getElementById('closeRequest').addEventListener('click', function () { setOpen(false); });
  document.getElementById('closeSuccess').addEventListener('click', function () { setOpen(false); });
  document.getElementById('cancelRequest').addEventListener('click', function () { setOpen(false); });
  overlay.addEventListener('click', function (event) { if (event.target === overlay) setOpen(false); });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && !overlay.classList.contains('is-closed')) setOpen(false);
    if (event.key === 'Tab' && !overlay.classList.contains('is-closed')) {
      var focusable = Array.prototype.slice.call(modal.querySelectorAll('button:not([disabled]):not([hidden]), input:not([disabled]), select:not([disabled]), a[href]')).filter(function (el) { return el.offsetParent !== null; });
      if (!focusable.length) return;
      if (event.shiftKey && document.activeElement === focusable[0]) { event.preventDefault(); focusable[focusable.length - 1].focus(); }
      else if (!event.shiftKey && document.activeElement === focusable[focusable.length - 1]) { event.preventDefault(); focusable[0].focus(); }
    }
  });
  document.getElementById('nextStep').addEventListener('click', function () {
    if (step === 1 && validateContact()) displayStep(2);
    else if (step === 2 && validateLocation()) displayStep(3);
  });
  document.getElementById('backStep').addEventListener('click', function () { displayStep(Math.max(1, step - 1)); });
  document.querySelectorAll('[data-go-step]').forEach(function (button) {
    button.addEventListener('click', function () { displayStep(Number(button.dataset.goStep)); });
  });
  form.querySelectorAll('input[name="wasteCategory"]').forEach(function (input) {
    input.addEventListener('change', function () { form.querySelectorAll('.category-card').forEach(function (card) { card.classList.toggle('is-selected', card.contains(input) && input.checked); }); });
  });
  form.querySelectorAll('input[name="loadVolume"]').forEach(function (input) {
    input.addEventListener('change', function () { form.querySelectorAll('.volume-option').forEach(function (label) { label.classList.toggle('is-selected', label.contains(input) && input.checked); }); });
  });
  [fields.latitude, fields.longitude].forEach(function (field) {
    field.addEventListener('change', function () {
      var lat = Number(fields.latitude.value); var lng = Number(fields.longitude.value);
      if (fields.latitude.value && fields.longitude.value && Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) setCoordinates(lat, lng, 'Coordinates updated.');
    });
  });
  document.getElementById('useRequestCurrentLocation').addEventListener('click', function () {
    var button = document.getElementById('useRequestCurrentLocation');
    if (!navigator.geolocation) { document.getElementById('requestLocationStatus').textContent = 'Location is not available in this browser. Select a point on the map.'; return; }
    button.disabled = true; document.getElementById('requestLocationStatus').textContent = 'Finding your location…';
    navigator.geolocation.getCurrentPosition(function (position) {
      setCoordinates(position.coords.latitude, position.coords.longitude, 'Current location found. GPS accuracy ±' + Math.round(position.coords.accuracy) + ' m.');
      if (map) map.setZoom(17);
      button.disabled = false;
    }, function () {
      document.getElementById('requestLocationStatus').textContent = 'Could not access your location. Allow location access or select a point on the map.';
      button.disabled = false;
    }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
  });
  function showSuccess(data, payload) {
    submittedRequest = { data: data, payload: payload };
    form.hidden = true; document.querySelector('.request-stepper').hidden = true; document.querySelector('.modal-header').hidden = true;
    success.hidden = false;
    var ref = data.refId || data.id || data._id || ('CRQ-' + new Date().getFullYear() + '-' + Math.random().toString(16).slice(2, 10).toUpperCase());
    document.getElementById('requestRef').textContent = ref;
    document.getElementById('qrReference').textContent = ref;
    document.getElementById('assignedDriver').textContent = data.assignedDriver && (data.assignedDriver.displayName || data.assignedDriver.username) || 'Not assigned yet';
    document.getElementById('assignedTruck').textContent = data.binCode || 'Not assigned yet';
    document.getElementById('trackRequest').disabled = false;
    document.getElementById('successLocation').textContent = payload.location + ' · ' + Number(payload.latitude).toFixed(5) + ', ' + Number(payload.longitude).toFixed(5);
    document.getElementById('successContact').textContent = payload.fullName;
    document.getElementById('successPhone').textContent = payload.phone;
    document.getElementById('successDistrict').textContent = value(fields.district).replace(/\s*\([^)]*\)/, '');
    document.getElementById('successLandmark').textContent = value(fields.landmark);
    document.getElementById('successCategory').textContent = selected('wasteCategory');
    document.getElementById('successVolume').textContent = selected('loadVolume').replace(/\s*\([^)]*\)/, '');
    document.getElementById('requestError').hidden = true;
    var qr = document.getElementById('requestQr'); qr.textContent = '';
    if (window.QRCode) new QRCode(qr, { text: ref + ' | ' + payload.location, width: 104, height: 104, colorDark: '#171342', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });
    modal.scrollTop = 0;
  }
  form.addEventListener('submit', function (event) {
    event.preventDefault();
    if (step !== 3 || !validateContact() || !validateLocation()) return;
    var description = ['Category: ' + selected('wasteCategory'), 'Estimated volume: ' + selected('loadVolume')].join('\n');
    var payload = {
      fullName: value(fields.name),
      phone: '+251 ' + value(fields.phone),
      location: value(fields.district) + ' — ' + value(fields.landmark),
      latitude: Number(fields.latitude.value), longitude: Number(fields.longitude.value), description: description
    };
    var submit = document.getElementById('requestSubmit');
    var error = document.getElementById('requestError');
    submit.disabled = true; error.hidden = true;
    submit.querySelector('.btn-text').hidden = true; submit.querySelector('.btn-loading').hidden = false;
    fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      .then(function (response) { return response.json().catch(function () { return {}; }).then(function (body) { if (!response.ok) throw new Error(body.message || 'The request could not be submitted.'); return body; }); })
      .then(function (body) { if (body.success === false) throw new Error(body.message || 'The request could not be submitted.'); showSuccess(body.data || {}, payload); })
      .catch(function (err) { error.textContent = err.message || 'Could not connect to the dispatch service. Please try again.'; error.hidden = false; })
      .finally(function () { submit.disabled = false; submit.querySelector('.btn-text').hidden = false; submit.querySelector('.btn-loading').hidden = true; });
  });
  document.getElementById('downloadReceipt').addEventListener('click', function () { window.print(); });
  document.getElementById('copyRequestRef').addEventListener('click', function () {
    var ref = document.getElementById('requestRef').textContent;
    if (!navigator.clipboard) { window.prompt('Copy your ticket reference:', ref); return; }
    navigator.clipboard.writeText(ref).then(function () { window.showToast('Ticket reference copied.', 'success'); }).catch(function () { window.prompt('Copy your ticket reference:', ref); });
  });
  document.getElementById('trackRequest').addEventListener('click', function () {
    if (submittedRequest) window.open('https://www.openstreetmap.org/?mlat=' + encodeURIComponent(submittedRequest.payload.latitude) + '&mlon=' + encodeURIComponent(submittedRequest.payload.longitude) + '#map=16/' + encodeURIComponent(submittedRequest.payload.latitude) + '/' + encodeURIComponent(submittedRequest.payload.longitude), '_blank', 'noopener');
  });
  document.getElementById('newRequestBtn').addEventListener('click', function () {
    form.reset(); form.hidden = false; success.hidden = true;
    document.querySelector('.request-stepper').hidden = false; document.querySelector('.modal-header').hidden = false;
    document.getElementById('requestQr').textContent = '';
    document.getElementById('trackRequest').disabled = true;
    form.querySelectorAll('.field-error').forEach(function (el) { el.textContent = ''; });
    form.querySelectorAll('.category-card').forEach(function (el) { el.classList.toggle('is-selected', el.querySelector('input').checked); });
    form.querySelectorAll('.volume-option').forEach(function (el) { el.classList.toggle('is-selected', el.querySelector('input').checked); });
    if (marker) { map.removeLayer(marker); marker = null; }
    displayStep(1); fields.name.focus();
  });
  displayStep(1);
  var historyForm = document.getElementById('requestHistoryForm');
  var historyResults = document.getElementById('requestHistoryResults');
  function escapeHtml(text) {
    return String(text == null ? '' : text).replace(/[&<>"']/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
    });
  }
  function statusLabel(status) {
    return { pending: 'Waiting for review', accepted: 'Approved, awaiting driver', rejected: 'Request declined', assigned: 'Driver assigned', 'in-progress': 'Collection in progress', completed: 'Completed' }[status] || 'Status update';
  }
  historyForm.addEventListener('submit', function (event) {
    event.preventDefault();
    var refId = historyForm.elements.refId.value.trim().toUpperCase();
    var phone = historyForm.elements.phone.value.trim();
    var button = historyForm.querySelector('button[type="submit"]');
    button.disabled = true;
    historyResults.innerHTML = '<p class="history-message">Looking up your request…</p>';
    fetch(API + '/lookup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refId: refId, phone: phone }) })
      .then(function (response) { return response.json().catch(function () { return {}; }).then(function (body) { if (!response.ok) throw new Error(body.message || 'Could not find that request.'); return body; }); })
      .then(function (body) {
        var requests = Array.isArray(body.data) ? body.data : [];
        if (!requests.length) throw new Error('No matching requests were found. Check the reference and phone number.');
        historyResults.innerHTML = '<h3>Your recent requests</h3>' + requests.map(function (request) {
          var date = request.createdAt ? new Date(request.createdAt).toLocaleDateString() : 'Date unavailable';
          var details = escapeHtml(request.description || '').replace(/\n/g, '<br>');
          return '<article class="history-request"><div class="history-request-top"><strong>' + escapeHtml(request.refId) + '</strong><span class="history-status status-' + escapeHtml(request.status) + '">' + escapeHtml(statusLabel(request.status)) + '</span></div><p>' + escapeHtml(request.location) + '</p>' + (details ? '<p class="history-request-details">' + details + '</p>' : '') + '<small>Submitted ' + escapeHtml(date) + '</small></article>';
        }).join('');
      })
      .catch(function (error) { historyResults.innerHTML = '<p class="history-message is-error">' + escapeHtml(error.message || 'Could not retrieve request history. Please try again.') + '</p>'; })
      .finally(function () { button.disabled = false; });
  });
})();
