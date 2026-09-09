// ============================================================================
//  TikTok Geo-Guesser — Server
//  Connects to a TikTok LIVE, reads viewer comments, runs a "guess the
//  country by its shape" game (Worldle-style), and pushes live updates
//  to the game screen (public/) over WebSockets.
// ============================================================================

const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { WebcastPushConnection } = require("tiktok-live-connector");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// ----------------------------------------------------------------------------
// 1. Serve the game screen (static files in /public)
// ----------------------------------------------------------------------------
app.use(express.static(path.join(__dirname, "public")));
app.get("/health", (req, res) => res.json({ ok: true, connected: tiktokConnected }));

// ----------------------------------------------------------------------------
// 2. Country data
// ----------------------------------------------------------------------------
const COUNTRIES = require("./countries.json");

function norm(str) {
  return str
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z ]/g, "")
    .trim();
}

const NAME_INDEX = new Map();
for (const c of COUNTRIES) {
  NAME_INDEX.set(norm(c.name), c);
  for (const alias of c.aliases || []) NAME_INDEX.set(norm(alias), c);
}

function findCountryByGuess(text) {
  const cleaned = norm(text.replace(/^!?guess\s*/i, ""));
  if (!cleaned) return null;
  if (NAME_INDEX.has(cleaned)) return NAME_INDEX.get(cleaned);
  for (const [key, c] of NAME_INDEX) {
    if (key.length > 3 && (cleaned.includes(key) || key.includes(cleaned))) return c;
  }
  return null;
}

// ----------------------------------------------------------------------------
// 3. Geo math
// ----------------------------------------------------------------------------
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function bearing(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1));
  const deg = (Math.atan2(y, x) * 180) / Math.PI;
  return (deg + 360) % 360;
}

function directionArrow(deg) {
  const arrows = ["⬆️", "↗️", "➡️", "↘️", "⬇️", "↙️", "⬅️", "↖️"];
  return arrows[Math.round(deg / 45) % 8];
}

const MAX_KM = 20015;

// ----------------------------------------------------------------------------
// 4. Game state
// ----------------------------------------------------------------------------
const MAX_GUESS_ROWS = 6;

let game = {
  target: null,
  guesses: [],           // oldest first
  round: 0,
  status: "idle",         // idle | playing | won | revealed
  difficulty: "all",      // all | easy
  mode: "live",           // live | test | offline
  startedAt: null,
};

let leaderboard = new Map();
const guessedThisRound = new Set();

function pickTarget() {
  const pool = game.difficulty === "easy" ? COUNTRIES.filter((c) => c.easy) : COUNTRIES;
  return pool[Math.floor(Math.random() * pool.length)];
}

function newRound() {
  game.target = pickTarget();
  game.guesses = [];
  game.round += 1;
  game.status = "playing";
  game.startedAt = Date.now();
  guessedThisRound.clear();
  broadcastState();
}

function awardPoints(username, points) {
  leaderboard.set(username, (leaderboard.get(username) || 0) + points);
}

function topLeaderboard(n = 10) {
  return [...leaderboard.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([name, points]) => ({ name, points }));
}

function broadcastState() {
  io.emit("state", {
    round: game.round,
    status: game.status,
    difficulty: game.difficulty,
    mode: game.mode,
    guesses: game.guesses,
    targetIso: game.target ? game.target.iso : null,
    targetName: game.status === "playing" ? null : game.target?.name,
    leaderboard: topLeaderboard(),
    guessesLeft: Math.max(0, MAX_GUESS_ROWS - game.guesses.length),
  });
}

// Returns a result code so callers (host UI) can show clear feedback
// instead of a guess silently doing nothing.
function handleGuess(rawText, username, { isHost = false } = {}) {
  if (game.status !== "playing") return "not-playing";
  if (!isHost && guessedThisRound.has(username)) return "already-guessed";

  const guessed = findCountryByGuess(rawText);
  if (!guessed) return "unrecognized";
  if (!isHost) guessedThisRound.add(username);

  const dist = haversineKm(guessed.lat, guessed.lon, game.target.lat, game.target.lon);
  const correct = guessed.iso === game.target.iso;
  const percent = correct ? 100 : Math.max(0, Math.round((1 - dist / MAX_KM) * 100));
  const dir = correct ? null : bearing(guessed.lat, guessed.lon, game.target.lat, game.target.lon);

  const row = {
    name: guessed.name,
    byWhom: isHost ? "You (Host)" : username,
    distanceKm: Math.round(dist),
    percent,
    direction: correct ? null : directionArrow(dir),
    correct,
  };
  game.guesses.push(row);

  if (correct) {
    game.status = "won";
    const pointsForWinner = Math.max(10, 100 - (game.guesses.length - 1) * 10);
    awardPoints(username, pointsForWinner);
  } else if (game.guesses.length >= MAX_GUESS_ROWS) {
    game.status = "revealed";
  } else {
    awardPoints(username, 1);
  }

  broadcastState();
  return correct ? "correct" : "wrong";
}

// ----------------------------------------------------------------------------
// 5. Host / socket controls
// ----------------------------------------------------------------------------
io.on("connection", (socket) => {
  broadcastState();

  socket.on("host:newRound", () => newRound());
  socket.on("host:reveal", () => {
    if (game.status === "playing") {
      game.status = "revealed";
      broadcastState();
    }
  });
  socket.on("host:setDifficulty", (level) => {
    game.difficulty = level === "easy" ? "easy" : "all";
    broadcastState();
  });
  socket.on("host:setMode", (mode) => {
    if (["live", "test", "offline"].includes(mode)) {
      game.mode = mode;
      broadcastState();
    }
  });
  socket.on("host:resetLeaderboard", () => {
    leaderboard = new Map();
    broadcastState();
  });
  socket.on("host:guess", (text) => {
    const label = game.mode === "offline" ? "Player" : "Host";
    const result = handleGuess(text, label, { isHost: true });
    socket.emit("host:feedback", { result, text });
  });
});

// ----------------------------------------------------------------------------
// 6. TikTok Live connection
// ----------------------------------------------------------------------------
const TIKTOK_USERNAME = process.env.TIKTOK_USERNAME || "";
let tiktokConnected = false;
let tiktokConn = null;

function connectToTikTok() {
  if (!TIKTOK_USERNAME) {
    console.log("⚠️  No TIKTOK_USERNAME set yet. Set it in Render's Environment settings.");
    return;
  }
  tiktokConn = new WebcastPushConnection(TIKTOK_USERNAME);

  tiktokConn
    .connect()
    .then((state) => {
      tiktokConnected = true;
      console.log(`✅ Connected to @${TIKTOK_USERNAME}'s LIVE (roomId ${state.roomId})`);
      io.emit("tiktok:connected", { username: TIKTOK_USERNAME });
    })
    .catch((err) => {
      console.log("❌ Could not connect to TikTok LIVE:", err.message);
      console.log("   Will retry in 15 seconds (make sure you are actually LIVE).");
      setTimeout(connectToTikTok, 15000);
    });

  tiktokConn.on("chat", (data) => {
    const username = data.uniqueId || data.nickname || "viewer";
    const comment = data.comment || "";
    io.emit("chat", { username, comment });
    // Only viewer comments count as guesses while in LIVE mode.
    // Test/Offline modes ignore real viewer chat so testing never
    // pollutes your real leaderboard or a real broadcast's scoring.
    if (game.mode === "live") handleGuess(comment, username);
  });

  tiktokConn.on("disconnected", () => {
    tiktokConnected = false;
    console.log("⚠️  Disconnected from TikTok LIVE. Reconnecting in 10s...");
    io.emit("tiktok:disconnected");
    setTimeout(connectToTikTok, 10000);
  });

  tiktokConn.on("streamEnd", () => {
    tiktokConnected = false;
    console.log("ℹ️  The LIVE stream ended.");
    io.emit("tiktok:disconnected");
  });
}

// ----------------------------------------------------------------------------
// 7. Boot
// ----------------------------------------------------------------------------
newRound();
server.listen(PORT, () => {
  console.log(`🌍 Geo-Guesser server running on port ${PORT}`);
  connectToTikTok();
});
