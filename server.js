const express = require('express');
const http    = require('http');
const path    = require('path');
const { WebSocketServer } = require('ws');

const app    = express();
const server = http.createServer(app);
const wss    = new WebSocketServer({ server });
const PORT   = process.env.PORT || 3000;

const GOOGLE_CLIENT_ID = '881748752116-e7khbn7cuij84hg5c1ss8m0j7q3bsn55.apps.googleusercontent.com';
const ADMIN_PASSWORD   = 'liamsadmin2025';
const OWNER_EMAIL      = 'LiamsSites@proton.me';

app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ── Chat store ───────────────────────────────────────────────────────────────
const chats = {};
function genId() { return Math.random().toString(36).slice(2,10) + Date.now().toString(36); }

// Auto messages sent while ticket is unclaimed
const AUTO_MSGS = [
  { delay: 3  * 60 * 1000, text: 'Just a heads up — if you have any trouble with your booking or need faster help, feel free to email us directly at ' + OWNER_EMAIL + ' and we will sort it out right away!' },
  { delay: 10 * 60 * 1000, text: 'Still here! Our team will be with you as soon as possible. You can also reach us at ' + OWNER_EMAIL + ' for help with your website project.' },
  { delay: 30 * 60 * 1000, text: 'Thanks for your patience! We have not forgotten about you. For urgent matters please email ' + OWNER_EMAIL + ' directly — we check emails frequently.' },
];

function scheduleAutoMessages(sid) {
  let idx = 0;
  function sendNext() {
    const chat = chats[sid];
    if (!chat || chat.status !== 'open' || idx >= AUTO_MSGS.length) return;
    const entry = { from: 'admin', text: AUTO_MSGS[idx].text, ts: Date.now() };
    chat.messages.push(entry);
    broadcastUser(sid, { type: 'msg', from: entry.from, text: entry.text, ts: entry.ts });
    broadcastAdmins({ type: 'new_msg', sessionId: sid, msg: entry, chatMeta: getChatMeta(sid) });
    idx++;
    if (idx < AUTO_MSGS.length && chats[sid]) {
      chats[sid].autoTimer = setTimeout(sendNext, AUTO_MSGS[idx].delay);
    }
  }
  if (chats[sid]) {
    chats[sid].autoTimer = setTimeout(sendNext, AUTO_MSGS[0].delay);
  }
}

// ── WebSocket ────────────────────────────────────────────────────────────────
const clients = new Map(); // ws -> { type, sessionId }

wss.on('connection', (ws) => {
  clients.set(ws, { type: null, sessionId: null });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const meta = clients.get(ws);

    // ── User joins ──
    if (msg.type === 'user_join') {
      const sid  = msg.sessionId || genId();
      const isNew = !chats[sid];
      if (isNew) {
        chats[sid] = { id: sid, name: msg.name || 'Visitor', email: msg.email || '', messages: [], unread: 0, status: 'open', claimedBy: null, autoTimer: null };
        chats[sid].messages.push({ from: 'admin', text: "Hey! Thanks for reaching out to Liam's Websites.", ts: Date.now() });
        chats[sid].messages.push({ from: 'admin', text: 'Someone will be with you shortly! We usually reply within a few minutes, but during busy periods it can take up to 15 hours. Hang tight we will get back to you ASAP :)', ts: Date.now() + 1 });
        scheduleAutoMessages(sid);
      }
      clients.set(ws, { type: 'user', sessionId: sid });
      ws.send(JSON.stringify({ type: 'joined', sessionId: sid, history: chats[sid].messages, status: chats[sid].status }));
      broadcastAdmins({ type: 'chat_list', chats: getChatList() });
      return;
    }

    // ── Admin joins ──
    if (msg.type === 'admin_join') {
      if (msg.password !== ADMIN_PASSWORD) {
        ws.send(JSON.stringify({ type: 'auth_fail' }));
        return;
      }
      clients.set(ws, { type: 'admin', sessionId: null });
      ws.send(JSON.stringify({ type: 'auth_ok', chats: getChatList() }));
      return;
    }

    // ── User sends message ──
    if (msg.type === 'user_msg' && meta.type === 'user') {
      const chat = chats[meta.sessionId];
      if (!chat || chat.status === 'closed') return;
      const entry = { from: 'user', text: msg.text, ts: Date.now() };
      chat.messages.push(entry);
      chat.unread++;
      ws.send(JSON.stringify({ type: 'msg', from: entry.from, text: entry.text, ts: entry.ts }));
      broadcastAdmins({ type: 'new_msg', sessionId: meta.sessionId, msg: entry, chatMeta: getChatMeta(meta.sessionId) });
      return;
    }

    // ── Admin sends message ──
    if (msg.type === 'admin_msg' && meta.type === 'admin') {
      const chat = chats[msg.sessionId];
      if (!chat || chat.status === 'closed') return;
      const entry = { from: 'admin', text: msg.text, ts: Date.now() };
      chat.messages.push(entry);
      chat.unread = 0;
      broadcastUser(msg.sessionId, { type: 'msg', from: entry.from, text: entry.text, ts: entry.ts });
      broadcastAdmins({ type: 'new_msg', sessionId: msg.sessionId, msg: entry, chatMeta: getChatMeta(msg.sessionId) });
      return;
    }

    // ── Admin opens a chat ──
    if (msg.type === 'admin_open' && meta.type === 'admin') {
      const chat = chats[msg.sessionId];
      if (!chat) return;
      chat.unread = 0;
      ws.send(JSON.stringify({ type: 'chat_history', sessionId: msg.sessionId, history: chat.messages, chatMeta: getChatMeta(msg.sessionId) }));
      broadcastAdmins({ type: 'chat_list', chats: getChatList() });
      return;
    }

    // ── Admin claims ticket ──
    if (msg.type === 'admin_claim' && meta.type === 'admin') {
      const chat = chats[msg.sessionId];
      if (!chat) return;
      if (chat.autoTimer) { clearTimeout(chat.autoTimer); chat.autoTimer = null; }
      chat.status    = 'claimed';
      chat.claimedBy = msg.claimedBy || 'Admin';
      const entry = { from: 'system', text: chat.claimedBy + ' has joined the chat and will be with you shortly!', ts: Date.now() };
      chat.messages.push(entry);
      broadcastUser(msg.sessionId, { type: 'msg', from: entry.from, text: entry.text, ts: entry.ts });
      broadcastAdmins({ type: 'ticket_updated', chatMeta: getChatMeta(msg.sessionId) });
      broadcastAdmins({ type: 'chat_list', chats: getChatList() });
      return;
    }

    // ── Admin closes ticket ──
    if (msg.type === 'admin_close' && meta.type === 'admin') {
      const chat = chats[msg.sessionId];
      if (!chat) return;
      if (chat.autoTimer) { clearTimeout(chat.autoTimer); chat.autoTimer = null; }
      chat.status = 'closed';
      const entry = { from: 'system', text: 'This chat has been closed by our team. Thanks for reaching out! For further help email ' + OWNER_EMAIL, ts: Date.now() };
      chat.messages.push(entry);
      broadcastUser(msg.sessionId, { type: 'msg', from: entry.from, text: entry.text, ts: entry.ts });
      // After 3 seconds tell client to reset, then delete from server
      setTimeout(() => {
        broadcastUser(msg.sessionId, { type: 'ticket_closed' });
        delete chats[msg.sessionId];
        broadcastAdmins({ type: 'ticket_deleted', sessionId: msg.sessionId });
        broadcastAdmins({ type: 'chat_list', chats: getChatList() });
      }, 3000);
      broadcastAdmins({ type: 'chat_list', chats: getChatList() });
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
function getChatMeta(sid) {
  const c = chats[sid];
  if (!c) return null;
  return { id: c.id, name: c.name, email: c.email, unread: c.unread, status: c.status, claimedBy: c.claimedBy, lastMsg: c.messages[c.messages.length - 1] || null };
}
function getChatList() {
  return Object.values(chats).map(c => getChatMeta(c.id)).sort((a, b) => ((b.lastMsg?.ts || 0) - (a.lastMsg?.ts || 0)));
}

// ── Better Up ────────────────────────────────────────────────────────────────
const OPENROUTER_KEY = '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';

app.post('/better-up', async (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'No text' });
  try {
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + OPENROUTER_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'openai/gpt-4o-mini',
        messages: [{ role: 'user', content: 'Rewrite this customer support message to be more professional and friendly. Return ONLY the rewritten message, nothing else: ' + text }]
      })
    });
    const data = await r.json();
    const improved = data?.choices?.[0]?.message?.content?.trim();
    if (!improved) return res.status(500).json({ error: 'No response' });
    res.json({ improved });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Routes ───────────────────────────────────────────────────────────────────
app.get('/google-client-id', (req, res) => res.json({ clientId: GOOGLE_CLIENT_ID }));
app.get('/oauth-callback',   (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/priv',             (req, res) => res.sendFile(path.join(__dirname, 'priv.html')));
app.get('/adminsonlyspace839.html', (req, res) => res.sendFile(path.join(__dirname, 'adminsonlyspace839.html')));
app.get('*',                 (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

server.listen(PORT, () => {
  console.log('');
  console.log("  Liam's Websites running on port " + PORT);
  console.log('  Admin: /adminsonlyspace839.html  pw: ' + ADMIN_PASSWORD);
  console.log('');
});
