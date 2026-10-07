/* ============================================================
   SMART GARBAGE BIN LOCATOR — MAIN SCRIPT
   All pages: header, nav, animations, counters, form, upload
   ============================================================ */

/* ── 1. STICKY HEADER ───────────────────────────────────── */
(function () {
  var header = document.getElementById('header');
  if (!header) return;
  function updateHeader() {
    if (window.scrollY > 40) header.classList.add('scrolled');
    else header.classList.remove('scrolled');
  }
  updateHeader();
  window.addEventListener('scroll', updateHeader, { passive: true });
})();

/* ── 2. MOBILE HAMBURGER ─────────────────────────────────── */
(function () {
  var btn = document.getElementById('hamburger');
  var nav = document.getElementById('nav');
  if (!btn || !nav) return;

  function closeMenu() {
    btn.classList.remove('open');
    nav.classList.remove('open');
    document.body.classList.remove('menu-open');
  }

  function openMenu() {
    btn.classList.add('open');
    nav.classList.add('open');
    document.body.classList.add('menu-open');
  }

  btn.addEventListener('click', function (e) {
    e.stopPropagation();
    if (nav.classList.contains('open')) {
      closeMenu();
    } else {
      openMenu();
    }
  });

  document.addEventListener('click', function (e) {
    if (!btn.contains(e.target) && !nav.contains(e.target)) {
      closeMenu();
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeMenu();
  });

  nav.querySelectorAll('.nav-link').forEach(function (link) {
    link.addEventListener('click', function () {
      closeMenu();
    });
  });
})();

/* ── 3. AOS — ANIMATE ON SCROLL ──────────────────────────── */
(function () {
  var els = document.querySelectorAll('[data-aos]');
  if (!els.length) return;

  var observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        var el    = entry.target;
        var delay = parseInt(el.getAttribute('data-aos-delay') || '0', 10);
        setTimeout(function () { el.classList.add('aos-animate'); }, delay);
        observer.unobserve(el);
      }
    });
  }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });

  els.forEach(function (el) { observer.observe(el); });
})();

/* ── 4. COUNTER ANIMATION ────────────────────────────────── */
(function () {
  var counters = document.querySelectorAll('[data-target]');
  if (!counters.length) return;

  function animateCounter(el) {
    var target   = parseInt(el.getAttribute('data-target'), 10);
    var duration = 1800;
    var stepTime = 16;
    var steps    = duration / stepTime;
    var increment = target / steps;
    var current  = 0;

    var timer = setInterval(function () {
      current += increment;
      if (current >= target) {
        el.textContent = target.toLocaleString();
        clearInterval(timer);
      } else {
        el.textContent = Math.floor(current).toLocaleString();
      }
    }, stepTime);
  }

  var observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        animateCounter(entry.target);
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.5 });

  counters.forEach(function (c) { observer.observe(c); });
})();

/* ── 5. HERO PARTICLES (index page only) ────────────────── */
(function () {
  var container = document.getElementById('particles');
  if (!container) return;

  var colors = ['#0057b8', '#00c896', '#7ec8e3', '#003f8a', '#e8f1ff'];

  for (var i = 0; i < 20; i++) {
    var p    = document.createElement('div');
    var size = Math.random() * 55 + 10;
    p.className = 'particle';
    p.style.cssText = [
      'width:'  + size + 'px',
      'height:' + size + 'px',
      'left:'   + (Math.random() * 100) + '%',
      'bottom:-' + size + 'px',
      'background:' + colors[Math.floor(Math.random() * colors.length)],
      'animation-duration:'  + (Math.random() * 14 + 10) + 's',
      'animation-delay:'     + (Math.random() * 8)  + 's'
    ].join(';');
    container.appendChild(p);
  }
})();

/* ── 6. LANGUAGE TOGGLE (index page) ────────────────────── */
(function () {
  var btn = document.getElementById('langBtn');
  if (!btn) return;
  var isOromoo = false;

  btn.addEventListener('click', function () {
    isOromoo = !isOromoo;

    document.querySelectorAll('.en').forEach(function (el) {
      el.style.display = isOromoo ? 'none' : '';
    });
    document.querySelectorAll('.or').forEach(function (el) {
      el.style.display = isOromoo ? '' : 'none';
    });

    btn.innerHTML = isOromoo
      ? '<i class="fas fa-globe"></i> Afaan Oromoo | EN'
      : '<i class="fas fa-globe"></i> EN | Afaan Oromoo';
  });
})();

/* ── 7. REPORT FORM (report page only) ──────────────────── */
(function () {
  var form       = document.getElementById('reportForm');
  var successMsg = document.getElementById('successMsg');
  var newBtn     = document.getElementById('newReportBtn');
  if (!form) return;

  /* Character counter */
  var descEl    = document.getElementById('description');
  var charCount = document.getElementById('charCount');
  if (descEl && charCount) {
    descEl.addEventListener('input', function () {
      var len = descEl.value.length;
      if (len > 500) { descEl.value = descEl.value.slice(0, 500); len = 500; }
      charCount.textContent = len;
      charCount.style.color = len > 480 ? '#e74c3c' : '#b0bec5';
    });
  }

  /* Photo upload */
  var uploadArea    = document.getElementById('uploadArea');
  var photoInput    = document.getElementById('photoInput');
  var uploadBtn     = document.getElementById('uploadBtn');
  var uploadPreview = document.getElementById('uploadPreview');
  var previewImg    = document.getElementById('previewImg');
  var removePhoto   = document.getElementById('removePhoto');

  function showPreview(file) {
    if (!file || !file.type.startsWith('image/')) return;
    if (file.size > 5 * 1024 * 1024) { alert('File too large — max 5 MB.'); return; }
    var reader = new FileReader();
    reader.onload = function (e) {
      previewImg.src = e.target.result;
      uploadPreview.style.display = 'inline-block';
    };
    reader.readAsDataURL(file);
  }

  if (uploadBtn)  uploadBtn.addEventListener('click',  function () { photoInput.click(); });
  if (uploadArea) uploadArea.addEventListener('click', function (e) {
    if (e.target !== uploadBtn) photoInput.click();
  });
  if (photoInput) photoInput.addEventListener('change', function () { showPreview(photoInput.files[0]); });
  if (removePhoto) removePhoto.addEventListener('click', function (e) {
    e.stopPropagation();
    photoInput.value = '';
    uploadPreview.style.display = 'none';
    previewImg.src = '';
  });

  /* Drag & drop */
  if (uploadArea) {
    uploadArea.addEventListener('dragover', function (e) {
      e.preventDefault();
      uploadArea.style.borderColor = '#0057b8';
      uploadArea.style.background  = '#e8f1ff';
    });
    uploadArea.addEventListener('dragleave', function () {
      uploadArea.style.borderColor = '';
      uploadArea.style.background  = '';
    });
    uploadArea.addEventListener('drop', function (e) {
      e.preventDefault();
      uploadArea.style.borderColor = '';
      uploadArea.style.background  = '';
      var file = e.dataTransfer.files[0];
      if (file) {
        try {
          var dt = new DataTransfer();
          dt.items.add(file);
          photoInput.files = dt.files;
        } catch (err) {}
        showPreview(file);
      }
    });
  }

  /* Validation */
  function setErr(id, msg) {
    var el = document.getElementById(id);
    if (el) el.textContent = msg;
  }
  function clearErrors() {
    ['nameErr','phoneErr','locErr','typeErr','descErr'].forEach(function (id) { setErr(id, ''); });
  }
  function validate() {
    clearErrors();
    var ok = true;
    var name  = document.getElementById('fullName');
    var phone = document.getElementById('phone');
    var loc   = document.getElementById('location');
    var type  = document.getElementById('problemType');
    var desc  = document.getElementById('description');

    if (!name || !name.value.trim())  { setErr('nameErr', 'Full name is required.'); ok = false; }
    if (!phone || !phone.value.trim()){ setErr('phoneErr', 'Phone number is required.'); ok = false; }
    else if (!/^(0|\+?251)\d{8,9}$/.test(phone.value.trim())) {
      setErr('phoneErr', 'Enter a valid Ethiopian phone number (e.g. 09XXXXXXXX).'); ok = false;
    }
    if (!loc  || !loc.value.trim())  { setErr('locErr', 'Location is required.'); ok = false; }
    if (!type || !type.value)        { setErr('typeErr', 'Please select a problem type.'); ok = false; }
    if (!desc || !desc.value.trim()) { setErr('descErr', 'Please describe the problem.'); ok = false; }
    else if (desc.value.trim().length < 10) { setErr('descErr', 'Description must be at least 10 characters.'); ok = false; }

    return ok;
  }

  /* Submit */
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (!validate()) return;

    var submitBtn  = document.getElementById('submitBtn');
    var btnText    = submitBtn && submitBtn.querySelector('.btn-text');
    var btnLoading = submitBtn && submitBtn.querySelector('.btn-loading');
    if (btnText)    btnText.style.display    = 'none';
    if (btnLoading) btnLoading.style.display = 'flex';
    if (submitBtn)  submitBtn.disabled = true;

    /* Simulate API call — replace with real fetch() */
    setTimeout(function () {
      form.style.display = 'none';
      if (successMsg) {
        successMsg.style.display = 'block';
        var refId = document.getElementById('refId');
        if (refId) refId.textContent = 'ADM-2026-' + (Math.floor(Math.random() * 9000) + 1000);
      }
    }, 1600);
  });

  /* Reset form */
  if (newBtn) {
    newBtn.addEventListener('click', function () {
      form.reset();
      if (charCount) charCount.textContent = '0';
      if (uploadPreview) uploadPreview.style.display = 'none';
      if (previewImg)    previewImg.src = '';
      clearErrors();
      if (successMsg) successMsg.style.display = 'none';
      form.style.display = 'block';
      var submitBtn  = document.getElementById('submitBtn');
      var btnText    = submitBtn && submitBtn.querySelector('.btn-text');
      var btnLoading = submitBtn && submitBtn.querySelector('.btn-loading');
      if (btnText)    btnText.style.display    = 'flex';
      if (btnLoading) btnLoading.style.display = 'none';
      if (submitBtn)  submitBtn.disabled = false;
      form.scrollIntoView({ behavior: 'smooth' });
    });
  }
})();

/* ── 8. SMOOTH ANCHOR SCROLL ─────────────────────────────── */
document.querySelectorAll('a[href^="#"]').forEach(function (a) {
  a.addEventListener('click', function (e) {
    var target = document.querySelector(a.getAttribute('href'));
    if (target) { e.preventDefault(); target.scrollIntoView({ behavior: 'smooth' }); }
  });
});

console.log('%c SmartBin Adama City — Ready ', 'background:#0057b8;color:#fff;font-weight:bold;padding:5px 12px;border-radius:4px;');


/* ── 9. COOKIE CONSENT ───────────────────────────────────── */
(function () {
  var banner = document.getElementById('cookieConsent');
  if (!banner) return;

  // Check if user already made a choice
  if (!localStorage.getItem('cookieConsent')) {
    setTimeout(function () {
      banner.style.display = 'block';
    }, 1000);
  }

  document.getElementById('acceptCookies') && document.getElementById('acceptCookies').addEventListener('click', function () {
    localStorage.setItem('cookieConsent', 'accepted');
    banner.style.display = 'none';
    showToast && showToast('Cookie preferences saved.', 'success');
  });

  document.getElementById('declineCookies') && document.getElementById('declineCookies').addEventListener('click', function () {
    localStorage.setItem('cookieConsent', 'declined');
    banner.style.display = 'none';
    showToast && showToast('Only essential cookies will be used.', 'info');
  });
})();

/* ── 10. TOAST NOTIFICATION SYSTEM ──────────────────────── */
window.showToast = function (message, type) {
  type = type || 'info';
  var container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  var toast = document.createElement('div');
  toast.className = 'toast ' + type;

  var icons = {
    success: 'fa-check-circle',
    error: 'fa-exclamation-circle',
    info: 'fa-info-circle'
  };

  toast.innerHTML = '<i class="fas ' + (icons[type] || icons.info) + '"></i><span>' + message + '</span>';
  container.appendChild(toast);

  setTimeout(function () {
    toast.style.animation = 'toastOut .3s ease';
    setTimeout(function () {
      container.removeChild(toast);
    }, 300);
  }, 4000);
};

/* ── 11. PAGE LOADER ────────────────────────────────────── */
window.addEventListener('load', function () {
  var loader = document.querySelector('.page-loader');
  if (loader) {
    loader.classList.add('hidden');
    setTimeout(function () {
      loader.remove();
    }, 300);
  }
});

/* ── 12. OFFICIAL BADGE CLICK ────────────────────────────── */
(function () {
  var badge = document.querySelector('.gov-badge');
  if (badge) {
    badge.addEventListener('click', function () {
      showToast && showToast('This is an official Adama City Administration website.', 'info');
    });
  }
})();

/* ── 13. SERVICE WORKER (PWA) ───────────────────────────── */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/sw.js').then(function (reg) {
      console.log('[SW] Service Worker registered:', reg.scope);
    }).catch(function (err) {
      console.log('[SW] Service Worker registration failed:', err);
    });
  });
}

/* ── 14. EXTERNAL LINK WARNING ──────────────────────────── */
document.addEventListener('click', function (e) {
  var link = e.target.closest('a[href]');
  if (link && link.hostname !== window.location.hostname && !link.hasAttribute('data-external-confirmed')) {
    e.preventDefault();
    if (confirm('You are leaving the official Adama City website. Continue to ' + link.hostname + '?')) {
      link.setAttribute('data-external-confirmed', 'true');
      link.click();
    }
  }
});

/* ── 15. ACCESSIBILITY: SKIP TO CONTENT ────────────────── */
(function () {
  var skipLink = document.createElement('a');
  skipLink.href = '#main-content';
  skipLink.className = 'skip-link';
  skipLink.textContent = 'Skip to main content';
  skipLink.style.cssText = 'position:absolute;top:-40px;left:10px;background:#0057b8;color:white;padding:8px;z-index:100;text-decoration:none;border-radius:4px;';
  skipLink.addEventListener('focus', function () {
    this.style.top = '10px';
  });
  skipLink.addEventListener('blur', function () {
    this.style.top = '-40px';
  });
  document.body.insertBefore(skipLink, document.body.firstChild);

  var main = document.querySelector('main, .hero, section');
  if (main && !main.id) {
    main.id = 'main-content';
  }
})();

console.log('%c SmartBin Adama City — Official Government Portal ', 'background:#0057b8;color:#fff;font-weight:bold;padding:8px 16px;border-radius:4px;');
console.log('%c ⚠️ Security Warning: Do not paste code here unless you understand what it does. ', 'background:#e74c3c;color:#fff;padding:6px 12px;border-radius:4px;font-size:14px;');


/* ── 11. BENEFITS VOICE NARRATION ────────────────────────── */
var isSpeaking = false;

window.speakBenefits = function () {
  var btn      = document.getElementById('voiceBtn');
  var icon     = document.getElementById('voiceIcon');
  var synth    = window.speechSynthesis;

  if (!synth) {
    alert('Your browser does not support voice. Please use Chrome or Edge.');
    return;
  }

  // If already speaking — stop
  if (isSpeaking) {
    synth.cancel();
    isSpeaking = false;
    btn.classList.remove('speaking');
    icon.className = 'fas fa-volume-up';
    return;
  }

  var text =
    'Welcome to SmartBin Adama City. ' +
    'If you use this website, you will gain the following benefits. ' +

    'First: Request waste collection from your location. ' +
    'The sanitation team reviews your request before assigning it for collection. ' +

    'Second: Report problems directly to the city. ' +
    'If you see an overflowing bin or illegal dumping, ' +
    'report it and our sanitation team responds within 24 hours. ' +

    'Third: Live in a cleaner city. ' +
    'When every citizen uses SmartBin, ' +
    'Adama City becomes cleaner and more pleasant for everyone. ' +

    'Fourth: Protect the environment. ' +
    'Proper waste disposal reduces pollution and protects green spaces. ' +
    'Your small action creates a big impact. ' +

    'Fifth: Protect public health. ' +
    'Overflowing bins spread disease. ' +
    'SmartBin ensures bins are emptied on time, ' +
    'keeping your neighbourhood safe and healthy. ' +

    'Sixth: Build a proud community. ' +
    'A clean city is a proud city. ' +
    'Using SmartBin shows you care about Adama ' +
    'and inspires others to do the same. ' +

    'Join thousands of citizens already using SmartBin ' +
    'to make Adama City a better place for everyone. ' +
    'Thank you!';

  var utterance = new SpeechSynthesisUtterance(text);
  utterance.rate   = 0.92;
  utterance.pitch  = 1.0;
  utterance.volume = 1.0;
  utterance.lang   = 'en-US';

  // Pick a good voice if available
  var voices = synth.getVoices();
  var preferred = voices.find(function (v) {
    return v.name.includes('Google') && v.lang === 'en-US';
  }) || voices.find(function (v) {
    return v.lang === 'en-US';
  });
  if (preferred) utterance.voice = preferred;

  utterance.onstart = function () {
    isSpeaking = true;
    btn.classList.add('speaking');
    icon.className = 'fas fa-stop';
  };

  utterance.onend = utterance.onerror = function () {
    isSpeaking = false;
    btn.classList.remove('speaking');
    icon.className = 'fas fa-volume-up';
  };

  synth.speak(utterance);
};

// Scroll-triggered entrance animation for benefit cards
(function () {
  var cards = document.querySelectorAll('.benefit-card');
  if (!cards.length) return;

  var observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry, i) {
      if (entry.isIntersecting) {
        setTimeout(function () {
          entry.target.style.opacity    = '1';
          entry.target.style.transform  = 'translateY(0)';
        }, i * 80);
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1 });

  cards.forEach(function (card) {
    card.style.opacity   = '0';
    card.style.transform = 'translateY(40px)';
    card.style.transition = 'opacity .6s ease, transform .6s ease';
    observer.observe(card);
  });
})();


/* ── 12. DARK MODE — Fixed & Working ────────────────────── */
(function () {
  var toggle = document.getElementById('darkToggle');
  if (!toggle) return;

  // Apply saved preference on load
  var saved = localStorage.getItem('darkMode');
  if (saved === 'on') {
    document.body.classList.add('dark-mode');
    toggle.innerHTML = '<i class="fas fa-sun"></i>';
    toggle.title = 'Switch to Light Mode';
  } else {
    toggle.innerHTML = '<i class="fas fa-moon"></i>';
    toggle.title = 'Switch to Dark Mode';
  }

  toggle.addEventListener('click', function () {
    var isDark = document.body.classList.toggle('dark-mode');
    if (isDark) {
      localStorage.setItem('darkMode', 'on');
      toggle.innerHTML = '<i class="fas fa-sun"></i>';
      toggle.title = 'Switch to Light Mode';
      showToast && showToast('Dark mode on 🌙', 'info');
    } else {
      localStorage.setItem('darkMode', 'off');
      toggle.innerHTML = '<i class="fas fa-moon"></i>';
      toggle.title = 'Switch to Dark Mode';
      showToast && showToast('Light mode on ☀️', 'info');
    }
  });
})();
