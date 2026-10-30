({
  id: 'google-consent',
  name: 'Reject cookie banners (Google & YouTube)',
  version: '2.1.0',
  api: 1,
  source: 'Google: Block Cookie Banner 2.0',
  description: 'Pre-sets the "reject all" consent cookie (SOCS=CAI) so Google and YouTube never show their consent dialog, hides the dialog while it would render, and taps "Reject all" as a fallback.',
  runAt: 'start',
  frames: false,
  match: (u) => /(^|\.)google\.[a-z.]+$/.test(u.hostname) || /(^|\.)youtube\.com$/.test(u.hostname),
  defaults: { setCookie: true, hideDialog: true, autoReject: true },
  options: [
    { key: 'setCookie', type: 'bool', label: 'Pre-set "rejected" consent cookie' },
    { key: 'hideDialog', type: 'bool', label: 'Hide the consent dialog' },
    { key: 'autoReject', type: 'bool', label: 'Tap "Reject all" automatically' }
  ],
  run(api, cfg) {
    const host = location.hostname;
    const isYouTube = /(^|\.)youtube\.com$/.test(host);
    if (!isYouTube && !api.isGoogleHost(host)) return;
    const onConsentPage = host === 'consent.google.com' || host === 'consent.youtube.com';

    // 1. SOCS=CAI is the minimal "rejected / essential only" consent value.
    function setConsentCookie() {
      if (/(?:^|;\s*)SOCS=/.test(document.cookie)) return false;
      const m = isYouTube ? ['youtube.com', 'youtube.com'] : host.match(/(google\.[a-z.]+)$/);
      if (!m) return false;
      const expires = new Date(Date.now() + 400 * 864e5).toUTCString();
      document.cookie = `SOCS=CAI; domain=.${m[1]}; path=/; expires=${expires}; Secure; SameSite=Lax`;
      return true;
    }
    const cookieWasMissing = cfg.setCookie ? setConsentCookie() : true;

    // 2. Hide the dialog. Fix: the original forced `overflow: auto` on every
    // Google page permanently, which broke scrolling-locked apps like Maps.
    // Now the scroll unlock only applies while a consent dialog exists.
    if (cfg.hideDialog && !onConsentPage) {
      api.addStyle(`
        [role="dialog"]:has(#W0wltc), [aria-modal="true"]:has(#W0wltc), div:has(> [role="dialog"] #W0wltc),
        ytd-consent-bump-v2-lightbox, ytm-consent-bump-v2-renderer, tp-yt-iron-overlay-backdrop:has(+ ytd-consent-bump-v2-lightbox)
          { display: none !important; }
        html:has(#W0wltc), html:has(#W0wltc) body, html:has(ytm-consent-bump-v2-renderer) body, html:has(ytd-consent-bump-v2-lightbox) body
          { overflow: auto !important; position: static !important; }
      `, 'ioss-consent-css');
    }

    if (!cfg.autoReject || !(cookieWasMissing || onConsentPage)) return;

    // 3. Fallback: tap "Reject all".
    const REJECT_TEXTS = [
      'reject all', 'reject the use of cookies and other data for the purposes described', 'alle ablehnen', 'tout refuser',
      'rifiuta tutto', 'rechazar todo', 'alles afwijzen', 'odrzuć wszystko', 'ปฏิเสธทั้งหมด', 'rejeitar tudo', 'recusar tudo',
      'avvisa alla', 'afvis alle', 'avvis alle', 'hylkää kaikki', 'odmítnout vše', 'odmietnuť všetko', 'tümünü reddet',
      'отклонить все', 'відхилити все', 'απόρριψη όλων', 'összes elutasítása', 'respinge tot', 'отхвърляне на всички',
      'zavrni vse', 'odbij sve', 'atmesti viską', 'noraidīt visu', 'keeldu kõigist', 'すべて拒否', '모두 거부', '全部拒绝', '全部拒絕'
    ];
    const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
    let done = false;

    function findRejectButton() {
      const byId = document.getElementById('W0wltc');
      if (byId) return byId;
      const eom = document.querySelector('form input[name="set_eom"][value="true"]');
      if (eom && eom.form) {
        const submit = eom.form.querySelector('button, input[type="submit"]');
        if (submit) return submit;
      }
      const scope = document.querySelector('ytd-consent-bump-v2-lightbox, ytm-consent-bump-v2-renderer, [role="dialog"]') || document;
      for (const b of scope.querySelectorAll('button, [role="button"], input[type="submit"]')) {
        if (REJECT_TEXTS.includes(norm(b.innerText || b.value)) || REJECT_TEXTS.includes(norm(b.getAttribute('aria-label')))) return b;
      }
      return null;
    }

    api.onReady(() => {
      const tryReject = () => {
        if (done) return true;
        const btn = findRejectButton();
        if (!btn) return false;
        done = true;
        btn.click();
        api.log('Rejected cookies');
        return true;
      };
      if (tryReject()) return;
      const stop = api.observe(document.documentElement, { childList: true, subtree: true }, () => { if (tryReject()) stop(); });
      setTimeout(stop, 15000);
    });
  }
})
