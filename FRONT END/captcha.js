(function () {
  'use strict';

  var widgetId = null;
  var token = '';
  var statusElement = null;
  var loadPromise = null;
  var rendered = false;

  function setStatus(message) {
    if (statusElement) statusElement.textContent = message || '';
  }

  function render(container) {
    if (!window.turnstile) {
      setStatus('CAPTCHA could not load. Check your connection and try again.');
      return false;
    }
    if (rendered) return true;

    widgetId = window.turnstile.render(container, {
      sitekey: window.SMARTBIN_TURNSTILE_SITE_KEY,
      callback: function (value) {
        token = value;
        setStatus('');
      },
      'expired-callback': function () {
        token = '';
        setStatus('Verification expired. Complete the CAPTCHA again before submitting.');
      },
      'error-callback': function () {
        token = '';
        setStatus('CAPTCHA could not load. Check your connection and try again.');
      },
    });
    rendered = true;
    return true;
  }

  function init(containerId, statusId) {
    var container = document.getElementById(containerId);
    statusElement = document.getElementById(statusId);
    if (!container) return Promise.resolve(false);

    var siteKey = String(window.SMARTBIN_TURNSTILE_SITE_KEY || '').trim();
    if (!siteKey) {
      setStatus('CAPTCHA is not configured. Please contact the service administrator.');
      return Promise.resolve(false);
    }

    if (window.turnstile) return Promise.resolve(render(container));
    if (!loadPromise) {
      loadPromise = new Promise(function (resolve) {
        var script = document.createElement('script');
        script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
        script.async = true;
        script.defer = true;
        script.onload = function () { resolve(render(container)); };
        script.onerror = function () {
          loadPromise = null;
          script.remove();
          setStatus('CAPTCHA could not load. Check your connection and try again.');
          resolve(false);
        };
        document.head.appendChild(script);
      });
    }
    return loadPromise;
  }

  function reset() {
    token = '';
    if (widgetId !== null && window.turnstile) window.turnstile.reset(widgetId);
  }

  window.SmartBinCaptcha = {
    init: init,
    getToken: function () { return token; },
    reset: reset,
    setStatus: setStatus,
  };
})();
