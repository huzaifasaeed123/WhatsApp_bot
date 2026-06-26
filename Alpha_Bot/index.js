require('dotenv').config();
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const cron = require('node-cron');
const path = require('path');

const {
  state,
  client,
  initClient,
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
      // "Detached frame" means WhatsApp Web reloaded its page mid-request.
      // Wait a moment for the frame to re-attach and retry once.
      if (/detached frame/i.test(err.message)) {
        await new Promise((r) => setTimeout(r, 1500));
        allGroups = await getAllGroups();
      } else {
        throw err;
      }
    }
    res.render('groups', {
      allGroups,
      selectedGroups: state.selectedGroups,
      adminGroupId: state.adminGroupId,
    });
  } catch (err) {
    // If the frame is still detached, the session is unstable — send the
    // user back to the QR/home screen rather than a dead error page.
    if (/detached frame|session closed|target closed/i.test(err.message)) {
      return res.redirect('/');
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

// ─── Scheduled Messages (Pakistan timezone = UTC+5) ──────────────────────────
// cron runs in server local time; we convert PKT input to cron expression
app.post('/admin/schedule', requireLogin, upload.single('media'), (req, res) => {
  const { message, scheduledTime } = req.body; // scheduledTime: "HH:MM" in PKT
  if (!scheduledTime) return res.json({ ok: false, error: 'Scheduled time is required.' });

  // Convert PKT (UTC+5) to UTC for cron
  const [hStr, mStr] = scheduledTime.split(':');
  let hPkt = parseInt(hStr, 10);
  let mPkt = parseInt(mStr, 10);

  // PKT -> UTC: subtract 5 hours
  let hUtc = ((hPkt - 5) + 24) % 24;

  const cronExpr = `${mPkt} ${hUtc} * * *`;

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
  const label = req.body.label || `Schedule ${scheduledTime} PKT`;

  const job = cron.schedule(cronExpr, async () => {
    console.log(`Running scheduled message: ${label}`);
    // Snapshot groups at schedule run time
    const groups = [...state.selectedGroups];
    await broadcastMessage(groups, message || '', media, mediaType, effectiveDelay());
  }, { timezone: 'UTC' });

  state.schedules.push({
    id,
    label,
    scheduledTime, // PKT display
    cronExpr,
    message: message || '',
    hasMedia: !!media,
    job, // cron task reference
  });

  res.json({ ok: true, id, label, scheduledTime });
});

app.delete('/admin/schedule/:id', requireLogin, (req, res) => {
  const idx = state.schedules.findIndex((s) => s.id === req.params.id);
  if (idx === -1) return res.json({ ok: false, error: 'Schedule not found.' });
  state.schedules[idx].job.stop();
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
