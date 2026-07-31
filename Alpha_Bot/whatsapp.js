const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const fs = require('fs');
const path = require('path');

const AUTH_PATH = './.wwebjs_auth';
// Settings file lives INSIDE the auth folder so it rides the same persistent
// volume (mounted at /app/.wwebjs_auth on the server) — survives redeploys.
const SETTINGS_PATH = path.join(AUTH_PATH, 'bot-settings.json');

// Persist the user-configurable settings (not runtime/session fields) to JSON.
function saveSettings() {
  try {
    if (!fs.existsSync(AUTH_PATH)) fs.mkdirSync(AUTH_PATH, { recursive: true });
    const data = {
      selectedGroups: state.selectedGroups,
      uniqueMemberCount: state.uniqueMemberCount,
      adminGroupId: state.adminGroupId,
      delaySeconds: state.delaySeconds,
    };
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('Failed to save settings:', e.message);
  }
}

// Load saved settings into state at startup (if the file exists).
function loadSettings() {
  try {
    if (!fs.existsSync(SETTINGS_PATH)) return;
    const data = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
    if (Array.isArray(data.selectedGroups)) state.selectedGroups = data.selectedGroups;
    if (typeof data.uniqueMemberCount === 'number') state.uniqueMemberCount = data.uniqueMemberCount;
    if ('adminGroupId' in data) state.adminGroupId = data.adminGroupId;
    if (typeof data.delaySeconds === 'number') state.delaySeconds = data.delaySeconds;
    console.log('Loaded saved settings from', SETTINGS_PATH);
  } catch (e) {
    console.error('Failed to load settings:', e.message);
  }
}

// Remove stale Chromium "Singleton*" lock files left behind when a previous
// container/process didn't shut down cleanly (e.g. on redeploy). Without this,
// Chromium refuses to launch with "profile appears to be in use".
function clearChromeLocks(dir) {
  try {
    for (const entry of fs.readdirSync(dir)) {
      const full = path.join(dir, entry);
      let stat;
      try { stat = fs.lstatSync(full); } catch { continue; }
      if (stat.isDirectory()) {
        clearChromeLocks(full); // recurse — lock files live in session subfolders
      } else if (entry.startsWith('Singleton')) {
        try {
          fs.rmSync(full, { force: true });
          console.log('Removed stale Chromium lock:', full);
        } catch (e) {
          console.error('Could not remove lock', full, e.message);
        }
      }
    }
  } catch (e) {
    // Auth dir may not exist yet on first run — that's fine.
  }
}

// Shared state accessible by routes
const state = {
  qrCodeDataUrl: null,
  isReady: false,
  isInitializing: false,
  selectedGroups: [],   // array of { id, name, memberCount, memberIds }
  uniqueMemberCount: 0,  // de-duplicated member count across selected groups
  adminGroupId: null,   // group ID that triggers auto-forward
  schedules: [],        // array of scheduled jobs
  delaySeconds: 3,      // admin-configurable extra delay between group actions
};

// WhatsApp Web's July 2026 update minified the WID property `_serialized` to
// `$1`. whatsapp-web.js reads `id._serialized` throughout, so it now gets
// undefined and throws minified errors ("r") out of the page bundle. Pinning a
// web version does NOT help — every current build carries the rename. The fix
// is the shim installed below (see installSerializedShim).
// Upstream: wwebjs/whatsapp-web.js#201862, PR #201871 (unmerged as of Aug 2026).

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: AUTH_PATH }),
  authTimeoutMs: 0, // disable auth timeout — wait as long as needed for QR scan
  puppeteer: {
    headless: true,
    // Use a system-installed Chrome if PUPPETEER_EXECUTABLE_PATH is set;
    // otherwise fall back to Puppeteer's downloaded Chrome.
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu',
    ],
  },
});

client.on('qr', async (qr) => {
  state.isReady = false;
  try {
    state.qrCodeDataUrl = await qrcode.toDataURL(qr);
  } catch (e) {
    console.error('QR generation failed:', e.message);
  }
  console.log('QR code ready — scan it on the admin panel.');
});

// Restore `_serialized` on the WID/MsgKey prototypes as a getter aliasing the
// new `$1` property. Defining it on the prototype (rather than rewriting keys)
// leaves the underlying objects untouched, which matters because WhatsApp uses
// them for E2E decryption. Safe to run repeatedly: it no-ops when `_serialized`
// already exists, so an older web build is unaffected.
async function installSerializedShim() {
  try {
    const result = await client.pupPage.evaluate(() => {
      const patched = [];
      const candidates = [
        ['MsgKey', 'WAWebMsgKey'],
        ['Wid', 'WAWebWid'],
      ];

      for (const [label, moduleName] of candidates) {
        let proto;
        try {
          const mod = window.require(moduleName);
          proto = (mod?.default || mod?.[label] || mod)?.prototype;
        } catch { continue; }

        if (proto && !('_serialized' in proto)) {
          Object.defineProperty(proto, '_serialized', {
            get() { return this.$1; },
            configurable: true,
          });
          patched.push(label);
        }
      }
      return { patched, version: window.Debug?.VERSION || 'unknown' };
    });

    console.log(
      result.patched.length
        ? `Applied _serialized→$1 shim to: ${result.patched.join(', ')} (WA Web ${result.version}).`
        : `No _serialized shim needed (WA Web ${result.version}).`
    );
  } catch (err) {
    console.error('Could not install _serialized shim:', err.message);
  }
}

client.on('ready', async () => {
  state.qrCodeDataUrl = null;
  console.log('WhatsApp client is ready.');

  await installSerializedShim();

  // Verify the store actually works before serving requests. If this fails the
  // bot cannot do anything useful, so say so loudly rather than letting it
  // surface later as an unexplained "r".
  try {
    const chats = await client.getChats();
    state.isReady = true;
    console.log(`Chat store OK — ${chats.length} chats.`);
  } catch (err) {
    state.isReady = true; // still allow the UI in, routes report the failure
    console.error(`Chat store UNAVAILABLE: ${err.message}`);
    await diagnoseStore();
  }
});

// Puppeteer serialises a page-side Error down to its (minified) .name, which is
// why these failures only ever show up as "r". Re-run the same lookups inside
// the page and hand back plain strings so the real message and stack survive.
async function diagnoseStore() {
  try {
    const report = await client.pupPage.evaluate(async () => {
      const out = {
        actualWebVersion: window.Debug?.VERSION || 'unknown',
        hasRequire: typeof window.require === 'function',
        hasWWebJS: typeof window.WWebJS !== 'undefined',
        modules: {},
        chatsError: null,
        widShape: 'unknown',
      };

      // Confirm whether this build carries the _serialized→$1 rename.
      try {
        const wid = window.require('WAWebWidFactory').createWid('0@c.us');
        out.widShape =
          `_serialized=${typeof wid._serialized} $1=${typeof wid.$1} ` +
          `keys=[${Object.keys(wid).slice(0, 8).join(',')}]`;
      } catch (e) {
        out.widShape = `probe threw ${e.name}: ${e.message}`;
      }

      for (const name of [
        'WAWebCollections',
        'WAWebChatGetters',
        'WAWebWidFactory',
        'WAWebFindChatAction',
      ]) {
        try {
          const mod = window.require(name);
          out.modules[name] = mod ? `ok (keys: ${Object.keys(mod).slice(0, 6).join(',')})` : 'resolved to null/undefined';
        } catch (e) {
          out.modules[name] = `THREW ${e.name}: ${e.message}`;
        }
      }

      try {
        await window.WWebJS.getChats();
        out.chatsError = 'none — getChats() succeeded here';
      } catch (e) {
        out.chatsError = `${e.name}: ${e.message}\n${e.stack}`;
      }

      return out;
    });

    console.error('─── Store diagnostic ───');
    console.error('Actual WhatsApp Web version in page:', report.actualWebVersion);
    console.error('window.require present:', report.hasRequire, '| window.WWebJS present:', report.hasWWebJS);
    console.error('WID shape:', report.widShape);
    for (const [name, status] of Object.entries(report.modules)) {
      console.error(`  ${name}: ${status}`);
    }
    console.error('getChats() inside page:', report.chatsError);
    console.error('────────────────────────');
  } catch (e) {
    console.error('Diagnostic itself failed:', e.message);
  }
}

client.on('authenticated', () => {
  console.log('WhatsApp authenticated.');
});

client.on('auth_failure', (msg) => {
  console.error('WhatsApp auth failure:', msg);
  state.isReady = false;
});

client.on('disconnected', (reason) => {
  console.log('WhatsApp disconnected:', reason);
  state.isReady = false;
  state.isInitializing = false;
  state.qrCodeDataUrl = null;
  // Wait for Chrome to release file locks, then reinitialize
  setTimeout(() => {
    console.log('Reinitializing WhatsApp client...');
    clearChromeLocks(AUTH_PATH); // clear stale locks before relaunching Chromium
    client.initialize().catch((err) => {
      console.error('Reinitialization failed:', err.message);
    });
  }, 5000);
});

// Prevent unhandled promise rejections (e.g. locked session files) from crashing the process
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection (ignored):', reason?.message || reason);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception (ignored):', err.message);
});

// Guards against overlapping forward loops. A full pass over ~80 groups takes
// several minutes, so without this a busy admin group starts multiple loops
// that interleave on the single Puppeteer page.
let forwardInProgress = false;

// Auto-forward listener: messages arriving in the admin source group
client.on('message', async (message) => {
  if (!state.adminGroupId) return;
  if (message.from !== state.adminGroupId) return;
  if (state.selectedGroups.length === 0) return;

  if (forwardInProgress) {
    console.warn('Forward already running — skipping this message.');
    return;
  }
  forwardInProgress = true;

  let sent = 0;
  let failed = 0;
  try {
    let media = null;
    if (message.hasMedia) {
      media = await message.downloadMedia();
    }

    for (const group of state.selectedGroups) {
      if (group.id === state.adminGroupId) continue; // don't echo back

      // The client can disconnect and reinitialize mid-loop; sending into the
      // destroyed page throws a minified error ("r") once per remaining group.
      if (!state.isReady) {
        console.warn(`Client not ready — aborting forward after ${sent} groups.`);
        break;
      }

      try {
        await sendToGroup(group.id, message.body, media, message.type);
        sent++;
      } catch (err) {
        failed++;
        console.error(`Failed to forward to ${group.name || group.id}:`, err.message);
      }
      await sleep(2000 + state.delaySeconds * 1000);
    }
    console.log(`Auto-forward complete: ${sent} sent, ${failed} failed.`);
  } catch (err) {
    console.error('Auto-forward error:', err.message);
  } finally {
    forwardInProgress = false;
  }
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function sendToGroup(groupId, text, media, mediaType) {
  if (media) {
    const opts = {};
    if (mediaType === 'audio' || mediaType === 'ptt') {
      opts.sendAudioAsVoice = true;
    } else if (!['image', 'video'].includes(mediaType)) {
      opts.sendMediaAsDocument = true;
    }
    if (text) opts.caption = text;
    await client.sendMessage(groupId, media, opts);
  } else if (text) {
    await client.sendMessage(groupId, text);
  }
}

// ─── Exported actions ────────────────────────────────────────────────────────

// Cache of the last getAllGroups() result, keyed by group id.
// Lets the server look up member IDs without re-querying WhatsApp.
let groupCache = new Map();

async function getAllGroups() {
  const chats = await client.getChats();
  const groups = chats
    .filter((c) => c.isGroup)
    .map((c) => {
      // Participant JIDs already come back from getChats() — no extra API call.
      const memberIds = (c.participants || []).map((p) =>
        typeof p.id === 'object' ? p.id._serialized : p.id
      );
      return {
        id: c.id._serialized,
        name: c.name,
        memberCount: memberIds.length,
        memberIds, // used to compute unique (de-duplicated) totals across groups
      };
    })
    .sort((a, b) => b.memberCount - a.memberCount); // most members first

  // Refresh cache so later lookups (e.g. selection save) need no WhatsApp call.
  groupCache = new Map(groups.map((g) => [g.id, g]));
  return groups;
}

// Look up cached group info by id (no WhatsApp call). Returns undefined if unknown.
function getCachedGroup(id) {
  return groupCache.get(id);
}

// Bulk action runner: calls actionFn(group) for each selected group with delay
async function bulkAction(groups, actionFn, delayMs) {
  const results = [];
  for (const group of groups) {
    try {
      await actionFn(group);
      results.push({ id: group.id, name: group.name, ok: true });
    } catch (err) {
      results.push({ id: group.id, name: group.name, ok: false, error: err.message });
    }
    await sleep(delayMs);
  }
  return results;
}

async function updateGroupDescription(groupId, description) {
  const chat = await client.getChatById(groupId);
  await chat.setDescription(description);
}

async function updateGroupSubject(groupId, subject) {
  const chat = await client.getChatById(groupId);
  await chat.setSubject(subject);
}

async function updateGroupPhoto(groupId, mediaBase64, mimetype) {
  const chat = await client.getChatById(groupId);
  const media = new MessageMedia(mimetype, mediaBase64);
  await chat.setPicture(media);
}

async function updateGroupSettings(groupId, settings) {
  const chat = await client.getChatById(groupId);
  // settings: { messagesAdminsOnly, infoAdminsOnly }
  if (typeof settings.messagesAdminsOnly === 'boolean') {
    await chat.setMessagesAdminsOnly(settings.messagesAdminsOnly);
  }
  if (typeof settings.infoAdminsOnly === 'boolean') {
    await chat.setInfoAdminsOnly(settings.infoAdminsOnly);
  }
}

async function broadcastMessage(groups, text, media, mediaType, delayMs) {
  return bulkAction(groups, async (group) => {
    await sendToGroup(group.id, text, media, mediaType);
  }, delayMs);
}

function initClient() {
  if (state.isInitializing || state.isReady) return;
  state.isInitializing = true;
  loadSettings(); // restore saved group selection & settings from the volume
  clearChromeLocks(AUTH_PATH); // clear stale locks before launching Chromium
  client.initialize();
}

module.exports = {
  state,
  client,
  initClient,
  saveSettings,
  getAllGroups,
  getCachedGroup,
  bulkAction,
  updateGroupDescription,
  updateGroupSubject,
  updateGroupPhoto,
  updateGroupSettings,
  broadcastMessage,
  sendToGroup,
  sleep,
  MessageMedia,
};
