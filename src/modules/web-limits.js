({
  id: 'web-limits',
  name: 'Remove web limits (copy & select)',
  version: '1.4.0',
  api: 1,
  source: 'Remove web limits 网页限制解除 1.3 (Cat73, LGPL-3.0)',
  description: 'Lets you select and copy text, and use the long-press menu, on sites that block it.',
  runAt: 'start',
  frames: false,
  match: (u) => /^https?:$/.test(u.protocol),
  defaults: {
    dropHandlers: true,
    allowDrag: false,
    aggressive: false,
    excludeSites: 'youtube.com, wikipedia.org, mail.qq.com, translate.google.*, docs.google.com, notion.so, office.com, figma.com, github.com'
  },
  options: [
    { key: 'dropHandlers', type: 'bool', label: 'Ignore sites\' copy/select/long-press blockers', help: 'Off: only stop them from cancelling the action' },
    { key: 'allowDrag', type: 'bool', label: 'Also unblock dragging text', help: 'Can break drag-and-drop on some sites' },
    { key: 'aggressive', type: 'bool', label: 'Aggressive: also unblock mouse-down', help: 'For sites that block selection on press' },
    { key: 'excludeSites', type: 'text', label: 'Leave these sites alone', help: 'Comma-separated; * matches any ending, e.g. translate.google.*' }
  ],

  // Runs in the page world: the original hooked addEventListener and
  // preventDefault from Safari's isolated world, where the page never sees it.
  pageUnlock: function (cfg) {
    if (window.__iossUnlock) return;
    window.__iossUnlock = true;
    const blocked = ['contextmenu', 'select', 'selectstart', 'copy', 'cut']
      .concat(cfg.allowDrag ? ['dragstart'] : [])
      .concat(cfg.aggressive ? ['mousedown', 'mouseup'] : []);
    const isBlocked = (t) => blocked.indexOf(t) !== -1;

    // Fix: the original also ignored preventDefault() for keydown/keyup and
    // mouse events on every site (Enter-to-send in chats inserted newlines
    // too, custom drag/focus broke) and dropped every dragstart listener.
    // Only the events that actually block copying are touched now.
    const pd = Event.prototype.preventDefault;
    Event.prototype.preventDefault = function () { if (!isBlocked(this.type)) return pd.apply(this, arguments); };
    try {
      const rv = Object.getOwnPropertyDescriptor(Event.prototype, 'returnValue');
      if (rv && rv.set) {
        Object.defineProperty(Event.prototype, 'returnValue', {
          configurable: true, enumerable: rv.enumerable, get: rv.get,
          set(v) { if (v === false && isBlocked(this.type)) return; rv.set.call(this, v); }
        });
      }
    } catch (_) { /* ignore */ }

    // Fix: the original wrapped listeners and called them without `this`,
    // ignored listener objects and passive/once options, and treated an
    // options object as "capture". Listeners for blocking events are now
    // simply not registered; everything else goes through untouched.
    if (cfg.dropHandlers) {
      const add = EventTarget.prototype.addEventListener;
      const drop = ['contextmenu', 'select', 'selectstart', 'copy', 'cut'].concat(cfg.allowDrag ? ['dragstart'] : []);
      EventTarget.prototype.addEventListener = function (type, listener, options) {
        if (drop.indexOf(type) !== -1 && (this === window || this === document || this === document.documentElement || this === document.body || (this && this.nodeType === 1 && !this.isContentEditable && !/^(INPUT|TEXTAREA)$/.test(this.tagName)))) return undefined;
        return add.call(this, type, listener, options);
      };
    }

    // DOM0 handlers such as oncopy="return false" cancel events without
    // calling preventDefault(), so they are cleared. Only the usual hosts and
    // elements with such attributes are visited, not every element.
    const props = blocked.map((n) => 'on' + n);
    const clear = (el) => { for (const p of props) { try { if (el && el[p]) el[p] = null; } catch (_) { /* ignore */ } } };
    const sweep = () => {
      clear(window);
      clear(document);
      clear(document.documentElement);
      clear(document.body);
      try { document.querySelectorAll(props.map((p) => `[${p}]`).join(',')).forEach(clear); } catch (_) { /* ignore */ }
    };
    sweep();
    document.addEventListener('DOMContentLoaded', sweep, true);
    window.addEventListener('load', sweep, true);
    setTimeout(sweep, 2500);
    setInterval(() => { if (!document.hidden) sweep(); }, 30000);
  },

  run(api, cfg) {
    const target = (location.host + location.pathname).toLowerCase();
    const excluded = String(cfg.excludeSites || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean).some((pat) => {
      const re = new RegExp('(^|\\.)' + pat.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*') + '(/|$)');
      return re.test(target);
    });
    if (excluded) return;

    // iPhone: long-press callouts are blocked with -webkit-touch-callout,
    // which the original never reset. Form fields keep their own behaviour.
    api.addStyle(`
      html, *:not(input):not(textarea):not([contenteditable]) { -webkit-user-select: text !important; user-select: text !important; -webkit-touch-callout: default !important; }
    `, 'ioss-web-limits');

    const snapshot = JSON.parse(JSON.stringify(cfg));
    if (!api.pageRun(this.pageUnlock, snapshot)) {
      // Strict CSP: retry once the page exposes a nonce. preventDefault and
      // DOM0 clearing still apply to everything registered before that.
      api.onReady(() => api.pageRun(this.pageUnlock, snapshot) || api.log('page access blocked; CSS unlock only'));
    }
  }
})
