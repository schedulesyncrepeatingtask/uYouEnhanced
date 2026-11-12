({
  id: 'clean-urls',
  name: 'Clean tracking URLs',
  version: '0.8.0',
  api: 1,
  source: 'Clean Tracking URLs 跟踪链接净化 0.7.8 (cilxe)',
  description: 'Removes tracking parameters from links and from the address bar on every site, with extra rules for Bilibili, Baidu, CSDN, Alibaba/Taobao, Douyin/TikTok, Amazon, YouTube, Google, Reddit, LinkedIn, eBay, JD and more.',
  runAt: 'start',
  frames: false,
  match: (u) => /^https?:$/.test(u.protocol) && !/(^|\.)(hdslb\.com|csdnimg\.cn)$/.test(u.hostname),
  defaults: { cleanAddressBar: true, aggressive: false, siteExtras: true, extraParams: '', keepParams: '', excludeSites: '' },
  options: [
    { key: 'cleanAddressBar', type: 'bool', label: 'Also clean the address bar', help: 'Never on sign-in / OAuth pages' },
    { key: 'aggressive', type: 'bool', label: 'Aggressive (original list)', help: 'Also strips ref, from, source, src, redir, … everywhere. Can break logins, GitHub branch links and searches.' },
    { key: 'siteExtras', type: 'bool', label: 'Site extras', help: 'Bilibili/Baidu ads & login pop-ups, Zhihu/Xiaohongshu login modals, …' },
    { key: 'extraParams', type: 'text', label: 'Also remove these parameters', help: 'Space or comma separated' },
    { key: 'keepParams', type: 'text', label: 'Never remove these parameters' },
    { key: 'excludeSites', type: 'text', label: 'Leave these sites alone', help: 'Comma-separated hosts' }
  ],

  run(api, cfg) {
    const host = location.hostname.toLowerCase();
    const words = (s) => String(s || '').split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);
    if (words(cfg.excludeSites).some((h) => host === h.toLowerCase() || host.endsWith('.' + h.toLowerCase()))) return;

    // ---- parameter tables -------------------------------------------------
    // Clearly-tracking parameters, removed everywhere.
    const SAFE = new Set(['utm_id', 'utm_content', 'utm_source', 'utm_medium', 'utm_sources', 'utm_term', 'utm_campaign',
      'utm_referrer', 'utm_keyword', 'spm', 'scm', 'vd_source', 'spm_id_from', 'fbclid', 'gclid', 'dclid', 'gbraid', 'wbraid',
      'msclkid', 'yclid', 'igshid', 'mc_cid', 'mc_eid', '_hsenc', '_hsmi', 'mkt_tok', 'trk', 'trkInfo']);
    const SAFE_RE = /^(utm_|spm_|scm_|share_(medium|plat|source|tag|session_id|from)$|embeds_(referring_euri|euri|referring_origin)$)/;
    // The original's generic list: these are often functional (ref, from,
    // source, src, redir, …), so they are only removed in aggressive mode.
    const AGGRESSIVE = new Set(['mkt', 'src', 'from', 'source', 'alias', 'brand', 'curator_clanid', 'snr', 'redir', 'sprefix', 'ref', 'feature']);
    const AGGRESSIVE_RE = /^(spm|from_|ref_|track|trk|share_|embeds_|refer_)|_from$|scm|referrer/;

    const ALI_RE = /^(utm_|spm_|from_|ref|track|wh_|wx_)/;
    const AMZN_RE = /_ref|^(utm_|ref|pd_rd_|pf_rd_|track|sc_)/i;
    const commonPlus = (list, re) => ({ params: list, re });
    // [host test, rule]. Rules: params (removed on this site, from all links),
    // re (regex of names), keep (never removed), extra (site extras).
    const SITES = [
      [/(^|\.)(bilibili|biligame)\.com$/, { params: ['vd_source', 'hotRank', 'launch_id', 'popular_rank', 'session_id', 'business', 'sort_field',
        'is_room_feed', 'visit_id', 'is_live_full_webview', 'is_live_webview', 'vt', 'theme', 'noReffer', 'timestamp', 'unique_k', 'hasBack',
        'noTitleBar', 'plat_id', 'is_preview', 'buvid', 'up_id', 'is_story_h5', 'hybrid_set_header', 'lottery_id', 'seid', '-Abrowser', 'from',
        'pagefrom', 'schema', 'preUrl', 'jumpLinkType', 'referfrom', 'spm_id', 'p2p_type', 'broadcast_type', 'event_source_type'],
      re: /^(utm_|share_|spm|from_)|(From|_from|source)$/, extra: 'bilibili' }],
      [/(^|\.)baidu\.com$/, { params: ['rsv_idx', 'hisfilter', 'rsf', 'rsv_pq', 'rsv_t', 'qid', 'rsv_dl', 'oq', 'gpc', 'usm', 'tfflag', 'bs', 'rqlang',
        'tn', 'sc_us', 'wfr', 'fenlei', 'platform', 'rqid', 'base_query', 'entry', 'qbl', 'for', 'from', 'topic_pn', 'rsp', 'rs_src', 'f', 'rsv_page',
        'dyTabStr', 'ct', 'lm', 'site', 'sites', 'fr', 'cl', 'bsst', 'lid', 'rsv_spt', 'rsv_bp', 'src', 'sfrom', 'refer', 'zp_fr', 'channel', 'p_from',
        'n_type', 'eqid', '_at_', 'sa', 'pd', 'source', 'tag_key', 'uname', 'uid', 'fromModule', 'lemmaFrom', 'structureId', 'structureClickId',
        'structureItemId', 'xzhid', 'rsv_enter', 'rsv_btype', 'prefixsug', 'client_type', 'task', 'locate', 'is_new_user', 'frwh', 'obj_id',
        'fid', 'fname', '_t', 'topic_name', 'frs', 'share_from', 'tpl', 'tb_mod', 'tb_fr', 'share', 'sfc', 'idfrom', 'client_version', 'st',
        'qq-pf-to', 'unique', 'is_video', '_wkts_', 'ai', 'ck', 'shh', 'toc_style_id', 'share_to', 'track_id'],
      // Fix: the original also removed "page", "type" and "u" (pagination,
      // tabs and sign-in return links on Tieba/Passport) and "ie" on Tieba.
      keep: ['page', 'type', 'u', 'ie', 'pn', 'kw', 'wd', 'word'], extra: 'baidu' }],
      [/(^|\.)(tiktok|douyin)\.com$/, { params: ['rsv_idx', 'hisfilter', 'source', 'aid', 'enter_from', 'focus_method', 'previous_page', 'extra_params',
        'gid', 'enter_method', 'is_from_webapp', 'sender_device', 'web_id'] }],
      [/(^|\.)csdn\.net$/, { params: ['ops_request_misc', 'request_id', 'biz_id', 'ydreferer', 'usp', 'spm', 'utm_source', 'utm_medium'], extra: 'csdn' }],
      [/(^|\.)(youku|tudou)\.com$/, { params: ['spm', 'scm', 'from', 's', 'playMode', 'client_id'], re: ALI_RE }],
      [/(^|\.)((alibaba|alibabagroup|aliyun|alimama|aliexpress|taobao|tmall|1688|jiyoujia|fliggy)\.(com|hk|cn)|(lazada|trendyol)\.[a-z.]{2,15})$/,
        { params: ['spm', 'acm', 'scm', 'scene', 'from', 'pvid', 'pvid2', 'scm2', 'stats_click', 'initiative_id', 'source', 'suggest', 'suggest_query',
          'iconType', 'traceId', 'relationId', 'union_lens', 'ref', 'ali_trackid', 'ak', 'detailSharePosition', 'topOfferIds', 'sp_abtk',
          'search_condition', 'industryCatId', 'tbSocialPopKey', 'bxsign', 'utparam', 'eurl', 'itemIds', 'country', 'epid', 'user_number_id',
          'rootPageId', 'lwfrom', 'disableNav', 'es', 'rand', '_lgt_', 'x5referer', 'status_bar_transparent', 'tracelog', 'ad_id', 'am_id', 'cm_id',
          'pm_id', '_k', '__pageId__', 'resourceId', 'udsPoolId', 'resultType', 'cms_id', 'pha_html', '__existtitle__', 'object_type',
          'delivery_pool_id', 'delivery_pool_type', 'ilike_session', 'clickid', 'sessionid', 'cosite', '_p_isad', 'exp', 'hpageId',
          'shareUniqueId', 'clickTrackInfo', 'data_prefetch', 'at_iframe', 'prefetch_replace', 'wc'], re: ALI_RE }],
      [/(^|\.)amazon\.[a-z.]{2,15}$/, { params: ['content-id', 'qid', 'crid', 'isAmazonFulfilled', 'sbo', 'plattr', 'sprefix', 'ld', '_encoding', 'ds'],
        re: AMZN_RE, extra: 'amazon' }],
      // Fix: "redir_token" is required by youtube.com/redirect links (the
      // original removed it, breaking external links in descriptions).
      [/(^|\.)youtube\.com$/, { params: ['embeds_referring_euri', 'embeds_euri', 'source_ve_path', 'feature', 'embeds_referring_origin', 'pp',
        'ab_channel', 'si'], keep: ['redir_token', 'v', 'list', 't', 'index', 'q', 'event'] }],
      // Fix: "hl" (language) and "sig" (signed redirect links) are functional.
      [/(^|\.)google\.[a-z.]{2,15}$|^(about|wellbeing)\.google$/, { params: ['device', 'pcampaignid', 'subid', 'fg', 'ved', 'ei', 'prev', 'sca_esv',
        'visit_id', 'dest_src'], extra: 'google' }],
      [/(^|\.)facebook\.com$/, commonPlus(['privacy_mutation_token', 'ars', 'helpref', 'search_session_id', 'entry_point', 'campaign_id', 'nav_source',
        'placement', 'privacy_source', '__cft__[0]', '__tn__'])],
      [/(^|\.)(twitter|x)\.com$/, commonPlus(['screen_name'])],
      [/(^|\.)reddit\.com$/, commonPlus(['embed_host_url', 'actionSource', 'shreddit'], /^(utm_|spm_|from_|ref_|track|trk|experiment_d2x_|experiment_mweb)/)],
      [/(^|\.)linkedin\.com$/, commonPlus(['original_referer', 'lipi', 'desktopBackground', 'profileFormEntryPoint', 'veh', 'upsellTrk',
        'upsellTrackingId', 'refId', 'trackingId'])],
      [/(^|\.)dzen\.ru$/, commonPlus(['rid', 'clid', 'stid', 'issue_tld', 'parent_rid', 'persistent_id', 'utr', 'secdata', 'feed_exp',
        'force_common_feed', 'feed_filter_type', 'feed_filter_source'])],
      [/(^|\.)vk\.com$/, commonPlus(['initial_stats_info'])],
      [/(^|\.)(microsoft|bing|xbox|skype|office|microsoft365)\.com$/, commonPlus(['ocid', 'OCID', 'ICID', 'icid', 'WT.mc_id', 'xr', 'cat0'])],
      [/(^|\.)msn\.(com|cn)$/, commonPlus(['ocid', 'cvid', 'ei'])],
      [/(^|\.)bestbuy\.(com|ca)$/, commonPlus(['irgwc', 'mpid', 'irclickid', 'intlreferer', 'cmp', 'icmp', 'ks'], /^(utm_|nrtv_|subId)/)],
      // Fix: the original's generic "ref" removal broke GitHub ?ref=<branch> links.
      [/(^|\.)github\.com$/, { params: ['ref_cta', 'ref_loc', 'ref_page'], keep: ['ref'] }],
      [/(^|\.)stackoverflow\.com$/, commonPlus([], /^(utm_|spm_|from_|track|trk|so_)/)],
      [/(^|\.)pixiv\.net$/, commonPlus(['provider'])],
      [/(^|\.)music\.apple\.com$/, commonPlus(['at', 'ct', 'itscg', 'itsct'])],
      [/(^|\.)zhihu\.com$/, { params: ['search_source', 'hybrid_search_source', 'hybrid_search_extra', 'utm_psn'], extra: 'zhihu' }],
      [/(^|\.)(163|126|yeah)\.(com|net)$/, commonPlus(['fromDlpro', 'dltype'])],
      [/(^|\.)weibo\.com$/, commonPlus(['mark_id', '_rand', 'sudaref', 'band_rank'])],
      [/(^|\.)qq\.com$/, commonPlus(['ADTAG', 'fromSource'])],
      [/(^|\.)ebay\.[a-z.]{2,15}$/, commonPlus(['_trkparms', '_trksid', 'ssPageName', 'amdata', 'mc', 'hash', 'epid', 'var', '_ssn', 'store_name',
        'requested', 'itmprp', 'itmmeta'])],
      [/(^|\.)jd\.com$/, commonPlus(['gx', 'ad_od', 'needRecommendFlag', 'uabt', '_fd', 'pvid', 'jxsid', 'csid', 'ss_projid', 'scan_orig', 'ss_expid',
        'ss_sexpid', 'ss_ruleid', 'ss_sruleid', 'ss_symbol', 'ss_mtest', 'sceneval'], /^(track|wxa_|spm_|from_)/)],
      [/(^|\.)yangkeduo\.com$/, commonPlus(['gx', 'ad_od', 'needRecommendFlag', 'uabt', 'pxq_secret_key', 'cpsSignjb_act', 'launch_pdd',
        'customParameters', 'duoduo_type', 'goods_sign'], /^(track|from_|utm_|_oak_|_wv|_x_)/)],
      [/(^|\.)(hoyolab|hoyoverse|mihoyo|miyoushe|mihoyogift)\.com$/, { params: ['game_version', 'visit_device', 'device_type', 'plat_type'],
        re: /^(track|utm|spm_|from_|hyl_|bbs_|mhy_)|_from$/, extra: 'hoyo' }],
      [/(^|\.)douban\.com$/, commonPlus(['target_user_id', 'dcs', 'dcm', 'dt_time_source'])],
      [/(^|\.)(imdb|boxofficemojo)\.com$/, { params: ['rf', 'imdbPageAction'], re: AMZN_RE }],
      [/(^|\.)gitee\.com$/, { params: [], extra: 'gitee' }],
      [/(^|\.)xda-developers\.com$/, commonPlus(['ascsubtag', 'asc_refurl', 'asc_campaign', 'newsletter_popup'])],
      [/(^|\.)cctv\.com$/, commonPlus(['toc_style_id'])],
      [/(^|\.)fiverr\.com$/, commonPlus(['pckg_id', 'funnel', 'context_type', 'context_alg', 'imp_id', 'pos', 'context'])],
      [/(^|\.)newegg\.com$/, commonPlus(['cm_sp'])],
      [/(^|\.)theverge\.com$/, commonPlus(['u1', 'ascsubtag', 'subId1', 'subId2', 'subId3'])],
      [/(^|\.)bluestacks\.com$/, commonPlus(['client_uuid', 'gaCookie', 'gclid', 'clickid', 'msclkid', 'affiliateId', 'offerId', 'transaction_id',
        'aff_sub', 'first_landing_page', 'download_page_referrer'], /^device_|(_version|utm_campaign)$/)],
      [/(^|\.)xiaohongshu\.com$/, { params: [], extra: 'xiaohongshu' }],
      [/(^|\.)nicovideo\.jp$/, commonPlus(['cmnhd_ref'])]
    ];
    const site = (SITES.find(([re]) => re.test(host)) || [null, { params: [] }])[1];
    const siteParams = new Set(site.params || []);
    const keep = new Set([...(site.keep || []), ...words(cfg.keepParams)]);
    const extra = new Set(words(cfg.extraParams));

    const drop = (k) => {
      if (keep.has(k)) return false;
      if (SAFE.has(k) || SAFE_RE.test(k) || extra.has(k) || siteParams.has(k) || (site.re && site.re.test(k))) return true;
      return !!cfg.aggressive && (AGGRESSIVE.has(k) || AGGRESSIVE_RE.test(k));
    };

    // Fix: the original rebuilt URLs with URLSearchParams, which re-encodes
    // every remaining parameter (GBK searches on Chinese sites came out
    // garbled; hence its Taobao "q" workaround). Parameters are removed from
    // the raw query text, leaving the rest byte-for-byte unchanged.
    function stripQuery(search) {
      if (!search || search.length < 2) return search;
      const parts = search.slice(1).split('&');
      const kept = parts.filter((part) => {
        if (!part) return false;
        let k = part.split('=')[0];
        try { k = decodeURIComponent(k.replace(/\+/g, ' ')); } catch (_) { /* keep raw */ }
        return !drop(k);
      });
      if (kept.length === parts.length) return search;
      return kept.length ? '?' + kept.join('&') : '';
    }

    function cleanHref(href) {
      let u;
      try { u = new URL(href, location.href); } catch (_) { return null; }
      if (!/^https?:$/.test(u.protocol) || !/[a-z0-9-]{1,128}\.[a-z]{2,15}$/i.test(u.hostname)) return null;
      const search = stripQuery(u.search);
      let path = u.pathname;
      let hash = u.hash;
      if (site.extra === 'amazon' && /(^|\.)amazon\./.test(u.hostname)) {
        const i = path.indexOf('/ref=');
        if (i > 0) path = path.slice(0, i + 1);
      }
      // Fix: the original deleted 8 items at a time while looping, removing
      // non-tracking parts of the fragment too.
      if (site.extra === 'google' && /utm_/.test(hash)) {
        const rest = hash.slice(1).split('&').filter((x) => !/^utm_/.test(x));
        hash = rest.length ? '#' + rest.join('&') : '';
      }
      if (search === u.search && path === u.pathname && hash === u.hash) return null;
      return u.origin + path + search + hash;
    }

    function cleanLink(a) {
      const raw = a.getAttribute('href');
      if (!raw || raw[0] === '#' || /^(javascript|mailto|tel):/i.test(raw)) return;
      const out = cleanHref(a.href);
      if (out) a.setAttribute('href', out);
      if (site.extra === 'bilibili') {
        a.removeAttribute('data-spmid');
        a.removeAttribute('data-mod');
        const du = a.getAttribute('data-url');
        if (du && /^(https?:)?\/\//.test(du)) {
          const cleaned = cleanHref(du.startsWith('//') ? 'https:' + du : du);
          if (cleaned) { a.href = cleaned; a.classList.remove('jump-link'); }
        }
      }
    }

    // ---- address bar --------------------------------------------------------
    // Fix: the original replaced history.state with {} (breaking Back on
    // single-page sites) and also rewrote sign-in/OAuth return URLs.
    const isAuthPage = () => /^(accounts|login|auth|signin|passport|sso|id)\./.test(host) ||
      /\/(oauth2?|login|signin|sign-in|authorize|callback|sso|consent)(\/|$)/i.test(location.pathname);
    function cleanAddressBar() {
      if (!cfg.cleanAddressBar || isAuthPage()) return;
      const out = cleanHref(location.href);
      if (out && out !== location.href) {
        try { history.replaceState(history.state, '', out); } catch (_) { /* cross-origin edge cases */ }
      }
    }

    // ---- link cleaning: batched observer + one tap handler -----------------
    // Fix: the original attached four listeners to every <div> with a class
    // and re-cleaned on mouse movement and window.onscroll (overwriting the
    // site's own handler). Here new links are cleaned once per frame and the
    // tapped link right before the site sees the tap.
    const pending = new Set();
    let queued = false;
    const flush = () => {
      queued = false;
      const nodes = Array.from(pending);
      pending.clear();
      for (const n of nodes) {
        if (!n.isConnected) continue;
        if (n.tagName === 'A' || n.tagName === 'AREA') cleanLink(n);
        if (n.querySelectorAll) n.querySelectorAll('a[href], area[href]').forEach(cleanLink);
      }
      if (cfg.siteExtras) siteSweep();
    };
    const mo = new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.type === 'attributes') pending.add(m.target);
        else for (const n of m.addedNodes) if (n.nodeType === 1) pending.add(n);
      }
      if (pending.size && !queued) { queued = true; if (document.hidden) setTimeout(flush, 200); else requestAnimationFrame(flush); }
    });
    const startObserver = () => mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['href', 'data-url'] });
    if (document.documentElement) startObserver(); else api.onReady(startObserver);

    const onTap = (e) => {
      const t = e.target && (e.target.nodeType === 3 ? e.target.parentElement : e.target);
      const a = t && t.closest && t.closest('a[href], area[href]');
      if (a) cleanLink(a);
    };
    for (const ev of ['touchstart', 'pointerdown', 'mousedown', 'click', 'auxclick', 'contextmenu', 'keydown']) {
      window.addEventListener(ev, onTap, { capture: true, passive: true });
    }

    const fullClean = () => {
      cleanAddressBar();
      document.querySelectorAll('a[href], area[href]').forEach(cleanLink);
      if (cfg.siteExtras) siteSweep();
    };
    cleanAddressBar();
    api.onReady(fullClean);
    api.onLoad(() => setTimeout(fullClean, 1000));
    api.onUrlChange(() => setTimeout(fullClean, 300));
    // Manual clean: Alt+Shift+X (iPad keyboards), as in the original.
    window.addEventListener('keydown', (e) => { if (e.altKey && e.shiftKey && (e.key === 'X' || e.key === 'x')) { fullClean(); api.toast('Links cleaned'); } });

    // ---- site extras --------------------------------------------------------
    const css = {
      bilibili: '#right-bottom-banner, #anchor-guest-box-id, iframe[src*="live-lottery"] { display: none !important; }',
      hoyo: 'body { overflow: auto !important; }',
      baidu: location.pathname === '/s' ? '.EC_result { display: none !important; }' : ''
    };
    if (cfg.siteExtras && css[site.extra]) api.addStyle(css[site.extra], 'ioss-clean-urls-css');

    const closeOnce = (modal, close, ms) => {
      const end = Date.now() + ms;
      const stop = api.observe(document.documentElement, { childList: true, subtree: true }, () => {
        if (Date.now() > end) return stop();
        const m = document.querySelector(modal);
        const b = m && (m.querySelector(close) || document.querySelector(close));
        if (b) { b.click(); stop(); }
      }, { throttle: 100 });
      setTimeout(stop, ms);
    };
    if (cfg.siteExtras && site.extra === 'zhihu') api.onReady(() => closeOnce('.Modal-content', '.Modal-closeButton', 4000));
    if (cfg.siteExtras && site.extra === 'xiaohongshu') api.onReady(() => closeOnce('.login-container', '.close-button', 4000));
    if (cfg.siteExtras && site.extra === 'gitee') {
      const stop = api.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] }, () => {
        const m = document.querySelector('.menu.transition.visible');
        if (m) m.style.setProperty('display', 'none', 'important');
      }, { throttle: 50 });
      api.onReady(() => setTimeout(stop, 3000));
    }
    if (cfg.siteExtras && site.extra === 'csdn') {
      // As in the original: CSDN's click trackers never see link taps; the
      // browser still follows the link normally.
      window.addEventListener('click', (e) => {
        const a = e.target && e.target.closest && e.target.closest('a[href]');
        if (a && a.hostname && !/^javascript:/i.test(a.getAttribute('href'))) e.stopImmediatePropagation();
      }, true);
    }

    function siteSweep() {
      if (site.extra === 'bilibili') {
        document.querySelectorAll('meta[name="spm_prefix"]').forEach((m) => m.remove());
        // Fix: the original crashed when a card had no data-report or the
        // banner was missing, and its live pop-up timer never ran.
        document.querySelectorAll('a[href*="cm.bilibili.com"]').forEach((a) => a.remove());
        document.querySelectorAll('.bili-video-card[data-report*="tianma."]').forEach((c) => c.setAttribute('data-report', '0'));
        const entry = document.querySelector('.right-entry-item');
        if (entry && entry.innerText.includes('登录') && !document.getElementById('ioss-bili-login-css')) {
          api.addStyle('.lt-row, .bili-login-card, .bili-mini-mask, .unlogin-popover { display: none !important; }', 'ioss-bili-login-css');
        }
      } else if (site.extra === 'baidu') {
        if (location.pathname === '/s') document.querySelectorAll('.EC_result').forEach((n) => n.remove());
        document.querySelectorAll('a[href*="zhidao.baidu.com/q"]').forEach((a) => { if (a.pathname === '/q') a.pathname = '/search'; });
      }
    }
  }
})
