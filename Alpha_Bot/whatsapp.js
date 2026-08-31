const { Client, LocalAuth, MessageMedia, Message, Chat } = require('whatsapp-web.js');
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
      forwardMode: state.forwardMode,
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
    if (data.forwardMode === 'copy' || data.forwardMode === 'forward') {
      state.forwardMode = data.forwardMode;
    }
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
  // How the admin group's messages reach the selected groups:
  //   'copy'    — re-compose the text/media as a brand new message (default).
  //   'forward' — ask WhatsApp to forward the original message.
  // See the auto-forward listener for what each mode preserves.
  forwardMode: 'copy',
};

// WhatsApp Web's July 2026 update minified the message-key property
// `_serialized` to `$1`. whatsapp-web.js reads `id._serialized` throughout, so
// it now gets undefined and throws minified errors ("r"/"t") out of the page
// bundle. Pinning a web version does NOT help — every current build carries the
// rename.
//
// Upstream status (checked 2026-08-21): issue #201862 is still OPEN, PR #201871
// is still UNMERGED, and npm `latest` is 1.34.7 (published 2026-04-24, i.e.
// before the breakage). There is no fixed release to upgrade to — the two shims
// below are what keep this bot running:
//
//   installSerializedShim()  — page-side prototype getter, plus a guard around
//                              Msg.get/getMessagesById. Fixes reads that happen
//                              INSIDE the browser (e.g. getChats() ->
//                              getChatModel reading chat.lastReceivedKey).
//   patchNodeSideIds()       — Node-side normalization. Prototype getters do NOT
//                              survive CDP serialization, so an id that crosses
//                              back into Node arrives without one. That is what
//                              breaks message.downloadMedia() (it passes
//                              this.id._serialized back into the page) and what
//                              can leave message.from undefined.
//
// Neither half hardcodes the minified property name. WhatsApp reshuffles those
// between builds — the second outage here was `$1` coming back as an object
// rather than the serialized string — so both sides match on the SHAPE of the
// value and refuse to yield anything that is not a string.
//
// For the record, on WA Web 2.3000.1045737606 the WID class is NOT renamed at
// all: it still carries `server`, `user` and `_serialized` as own properties,
// and `$1` there is a method. Only MsgKey is affected. The WID getter below is
// left installed because it no-ops when the own property is present.

// Shapes a serialized JID/message-key takes once it has crossed into Node.
const WID_RE = /^[^@\s]*@[a-z0-9.-]+$/i;
const SERIALIZED_RE = /@[a-z0-9.-]+/i;

// Read a serialized id out of whatever shape WhatsApp hands us. Deliberately
// returns ONLY strings or undefined — never the raw minified property. An
// earlier version returned `value.$1` blindly, and when WhatsApp reshuffled its
// minified slots that started handing objects to code expecting strings, which
// is where "Cannot convert object to primitive value" came from.
function serializedId(value) {
  if (value == null) return undefined;
  if (typeof value === 'string') return value;
  if (typeof value !== 'object') return undefined;

  if (typeof value._serialized === 'string') return value._serialized;

  // Fall back to any own property already holding an id-shaped string. This
  // survives renames because it matches on the value, not the property name.
  for (const key of Object.keys(value)) {
    const candidate = value[key];
    if (typeof candidate === 'string' && SERIALIZED_RE.test(candidate)) return candidate;
  }

  // Last resort: a WID is always user + '@' + server.
  if (typeof value.user === 'string' && typeof value.server === 'string') {
    const rebuilt = `${value.user}@${value.server}`;
    if (WID_RE.test(rebuilt)) return rebuilt;
  }
  return undefined;
}

// Give an id object back its `_serialized` own-property. It has to be an own
// property, not a prototype getter: these objects have already crossed the CDP
// boundary, so whatever prototype they carried in the page is gone.
function normalizeIdObject(id) {
  if (!id || typeof id !== 'object') return id;
  if (typeof id._serialized !== 'string') {
    const serialized = serializedId(id);
    if (serialized) id._serialized = serialized;
  }
  if (id.remote && typeof id.remote === 'object' && typeof id.remote._serialized !== 'string') {
    const serialized = serializedId(id.remote);
    if (serialized) id.remote._serialized = serialized;
  }
  return id;
}

// Wrap the structures' _patch so every Message/Chat the library builds comes out
// with usable ids. Done once, at require time, before any client is created.
function patchNodeSideIds() {
  const origMessagePatch = Message.prototype._patch;
  Message.prototype._patch = function (data) {
    const result = origMessagePatch.call(this, data);
    normalizeIdObject(this.id);
    // Message#from/to/author are pre-flattened to strings by the library using
    // `._serialized`, so they come out undefined on renamed builds. An undefined
    // `from` is what silently stops the admin-group filter from ever matching.
    this.from = this.from ?? serializedId(data.from);
    this.to = this.to ?? serializedId(data.to);
    this.author = this.author ?? serializedId(data.author);
    return result;
  };

  const origChatPatch = Chat.prototype._patch;
  Chat.prototype._patch = function (data) {
    // The library builds `new Message(client, data.lastMessage)` unconditionally
    // and immediately reads `data.id.id`, so a lastMessage that arrived without
    // a usable id throws — and because getChats() maps over every chat, that one
    // bad preview takes the entire group list down. Losing a preview is
    // survivable; losing the group list is not.
    if (data && data.lastMessage && typeof data.lastMessage.id !== 'object') {
      data = { ...data, lastMessage: undefined };
    }
    const result = origChatPatch.call(this, data);
    normalizeIdObject(this.id);
    return result;
  };

  console.log('Node-side _serialized normalization installed.');
}

patchNodeSideIds();

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

// Restore a usable `_serialized` on the WID/MsgKey prototypes.
//
// The rename is a MINIFIER artifact, so the new name is not stable. An earlier
// version of this shim hardcoded `$1`; a later WhatsApp build shuffled the
// minified slots so that `$1` held an OBJECT instead of the serialized string.
// That surfaced as WhatsApp's own code doing `ids.map(String)` inside
// `Msg.getMessagesById` and throwing "Cannot convert object to primitive value".
//
// So: never hardcode a minified name, and never let the getter return a
// non-string. Resolution order is (1) the class's native toString(), (2) any own
// property already holding a correctly-shaped string, (3) rebuild from the
// object's parts, identified by shape rather than by name. Anything that fails
// all three yields `undefined`, which degrades to a missing value instead of a
// page-side crash.
async function installSerializedShim() {
  try {
    const result = await client.pupPage.evaluate(() => {
      // A serialized WID is `user@server`; a serialized MsgKey is
      // `fromMe_remote@server_id[_participant]`.
      const WID_RE = /^[^@\s]*@[a-z0-9.-]+$/i;
      const MSGKEY_RE = /^(true|false)_[^@\s]*@[a-z0-9.-]+_[^\s]+/i;
      const SERVER_RE = /^(c\.us|g\.us|lid|broadcast|newsletter|s\.whatsapp\.net|status)$/i;

      // Re-entrancy guard: a class's toString() may itself read `_serialized`,
      // which is the property being defined. Without this, that recurses.
      let resolving = false;

      const ownStringMatching = (obj, re) => {
        for (const key of Object.getOwnPropertyNames(obj)) {
          let value;
          try { value = obj[key]; } catch { continue; }
          if (typeof value === 'string' && re.test(value)) return value;
        }
        return undefined;
      };

      const nativeToString = (obj, re) => {
        if (resolving) return undefined;
        resolving = true;
        try {
          const str = obj.toString();
          return typeof str === 'string' && re.test(str) ? str : undefined;
        } catch {
          return undefined;
        } finally {
          resolving = false;
        }
      };

      // Serialized form of a WID, whatever its properties happen to be called.
      const widString = (wid) => {
        if (wid == null) return undefined;
        if (typeof wid === 'string') return WID_RE.test(wid) ? wid : undefined;
        if (typeof wid !== 'object') return undefined;

        const direct = nativeToString(wid, WID_RE) || ownStringMatching(wid, WID_RE);
        if (direct) return direct;

        // A WID is always user + '@' + server. Recombine the plain string
        // properties, anchoring on the small set of valid server values.
        const strings = Object.getOwnPropertyNames(wid)
          .map((k) => { try { return wid[k]; } catch { return null; } })
          .filter((v) => typeof v === 'string');
        const server = strings.find((v) => SERVER_RE.test(v));
        const user = strings.find((v) => v !== server && /^[0-9A-Za-z._-]+$/.test(v));
        if (server && user) return `${user}@${server}`;
        return undefined;
      };

      // Serialized form of a MsgKey.
      const msgKeyString = (key) => {
        if (key == null) return undefined;
        if (typeof key === 'string') return MSGKEY_RE.test(key) ? key : undefined;
        if (typeof key !== 'object') return undefined;

        const direct = nativeToString(key, MSGKEY_RE) || ownStringMatching(key, MSGKEY_RE);
        if (direct) return direct;

        // Rebuild it, identifying the parts by shape: the remote is the WID-ish
        // property, fromMe the boolean, the id the remaining opaque string.
        let remote, participant, fromMe;
        const plainStrings = [];
        for (const prop of Object.getOwnPropertyNames(key)) {
          let value;
          try { value = key[prop]; } catch { continue; }
          if (typeof value === 'boolean') {
            if (fromMe === undefined) fromMe = value;
          } else if (typeof value === 'string') {
            plainStrings.push(value);
          } else if (value && typeof value === 'object') {
            const asWid = widString(value);
            if (!asWid) continue;
            // The chat lives in `remote`, a group sender in `participant`.
            // A group JID identifies the remote unambiguously.
            if (!remote || asWid.endsWith('@g.us')) remote = asWid;
            else participant = asWid;
          }
        }
        // The message id is the string that is not itself a WID.
        const id = plainStrings.find((s) => !WID_RE.test(s));
        if (remote == null || id == null || fromMe === undefined) return undefined;
        return `${fromMe}_${remote}_${id}` + (participant ? `_${participant}` : '');
      };

      const patched = [];
      const install = (label, proto, resolver) => {
        if (!proto || Object.prototype.hasOwnProperty.call(proto, '_serialized')) return;
        Object.defineProperty(proto, '_serialized', {
          get() { return resolver(this); },
          // A setter is NOT optional. WhatsApp's own constructors assign
          // `this._serialized = ...`, and assigning through an inherited
          // getter-only accessor throws in strict mode — which would break
          // every construction of the class we were trying to repair. Writing
          // an own data property also means later reads skip the resolver.
          set(value) {
            Object.defineProperty(this, '_serialized', {
              value, writable: true, enumerable: true, configurable: true,
            });
          },
          configurable: true,
        });
        patched.push(label);
      };

      try {
        const mod = window.require('WAWebMsgKey');
        install('MsgKey', (mod?.default || mod?.MsgKey || mod)?.prototype, msgKeyString);
      } catch { /* module gone — nothing to alias */ }

      try {
        const probe = window.require('WAWebWidFactory').createWid('12345@c.us');
        // Only patch WID if this build actually renamed it. As of WA Web
        // 2.3000.1045737606 it did not — `server`, `user` and `_serialized` are
        // all still own properties — and patching a class that works is how you
        // create new outages rather than fix them.
        if (typeof probe._serialized !== 'string') {
          install('Wid', Object.getPrototypeOf(probe), widString);
        }
      } catch { /* factory shape changed — leave WID alone */ }

      // Belt and braces: an id we still failed to decode would reach
      // `Msg.get`/`getMessagesById` as a non-string and blow up inside
      // `ids.map(String)`. A missing lastMessage is survivable; a throw takes
      // all of getChats() down with it, because getChats is a Promise.all.
      let guarded = false;
      try {
        const Msg = window.require('WAWebCollections').Msg;
        if (Msg && !Msg.__alphaBotGuard) {
          const origGet = Msg.get.bind(Msg);
          Msg.get = function (key) {
            try { return key == null ? undefined : origGet(key); } catch { return undefined; }
          };
          const origGetMessagesById = Msg.getMessagesById.bind(Msg);
          Msg.getMessagesById = async function (ids) {
            const clean = (Array.isArray(ids) ? ids : []).filter((id) => id != null);
            if (!clean.length) return { messages: [] };
            try { return await origGetMessagesById(clean); } catch { return { messages: [] }; }
          };
          Msg.__alphaBotGuard = true;
          guarded = true;
        }
      } catch { /* collection missing — nothing to guard */ }

      // Ids lose their prototype when they cross the CDP boundary into Node, so
      // the getters above never reach the Node side. Materialize the string as
      // an own property on the models the library ships out — this is what makes
      // message.downloadMedia() and the message.from filter work.
      const wrappedModels = [];
      const wrapModel = (name, resolver) => {
        const original = window.WWebJS?.[name];
        if (typeof original !== 'function' || original.__alphaBotWrapped) return;

        // A renamed MsgKey loses more than `_serialized` on the way out: the
        // library also reads `data.id.id` (for deviceType) and `msg.id.remote`
        // (to resolve the chat). Split the serialized form back into those
        // canonical fields so the Node side sees a well-formed key.
        const restoreKeyParts = (target, serialized) => {
          if (!target || typeof target !== 'object' || typeof serialized !== 'string') return;
          const parts = serialized.split('_');
          if (parts.length < 3) return;
          if (typeof target.fromMe !== 'boolean') target.fromMe = parts[0] === 'true';
          if (target.remote == null) target.remote = parts[1];
          if (typeof target.id !== 'string') target.id = parts[2];
          if (parts[3] && target.participant == null) target.participant = parts[3];
        };

        const decorate = (model, live) => {
          try {
            if (model?.id && typeof model.id === 'object' && typeof model.id._serialized !== 'string') {
              const serialized = resolver(live?.id) || resolver(model.id);
              if (serialized) {
                model.id._serialized = serialized;
                if (resolver === msgKeyString) restoreKeyParts(model.id, serialized);
              }
            }
            // Message#from/to/author are WIDs the library flattens via
            // `._serialized`; give them the same treatment.
            for (const field of ['from', 'to', 'author']) {
              const value = model?.[field];
              if (value && typeof value === 'object' && typeof value._serialized !== 'string') {
                const serialized = widString(value);
                if (serialized) value._serialized = serialized;
              }
            }
            const remote = model?.id?.remote;
            if (remote && typeof remote === 'object' && typeof remote._serialized !== 'string') {
              const serialized = widString(remote) || widString(live?.id?.remote);
              if (serialized) remote._serialized = serialized;
            }
          } catch { /* leave the model as-is */ }
          return model;
        };

        // Preserve the original's sync/async contract. getMessageModel is
        // SYNCHRONOUS and its caller assigns the result straight into the chat
        // model (`model.lastMessage = getMessageModel(...)`). An earlier version
        // of this wrapper was declared `async`, so it stored a Promise there;
        // that reached Node as `{}` and crashed Message._patch on `data.id.id`.
        // getChatModel, by contrast, really is async — hence the thenable check
        // rather than a hardcoded choice.
        const wrapper = function (...callArgs) {
          const output = original.apply(this, callArgs);
          if (output && typeof output.then === 'function') {
            return output.then((model) => decorate(model, callArgs[0]));
          }
          return decorate(output, callArgs[0]);
        };
        wrapper.__alphaBotWrapped = true;
        window.WWebJS[name] = wrapper;
        wrappedModels.push(name);
      };
      wrapModel('getMessageModel', msgKeyString);
      wrapModel('getChatModel', widString);

      // Report what the resolver actually produces on this build, so the next
      // rename shows up in the logs as a decode failure instead of a stack.
      let sample = 'no chat carried a lastReceivedKey';
      try {
        const chat = window
          .require('WAWebCollections')
          .Chat.getModelsArray()
          .find((c) => c.lastReceivedKey);
        if (chat) {
          const decoded = msgKeyString(chat.lastReceivedKey);
          sample = decoded ? `ok (${decoded.slice(0, 28)}...)` : 'FAILED TO DECODE';
        }
      } catch (e) {
        sample = `probe threw ${e.name}`;
      }

      return {
        patched,
        guarded,
        wrappedModels,
        sample,
        version: window.Debug?.VERSION || 'unknown',
      };
    });

    console.log(
      result.patched.length
        ? `Applied _serialized shim to: ${result.patched.join(', ')} (WA Web ${result.version}).`
        : `No _serialized shim needed (WA Web ${result.version}).`
    );
    if (result.guarded) console.log('Installed Msg.get/getMessagesById key guard.');
    if (result.wrappedModels.length) console.log(`Materializing ids for: ${result.wrappedModels.join(', ')}.`);
    console.log('MsgKey decode check:', result.sample);
    if (result.sample === 'FAILED TO DECODE') {
      console.error(
        'WARNING: MsgKey could not be decoded on this build — WhatsApp likely ' +
        'renamed things again. getChats() will still work, but media forwarding may not.'
      );
    }
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
    const groupCount = chats.filter((c) => c.isGroup).length;
    // Print the group count as well as the chat count. client.getChats() only
    // returns what THIS linked device has already synced into its local Chat
    // collection — it never asks the server — so two deployments of the same
    // account legitimately disagree. Comparing this number between machines is
    // the quickest way to tell a stale device from a code problem.
    console.log(`Chat store OK — ${chats.length} chats, ${groupCount} groups.`);
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
    // In forward mode WhatsApp moves the original message itself, so there is
    // nothing to download — and downloading is the step most likely to fail on
    // a channel post, whose media the bot may not be able to fetch directly.
    let media = null;
    if (state.forwardMode !== 'forward' && message.hasMedia) {
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
        if (state.forwardMode === 'forward') {
          // A real WhatsApp forward. Keeps whatever context the original
          // carried — the "Forwarded" tag, and for a post that originated in a
          // channel, the channel header and its "View channel" footer, because
          // the message keeps its newsletter attribution rather than being
          // retyped by the bot. The trade-off is that the content is passed
          // through verbatim; it cannot be altered on the way.
          await message.forward(group.id);
        } else {
          await sendToGroup(group.id, message.body, media, message.type);
        }
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

// Re-query group metadata (name, participants) from WhatsApp for every group
// this device knows about.
//
// The participant list that getChats() returns comes from each chat's cached
// groupMetadata, which is only refreshed when the device happens to receive an
// update. On a long-running session it drifts, so member counts go stale. This
// asks WhatsApp for the current metadata instead.
//
// Note the limit: it can only refresh groups already present in the local Chat
// collection. It cannot discover groups this device never synced — nothing in
// the page API can, short of re-linking the session.
//
// One evaluate() per group rather than a single long-running one, so no call
// gets close to Puppeteer's protocol timeout on an account with many groups.
async function refreshGroupMetadata(delayMs = 250) {
  const ids = await client.pupPage.evaluate(() => {
    const isGroupChat = (chat) => {
      try {
        if (typeof chat.id?.isGroup === 'function') return chat.id.isGroup();
      } catch { /* fall through to the server check */ }
      return chat.id?.server === 'g.us';
    };
    return window
      .require('WAWebCollections')
      .Chat.getModelsArray()
      .filter(isGroupChat)
      .map((chat) => chat.id?._serialized)
      .filter((id) => typeof id === 'string');
  });

  let refreshed = 0;
  let failed = 0;
  for (const id of ids) {
    try {
      await client.pupPage.evaluate(async (groupId) => {
        const wid = window.require('WAWebWidFactory').createWid(groupId);
        await window
          .require('WAWebGroupQueryJob')
          .queryAndUpdateGroupMetadataById({ id: wid });
      }, id);
      refreshed++;
    } catch (err) {
      failed++;
    }
    await sleep(delayMs); // WhatsApp rate-limits bursts of metadata queries
  }

  console.log(`Group metadata refresh: ${refreshed} refreshed, ${failed} failed, of ${ids.length}.`);
  return { total: ids.length, refreshed, failed };
}

// Every JID this account is known by. Groups list participants by phone number
// or by LID depending on how the group is addressed, so collect whatever the
// client reports and match against all of them.
function ownJids() {
  const info = client.info || {};
  return [info.wid, info.me, info.lid]
    .map(serializedId)
    .filter(Boolean);
}

async function getAllGroups({ refresh = false } = {}) {
  if (refresh) await refreshGroupMetadata();
  const chats = await client.getChats();
  const all = chats
    .filter((c) => c.isGroup)
    .map((c) => {
      // Participant JIDs already come back from getChats() — no extra API call.
      const memberIds = (c.participants || [])
        .map((p) => serializedId(p.id))
        .filter(Boolean);
      return {
        id: serializedId(c.id),
        name: c.name,
        memberCount: memberIds.length,
        memberIds, // used to compute unique (de-duplicated) totals across groups
      };
    });

  // Groups this account has left (or was removed from) stay in WhatsApp's chat
  // list forever. They are useless here — you cannot post to them — and they
  // were showing up as "0 members" entries in the picker.
  const mine = ownJids();

  // Only trust the "is my JID in the participants" test if our own JID actually
  // turns up somewhere. On an account whose groups are LID-addressed while
  // client.info reports a phone number (or the reverse), it would match nothing
  // and hide every single group.
  const jidFormMatches =
    mine.length > 0 && all.some((g) => g.memberIds.some((id) => mine.includes(id)));

  const groups = all
    .filter((g) => {
      // A group you are still in always contains at least you, so an empty
      // participant list means you are not in it. This alone covers the
      // "0 members" rows, and holds regardless of JID format.
      if (g.memberIds.length === 0) return false;
      if (!jidFormMatches) return true;
      return g.memberIds.some((id) => mine.includes(id));
    })
    .sort((a, b) => b.memberCount - a.memberCount); // most members first

  const hidden = all.length - groups.length;
  if (hidden > 0) {
    console.log(
      `Hiding ${hidden} group(s) this account is no longer a member of` +
      `${jidFormMatches ? '' : ' (by empty participant list only — own JID not found in any group)'}.`
    );
  }

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

// settings: { messagesAdminsOnly, infoAdminsOnly, addMembersAdminsOnly }
//
// Each key is optional and only a boolean is acted on, so the caller can change
// one permission without disturbing the other two — leaving a key out means
// "leave this as it is", which is what the dashboard's "Don't change" option
// sends.
//
// Each setter is a separate request to WhatsApp. They are spaced out here for
// the same reason bulkAction spaces out groups: three permission changes fired
// back to back on every group in a large account is exactly the burst pattern
// that gets an account flagged.
async function updateGroupSettings(groupId, settings, stepDelayMs = 1500) {
  const chat = await client.getChatById(groupId);

  const steps = [
    ['messagesAdminsOnly', (value) => chat.setMessagesAdminsOnly(value)],
    ['infoAdminsOnly', (value) => chat.setInfoAdminsOnly(value)],
    ['addMembersAdminsOnly', (value) => chat.setAddMembersAdminsOnly(value)],
  ].filter(([key]) => typeof settings[key] === 'boolean');

  for (let i = 0; i < steps.length; i++) {
    const [key, apply] = steps[i];
    await apply(settings[key]);
    if (i < steps.length - 1) await sleep(stepDelayMs);
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
  refreshGroupMetadata,
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
