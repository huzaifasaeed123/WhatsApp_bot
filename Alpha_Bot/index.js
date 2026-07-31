require('dotenv').config();
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const path = require('path');

const {
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
  sleep,
  MessageMedia,
} = require('./whatsapp');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

// ─── Config ──────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@example.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const SESSION_SECRET = process.env.SESSION_SECRET || 'alpha-bot-secret-2024';

// ─── Middleware ───────────────────────────────────────────────────────────────
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }, // 24 hours
}));

// Auth guard middleware
function requireLogin(req, res, next) {
  if (req.session.loggedIn) return next();
  res.redirect('/login');
}

// ─── Auth Routes ─────────────────────────────────────────────────────────────
app.get('/login', (req, res) => {
  if (req.session.loggedIn) return res.redirect('/');
  res.render('login', { error: null });
});

app.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
    req.session.loggedIn = true;
    initClient(); // start WhatsApp on first login
    return res.redirect('/');
  }
  res.render('login', { error: 'Invalid email or password.' });
});

app.post('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

// ─── Home / QR Page ──────────────────────────────────────────────────────────
app.get('/', requireLogin, (req, res) => {
  if (!state.isReady && !state.qrCodeDataUrl) {
    // Still initializing
    return res.render('connecting', {});
  }
  if (!state.isReady && state.qrCodeDataUrl) {
    return res.render('qr', { qrCode: state.qrCodeDataUrl });
  }
  res.redirect('/groups');
});

// API: poll WhatsApp connection status
app.get('/api/status', requireLogin, (req, res) => {
  res.json({
    isReady: state.isReady,
    hasQr: !!state.qrCodeDataUrl,
    qrCode: state.qrCodeDataUrl,
    selectedGroups: state.selectedGroups,
    adminGroupId: state.adminGroupId,
    delaySeconds: state.delaySeconds,
  });
});

// ─── Group Selection ─────────────────────────────────────────────────────────
app.get('/groups', requireLogin, async (req, res) => {
  if (!state.isReady) return res.redirect('/');
  try {
    let allGroups;
    try {
      allGroups = await getAllGroups();
    } catch (err) {
      // Errors thrown inside WhatsApp Web's own minified bundle arrive with
      // useless one-character messages ("r"), so match on nothing and just
      // retry once — the common causes (page reloading, chat store not yet
      // synced after a restart) all resolve on their own within seconds.
      console.error('getAllGroups failed, retrying:', err.stack || err.message);
      await new Promise((r) => setTimeout(r, 3000));
      allGroups = await getAllGroups();
    }
    res.render('groups', {
      allGroups,
      selectedGroups: state.selectedGroups,
      adminGroupId: state.adminGroupId,
    });
  } catch (err) {
    // Log the full stack — err.message alone is frequently a minified symbol
    // that says nothing about what actually went wrong.
    console.error('/groups failed:', err.stack || err.message);

    // A transient page problem is worth a trip back to the home screen.
    if (/detached frame|session closed|target closed|execution context/i.test(err.message)) {
      state.isReady = false; // force the home page to re-evaluate the session
      return res.redirect('/');
    }

    // A short, minified message means the throw came from inside WhatsApp Web's
    // own bundle — the library can't read the current web build. Redirecting
    // would just loop; show what's actually wrong instead.
    if (err.message.length < 20) {
      return res.render('error', {
        message:
          'WhatsApp Web changed its internal layout and this bot version cannot read it. ' +
          'Set the WA_WEB_VERSION env var to a different build, or upgrade whatsapp-web.js. ' +
          `(underlying error: "${err.message}")`,
      });
    }

    res.render('error', { message: err.message });
  }
});

app.post('/groups/select', requireLogin, (req, res) => {
  const { groupIds, adminGroupId } = req.body;
  const ids = Array.isArray(groupIds) ? groupIds : groupIds ? [groupIds] : [];

  // Only the selected ids are submitted. Names, member counts, and member IDs
  // are looked up from the in-memory cache populated by getAllGroups() — no
  // extra WhatsApp call, and no large payload travelling through the form.
  const uniqueMembers = new Set();
  state.selectedGroups = ids.map((id) => {
    const cached = getCachedGroup(id);
    const memberIds = cached ? cached.memberIds || [] : [];
    memberIds.forEach((m) => uniqueMembers.add(m));
    return {
      id,
      name: cached ? cached.name : id,
      memberCount: cached ? cached.memberCount : 0,
      memberIds,
    };
  });
  state.uniqueMemberCount = uniqueMembers.size; // de-duplicated across selected groups
  state.adminGroupId = adminGroupId || null;
  saveSettings(); // persist selection to the volume so it survives restarts
  res.redirect('/admin');
});

// ─── Admin Panel ──────────────────────────────────────────────────────────────
app.get('/admin', requireLogin, (req, res) => {
  if (!state.isReady) return res.redirect('/');
  if (state.selectedGroups.length === 0) return res.redirect('/groups');
  res.render('admin', {
    selectedGroups: state.selectedGroups,
    uniqueMemberCount: state.uniqueMemberCount || 0,
    adminGroupId: state.adminGroupId,
    delaySeconds: state.delaySeconds,
    schedules: state.schedules,
  });
});

// Update delay setting
app.post('/admin/delay', requireLogin, (req, res) => {
  const val = parseInt(req.body.delaySeconds, 10);
  if (!isNaN(val) && val >= 0) state.delaySeconds = val;
  saveSettings(); // persist delay setting
  res.json({ ok: true, delaySeconds: state.delaySeconds });
});

// ─── Group Management Actions ────────────────────────────────────────────────

function effectiveDelay() {
  return 2000 + state.delaySeconds * 1000;
}

// Update description for all selected groups
app.post('/admin/update-description', requireLogin, async (req, res) => {
  const { description } = req.body;
  if (!description) return res.json({ ok: false, error: 'Description is required.' });
  try {
    const results = await bulkAction(state.selectedGroups, async (group) => {
      await updateGroupDescription(group.id, description);
    }, effectiveDelay());
    res.json({ ok: true, results });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// Update subject/name for all selected groups
app.post('/admin/update-subject', requireLogin, async (req, res) => {
  const { subject } = req.body;
  if (!subject) return res.json({ ok: false, error: 'Subject is required.' });
  try {
    const results = await bulkAction(state.selectedGroups, async (group) => {
      await updateGroupSubject(group.id, subject);
    }, effectiveDelay());
    res.json({ ok: true, results });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// Update group DP (profile picture)
app.post('/admin/update-dp', requireLogin, upload.single('dp'), async (req, res) => {
  if (!req.file) return res.json({ ok: false, error: 'No image uploaded.' });
  const base64 = req.file.buffer.toString('base64');
  const mime = req.file.mimetype;
  try {
    const results = await bulkAction(state.selectedGroups, async (group) => {
      await updateGroupPhoto(group.id, base64, mime);
    }, effectiveDelay());
    res.json({ ok: true, results });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// Update group permissions
app.post('/admin/update-permissions', requireLogin, async (req, res) => {
  const settings = {
    messagesAdminsOnly: req.body.messagesAdminsOnly === 'true',
    infoAdminsOnly: req.body.infoAdminsOnly === 'true',
  };
  try {
    const results = await bulkAction(state.selectedGroups, async (group) => {
      await updateGroupSettings(group.id, settings);
    }, effectiveDelay());
    res.json({ ok: true, results });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// ─── Member Management ────────────────────────────────────────────────────────

// Add a number to all selected groups
app.post('/admin/add-member', requireLogin, async (req, res) => {
  let { phone } = req.body;
  if (!phone) return res.json({ ok: false, error: 'Phone number is required.' });

  // Normalize: strip spaces/dashes, add @c.us
  phone = phone.replace(/[\s\-\+\(\)]/g, '');
  const participantId = phone.includes('@c.us') ? phone : `${phone}@c.us`;

  try {
    const results = await bulkAction(state.selectedGroups, async (group) => {
      const chat = await client.getChatById(group.id);
      await chat.addParticipants([participantId]);
    }, effectiveDelay());
    res.json({ ok: true, results });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// Make a number admin in all selected groups
app.post('/admin/make-admin', requireLogin, async (req, res) => {
  let { phone } = req.body;
  if (!phone) return res.json({ ok: false, error: 'Phone number is required.' });

  phone = phone.replace(/[\s\-\+\(\)]/g, '');
  const participantId = phone.includes('@c.us') ? phone : `${phone}@c.us`;

  try {
    const results = await bulkAction(state.selectedGroups, async (group) => {
      const chat = await client.getChatById(group.id);
      await chat.promoteParticipants([participantId]);
    }, effectiveDelay());
    res.json({ ok: true, results });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// Remove admin from a number in all selected groups
app.post('/admin/remove-admin', requireLogin, async (req, res) => {
  let { phone } = req.body;
  if (!phone) return res.json({ ok: false, error: 'Phone number is required.' });

  phone = phone.replace(/[\s\-\+\(\)]/g, '');
  const participantId = phone.includes('@c.us') ? phone : `${phone}@c.us`;

  try {
    const results = await bulkAction(state.selectedGroups, async (group) => {
      const chat = await client.getChatById(group.id);
      await chat.demoteParticipants([participantId]);
    }, effectiveDelay());
    res.json({ ok: true, results });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// Remove a number from all selected groups
app.post('/admin/remove-member', requireLogin, async (req, res) => {
  let { phone } = req.body;
  if (!phone) return res.json({ ok: false, error: 'Phone number is required.' });

  phone = phone.replace(/[\s\-\+\(\)]/g, '');
  const participantId = phone.includes('@c.us') ? phone : `${phone}@c.us`;

  try {
    const results = await bulkAction(state.selectedGroups, async (group) => {
      const chat = await client.getChatById(group.id);
      await chat.removeParticipants([participantId]);
    }, effectiveDelay());
    res.json({ ok: true, results });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// ─── Broadcast Message ────────────────────────────────────────────────────────
app.post('/admin/broadcast', requireLogin, upload.single('media'), async (req, res) => {
  const { message } = req.body;
  let media = null;
  let mediaType = null;

  if (req.file) {
    const base64 = req.file.buffer.toString('base64');
    const mime = req.file.mimetype;
    media = new MessageMedia(mime, base64, req.file.originalname);
    if (mime.startsWith('audio/')) mediaType = 'audio';
    else if (mime.startsWith('image/')) mediaType = 'image';
    else if (mime.startsWith('video/')) mediaType = 'video';
    else mediaType = 'document';
  }

  if (!message && !media) {
    return res.json({ ok: false, error: 'Message or media is required.' });
  }

  try {
    const results = await broadcastMessage(
      state.selectedGroups,
      message || '',
      media,
      mediaType,
      effectiveDelay()
    );
    res.json({ ok: true, results });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// ─── One-Time Scheduled Messages (Pakistan timezone = UTC+5) ─────────────────
// Sends the message ONCE at a specific date + time (PKT), then auto-removes.
app.post('/admin/schedule', requireLogin, upload.single('media'), (req, res) => {
  const { message, scheduledDateTime } = req.body; // "YYYY-MM-DDTHH:MM" in PKT
  if (!scheduledDateTime) return res.json({ ok: false, error: 'Scheduled date and time are required.' });

  // Interpret the input as Pakistan time (UTC+5) and convert to a UTC timestamp.
  // datetime-local has no timezone, so we append +05:00 explicitly.
  const targetMs = Date.parse(`${scheduledDateTime}:00+05:00`);
  if (Number.isNaN(targetMs)) {
    return res.json({ ok: false, error: 'Invalid date/time.' });
  }

  const delayMs = targetMs - Date.now();
  if (delayMs <= 0) {
    return res.json({ ok: false, error: 'Scheduled time must be in the future.' });
  }

  let media = null;
  let mediaType = null;

  if (req.file) {
    const base64 = req.file.buffer.toString('base64');
    const mime = req.file.mimetype;
    media = new MessageMedia(mime, base64, req.file.originalname);
    if (mime.startsWith('audio/')) mediaType = 'audio';
    else if (mime.startsWith('image/')) mediaType = 'image';
    else if (mime.startsWith('video/')) mediaType = 'video';
    else mediaType = 'document';
  }

  if (!message && !media) {
    return res.json({ ok: false, error: 'Message or media is required.' });
  }

  const id = Date.now().toString();
  // Display string in PKT (e.g. "2026-06-30 14:30")
  const displayTime = scheduledDateTime.replace('T', ' ');
  const label = req.body.label || `Schedule for ${displayTime} PKT`;

  // One-shot timer — fires once, sends, then removes itself from the list.
  const timer = setTimeout(async () => {
    console.log(`Running one-time scheduled message: ${label}`);
    try {
      const groups = [...state.selectedGroups]; // snapshot at run time
      await broadcastMessage(groups, message || '', media, mediaType, effectiveDelay());
    } catch (err) {
      console.error('Scheduled send failed:', err.message);
    }
    // Remove from active list once sent.
    const i = state.schedules.findIndex((s) => s.id === id);
    if (i !== -1) state.schedules.splice(i, 1);
  }, delayMs);

  state.schedules.push({
    id,
    label,
    scheduledTime: displayTime, // PKT display
    message: message || '',
    hasMedia: !!media,
    timer, // setTimeout handle
  });

  res.json({ ok: true, id, label, scheduledTime: displayTime });
});

app.delete('/admin/schedule/:id', requireLogin, (req, res) => {
  const idx = state.schedules.findIndex((s) => s.id === req.params.id);
  if (idx === -1) return res.json({ ok: false, error: 'Schedule not found.' });
  clearTimeout(state.schedules[idx].timer);
  state.schedules.splice(idx, 1);
  res.json({ ok: true });
});

app.get('/admin/schedules', requireLogin, (req, res) => {
  const list = state.schedules.map(({ id, label, scheduledTime, message, hasMedia }) => ({
    id, label, scheduledTime, message, hasMedia,
  }));
  res.json(list);
});

// ─── Start Server ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Alpha Bot running at http://localhost:${PORT}`);
});
