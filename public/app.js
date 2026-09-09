// ============================================================================
//  GeoGuess LIVE — client
// ============================================================================

const socket = io();

const el = (id) => document.getElementById(id);
const canvas = el("mapCanvas");
const ctx = canvas.getContext("2d");

let worldFeatures = null; // loaded once, cached in the browser

// ----------------------------------------------------------------------------
// Load the world map shapes once (small ~100kb file, cached by the browser
// after first load so it never has to be re-downloaded during your stream).
// ----------------------------------------------------------------------------
async function loadWorldAtlas() {
  const res = await fetch("https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json");
  const topo = await res.json();
  worldFeatures = topojson.feature(topo, topo.objects.countries).features;
}

function drawCountrySilhouette(iso) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!worldFeatures) return;
  const feature = worldFeatures.find((f) => String(f.id).padStart(3, "0") === String(iso).padStart(3, "0"));
  if (!feature) {
    ctx.fillStyle = "#93a2b8";
    ctx.font = "20px sans-serif";
    ctx.fillText("Map shape unavailable for this round.", 20, 40);
    return;
  }
  const projection = d3.geoMercator().fitExtent(
    [[30, 30], [canvas.width - 30, canvas.height - 30]],
    feature
  );
  const path = d3.geoPath(projection, ctx);
  ctx.beginPath();
  path(feature);
  const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, "#2dd4bf");
  gradient.addColorStop(1, "#0ea5e9");
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#0b1220";
  ctx.stroke();
}

// ----------------------------------------------------------------------------
// Rendering the rest of the UI from server state
// ----------------------------------------------------------------------------
function renderState(state) {
  if (!state) return;

  el("roundNumber").textContent = `Round ${state.round}`;
  el("guessesLeft").textContent = `${state.guessesLeft} guess${state.guessesLeft === 1 ? "" : "es"} left`;

  const status = el("statusMessage");
  if (state.status === "playing") {
    status.textContent = "Guess the country in the comments! 🗺️  (type the country name)";
    status.style.color = "var(--accent-warm)";
  } else if (state.status === "won") {
    status.textContent = `🎉 Correct! It was ${state.targetName}! New round starting soon…`;
    status.style.color = "var(--success)";
  } else if (state.status === "revealed") {
    status.textContent = `⏱️ Out of guesses! It was ${state.targetName}. New round starting soon…`;
    status.style.color = "var(--danger)";
  }

  drawCountrySilhouette(state.targetIso);

  // Guess list
  const list = el("guessList");
  list.innerHTML = "";
  [...state.guesses].reverse().forEach((g) => {
    const row = document.createElement("div");
    row.className = "guess-row" + (g.correct ? " correct" : "");
    row.innerHTML = `
      <div>
        <div class="guess-name">${escapeHtml(g.name)}</div>
        <div class="guess-meta">${escapeHtml(g.byWhom)} ${g.correct ? "✅" : `• ${g.distanceKm} km ${g.direction || ""}`}</div>
      </div>
      <div class="guess-percent">${g.percent}%</div>
    `;
    list.appendChild(row);
  });

  // Leaderboard
  const lb = el("leaderboardList");
  lb.innerHTML = "";
  state.leaderboard.forEach((entry) => {
    const li = document.createElement("li");
    li.innerHTML = `<span>${escapeHtml(entry.name)}</span><span>${entry.points} pts</span>`;
    lb.appendChild(li);
  });

  // Difficulty select stays in sync
  el("difficultySelect").value = state.difficulty;

  // Auto-start a new round a few seconds after a win/reveal
  if (state.status === "won" || state.status === "revealed") {
    clearTimeout(window._autoRoundTimer);
    window._autoRoundTimer = setTimeout(() => socket.emit("host:newRound"), 6000);
  }
}

function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str ?? "";
  return d.innerHTML;
}

// ----------------------------------------------------------------------------
// Live comment feed (kept short, most recent 20 messages)
// ----------------------------------------------------------------------------
function addChatMessage(username, comment) {
  const feed = el("chatFeed");
  const msg = document.createElement("div");
  msg.className = "msg";
  msg.innerHTML = `<span class="user">${escapeHtml(username)}:</span>${escapeHtml(comment)}`;
  feed.appendChild(msg);
  while (feed.children.length > 20) feed.removeChild(feed.firstChild);
  feed.scrollTop = feed.scrollHeight;
}

// ----------------------------------------------------------------------------
// Socket events
// ----------------------------------------------------------------------------
socket.on("state", (state) => { if (state) renderState(state); });
socket.on("chat", ({ username, comment }) => addChatMessage(username, comment));

socket.on("tiktok:connected", ({ username }) => {
  const pill = el("connStatus");
  pill.textContent = `🔴 LIVE @${username}`;
  pill.className = "pill pill-connected";
});
socket.on("tiktok:disconnected", () => {
  const pill = el("connStatus");
  pill.textContent = "Reconnecting to TikTok…";
  pill.className = "pill pill-disconnected";
});
socket.on("connect", () => {
  const pill = el("connStatus");
  if (pill.className.includes("connecting")) {
    pill.textContent = "Waiting for LIVE…";
  }
});

// ----------------------------------------------------------------------------
// Host controls
// ----------------------------------------------------------------------------
el("hostSendBtn").addEventListener("click", sendHostMessage);
el("hostInput").addEventListener("keydown", (e) => { if (e.key === "Enter") sendHostMessage(); });
function sendHostMessage() {
  const input = el("hostInput");
  const text = input.value.trim();
  if (!text) return;
  addChatMessage("🎤 Host", text);
  socket.emit("host:guess", text);
  input.value = "";
}

el("newRoundBtn").addEventListener("click", () => socket.emit("host:newRound"));
el("revealBtn").addEventListener("click", () => socket.emit("host:reveal"));
el("difficultySelect").addEventListener("change", (e) => socket.emit("host:setDifficulty", e.target.value));

// ----------------------------------------------------------------------------
// Boot
// ----------------------------------------------------------------------------
loadWorldAtlas().then(() => socket.emit("host:newRound"));
