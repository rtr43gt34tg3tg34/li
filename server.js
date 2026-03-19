const express = require('express');
const http    = require('http');
const path    = require('path');
const { WebSocketServer } = require('ws');

const app    = express();
const server = http.createServer(app);
const wss    = new WebSocketServer({ server });
const PORT   = process.env.PORT || 3000;

const GOOGLE_CLIENT_ID = '881748752116-e7khbn7cuij84hg5c1ss8m0j7q3bsn55.apps.googleusercontent.com';
const ADMIN_PASSWORD   = 'liamsadmin2025'; // change this to whatever you want

app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ── In-memory chat store ─────────────────────────────────────────────────────
const chats = {};
function genId() { return Math.random().toString(36).slice(2,10) + Date.now().toString(36); }

// ── WebSocket ────────────────────────────────────────────────────────────────
const clients = new Map(); // ws -> { type, sessionId }

wss.on('connection', (ws) => {
  clients.set(ws, { type: null, sessionId: null });

  ws.on('message', (raw) => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    const meta = clients.get(ws);

    if (msg.type === 'user_join') {
      const sid = msg.sessionId || genId();
      if (!chats[sid]) chats[sid] = { id: sid, name: msg.name || 'Visitor', email: msg.email || '', messages: [], unread: 0 };
      clients.set(ws, { type: 'user', sessionId: sid });
      ws.send(JSON.stringify({ type: 'joined', sessionId: sid, history: chats[sid].messages }));
      broadcastAdmins({ type: 'chat_list', chats: chatList() });
      return;
    }

    if (msg.type === 'admin_join') {
      if (msg.password !== ADMIN_PASSWORD) { ws.send(JSON.stringify({ type: 'auth_fail' })); return; }
      clients.set(ws, { type: 'admin', sessionId: null });
      ws.send(JSON.stringify({ type: 'auth_ok', chats: chatList() }));
      return;
    }

    if (msg.type === 'user_msg' && meta.type === 'user') {
      const chat = chats[meta.sessionId]; if (!chat) return;
      const entry = { from: 'user', text: msg.text, ts: Date.now() };
      chat.messages.push(entry); chat.unread++;
      ws.send(JSON.stringify({ type: 'msg', ...entry }));
      broadcastAdmins({ type: 'new_msg', sessionId: meta.sessionId, msg: entry, chatMeta: chatMeta(meta.sessionId) });
      return;
    }

    if (msg.type === 'admin_msg' && meta.type === 'admin') {
      const chat = chats[msg.sessionId]; if (!chat) return;
      const entry = { from: 'admin', text: msg.text, ts: Date.now() };
      chat.messages.push(entry); chat.unread = 0;
      broadcastUser(msg.sessionId, { type: 'msg', ...entry });
      broadcastAdmins({ type: 'new_msg', sessionId: msg.sessionId, msg: entry, chatMeta: chatMeta(msg.sessionId) });
      return;
    }

    if (msg.type === 'admin_open' && meta.type === 'admin') {
      const chat = chats[msg.sessionId]; if (!chat) return;
      chat.unread = 0;
      ws.send(JSON.stringify({ type: 'chat_history', sessionId: msg.sessionId, history: chat.messages, chatMeta: chatMeta(msg.sessionId) }));
      broadcastAdmins({ type: 'chat_list', chats: chatList() });
      return;
    }
  });

  ws.on('close', () => clients.delete(ws));
});

function broadcastAdmins(p) {
  const s = JSON.stringify(p);
  for (const [ws, m] of clients) if (m.type === 'admin' && ws.readyState === 1) ws.send(s);
}
function broadcastUser(sid, p) {
  const s = JSON.stringify(p);
  for (const [ws, m] of clients) if (m.type === 'user' && m.sessionId === sid && ws.readyState === 1) ws.send(s);
}
function chatMeta(sid) {
  const c = chats[sid]; if (!c) return null;
  return { id: c.id, name: c.name, email: c.email, unread: c.unread, lastMsg: c.messages[c.messages.length-1] || null };
}
function chatList() {
  return Object.values(chats).map(c => chatMeta(c.id)).sort((a,b) => ((b.lastMsg?.ts||0)-(a.lastMsg?.ts||0)));
}

// ── Routes ───────────────────────────────────────────────────────────────────
app.get('/google-client-id', (req, res) => res.json({ clientId: GOOGLE_CLIENT_ID }));
app.get('/oauth-callback',   (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/priv',             (req, res) => res.sendFile(path.join(__dirname, 'priv.html')));
app.get('/adminsonlyspace839.html', (req, res) => res.sendFile(path.join(__dirname, 'adminsonlyspace839.html')));
app.get('*',                 (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

server.listen(PORT, () => {
  console.log('');
  console.log("  ✅  Liam's Websites running!");
  console.log('  🌐  http://localhost:' + PORT);
  console.log('  💬  Chat: ws ready');
  console.log('  🔒  Admin: /adminsonlyspace839.html  pw: ' + ADMIN_PASSWORD);
  console.log('');
});
