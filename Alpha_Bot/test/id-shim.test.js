'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
process.chdir(ROOT);

let pass = 0, fail = 0;
const check = (label, actual, expected) => {
  const ok = actual === expected;
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}\n        got: ${JSON.stringify(actual)}${ok ? '' : `\n   expected: ${JSON.stringify(expected)}`}`);
};
const checkNoThrow = (label, fn) => {
  try { fn(); pass++; console.log(`PASS  ${label}`); }
  catch (e) { fail++; console.log(`FAIL  ${label}\n        threw: ${e.message}`); }
};

// ───────────────────────────────────────────────────────────────────────────
// 1. Page-side resolvers. Pull the evaluate() callback out of whatsapp.js and
//    run it against a mocked WhatsApp Web page.
// ───────────────────────────────────────────────────────────────────────────
const src = fs.readFileSync('whatsapp.js', 'utf8');
const marker = 'await client.pupPage.evaluate(() => {';
const from = src.indexOf(marker);
if (from < 0) throw new Error('could not find the evaluate() callback');
let depth = 0, i = from + marker.length - 1, end = -1;
for (; i < src.length; i++) {
  if (src[i] === '{') depth++;
  else if (src[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
}
const bodySrc = src.slice(from + marker.length, end);

// --- the mocked page ---------------------------------------------------------
// WID as production actually reports it on WA Web 2.3000.1045737606: NOT
// renamed — `server`, `user` and `_serialized` are all still own properties.
class RealWid {
  constructor(user, server) {
    this.server = server;
    this.user = user;
    this._serialized = `${user}@${server}`;
  }
  toString() { return this._serialized; }
}
// MsgKey IS renamed, and `$1` holds an OBJECT rather than the serialized string
// (the regression that produced "Cannot convert object to primitive value").
class MinifiedMsgKey {
  constructor(remote, id, fromMe, participant) {
    this.$1 = remote;              // object, NOT the serialized string
    this.$3 = id;
    this.$4 = fromMe;
    if (participant) this.$5 = participant;
  }
}
const brokenKey = new MinifiedMsgKey(new RealWid('120363427554847352', 'g.us'), 'ABCDEF123456', false);
const brokenKeyGroup = new MinifiedMsgKey(
  new RealWid('120363427554847352', 'g.us'), 'FEDCBA654321', false, new RealWid('923339876543', 'c.us')
);

// Exactly what `new MsgKey({from, to, id, participant, selfDir: 'out'})`
// produces at Injected/Utils.js:445 — the shape that made every send fail.
class OutgoingMsgKey {
  constructor(to, id, participant) {
    this.$a = new RealWid('923001112222', 'c.us'); // from (us)
    this.$b = to;
    this.$c = id;
    if (participant) this.$d = participant;
    this.$e = 'out';                                // selfDir — NOT a boolean
  }
}

const collections = {
  Msg: {
    get(key) {
      if (typeof key !== 'string') throw new TypeError('Cannot convert object to primitive value');
      // A real store returns the message for a well-formed key; returning null
      // here would mask whether the forward path itself works.
      return { id: key, body: 'hi' };
    },
    async getMessagesById(ids) {
      ids.map(String); // this is the line that throws in the real bundle
      return { messages: [] };
    },
  },
  Chat: {
    // Mirrors the live failure: the WID lookup yields an object with no id.
    get: () => ({ id: undefined, broken: true }),
    getModelsArray: () => [
      { lastReceivedKey: brokenKey },
      { id: new RealWid('120363427554847352', 'g.us'), name: 'good chat' },
    ],
  },
};

const serialize = (o) => JSON.parse(JSON.stringify(o));

// WAWebChatForwardMessage is deliberately absent: on the live build it resolves
// to undefined, which is what produced "Cannot read properties of undefined
// (reading 'forwardMessages')" on every group. The real module now lives under
// a renamed id that only a registry scan can find.
const forwardCalls = [];
const moduleRegistry = {
  WAWebSomeRenamedForwardThing: {
    forwardMessages: async (args) => { forwardCalls.push(args); return true; },
  },
  WAWebUnrelated: { somethingElse: () => {} },
};

const window = {
  Debug: { VERSION: '2.3000.1045737606' },
  require(name) {
    if (name === '__debug') return { modulesMap: moduleRegistry };
    if (Object.prototype.hasOwnProperty.call(moduleRegistry, name)) return moduleRegistry[name];
    if (name === 'WAWebMsgKey') return MinifiedMsgKey;
    if (name === 'WAWebWidFactory') return { createWid: (s) => new RealWid(...s.split('@').reverse().reverse()) };
    if (name === 'WAWebCollections') return collections;
    if (name === 'WAWebUserPrefsMeUser') return {
      getMaybeMePnUser: () => new RealWid('923001112222', 'c.us'),
      getMaybeMeLidUser: () => null,
    };
    if (name === 'WAWebChatGetters') return {
      getIsNewsletter: (chat) => {
        if (!chat || chat.id == null) {
          throw new Error(
            "Data passed to getter must include an id property (it's how we memoize) but got undefined"
          );
        }
        return false;
      },
    };
    if (name === 'WAWebFindChatAction') return { findOrCreateLatestChat: async () => null };
    throw new Error('module not found: ' + name);
  },
  WWebJS: {
    // Present so the shim has something to replace; the body is irrelevant
    // because the shim overwrites it entirely.
    async forwardMessage() { throw new Error('original should have been replaced'); },
    // SYNCHRONOUS in the real library (Injected/Utils.js:803). Wrapping this in
    // an async function is what broke production: the caller below assigns the
    // return value straight into the chat model, so a Promise landed where a
    // message model belonged and reached Node as `{}`.
    getMessageModel(message) {
      return { id: serialize(message.id), from: serialize(message.from), body: 'hi' };
    },
    // ASYNC in the real library (Injected/Utils.js:938).
    async getChat() { return collections.Chat.get(); },
    async processMediaData() {
      const mediaData = {
        id: 'media-object-id-not-a-msgkey',
        mimetype: 'image/png',
        filehash: 'abc123',
        toJSON() {
          return { id: 'media-object-id-not-a-msgkey', mimetype: 'image/png', filehash: 'abc123' };
        },
      };
      return mediaData;
    },
    async getChatModel(chat) {
      const model = { id: serialize(chat.id), formattedTitle: 'T', isGroup: true, lastMessage: null };
      // mirrors Injected/Utils.js:996-999
      if (chat.lastReceivedKey) {
        model.lastMessage = window.WWebJS.getMessageModel({
          id: chat.lastReceivedKey, from: new RealWid('120363427554847352', 'g.us'),
        });
      }
      return model;
    },
  },
};

const result = new Function('window', bodySrc)(window);
const widStringFor = (wid) =>
  wid == null ? undefined : typeof wid === 'string' ? wid : wid._serialized;

console.log('\n─── page-side shim ───');
check('patched prototypes', result.patched.join(','), 'MsgKey');
check('Msg guard installed', result.guarded, true);
check('models wrapped', result.wrappedModels.join(','), 'getMessageModel,getChatModel');
check('lastReceivedKey decodes', result.sample, 'ok (false_120363427554847352@g.u...)');

// the prototype getter yields a STRING, never an object
check('MsgKey._serialized (1:1)', brokenKey._serialized, 'false_120363427554847352@g.us_ABCDEF123456');
check('MsgKey._serialized (group)', brokenKeyGroup._serialized,
  'false_120363427554847352@g.us_FEDCBA654321_923339876543@c.us');
check('never returns an object', typeof brokenKey._serialized, 'string');
checkNoThrow('constructor may assign this._serialized', () => { new RealWid('1','c.us'); });
check('un-renamed WID untouched', new RealWid('923001234567', 'c.us')._serialized, '923001234567@c.us');

// the guard turns a fatal page-side throw into a survivable miss
check('Msg.get(object) no longer throws', collections.Msg.get({}), undefined);

// REGRESSION: the wrapper must not change a synchronous function into an async
// one. This is the bug that produced "Cannot read properties of undefined
// (reading 'id')" at Message._patch.
const syncModel = window.WWebJS.getMessageModel({
  id: brokenKey, from: new RealWid('120363427554847352', 'g.us'),
});
check('getMessageModel stays synchronous', typeof syncModel?.then, 'undefined');
check('getMessageModel id materialized', syncModel.id._serialized, 'false_120363427554847352@g.us_ABCDEF123456');

(async () => {
  check('getMessagesById(objects) survives', JSON.stringify(await collections.Msg.getMessagesById([{}])), '{"messages":[]}');

  const chatModel = await window.WWebJS.getChatModel({
    id: new RealWid('120363427554847352', 'g.us'), lastReceivedKey: brokenKey,
  });
  check('getChatModel stays async', typeof chatModel.id, 'object');
  check('chat lastMessage is a model, not a Promise', typeof chatModel.lastMessage.then, 'undefined');
  check('chat lastMessage has a usable id', typeof chatModel.lastMessage.id.id, 'string');
  check('chat lastMessage id.fromMe restored', chatModel.lastMessage.id.fromMe, false);
  check('chat lastMessage id.remote restored', chatModel.lastMessage.id.remote, '120363427554847352@g.us');

  // ─────────────────────────────────────────────────────────────────────────
  // 2. Node-side normalization.
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n─── node-side normalization ───');
  require(path.join(ROOT, 'whatsapp.js'));
  const { Message, Chat } = require('whatsapp-web.js');
  const fakeClient = {};

  // The whole chat model, as it now crosses CDP, must build a real Chat.
  checkNoThrow('Chat builds from a real getChatModel payload', () => {
    new Chat(fakeClient, serialize(chatModel));
  });

  // REGRESSION: a lastMessage without a usable id must not take getChats() down.
  checkNoThrow('malformed lastMessage does not throw', () => {
    new Chat(fakeClient, serialize({
      id: { user: '1', server: 'g.us', _serialized: '1@g.us' },
      formattedTitle: 'T', isGroup: true,
      lastMessage: {}, // what a serialized Promise looked like
    }));
  });
  const dropped = new Chat(fakeClient, serialize({
    id: { user: '1', server: 'g.us', _serialized: '1@g.us' },
    formattedTitle: 'T', isGroup: true, lastMessage: {},
  }));
  check('malformed lastMessage dropped', dropped.lastMessage, undefined);

  // The object-valued `$1` must never leak through to Node.
  const poisoned = new Message(fakeClient, serialize({
    id: { $1: { server: 'g.us', user: '1' }, $3: 'ABC', $4: false },
    from: { server: 'g.us', user: '1' }, body: 'x', type: 'chat',
  }));
  check('object-valued $1 not leaked', typeof poisoned.id._serialized !== 'object', true);

  const shipped = new Message(fakeClient, serialize({
    id: { _serialized: 'false_1@g.us_ABC', remote: { user: '1', server: 'g.us' } },
    from: { user: '1', server: 'g.us' },
    to: { user: '2', server: 'c.us' },
    body: 'x', type: 'chat',
  }));
  check('id._serialized', shipped.id._serialized, 'false_1@g.us_ABC');
  check('id.remote._serialized rebuilt', shipped.id.remote._serialized, '1@g.us');
  check('from rebuilt from user/server', shipped.from, '1@g.us');
  check('to rebuilt from user/server', shipped.to, '2@c.us');

  const chat = new Chat(fakeClient, serialize({
    id: { user: '1', server: 'g.us' }, formattedTitle: 'Test', isGroup: true,
  }));
  check('chat.id._serialized rebuilt', chat.id._serialized, '1@g.us');

  // legacy build must be untouched
  const legacy = new Message(fakeClient, serialize({
    id: { _serialized: 'true_1@c.us_X' }, from: { _serialized: '1@c.us' }, body: 'x',
  }));
  check('legacy id', legacy.id._serialized, 'true_1@c.us_X');
  check('legacy from', legacy.from, '1@c.us');

  // ─────────────────────────────────────────────────────────────────────────
  // 3. Forward module resolution.
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n─── forward module ───');

  // REGRESSION: the hardcoded name is gone, so the resolver must locate the
  // module by scanning rather than giving up.
  check('forward module found despite the rename',
    result.forwardModule, 'WAWebSomeRenamedForwardThing (found by scan)');
  check('library name no longer resolves',
    typeof moduleRegistry.WAWebChatForwardMessage, 'undefined');

  // The replacement forwardMessage must actually route through it.
  await window.WWebJS.forwardMessage('120363427554847352@g.us', 'false_1@g.us_ABC');
  check('forwardMessages called once', forwardCalls.length, 1);
  check('forwarded with multicast', forwardCalls[0].multicast, true);
  check('caption included', forwardCalls[0].includeCaption, true);

  // ─────────────────────────────────────────────────────────────────────────
  // 4. Chat lookup hardening.
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n─── chat lookup ───');
  check('hardened lookup installed', result.chatLookupHardened, true);

  // REGRESSION: the library's route returns a chat with no id, which sails past
  // Client.sendMessage's `if (!chat)` guard and then throws inside
  // getIsNewsletter. The hardened lookup must reject it and find the real one.
  const looked = await window.WWebJS.getChat('120363427554847352@g.us', { getAsModel: false });
  check('id-less chat rejected', looked?.broken, undefined);
  check('real chat found by model scan', looked?.name, 'good chat');
  check('returned chat has a usable id', widStringFor(looked?.id), '120363427554847352@g.us');

  // And the result must now survive the getter that was throwing.
  let getterError = null;
  try {
    window.require('WAWebChatGetters').getIsNewsletter(looked);
  } catch (e) { getterError = e.message; }
  check('getIsNewsletter accepts it', getterError, null);

  // An id that resolves to nothing at all yields null rather than a broken object.
  const missing = await window.WWebJS.getChat('000@g.us', { getAsModel: false });
  check('unresolvable chat returns null', missing, null);

  // ─────────────────────────────────────────────────────────────────────────
  // 5. Freshly constructed outgoing keys.
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n─── outgoing MsgKey ───');

  // REGRESSION: direction arrives as the string 'out', not a boolean. Demanding
  // a boolean returned undefined, and that undefined became the key WhatsApp
  // memoizes the outgoing message by — "Data passed to getter must include an
  // id property (it's how we memoize) but got undefined" on every send.
  const outgoingGroup = new OutgoingMsgKey(
    new RealWid('120363162234460479', 'g.us'),
    'OUT123456',
    new RealWid('923001112222', 'c.us')
  );
  Object.setPrototypeOf(outgoingGroup, MinifiedMsgKey.prototype);
  check('outgoing group key serializes', outgoingGroup._serialized,
    'true_120363162234460479@g.us_OUT123456_923001112222@c.us');
  check('never undefined for an outgoing key',
    typeof outgoingGroup._serialized, 'string');

  // 1:1: the remote is the other party, not us.
  const outgoingDm = new OutgoingMsgKey(new RealWid('923339999999', 'c.us'), 'DM99');
  Object.setPrototypeOf(outgoingDm, MinifiedMsgKey.prototype);
  check('outgoing 1:1 key uses the peer as remote', outgoingDm._serialized,
    'true_923339999999@c.us_DM99');

  // 'in' must map to false, not be mistaken for the message id.
  const incoming = new OutgoingMsgKey(new RealWid('120363162234460479', 'g.us'), 'IN777');
  incoming.$e = 'in';
  Object.setPrototypeOf(incoming, MinifiedMsgKey.prototype);
  check('incoming direction maps to false',
    incoming._serialized.startsWith('false_'), true);

  // The direction marker must never be picked up as the message id.
  check('selfDir not mistaken for the id',
    outgoingGroup._serialized.includes('_out_'), false);

  // ─────────────────────────────────────────────────────────────────────────
  // 6. Media sends must not clobber the message key.
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n─── media key shield ───');
  check('media shield installed', result.mediaShieldInstalled, true);

  const media = await window.WWebJS.processMediaData(
    { mimetype: 'image/png', data: 'x' }, {}
  );

  // The value is preserved for WhatsApp's own use...
  check('media id still readable directly', media.id, 'media-object-id-not-a-msgkey');
  // ...but must not travel through object spread, which is how it reached
  // `message.id` and replaced the MsgKey.
  check('media id excluded from spread',
    Object.prototype.hasOwnProperty.call({ ...media }, 'id'), false);
  check('media id excluded from toJSON',
    Object.prototype.hasOwnProperty.call(media.toJSON(), 'id'), false);
  check('other media fields survive spread', { ...media }.filehash, 'abc123');
  check('other media fields survive toJSON', media.toJSON().mimetype, 'image/png');

  // The end result: building the message the way the library does leaves the
  // MsgKey intact.
  const newMsgKey = new OutgoingMsgKey(
    new RealWid('120363162234460479', 'g.us'), 'KEEPME', new RealWid('923001112222', 'c.us')
  );
  Object.setPrototypeOf(newMsgKey, MinifiedMsgKey.prototype);
  const built = {
    id: newMsgKey,
    body: '',
    ...media,
    ...(media.toJSON ? media.toJSON() : {}),
  };
  check('message.id survives the media spread', built.id, newMsgKey);
  check('message.id still serializes', built.id._serialized,
    'true_120363162234460479@g.us_KEEPME_923001112222@c.us');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
