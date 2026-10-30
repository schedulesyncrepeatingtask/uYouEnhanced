# iOS Userscript Suite

One Safari userscript for iPhone that combines and fixes eleven popular userscripts. It's tuned for the
**iPhone 13 mini** (375 pt wide screen, notch, home indicator, Safari's bottom tab bar), and **every
module updates itself**.

| Module | Based on | What it does |
|---|---|---|
| Reject cookie banners | Google: Block Cookie Banner 2.0 | Rejects Google's and YouTube's consent dialogs before they appear |
| Don't Track Me Google | Don't Track Me Google 2.2.2 | Cleans result links, removes ping/click tracking and beacons, can force SafeSearch off |
| Google Lite | Google Lite 谷歌系轻量化 1.1.1 | Throttles YouTube performance telemetry (never watch history), lazy-loads below-the-fold images on Search/Gmail/Drive, pre-connects to Google's static servers |
| Reddit: remove login wall | Remove Reddit Login Requirement 1.0.12 | Removes NSFW/login/"open the app" walls, un-blurs, re-enables scrolling |
| Instagram: browse without logging in | Browse Instagram Without Logging In 1.0 | Hides the login/sign-up wall and bottom banner, re-enables scrolling, opens posts and reels as full pages |
| YouTube: remove ads | youtube-adb 6.21 | Hides feed/search/banner ads, skips video ads, removes the ad-blocker pop-up |
| SponsorBlock | Simple Sponsor Skipper 2026.03 | Skips sponsors, intros and other segments (with an **Undo** button) |
| Return YouTube Dislike | Return YouTube Dislike 3.2.0-ios | Shows dislike counts on m.youtube.com, the desktop site and Shorts |
| YouTube: PiP & player tweaks | YouTube PIP Button (iOS Safari) 1.3 | Picture-in-Picture button; optional "Shorts → normal player" and background play |
| Video downloader | All-in-One Video Downloader 1.0.19 | Download button for YouTube, TikTok, Instagram, X, Threads, Facebook, Pinterest, Snapchat, TED, Spotify and more |
| Bypass All Shortlinks | Bypass All Shortlinks 96.8 | Skips link-shortener waiting pages and has optional anti-annoyance tools |

## Install on iPhone

1. Install a userscript manager for Safari. Either works:
   - **[Userscripts](https://apps.apple.com/app/userscripts/id1463298887)** (free, open source)
   - **Stay**
2. Go to **Settings → Apps → Safari → Extensions**, turn the extension on and set **All Websites** to **Allow**.
3. In Safari, open
   `https://raw.githubusercontent.com/schedulesyncrepeatingtask/uYouEnhanced/main/dist/ios-userscript-suite.user.js`
   and confirm the install in the extension's prompt (tap the **puzzle-piece** icon in the address bar).
4. Remove the original scripts so that nothing runs twice.

### Settings

Tap the small **⚙︎ dot** that floats on every page (it fades after a few seconds; drag it wherever you like). You
can also add **`#suite`** to the end of any address (for example `youtube.com/#suite`). A bottom sheet opens
where you can:

- turn modules on or off
- change each module's options
- turn auto-update on or off for each module
- run an update check straight away
- move the floating buttons to the left or right side, or higher or lower on the screen

If your manager supports menu commands (Stay or Tampermonkey), the sheet is also listed there. You can hide the
dot in the sheet.

**No dot on any page?** Then the script isn't running. Check that the extension is on, that **All Websites** is
set to **Allow**, and that the suite is listed and switched on in the extension's popup (the puzzle-piece icon).

## Auto-update: one layer per module, plus the whole script

1. **Per module (hot update).** Every module has its own version number. About every 12 hours (you can change
   this), the suite reads `dist/modules/manifest.json` from this repository. When a module there is newer, it
   downloads only that module and checks its SHA-256 checksum. It then saves the module and uses it from the
   next page load on. You get a message with a **Reload** button.
   - A module is only applied if the core supports its API version. Otherwise it waits for a full update.
   - If your manager doesn't allow running downloaded code, the suite falls back to the bundled copy. In that
     case, step 2 still delivers the update.
2. **Whole script.** `@updateURL` / `@downloadURL` point at `dist/`, so your manager can update the whole file
   itself. When a newer suite version is published, the suite also shows a message with an **Install** button.

Updates are fetched from the `main` branch of this repository. They are only as trustworthy as this repository
itself, which is the same trust you give any auto-updating userscript.

## What was fixed for iPhone

**Reddit**
- The original called `GM_cookie`, which iOS managers don't have, so it crashed before removing anything. It now
  sets the cookie directly.
- It used to write `style="undefined"` onto elements.
- It now runs at most once per frame instead of on every DOM change.
- Un-blurring runs in the page itself, where Reddit's own functions are reachable.

**Google Lite**
- Its telemetry budget started at 0 and the refill timer only started once a request got through, so it never
  refilled. Every matching request was blocked forever, including `/api/stats/playback` and `/watchtime`, which
  YouTube uses for watch history and resume position. The budget now starts full, and watch history is never
  throttled (configurable).
- Its fetch/beacon wrappers only work inside the page; they're now injected there instead of the sandbox.
- Its 26 px dot (below Apple's 44 pt minimum) became the suite's settings dot, with a 44 pt touch target.
- Per-site on/off and the options moved to the settings sheet. Hints go in `<head>` instead of a hidden `<div>`.

**Instagram (Browse Without Logging In)**
- It looked for the pop-up by 2020-era class names (`RnEpo _Yhr4`) that Instagram no longer uses, so it no longer
  found anything. The wall is now recognised by its login form or sign-up link, and post viewers are left alone.
- It reassigned `onclick` on every link in a `setInterval(…, 0)` loop, hundreds of times a second, which is a
  constant battery drain. One click listener now does the same, and covers reels as well as posts.
- It re-added its close button and a new resize listener every 500 ms. The button was 30 px, placed for a 400 px
  desktop dialog.
- It deleted nodes that Instagram's React code still manages, which can crash the page. The wall is now hidden
  instead. By default it closes automatically; a 44 pt ✕ button (like the original) is available in the options.
- It now also hides the "Log in to see more" banner at the bottom.

**Simple Sponsor Skipper**
- It assigned `this.GM…` inside strict mode. On Safari, which has no menu commands, that threw an error and the
  script never ran.
- Segment processing crashed, and then skipped nothing, whenever the first segment was below the vote threshold.
- It compared highlight votes against a field that doesn't exist (`upvotes`).
- It polled for the player every 10 ms forever and stacked listeners on every navigation.
- Desktop notifications (unavailable on iOS) are replaced by in-page messages with **Undo** and **Jump to
  highlight**.
- Skips happen on time even though iOS only reports playback time about every 250 ms.

**youtube-adb**
- It created `new Touch()`, which Safari doesn't support, and threw an error on every ad.
- It never unmuted after an ad.
- It force-played any paused video near 0 s on every DOM change, so you couldn't pause at the start of a video.
- It now has m.youtube.com ad selectors and one throttled observer instead of two unthrottled ones.

**Return YouTube Dislike**
- Requests and storage go through the suite, so the module keeps working after it hot-updates.
- Fixed crashes when the buttons haven't rendered yet.
- Setup polling backs off instead of running 9 times a second forever on pages without buttons.
- Timers pause while the tab is in the background.

**YouTube PiP button**
- It kept a reference to an outdated `<video>` element after navigation; the video is now looked up when you tap.
- The button is now 40 pt.
- It also works on the desktop site.
- It no longer scans the page on every DOM change.

**Video downloader**
- Its buttons only appeared on mouse hover, which never happens on a phone, and it ignored m.youtube.com, so on
  an iPhone nothing showed.
- It's now a 44 pt floating button that picks the video currently on screen, plus inline buttons on X and
  Threads. Long-press the button to copy the link.
- On YouTube watch pages the button sits in the action bar, left of the like button, styled like YouTube's own
  pills (light and dark). Shorts keep the floating button. Return YouTube Dislike skips it when locating the
  like/dislike buttons.
- It loaded three external libraries (StreamSaver, CryptoJS, JSEncrypt). Two were never used and StreamSaver
  doesn't work on iOS. All three are gone.
- Direct video files are saved through the iOS share sheet (**Save Video**).

**Don't Track Me Google**
- Its beacon, fetch and `href` guards were installed from the sandbox, where on Safari they don't affect the page.
  They are now injected into the page itself, using the page's CSP nonce.
- It removed click handlers from *every* link, which broke "People also ask", tabs and the image viewer. Now only
  outgoing result links are cleaned.
- "Force SafeSearch off" only changed the address bar. It now reloads once with `safe=off` (with a loop guard) and
  adds `safe=off` to the search form.
- It rescanned the whole page, including a `querySelectorAll('*')` walk, for every DOM change. Changes are now
  batched per frame.

**Google cookie banner**
- It forced `overflow: auto` on every Google page permanently, which broke Maps. That now only applies while the
  dialog is present.
- It now also covers YouTube's consent dialog and many more languages.

**Bypass All Shortlinks**
- It needed `unsafeWindow.jQuery`, which doesn't exist in Safari's sandbox, so the main "go-link" bypass never
  ran on iPhone. It now runs inside the page when possible and otherwise follows the final link as soon as the
  site reveals it.
- The settings library (MonkeyConfig) needed menu commands that iOS managers don't have, so settings were
  unreachable. They're now in the settings sheet.
- "Disable prompts" scheduled another timer on every DOM change, so timers grew without limit. It also removed any
  element whose class contained "banner" or "notice", sometimes the whole page. Both are fixed.
- The popup blocker made `window.open` return a Promise, which broke sites. It now returns `null`.
- The notification box was 970 px wide on a 375 pt screen.
- "Shorts → normal player" redirected to www.youtube.com. It now stays on m.youtube.com and lives in the YouTube
  module, and the YouTube download option was merged into the downloader.

**Everywhere**
- One storage read per page instead of one per script.
- Modules only run on the sites they're for.
- Frames on unrelated sites, such as ad iframes, exit immediately.
- Timers skip ticks while the tab is hidden.
- All UI uses 44 pt touch targets, safe-area insets, dark mode, and 16 px inputs so Safari doesn't zoom in.

## Privacy notes

- **Downloader:** tapping the button sends the video's page URL to the downloader service (tool77.com, as in the
  original). You can choose "Just copy the link" instead.
- **SponsorBlock:** only the first 4 characters of the video ID's hash are sent (configurable).
- **Return YouTube Dislike:** sends the video ID, and your vote unless you turn that off.
- **Bypass All Shortlinks:** the "Route results through the author's blog" option is off by default.

## Development

```sh
node build.mjs           # src/ -> dist/ (bundle, meta, per-module files, manifest with SHA-256)
node build.mjs --check   # fail if dist/ is stale
node test/run.mjs        # end-to-end tests in an emulated iPhone 13 mini (needs Playwright + Chromium)
node test/isolated.mjs   # same, but as a sandboxed content script, like Safari managers run it
```

To release a module update, edit `src/modules/<id>.js`, bump that module's `version`, run `node build.mjs` and
push `dist/` to `main`. Bump `src/suite.json` only when the core changes. Bump `api` there only if the module API
changes incompatibly.

Layout:

```
src/core.js            runtime: settings sheet, updater, toasts, floating buttons, page-world bridge
src/modules/*.js       one file per module (an object literal; also published to dist/modules)
src/header.js          userscript metadata template
src/suite.json         suite name, version, repository and branch used for updates
dist/                  build output — install dist/ios-userscript-suite.user.js
```

## Credits & license

This suite contains modified versions of:

- **Return YouTube Dislike** by Anarios & JRWR (GPL-3.0)
- **Simple Sponsor Skipper** by mthsk (AGPL-3.0-or-later)
- **Don't Track Me Google** by Rob Wu / KTZ (MIT)
- **youtube-adb** by iamfugui (MIT)
- **Remove Reddit Login Requirement** by SoCuul (MIT)
- **Browse Instagram Without Logging In** by dankdave69
- **Google Lite 谷歌系轻量化** (MIT)
- **All-in-One Video Downloader** by Daniel (MIT)
- **Bypass All Shortlinks** by Bloggerpemula, with thanks to @JustOlaf, @Konf, @hacker09, @juansi, @NotYou,
  @cunaqr, @Rust1667 and @varram (bloggerpemula.pythonanywhere.com)
- **YouTube PIP Button (iOS Safari)**
- **Google: Block Cookie Banner**

Because it includes AGPL-licensed code, the combined suite is distributed under the
**GNU AGPL v3.0 or later** (see `LICENSE`).
