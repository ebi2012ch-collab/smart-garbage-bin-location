const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

function unavailable(res) {
  return res.status(503).json({
    success: false,
    message: 'CAPTCHA verification is temporarily unavailable. Please try again shortly.',
  });
}

async function verifyTurnstile(req, res, next) {
  const token = req.get('cf-turnstile-response');
  if (typeof token !== 'string' || !token.trim()) {
    return res.status(400).json({
      success: false,
      message: 'Please complete the CAPTCHA verification before submitting.',
    });
  }

  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return unavailable(res);

  try {
    const body = new URLSearchParams({ secret, response: token.trim() });
    const response = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return unavailable(res);

    const result = await response.json();
    if (result.success !== true) {
      const errorCodes = Array.isArray(result['error-codes']) ? result['error-codes'] : [];
      if (errorCodes.some(code => ['missing-input-secret', 'invalid-input-secret', 'internal-error'].includes(code))) {
        return unavailable(res);
      }
      return res.status(400).json({
        success: false,
        message: 'CAPTCHA verification failed or expired. Please complete the challenge again.',
      });
    }

    const expectedHostname = process.env.TURNSTILE_EXPECTED_HOSTNAME;
    if (expectedHostname && String(result.hostname || '').toLowerCase() !== expectedHostname.trim().toLowerCase()) {
      return res.status(400).json({
        success: false,
        message: 'CAPTCHA verification failed or expired. Please complete the challenge again.',
      });
    }

    return next();
  } catch (_error) {
    return unavailable(res);
  }
}

module.exports = verifyTurnstile;
