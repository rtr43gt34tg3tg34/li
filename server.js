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

app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ── Chat store ───────────────────────────────────────────────────────────────
// status: 'open' | 'claimed' | 'closed'
const chats = {};
function genId() { return Math.random().toString(36).slice(2,10) + Date.now().toString(36); }

// ── WebSocket ────────────────────────────────────────────────────────────────
const clients = new Map();

wss.on('connection', (ws) => {
  clients.set(ws, { type: null, sessionId: null });

  ws.on('message', (raw) => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    const meta = clients.get(ws);

    // User joins chat
    if (msg.type === 'user_join') {
      const sid = msg.sessionId || genId();
      if (!chats[sid]) chats[sid] = { id: sid, name: msg.name||'Visitor', email: msg.email||'', messages: [], unread: 0, status: 'open', claimedBy: null };
      clients.set(ws, { type: 'user', sessionId: sid });
      ws.send(JSON.stringify({ type: 'joined', sessionId: sid, history: chats[sid].messages, status: chats[sid].status }));
      broadcastAdmins({ type: 'chat_list', chats: chatList() });
      return;
    }

    // Admin joins
    if (msg.type === 'admin_join') {
      if (msg.password !== ADMIN_PASSWORD) { ws.send(JSON.stringify({ type: 'auth_fail' })); return; }
      clients.set(ws, { type: 'admin', sessionId: null });
      ws.send(JSON.stringify({ type: 'auth_ok', chats: chatList() }));
      return;
    }

    // User sends message
    if (msg.type === 'user_msg' && meta.type === 'user') {
      const chat = chats[meta.sessionId]; if (!chat || chat.status === 'closed') return;
      const entry = { from: 'user', text: msg.text, ts: Date.now() };
      chat.messages.push(entry); chat.unread++;
      ws.send(JSON.stringify({ type: 'msg', ...entry }));
      broadcastAdmins({ type: 'new_msg', sessionId: meta.sessionId, msg: entry, chatMeta: chatMeta(meta.sessionId) });
      return;
    }

    // Admin sends message
    if (msg.type === 'admin_msg' && meta.type === 'admin') {
      const chat = chats[msg.sessionId]; if (!chat || chat.status === 'closed') return;
      const entry = { from: 'admin', text: msg.text, ts: Date.now() };
      chat.messages.push(entry); chat.unread = 0;
      broadcastUser(msg.sessionId, { type: 'msg', ...entry });
      broadcastAdmins({ type: 'new_msg', sessionId: msg.sessionId, msg: entry, chatMeta: chatMeta(msg.sessionId) });
      return;
    }

    // Admin opens a chat
    if (msg.type === 'admin_open' && meta.type === 'admin') {
      const chat = chats[msg.sessionId]; if (!chat) return;
      chat.unread = 0;
      ws.send(JSON.stringify({ type: 'chat_history', sessionId: msg.sessionId, history: chat.messages, chatMeta: chatMeta(msg.sessionId) }));
      broadcastAdmins({ type: 'chat_list', chats: chatList() });
      return;
    }

    // Admin claims a ticket
    if (msg.type === 'admin_claim' && meta.type === 'admin') {
      const chat = chats[msg.sessionId]; if (!chat) return;
      chat.status    = 'claimed';
      chat.claimedBy = msg.claimedBy || 'Admin';
      const sysEntry = { from: 'system', text: `✅ Ticket claimed by ${chat.claimedBy}`, ts: Date.now() };
      chat.messages.push(sysEntry);
      broadcastUser(msg.sessionId, { type: 'msg', ...sysEntry });
      broadcastAdmins({ type: 'ticket_updated', chatMeta: chatMeta(msg.sessionId) });
      broadcastAdmins({ type: 'chat_list', chats: chatList() });
      return;
    }

    // Admin closes a ticket
    if (msg.type === 'admin_close' && meta.type === 'admin') {
      const chat = chats[msg.sessionId]; if (!chat) return;
      chat.status = 'closed';
      const sysEntry = { from: 'system', text: '🔒 This ticket has been closed. Thanks for reaching out!', ts: Date.now() };
      chat.messages.push(sysEntry);
      broadcastUser(msg.sessionId, { type: 'msg', ...sysEntry });
      broadcastUser(msg.sessionId, { type: 'ticket_closed' });
      broadcastAdmins({ type: 'ticket_updated', chatMeta: chatMeta(msg.sessionId) });
      broadcastAdmins({ type: 'chat_list', chats: chatList() });
      return;
    }
  });

  ws.on('close', () => clients.delete(ws));
});

function broadcastAdmins(p) {
  const s = JSON.stringify(p);
  for (const [ws, m] of clients) if (m.type==='admin' && ws.readyState===1) ws.send(s);
}
function broadcastUser(sid, p) {
  const s = JSON.stringify(p);
  for (const [ws, m] of clients) if (m.type==='user' && m.sessionId===sid && ws.readyState===1) ws.send(s);
}
function chatMeta(sid) {
  const c = chats[sid]; if (!c) return null;
  return { id: c.id, name: c.name, email: c.email, unread: c.unread, status: c.status, claimedBy: c.claimedBy, lastMsg: c.messages[c.messages.length-1]||null };
}
function chatList() {
  return Object.values(chats).map(c => chatMeta(c.id)).sort((a,b)=>((b.lastMsg?.ts||0)-(a.lastMsg?.ts||0)));
}

// ── Better Up — rewrites admin message via OpenRouter ────────────────────────
const OPENROUTER_KEY = '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'; // regenerate at openrouter.ai

app.post('/better-up', async (req, res) => {
  const { text } = req.body;
  if (!text || typeof text !== 'string') return res.status(400).json({ error: 'No text provided' });
  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + OPENROUTER_KEY,
        'Content-Type':  'application/json',
        'HTTP-Referer':  'https://liamswebsites.store',
        'X-Title':       "Liam's Websites Admin",
      },
      body: JSON.stringify({
        model: 'openai/gpt-4o-mini',
        messages: [{
          role: 'user',
          content: `You are a professional customer support assistant for "Liam's Websites", a web design service.\nRewrite the following support message to be more professional, clear, friendly and polished — while keeping the exact same meaning and intent.\nKeep it concise. Return ONLY the rewritten message with no explanation, quotes, or preamble.\n\nMessage to improve: ${text}`
        }]
      })
    });
    const data = await response.json();
    const improved = data?.choices?.[0]?.message?.content?.trim();
    if (!improved) return res.status(500).json({ error: 'No response from AI' });
    res.json({ improved });
  } catch (err) {
    console.error('Better Up error:', err.message);
    res.status(500).json({ error: err.message });
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
  console.log("  ✅  Liam's Websites running!");
  console.log('  🌐  http://localhost:' + PORT);
  console.log('  💬  Chat: ws ready');
  console.log('  🔒  Admin: /adminsonlyspace839.html  pw: ' + ADMIN_PASSWORD);
  console.log('');
});
