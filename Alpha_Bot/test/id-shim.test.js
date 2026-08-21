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
// Minified WID: `user`/`server` renamed, no _serialized, but toString survives.
class MinifiedWid {
  constructor(user, server) { this.$0 = user; this.$2 = server; }
  toString() { return `${this.$0}@${this.$2}`; }
}
// Minified MsgKey exactly as the production build behaves: `$1` is an OBJECT
// (the regression that produced "Cannot convert object to primitive value"),
// and toString() has been minified away entirely.
class MinifiedMsgKey {
  constructor(remote, id, fromMe, participant) {
    this.$1 = remote;              // object, NOT the serialized string
    this.$3 = id;
    this.$4 = fromMe;
    if (participant) this.$5 = participant;
  }
}
const brokenKey = new MinifiedMsgKey(new MinifiedWid('923001234567', 'g.us'), 'ABCDEF123456', false);
const brokenKeyGroup = new MinifiedMsgKey(
  new MinifiedWid('923001234567', 'g.us'), 'FEDCBA654321', false, new MinifiedWid('923339876543', 'c.us')
);

const msgGetCalls = [];
const collections = {
  Msg: {
    get(key) {
      msgGetCalls.push(key);
      if (typeof key !== 'string') throw new TypeError('Cannot convert object to primitive value');
      return null;
    },
    async getMessagesById(ids) {
      ids.map(String); // this is the line that throws in the real bundle
      return { messages: [] };
    },
  },
  Chat: { getModelsArray: () => [{ lastReceivedKey: brokenKey }] },
};

const captured = {};
const window = {
  Debug: { VERSION: '2.3000.1050000000' },
  require(name) {
    if (name === 'WAWebMsgKey') return MinifiedMsgKey;
    if (name === 'WAWebWidFactory') return { createWid: (s) => new MinifiedWid(...s.split('@')) };
    if (name === 'WAWebCollections') return collections;
    throw new Error('module not found: ' + name);
  },
  WWebJS: {
    async getMessageModel(message) {
      // mimics message.serialize(): own properties only, prototype dropped
      captured.rawId = JSON.parse(JSON.stringify(message.id));
      return { id: JSON.parse(JSON.stringify(message.id)), from: JSON.parse(JSON.stringify(message.from)), body: 'hi' };
    },
    async getChatModel(chat) {
      return { id: JSON.parse(JSON.stringify(chat.id)), formattedTitle: 'T', isGroup: true };
    },
  },
};

const result = new Function('window', `${bodySrc}`)(window);

console.log('\n─── page-side shim ───');
check('patched prototypes', result.patched.join(','), 'MsgKey,Wid');
check('Msg guard installed', result.guarded, true);
check('models wrapped', result.wrappedModels.join(','), 'getMessageModel,getChatModel');
check('lastReceivedKey decodes', result.sample, 'ok (false_923001234567@g.us_ABCD...)');

// the prototype getter now yields a STRING, never an object
check('MsgKey._serialized (1:1)', brokenKey._serialized, 'false_923001234567@g.us_ABCDEF123456');
check('MsgKey._serialized (group)', brokenKeyGroup._serialized,
  'false_923001234567@g.us_FEDCBA654321_923339876543@c.us');
check('Wid._serialized', new MinifiedWid('923001234567', 'c.us')._serialized, '923001234567@c.us');
check('never returns an object', typeof brokenKey._serialized, 'string');

// the guard turns a fatal page-side throw into a survivable miss
check('Msg.get(object) no longer throws', collections.Msg.get({}), undefined);

(async () => {
  check('getMessagesById(objects) survives', JSON.stringify(await collections.Msg.getMessagesById([{}])), '{"messages":[]}');

  // the model wrapper materializes _serialized across the CDP boundary
  const model = await window.WWebJS.getMessageModel({
    id: brokenKey, from: new MinifiedWid('923001234567', 'g.us'),
  });
  check('getMessageModel id materialized', model.id._serialized, 'false_923001234567@g.us_ABCDEF123456');
  check('getMessageModel from materialized', model.from._serialized, '923001234567@g.us');
  check('raw serialize() had no _serialized', captured.rawId._serialized, undefined);

  // ─────────────────────────────────────────────────────────────────────────
  // 2. Node-side normalization, including the object-valued `$1` regression.
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n─── node-side normalization ───');
  require(path.join(ROOT, 'whatsapp.js'));
  const { Message, Chat } = require('whatsapp-web.js');
  const fakeClient = {};
  const json = (o) => JSON.parse(JSON.stringify(o));

  // The regression shape: `$1` is an object. Must NOT leak through.
  const poisoned = new Message(fakeClient, json({
    id: { $1: { $0: '923001234567', $2: 'g.us' }, $3: 'ABC', $4: false },
    from: { $0: '923001234567', $2: 'g.us' },
    body: 'x', type: 'chat',
  }));
  check('object-valued $1 not leaked', typeof poisoned.id._serialized !== 'object', true);

  // Realistic post-rename payload where the string did survive serialization
  // (this is what the page-side wrapper now guarantees).
  const shipped = new Message(fakeClient, json({
    id: { _serialized: 'false_923001234567@g.us_ABC', remote: { user: '923001234567', server: 'g.us' } },
    from: { user: '923001234567', server: 'g.us' },
    to: { user: '923339876543', server: 'c.us' },
    body: 'x', type: 'chat',
  }));
  check('id._serialized', shipped.id._serialized, 'false_923001234567@g.us_ABC');
  check('id.remote._serialized rebuilt', shipped.id.remote._serialized, '923001234567@g.us');
  check('from rebuilt from user/server', shipped.from, '923001234567@g.us');
  check('to rebuilt from user/server', shipped.to, '923339876543@c.us');

  const chat = new Chat(fakeClient, json({
    id: { user: '923001234567', server: 'g.us' }, formattedTitle: 'Test', isGroup: true,
  }));
  check('chat.id._serialized rebuilt', chat.id._serialized, '923001234567@g.us');

  // legacy build must be untouched
  const legacy = new Message(fakeClient, json({
    id: { _serialized: 'true_1@c.us_X' }, from: { _serialized: '1@c.us' }, body: 'x',
  }));
  check('legacy id', legacy.id._serialized, 'true_1@c.us_X');
  check('legacy from', legacy.from, '1@c.us');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
