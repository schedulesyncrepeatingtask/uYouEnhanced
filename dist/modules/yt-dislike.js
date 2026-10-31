({
  id: 'yt-dislike',
  name: 'Return YouTube Dislike',
  version: '3.2.3',
  api: 1,
  source: 'Return YouTube Dislike 3.2.0-ios (Anarios & JRWR)',
  description: 'Shows dislike counts again (watch pages and Shorts, mobile and desktop) using the returnyoutubedislike.com API, and anonymously contributes your own likes/dislikes.',
  runAt: 'ready',
  frames: false,
  match: (u) => /^(m|www)\.youtube\.com$/.test(u.hostname),
  defaults: {
    disableVoteSubmission: false,
    numberDisplayFormat: 'compactShort',
    numberDisplayRoundDown: true,
    numberDisplayReformatLikes: false,
    coloredThumbs: false,
    coloredBar: false,
    colorTheme: 'classic',
    rateBarEnabled: true,
    tooltipPercentageMode: 'none',
    disableLogging: true
  },
  options: [
    { key: 'disableVoteSubmission', type: 'bool', label: "Don't send my likes/dislikes" },
    { key: 'numberDisplayFormat', type: 'select', label: 'Number format', choices: [['compactShort', '1.2K'], ['compactLong', '1.2 thousand'], ['standard', '1,234']] },
    { key: 'numberDisplayRoundDown', type: 'bool', label: 'Round numbers down' },
    { key: 'numberDisplayReformatLikes', type: 'bool', label: 'Re-format like count the same way' },
    { key: 'coloredThumbs', type: 'bool', label: 'Colour the thumbs' },
    { key: 'coloredBar', type: 'bool', label: 'Colour the ratio bar (desktop)' },
    { key: 'colorTheme', type: 'select', label: 'Colours', choices: [['classic', 'Green / red'], ['accessible', 'Blue / yellow'], ['neon', 'Cyan / pink']] },
    { key: 'rateBarEnabled', type: 'bool', label: 'Like/dislike ratio bar (desktop)' },
    { key: 'tooltipPercentageMode', type: 'select', label: 'Ratio bar tooltip', choices: [['none', 'Counts'], ['dash_like', 'Counts - like %'], ['dash_dislike', 'Counts - dislike %'], ['both', 'Both %'], ['only_like', 'Like %'], ['only_dislike', 'Dislike %']] },
    { key: 'disableLogging', type: 'bool', label: 'Quiet console' }
  ],
  run(api, cfg) {
// ---------------------------------------------------------------------------
// Below is the original Return YouTube Dislike userscript (webpack bundle),
// kept close to upstream so future upstream fixes are easy to merge. Changes
// for the suite / iPhone are marked "Suite:".
// ---------------------------------------------------------------------------
;// CONCATENATED MODULE: ./Extensions/common/vote-client.js
const DEFAULT_API_BASE_URL = "https://returnyoutubedislikeapi.com";
const USER_ID_CHARSET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const VALID_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const VALID_VOTE_VALUES = new Set([-1, 0, 1]);

class VoteClientError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "VoteClientError";
    this.status = options.status;
    this.cause = options.cause;
  }
}

function countLeadingZeroes(bytes, limit = Infinity) {
  let zeroes = 0;

  for (const originalValue of bytes) {
    let value = originalValue;
    if (value === 0) {
      zeroes += 8;
    } else {
      let count = 1;
      if (value >>> 4 === 0) {
        count += 4;
        value <<= 4;
      }
      if (value >>> 6 === 0) {
        count += 2;
        value <<= 2;
      }
      zeroes += count - (value >>> 7);
      break;
    }

    if (zeroes >= limit) break;
  }

  return zeroes;
}

function generateUserId(cryptoImpl = globalThis.crypto, length = 36) {
  if (!Number.isInteger(length) || length <= 0) {
    throw new TypeError("User ID length must be a positive integer");
  }
  if (!cryptoImpl?.getRandomValues) {
    throw new VoteClientError("Web Crypto random generation is unavailable");
  }

  const values = new Uint32Array(length);
  cryptoImpl.getRandomValues(values);
  let result = "";
  for (const value of values) {
    result += USER_ID_CHARSET[value % USER_ID_CHARSET.length];
  }
  return result;
}

function decodeBase64(value) {
  if (typeof atob !== "function") {
    throw new VoteClientError("Base64 decoding is unavailable");
  }
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function encodeBase64(bytes) {
  if (typeof btoa !== "function") {
    throw new VoteClientError("Base64 encoding is unavailable");
  }
  return btoa(String.fromCharCode(...bytes));
}

async function solvePuzzle(puzzle, cryptoImpl = globalThis.crypto, maxAttempts) {
  if (!puzzle || typeof puzzle.challenge !== "string" || !Number.isInteger(puzzle.difficulty)) {
    throw new VoteClientError("The API returned an invalid puzzle");
  }
  if (!cryptoImpl?.subtle?.digest) {
    throw new VoteClientError("Web Crypto hashing is unavailable");
  }

  const challenge = decodeBase64(puzzle.challenge);
  if (challenge.length !== 16) {
    throw new VoteClientError("The API returned an invalid puzzle challenge");
  }

  const attempts = maxAttempts ?? Math.pow(2, puzzle.difficulty) * 3;
  if (!Number.isSafeInteger(attempts) || attempts <= 0) {
    throw new VoteClientError("The puzzle attempt limit is invalid");
  }

  const buffer = new ArrayBuffer(20);
  const byteView = new Uint8Array(buffer);
  const integerView = new Uint32Array(buffer);
  byteView.set(challenge, 4);

  for (let counter = 0; counter < attempts; counter++) {
    integerView[0] = counter;
    const hash = await cryptoImpl.subtle.digest("SHA-512", buffer);
    if (countLeadingZeroes(new Uint8Array(hash), puzzle.difficulty) >= puzzle.difficulty) {
      return { solution: encodeBase64(byteView.slice(0, 4)) };
    }
  }

  return null;
}

function isConfirmedCredential(value) {
  return Boolean(value?.userId && value.registrationConfirmed === true);
}

function createVoteClient({
  apiBaseUrl = DEFAULT_API_BASE_URL,
  fetchImpl = globalThis.fetch?.bind(globalThis),
  credentialStore,
  cryptoImpl = globalThis.crypto,
  puzzleAttempts = 2,
  votePuzzleAttempts = 3,
} = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl is required");
  if (!credentialStore?.load || !credentialStore?.save || !credentialStore?.clear) {
    throw new TypeError("credentialStore must provide load, save, and clear");
  }
  if (!Number.isInteger(puzzleAttempts) || puzzleAttempts <= 0) {
    throw new TypeError("puzzleAttempts must be a positive integer");
  }
  if (!Number.isInteger(votePuzzleAttempts) || votePuzzleAttempts <= 0) {
    throw new TypeError("votePuzzleAttempts must be a positive integer");
  }

  const baseUrl = apiBaseUrl.replace(/\/$/, "");
  const voteQueues = new Map();
  let registrationPromise = null;
  let registrationIsForced = false;

  async function readJson(response, operation) {
    try {
      return await response.json();
    } catch (error) {
      throw new VoteClientError(`${operation} returned invalid JSON`, { status: response.status, cause: error });
    }
  }

  function isSuccessful(response) {
    if (typeof response.ok === "boolean") return response.ok;
    return response.status >= 200 && response.status < 300;
  }

  async function request(path, options, operation) {
    let response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, options);
    } catch (error) {
      throw new VoteClientError(`${operation} request failed`, { cause: error });
    }

    if (!response || !Number.isInteger(response.status)) {
      throw new VoteClientError(`${operation} returned an invalid response`);
    }
    return response;
  }

  async function postJson(path, body, operation) {
    const response = await request(
      path,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      operation,
    );
    return response;
  }

  async function registerNewCredential() {
    const userId = generateUserId(cryptoImpl);

    for (let attempt = 0; attempt < puzzleAttempts; attempt++) {
      const path = `/puzzle/registration?userId=${encodeURIComponent(userId)}`;
      const puzzleResponse = await request(
        path,
        { method: "GET", headers: { Accept: "application/json" } },
        "Registration puzzle",
      );
      if (!isSuccessful(puzzleResponse)) {
        throw new VoteClientError("Registration puzzle request was rejected", { status: puzzleResponse.status });
      }

      const puzzle = await readJson(puzzleResponse, "Registration puzzle");
      const solvedPuzzle = await solvePuzzle(puzzle, cryptoImpl);
      if (!solvedPuzzle) continue;

      const confirmResponse = await postJson(path, solvedPuzzle, "Registration confirmation");
      if (!isSuccessful(confirmResponse)) {
        throw new VoteClientError("Registration confirmation was rejected", { status: confirmResponse.status });
      }
      const confirmed = await readJson(confirmResponse, "Registration confirmation");
      if (confirmed !== true) {
        throw new VoteClientError("Registration confirmation failed");
      }

      const credential = { userId, registrationConfirmed: true };
      await credentialStore.save(credential);
      return { userId };
    }

    throw new VoteClientError("Unable to solve the registration puzzle");
  }

  async function ensureRegisteredInternal(force) {
    if (force) {
      await credentialStore.clear();
    } else {
      const credential = await credentialStore.load();
      if (isConfirmedCredential(credential)) return { userId: credential.userId };
    }
    return registerNewCredential();
  }

  function trackRegistration(work, force) {
    let trackedPromise;
    trackedPromise = work.finally(() => {
      if (registrationPromise === trackedPromise) {
        registrationPromise = null;
        registrationIsForced = false;
      }
    });
    registrationPromise = trackedPromise;
    registrationIsForced = force;
    return trackedPromise;
  }

  function ensureRegistered(options = {}) {
    const force = options.force === true;
    if (!registrationPromise) {
      return trackRegistration(ensureRegisteredInternal(force), force);
    }
    if (!force || registrationIsForced) return registrationPromise;

    const pendingRegistration = registrationPromise;
    return trackRegistration(
      pendingRegistration.catch(() => undefined).then(() => ensureRegisteredInternal(true)),
      true,
    );
  }

  async function performVote(videoId, value, authenticationRetriesRemaining) {
    let { userId } = await ensureRegistered();

    for (let attempt = 0; attempt < votePuzzleAttempts; attempt++) {
      const voteResponse = await postJson("/interact/vote", { userId, videoId, value }, "Vote submission");

      if (voteResponse.status === 401) {
        if (authenticationRetriesRemaining <= 0) {
          throw new VoteClientError("Vote submission was unauthorized after re-registration", { status: 401 });
        }
        ({ userId } = await ensureRegistered({ force: true }));
        return performVote(videoId, value, authenticationRetriesRemaining - 1);
      }
      if (!isSuccessful(voteResponse)) {
        throw new VoteClientError("Vote submission was rejected", { status: voteResponse.status });
      }

      const puzzle = await readJson(voteResponse, "Vote submission");
      const solvedPuzzle = await solvePuzzle(puzzle, cryptoImpl);
      if (!solvedPuzzle) continue;

      const confirmResponse = await postJson(
        "/interact/confirmVote",
        { ...solvedPuzzle, userId, videoId },
        "Vote confirmation",
      );
      if (confirmResponse.status === 401) {
        if (authenticationRetriesRemaining <= 0) {
          throw new VoteClientError("Vote confirmation was unauthorized after re-registration", { status: 401 });
        }
        await ensureRegistered({ force: true });
        return performVote(videoId, value, authenticationRetriesRemaining - 1);
      }
      if (!isSuccessful(confirmResponse)) {
        throw new VoteClientError("Vote confirmation was rejected", { status: confirmResponse.status });
      }

      const confirmed = await readJson(confirmResponse, "Vote confirmation");
      if (confirmed !== true) throw new VoteClientError("Vote confirmation failed");
      return true;
    }

    throw new VoteClientError("Unable to solve the vote puzzle");
  }

  function submitVote(videoId, value) {
    if (typeof videoId !== "string" || !VALID_VIDEO_ID.test(videoId)) {
      return Promise.reject(new TypeError("videoId must be an 11-character YouTube video ID"));
    }
    if (!VALID_VOTE_VALUES.has(value)) {
      return Promise.reject(new TypeError("value must be -1, 0, or 1"));
    }

    const previous = voteQueues.get(videoId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(() => performVote(videoId, value, 1));
    voteQueues.set(videoId, current);
    current.then(
      () => {
        if (voteQueues.get(videoId) === current) voteQueues.delete(videoId);
      },
      () => {
        if (voteQueues.get(videoId) === current) voteQueues.delete(videoId);
      },
    );
    return current;
  }

  return { ensureRegistered, submitVote };
}



;// CONCATENATED MODULE: ./Extensions/common/vote-transition.js
const LIKED_STATE = "LIKED_STATE";
const DISLIKED_STATE = "DISLIKED_STATE";
const NEUTRAL_STATE = "NEUTRAL_STATE";

const LIKE_ACTION = "like";
const DISLIKE_ACTION = "dislike";

const TRANSITIONS = {
  [NEUTRAL_STATE]: {
    [LIKE_ACTION]: { nextState: LIKED_STATE, value: 1, likesDelta: 1, dislikesDelta: 0 },
    [DISLIKE_ACTION]: { nextState: DISLIKED_STATE, value: -1, likesDelta: 0, dislikesDelta: 1 },
  },
  [LIKED_STATE]: {
    [LIKE_ACTION]: { nextState: NEUTRAL_STATE, value: 0, likesDelta: -1, dislikesDelta: 0 },
    [DISLIKE_ACTION]: { nextState: DISLIKED_STATE, value: -1, likesDelta: -1, dislikesDelta: 1 },
  },
  [DISLIKED_STATE]: {
    [LIKE_ACTION]: { nextState: LIKED_STATE, value: 1, likesDelta: 1, dislikesDelta: -1 },
    [DISLIKE_ACTION]: { nextState: NEUTRAL_STATE, value: 0, likesDelta: 0, dislikesDelta: -1 },
  },
};

function resolveVoteTransition(previousState, action) {
  const transition = TRANSITIONS[previousState]?.[action];
  if (!transition) {
    throw new TypeError(`Unsupported vote transition: ${previousState} -> ${action}`);
  }
  return { ...transition };
}

function applyVoteTransitionCounts(likes, dislikes, transition) {
  if (!transition || !Number.isFinite(transition.likesDelta) || !Number.isFinite(transition.dislikesDelta)) {
    throw new TypeError("A valid vote transition is required");
  }

  const normalizedLikes = Number.isFinite(likes) ? likes : 0;
  const normalizedDislikes = Number.isFinite(dislikes) ? dislikes : 0;
  return {
    likes: Math.max(0, normalizedLikes + transition.likesDelta),
    dislikes: Math.max(0, normalizedDislikes + transition.dislikesDelta),
  };
}

function shouldSubmitVote({ disableVoteSubmission = false, signedOut = false } = {}) {
  return disableVoteSubmission !== true && signedOut !== true;
}



;// CONCATENATED MODULE: ./Extensions/UserScript/src/gm-credential-store.js
const CREDENTIALS_KEY = "rydVoteCredentials";

// Suite: storage goes through the suite API so this module also works when
// it is hot-updated (GM globals are not visible to hot-updated code).
async function getStoredValue() {
  return api.storage.get(CREDENTIALS_KEY, null);
}

async function setStoredValue(value) {
  await api.storage.set(CREDENTIALS_KEY, value);
}

async function deleteStoredValue() {
  await api.storage.del(CREDENTIALS_KEY);
}

function createGmCredentialStore() {
  return {
    async load() {
      const value = await getStoredValue();
      if (!value || typeof value !== "object") {
        return null;
      }

      return {
        userId: value.userId,
        registrationConfirmed: value.registrationConfirmed === true,
      };
    },

    async save(credentials) {
      await setStoredValue({
        userId: credentials.userId,
        registrationConfirmed: credentials.registrationConfirmed === true,
      });
    },

    async clear() {
      await deleteStoredValue();
    },
  };
}



;// CONCATENATED MODULE: ./Extensions/UserScript/src/gm-synthetic-dislike-store.js
const SYNTHETIC_DISLIKE_KEY_PREFIX = "rydSyntheticDislikedShort:";

// Each currently disliked Short owns one independent key. Deliberately do not
// evict selected videos: forgetting one would make the next click submit -1
// again instead of the required neutral (0) transition.

async function gm_synthetic_dislike_store_getStoredValue(key, fallbackValue) {
  return api.storage.get(key, fallbackValue);
}

async function gm_synthetic_dislike_store_setStoredValue(key, value) {
  await api.storage.set(key, value);
}

async function gm_synthetic_dislike_store_deleteStoredValue(key) {
  await api.storage.del(key);
}

function validateVideoId(videoId) {
  if (typeof videoId !== "string" || videoId.length === 0) {
    throw new TypeError("videoId must be a non-empty string");
  }
}

function syntheticDislikeKey(videoId) {
  return `${SYNTHETIC_DISLIKE_KEY_PREFIX}${videoId}`;
}

function createGmSyntheticDislikeStore() {
  let mutationQueue = Promise.resolve();

  function enqueueMutation(mutation) {
    const result = mutationQueue.catch(() => undefined).then(mutation);
    mutationQueue = result;
    return result;
  }

  return {
    async isDisliked(videoId) {
      validateVideoId(videoId);
      await mutationQueue.catch(() => undefined);
      return (await gm_synthetic_dislike_store_getStoredValue(syntheticDislikeKey(videoId), false)) === true;
    },

    async setDisliked(videoId, disliked) {
      validateVideoId(videoId);
      if (typeof disliked !== "boolean") {
        throw new TypeError("disliked must be a boolean");
      }

      return enqueueMutation(() =>
        disliked ? gm_synthetic_dislike_store_setStoredValue(syntheticDislikeKey(videoId), true) : gm_synthetic_dislike_store_deleteStoredValue(syntheticDislikeKey(videoId)),
      );
    },
  };
}



;// CONCATENATED MODULE: ./Extensions/UserScript/userscript-version.json
const userscript_version_namespaceObject = "3.2.0";
;// CONCATENATED MODULE: ./Extensions/UserScript/src/userscript-entry.js







const API_BASE_URL = "https://returnyoutubedislikeapi.com";
// iOS fix: requests go through GM.xmlHttpRequest (via the suite API), which
// is not subject to YouTube's CSP / CORS inside Safari's extension sandbox.
function gmFetch(url, options = {}) {
  return api
    .request({ url, method: options.method || "GET", headers: options.headers || {}, body: options.body, timeout: 15000 })
    .then((response) => {
      const status = Number(response.status) || 0;
      const text = response.text || "";
      return {
        ok: status >= 200 && status < 300,
        status,
        async json() {
          return JSON.parse(text);
        },
        async text() {
          return text;
        },
      };
    });
}

const fetchImpl = gmFetch;
const voteClient = createVoteClient({
  apiBaseUrl: API_BASE_URL,
  fetchImpl,
  credentialStore: createGmCredentialStore(),
  cryptoImpl: globalThis.crypto,
});
const syntheticDislikeStore = createGmSyntheticDislikeStore();

// Suite: options are edited in the suite settings sheet.
const extConfig = cfg;

let previousState = NEUTRAL_STATE;
let likesvalue = 0;
let dislikesvalue = 0;

let isMobile = location.hostname == "m.youtube.com";

function getShortVideoIdFromPathname(pathname) {
  return pathname.match(/^\/shorts\/([^/]+)\/?$/)?.[1] ?? null;
}

let isShorts = () => getShortVideoIdFromPathname(location.pathname) !== null;
let mobileDislikes = 0;
let suppressNextLikeActivation = false;
const boundLikeButtons = new WeakSet();
const boundDislikeButtons = new WeakSet();
const boundActivationVideoIds = new WeakMap();
const suppressedStaleRefreshTargets = new WeakSet();
const removingSyntheticShortsDislikes = new WeakSet();
const pendingWatchControlResets = new Map();
let pendingWatchNavigationBoundary = null;
const hydratingShortsActivationTargets = new WeakMap();
const shortsHydrationTails = new Map();
let shortsLifecycleObserver = null;
let shortsLifecycleObserverTarget = null;
let initializationGeneration = 0;
let initializationTimer = null;
let activeCountRequest = null;
let countStateVideoId = null;
let countStateLoaded = false;
let countStateEpoch = 0;
let shortsSubmittedStateVideoId = null;
let shortsSubmittedState = NEUTRAL_STATE;
let watchRateBarObserver = null;
let watchRateBarObserverTarget = null;
let watchRateBarObserverVideoId = null;
let watchRateBarRepairTimer = null;
const SYNTHETIC_SHORTS_DISLIKE_SELECTOR = "[data-ryd-synthetic-shorts-dislike]";
const SHORTS_DISLIKE_ICON_PATH =
  "m8.482 1.5.294.005a9.01 9.01 0 013.918 1.04l.257.143.203.116c.17.097.357.16.55.185l.194.012h1.477l.115.006c.53.054.95.475 1.004 1.005l.006.114v4.499c0 .621-.504 1.125-1.125 1.125h-1.343a.75.75 0 00-.66.395l-.048.107-2.24 6.402a.75.75 0 01-.832.491l-.78-.13a3 3 0 01-2.439-3.587L7.5 11.25H4.454a2.749 2.749 0 01-2.683-2.151 2.762 2.762 0 01.479-2.237l-.016-.065A2.862 2.862 0 013 4.125v-.032c0-.227.037-.453.108-.668l.08-.211A2.816 2.816 0 015.78 1.5h2.703ZM5.78 3c-.566 0-1.069.362-1.248.9a.613.613 0 00-.031.193v.654l-.44.44c-.333.332-.47.813-.364 1.271l.015.065.157.675-.413.557a1.248 1.248 0 00.999 1.995H7.5a1.501 1.501 0 011.467 1.815L8.5 13.742a1.5 1.5 0 001.22 1.794l.157.027 2.031-5.806a2.25 2.25 0 012.124-1.507H15V4.501h-1.102a3.001 3.001 0 01-1.489-.396l-.202-.116A7.504 7.504 0 008.482 3H5.78Z";
function cLog(text, subtext = "") {
  if (!extConfig.disableLogging) {
    subtext = subtext.trim() === "" ? "" : `(${subtext})`;
    console.log(`[Return YouTube Dislikes] ${text} ${subtext}`);
  }
}

function isInViewport(element) {
  const rect = element.getBoundingClientRect();
  const height = innerHeight || document.documentElement.clientHeight;
  const width = innerWidth || document.documentElement.clientWidth;
  return (
    // When short (channel) is ignored, the element (like/dislike AND short itself) is
    // hidden with a 0 DOMRect. In this case, consider it outside of Viewport
    !(rect.top == 0 && rect.left == 0 && rect.bottom == 0 && rect.right == 0) &&
    rect.top >= 0 &&
    rect.left >= 0 &&
    rect.bottom <= height &&
    rect.right <= width
  );
}

function intersectsViewport(element) {
  const rect = element.getBoundingClientRect();
  const height = innerHeight || document.documentElement.clientHeight;
  const width = innerWidth || document.documentElement.clientWidth;
  return (
    rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < height && rect.left < width
  );
}

function hasRenderedBox(element) {
  if (!element?.isConnected || element.closest("[hidden], [aria-hidden='true'], [inert]")) {
    return false;
  }
  for (let current = element; current; current = current.parentElement) {
    const style = getComputedStyle(current);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.visibility === "collapse" ||
      Number.parseFloat(style.opacity) === 0
    ) {
      return false;
    }
  }
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function getRendererShortVideoIds(renderer) {
  const identities = new Set();
  const attributeVideoId = renderer.getAttribute("video-id");
  if (attributeVideoId) {
    identities.add(attributeVideoId);
    return identities;
  }
  for (const link of renderer.querySelectorAll('a[href*="/shorts/"]')) {
    try {
      const linkVideoId = getShortVideoIdFromPathname(new URL(link.getAttribute("href"), location.origin).pathname);
      if (linkVideoId) {
        identities.add(linkVideoId);
      }
    } catch {
      // Ignore malformed or incomplete links while YouTube hydrates the reel.
    }
  }
  return identities;
}

function rendererMatchesShort(renderer, videoId) {
  return Boolean(videoId) && getRendererShortVideoIds(renderer).has(videoId);
}

function getControlOwnershipVideoIds(container) {
  const identities = new Set();
  if (!container) {
    return identities;
  }
  const ownedElements = [container, ...container.querySelectorAll("[data-ryd-video-id]")];
  for (const element of ownedElements) {
    const ownedVideoId = element.getAttribute?.("data-ryd-video-id");
    if (ownedVideoId) {
      identities.add(ownedVideoId);
    }
  }
  for (const target of container.querySelectorAll("button, tp-yt-paper-button#button")) {
    const boundVideoId = boundActivationVideoIds.get(target);
    if (boundVideoId) {
      identities.add(boundVideoId);
    }
  }
  return identities;
}

function hasConflictingControlOwnership(container, videoId) {
  return Array.from(getControlOwnershipVideoIds(container)).some((ownedVideoId) => ownedVideoId !== videoId);
}

function clearPendingWatchControlObservers() {
  for (const resetState of pendingWatchControlResets.values()) {
    resetState.observer.disconnect();
  }
  pendingWatchControlResets.clear();
}

function clearPendingWatchNavigationBoundary() {
  pendingWatchNavigationBoundary?.observer?.disconnect();
  pendingWatchNavigationBoundary = null;
}

function activationTargetHasVideoIdentity(target, videoId, buttons) {
  let current = target;
  while (current) {
    if (current.getAttribute?.("video-id") === videoId || current.getAttribute?.("data-video-id") === videoId) {
      return true;
    }
    if (current === buttons) {
      break;
    }
    current = current.parentElement;
  }
  return false;
}

function watchTargetIsReady(targetState, buttons, videoId) {
  return (
    !buttons.contains(targetState.activationTarget) ||
    activationTargetHasVideoIdentity(targetState.activationTarget, videoId, buttons) ||
    targetState.refreshed
  );
}

function originalWatchTargetsAreReady(resetState, buttons, videoId) {
  return [resetState.like, resetState.dislike].every((targetState) =>
    watchTargetIsReady(targetState, buttons, videoId),
  );
}

function currentWatchTargetIsReady(target, targetState, buttons, videoId) {
  const boundVideoId = boundActivationVideoIds.get(target);
  return (
    !boundVideoId ||
    boundVideoId === videoId ||
    activationTargetHasVideoIdentity(target, videoId, buttons) ||
    (target === targetState.activationTarget && targetState.refreshed)
  );
}

function elementIsOwnedDisplayMutation(element, targetState) {
  if (!element || !targetState.host.contains(element)) {
    return false;
  }
  return Boolean(
    element.closest(
      "#text, [role='text'], yt-formatted-string, #return-youtube-dislike-bar-container, #return-youtube-dislike-bar, .ryd-tooltip, [data-ryd-synthetic-shorts-dislike]",
    ),
  );
}

function mutationIsMeaningfulWatchRefresh(mutation, targetState, videoId, buttons) {
  if (suppressedStaleRefreshTargets.has(targetState.activationTarget)) {
    return false;
  }
  const mutationElement =
    mutation.target.nodeType === Node.ELEMENT_NODE ? mutation.target : mutation.target.parentElement;
  if (!mutationElement || !targetState.host.contains(mutationElement)) {
    return false;
  }

  if (mutation.type === "attributes") {
    if (["data-video-id", "video-id"].includes(mutation.attributeName)) {
      return activationTargetHasVideoIdentity(targetState.activationTarget, videoId, buttons);
    }
    return (
      ["aria-disabled", "aria-label", "disabled", "title"].includes(mutation.attributeName) &&
      (mutationElement === targetState.activationTarget || mutationElement === targetState.host)
    );
  }

  if (mutation.type !== "childList" || elementIsOwnedDisplayMutation(mutationElement, targetState)) {
    return false;
  }
  const changedElements = [...mutation.addedNodes, ...mutation.removedNodes]
    .map((node) => (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement))
    .filter(Boolean);
  return changedElements.some((element) => !elementIsOwnedDisplayMutation(element, targetState));
}

function captureMeaningfulWatchRefreshes(resetState, mutations, videoId, buttons) {
  for (const targetState of [resetState.like, resetState.dislike]) {
    if (
      !targetState.refreshed &&
      mutations.some((mutation) => mutationIsMeaningfulWatchRefresh(mutation, targetState, videoId, buttons))
    ) {
      targetState.refreshed = true;
    }
  }
}

function captureWatchNavigationBoundaryRefreshes(boundary, mutations) {
  for (const targetState of [boundary.like, boundary.dislike]) {
    if (
      !targetState.refreshed &&
      mutations.some((mutation) => mutationIsMeaningfulWatchRefresh(mutation, targetState, "", boundary.buttons))
    ) {
      targetState.refreshed = true;
    }
  }
}

function seedWatchTargetFromNavigationBoundary(targetState, boundaryTargetState, buttons, videoId) {
  if (targetState.activationTarget === boundaryTargetState.activationTarget) {
    targetState.refreshed ||= boundaryTargetState.refreshed;
    return;
  }

  const boundVideoId = boundActivationVideoIds.get(targetState.activationTarget);
  targetState.refreshed ||=
    !boundVideoId ||
    boundVideoId === videoId ||
    activationTargetHasVideoIdentity(targetState.activationTarget, videoId, buttons);
}

function seedWatchResetFromNavigationBoundary(resetState, buttons, videoId) {
  const boundary = pendingWatchNavigationBoundary;
  if (!boundary || boundary.sourceVideoId === videoId) {
    return;
  }

  captureWatchNavigationBoundaryRefreshes(boundary, boundary.observer.takeRecords());
  clearPendingWatchNavigationBoundary();
  if (boundary.buttons !== buttons) {
    return;
  }

  seedWatchTargetFromNavigationBoundary(resetState.like, boundary.like, buttons, videoId);
  seedWatchTargetFromNavigationBoundary(resetState.dislike, boundary.dislike, buttons, videoId);
}

function suppressStaleTargetRefresh(target) {
  suppressedStaleRefreshTargets.add(target);
  setTimeout(() => suppressedStaleRefreshTargets.delete(target), 0);
}

function watchControlsAreReadyForVideo(buttons, likeButton, dislikeButton, videoId) {
  if (!hasConflictingControlOwnership(buttons, videoId)) {
    clearPendingWatchControlObservers();
    if (pendingWatchNavigationBoundary?.sourceVideoId !== videoId) {
      clearPendingWatchNavigationBoundary();
    }
    return true;
  }

  // YouTube occasionally completes a watch-to-watch navigation while reusing
  // the exact same reaction-control nodes and without mutating anything inside
  // them. In that state the old per-node ownership is the only conflicting
  // signal, so waiting for a control mutation can never finish. A completed
  // navigation plus a matching current watch root is the route-level ownership
  // proof for this otherwise indistinguishable case.
  const watchRoot = buttons.closest("ytd-watch-flexy, ytd-watch-grid");
  if (
    pendingWatchNavigationBoundary?.completedVideoId === videoId &&
    pendingWatchNavigationBoundary.sourceVideoId !== videoId &&
    pendingWatchNavigationBoundary.buttons === buttons &&
    watchRoot?.getAttribute("video-id") === videoId &&
    getButtons() === buttons &&
    hasRenderedBox(buttons)
  ) {
    clearPendingWatchControlObservers();
    clearPendingWatchNavigationBoundary();
    return true;
  }

  const existingReset = pendingWatchControlResets.get(buttons);
  if (existingReset?.videoId === videoId) {
    seedWatchResetFromNavigationBoundary(existingReset, buttons, videoId);
    if (!originalWatchTargetsAreReady(existingReset, buttons, videoId)) {
      return false;
    }

    const currentLikeButton = getLikeButton();
    const currentDislikeButton = getDislikeButton();
    if (!currentLikeButton || !currentDislikeButton || getButtons() !== buttons) {
      return false;
    }
    const currentLikeTarget = getActivationTarget(currentLikeButton);
    const currentDislikeTarget = getActivationTarget(currentDislikeButton);
    if (
      !currentWatchTargetIsReady(currentLikeTarget, existingReset.like, buttons, videoId) ||
      !currentWatchTargetIsReady(currentDislikeTarget, existingReset.dislike, buttons, videoId)
    ) {
      return false;
    }

    existingReset.observer.disconnect();
    pendingWatchControlResets.delete(buttons);
    return true;
  }

  existingReset?.observer.disconnect();
  const likeActivationTarget = getActivationTarget(likeButton);
  const dislikeActivationTarget = getActivationTarget(dislikeButton);
  const resetState = {
    dislike: {
      activationTarget: dislikeActivationTarget,
      host: dislikeButton,
      refreshed: false,
    },
    like: {
      activationTarget: likeActivationTarget,
      host: likeButton,
      refreshed: false,
    },
    observer: null,
    videoId,
  };
  seedWatchResetFromNavigationBoundary(resetState, buttons, videoId);
  if (
    originalWatchTargetsAreReady(resetState, buttons, videoId) &&
    currentWatchTargetIsReady(likeActivationTarget, resetState.like, buttons, videoId) &&
    currentWatchTargetIsReady(dislikeActivationTarget, resetState.dislike, buttons, videoId)
  ) {
    pendingWatchControlResets.delete(buttons);
    return true;
  }
  const observer = new MutationObserver((mutations) => {
    captureMeaningfulWatchRefreshes(resetState, mutations, videoId, buttons);
    if (originalWatchTargetsAreReady(resetState, buttons, videoId)) {
      observer.disconnect();
      setEventListeners();
    }
  });
  resetState.observer = observer;
  pendingWatchControlResets.set(buttons, resetState);
  observer.observe(buttons, {
    attributeFilter: ["aria-disabled", "aria-label", "data-video-id", "disabled", "title", "video-id"],
    attributes: true,
    childList: true,
    subtree: true,
  });
  return false;
}

function getActiveDesktopShortsActionBar() {
  const videoId = getVideoId();
  const candidates = Array.from(document.querySelectorAll("ytd-reel-video-renderer"))
    .filter((renderer) => intersectsViewport(renderer))
    .map((renderer) => ({
      actionBar: renderer.querySelector("reel-action-bar-view-model"),
      renderer,
    }))
    .filter(({ actionBar }) => actionBar);

  const matchingCandidate = candidates.find(({ renderer }) => rendererMatchesShort(renderer, videoId));
  if (matchingCandidate) {
    return matchingCandidate.actionBar;
  }

  // During channel/watch -> Shorts SPA transitions, YouTube can render the active
  // reel before its video-id/link metadata is hydrated. A single visible reel is
  // still unambiguous; waiting for metadata in this state leaves the controls
  // permanently uninitialized on some page variants.
  if (
    candidates.length === 1 &&
    getRendererShortVideoIds(candidates[0].renderer).size === 0 &&
    !hasConflictingControlOwnership(candidates[0].actionBar, videoId)
  ) {
    return candidates[0].actionBar;
  }

  const fullyVisibleCandidates = candidates.filter(
    ({ actionBar, renderer }) =>
      isInViewport(renderer) &&
      getRendererShortVideoIds(renderer).size === 0 &&
      !hasConflictingControlOwnership(actionBar, videoId),
  );
  return fullyVisibleCandidates.length === 1 ? fullyVisibleCandidates[0].actionBar : null;
}

function getActiveMobileShortsButtons() {
  const videoId = getVideoId();
  const candidates = Array.from(document.querySelectorAll("ytm-like-button-renderer"))
    .filter((buttons) => isInViewport(buttons))
    .map((buttons) => ({ buttons, ...getMobileShortOwnership(buttons) }));

  const matchingCandidates = candidates.filter(({ identities }) => identities.has(videoId));
  if (matchingCandidates.length === 1) {
    return matchingCandidates[0].buttons;
  }

  if (
    candidates.length === 1 &&
    candidates[0].identities.size === 0 &&
    !hasConflictingControlOwnership(candidates[0].buttons, videoId)
  ) {
    return candidates[0].buttons;
  }
  return null;
}

function getExactShortLinkVideoIds(element) {
  const identities = new Set();
  for (const link of element.querySelectorAll('a[href*="/shorts/"]')) {
    try {
      const linkVideoId = getShortVideoIdFromPathname(new URL(link.getAttribute("href"), location.origin).pathname);
      if (linkVideoId) {
        identities.add(linkVideoId);
      }
    } catch {
      // Ignore malformed or incomplete links while YouTube hydrates the reel.
    }
  }
  return identities;
}

function getMobileShortOwnership(buttons) {
  const ancestors = [];
  let current = buttons;
  while (current && current !== document.body) {
    if (current.matches("ytm-shorts, ytm-shorts-container, #shorts-container, #shorts-inner-container")) {
      break;
    }
    ancestors.push(current);
    current = current.parentElement;
  }

  for (const ancestor of ancestors) {
    const attributeVideoId = ancestor.getAttribute("video-id") || ancestor.getAttribute("data-video-id");
    if (attributeVideoId) {
      return { identities: new Set([attributeVideoId]), owner: ancestor };
    }
  }

  for (const ancestor of ancestors) {
    const identities = getExactShortLinkVideoIds(ancestor);
    if (identities.size > 0) {
      return { identities, owner: ancestor };
    }
  }

  const owner =
    ancestors.find((ancestor) => ancestor.matches("ytm-reel-video-renderer, ytm-shorts-video-renderer")) ??
    ancestors.find((ancestor) => ancestor.matches("ytm-reel-player-overlay-renderer")) ??
    buttons;
  return { identities: new Set(), owner };
}

function getDesktopWatchButtonCandidates() {
  return Array.from(
    new Set(
      document.querySelectorAll(
        "#menu-container #top-level-buttons-computed, ytd-menu-renderer.ytd-watch-metadata > div, ytd-menu-renderer.ytd-video-primary-info-renderer > div",
      ),
    ),
  ).filter((candidate) =>
    candidate.querySelector(
      "segmented-like-dislike-button-view-model, ytd-segmented-like-dislike-button-renderer, like-button-view-model, #segmented-like-button",
    ),
  );
}

function selectCurrentWatchButtons(candidates) {
  const videoId = getVideoId();
  return (
    candidates
      .map((candidate, index) => {
        const watchRoot = candidate.closest("ytd-watch-flexy, ytd-watch-grid");
        const rootVideoId = watchRoot?.getAttribute("video-id");
        const rootMatches = Boolean(videoId && rootVideoId === videoId);
        const rendered = hasRenderedBox(candidate);
        const inViewport = rendered && intersectsViewport(candidate);
        const conflicts = Boolean(videoId && hasConflictingControlOwnership(candidate, videoId));
        // YouTube can retain several button groups under the same current
        // ytd-watch-flexy while an SPA navigation settles. A matching root is
        // therefore useful ownership evidence, but it must never make a
        // hidden stale group outrank the rendered controls the user can see.
        const tier =
          rootMatches && inViewport && !conflicts
            ? 10
            : rootMatches && inViewport
              ? 9
              : inViewport && !conflicts
                ? 8
                : inViewport
                  ? 7
                  : rootMatches && rendered && !conflicts
                    ? 6
                    : rootMatches && rendered
                      ? 5
                      : rendered && !conflicts
                        ? 4
                        : rendered
                          ? 3
                          : rootMatches && !conflicts
                            ? 2
                            : !conflicts
                              ? 1
                              : 0;
        return { candidate, index, tier };
      })
      .sort((left, right) => right.tier - left.tier || left.index - right.index)[0]?.candidate ?? null
  );
}

// iOS fix: if m.youtube.com renames its action-bar classes, find the
// like/dislike pair through the button elements themselves.
function getMobileWatchButtonsFallback() {
  const scope =
    document.querySelector("ytm-slim-video-action-bar-renderer") ??
    document.querySelector("ytm-slim-video-metadata-section-renderer") ??
    document.querySelector("ytm-watch");
  if (!scope) {
    return null;
  }
  const segmented = scope.querySelector(
    "segmented-like-dislike-button-view-model, ytm-segmented-like-dislike-button-renderer",
  );
  if (segmented) {
    return segmented.parentElement;
  }
  const like = scope.querySelector("like-button-view-model");
  return like?.parentElement ?? null;
}

function getButtons() {
  if (isShorts()) {
    if (!isMobile) {
      const actionBar = getActiveDesktopShortsActionBar();
      if (actionBar) {
        return actionBar;
      }
    } else {
      const buttons = getActiveMobileShortsButtons();
      if (buttons) {
        return buttons;
      }
    }

    // Never bind watch/channel controls that are still connected while a Shorts
    // SPA route is mounting. The initialization retry loop will pick up the real
    // reel controls as soon as they are available.
    return null;
  }
  if (isMobile) {
    return (
      document.querySelector(".slim-video-action-bar-actions .segmented-buttons") ??
      document.querySelector(".slim-video-action-bar-actions") ??
      getMobileWatchButtonsFallback()
    );
  }
  return selectCurrentWatchButtons(getDesktopWatchButtonCandidates());
}

function removeSyntheticShortsDislike(syntheticDislike) {
  if (!syntheticDislike || removingSyntheticShortsDislikes.has(syntheticDislike)) {
    return;
  }
  removingSyntheticShortsDislikes.add(syntheticDislike);
  try {
    syntheticDislike.remove();
  } finally {
    removingSyntheticShortsDislikes.delete(syntheticDislike);
  }
}

function ensureSyntheticShortsDislikeButton(buttons) {
  if (!isShorts() || isMobile || !buttons) {
    return;
  }

  const syntheticDislike = buttons.querySelector(SYNTHETIC_SHORTS_DISLIKE_SELECTOR);
  const nativeDislike = buttons.querySelector("dislike-button-view-model, #dislike-button");
  if (nativeDislike) {
    removeSyntheticShortsDislike(syntheticDislike);
    return;
  }
  if (syntheticDislike) {
    const videoId = getVideoId();
    if (videoId && syntheticDislike.getAttribute("data-ryd-video-id") !== videoId) {
      syntheticDislike.setAttribute("data-ryd-video-id", videoId);
      setSyntheticShortsPressed(false, syntheticDislike);
      const button = syntheticDislike.querySelector("button");
      if (button) {
        button.disabled = true;
        button.setAttribute("aria-disabled", "true");
      }
      const count = syntheticDislike.querySelector("#text, [role='text']");
      if (count) {
        count.textContent = "";
      }
    }
    return;
  }

  const likeButton = buttons.querySelector("like-button-view-model");
  const nativeLikeButton = likeButton?.querySelector("button");
  if (!likeButton || !nativeLikeButton) {
    return;
  }

  const ownedDislike = document.createElement("div");
  ownedDislike.className = likeButton.getAttribute("class") || "";
  ownedDislike.setAttribute("data-ryd-synthetic-shorts-dislike", "true");
  ownedDislike.setAttribute("data-ryd-role", "dislike");
  ownedDislike.setAttribute("data-ryd-video-id", getVideoId());
  ownedDislike.classList.add("ryd-synthetic-shorts-dislike");

  const button = document.createElement("button");
  button.type = "button";
  button.className = nativeLikeButton.className;
  button.setAttribute("aria-label", "Dislike this video");
  button.setAttribute("aria-pressed", "false");
  button.setAttribute("aria-disabled", "true");
  button.disabled = true;

  const icon = document.createElement("div");
  icon.className =
    nativeLikeButton.querySelector(".ytSpecButtonShapeNextIcon")?.getAttribute("class") || "ytSpecButtonShapeNextIcon";
  icon.setAttribute("aria-hidden", "true");
  const svgNamespace = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNamespace, "svg");
  svg.setAttribute("height", "24");
  svg.setAttribute("viewBox", "0 0 18 18");
  svg.setAttribute("width", "24");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(svgNamespace, "path");
  path.setAttribute("d", SHORTS_DISLIKE_ICON_PATH);
  svg.appendChild(path);
  icon.appendChild(svg);

  const countContainer = document.createElement("div");
  countContainer.className =
    likeButton.querySelector(".ytSpecButtonShapeWithLabelLabel")?.className || "ytSpecButtonShapeWithLabelLabel";
  const count = document.createElement("span");
  count.id = "text";
  count.className =
    likeButton.querySelector('span[role="text"]')?.className ||
    "ytAttributedStringHost ytAttributedStringTextAlignmentCenter";
  count.setAttribute("role", "text");
  countContainer.appendChild(count);
  button.appendChild(icon);
  const buttonAndCount = document.createElement("label");
  buttonAndCount.className = nativeLikeButton.closest("label")?.className || "ytSpecButtonShapeWithLabelHost";
  buttonAndCount.classList.add("ryd-synthetic-shorts-dislike-label");
  buttonAndCount.append(button, countContainer);
  ownedDislike.appendChild(buttonAndCount);
  setSyntheticShortsPressed(false, ownedDislike);
  likeButton.insertAdjacentElement("afterend", ownedDislike);
}

function getDislikeButton() {
  const buttons = getButtons();
  ensureSyntheticShortsDislikeButton(buttons);
  if (buttons?.tagName === "REEL-ACTION-BAR-VIEW-MODEL") {
    return (
      buttons.querySelector("dislike-button-view-model, #dislike-button") ??
      buttons.querySelector(SYNTHETIC_SHORTS_DISLIKE_SELECTOR)
    );
  }
  const firstButton = ownChildren(buttons)[0];
  if (!firstButton) {
    return null;
  }

  if (firstButton.tagName === "YTD-SEGMENTED-LIKE-DISLIKE-BUTTON-RENDERER") {
    if (firstButton.children[1] === undefined) {
      return buttons.querySelector("#segmented-dislike-button");
    } else {
      return firstButton.children[1];
    }
  } else {
    if (buttons.querySelector("segmented-like-dislike-button-view-model")) {
      const dislikeViewModel = buttons.querySelector("dislike-button-view-model");
      if (!dislikeViewModel) cLog("Dislike button wasn't added to DOM yet...");
      return dislikeViewModel;
    } else {
      // Suite: YouTube's 2026 mobile watch page puts the channel avatar and
      // the Subscribe button in the same row as like/dislike. The upstream
      // "second child of the row" guess then pointed at Subscribe, and its
      // label was overwritten with the dislike count. Find the dislike
      // control by name, else take the control right after the like button.
      const named = buttons.querySelector("dislike-button-view-model, ytm-dislike-button-renderer, #dislike-button");
      if (named) {
        return named;
      }
      const likeControl = getLikeButton();
      if (likeControl?.matches?.("like-button-view-model, ytm-like-button-renderer, #like-button")) {
        let next = likeControl.nextElementSibling;
        while (next?.hasAttribute("data-ioss-owned")) {
          next = next.nextElementSibling;
        }
        if (next) {
          return next;
        }
      }
      return isMobile ? null : ownChildren(buttons)[1] ?? null;
    }
  }
}

// Suite: the downloader puts its button in front of the like button. Skip
// elements the suite owns so the like/dislike buttons are still found by
// position.
function ownChildren(buttons) {
  return Array.from(buttons?.children ?? []).filter((child) => !child.hasAttribute("data-ioss-owned"));
}

function getLikeButton() {
  const buttons = getButtons();
  const firstButton = ownChildren(buttons)[0];
  if (!firstButton) {
    return null;
  }

  if (firstButton.tagName === "YTD-SEGMENTED-LIKE-DISLIKE-BUTTON-RENDERER") {
    return buttons.querySelector("#segmented-like-button") !== null
      ? buttons.querySelector("#segmented-like-button")
      : firstButton.children[0];
  }
  // Suite: on mobile the first item of the row can be the channel avatar,
  // so only accept a control that is actually a like button there.
  const namedLike = buttons.querySelector("like-button-view-model, ytm-like-button-renderer, #like-button");
  return namedLike ?? (isMobile ? null : firstButton);
}

function getLikeTextContainer() {
  // Suite: null-safe (threw when YouTube had not rendered the button yet).
  const likeButton = getLikeButton();
  if (!likeButton) return null;
  return (
    likeButton.querySelector("#text") ??
    likeButton.getElementsByTagName("yt-formatted-string")[0] ??
    likeButton.querySelector("span[role='text']")
  );
}

function getDislikeTextContainer() {
  const dislikeButton = getDislikeButton();
  let result =
    dislikeButton?.querySelector("#text") ??
    dislikeButton?.getElementsByTagName("yt-formatted-string")[0] ??
    dislikeButton?.querySelector("span[role='text']");
  // Suite: null-safe (crashed when the dislike button had no <button>).
  const nativeDislikeButton = dislikeButton?.querySelector("button");
  if (result === null && nativeDislikeButton) {
    let textSpan = document.createElement("span");
    textSpan.id = "text";
    textSpan.style.marginLeft = "6px";
    nativeDislikeButton.appendChild(textSpan);
    nativeDislikeButton.style.width = "auto";
    result = textSpan;
  }
  return result;
}

function setSyntheticShortsPressed(pressed, dislikeButton = getDislikeButton()) {
  if (!dislikeButton?.matches(SYNTHETIC_SHORTS_DISLIKE_SELECTOR)) {
    return;
  }
  dislikeButton.classList.toggle("style-default-active", pressed);
  dislikeButton.classList.toggle("style-text", !pressed);
  dislikeButton.querySelector("button")?.setAttribute("aria-pressed", String(pressed));
}

function persistSyntheticShortsState(videoId, disliked) {
  void syntheticDislikeStore.setDisliked(videoId, disliked).catch(reportVoteFailure);
}

async function readSyntheticShortsDisliked(videoId) {
  try {
    return await syntheticDislikeStore.isDisliked(videoId);
  } catch (error) {
    reportVoteFailure(error);
    return false;
  }
}

async function restoreSyntheticShortsState(
  videoId,
  dislikeButton = getDislikeButton(),
  initialVisibleState = getState(),
) {
  if (!dislikeButton?.matches(SYNTHETIC_SHORTS_DISLIKE_SELECTOR)) {
    return false;
  }

  const disliked = await readSyntheticShortsDisliked(videoId);

  return {
    disliked,
    submittedState: initialVisibleState === LIKED_STATE ? LIKED_STATE : disliked ? DISLIKED_STATE : initialVisibleState,
  };
}

function createObserver(options, callback) {
  const observerWrapper = new Object();
  observerWrapper.options = options;
  observerWrapper.observer = new MutationObserver(callback);
  observerWrapper.observe = function (element) {
    this.observer.observe(element, this.options);
  };
  observerWrapper.disconnect = function () {
    this.observer.disconnect();
  };
  return observerWrapper;
}

let shortsObserver = null;

function getShortsObserver() {
  if (shortsObserver) {
    return shortsObserver;
  }
  cLog("Initializing shorts mutation observer");
  shortsObserver = createObserver(
    {
      attributes: true,
      attributeFilter: ["aria-pressed"],
    },
    (mutationList) => {
      mutationList.forEach((mutation) => {
        if (mutation.type === "attributes") {
          cLog("Short thumb button status changed");
          if (mutation.target.getAttribute("aria-pressed") === "true") {
            mutation.target.style.color = mutation.target.closest("like-button-view-model")
              ? getColorFromTheme(true)
              : getColorFromTheme(false);
          } else {
            mutation.target.style.color = "unset";
          }
        }
      });
    },
  );
  return shortsObserver;
}

function isVideoLiked() {
  const likeButton = getLikeButton();
  const nativeButton = likeButton?.querySelector("button");
  if (isMobile) {
    return nativeButton?.getAttribute("aria-pressed") === "true" || nativeButton?.getAttribute("aria-label") === "true";
  }
  return (
    likeButton?.classList.contains("style-default-active") || nativeButton?.getAttribute("aria-pressed") === "true"
  );
}

function isVideoDisliked() {
  const dislikeButton = getDislikeButton();
  const nativeButton = dislikeButton?.querySelector("button");
  if (isMobile) {
    return nativeButton?.getAttribute("aria-pressed") === "true" || nativeButton?.getAttribute("aria-label") === "true";
  }
  return (
    dislikeButton?.classList.contains("style-default-active") || nativeButton?.getAttribute("aria-pressed") === "true"
  );
}

function isVideoNotLiked() {
  if (isMobile) {
    return !isVideoLiked();
  }
  return getLikeButton()?.classList.contains("style-text");
}

function isVideoNotDisliked() {
  if (isMobile) {
    return !isVideoDisliked();
  }
  return getDislikeButton()?.classList.contains("style-text");
}

function isSignedOut() {
  const signInLink = document.querySelector("a[href^='https://accounts.google.com/ServiceLogin']");
  return signInLink !== null || (!isMobile && document.querySelector("#avatar-btn") === null);
}

function getState() {
  if (isVideoLiked()) {
    return LIKED_STATE;
  }
  if (isVideoDisliked()) {
    return DISLIKED_STATE;
  }
  return NEUTRAL_STATE;
}

function setLikes(likesCount) {
  if (isMobile) {
    // iOS fix: the old ".button-renderer-text" class no longer exists on
    // every mobile layout; writing to it threw an error.
    const likeText =
      getLikeButton()?.querySelector(".button-renderer-text") ??
      getLikeButton()?.querySelector("#text, span[role='text']");
    if (likeText) {
      likeText.innerText = likesCount;
    }
    return;
  }
  const container = getLikeTextContainer();
  if (container) {
    container.innerText = likesCount;
  }
}

function setDislikes(dislikesCount) {
  if (isMobile) {
    mobileDislikes = dislikesCount;
    writeMobileDislikes();
    return;
  }

  const _container = getDislikeTextContainer();
  if (!_container) {
    return;
  }
  _container.removeAttribute("is-empty");
  if (_container.innerText !== dislikesCount) {
    _container.innerText = dislikesCount;
  }
}

function getLikeCountFromButton() {
  try {
    if (isShorts()) {
      //Youtube Shorts don't work with this query. It's not necessary; we can skip it and still see the results.
      //It should be possible to fix this function, but it's not critical to showing the dislike count.
      return false;
    }
    let likeButton =
      getLikeButton().querySelector("yt-formatted-string#text") ?? getLikeButton().querySelector("button");

    let likesStr = likeButton.getAttribute("aria-label").replace(/\D/g, "");
    return likesStr.length > 0 ? parseInt(likesStr) : false;
  } catch {
    return false;
  }
}

api.addStyle(`
    #return-youtube-dislike-bar-container {
      background: #737373;
      background: color-mix(
        in srgb,
        var(--yt-spec-text-primary, #f1f1f1) 55%,
        var(--yt-spec-base-background, #0f0f0f) 45%
      );
      border-radius: 2px;
    }

    #return-youtube-dislike-bar {
      background: var(--yt-spec-text-primary);
      border-radius: 2px;
      transition: all 0.15s ease-in-out;
    }

    .ryd-synthetic-shorts-dislike svg {
      display: block;
      fill: currentColor;
      height: 24px;
      pointer-events: none;
      width: 24px;
    }

    .ryd-synthetic-shorts-dislike {
      box-sizing: content-box;
      display: block;
      flex: 0 0 auto;
      height: 70px;
      margin: 0 !important;
      padding: 0 0 8px;
      width: 100%;
    }

    .ryd-synthetic-shorts-dislike-label {
      align-items: center;
      display: flex;
      flex-direction: column;
    }

    .ryd-synthetic-shorts-dislike .ytSpecButtonShapeNextIcon {
      flex: 0 0 24px;
      height: 24px;
      min-width: 24px;
      width: 24px;
    }

    .ryd-synthetic-shorts-dislike button {
      color: inherit;
      cursor: pointer;
    }

    .ryd-synthetic-shorts-dislike button[aria-pressed="true"] {
      color: var(--yt-spec-call-to-action, #3ea6ff);
    }

    .ryd-tooltip {
      bottom: -10px;
      display: block;
      height: 2px;
      outline: none;
      position: absolute;
    }

    .ryd-tooltip-bar-container {
      width: 100%;
      height: 2px;
      position: absolute;
      padding-top: 6px;
      padding-bottom: 12px;
      top: -6px;
    }

    .ryd-tooltip-label {
      background: rgba(28, 28, 28, 0.96);
      border-radius: 4px;
      bottom: 10px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
      box-sizing: border-box;
      color: #fff;
      font-family: Roboto, Arial, sans-serif;
      font-size: 12px;
      font-weight: 500;
      line-height: 16px;
      max-width: calc(100vw - 24px);
      opacity: 0;
      overflow: hidden;
      padding: 6px 8px;
      pointer-events: none;
      position: absolute;
      right: 0;
      text-overflow: ellipsis;
      transform: translateY(4px);
      transition: opacity 0.12s ease-out, transform 0.12s ease-out, visibility 0s linear 0.12s;
      visibility: hidden;
      white-space: nowrap;
      width: max-content;
      z-index: 2200;
    }

    .ryd-tooltip:hover .ryd-tooltip-label,
    .ryd-tooltip:focus-within .ryd-tooltip-label {
      opacity: 1;
      transform: translateY(0);
      transition-delay: 0s;
      visibility: visible;
    }

    .ryd-tooltip:focus-visible .ryd-tooltip-bar-container {
      outline: 2px solid var(--yt-spec-call-to-action, #3ea6ff);
      outline-offset: 2px;
    }

    ytd-menu-renderer.ytd-watch-metadata {
      overflow-y: visible !important;
    }

    #top-level-buttons-computed {
      position: relative !important;
    }
  `);

function createRateBar(likes, dislikes) {
  if (isMobile || isShorts() || !extConfig.rateBarEnabled) {
    return;
  }

  const buttons = getButtons();
  const likeButton = getLikeButton();
  const dislikeButton = getDislikeButton();
  if (!buttons || !likeButton) {
    return;
  }

  // YouTube retains the outgoing watch metadata tree during some SPA
  // transitions. A document-wide ID lookup can therefore find the old bar,
  // update it with the new video's counts, and then lose it when YouTube
  // removes that stale tree. Keep the single owned bar scoped to the active
  // reaction controls instead.
  for (const candidate of document.querySelectorAll("#return-youtube-dislike-bar-container")) {
    if (!buttons.contains(candidate)) {
      (candidate.closest(".ryd-tooltip") ?? candidate).remove();
    }
  }
  let rateBar = buttons.querySelector("#return-youtube-dislike-bar-container");
  if (rateBar && !watchRateBarIsHealthy(buttons, getVideoId())) {
    removeWatchRateBarArtifacts(buttons);
    rateBar = null;
  }

  const widthPx = likeButton.clientWidth + (dislikeButton?.clientWidth ?? 52);

  const widthPercent = likes + dislikes > 0 ? (likes / (likes + dislikes)) * 100 : 50;

  var likePercentage = parseFloat(widthPercent.toFixed(1));
  const dislikePercentage = (100 - likePercentage).toLocaleString();
  likePercentage = likePercentage.toLocaleString();

  const separator = "\u00a0/\u00a0";
  const percentageSeparator = "\u00a0\u00a0-\u00a0\u00a0";
  let tooltipText;
  switch (extConfig.tooltipPercentageMode) {
    case "dash_like":
      tooltipText = `${likes.toLocaleString()}${separator}${dislikes.toLocaleString()}${percentageSeparator}${likePercentage}%`;
      break;
    case "dash_dislike":
      tooltipText = `${likes.toLocaleString()}${separator}${dislikes.toLocaleString()}${percentageSeparator}${dislikePercentage}%`;
      break;
    case "both":
      tooltipText = `${likePercentage}%${separator}${dislikePercentage}%`;
      break;
    case "only_like":
      tooltipText = `${likePercentage}%`;
      break;
    case "only_dislike":
      tooltipText = `${dislikePercentage}%`;
      break;
    default:
      tooltipText = `${likes.toLocaleString()}${separator}${dislikes.toLocaleString()}`;
  }

  if (!rateBar && !isMobile) {
    const tooltip = document.createElement("div");
    tooltip.className = "ryd-tooltip";
    tooltip.setAttribute("data-ryd-rate-bar-wrapper", "true");
    tooltip.setAttribute("data-ryd-video-id", getVideoId());
    tooltip.style.width = `${widthPx}px`;
    tooltip.setAttribute("aria-describedby", "ryd-dislike-tooltip");
    tooltip.setAttribute("tabindex", "0");

    const tooltipBarContainer = document.createElement("div");
    tooltipBarContainer.className = "ryd-tooltip-bar-container";

    rateBar = document.createElement("div");
    rateBar.id = "return-youtube-dislike-bar-container";
    rateBar.style.width = "100%";
    rateBar.style.height = "2px";

    const rateBarFill = document.createElement("div");
    rateBarFill.id = "return-youtube-dislike-bar";
    rateBarFill.style.width = `${widthPercent}%`;
    rateBarFill.style.height = "100%";
    if (extConfig.coloredBar) {
      rateBar.style.backgroundColor = getColorFromTheme(false);
      rateBarFill.style.backgroundColor = getColorFromTheme(true);
    }
    rateBar.appendChild(rateBarFill);
    tooltipBarContainer.appendChild(rateBar);

    const tooltipLabel = document.createElement("div");
    tooltipLabel.id = "ryd-dislike-tooltip";
    tooltipLabel.className = "ryd-tooltip-label";
    tooltipLabel.setAttribute("role", "tooltip");
    tooltipLabel.textContent = tooltipText;

    tooltip.append(tooltipBarContainer, tooltipLabel);
    buttons.appendChild(tooltip);
    const descriptionAndActionsElement = buttons.closest("#top-row");
    if (descriptionAndActionsElement) {
      descriptionAndActionsElement.style.borderBottom = "1px solid var(--yt-spec-10-percent-layer)";
      descriptionAndActionsElement.style.paddingBottom = "10px";
    }
  } else {
    const tooltip = rateBar.closest(".ryd-tooltip");
    const rateBarFill = rateBar.querySelector("#return-youtube-dislike-bar");
    if (!tooltip || !rateBarFill) {
      (tooltip ?? rateBar).remove();
      createRateBar(likes, dislikes);
      return;
    }
    tooltip.setAttribute("data-ryd-video-id", getVideoId());
    tooltip.style.width = widthPx + "px";
    rateBarFill.style.width = widthPercent + "%";
    const tooltipLabel = tooltip.querySelector("#ryd-dislike-tooltip");
    if (tooltipLabel) {
      tooltipLabel.textContent = tooltipText;
    }

    if (extConfig.coloredBar) {
      rateBar.style.backgroundColor = getColorFromTheme(false);
      rateBarFill.style.backgroundColor = getColorFromTheme(true);
    }
  }
}

function elementTouchesWatchRateBar(element) {
  return Boolean(
    element?.matches?.(
      ".ryd-tooltip, .ryd-tooltip-bar-container, .ryd-tooltip-label, #return-youtube-dislike-bar-container, #return-youtube-dislike-bar, #ryd-dislike-tooltip",
    ) ||
      element?.matches?.('[data-ryd-rate-bar-wrapper="true"]') ||
      element?.closest?.(".ryd-tooltip, .ryd-tooltip-bar-container, #return-youtube-dislike-bar-container") ||
      element?.querySelector?.(
        ".ryd-tooltip, .ryd-tooltip-bar-container, .ryd-tooltip-label, #return-youtube-dislike-bar-container, #return-youtube-dislike-bar, #ryd-dislike-tooltip",
      ),
  );
}

function mutationTouchesWatchRateBar(mutation) {
  if (mutation.type === "attributes") {
    return elementTouchesWatchRateBar(mutation.target);
  }
  return (
    mutation.type === "childList" &&
    [...mutation.addedNodes, ...mutation.removedNodes].some(
      (node) => node.nodeType === Node.ELEMENT_NODE && elementTouchesWatchRateBar(node),
    )
  );
}

function watchRateBarIsHealthy(buttons, videoId) {
  if (!buttons || !videoId) {
    return false;
  }

  const wrappers = Array.from(buttons.querySelectorAll('[data-ryd-rate-bar-wrapper="true"]'));
  const containers = Array.from(buttons.querySelectorAll("#return-youtube-dislike-bar-container"));
  const fills = Array.from(buttons.querySelectorAll("#return-youtube-dislike-bar"));
  const labels = Array.from(buttons.querySelectorAll("#ryd-dislike-tooltip"));
  if (wrappers.length !== 1 || containers.length !== 1 || fills.length !== 1 || labels.length !== 1) {
    return false;
  }

  const [wrapper] = wrappers;
  const [container] = containers;
  const [fill] = fills;
  const [label] = labels;
  if (
    wrapper.parentElement !== buttons ||
    !wrapper.matches(".ryd-tooltip") ||
    wrapper.getAttribute("data-ryd-video-id") !== videoId ||
    !wrapper.contains(container) ||
    !container.contains(fill) ||
    !wrapper.contains(label) ||
    !hasRenderedBox(wrapper) ||
    !hasRenderedBox(container)
  ) {
    return false;
  }

  const fillStyle = getComputedStyle(fill);
  const fillBounds = fill.getBoundingClientRect();
  return (
    fillStyle.display !== "none" &&
    fillStyle.visibility !== "hidden" &&
    fillStyle.visibility !== "collapse" &&
    Number.parseFloat(fillStyle.opacity) !== 0 &&
    fillBounds.height > 0
  );
}

function removeWatchRateBarArtifacts(buttons) {
  if (!buttons) {
    return;
  }

  for (const wrapper of buttons.querySelectorAll('.ryd-tooltip, [data-ryd-rate-bar-wrapper="true"]')) {
    wrapper.remove();
  }
  for (const fragment of buttons.querySelectorAll(
    ".ryd-tooltip-bar-container, .ryd-tooltip-label, #return-youtube-dislike-bar-container, #return-youtube-dislike-bar, #ryd-dislike-tooltip",
  )) {
    fragment.remove();
  }
}

function clearStaleWatchPresentation(buttons, dislikeButton, videoId) {
  if (isMobile || isShorts() || !initializedVideoId || initializedVideoId === videoId) {
    return;
  }

  removeWatchRateBarArtifacts(buttons);
  const dislikeText =
    dislikeButton?.querySelector("#text") ??
    dislikeButton?.getElementsByTagName("yt-formatted-string")[0] ??
    dislikeButton?.querySelector("span[role='text']");
  if (dislikeText) {
    dislikeText.textContent = "";
  }
}

function canRepairWatchRateBar(buttons, videoId) {
  if (
    isMobile ||
    isShorts() ||
    !extConfig.rateBarEnabled ||
    !videoId ||
    !countStateLoaded ||
    countStateVideoId !== videoId ||
    initializedVideoId !== videoId ||
    getVideoId() !== videoId ||
    !buttons?.isConnected ||
    getButtons() !== buttons ||
    !hasRenderedBox(buttons)
  ) {
    return false;
  }

  const likeButton = getLikeButton();
  const dislikeButton = getDislikeButton();
  return (
    likeButton === initializedLikeButton &&
    dislikeButton === initializedDislikeButton &&
    buttons.contains(likeButton) &&
    buttons.contains(dislikeButton) &&
    !watchRateBarIsHealthy(buttons, videoId)
  );
}

function repairWatchRateBar(buttons = getButtons(), videoId = getVideoId()) {
  if (canRepairWatchRateBar(buttons, videoId)) {
    removeWatchRateBarArtifacts(buttons);
    createRateBar(likesvalue, dislikesvalue);
  }
}

function scheduleWatchRateBarRepair() {
  if (watchRateBarRepairTimer !== null) {
    return;
  }
  watchRateBarRepairTimer = setTimeout(() => {
    watchRateBarRepairTimer = null;
    repairWatchRateBar(watchRateBarObserverTarget, watchRateBarObserverVideoId);
  }, 0);
}

function disconnectWatchRateBarObserver() {
  watchRateBarObserver?.disconnect();
  watchRateBarObserver = null;
  watchRateBarObserverTarget = null;
  watchRateBarObserverVideoId = null;
  if (watchRateBarRepairTimer !== null) {
    clearTimeout(watchRateBarRepairTimer);
    watchRateBarRepairTimer = null;
  }
}

function observeWatchRateBar(buttons, videoId) {
  if (isMobile || isShorts() || !extConfig.rateBarEnabled || !buttons) {
    disconnectWatchRateBarObserver();
    return;
  }

  if (watchRateBarObserverTarget === buttons) {
    watchRateBarObserverVideoId = videoId;
    return;
  }

  disconnectWatchRateBarObserver();
  watchRateBarObserverTarget = buttons;
  watchRateBarObserverVideoId = videoId;
  watchRateBarObserver = new MutationObserver((mutations) => {
    if (mutations.some(mutationTouchesWatchRateBar)) {
      scheduleWatchRateBarRepair();
    }
  });
  watchRateBarObserver.observe(buttons, {
    attributeFilter: ["aria-hidden", "class", "hidden", "inert", "style"],
    attributes: true,
    childList: true,
    subtree: true,
  });
}

function setState() {
  const videoId = getVideoId();
  previousState = getState();
  if (countStateVideoId === videoId && (activeCountRequest?.videoId === videoId || countStateLoaded)) {
    updateDOMDislikes();
    refreshFormattedLikes();
    return;
  }
  if (countStateVideoId !== videoId) {
    likesvalue = 0;
    dislikesvalue = 0;
    countStateVideoId = videoId;
    countStateLoaded = false;
    countStateEpoch += 1;
  }
  const countRequest = {
    dislikesDelta: 0,
    likesDelta: 0,
    videoId,
  };
  activeCountRequest = countRequest;
  cLog("Fetching votes...");

  fetchImpl(`${API_BASE_URL}/votes?videoId=${videoId}`)
    .then((response) => response.json())
    .then((json) => {
      if (getVideoId() !== videoId || activeCountRequest !== countRequest) {
        return;
      }
      if (json && !("traceId" in json)) {
        const { dislikes, likes } = json;
        cLog(`Received count: ${dislikes}`);
        likesvalue = Math.max(0, likes + countRequest.likesDelta);
        dislikesvalue = Math.max(0, dislikes + countRequest.dislikesDelta);
        countStateLoaded = true;
        setDislikes(numberFormat(dislikesvalue));
        if (extConfig.numberDisplayReformatLikes === true) {
          const nativeLikes = getLikeCountFromButton();
          if (nativeLikes !== false) {
            setLikes(numberFormat(nativeLikes));
          }
        }
        createRateBar(likesvalue, dislikesvalue);
        if (extConfig.coloredThumbs === true) {
          const dislikeButton = getDislikeButton();
          if (isShorts()) {
            // for shorts, leave deactived buttons in default color
            const shortLikeButton = getLikeButton()?.querySelector("button, tp-yt-paper-button#button");
            const shortDislikeButton = dislikeButton?.querySelector("button, tp-yt-paper-button#button");
            if (shortLikeButton?.getAttribute("aria-pressed") === "true") {
              shortLikeButton.style.color = getColorFromTheme(true);
            }
            if (shortDislikeButton?.getAttribute("aria-pressed") === "true") {
              shortDislikeButton.style.color = getColorFromTheme(false);
            }
            const observer = getShortsObserver();
            if (shortLikeButton) observer.observe(shortLikeButton);
            if (shortDislikeButton) observer.observe(shortDislikeButton);
          } else {
            const likeButtonForColor = getLikeButton();
            if (likeButtonForColor) likeButtonForColor.style.color = getColorFromTheme(true);
            if (dislikeButton) dislikeButton.style.color = getColorFromTheme(false);
          }
        }
      }
    })
    .catch((error) => cLog("Fetching votes failed", error instanceof Error ? error.message : String(error)))
    .finally(() => {
      if (activeCountRequest === countRequest) {
        activeCountRequest = null;
      }
    });
}

function updateDOMDislikes() {
  setDislikes(numberFormat(dislikesvalue));
  createRateBar(likesvalue, dislikesvalue);
}

function reportVoteFailure(error) {
  const message = error instanceof Error ? error.message : String(error);
  cLog("Vote submission failed", message);
}

function refreshFormattedLikes() {
  if (extConfig.numberDisplayReformatLikes !== true) {
    return;
  }

  const nativeLikes = getLikeCountFromButton();
  if (nativeLikes !== false) {
    setLikes(numberFormat(nativeLikes));
  }
}

function getVoteStateCounts(state) {
  return {
    dislikes: state === DISLIKED_STATE ? 1 : 0,
    likes: state === LIKED_STATE ? 1 : 0,
  };
}

function getShortsCountTransition(videoId, transition) {
  if (!isShorts() || shortsSubmittedStateVideoId !== videoId) {
    return transition;
  }
  const previousCounts = getVoteStateCounts(shortsSubmittedState);
  const nextCounts = getVoteStateCounts(transition.nextState);
  return {
    ...transition,
    dislikesDelta: nextCounts.dislikes - previousCounts.dislikes,
    likesDelta: nextCounts.likes - previousCounts.likes,
  };
}

function applyCountTransition(videoId, countTransition) {
  const counts = applyVoteTransitionCounts(likesvalue, dislikesvalue, countTransition);
  if (activeCountRequest?.videoId === videoId) {
    activeCountRequest.likesDelta += countTransition.likesDelta;
    activeCountRequest.dislikesDelta += countTransition.dislikesDelta;
  }
  likesvalue = counts.likes;
  dislikesvalue = counts.dislikes;
}

function applyVoteTransition(videoId, transition, syntheticShortsDislike) {
  const countTransition = getShortsCountTransition(videoId, transition);
  applyCountTransition(videoId, countTransition);
  previousState = transition.nextState;
  if (syntheticShortsDislike) {
    setSyntheticShortsPressed(previousState === DISLIKED_STATE);
  }
  if (isShorts()) {
    shortsSubmittedStateVideoId = videoId;
    shortsSubmittedState = previousState;
    persistSyntheticShortsState(videoId, previousState === DISLIKED_STATE);
  }
  updateDOMDislikes();
  refreshFormattedLikes();
}

function applyHydratingVoteTransition(hydration, transition, syntheticShortsDislike) {
  applyCountTransition(hydration.videoId, transition);
  previousState = transition.nextState;
  if (syntheticShortsDislike) {
    setSyntheticShortsPressed(previousState === DISLIKED_STATE);
  }
  updateDOMDislikes();
  refreshFormattedLikes();
}

function reconcileHydratingVoteTransition(hydration, transition, syntheticShortsDislike) {
  const submittedCountTransition = getShortsCountTransition(hydration.videoId, transition);
  if (transition.optimisticCountStateEpoch === countStateEpoch) {
    applyCountTransition(hydration.videoId, {
      ...transition,
      dislikesDelta: submittedCountTransition.dislikesDelta - transition.dislikesDelta,
      likesDelta: submittedCountTransition.likesDelta - transition.likesDelta,
    });
  }
  previousState = transition.nextState;
  shortsSubmittedStateVideoId = hydration.videoId;
  shortsSubmittedState = previousState;
  persistSyntheticShortsState(hydration.videoId, previousState === DISLIKED_STATE);
  if (syntheticShortsDislike) {
    setSyntheticShortsPressed(previousState === DISLIKED_STATE);
  }
}

function submitVoteTransition(videoId, transition, signedOut) {
  if (shouldSubmitVote({ disableVoteSubmission: extConfig.disableVoteSubmission, signedOut })) {
    void voteClient.submitVote(videoId, transition.value).catch(reportVoteFailure);
  }
}

function clearNativeLikeForSyntheticDislike(action, stateBeforeActivation, syntheticShortsDislike) {
  if (!syntheticShortsDislike || action !== DISLIKE_ACTION || stateBeforeActivation !== LIKED_STATE) {
    return;
  }

  const nativeLikeButton = getLikeButton()?.querySelector("button");
  if (nativeLikeButton && isVideoLiked()) {
    suppressNextLikeActivation = true;
    try {
      nativeLikeButton.click();
    } finally {
      suppressNextLikeActivation = false;
    }
  }
}

function handleVoteActivation(action) {
  const signedOut = isSignedOut();
  if (signedOut) {
    return;
  }

  const videoId = getVideoId();
  if (!videoId) {
    return;
  }

  const transition = resolveVoteTransition(previousState, action);
  const syntheticShortsDislike = getDislikeButton()?.matches(SYNTHETIC_SHORTS_DISLIKE_SELECTOR) === true;
  clearNativeLikeForSyntheticDislike(action, previousState, syntheticShortsDislike);
  applyVoteTransition(videoId, transition, syntheticShortsDislike);
  submitVoteTransition(videoId, transition, signedOut);
}

function captureHydratingShortsActivation(event, action) {
  const hydration = hydratingShortsActivationTargets.get(event.currentTarget);
  if (!hydration) {
    return false;
  }
  if (hydration.videoId !== getVideoId()) {
    return true;
  }

  const signedOut = isSignedOut();
  const syntheticShortsDislike = getDislikeButton()?.matches(SYNTHETIC_SHORTS_DISLIKE_SELECTOR) === true;
  if (!signedOut) {
    clearNativeLikeForSyntheticDislike(action, hydration.visibleState, syntheticShortsDislike);
  }
  const transition = {
    ...resolveVoteTransition(hydration.visibleState, action),
    optimisticCountStateEpoch: countStateEpoch,
  };
  hydration.visibleState = transition.nextState;
  if (!signedOut) {
    hydration.activations.push(transition);
    applyHydratingVoteTransition(hydration, transition, syntheticShortsDislike);
    submitVoteTransition(hydration.videoId, transition, signedOut);
  }
  return true;
}

function likeClicked(event) {
  if (suppressNextLikeActivation) {
    return;
  }
  if (boundActivationVideoIds.get(event.currentTarget) !== getVideoId()) {
    suppressStaleTargetRefresh(event.currentTarget);
    return;
  }
  if (captureHydratingShortsActivation(event, LIKE_ACTION)) {
    return;
  }
  handleVoteActivation(LIKE_ACTION);
}

function dislikeClicked(event) {
  if (boundActivationVideoIds.get(event.currentTarget) !== getVideoId()) {
    suppressStaleTargetRefresh(event.currentTarget);
    return;
  }
  if (captureHydratingShortsActivation(event, DISLIKE_ACTION)) {
    return;
  }
  handleVoteActivation(DISLIKE_ACTION);
}

function refreshDislikesForBoundControl(event) {
  if (boundActivationVideoIds.get(event.currentTarget) === getVideoId()) {
    updateDOMDislikes();
  }
}

function getVideoId() {
  const urlObject = new URL(window.location.href);
  const pathname = urlObject.pathname;
  if (pathname.startsWith("/clip")) {
    return (document.querySelector("meta[itemprop='videoId']") || document.querySelector("meta[itemprop='identifier']"))
      ?.content;
  } else {
    const shortVideoId = getShortVideoIdFromPathname(pathname);
    if (shortVideoId) {
      return shortVideoId;
    }
    return urlObject.searchParams.get("v");
  }
}

function isVideoLoaded() {
  if (isMobile) {
    // iOS fix: don't depend only on the "loading" attribute of #player;
    // also accept a present <video> element in the mobile player.
    return (
      document.getElementById("player")?.getAttribute("loading") == "false" ||
      document.querySelector("#player video, ytm-player video, #player-container-id video, video.html5-main-video") !==
        null
    );
  }
  const videoId = getVideoId();

  return (
    // desktop: spring 2024 UI
    document.querySelector(`ytd-watch-grid[video-id='${videoId}']`) !== null ||
    // desktop: older UI
    document.querySelector(`ytd-watch-flexy[video-id='${videoId}']`) !== null ||
    // mobile: no video-id attribute
    document.querySelector('#player[loading="false"]:not([hidden])') !== null
  );
}

function roundDown(num) {
  if (num < 1000) return num;
  const int = Math.floor(Math.log10(num) - 2);
  const decimal = int + (int % 3 ? 1 : 0);
  const value = Math.floor(num / 10 ** decimal);
  return value * 10 ** decimal;
}

function numberFormat(numberState) {
  let numberDisplay;
  if (extConfig.numberDisplayRoundDown === false) {
    numberDisplay = numberState;
  } else {
    numberDisplay = roundDown(numberState);
  }
  return getNumberFormatter(extConfig.numberDisplayFormat).format(numberDisplay);
}

function getNumberFormatter(optionSelect) {
  let userLocales;
  if (document.documentElement.lang) {
    userLocales = document.documentElement.lang;
  } else if (navigator.language) {
    userLocales = navigator.language;
  } else {
    try {
      userLocales = new URL(
        Array.from(document.querySelectorAll("head > link[rel='search']"))
          ?.find((n) => n?.getAttribute("href")?.includes("?locale="))
          ?.getAttribute("href"),
      )?.searchParams?.get("locale");
    } catch {
      cLog("Cannot find browser locale. Use en as default for number formatting.");
      userLocales = "en";
    }
  }

  let formatterNotation;
  let formatterCompactDisplay;
  switch (optionSelect) {
    case "compactLong":
      formatterNotation = "compact";
      formatterCompactDisplay = "long";
      break;
    case "standard":
      formatterNotation = "standard";
      formatterCompactDisplay = "short";
      break;
    case "compactShort":
    default:
      formatterNotation = "compact";
      formatterCompactDisplay = "short";
  }

  const formatter = Intl.NumberFormat(userLocales, {
    notation: formatterNotation,
    compactDisplay: formatterCompactDisplay,
  });
  return formatter;
}

function getColorFromTheme(voteIsLike) {
  let colorString;
  switch (extConfig.colorTheme) {
    case "accessible":
      if (voteIsLike === true) {
        colorString = "dodgerblue";
      } else {
        colorString = "gold";
      }
      break;
    case "neon":
      if (voteIsLike === true) {
        colorString = "aqua";
      } else {
        colorString = "magenta";
      }
      break;
    case "classic":
    default:
      if (voteIsLike === true) {
        colorString = "lime";
      } else {
        colorString = "red";
      }
  }
  return colorString;
}

let smartimationObserver = null;
let initializedVideoId = null;
let initializedButtons = null;
let initializedLikeButton = null;
let initializedDislikeButton = null;
let lifecyclePageKey = null;

const SHORTS_RENDERER_SELECTOR =
  "ytd-reel-video-renderer, ytm-reel-video-renderer, ytm-shorts-video-renderer, ytm-reel-player-overlay-renderer";
const SHORTS_CONTROL_SELECTOR = `like-button-view-model, dislike-button-view-model, ${SYNTHETIC_SHORTS_DISLIKE_SELECTOR}`;

function getShortsRenderer(element) {
  if (!element || element.nodeType !== Node.ELEMENT_NODE) {
    return null;
  }
  return element.matches(SHORTS_RENDERER_SELECTOR) ? element : element.closest?.(SHORTS_RENDERER_SELECTOR) ?? null;
}

function rendererOwnsCurrentShort(renderer) {
  if (!renderer) {
    return false;
  }
  return (
    renderer.hasAttribute("is-active") ||
    rendererMatchesShort(renderer, getVideoId()) ||
    (initializedLikeButton && renderer.contains(initializedLikeButton)) ||
    (initializedDislikeButton && renderer.contains(initializedDislikeButton))
  );
}

function elementTouchesCurrentShortRenderer(element) {
  const containingRenderer = getShortsRenderer(element);
  if (containingRenderer) {
    return rendererOwnsCurrentShort(containingRenderer);
  }
  return Array.from(element?.querySelectorAll?.(SHORTS_RENDERER_SELECTOR) ?? []).some(rendererOwnsCurrentShort);
}

function mutationTouchesShortsControls(mutation) {
  if (mutation.type === "attributes") {
    if (mutation.attributeName === "is-active" && mutation.target.matches(SHORTS_RENDERER_SELECTOR)) {
      return true;
    }
    if (
      (mutation.target.matches(SHORTS_RENDERER_SELECTOR) || mutation.target.matches("a")) &&
      elementTouchesCurrentShortRenderer(mutation.target)
    ) {
      return true;
    }
    return false;
  }
  if (mutation.type !== "childList") {
    return false;
  }
  const changedElements = [...mutation.addedNodes, ...mutation.removedNodes].filter(
    (node) => node.nodeType === Node.ELEMENT_NODE,
  );
  if (
    changedElements.some(
      (node) =>
        node.matches(`reel-action-bar-view-model, ${SHORTS_CONTROL_SELECTOR}`) ||
        node.querySelector?.(`reel-action-bar-view-model, ${SHORTS_CONTROL_SELECTOR}`),
    )
  ) {
    return [mutation.target, ...changedElements].some(elementTouchesCurrentShortRenderer);
  }
  return (
    mutation.target.closest?.(SHORTS_CONTROL_SELECTOR) &&
    elementTouchesCurrentShortRenderer(mutation.target) &&
    changedElements.some(
      (node) =>
        node.matches("button, tp-yt-paper-button#button") || node.querySelector?.("button, tp-yt-paper-button#button"),
    )
  );
}

function shortsControlsNeedInitialization() {
  const videoId = getVideoId();
  if (!isShorts() || !videoId) {
    return false;
  }

  const buttons = getButtons();
  const likeButton = getLikeButton();
  const dislikeButton = getDislikeButton();
  if (!buttons || !likeButton || !dislikeButton) {
    return true;
  }
  if (
    initializedVideoId !== videoId ||
    initializedLikeButton !== likeButton ||
    initializedDislikeButton !== dislikeButton
  ) {
    return true;
  }

  return (
    boundActivationVideoIds.get(getActivationTarget(likeButton)) !== videoId ||
    boundActivationVideoIds.get(getActivationTarget(dislikeButton)) !== videoId
  );
}

function disconnectShortsLifecycleObserver() {
  shortsLifecycleObserver?.disconnect();
  shortsLifecycleObserverTarget = null;
}

function observeShortsLifecycle(buttons) {
  if (!isShorts() || !buttons) {
    disconnectShortsLifecycleObserver();
    return;
  }
  clearPendingWatchControlObservers();

  const isDesktopActionBar = buttons.tagName === "REEL-ACTION-BAR-VIEW-MODEL";
  const isMobileActionBar = isMobile && buttons.tagName === "YTM-LIKE-BUTTON-RENDERER";
  if (!isDesktopActionBar && !isMobileActionBar) {
    disconnectShortsLifecycleObserver();
    return;
  }

  const renderer = isMobileActionBar
    ? buttons.closest("ytm-reel-video-renderer, ytm-shorts-video-renderer") ?? getMobileShortOwnership(buttons).owner
    : buttons.closest("ytd-reel-video-renderer") ?? buttons;
  const observerTarget =
    renderer.closest(
      "ytd-shorts, ytd-shorts-container, ytm-shorts, ytm-shorts-container, #shorts-container, #shorts-inner-container",
    ) ??
    renderer.parentElement ??
    document.body;
  if (shortsLifecycleObserverTarget === observerTarget) {
    return;
  }
  disconnectShortsLifecycleObserver();
  shortsLifecycleObserver = new MutationObserver((mutations) => {
    if (mutations.some(mutationTouchesShortsControls) && shortsControlsNeedInitialization()) {
      setEventListeners();
    }
  });
  shortsLifecycleObserver.observe(observerTarget, {
    attributeFilter: ["href", "is-active", "video-id"],
    attributes: true,
    childList: true,
    subtree: true,
  });
  shortsLifecycleObserverTarget = observerTarget;
}

function getActivationTarget(control) {
  if (control.matches("button, tp-yt-paper-button#button")) {
    return control;
  }
  return control.querySelector("button, tp-yt-paper-button#button") ?? control;
}

function beginShortsHydration(videoId, likeButton, dislikeButton, initialVisibleState) {
  const previousCompletion = shortsHydrationTails.get(videoId) ?? Promise.resolve();
  let resolveCompletion;
  const completion = new Promise((resolve) => {
    resolveCompletion = resolve;
  });
  const hydration = {
    activations: [],
    completion,
    initialVisibleState,
    previousCompletion,
    resolveCompletion,
    videoId,
    visibleState: initialVisibleState,
  };
  shortsHydrationTails.set(videoId, completion);
  hydratingShortsActivationTargets.set(getActivationTarget(likeButton), hydration);
  hydratingShortsActivationTargets.set(getActivationTarget(dislikeButton), hydration);
  return hydration;
}

function finishShortsHydration(hydration, likeButton, dislikeButton) {
  for (const target of [getActivationTarget(likeButton), getActivationTarget(dislikeButton)]) {
    if (hydratingShortsActivationTargets.get(target) === hydration) {
      hydratingShortsActivationTargets.delete(target);
    }
  }
  if (shortsHydrationTails.get(hydration.videoId) === hydration.completion) {
    shortsHydrationTails.delete(hydration.videoId);
  }
  hydration.resolveCompletion();
}

function persistFinalHydratingActivation(hydration) {
  const finalActivation = hydration.activations[hydration.activations.length - 1];
  if (finalActivation) {
    persistSyntheticShortsState(hydration.videoId, finalActivation.nextState === DISLIKED_STATE);
  }
}

function reconcileStaleShortsHydration(hydration, submittedState, storedDisliked) {
  if (getVideoId() !== hydration.videoId || hydration.activations.length === 0) {
    persistFinalHydratingActivation(hydration);
    return;
  }

  const currentDislikeButton = getDislikeButton();
  if (!currentDislikeButton) {
    persistFinalHydratingActivation(hydration);
    return;
  }

  applyHydratedShortsState(hydration, submittedState, currentDislikeButton, storedDisliked);
}

function applyHydratedShortsState(hydration, submittedState, dislikeButton, storedDisliked) {
  const syntheticShortsDislike = dislikeButton.matches(SYNTHETIC_SHORTS_DISLIKE_SELECTOR);
  shortsSubmittedStateVideoId = hydration.videoId;
  shortsSubmittedState = submittedState;

  if (hydration.activations.length === 0) {
    previousState = syntheticShortsDislike ? submittedState : hydration.initialVisibleState;
    if (syntheticShortsDislike) {
      setSyntheticShortsPressed(submittedState === DISLIKED_STATE, dislikeButton);
    }
    if (hydration.initialVisibleState === LIKED_STATE && storedDisliked) {
      persistSyntheticShortsState(hydration.videoId, false);
    }
    return;
  }

  for (const transition of hydration.activations) {
    reconcileHydratingVoteTransition(hydration, transition, syntheticShortsDislike);
  }
  updateDOMDislikes();
  refreshFormattedLikes();
}

function bindVoteButtonListeners(likeButton, dislikeButton, { enableSynthetic = true } = {}) {
  const likeActivationTarget = getActivationTarget(likeButton);
  const dislikeActivationTarget = getActivationTarget(dislikeButton);
  const videoId = getVideoId();
  boundActivationVideoIds.set(likeActivationTarget, videoId);
  boundActivationVideoIds.set(dislikeActivationTarget, videoId);
  if (!boundLikeButtons.has(likeActivationTarget)) {
    likeActivationTarget.addEventListener("click", likeClicked);
    boundLikeButtons.add(likeActivationTarget);
  }
  if (!boundDislikeButtons.has(dislikeActivationTarget)) {
    dislikeActivationTarget.addEventListener("click", dislikeClicked);
    dislikeActivationTarget.addEventListener("focusin", refreshDislikesForBoundControl);
    dislikeActivationTarget.addEventListener("focusout", refreshDislikesForBoundControl);
    boundDislikeButtons.add(dislikeActivationTarget);
  }
  if (enableSynthetic && dislikeButton.matches(SYNTHETIC_SHORTS_DISLIKE_SELECTOR)) {
    dislikeActivationTarget.disabled = false;
    dislikeActivationTarget.setAttribute("aria-disabled", "false");
  }
}

async function initializeCurrentButtons(generation) {
  const videoId = getVideoId();
  if (!videoId) {
    // Channel/search/home pages have no video controls to initialize. The
    // lightweight lifecycle monitor will restart initialization when a video
    // route appears, instead of polling the whole page every 111 ms forever.
    return true;
  }

  if (!(isShorts() || (hasRenderedBox(getButtons()) && isVideoLoaded()))) {
    return false;
  }

  const buttons = getButtons();
  const likeButton = getLikeButton();
  const dislikeButton = getDislikeButton();
  if (!buttons || !likeButton || !dislikeButton) {
    return false;
  }
  if (!isShorts() && !watchControlsAreReadyForVideo(buttons, likeButton, dislikeButton, videoId)) {
    return false;
  }

  observeShortsLifecycle(buttons);
  observeWatchRateBar(buttons, videoId);
  const stateNeedsInitialization =
    initializedVideoId !== videoId ||
    initializedButtons !== buttons ||
    initializedLikeButton !== likeButton ||
    initializedDislikeButton !== dislikeButton;
  if (stateNeedsInitialization) {
    clearStaleWatchPresentation(buttons, dislikeButton, videoId);
    initializedVideoId = videoId;
    initializedButtons = buttons;
    initializedLikeButton = likeButton;
    initializedDislikeButton = dislikeButton;
    setState();
  }

  if (isShorts()) {
    const initialVisibleState = getState();
    const likeActivationTarget = getActivationTarget(likeButton);
    const dislikeActivationTarget = getActivationTarget(dislikeButton);
    const existingLikeHydration = hydratingShortsActivationTargets.get(likeActivationTarget);
    const existingDislikeHydration = hydratingShortsActivationTargets.get(dislikeActivationTarget);
    if (
      existingLikeHydration &&
      existingLikeHydration === existingDislikeHydration &&
      existingLikeHydration.videoId === videoId
    ) {
      return false;
    }
    const hydration = beginShortsHydration(videoId, likeButton, dislikeButton, initialVisibleState);
    bindVoteButtonListeners(likeButton, dislikeButton, { enableSynthetic: false });
    let storedDisliked;
    let submittedState;
    try {
      await hydration.previousCompletion;
      if (dislikeButton.matches(SYNTHETIC_SHORTS_DISLIKE_SELECTOR)) {
        const restored = await restoreSyntheticShortsState(videoId, dislikeButton, initialVisibleState);
        if (!restored) {
          persistFinalHydratingActivation(hydration);
          return false;
        }
        storedDisliked = restored.disliked;
        submittedState = restored.submittedState;
      } else {
        storedDisliked = await readSyntheticShortsDisliked(videoId);
        submittedState =
          initialVisibleState === LIKED_STATE ? LIKED_STATE : storedDisliked ? DISLIKED_STATE : initialVisibleState;
      }

      if (
        generation !== initializationGeneration ||
        getVideoId() !== videoId ||
        getLikeButton() !== likeButton ||
        getDislikeButton() !== dislikeButton
      ) {
        reconcileStaleShortsHydration(hydration, submittedState, storedDisliked);
        return false;
      }

      applyHydratedShortsState(hydration, submittedState, dislikeButton, storedDisliked);
      bindVoteButtonListeners(likeButton, dislikeButton);
    } finally {
      finishShortsHydration(hydration, likeButton, dislikeButton);
    }
  } else {
    if (
      generation !== initializationGeneration ||
      getVideoId() !== videoId ||
      getLikeButton() !== likeButton ||
      getDislikeButton() !== dislikeButton
    ) {
      return false;
    }
    bindVoteButtonListeners(likeButton, dislikeButton);
  }

  if (!smartimationObserver) {
    smartimationObserver = createObserver(
      {
        attributes: true,
        subtree: true,
        childList: true,
      },
      updateDOMDislikes,
    );
    smartimationObserver.container = null;
  }

  const smartimationContainer = buttons.querySelector("yt-smartimation");
  if (smartimationContainer && smartimationObserver.container != smartimationContainer) {
    cLog("Initializing smartimation mutation observer");
    smartimationObserver.disconnect();
    smartimationObserver.observe(smartimationContainer);
    smartimationObserver.container = smartimationContainer;
  }

  return true;
}

function setEventListeners(evt) {
  const generation = ++initializationGeneration;
  let checkRunning = false;
  if (initializationTimer) {
    clearInterval(initializationTimer);
  }

  async function checkForJSFinish() {
    if (generation !== initializationGeneration || checkRunning) {
      return;
    }
    checkRunning = true;
    try {
      const initialized = await initializeCurrentButtons(generation);
      if (initialized && generation === initializationGeneration) {
        clearInterval(initializationTimer);
        initializationTimer = null;
      }
    } catch (error) {
      reportVoteFailure(error);
    } finally {
      checkRunning = false;
    }
  }

  cLog("Setting up...");
  // Suite: poll quickly at first, then back off, and skip ticks while the
  // tab is hidden. The original polled at 9 Hz forever on pages where the
  // buttons never appear (e.g. members-only or age-gated videos).
  const setupStarted = Date.now();
  initializationTimer = setInterval(() => {
    if (document.hidden) return;
    const elapsed = Date.now() - setupStarted;
    if (elapsed > 10000 && elapsed < 60000 && Math.floor(elapsed / 111) % 5 !== 0) return;
    if (elapsed >= 60000 && Math.floor(elapsed / 111) % 18 !== 0) return;
    void checkForJSFinish();
  }, 111);
  void checkForJSFinish();
}

function getLifecyclePageKey() {
  const videoId = getVideoId();
  if (!videoId) {
    return null;
  }
  return `${isShorts() ? "shorts" : "watch"}:${videoId}`;
}

function watchControlsNeedReinitialization() {
  // iOS fix: also re-bind on m.youtube.com when YouTube re-renders the buttons
  if (isShorts() || initializationTimer !== null) {
    return false;
  }

  const videoId = getVideoId();
  if (!videoId || initializedVideoId !== videoId) {
    return false;
  }

  const buttons = getButtons();
  const likeButton = getLikeButton();
  const dislikeButton = getDislikeButton();
  return (
    !initializedButtons?.isConnected ||
    buttons !== initializedButtons ||
    likeButton !== initializedLikeButton ||
    dislikeButton !== initializedDislikeButton ||
    !initializedLikeButton?.isConnected ||
    !initializedDislikeButton?.isConnected ||
    !buttons?.contains(initializedLikeButton) ||
    !buttons?.contains(initializedDislikeButton)
  );
}

function checkPageLifecycle() {
  const pageKey = getLifecyclePageKey();
  if (pageKey !== lifecyclePageKey) {
    lifecyclePageKey = pageKey;
    if (!isShorts()) {
      disconnectShortsLifecycleObserver();
      if (!pageKey) {
        clearPendingWatchControlObservers();
      }
    }
    setEventListeners();
    return;
  }
  if (watchControlsNeedReinitialization()) {
    setEventListeners();
    return;
  }
  repairWatchRateBar();
}

function handleNavigateStart() {
  disconnectWatchRateBarObserver();
  clearPendingWatchNavigationBoundary();
  clearPendingWatchControlObservers();
  if (isShorts()) {
    return;
  }

  const buttons = getButtons();
  const likeButton = getLikeButton();
  const dislikeButton = getDislikeButton();
  if (!buttons || !likeButton || !dislikeButton) {
    return;
  }

  const likeActivationTarget = getActivationTarget(likeButton);
  const dislikeActivationTarget = getActivationTarget(dislikeButton);
  const likeVideoId = boundActivationVideoIds.get(likeActivationTarget);
  const dislikeVideoId = boundActivationVideoIds.get(dislikeActivationTarget);
  if (
    !likeVideoId ||
    likeVideoId !== dislikeVideoId ||
    likeVideoId !== getVideoId() ||
    !buttons.contains(likeActivationTarget) ||
    !buttons.contains(dislikeActivationTarget)
  ) {
    return;
  }

  const boundary = {
    buttons,
    completedVideoId: null,
    dislike: {
      activationTarget: dislikeActivationTarget,
      host: dislikeButton,
      refreshed: false,
    },
    like: {
      activationTarget: likeActivationTarget,
      host: likeButton,
      refreshed: false,
    },
    observer: null,
    sourceVideoId: likeVideoId,
  };
  const observer = new MutationObserver((mutations) => {
    captureWatchNavigationBoundaryRefreshes(boundary, mutations);
  });
  boundary.observer = observer;
  pendingWatchNavigationBoundary = boundary;
  observer.observe(buttons, {
    attributeFilter: ["aria-disabled", "aria-label", "data-video-id", "disabled", "title", "video-id"],
    attributes: true,
    childList: true,
    subtree: true,
  });
}

function handleNavigateFinish(event) {
  lifecyclePageKey = getLifecyclePageKey();
  if (isShorts()) {
    clearPendingWatchControlObservers();
    clearPendingWatchNavigationBoundary();
  } else {
    disconnectShortsLifecycleObserver();
    const videoId = getVideoId();
    if (pendingWatchNavigationBoundary && videoId !== pendingWatchNavigationBoundary.sourceVideoId) {
      pendingWatchNavigationBoundary.completedVideoId = videoId;
    }
    if (!getVideoId()) {
      clearPendingWatchControlObservers();
      clearPendingWatchNavigationBoundary();
    }
  }
  setEventListeners(event);
}

(function () {
  "use strict";
  void voteClient.ensureRegistered().catch(reportVoteFailure);
  window.addEventListener("yt-navigate-start", handleNavigateStart, true);
  window.addEventListener("yt-navigate-finish", handleNavigateFinish, true);
  window.addEventListener("popstate", checkPageLifecycle, true);
  lifecyclePageKey = getLifecyclePageKey();
  api.every(500, checkPageLifecycle);
  setEventListeners();
})();
if (isMobile) {
  // iOS fix: write the count every 500 ms (YouTube's mobile site re-renders
  // the buttons often), only once the real count has loaded, and never
  // throw when the buttons aren't on the page.
  api.every(500, writeMobileDislikes);
}

function writeMobileDislikes() {
  try {
    if (!countStateLoaded || countStateVideoId !== getVideoId()) {
      return;
    }
    const dislikeButton = getDislikeButton();
    if (!dislikeButton) {
      return;
    }
    const target = dislikeButton.querySelector(".button-renderer-text") ?? getDislikeTextContainer();
    if (target && target.innerText !== String(mobileDislikes)) {
      target.innerText = mobileDislikes;
    }
  } catch (error) {
    cLog("Mobile dislike update failed", error instanceof Error ? error.message : String(error));
  }
}
  }
})
