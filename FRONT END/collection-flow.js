(function () {
  'use strict';

  // ---- Config & strings (all user-facing text here, ready for Amharic / Afaan Oromo) ----
  var CONFIG = { API: 'http://localhost:3000/api/collection-requests' }; // TODO: use a relative path in production
  var LAST_REF_KEY = 'cf:lastRef';
  var S = {
    nameErr: 'Enter your full name.',
    phoneErr: 'Enter a valid mobile number, e.g. 9 1234 5678.',
    districtErr: 'Select your kebele.',
    pinErr: 'Tap the map to drop a pin, or use your location.',
    noPin: 'No pin yet',
    pinSet: 'Pin placed',
    locating: 'Finding your location…',
    locUnsupported: 'Location is not available in this browser. Tap the map instead.',
    locDenied: 'Could not get your location. Allow access, or tap the map instead.',
    submitFail: 'Could not submit your request. Please try again.',
    lookingUp: 'Looking up your request…',
    notFound: 'No matching requests found. Check the ticket number and phone number.',
    lookupFail: 'Could not retrieve your request. Please try again.',
    copied: 'Ticket number copied.',
    copyPrompt: 'Copy your ticket number:',
    recent: 'Your recent requests',
    submitted: 'Submitted ',
    declined: 'This request was declined.',
    timeline: ['Received', 'Approved', 'Driver assigned', 'Collected']
  };

  var form = document.getElementById('collectionRequestForm');
  if (!form) return;
  var $ = function (id) { return document.getElementById(id); };
  var steps = [].slice.call(form.querySelectorAll('.cf-step'));
  var indicators = [].slice.call(document.querySelectorAll('[data-step-indicator]'));
  var f = {
    name: $('requestName'), phone: $('requestPhone'), district: $('requestDistrict'),
    landmark: $('requestLandmark'), lat: $('requestLatitude'), lng: $('requestLongitude')
  };
  var step = 1, map, marker, dirty = false, submittedRequest;
  var toast = function (m, t) { if (window.showToast) window.showToast(m, t); };

  // ---- helpers ----
  function val(el) { return el.value.trim(); }
  function selected(name) { var i = form.querySelector('input[name="' + name + '"]:checked'); return i ? i.value : ''; }
  function short(text) { return String(text).replace(/\s*\([^)]*\)/, ''); }
  function esc(t) {
    return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  // Phone: accepts 0911…, +251911…, 251 911…, 911… → 9 national digits starting with 7 or 9.
  function nationalPhone(raw) {
    var d = String(raw).replace(/\D/g, '');
    if (d.indexOf('251') === 0 && d.length > 9) d = d.slice(3);
    d = d.replace(/^0+/, '');
    return /^[79]\d{8}$/.test(d) ? d : '';
  }
  function fmtPhone(d) { return '+251 ' + d.charAt(0) + ' ' + d.slice(1, 5) + ' ' + d.slice(5); }

  // ---- validation (errors are linked with aria-describedby in the HTML) ----
  function setErr(input, errId, msg) {
    $(errId).textContent = msg || '';
    if (input) { if (msg) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid'); }
    return !msg;
  }
  function checkName() { return setErr(f.name, 'requestNameErr', val(f.name).length < 2 ? S.nameErr : ''); }
  function checkPhone() { return setErr(f.phone, 'requestPhoneErr', nationalPhone(f.phone.value) ? '' : S.phoneErr); }
  function checkDistrict() { return setErr(f.district, 'requestDistrictErr', val(f.district) ? '' : S.districtErr); }
  function validPin() {
    var la = Number(f.lat.value), lo = Number(f.lng.value);
    return f.lat.value !== '' && f.lng.value !== '' && isFinite(la) && isFinite(lo) && Math.abs(la) <= 90 && Math.abs(lo) <= 180;
  }
  function checkPin() { $('requestCoordinatesErr').textContent = validPin() ? '' : S.pinErr; return validPin(); }
  function validateStep(n) {
    var first = null;
    if (n === 1) {
      var d = checkDistrict(), p = checkPin();
      first = !p ? $('useRequestCurrentLocation') : (!d ? f.district : null);
    } else if (n === 3) {
      var a = checkName(), b = checkPhone();
      first = !a ? f.name : (!b ? f.phone : null);
    }
    if (first) first.focus();
    return !first;
  }

  // ---- steps ----
  function showStep(n, scroll) {
    step = n;
    steps.forEach(function (s) { s.hidden = Number(s.dataset.step) !== n; });
    indicators.forEach(function (li) {
      var i = Number(li.dataset.stepIndicator);
      li.classList.toggle('is-active', i === n);
      li.classList.toggle('is-done', i < n);
      if (i === n) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
      li.querySelector('.dot').innerHTML = i < n ? '<i class="fas fa-check" aria-hidden="true"></i>' : String(i);
    });
    $('backStep').hidden = n === 1;
    $('nextStep').hidden = n === 3;
    $('requestSubmit').hidden = n !== 3;
    if (n === 3 && window.SmartBinCaptcha) window.SmartBinCaptcha.init('collectionCaptcha', 'collectionCaptchaStatus');
    if (n === 1 && map) setTimeout(function () { map.invalidateSize(); }, 50);
    if (n === 3) updateReview();
    if (scroll) $('stepper').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function next() { if (step < 3 && (step === 2 || validateStep(step))) showStep(step + 1, true); }
  function updateReview() {
    var lm = val(f.landmark);
    $('reviewLocation').textContent = short(val(f.district)) + (lm ? ' · ' + lm : '');
    $('reviewWaste').textContent = selected('wasteCategory') + ' · ' + short(selected('loadVolume'));
  }

  // ---- map ----
  function ensureMap() {
    if (map || !window.L) return;
    map = L.map('requestMap', { scrollWheelZoom: false }).setView([8.54, 39.27], 14);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(map);
    map.on('click', function (e) { setCoordinates(e.latlng.lat, e.latlng.lng); });
    if (validPin()) setCoordinates(Number(f.lat.value), Number(f.lng.value));
  }
  function setCoordinates(lat, lng, extra) {
    f.lat.value = Number(lat).toFixed(6); f.lng.value = Number(lng).toFixed(6);
    $('requestCoordinatesErr').textContent = '';
    $('mapHint').hidden = true;
    var chip = $('requestLocationStatus');
    chip.classList.add('is-set');
    chip.textContent = S.pinSet + ' · ' + Number(lat).toFixed(5) + ', ' + Number(lng).toFixed(5) + (extra ? ' · ' + extra : '');
    if (map) {
      var pt = [Number(lat), Number(lng)];
      if (marker) marker.setLatLng(pt); else marker = L.marker(pt, { draggable: true }).addTo(map);
      marker.off('dragend').on('dragend', function (e) { var p = e.target.getLatLng(); setCoordinates(p.lat, p.lng); });
      map.panTo(pt);
    }
  }
  $('useRequestCurrentLocation').addEventListener('click', function () {
    var btn = this, chip = $('requestLocationStatus');
    if (!navigator.geolocation) { chip.textContent = S.locUnsupported; return; }
    btn.disabled = true; chip.classList.remove('is-set'); chip.textContent = S.locating;
    navigator.geolocation.getCurrentPosition(function (pos) {
      setCoordinates(pos.coords.latitude, pos.coords.longitude, '±' + Math.round(pos.coords.accuracy) + ' m');
      if (map) map.setZoom(17);
      btn.disabled = false;
    }, function () { chip.textContent = S.locDenied; btn.disabled = false; },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
  });
  [f.lat, f.lng].forEach(function (el) {
    el.addEventListener('change', function () { if (validPin()) setCoordinates(Number(f.lat.value), Number(f.lng.value)); });
  });

  // ---- events: navigation, Enter key, blur validation ----
  $('nextStep').addEventListener('click', next);
  $('backStep').addEventListener('click', function () { showStep(Math.max(1, step - 1), true); });
  [].forEach.call(document.querySelectorAll('[data-go-step]'), function (b) {
    b.addEventListener('click', function () { showStep(Number(b.dataset.goStep), true); });
  });
  form.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' || e.target.tagName === 'BUTTON' || e.target.tagName === 'SUMMARY') return;
    e.preventDefault();
    if (step < 3) next(); else form.requestSubmit();
  });
  form.addEventListener('input', function () { dirty = true; });
  f.name.addEventListener('blur', function () { if (f.name.value) checkName(); });
  f.district.addEventListener('change', checkDistrict);
  f.phone.addEventListener('blur', function () {
    var d = nationalPhone(f.phone.value);
    if (d) f.phone.value = d.charAt(0) + ' ' + d.slice(1, 5) + ' ' + d.slice(5);
    if (f.phone.value) checkPhone();
  });
  window.addEventListener('beforeunload', function (e) { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

  // ---- submit ----
  function showSuccess(data, payload) {
    submittedRequest = payload; dirty = false;
    // NOTE: a locally generated ref only appears if the server returns none; it cannot be tracked.
    var ref = data.refId || data.id || data._id || ('CRQ-' + new Date().getFullYear() + '-' + Math.random().toString(16).slice(2, 10).toUpperCase());
    $('requestRef').textContent = ref;
    $('successSummary').textContent = short(val(f.district)) + ' · ' + selected('wasteCategory') + ' · ' + short(selected('loadVolume'));
    try { localStorage.setItem(LAST_REF_KEY, ref); } catch (e) {}
    $('trackRef').value = ref;
    form.hidden = true; $('stepper').hidden = true; $('requestSuccess').hidden = false;
    $('successTitle').focus();
  }
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (step !== 3) return;
    if (!validateStep(1)) { showStep(1); return; }
    if (!validateStep(3)) return;
    var captchaToken = window.SmartBinCaptcha && window.SmartBinCaptcha.getToken();
    var btn = $('requestSubmit'), err = $('requestError');
    if (!captchaToken) {
      if (window.SmartBinCaptcha) window.SmartBinCaptcha.init('collectionCaptcha', 'collectionCaptchaStatus');
      err.textContent = 'Please complete the CAPTCHA verification before submitting.';
      err.hidden = false;
      $('collectionCaptcha').scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    var lm = val(f.landmark);
    var payload = {
      fullName: val(f.name),
      phone: fmtPhone(nationalPhone(f.phone.value)),
      location: val(f.district) + (lm ? ' — ' + lm : ''),
      latitude: Number(f.lat.value), longitude: Number(f.lng.value),
      description: 'Category: ' + selected('wasteCategory') + '\nEstimated volume: ' + selected('loadVolume')
    };
    btn.disabled = true; err.hidden = true;
    btn.querySelector('.btn-text').hidden = true; btn.querySelector('.btn-loading').hidden = false;
    fetch(CONFIG.API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'cf-turnstile-response': captchaToken },
      body: JSON.stringify(payload)
    })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (b) { if (!r.ok) throw new Error(b.message || S.submitFail); return b; }); })
      .then(function (b) { if (b.success === false) throw new Error(b.message || S.submitFail); showSuccess(b.data || {}, payload); })
      .catch(function (x) {
        if (window.SmartBinCaptcha) window.SmartBinCaptcha.reset();
        err.textContent = x.message || S.submitFail; err.hidden = false;
      })
      .finally(function () { btn.disabled = false; btn.querySelector('.btn-text').hidden = false; btn.querySelector('.btn-loading').hidden = true; });
  });

  // ---- success actions ----
  $('downloadReceipt').addEventListener('click', function () { window.print(); });
  $('copyRequestRef').addEventListener('click', function () {
    var ref = $('requestRef').textContent;
    if (!navigator.clipboard) { window.prompt(S.copyPrompt, ref); return; }
    navigator.clipboard.writeText(ref).then(function () { toast(S.copied, 'success'); }).catch(function () { window.prompt(S.copyPrompt, ref); });
  });
  $('trackRequest').addEventListener('click', function () { showTab('requestHistory', true); $('trackPhone').focus(); });
  $('newRequestBtn').addEventListener('click', function () {
    form.reset(); form.hidden = false; $('requestSuccess').hidden = true; $('stepper').hidden = false;
    if (window.SmartBinCaptcha) window.SmartBinCaptcha.reset();
    [].forEach.call(form.querySelectorAll('.field-error'), function (el) { el.textContent = ''; });
    [].forEach.call(form.querySelectorAll('[aria-invalid]'), function (el) { el.removeAttribute('aria-invalid'); });
    if (marker && map) { map.removeLayer(marker); marker = null; }
    $('mapHint').hidden = false;
    var chip = $('requestLocationStatus'); chip.classList.remove('is-set'); chip.textContent = S.noPin;
    dirty = false; showStep(1, true);
  });

  // ---- tabs (supports #requestCollection and #requestHistory deep links) ----
  function showTab(id, scroll) {
    [].forEach.call(document.querySelectorAll('.cf-tab'), function (t) {
      var on = t.dataset.tab === id;
      t.classList.toggle('is-active', on); t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    $('requestCollection').hidden = id !== 'requestCollection';
    $('requestHistory').hidden = id !== 'requestHistory';
    if (id === 'requestCollection' && map) setTimeout(function () { map.invalidateSize(); }, 50);
    if (scroll) document.querySelector('.cf-tabs').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  [].forEach.call(document.querySelectorAll('.cf-tab'), function (t) {
    t.addEventListener('click', function () { showTab(t.dataset.tab, false); });
  });
  [].forEach.call(document.querySelectorAll('a[href="#requestCollection"], a[href="#requestHistory"]'), function (a) {
    a.addEventListener('click', function (e) { e.preventDefault(); showTab(a.getAttribute('href').slice(1), true); });
  });

  // ---- tracking ----
  function statusIndex(s) { return { pending: 0, accepted: 1, assigned: 2, 'in-progress': 2, completed: 3 }[s]; }
  function parseDesc(t) {
    var c = /Category:\s*(.+)/i.exec(t || ''), v = /Estimated volume:\s*(.+)/i.exec(t || '');
    return c && v ? c[1].trim() + ' · ' + short(v[1].trim()) : (t || '');
  }
  function timeline(status) {
    if (status === 'rejected') return '<p class="declined"><i class="fas fa-times-circle"></i> ' + S.declined + '</p>';
    var idx = statusIndex(status); if (idx === undefined) idx = 0;
    return '<ol class="tl">' + S.timeline.map(function (label, i) {
      return '<li class="' + (i < idx || status === 'completed' ? 'done' : (i === idx ? 'current' : '')) + '"' + (i === idx ? ' aria-current="step"' : '') + '><span></span>' + label + '</li>';
    }).join('') + '</ol>';
  }
  var hf = $('requestHistoryForm'), hr = $('requestHistoryResults');
  try { var last = localStorage.getItem(LAST_REF_KEY); if (last) hf.elements.refId.value = last; } catch (e) {}
  hf.addEventListener('submit', function (e) {
    e.preventDefault();
    var refId = hf.elements.refId.value.trim().toUpperCase();
    var d = nationalPhone(hf.elements.phone.value);
    var btn = hf.querySelector('button[type="submit"]');
    if (!d) { hr.innerHTML = '<p class="history-message is-error">' + S.phoneErr + '</p>'; return; }
    btn.disabled = true; hr.innerHTML = '<p class="history-message">' + S.lookingUp + '</p>';
    fetch(CONFIG.API + '/lookup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refId: refId, phone: fmtPhone(d) }) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (b) { if (!r.ok) throw new Error(b.message || S.notFound); return b; }); })
      .then(function (b) {
        var list = Array.isArray(b.data) ? b.data : [];
        if (!list.length) throw new Error(S.notFound);
        hr.innerHTML = '<h3>' + S.recent + '</h3>' + list.map(function (r) {
          var date = r.createdAt ? new Date(r.createdAt).toLocaleDateString() : '';
          return '<article class="history-request"><div class="history-top"><strong>' + esc(r.refId) + '</strong>' +
            (date ? '<small>' + S.submitted + esc(date) + '</small>' : '') + '</div>' +
            '<p>' + esc(r.location) + '</p><p class="muted">' + esc(parseDesc(r.description)) + '</p>' + timeline(r.status) + '</article>';
        }).join('');
      })
      .catch(function (x) { hr.innerHTML = '<p class="history-message is-error">' + esc(x.message || S.lookupFail) + '</p>'; })
      .finally(function () { btn.disabled = false; });
  });

  // ---- init ----
  ensureMap();
  showStep(1, false);
  var h = (location.hash || '').slice(1);
  if (h === 'requestHistory') showTab('requestHistory', false);
})();