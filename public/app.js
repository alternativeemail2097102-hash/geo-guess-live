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
let mapReady = false;       // true once a shape has actually been painted at least once

function setLoaderText(text) {
  const t = el("mapLoaderText");
  if (t) t.textContent = text;
}
function showMapError(message) {
  el("mapLoader").classList.remove("hidden");
  el("mapSpinner").style.display = "none";
  setLoaderText(message);
  el("mapRetryBtn").style.display = "inline-block";
}
function showMapLoading(message) {
  el("mapLoader").classList.remove("hidden");
  el("mapSpinner").style.display = "block";
  el("mapRetryBtn").style.display = "none";
  setLoaderText(message);
}
function hideMapLoader() {
  el("mapLoader").classList.add("hidden");
}

// Loads a <script> tag on demand and resolves once it's actually executed.
// Used as a fallback if the CDN <script> tags in index.html failed silently
// (can happen on some mobile carrier networks / privacy browsers).
function loadScriptOnce(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error("Failed to load " + src));
    document.head.appendChild(s);
  });
}

async function ensureMapLibraries() {
  if (typeof d3 !== "undefined" && typeof topojson !== "undefined") return true;
  setLoaderText("Map library didn't load — retrying…");
  try {
    if (typeof d3 === "undefined") {
      await loadScriptOnce("https://cdn.jsdelivr.net/npm/d3-geo@3");
    }
    if (typeof topojson === "undefined") {
      await loadScriptOnce("https://cdn.jsdelivr.net/npm/topojson-client@3");
    }
    return typeof d3 !== "undefined" && typeof topojson !== "undefined";
  } catch (err) {
    console.error(err);
    return false;
  }
}

// ----------------------------------------------------------------------------
// Load the world map shapes. Defends against every failure mode we know of:
// slow network, failed fetch, failed CDN script load, and bad/missing data —
// each with a visible message and a manual Retry button, so it can never
// again fail completely silently.
// ----------------------------------------------------------------------------
async function loadWorldAtlas() {
  showMapLoading("Loading world map…");
  try {
    const librariesOk = await ensureMapLibraries();
    if (!librariesOk) {
      showMapError("⚠️ Map library failed to load. Check your connection, then retry.");
      return;
    }
    const sources = [
      "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json",
      "https://unpkg.com/world-atlas@2/countries-110m.json",
    ];
    let topo = null, lastErr = null;
    for (const url of sources) {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error("HTTP " + res.status);
        topo = await res.json();
        break;
      } catch (err) { lastErr = err; }
    }
    if (!topo) throw lastErr || new Error("No map source responded");

    worldFeatures = topojson.feature(topo, topo.objects.countries).features;
    hideMapLoader();
    // Redraw immediately using whatever round is currently active,
    // regardless of when this finished loading relative to game events.
    if (latestState) drawCountrySilhouette(latestState.targetIso);
    // Safety net: if nothing actually painted a few seconds later
    // (e.g. the round's iso didn't match anything), surface a retry option
    // instead of leaving a permanently blank box.
    setTimeout(() => {
      if (!mapReady) showMapError("⚠️ Map didn't render. Tap Retry, or try New Round.");
    }, 4000);
  } catch (err) {
    console.error("Failed to load world map data:", err);
    showMapError("⚠️ Couldn't load map data. Check your connection, then retry.");
  }
}
el("mapRetryBtn").addEventListener("click", loadWorldAtlas);

function drawCountrySilhouette(iso) {
  if (!worldFeatures || !iso) return;
  try {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const feature = worldFeatures.find(
      (f) => String(f.id).padStart(3, "0") === String(iso).padStart(3, "0")
    );
    if (!feature) {
      ctx.fillStyle = "#93a2b8";
      ctx.font = "18px Inter, sans-serif";
      ctx.fillText("Map shape unavailable for this round — try New Round.", 20, 40);
      mapReady = true;
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
    mapReady = true;
    hideMapLoader();
  } catch (err) {
    console.error("Error drawing country silhouette:", err);
    showMapError("⚠️ Map rendering error. Tap Retry.");
  }
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
