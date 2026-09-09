// ============================================================================
//  GeoGuess LIVE — client
// ============================================================================

const socket = io();
const el = (id) => document.getElementById(id);
const canvas = el("mapCanvas");
const ctx = canvas.getContext("2d");

let worldFeatures = null;   // populated once the world map data finishes loading
let latestState = null;     // last state received from the server
let currentMode = "live";

// ----------------------------------------------------------------------------
// Load the world map shapes once. Robust against slow/failed network:
// shows a spinner while loading, an error if it fails, and — critically —
// redraws the current round's shape the moment loading finishes, even if
// no new game event has happened since.
// ----------------------------------------------------------------------------
async function loadWorldAtlas() {
  try {
    const res = await fetch("https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json");
    if (!res.ok) throw new Error("Network response was not OK (" + res.status + ")");
    const topo = await res.json();
    worldFeatures = topojson.feature(topo, topo.objects.countries).features;
    el("mapLoader").classList.add("hidden");
    // Redraw immediately using whatever round is currently active,
    // regardless of when this finished loading relative to game events.
    if (latestState) drawCountrySilhouette(latestState.targetIso);
  } catch (err) {
    console.error("Failed to load world map data:", err);
    const loader = el("mapLoader");
    loader.innerHTML = `<span style="color:var(--danger); text-align:center; padding:0 20px;">
      ⚠️ Couldn't load map data.<br/>Check your internet connection, then reload the page.
    </span>`;
  }
}

function drawCountrySilhouette(iso) {
  if (!worldFeatures || !iso) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const feature = worldFeatures.find(
    (f) => String(f.id).padStart(3, "0") === String(iso).padStart(3, "0")
  );
  if (!feature) {
    ctx.fillStyle = "#93a2b8";
    ctx.font = "18px Inter, sans-serif";
    ctx.fillText("Map shape unavailable for this round — try New Round.", 20, 40);
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
  ctx.strokeStyle = "#06121c";
  ctx.stroke();
}

// ----------------------------------------------------------------------------
// Toast feedback (for host / offline guesses that succeed, fail, or repeat)
// ----------------------------------------------------------------------------
let toastTimer = null;
function showToast(message, kind = "") {
  let toast = el("toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "toast";
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.className = "show " + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.className = ""; }, 2600);
}

// ----------------------------------------------------------------------------
// Rendering the rest of the UI from server state
// ----------------------------------------------------------------------------
function renderState(state) {
  if (!state) return;
  const prevStatus = latestState ? latestState.status : null;
  latestState = state;

  el("roundNumber").textContent = `Round ${state.round}`;
  el("guessesLeft").textContent = `${state.guessesLeft} guess${state.guessesLeft === 1 ? "" : "es"} left`;

  const status = el("statusMessage");
  if (state.status === "playing") {
    status.textContent = "Guess the country! 🗺️";
    status.style.color = "var(--accent-warm)";
  } else if (state.status === "won") {
    status.textContent = `🎉 Correct! It was ${state.targetName}!`;
    status.style.color = "var(--success)";
    if (prevStatus === "playing") {
      const flash = el("winFlash");
      flash.classList.remove("play"); void flash.offsetWidth; flash.classList.add("play");
    }
  } else if (state.status === "revealed") {
    status.textContent = `⏱️ Out of guesses! It was ${state.targetName}.`;
    status.style.color = "var(--danger)";
  }

  if (worldFeatures) drawCountrySilhouette(state.targetIso);

  // Guess list — newest guesses appear at the TOP; the CSS list uses
  // column-reverse so new rows visually push older ones down smoothly.
  const list = el("guessList");
  list.innerHTML = "";
  el("guessCount").textContent = state.guesses.length;
  el("guessEmpty").style.display = state.guesses.length ? "none" : "block";
  state.guesses.forEach((g, i) => {
    const row = document.createElement("div");
    row.className = "guess-row" + (g.correct ? " correct" : "");
    row.innerHTML = `
      <div class="guess-rank">${i + 1}</div>
      <div class="guess-body">
        <div class="guess-name">${escapeHtml(g.name)}</div>
        <div class="guess-meta">${escapeHtml(g.byWhom)} ${g.correct ? "✅ Correct!" : `• ${g.distanceKm.toLocaleString()} km ${g.direction || ""}`}</div>
        ${g.correct ? "" : `<div class="guess-bar-track"><div class="guess-bar-fill" style="width:${g.percent}%"></div></div>`}
      </div>
      <div class="guess-percent">${g.percent}%</div>
    `;
    list.appendChild(row);
  });
  list.scrollTop = 0; // keep newest guess in view

  // Leaderboard
  const lb = el("leaderboardList");
  lb.innerHTML = "";
  el("leaderboardEmpty").style.display = state.leaderboard.length ? "none" : "block";
  const medals = ["🥇", "🥈", "🥉"];
  state.leaderboard.forEach((entry, i) => {
    const li = document.createElement("li");
    li.innerHTML = `<span class="rank">${medals[i] || i + 1}</span><span class="name">${escapeHtml(entry.name)}</span><span class="pts">${entry.points} pts</span>`;
    lb.appendChild(li);
  });

  el("difficultySelect").value = state.difficulty;
  if (state.mode && state.mode !== currentMode) applyMode(state.mode, false);

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
// Live comment / activity feed
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
socket.on("state", (state) => renderState(state));
socket.on("chat", ({ username, comment }) => addChatMessage(username, comment));

socket.on("host:feedback", ({ result, text }) => {
  if (result === "correct") showToast(`✅ "${text}" is correct!`, "good");
  else if (result === "wrong") showToast(`Not quite — check the hint!`, "");
  else if (result === "unrecognized") showToast(`🤔 Didn't recognize "${text}" as a country`, "warn");
  else if (result === "not-playing") showToast(`Round isn't active — tap New Round`, "warn");
  else if (result === "already-guessed") showToast(`Already guessed this round`, "warn");
});

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
  if (pill.className.includes("connecting")) pill.textContent = "Waiting for LIVE…";
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
  addChatMessage(currentMode === "offline" ? "You" : "🎤 Host", text);
  socket.emit("host:guess", text);
  input.value = "";
}

el("offlineSendBtn").addEventListener("click", sendOfflineGuess);
el("offlineInput").addEventListener("keydown", (e) => { if (e.key === "Enter") sendOfflineGuess(); });
function sendOfflineGuess() {
  const input = el("offlineInput");
  const text = input.value.trim();
  if (!text) return;
  socket.emit("host:guess", text);
  input.value = "";
}

el("newRoundBtn").addEventListener("click", () => socket.emit("host:newRound"));
el("revealBtn").addEventListener("click", () => socket.emit("host:reveal"));
el("difficultySelect").addEventListener("change", (e) => socket.emit("host:setDifficulty", e.target.value));

// ----------------------------------------------------------------------------
// Mode switching (Live / Test / Offline)
// ----------------------------------------------------------------------------
function applyMode(mode, emit = true) {
  currentMode = mode;
  document.querySelectorAll(".mode-btn").forEach((b) => b.classList.toggle("active", b.dataset.mode === mode));
  el("offlineGuessBar").classList.toggle("visible", mode === "offline");
  el("hostBar").style.display = mode === "offline" ? "none" : "flex";
  if (emit) socket.emit("host:setMode", mode);
}
document.querySelectorAll(".mode-btn").forEach((btn) => {
  btn.addEventListener("click", () => applyMode(btn.dataset.mode));
});

// ----------------------------------------------------------------------------
// How to Play modal
// ----------------------------------------------------------------------------
function openHowTo() { el("howToModal").classList.add("visible"); }
function closeHowTo() { el("howToModal").classList.remove("visible"); }
el("howToBtn").addEventListener("click", openHowTo);
el("closeHowTo").addEventListener("click", closeHowTo);
el("gotItBtn").addEventListener("click", closeHowTo);
el("howToModal").addEventListener("click", (e) => { if (e.target.id === "howToModal") closeHowTo(); });

// ----------------------------------------------------------------------------
// Boot
// ----------------------------------------------------------------------------
loadWorldAtlas();
// Show How-to-Play automatically the very first time this browser opens the app.
if (!localStorage.getItem("geoguess_seen_howto")) {
  openHowTo();
  localStorage.setItem("geoguess_seen_howto", "1");
}
