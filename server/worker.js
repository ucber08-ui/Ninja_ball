// Ninja Ball online relay – Cloudflare Worker + one Durable Object (free plan).
// It pairs two waiting players and forwards their messages. It does NOT run the game:
// the player that gets role "host" simulates the battle (same protocol as local Wi-Fi mode).

const MAX_MSG = 65536;

function att(ws) { try { return ws.deserializeAttachment() || {}; } catch (e) { return {}; } }

function findPeer(self, ws, room) {
  return self.state.getWebSockets().find(w => w !== ws && att(w).s === 'room' && att(w).room === room);
}

function tryPair(self, ws) {
  const other = self.state.getWebSockets().find(w => w !== ws && att(w).s === 'queue');
  if (!other) return;
  const room = crypto.randomUUID();
  const a = att(other), b = att(ws);
  other.serializeAttachment({ s: 'room', room, role: 'host', name: a.name });
  ws.serializeAttachment({ s: 'room', room, role: 'guest', name: b.name });
  other.send(JSON.stringify({ t: 'matched', role: 'host', peer: b.name }));
  ws.send(JSON.stringify({ t: 'matched', role: 'guest', peer: a.name }));
}

export function onMessage(self, ws, msg) {
  if (typeof msg !== 'string' || msg.length > MAX_MSG) return;
  const a = att(ws);
  if (a.s === 'room') {
    const peer = findPeer(self, ws, a.room);
    if (peer) { try { peer.send(msg); } catch (e) { /* peer gone */ } }
    return;
  }
  let m;
  try { m = JSON.parse(msg); } catch (e) { return; }
  if (m.t === 'find' && a.s !== 'queue') {
    ws.serializeAttachment({ s: 'queue', name: String(m.name || 'Player').slice(0, 14), at: Date.now() });
    tryPair(self, ws);
  } else if (m.t === 'cancel') {
    try { ws.close(1000, 'cancel'); } catch (e) { }
  }
}

export function onClose(self, ws) {
  const a = att(ws);
  if (a.s === 'room') {
    const peer = findPeer(self, ws, a.room);
    if (peer) {
      try { peer.send(JSON.stringify({ t: 'peer_left' })); } catch (e) { }
      try { peer.close(1000, 'peer left'); } catch (e) { }
    }
  }
}

export class Lobby {
  constructor(state, env) { this.state = state; this.env = env; }

  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Ninja Ball relay OK');
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.state.acceptWebSocket(server);          // hibernation API: idle sockets cost nothing
    server.serializeAttachment({ s: 'new' });
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws, msg) { onMessage(this, ws, msg); }
  webSocketClose(ws, code, reason) { onClose(this, ws); try { ws.close(code, 'closing'); } catch (e) { } }
  webSocketError(ws) { onClose(this, ws); }
}

export default {
  async fetch(request, env) {
    if (request.headers.get('Upgrade') === 'websocket') {
      const id = env.LOBBY.idFromName('global');   // one global matchmaking room
      return env.LOBBY.get(id).fetch(request);
    }
    return new Response('Ninja Ball relay OK');
  }
};
  
