const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const multer = require('multer');
const crypto = require('crypto');
const { User, File } = require('./models');
const { sign, requireAuth } = require('./auth');
const storage = require('./storage');

const QUOTA = 100 * 1024 * 1024;     // 100 MB per user
const MAX_FILE = 25 * 1024 * 1024;   // 25 MB per file
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE } });

const app = express();
app.use(cors());
app.use(express.json());

// Send any thrown error back as JSON instead of crashing the server
const h = (fn) => (req, res) => fn(req, res).catch((e) => res.status(400).json({ error: e.message }));

const usedBytes = async (ownerId) => {
  const r = await File.aggregate([
    { $match: { owner: new mongoose.Types.ObjectId(ownerId) } },
    { $group: { _id: null, sum: { $sum: '$size' } } },
  ]);
  return r[0]?.sum || 0;
};

async function sendFile(file, res) {
  const stream = await storage.get(file.key);
  stream.on('error', () => res.destroy());
  res.attachment(file.name);
  stream.pipe(res);
}

app.get('/api/health', (_req, res) => res.json({ ok: true, storage: storage.mode }));

// ---------- auth ----------
app.post('/api/auth/register', h(async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password are required.' });
  try {
    const user = await User.create({ name, email, password: await bcrypt.hash(password, 10) });
    res.json({ token: sign(user), user: { name: user.name, email: user.email } });
  } catch (e) {
    res.status(400).json({ error: e.code === 11000 ? 'That email is already registered.' : e.message });
  }
}));

app.post('/api/auth/login', h(async (req, res) => {
  const user = await User.findOne({ email: (req.body.email || '').toLowerCase() });
  if (!user || !(await bcrypt.compare(req.body.password || '', user.password))) {
    return res.status(401).json({ error: 'Email or password is incorrect.' });
  }
  res.json({ token: sign(user), user: { name: user.name, email: user.email } });
}));

// ---------- files ----------
app.get('/api/usage', requireAuth(), h(async (req, res) => {
  res.json({ used: await usedBytes(req.user.id), quota: QUOTA, maxFile: MAX_FILE });
}));

app.get('/api/files', requireAuth(), h(async (req, res) => {
  const mine = await File.find({ owner: req.user.id }).select('-key').populate('sharedWith', 'name email').sort('-createdAt');
  const shared = await File.find({ sharedWith: req.user.id }).select('-key -shareToken').populate('owner', 'name').sort('-createdAt');
  res.json({ mine, shared });
}));

app.post('/api/files', requireAuth(), (req, res) => {
  upload.single('file')(req, res, async (err) => {
    try {
      if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Files can be at most 25 MB.' : err.message });
      if (!req.file) return res.status(400).json({ error: 'Choose a file to upload.' });
      if ((await usedBytes(req.user.id)) + req.file.size > QUOTA) {
        return res.status(413).json({ error: 'Not enough space left. Delete some files first.' });
      }
      const key = crypto.randomUUID();
      await storage.put(key, req.file.buffer, req.file.mimetype);
      const name = Buffer.from(req.file.originalname, 'latin1').toString('utf8'); // fix non-ASCII names
      const file = await File.create({ owner: req.user.id, name, size: req.file.size, mime: req.file.mimetype, key });
      res.json({ id: file._id, name: file.name });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
});

app.get('/api/files/:id/download', requireAuth(), h(async (req, res) => {
  const file = await File.findById(req.params.id);
  const allowed = file && (String(file.owner) === req.user.id || file.sharedWith.some((u) => String(u) === req.user.id));
  if (!allowed) return res.status(404).json({ error: 'File not found.' });
  await sendFile(file, res);
}));

app.delete('/api/files/:id', requireAuth(), h(async (req, res) => {
  const file = await File.findOneAndDelete({ _id: req.params.id, owner: req.user.id });
  if (!file) return res.status(404).json({ error: 'File not found.' });
  await storage.remove(file.key);
  res.json({ deleted: true });
}));

// ---------- sharing with another user ----------
app.post('/api/files/:id/share', requireAuth(), h(async (req, res) => {
  const target = await User.findOne({ email: (req.body.email || '').toLowerCase() });
  if (!target) return res.status(404).json({ error: 'No account with that email.' });
  if (String(target._id) === req.user.id) return res.status(400).json({ error: 'That is your own account.' });
  const file = await File.findOneAndUpdate(
    { _id: req.params.id, owner: req.user.id }, { $addToSet: { sharedWith: target._id } }, { new: true });
  if (!file) return res.status(404).json({ error: 'File not found.' });
  res.json({ shared: target.email });
}));

app.delete('/api/files/:id/share/:userId', requireAuth(), h(async (req, res) => {
  await File.updateOne({ _id: req.params.id, owner: req.user.id }, { $pull: { sharedWith: req.params.userId } });
  res.json({ ok: true });
}));

// ---------- public link (expires) ----------
app.post('/api/files/:id/link', requireAuth(), h(async (req, res) => {
  const days = Math.min(Math.max(Number(req.body.days) || 1, 1), 30);
  const token = crypto.randomBytes(16).toString('hex');
  const file = await File.findOneAndUpdate(
    { _id: req.params.id, owner: req.user.id },
    { shareToken: token, shareExpires: new Date(Date.now() + days * 86400000) }, { new: true });
  if (!file) return res.status(404).json({ error: 'File not found.' });
  res.json({ token, expires: file.shareExpires });
}));

app.delete('/api/files/:id/link', requireAuth(), h(async (req, res) => {
  await File.updateOne({ _id: req.params.id, owner: req.user.id }, { $unset: { shareToken: '', shareExpires: '' } });
  res.json({ ok: true });
}));

// no login needed, only the secret token
app.get('/api/public/:token', h(async (req, res) => {
  const file = await File.findOne({ shareToken: req.params.token });
  if (!file || !file.shareExpires || file.shareExpires < new Date()) {
    return res.status(404).json({ error: 'This link has expired or does not exist.' });
  }
  await sendFile(file, res);
}));

// ---------- start (retry until MongoDB is up) ----------
async function start() {
  const uri = process.env.MONGO_URI || 'mongodb://localhost:27017/clouddrive';
  for (let i = 0; i < 20; i++) {
    try { await mongoose.connect(uri); break; }
    catch { console.log('Waiting for MongoDB...'); await new Promise((r) => setTimeout(r, 3000)); }
  }
  app.listen(process.env.PORT || 5000, () => console.log('API running, storage:', storage.mode));
}
start();
