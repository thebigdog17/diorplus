const https = require('https');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { MongoClient } = require('mongodb');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*', methods: ['GET','POST','DELETE'] } });

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ── MONGODB ────────────────────────────────────────────────────────────────
const MONGO_URI = 'mongodb+srv://diorplus:Iamdior17@cluster0.k2bxuhp.mongodb.net/?appName=Cluster0';
let db;
async function connectDB() {
  try {
    const client = new MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 15000 });
    await client.connect();
    db = client.db('diorplus');
    console.log('✅ Connected to MongoDB');
  } catch(e) {
    console.error('MongoDB error:', e.message);
    setTimeout(connectDB, 5000);
  }
}

// ── FILE UPLOADS ───────────────────────────────────────────────────────────
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => cb(null, uuidv4() + path.extname(file.originalname))
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });
app.use('/uploads', (req, res, next) => {
  res.setHeader('Cache-Control', 'public, max-age=86400');
  next();
}, express.static(UPLOADS_DIR));

// PWA explicit routes
app.get('/manifest.json', (req, res) => {
  res.setHeader('Content-Type', 'application/manifest+json');
  res.sendFile(path.join(__dirname, '../client/manifest.json'));
});
app.get('/sw.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Service-Worker-Allowed', '/');
  res.sendFile(path.join(__dirname, '../client/sw.js'));
});
app.get('/icon-192.png', (req, res) => {
  res.setHeader('Content-Type', 'image/png');
  res.sendFile(path.join(__dirname, '../client/icon-192.png'));
});
app.get('/icon-512.png', (req, res) => {
  res.setHeader('Content-Type', 'image/png');
  res.sendFile(path.join(__dirname, '../client/icon-512.png'));
});

// ── STATIC
app.use(express.static(path.join(__dirname, '../client')));

// Inject TMDB key safely
app.get('/api/config', (req, res) => {
  res.json({ tmdbKey: process.env.TMDB_API_KEY || '' });
});

// ── HELPERS ────────────────────────────────────────────────────────────────
function clean(doc) {
  if (!doc) return null;
  const { _id, password, ...rest } = doc;
  return rest;
}
function cleanNoPass(doc) {
  if (!doc) return null;
  const { _id, ...rest } = doc;
  return rest;
}

// ── AUTH ───────────────────────────────────────────────────────────────────
app.post('/api/register', async (req, res) => {
  try {
    const { name, username, password } = req.body;
    if (!name || !username || !password) return res.json({ error: 'Fill all fields' });
    const exists = await db.collection('users').findOne({ username: username.toLowerCase() });
    if (exists) return res.json({ error: 'Username taken' });
    const user = {
      id: uuidv4(), name, username: username.toLowerCase(),
      password, bio: '', photoUrl: '', link: '',
      followers: [], following: [], posts: [],
      verified: false, verifyTier: null,
      createdAt: Date.now()
    };
    await db.collection('users').insertOne(user);
    res.json({ user: clean(user) });
  } catch(e) { res.json({ error: 'Server error' }); }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const val = username?.toLowerCase();
    // Support login by username OR email
    const user = await db.collection('users').findOne({
      $or: [{ username: val }, { email: val }]
    });
    if (!user) return res.json({ error: 'User not found' });
    if (user.password !== password) return res.json({ error: 'Wrong password' });
    res.json({ user: clean(user) });
  } catch(e) { res.json({ error: 'Server error' }); }
});

// ── USERS ──────────────────────────────────────────────────────────────────
app.get('/api/users/search', async (req, res) => {
  try {
    const q = req.query.q || '';
    const cleanMap = u => ({
      id: u.id, name: u.name||'Unknown', username: u.username||'',
      photoUrl: u.photoUrl||'', verified: u.verified||false,
      verifyTier: u.verifyTier||null, bio: u.bio||''
    });
    // Return all users for cache loading
    if(!q || q === 'all') {
      const users = await db.collection('users').find({}).limit(200).toArray();
      return res.json(users.map(cleanMap));
    }
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const users = await db.collection('users').find({
      $or: [
        { username: { $regex: escaped, $options: 'i' } },
        { name: { $regex: escaped, $options: 'i' } }
      ]
    }).limit(50).toArray();
    res.json(users.map(cleanMap));
  } catch(e) {
    console.error('Search error:', e.message);
    res.json([]);
  }
});

app.get('/api/users/:id', async (req, res) => {
  try {
    const user = await db.collection('users').findOne({ id: req.params.id });
    res.json({ user: clean(user) });
  } catch(e) { res.json({ error: 'Not found' }); }
});

app.post('/api/users/:id/update', async (req, res) => {
  try {
    const updates = req.body;
    delete updates._id; delete updates.password;
    await db.collection('users').updateOne({ id: req.params.id }, { $set: updates });
    const user = await db.collection('users').findOne({ id: req.params.id });
    res.json({ user: clean(user) });
  } catch(e) { res.json({ error: 'Server error' }); }
});

app.post('/api/users/:id/photo', upload.single('photo'), async (req, res) => {
  try {
    const data = fs.readFileSync(req.file.path);
    const mime = req.file.mimetype || 'image/jpeg';
    const photoUrl = 'data:' + mime + ';base64,' + data.toString('base64');
    try { fs.unlinkSync(req.file.path); } catch(e) {}
    await db.collection('users').updateOne({ id: req.params.id }, { $set: { photoUrl } });
    res.json({ photoUrl });
  } catch(e) { res.json({ error: 'Upload failed' }); }
});

app.post('/api/users/:id/follow', async (req, res) => {
  try {
    const { followerId } = req.body;
    const target = await db.collection('users').findOne({ id: req.params.id });
    const isFollowing = target?.followers?.includes(followerId);
    if (isFollowing) {
      await db.collection('users').updateOne({ id: req.params.id }, { $pull: { followers: followerId } });
      await db.collection('users').updateOne({ id: followerId }, { $pull: { following: req.params.id } });
    } else {
      await db.collection('users').updateOne({ id: req.params.id }, { $addToSet: { followers: followerId } });
      await db.collection('users').updateOne({ id: followerId }, { $addToSet: { following: req.params.id } });
      io.to(req.params.id).emit('notification', { type: 'follow', fromId: followerId, text: 'started following you' });
    }
    const updated = await db.collection('users').findOne({ id: req.params.id });
    res.json({ following: !isFollowing, followers: updated.followers?.length || 0 });
  } catch(e) { res.json({ error: 'Server error' }); }
});

app.post('/api/users/:id/verify', async (req, res) => {
  try {
    const { tier } = req.body;
    await db.collection('users').updateOne({ id: req.params.id }, { $set: { verified: true, verifyTier: tier } });
    res.json({ ok: true });
  } catch(e) { res.json({ error: 'Server error' }); }
});

app.post('/api/users/:id/password', async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    const user = await db.collection('users').findOne({ id: req.params.id });
    if (!user || user.password !== oldPassword) return res.json({ error: 'Wrong current password' });
    await db.collection('users').updateOne({ id: req.params.id }, { $set: { password: newPassword } });
    res.json({ ok: true });
  } catch(e) { res.json({ error: 'Server error' }); }
});

// ── POSTS ──────────────────────────────────────────────────────────────────
app.get('/api/posts', async (req, res) => {
  try {
    const posts = await db.collection('posts').find({}).sort({ createdAt: -1 }).limit(50).toArray();
    res.json(posts.map(cleanNoPass));
  } catch(e) { res.json([]); }
});

app.post('/api/posts', upload.array('media', 10), async (req, res) => {
  try {
    const { userId, caption, mediaBase64 } = req.body;
    const user = await db.collection('users').findOne({ id: userId });
    let mediaUrls = [];
    // Convert uploaded files to base64 data URIs (survives Render restarts)
    if (req.files?.length) {
      for (const f of req.files) {
        const data = fs.readFileSync(f.path);
        const mime = f.mimetype || (f.originalname.endsWith('.mp4') ? 'video/mp4' : 'image/jpeg');
        mediaUrls.push('data:' + mime + ';base64,' + data.toString('base64'));
        try { fs.unlinkSync(f.path); } catch(e) {}
      }
    }
    if (mediaBase64) {
      const arr = JSON.parse(mediaBase64);
      for (const b64 of arr) mediaUrls.push(b64);
    }
    const post = {
      id: uuidv4(), userId, caption,
      mediaUrls, likes: [], comments: [],
      user: { id: user.id, name: user.name, username: user.username, photoUrl: user.photoUrl, verified: user.verified, verifyTier: user.verifyTier },
      createdAt: Date.now()
    };
    await db.collection('posts').insertOne(post);
    await db.collection('users').updateOne({ id: userId }, { $addToSet: { posts: post.id } });
    const clean = cleanNoPass(post);
    io.emit('new_post', clean);
    res.json({ post: clean });
  } catch(e) { res.json({ error: 'Post failed' }); }
});

app.post('/api/posts/:id/like', async (req, res) => {
  try {
    const { userId } = req.body;
    const post = await db.collection('posts').findOne({ id: req.params.id });
    const liked = post?.likes?.includes(userId);
    if (liked) await db.collection('posts').updateOne({ id: req.params.id }, { $pull: { likes: userId } });
    else {
      await db.collection('posts').updateOne({ id: req.params.id }, { $addToSet: { likes: userId } });
      if (post.userId !== userId) io.to(post.userId).emit('notification', { type: 'like', fromId: userId, postId: post.id, text: 'liked your post' });
    }
    const updated = await db.collection('posts').findOne({ id: req.params.id });
    io.emit('post_like', { postId: req.params.id, likes: updated.likes });
    res.json({ liked: !liked, likes: updated.likes });
  } catch(e) { res.json({ error: 'Server error' }); }
});

app.get('/api/posts/:id/comments', async (req, res) => {
  try {
    const comments = await db.collection('comments').find({ postId: req.params.id }).sort({ createdAt: 1 }).toArray();
    res.json(comments.map(cleanNoPass));
  } catch(e) { res.json([]); }
});

app.post('/api/posts/:id/comments', async (req, res) => {
  try {
    const { userId, text } = req.body;
    const user = await db.collection('users').findOne({ id: userId });
    const comment = {
      id: uuidv4(), postId: req.params.id, userId, text,
      user: { id: user.id, name: user.name, username: user.username, photoUrl: user.photoUrl },
      createdAt: Date.now()
    };
    await db.collection('comments').insertOne(comment);
    const post = await db.collection('posts').findOne({ id: req.params.id });
    if (post && post.userId !== userId) io.to(post.userId).emit('notification', { type: 'comment', fromId: userId, postId: post.id, text: 'commented on your post' });
    io.emit('new_comment', { postId: req.params.id, comment: cleanNoPass(comment) });
    res.json(cleanNoPass(comment));
  } catch(e) { res.json({ error: 'Server error' }); }
});

app.delete('/api/posts/:id', async (req, res) => {
  try {
    const post = await db.collection('posts').findOne({ id: req.params.id });
    if (post) {
      post.mediaUrls?.forEach(u => { try { fs.unlinkSync(path.join(__dirname, u)); } catch(e){} });
      await db.collection('posts').deleteOne({ id: req.params.id });
      await db.collection('comments').deleteMany({ postId: req.params.id });
      io.emit('delete_post', req.params.id);
    }
    res.json({ ok: true });
  } catch(e) { res.json({ error: 'Server error' }); }
});

app.post('/api/posts/:id/save', async (req, res) => {
  try {
    const { userId } = req.body;
    const user = await db.collection('users').findOne({ id: userId });
    const saved = user?.saved || [];
    if (saved.includes(req.params.id)) {
      await db.collection('users').updateOne({ id: userId }, { $pull: { saved: req.params.id } });
      res.json({ saved: false });
    } else {
      await db.collection('users').updateOne({ id: userId }, { $addToSet: { saved: req.params.id } });
      res.json({ saved: true });
    }
  } catch(e) { res.json({ error: 'Server error' }); }
});

// ── STORIES ────────────────────────────────────────────────────────────────
app.get('/api/stories', async (req, res) => {
  try {
    const cutoff = Date.now() - 24*60*60*1000;
    const stories = await db.collection('stories').find({ createdAt: { $gt: cutoff } }).sort({ createdAt: -1 }).toArray();
    res.json(stories.map(cleanNoPass));
  } catch(e) { res.json([]); }
});

app.post('/api/stories', upload.single('media'), async (req, res) => {
  try {
    const { userId, caption, mediaBase64 } = req.body;
    const user = await db.collection('users').findOne({ id: userId });
    let mediaUrl = '';
    if (req.file) {
      const data = fs.readFileSync(req.file.path);
      const mime = req.file.mimetype || 'image/jpeg';
      mediaUrl = 'data:' + mime + ';base64,' + data.toString('base64');
      try { fs.unlinkSync(req.file.path); } catch(e) {}
    }
    if (mediaBase64) mediaUrl = mediaBase64;
    const story = {
      id: uuidv4(), userId, caption, mediaUrl, seenBy: [],
      user: { id: user.id, name: user.name, username: user.username, photoUrl: user.photoUrl, verified: user.verified, verifyTier: user.verifyTier },
      createdAt: Date.now()
    };
    await db.collection('stories').insertOne(story);
    io.emit('new_story', cleanNoPass(story));
    res.json(cleanNoPass(story));
  } catch(e) { res.json({ error: 'Story failed' }); }
});

app.get('/api/stories/:id/viewers', async (req, res) => {
  try {
    const story = await db.collection('stories').findOne({ id: req.params.id });
    if (!story) return res.json([]);
    const viewers = await Promise.all((story.seenBy||[]).map(id => db.collection('users').findOne({ id })));
    res.json(viewers.filter(Boolean).map(u => ({ id: u.id, name: u.name, username: u.username, photoUrl: u.photoUrl })));
  } catch(e) { res.json([]); }
});

app.post('/api/stories/:id/view', async (req, res) => {
  try {
    const { userId } = req.body;
    await db.collection('stories').updateOne({ id: req.params.id }, { $addToSet: { seenBy: userId } });
    res.json({ ok: true });
  } catch(e) { res.json({ ok: false }); }
});

// ── MESSAGES ───────────────────────────────────────────────────────────────
app.get('/api/messages/:userId/:otherId', async (req, res) => {
  try {
    const { userId, otherId } = req.params;
    const msgs = await db.collection('messages').find({
      $or: [
        { fromId: userId, toId: otherId },
        { fromId: otherId, toId: userId }
      ]
    }).sort({ createdAt: 1 }).toArray();
    res.json(msgs.map(cleanNoPass));
  } catch(e) { res.json([]); }
});

app.post('/api/messages', async (req, res) => {
  try {
    const { fromId, toId, text } = req.body;
    const msg = { id: uuidv4(), fromId, toId, text, read: false, createdAt: Date.now() };
    await db.collection('messages').insertOne(msg);
    const clean = cleanNoPass(msg);
    io.to(toId).emit('new_message', clean);
    io.to(fromId).emit('new_message', clean);
    res.json(clean);
  } catch(e) { res.json({ error: 'Server error' }); }
});

app.post('/api/messages/clear', async (req, res) => {
  try {
    const { userId, otherId } = req.body;
    await db.collection('messages').deleteMany({
      $or: [{ fromId: userId, toId: otherId },{ fromId: otherId, toId: userId }]
    });
    res.json({ ok: true });
  } catch(e) { res.json({ error: 'Server error' }); }
});

app.post('/api/messages/read', async (req, res) => {
  try {
    const { fromId, toId } = req.body;
    await db.collection('messages').updateMany(
      { fromId, toId, read: { $ne: true } },
      { $set: { read: true } }
    );
    res.json({ ok: true });
  } catch(e) { res.json({ error: 'Server error' }); }
});

app.get('/api/conversations/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const msgs = await db.collection('messages').find({
      $or: [{ fromId: userId }, { toId: userId }]
    }).sort({ createdAt: -1 }).toArray();
    const seen = new Set();
    const convs = [];
    for (const m of msgs) {
      const otherId = m.fromId === userId ? m.toId : m.fromId;
      if (!seen.has(otherId)) {
        seen.add(otherId);
        const other = await db.collection('users').findOne({ id: otherId });
        if (other) {
          const unread = await db.collection('messages').countDocuments({
            fromId: otherId, toId: userId, read: { $ne: true }
          });
          convs.push({ userId: otherId, name: other.name, username: other.username, photoUrl: other.photoUrl, verified: other.verified, verifyTier: other.verifyTier, lastMsg: m.text, lastTime: m.createdAt, unread });
        }
      }
    }
    res.json(convs);
  } catch(e) { res.json([]); }
});

// ── GROUP CHATS ────────────────────────────────────────────────────────────
app.post('/api/groups', async (req, res) => {
  try {
    const { name, members, createdBy } = req.body;
    const group = { id: uuidv4(), name, members, createdBy, createdAt: Date.now() };
    await db.collection('groups').insertOne(group);
    const c = cleanNoPass(group);
    members.forEach(uid => io.to(uid).emit('new_group', c));
    res.json({ group: c });
  } catch(e) { res.json({ error: 'Server error' }); }
});

app.get('/api/groups', async (req, res) => {
  try {
    const { userId } = req.query;
    const groups = await db.collection('groups').find({ members: userId }).toArray();
    res.json(groups.map(cleanNoPass));
  } catch(e) { res.json([]); }
});

app.get('/api/groups/:id/messages', async (req, res) => {
  try {
    const msgs = await db.collection('groupMessages').find({ groupId: req.params.id }).sort({ createdAt: 1 }).toArray();
    res.json(msgs.map(cleanNoPass));
  } catch(e) { res.json([]); }
});

app.post('/api/groups/:id/messages', async (req, res) => {
  try {
    const { fromId, text, fromUsername } = req.body;
    const msg = { id: uuidv4(), groupId: req.params.id, fromId, fromUsername, text, createdAt: Date.now() };
    await db.collection('groupMessages').insertOne(msg);
    const c = cleanNoPass(msg);
    const group = await db.collection('groups').findOne({ id: req.params.id });
    if (group) group.members.forEach(uid => io.to(uid).emit('gc_message', c));
    res.json(c);
  } catch(e) { res.json({ error: 'Server error' }); }
});

// ── REELS ──────────────────────────────────────────────────────────────────
app.get('/api/reels', async (req, res) => {
  try {
    const reels = await db.collection('reels').find({}).sort({ createdAt: -1 }).limit(30).toArray();
    res.json(reels.map(cleanNoPass));
  } catch(e) { res.json([]); }
});

app.post('/api/reels', upload.single('video'), async (req, res) => {
  try {
    const { userId, caption } = req.body;
    const user = await db.collection('users').findOne({ id: userId });
    let videoUrl = '';
    if (req.file) {
      const data = fs.readFileSync(req.file.path);
      const mime = req.file.mimetype || 'video/mp4';
      videoUrl = 'data:' + mime + ';base64,' + data.toString('base64');
      try { fs.unlinkSync(req.file.path); } catch(e) {}
    }
    const reel = {
      id: uuidv4(), userId, caption, videoUrl, likes: [], views: 0,
      user: { id: user.id, name: user.name, username: user.username, photoUrl: user.photoUrl, verified: user.verified, verifyTier: user.verifyTier },
      createdAt: Date.now()
    };
    await db.collection('reels').insertOne(reel);
    res.json(cleanNoPass(reel));
  } catch(e) { res.json({ error: 'Reel failed' }); }
});

app.post('/api/reels/:id/like', async (req, res) => {
  try {
    const { userId } = req.body;
    const reel = await db.collection('reels').findOne({ id: req.params.id });
    const liked = reel?.likes?.includes(userId);
    if (liked) await db.collection('reels').updateOne({ id: req.params.id }, { $pull: { likes: userId } });
    else await db.collection('reels').updateOne({ id: req.params.id }, { $addToSet: { likes: userId } });
    const updated = await db.collection('reels').findOne({ id: req.params.id });
    res.json({ liked: !liked, likes: updated.likes?.length || 0 });
  } catch(e) { res.json({ error: 'Server error' }); }
});

// ── FORGOT PASSWORD ────────────────────────────────────────────────────────
const resetCodes = new Map(); // temporary in-memory store
app.post('/api/messages/clear', async (req, res) => {
  try {
    const { userId, otherId } = req.body;
    await db.collection('messages').deleteMany({
      $or:[{fromId:userId,toId:otherId},{fromId:otherId,toId:userId}]
    });
    res.json({ ok: true });
  } catch(e) { res.json({ error: 'Server error' }); }
});

app.post('/api/users/:id/block', async (req, res) => {
  try {
    const { blockerId } = req.body;
    await db.collection('users').updateOne({id:blockerId},{$addToSet:{blocked:req.params.id}});
    res.json({ ok: true });
  } catch(e) { res.json({ error: 'Server error' }); }
});

app.post('/api/auth/forgot', async (req, res) => {
  try {
    const { value } = req.body;
    const user = await db.collection('users').findOne({
      $or: [{ username: value?.toLowerCase() }, { email: value?.toLowerCase() }]
    });
    if (!user) return res.json({ error: 'No account found with that username or email' });
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    resetCodes.set(user.id, { code, expires: Date.now() + 600000 }); // 10 min
    console.log(`Reset code for ${user.username}: ${code}`);
    res.json({ code, userId: user.id }); // In production send via email; here we return it
  } catch(e) { res.json({ error: 'Server error' }); }
});
app.post('/api/auth/reset', async (req, res) => {
  try {
    const { userId, newPassword } = req.body;
    const entry = resetCodes.get(userId);
    if (!entry || Date.now() > entry.expires) return res.json({ error: 'Code expired' });
    await db.collection('users').updateOne({ id: userId }, { $set: { password: newPassword } });
    resetCodes.delete(userId);
    res.json({ ok: true });
  } catch(e) { res.json({ error: 'Server error' }); }
});

// ── AI PROXY (HuggingFace router) ─────────────────────────────────────────
app.post('/api/ai/chat', async (req, res) => {
  try {
    const { messages, userName } = req.body;
    const HF_KEY = process.env.HF_API_KEY || '';
    const systemPrompt = `You are DIOR+ AI, a helpful assistant inside the DIOR+ social media app. Answer any question clearly and helpfully. Help with captions, hashtags, advice, motivation, general knowledge, and chat. Be concise — this is a mobile app. The user's name is ${userName || 'there'}.`;
    const hfMessages = [{ role: 'system', content: systemPrompt }, ...(messages || []).slice(-10).map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }))];
    const body = JSON.stringify({ model: 'meta-llama/Llama-3.1-8B-Instruct:cerebras', messages: hfMessages, max_tokens: 400, temperature: 0.8 });
    const options = {
      hostname: 'router.huggingface.co',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + HF_KEY, 'Content-Length': Buffer.byteLength(body) }
    };
    const apiReq = https.request(options, apiRes => {
      let data = '';
      apiRes.on('data', chunk => data += chunk);
      apiRes.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if(parsed.error) return res.json({ content:[{text:'AI error: '+parsed.error.message}] });
          const text = parsed.choices?.[0]?.message?.content || "Sorry, I couldn't get a response. Try again!";
          res.json({ content: [{ text: text.trim() }] });
        } catch(e) {
          res.json({ content:[{text:'AI response error. Try again!'}] });
        }
      });
    });
    apiReq.on('error', e => res.json({ content:[{text:'Could not reach AI.'}] }));
    apiReq.write(body);
    apiReq.end();
  } catch(e) { res.json({ content:[{text:'AI error: '+e.message}] }); }
});

// ── MUSIC: SoundCloud search proxy ────────────────────────────────────────
app.get('/api/music/search', async (req, res) => {
  try {
    const q = req.query.q || 'trending';
    // SoundCloud public search via their resolve API (no key needed for public tracks)
    const url = `https://api-v2.soundcloud.com/search/tracks?q=${encodeURIComponent(q)}&limit=20&client_id=iZIs9mchVcX5lhVRyQGGAYlNPVldzAoX`;
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if(!r.ok) throw new Error('SC error '+r.status);
    const data = await r.json();
    const tracks = (data.collection||[]).map(t => ({
      id: t.id,
      title: t.title || 'Unknown',
      artist: t.user?.username || 'Unknown',
      art: t.artwork_url ? t.artwork_url.replace('large','t300x300') : '',
      url: t.permalink_url || '',
      duration: t.duration ? Math.floor(t.duration/60000)+':'+(Math.floor((t.duration%60000)/1000)).toString().padStart(2,'0') : ''
    }));
    res.json({ tracks });
  } catch(e) {
    console.error('Music search error:', e.message);
    res.json({ tracks: [] });
  }
});

// ── MUSIC: Genius lyrics proxy ─────────────────────────────────────────────
app.get('/api/music/lyrics', async (req, res) => {
  try {
    const { title, artist } = req.query;
    const GENIUS_KEY = process.env.GENIUS_API_KEY || 'NNTS_YJ0HhnT1B-OFeIYKRqgRT6PryvLh9jLdmYeyJYblYRSdlezfD-TGTy0tHJR';
    const q = encodeURIComponent((artist||'')+' '+(title||''));
    // Search Genius for the song
    const searchUrl = `https://api.genius.com/search?q=${q}`;
    const searchRes = await fetch(searchUrl, { headers: { 'Authorization': 'Bearer '+GENIUS_KEY } });
    const searchData = await searchRes.json();
    const hit = searchData.response?.hits?.[0]?.result;
    if(!hit) return res.json({ lyrics: 'Lyrics not found for this song.' });
    // Scrape lyrics page
    const pageRes = await fetch(hit.url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const html = await pageRes.text();
    // Extract lyrics from Genius HTML
    const match = html.match(/data-lyrics-container="true"[^>]*>([\s\S]*?)<\/div>/g);
    if(!match) return res.json({ lyrics: 'Could not extract lyrics. Visit: '+hit.url });
    const lyrics = match.map(m => m.replace(/<br[^>]*>/gi,'\n').replace(/<[^>]+>/g,'').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#x27;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>')).join('\n').trim();
    res.json({ lyrics: lyrics || 'Lyrics not found.' });
  } catch(e) {
    console.error('Lyrics error:', e.message);
    res.json({ lyrics: 'Could not load lyrics. Try again.' });
  }
});

app.post('/api/reports', async (req, res) => {
  try {
    const report = { id: uuidv4(), ...req.body, status: 'pending', createdAt: Date.now() };
    await db.collection('reports').insertOne(report);
    res.json({ ok: true });
  } catch(e) { res.json({ error: 'Server error' }); }
});



// ── NOTIFICATIONS ──────────────────────────────────────────────────────────
app.get('/api/notifications/:userId', async (req, res) => {
  try {
    const notifs = await db.collection('notifications').find({ toId: req.params.userId }).sort({ createdAt: -1 }).limit(50).toArray();
    res.json(notifs.map(cleanNoPass));
  } catch(e) { res.json([]); }
});

// ── SOCKET ─────────────────────────────────────────────────────────────────
const onlineUsers = new Map();
io.on('connection', socket => {
  socket.on('auth', ({ userId }) => {
    socket.join(userId);
    onlineUsers.set(socket.id, userId);
    io.emit('user_online', { userId });
  });

  socket.on('join_group', ({ groupId }) => socket.join('group_' + groupId));

  socket.on('typing', ({ toId, fromId }) => io.to(toId).emit('typing', { fromId }));
  socket.on('stop_typing', ({ toId, fromId }) => io.to(toId).emit('stop_typing', { fromId }));

  socket.on('live_start', ({ userId, user }) => {
    socket.join('live_' + userId);
    socket.broadcast.emit('live_available', { streamId: userId, host: user });
  });
  socket.on('live_end', ({ userId }) => {
    io.emit('live_ended', { userId });
    socket.leave('live_' + userId);
  });
  socket.on('join_live', ({ streamId, user }) => {
    socket.join('live_' + streamId);
    // Notify everyone in the room (including host) that viewer joined
    io.to('live_' + streamId).emit('viewer_joined', { user, viewerCount: io.sockets.adapter.rooms.get('live_' + streamId)?.size || 0 });
    // Tell host a viewer joined so they know to keep sending frames
    socket.to('live_' + streamId).emit('viewer_wants_stream', { viewerSocketId: socket.id, user });
  });
  socket.on('leave_live', ({ streamId }) => {
    socket.leave('live_' + streamId);
    io.to('live_' + streamId).emit('viewer_left', { viewerCount: io.sockets.adapter.rooms.get('live_' + streamId)?.size || 0 });
  });
  socket.on('live_comment', ({ streamId, user, text }) => io.to('live_' + streamId).emit('live_comment', { user, text }));
  // Canvas frame relay: host sends JPEG frames, server relays to viewers
  socket.on('live_frame', ({ streamId, frame }) => {
    socket.to('live_' + streamId).emit('live_frame', { frame });
  });
  socket.on('live_gift', ({ streamId, user, gift, coins }) => {
    io.to('live_' + streamId).emit('live_gift', { user, gift, coins });
    io.to(streamId).emit('live_gift', { user, gift, coins });
  });

  // Call invite notification
  socket.on('call_invite', ({ toUserId, fromUser, callType }) => {
    io.to(toUserId).emit('call_invite', { fromUser, callType });
  });

  socket.on('webrtc_offer', ({ to, offer, callType, from }) => io.to(to).emit('webrtc_offer', { from: socket.id, offer, callType, fromUser: null, from }));
  socket.on('webrtc_answer', ({ to, answer }) => io.to(to).emit('webrtc_answer', { answer }));

  // Live stream WebRTC signaling (host → viewers)
  socket.on('live_offer_to_viewer', ({ to, offer, fromSocketId }) => {
    io.to(to).emit('live_stream_track', { offer, fromSocketId });
  });
  socket.on('live_viewer_answer_to_host', ({ to, answer, streamId }) => {
    io.to(to).emit('live_viewer_answered_'+socket.id, { answer });
    io.to(to).emit('live_viewer_answer', { answer });
  });
  socket.on('live_ice_to_viewer', ({ to, candidate }) => {
    io.to(to).emit('live_viewer_ice', { candidate });
  });
  socket.on('live_viewer_ice_to_host', ({ to, candidate }) => {
    io.to(to).emit('live_ice_from_viewer_'+socket.id, { candidate });
  });
  socket.on('live_viewer_count_update', ({ streamId, count }) => {
    io.to('live_'+streamId).emit('live_viewer_count', { viewerCount: count });
  });
  socket.on('webrtc_ice', ({ to, candidate }) => io.to(to).emit('webrtc_ice', { candidate }));
  socket.on('call_ended', ({ to }) => io.to(to).emit('call_ended'));
  socket.on('call_rejected', ({ to }) => io.to(to).emit('call_rejected'));

  socket.on('disconnect', () => {
    const userId = onlineUsers.get(socket.id);
    if (userId) { onlineUsers.delete(socket.id); io.emit('user_offline', { userId }); }
  });
});

// ── START ──────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`DIOR+ running on port ${PORT}`);
  connectDB();
});
