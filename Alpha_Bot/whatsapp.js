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

// whatsapp-web.js reaches into WhatsApp Web's internal webpack modules by name
// (window.require('WAWebCollections'), etc). When WhatsApp ships a new web build
// those names change, every such lookup throws a minified error ("r"), and the
// library breaks until it catches up. Pinning to an archived build that the
// installed library version understands avoids riding whatever WhatsApp ships
// today. Bump WEB_VERSION once whatsapp-web.js supports a newer build.
// Override with the WA_WEB_VERSION env var to try another build without a code
// change. Available builds: github.com/wppconnect-team/wa-version/tree/main/html
const WEB_VERSION = process.env.WA_WEB_VERSION || '2.3000.1044261014-alpha';

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: AUTH_PATH }),
  webVersion: WEB_VERSION,
  webVersionCache: {
    type: 'remote',
    remotePath: `https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/${WEB_VERSION}.html`,
  },
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

client.on('ready', async () => {
  state.qrCodeDataUrl = null;
  state.isReady = true;
  console.log('WhatsApp client is ready.');

  // Smoke-test the injected module lookups once. If WhatsApp has shipped a web
  // build this library version doesn't understand, every getChats()/sendMessage
  // fails with a minified error and the bot is effectively dead — better to say
  // so loudly at startup than to surface it later as an unexplained "r".
  try {
    const chats = await client.getChats();
    console.log(`Chat store OK — ${chats.length} chats, web version ${WEB_VERSION}.`);
  } catch (err) {
    console.error(
      `Chat store UNAVAILABLE on web version ${WEB_VERSION}: ${err.message}\n` +
      'WhatsApp Web likely changed its internal modules. Try another build via ' +
      'the WA_WEB_VERSION env var, or upgrade whatsapp-web.js.'
    );
  }
});

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
