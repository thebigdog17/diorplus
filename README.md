# DIOR+ — Full Stack Social App

## What this is
A real-time social app with:
- ✅ User accounts (register/login)
- ✅ Posts & stories that **persist forever** (saved to disk)
- ✅ Real-time feed updates (Socket.IO — everyone sees new posts instantly)
- ✅ Real-time messaging between users
- ✅ **Live streaming with your camera** (WebRTC — viewers see your actual camera)
- ✅ People can search and join your live
- ✅ Live comments & reactions in real-time
- ✅ Follow/unfollow users
- ✅ Notifications (likes, comments, follows)
- ✅ Photo/video upload and storage

---

## How to run it (5 minutes)

### Option 1 — Run on your computer (local)

1. Install Node.js from https://nodejs.org (v18 or later)

2. Open a terminal and run:
```bash
cd server
npm install
node index.js
```

3. Open your browser to: **http://localhost:3000**

4. Anyone on your **same WiFi** can access it at: **http://YOUR_IP:3000**
   (Find your IP with `ipconfig` on Windows or `ifconfig` on Mac)

---

### Option 2 — Deploy FREE to Railway (anyone on the internet can use it)

1. Go to https://railway.app and sign up (free)

2. Click "New Project" → "Deploy from GitHub"

3. Push this folder to GitHub first:
```bash
git init
git add .
git commit -m "DIOR+ launch"
git push
```

4. Railway auto-detects Node.js and deploys it
5. Get a public URL like `https://diorplus-production.railway.app`
6. Share that URL — anyone in the world can sign up and use the app!

---

### Option 3 — Deploy to Render (also free)

1. Go to https://render.com
2. New → Web Service → Connect your GitHub repo
3. Root directory: `server`
4. Build command: `npm install`
5. Start command: `node index.js`
6. Done! Free tier gives you a public URL.

---

### Option 4 — Deploy to a VPS (DigitalOcean, Linode, etc.)

```bash
# On your server
git clone YOUR_REPO
cd diorplus/server
npm install
# Install PM2 to keep it running
npm install -g pm2
pm2 start index.js --name diorplus
pm2 save
```

Then set up Nginx to proxy port 3000 → port 80/443.

---

## File structure
```
diorplus/
├── server/
│   ├── index.js        ← Backend (Express + Socket.IO + WebRTC signaling)
│   ├── package.json    ← Dependencies
│   ├── data.json       ← Database (auto-created, all posts/users saved here)
│   └── uploads/        ← All uploaded photos and videos stored here
└── client/
    └── index.html      ← The entire frontend (single file)
```

## Important notes

- **data.json** is your database — back it up! All posts, stories, users are here
- **uploads/** folder stores all media files — also back this up
- For production, consider adding HTTPS (required for camera access on mobile)
  - Railway/Render give you HTTPS automatically
  - On your own server: use Certbot/Let's Encrypt for free SSL

## Live streaming notes

- Camera access requires HTTPS in production (Railway/Render handle this)
- On localhost it works without HTTPS
- WebRTC uses Google's STUN servers for connection (free, no setup needed)
- For viewers on different networks, you may need a TURN server
  - Free option: https://metered.ca/tools/openrelay (add to iceServers in client)

## Customization

The entire frontend is in `client/index.html` — one file, easy to edit.
The backend is in `server/index.js`.

To change the app name/colors, edit the CSS variables at the top of `index.html`.
