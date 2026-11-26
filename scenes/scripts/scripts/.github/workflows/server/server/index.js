const http = require("http");
const crypto = require("crypto");
const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 8080;
const L = 100, W = 60, GOAL_W = 14, GOAL_H = 4.5, BALL_R = 0.7;
const GRAVITY = 28, MATCH_TIME = 180, DT = 1 / 30, GRACE_MS = 30000;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Football Elite 27 server OK");
});
const wss = new WebSocketServer({ server, maxPayload: 2048 });

const rooms = new Map();
const queues = { 1: [], 2: [], 3: [], 4: [], 5: [] };
const sessions = new Map();
let nextId = 1;

function send(c, obj) {
  if (c.ws && c.ws.readyState === 1) c.ws.send(JSON.stringify(obj));
}
function sendRoom(r, obj) {
  for (const c of r.clients) send(c, obj);
}

function newClient(ws) {
  const c = {
    id: nextId++, ws, token: crypto.randomBytes(12).toString("hex"),
    name: "Jogador", room: null, team: 0, connected: true, disconnectedAt: 0,
    input: { mx: 0, mz: 0, sprint: false }, p: null, msgs: 0,
  };
  sessions.set(c.token, c);
  return c;
}

function makeCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 4; i++) s += chars[crypto.randomInt(chars.length)];
  return s;
}

function createRoom(size) {
  let code;
  do { code = makeCode(); } while (rooms.has(code));
  const r = {
    code, size, clients: [], status: "waiting", state: "idle",
    ball: { x: 0, y: BALL_R, z: 0, vx: 0, vy: 0, vz: 0 },
    score: [0, 0], time: MATCH_TIME, timer: 0, tick: 0, ownerId: 0, ownerCd: 0,
  };
  rooms.set(code, r);
  return r;
}

function roomInfo(r) {
  return {
    t: "room", code: r.code, size: r.size, status: r.status,
    players: r.clients.map((c) => ({ id: c.id, name: c.name, team: c.team, connected: c.connected })),
  };
}

function addToRoom(r, c) {
  if (r.clients.length >= r.size * 2) return false;
  const t0 = r.clients.filter((x) => x.team === 0).length;
  const t1 = r.clients.length - t0;
  c.team = t0 <= t1 ? 0 : 1;
  c.room = r;
  r.clients.push(c);
  sendRoom(r, roomInfo(r));
  if (r.clients.length === r.size * 2) startMatch(r);
  return true;
}

function leaveRoom(c) {
  const r = c.room;
  if (!r) return;
  r.clients = r.clients.filter((x) => x !== c);
  c.room = null;
  c.p = null;
  if (r.clients.length === 0) { rooms.delete(r.code); return; }
  if (r.status === "waiting") { sendRoom(r, roomInfo(r)); return; }
  if (r.status === "playing") {
    const t0 = r.clients.filter((x) => x.team === 0).length;
    if (t0 === 0 || t0 === r.clients.length) endMatch(r, "desistencia");
    else sendRoom(r, roomInfo(r));
  }
}

function startMatch(r) {
  r.status = "playing";
  r.score = [0, 0];
  r.time = MATCH_TIME;
  kickoff(r);
  sendRoom(r, { t: "start", code: r.code });
  sendRoom(r, roomInfo(r));
}

function kickoff(r) {
  r.ball = { x: 0, y: BALL_R, z: 0, vx: 0, vy: 0, vz: 0 };
  r.ownerId = 0;
  const count = [0, 0];
  for (const c of r.clients) {
    const i = count[c.team]++;
    const sg = c.team === 0 ? -1 : 1;
    c.p = {
      x: sg * (12 + (i % 2) * 10), z: (i - (r.size - 1) / 2) * 10,
      vx: 0, vz: 0, fx: -sg, fz: 0, kickCd: 0,
    };
    c.input = { mx: 0, mz: 0, sprint: false };
  }
  r.state = "kickoff";
  r.timer = 1.5;
}

function goal(r, team) {
  r.score[team]++;
  r.state = "goal";
  r.timer = 2.5;
  sendRoom(r, { t: "goal", team, score: r.score });
}

function endMatch(r, reason) {
  r.state = "end";
  r.status = "ended";
  sendRoom(r, { t: "end", score: r.score, reason: reason || "tempo" });
  setTimeout(() => {
    for (const c of r.clients) { c.room = null; c.p = null; }
    rooms.delete(r.code);
  }, 10000);
}

// ---------- simulacao ----------
function ballPhysics(r, dt) {
  const b = r.ball;
  b.vy -= GRAVITY * dt;
  b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
  if (b.y < BALL_R) {
    b.y = BALL_R;
    b.vy = b.vy < -2 ? -b.vy * 0.55 : 0;
    const sp = Math.hypot(b.vx, b.vz);
    if (sp > 0) {
      const ns = Math.max(0, sp - 7 * dt) * (1 - 0.35 * dt);
      b.vx *= ns / sp; b.vz *= ns / sp;
    }
  } else {
    b.vx *= 1 - 0.1 * dt; b.vz *= 1 - 0.1 * dt;
  }
  const hw = W / 2 + 1.5;
  if (Math.abs(b.z) > hw) { b.z = Math.sign(b.z) * hw; b.vz *= -0.6; }
  const mouth = Math.abs(b.z) < GOAL_W / 2 && b.y < GOAL_H;
  if (Math.abs(b.x) > L / 2) {
    if (mouth) {
      if (r.state === "play") goal(r, b.x > 0 ? 0 : 1);
      if (Math.abs(b.x) > L / 2 + 3.6) { b.x = Math.sign(b.x) * (L / 2 + 3.6); b.vx *= -0.2; }
    } else if (Math.abs(b.x) > L / 2 + 1.5) {
      b.x = Math.sign(b.x) * (L / 2 + 1.5); b.vx *= -0.5;
    }
  }
}

function movePlayers(r, dt) {
  for (const c of r.clients) {
    const p = c.p;
    if (!p) continue;
    let mx = 0, mz = 0, sprint = false;
    if (r.state === "play" && c.connected) { mx = c.input.mx; mz = c.input.mz; sprint = c.input.sprint; }
    const m = Math.hypot(mx, mz);
    if (m > 1) { mx /= m; mz /= m; }
    const sp = sprint ? 11 : 8;
    let dx = mx * sp - p.vx, dz = mz * sp - p.vz;
    const dl = Math.hypot(dx, dz), maxd = 45 * dt;
    if (dl > maxd) { dx *= maxd / dl; dz *= maxd / dl; }
    p.vx += dx; p.vz += dz;
    p.x = clamp(p.x + p.vx * dt, -L / 2 - 1, L / 2 + 1);
    p.z = clamp(p.z + p.vz * dt, -W / 2 - 1, W / 2 + 1);
    const s = Math.hypot(p.vx, p.vz);
    if (s > 0.5) { p.fx = p.vx / s; p.fz = p.vz / s; }
    p.kickCd = Math.max(0, p.kickCd - dt);
  }
  for (let i = 0; i < r.clients.length; i++) {
    for (let j = i + 1; j < r.clients.length; j++) {
      const a = r.clients[i].p, b = r.clients[j].p;
      if (!a || !b) continue;
      const dx = a.x - b.x, dz = a.z - b.z, l = Math.hypot(dx, dz);
      if (l < 1.6 && l > 0.001) {
        const k = ((1.6 - l) * 0.5) / l;
        a.x += dx * k; a.z += dz * k; b.x -= dx * k; b.z -= dz * k;
      }
    }
  }
}

function touches(r, dt) {
  r.ownerCd = Math.max(0, r.ownerCd - dt);
  const b = r.ball;
  if (b.y > 2.4) return;
  let best = null, bd = 1.8;
  for (const c of r.clients) {
    if (!c.p || c.p.kickCd > 0) continue;
    const d = Math.hypot(c.p.x - b.x, c.p.z - b.z);
    if (d < bd) { bd = d; best = c; }
  }
  if (!best) return;
  if (r.ownerId !== best.id) {
    if (r.ownerCd > 0) return;
    r.ownerCd = 0.2;
  }
  r.ownerId = best.id;
  const p = best.p, spd = Math.hypot(p.vx, p.vz);
  if (spd < 1) { b.vx *= 0.5; b.vz *= 0.5; p.kickCd = 0.1; }
  else {
    const k = spd * 1.25 + 2;
    b.vx = (p.vx / spd) * k; b.vz = (p.vz / spd) * k; p.kickCd = 0.3;
  }
}

function kick(r, c, dx, dz, power, lift) {
  const l = Math.hypot(dx, dz) || 1, b = r.ball;
  b.vx = (dx / l) * power; b.vz = (dz / l) * power; b.vy = lift;
  c.p.kickCd = 0.5; r.ownerId = c.id; r.ownerCd = 0.15;
}

function aimDir(c) {
  const p = c.p, m = Math.hypot(c.input.mx, c.input.mz);
  return m > 0.3 ? [c.input.mx / m, c.input.mz / m] : [p.fx, p.fz];
}

function canKick(r, c) {
  if (!c.p || r.state !== "play") return false;
  const b = r.ball;
  return c.p.kickCd <= 0 && b.y < 2.5 && Math.hypot(c.p.x - b.x, c.p.z - b.z) <= 2.6;
}

function doShoot(r, c, power) {
  if (!canKick(r, c)) return;
  const pw = clamp(num(power) || 0.25, 0.25, 1);
  let [dx, dz] = aimDir(c);
  const gx = c.team === 0 ? L / 2 : -L / 2;
  let tx = gx - c.p.x, tz = -c.p.z;
  const tl = Math.hypot(tx, tz) || 1;
  tx /= tl; tz /= tl;
  if (dx * tx + dz * tz > 0.8) {
    dx += (tx - dx) * 0.5; dz += (tz - dz) * 0.5;
    const n = Math.hypot(dx, dz) || 1; dx /= n; dz /= n;
  }
  kick(r, c, dx, dz, 14 + 22 * pw, 2 + 4 * pw);
}

function doPass(r, c) {
  if (!canKick(r, c)) return;
  const [dx, dz] = aimDir(c);
  let best = null, bs = 0.3;
  for (const q of r.clients) {
    if (q === c || q.team !== c.team || !q.p) continue;
    const vx = q.p.x - c.p.x, vz = q.p.z - c.p.z, d = Math.hypot(vx, vz);
    if (d < 3 || d > 45) continue;
    const s = (vx * dx + vz * dz) / d - d * 0.008;
    if (s > bs) { bs = s; best = q; }
  }
  if (!best) { kick(r, c, dx, dz, 16, 0); return; }
  const tx = best.p.x + best.p.vx * 0.6 - c.p.x, tz = best.p.z + best.p.vz * 0.6 - c.p.z;
  const d = Math.hypot(tx, tz);
  kick(r, c, tx, tz, clamp(Math.sqrt(70 + 14 * d) * 1.1, 10, 34), 0);
}

function broadcastState(r) {
  const b = r.ball, f = (v) => Math.round(v * 100) / 100;
  sendRoom(r, {
    t: "state", s: r.state, time: Math.ceil(r.time), score: r.score,
    ball: [f(b.x), f(b.y), f(b.z), f(b.vx), f(b.vz)],
    p: r.clients.filter((c) => c.p).map((c) => [c.id, c.team, f(c.p.x), f(c.p.z), f(c.p.vx), f(c.p.vz), f(c.p.fx), f(c.p.fz)]),
    ts: Date.now(),
  });
}

function stepRoom(r, dt) {
  if (r.status !== "playing") return;
  if (r.state === "kickoff") { r.timer -= dt; if (r.timer <= 0) r.state = "play"; }
  else if (r.state === "play") { r.time -= dt; if (r.time <= 0) { r.time = 0; endMatch(r); return; } }
  else if (r.state === "goal") { r.timer -= dt; if (r.timer <= 0) kickoff(r); }
  movePlayers(r, dt);
  if (r.state === "play" || r.state === "goal") ballPhysics(r, dt);
  if (r.state === "play") touches(r, dt);
  r.tick++;
  if (r.tick % 2 === 0) broadcastState(r);
}

setInterval(() => { for (const r of rooms.values()) stepRoom(r, DT); }, DT * 1000);

setInterval(() => {
  const now = Date.now();
  for (const c of [...sessions.values()]) {
    if (!c.connected && now - c.disconnectedAt > GRACE_MS) {
      leaveRoom(c);
      sessions.delete(c.token);
    }
    c.msgs = 0;
  }
}, 1000);

// ---------- matchmaking ----------
function dequeue(c) {
  for (const k of Object.keys(queues)) queues[k] = queues[k].filter((x) => x !== c);
}
function enqueue(c, size) {
  dequeue(c);
  queues[size].push(c);
  send(c, { t: "searching", size });
  if (queues[size].length >= size * 2) {
    const group = queues[size].splice(0, size * 2);
    const r = createRoom(size);
    for (const g of group) addToRoom(r, g);
  }
}

// ---------- conexoes ----------
wss.on("connection", (ws) => {
  let cur = newClient(ws);
  ws.isAlive = true;
  ws.on("pong", () => { ws.isAlive = true; });
  send(cur, { t: "welcome", id: cur.id, token: cur.token });

  ws.on("message", (data) => {
    let m;
    try { m = JSON.parse(data.toString()); } catch { return; }
    if (!m || typeof m.t !== "string") return;
    if (++cur.msgs > 120) return;

    switch (m.t) {
      case "ping": send(cur, { t: "pong", ts: m.ts }); break;
      case "resume": {
        const old = sessions.get(String(m.token));
        if (!old || old === cur) break;
        sessions.delete(cur.token);
        old.ws = ws; old.connected = true; old.disconnectedAt = 0;
        cur = old;
        send(cur, { t: "welcome", id: cur.id, token: cur.token, resumed: true });
        if (cur.room) sendRoom(cur.room, roomInfo(cur.room));
        break;
      }
      case "create": {
        if (cur.room) break;
        cur.name = String(m.name || "Jogador").slice(0, 12);
        const r = createRoom(clamp(Math.floor(num(m.size)) || 1, 1, 5));
        addToRoom(r, cur);
        break;
      }
      case "join": {
        if (cur.room) break;
        cur.name = String(m.name || "Jogador").slice(0, 12);
        const r = rooms.get(String(m.code || "").toUpperCase());
        if (!r || r.status !== "waiting") { send(cur, { t: "error", msg: "Sala nao encontrada" }); break; }
        if (!addToRoom(r, cur)) send(cur, { t: "error", msg: "Sala cheia" });
        break;
      }
      case "quick":
        if (cur.room) break;
        cur.name = String(m.name || "Jogador").slice(0, 12);
        enqueue(cur, clamp(Math.floor(num(m.size)) || 1, 1, 5));
        break;
      case "cancel": dequeue(cur); send(cur, { t: "cancelled" }); break;
      case "leave": dequeue(cur); leaveRoom(cur); send(cur, { t: "left" }); break;
      case "input":
        cur.input = { mx: clamp(num(m.mx), -1, 1), mz: clamp(num(m.mz), -1, 1), sprint: m.sprint === true };
        break;
      case "shoot": if (cur.room) doShoot(cur.room, cur, m.power); break;
      case "pass": if (cur.room) doPass(cur.room, cur); break;
    }
  });

  ws.on("close", () => {
    if (cur.ws !== ws) return;
    cur.connected = false;
    cur.disconnectedAt = Date.now();
    dequeue(cur);
    if (cur.room && cur.room.status === "waiting") { leaveRoom(cur); sessions.delete(cur.token); }
    else if (cur.room) sendRoom(cur.room, roomInfo(cur.room));
    else sessions.delete(cur.token);
  });
});

setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000);

server.listen(PORT, () => console.log("Servidor rodando na porta " + PORT));
