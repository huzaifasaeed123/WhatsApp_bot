'use strict';
// Exercises the group-permission plumbing with a mocked WhatsApp client, plus
// the multipart parsing that the dashboard's forms depend on.
const path = require('path');
const express = require('express');
const multer = require('multer');
const { Readable } = require('stream');
const ROOT = path.join(__dirname, '..');
process.chdir(ROOT);

let pass = 0, fail = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}\n        got: ${JSON.stringify(actual)}${ok ? '' : `\n   expected: ${JSON.stringify(expected)}`}`);
};

const wa = require(path.join(ROOT, 'whatsapp.js'));

// --- a chat that records which setters were called, and when ---------------
const makeChat = (log) => ({
  setMessagesAdminsOnly: async (v) => log.push({ call: 'messages', v, at: Date.now() }),
  setInfoAdminsOnly: async (v) => log.push({ call: 'info', v, at: Date.now() }),
  setAddMembersAdminsOnly: async (v) => log.push({ call: 'addMembers', v, at: Date.now() }),
});

(async () => {
  console.log('\n─── updateGroupSettings ───');

  // 1. All three permissions applied, in order.
  let log = [];
  wa.client.getChatById = async () => makeChat(log);
  await wa.updateGroupSettings('1@g.us', {
    messagesAdminsOnly: true, infoAdminsOnly: false, addMembersAdminsOnly: true,
  }, 10);
  check('all three applied in order', log.map((e) => e.call), ['messages', 'info', 'addMembers']);
  check('values passed through', log.map((e) => e.v), [true, false, true]);

  // 2. Omitted keys are left alone — "Don't change" must not reset anything.
  log = [];
  await wa.updateGroupSettings('1@g.us', { addMembersAdminsOnly: false }, 10);
  check('only the specified permission applied', log.map((e) => e.call), ['addMembers']);

  // 3. Non-boolean values are ignored rather than coerced.
  log = [];
  await wa.updateGroupSettings('1@g.us', {
    messagesAdminsOnly: 'true', infoAdminsOnly: undefined, addMembersAdminsOnly: null,
  }, 10);
  check('non-booleans ignored', log.map((e) => e.call), []);

  // 4. Consecutive setters are spaced out, so a group does not get three
  //    permission writes in the same instant.
  log = [];
  await wa.updateGroupSettings('1@g.us', {
    messagesAdminsOnly: true, infoAdminsOnly: true, addMembersAdminsOnly: true,
  }, 120);
  const gaps = log.slice(1).map((e, i) => e.at - log[i].at);
  check('delay applied between setters', gaps.every((g) => g >= 100), true);
  check('no trailing delay after the last setter', log.length, 3);

  // --- bulkAction still spaces out the groups themselves -------------------
  console.log('\n─── bulkAction delay ───');
  const starts = [];
  const groups = [{ id: 'a@g.us', name: 'A' }, { id: 'b@g.us', name: 'B' }, { id: 'c@g.us', name: 'C' }];
  const results = await wa.bulkAction(groups, async () => { starts.push(Date.now()); }, 150);
  const groupGaps = starts.slice(1).map((t, i) => t - starts[i]);
  check('each group waits its turn', groupGaps.every((g) => g >= 140), true);
  check('every group reported', results.map((r) => r.ok), [true, true, true]);

  // A failure is recorded rather than aborting the run.
  const mixed = await wa.bulkAction(groups, async (g) => {
    if (g.id === 'b@g.us') throw new Error('not an admin');
  }, 10);
  check('failures do not abort the batch', mixed.map((r) => r.ok), [true, false, true]);
  check('failure reason kept', mixed[1].error, 'not an admin');

  // --- the dashboard posts multipart; the routes must parse it -------------
  // multer is driven directly rather than over a real listener: an HTTP server
  // plus fetch's keep-alive sockets makes Node abort with a libuv assertion on
  // Windows at teardown, which would make this suite always look like a failure.
  console.log('\n─── multipart form parsing ───');
  const upload = multer({ storage: multer.memoryStorage() });

  // Build a genuine multipart body (correct boundary, correct framing) without
  // sending it anywhere.
  const fd = new FormData();
  fd.append('messagesAdminsOnly', 'true');
  fd.append('infoAdminsOnly', '');            // "Don't change"
  fd.append('addMembersAdminsOnly', 'false');
  const encoded = new Request('http://local/', { method: 'POST', body: fd });
  const bodyBuffer = Buffer.from(await encoded.arrayBuffer());
  const contentType = encoded.headers.get('content-type');

  const runMiddleware = (middleware) => new Promise((resolve, reject) => {
    const req = Readable.from([bodyBuffer]);
    req.method = 'POST';
    req.headers = { 'content-type': contentType, 'content-length': String(bodyBuffer.length) };
    middleware(req, {}, (err) => (err ? reject(err) : resolve(req.body)));
  });

  // Mirrors the real route's "Don't change" filtering.
  const readSettings = (body) => {
    const settings = {};
    for (const key of ['messagesAdminsOnly', 'infoAdminsOnly', 'addMembersAdminsOnly']) {
      if (body[key] === 'true' || body[key] === 'false') settings[key] = body[key] === 'true';
    }
    return settings;
  };

  const parsedBody = await runMiddleware(upload.none());
  check('multipart fields reach the handler', readSettings(parsedBody),
    { messagesAdminsOnly: true, addMembersAdminsOnly: false });
  check('empty select omitted, not coerced to false',
    Object.prototype.hasOwnProperty.call(readSettings(parsedBody), 'infoAdminsOnly'), false);

  // This is what all seven routes did before upload.none() was added: neither
  // express.json() nor express.urlencoded() touches multipart, so req.body
  // stayed empty and the handler acted on undefined.
  const urlencodedOnly = express.urlencoded({ extended: true });
  const unparsedBody = await runMiddleware(urlencodedOnly);
  check('express.urlencoded leaves multipart unparsed', unparsedBody, {});

  // --- groups the account has left must not reach the picker --------------
  console.log('\n─── left-group filtering ───');

  const ME = '923001112222@c.us';
  const chat = (name, members) => ({
    isGroup: true,
    id: { _serialized: `${name}@g.us` },
    name,
    participants: members.map((m) => ({ id: { _serialized: m } })),
  });

  const listGroups = async (chats, info) => {
    wa.client.info = info;
    wa.client.getChats = async () => chats;
    return (await wa.getAllGroups()).map((g) => g.name);
  };

  // Left groups keep sitting in WhatsApp's chat list with an empty participant
  // list — these are the "0 members" rows.
  check('empty group hidden', await listGroups([
    chat('active', [ME, '1@c.us']),
    chat('left', []),
  ], { wid: { _serialized: ME } }), ['active']);

  // Metadata can still list the other members after you are removed, so an
  // explicit membership check is needed too.
  check('group without me hidden', await listGroups([
    chat('mine', [ME, '1@c.us', '2@c.us']),
    chat('removed', ['1@c.us', '2@c.us']),
  ], { wid: { _serialized: ME } }), ['mine']);

  // Ordering (largest first) and the rest of the shape must survive filtering.
  check('surviving groups still sorted by size', await listGroups([
    chat('small', [ME, '1@c.us']),
    chat('big', [ME, '1@c.us', '2@c.us', '3@c.us']),
    chat('gone', []),
  ], { wid: { _serialized: ME } }), ['big', 'small']);

  // SAFETY: if our own JID never appears — e.g. client.info reports a phone
  // number while the groups are LID-addressed — the membership test must be
  // abandoned rather than hiding every group.
  check('unmatched own JID does not wipe the list', await listGroups([
    chat('lid-a', ['111@lid', '222@lid']),
    chat('lid-b', ['333@lid']),
    chat('empty', []),
  ], { wid: { _serialized: ME } }), ['lid-a', 'lid-b']);

  // Same guard when the client reports no identity at all.
  check('missing client.info does not wipe the list', await listGroups([
    chat('a', ['1@c.us', '2@c.us']),
    chat('empty', []),
  ], null), ['a']);

  // A LID-addressed account should match on whichever JID form it reports.
  check('matches on client.info.lid', await listGroups([
    chat('mine', ['999@lid', '111@lid']),
    chat('removed', ['111@lid']),
  ], { wid: { _serialized: ME }, lid: { _serialized: '999@lid' } }), ['mine']);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
