// ── Firebase Setup ─────────────────────────────────────────────────────────

const firebaseConfig = {
  apiKey: "AIzaSyCR2akY62AHWRoqwFU4vjydCxx9EX4w9pM",
  authDomain: "board-game-timer-3fda4.firebaseapp.com",
  databaseURL: "https://board-game-timer-3fda4-default-rtdb.firebaseio.com",
  projectId: "board-game-timer-3fda4",
  storageBucket: "board-game-timer-3fda4.firebasestorage.app",
  messagingSenderId: "254046207634",
  appId: "1:254046207634:web:7afb4aa242f362a1b0f04b"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();

// ── Local State ────────────────────────────────────────────────────────────

const local = {
  roomCode: null,
  isHost: false,
  tickInterval: null,
  // Mirrors the last Firebase snapshot so the tick can read it
  players: [],
  activeIndex: 0,
  gameStartMs: null,
  turnStartMs: null,
};

// ── Helpers ────────────────────────────────────────────────────────────────

function formatTime(ms) {
  if (ms < 0) ms = 0;
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return [h, m, s].map(n => String(n).padStart(2, '0')).join(':');
}

function generateRoomCode() {
  // Excludes visually ambiguous characters (0, O, 1, I, L)
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 5; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// ── Setup Screen ───────────────────────────────────────────────────────────

let playerCount = 2;
const countDisplay = document.getElementById('player-count-display');
const playerNamesDiv = document.getElementById('player-names');

function renderNameInputs() {
  playerNamesDiv.innerHTML = '';
  for (let i = 0; i < playerCount; i++) {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'player-name-input';
    input.placeholder = `Player ${i + 1} name`;
    input.maxLength = 20;
    playerNamesDiv.appendChild(input);
  }
}

document.getElementById('count-down').addEventListener('click', () => {
  if (playerCount > 2) { playerCount--; countDisplay.textContent = playerCount; renderNameInputs(); }
});
document.getElementById('count-up').addEventListener('click', () => {
  if (playerCount < 6) { playerCount++; countDisplay.textContent = playerCount; renderNameInputs(); }
});

document.getElementById('btn-host').addEventListener('click', () => showScreen('screen-setup'));
document.getElementById('btn-back-setup').addEventListener('click', () => showScreen('screen-home'));
document.getElementById('btn-join-screen').addEventListener('click', () => {
  document.getElementById('join-code-input').value = '';
  document.getElementById('join-error').textContent = '';
  showScreen('screen-join');
});
document.getElementById('btn-back-join').addEventListener('click', () => showScreen('screen-home'));

document.getElementById('btn-create-room').addEventListener('click', async () => {
  const inputs = playerNamesDiv.querySelectorAll('input');
  const players = Array.from(inputs).map((inp, i) => ({
    name: inp.value.trim() || `Player ${i + 1}`,
    totalMs: 0,
    turns: 0,
  }));

  const code = generateRoomCode();
  local.roomCode = code;
  local.isHost = true;

  await db.ref(`rooms/${code}`).set({
    status: 'lobby',
    players,
    activeIndex: 0,
    gameStartMs: null,
    turnStartMs: null,
  });

  subscribeToRoom(code);
  document.getElementById('lobby-room-code').textContent = code;
  document.getElementById('btn-begin-game').style.display = 'block';
  document.getElementById('waiting-msg').style.display = 'none';
  showScreen('screen-lobby');
});

// ── Join Screen ────────────────────────────────────────────────────────────

const joinInput = document.getElementById('join-code-input');

// Auto-uppercase as the user types
joinInput.addEventListener('input', () => {
  const pos = joinInput.selectionStart;
  joinInput.value = joinInput.value.toUpperCase();
  joinInput.setSelectionRange(pos, pos);
});

document.getElementById('btn-join').addEventListener('click', async () => {
  const code = joinInput.value.trim().toUpperCase();
  const errorEl = document.getElementById('join-error');
  errorEl.textContent = '';

  if (code.length !== 5) {
    errorEl.textContent = 'Please enter the full 5-character code.';
    return;
  }

  const snapshot = await db.ref(`rooms/${code}`).once('value');
  if (!snapshot.exists()) {
    errorEl.textContent = 'Room not found. Check the code and try again.';
    return;
  }

  const data = snapshot.val();
  if (data.status === 'finished') {
    errorEl.textContent = 'That game has already ended.';
    return;
  }

  local.roomCode = code;
  local.isHost = false;

  subscribeToRoom(code);
  document.getElementById('lobby-room-code').textContent = code;
  document.getElementById('btn-begin-game').style.display = 'none';
  document.getElementById('waiting-msg').style.display = 'block';
  showScreen('screen-lobby');
});

// ── Firebase Subscription ──────────────────────────────────────────────────

function subscribeToRoom(code) {
  db.ref(`rooms/${code}`).on('value', snapshot => {
    const data = snapshot.val();
    if (!data) return;

    // Keep local mirror in sync
    local.players = data.players || [];
    local.activeIndex = data.activeIndex || 0;
    local.gameStartMs = data.gameStartMs;
    local.turnStartMs = data.turnStartMs;

    if (data.status === 'lobby') {
      renderLobbyPlayers(data.players);
    } else if (data.status === 'playing') {
      renderScoreboard();
      document.getElementById('game-room-code').textContent = local.roomCode;
      showScreen('screen-game');
      startTick();
    } else if (data.status === 'finished') {
      stopTick();
      renderSummary(data);
      showScreen('screen-summary');
    }
  });
}

// ── Lobby ──────────────────────────────────────────────────────────────────

function renderLobbyPlayers(players) {
  const list = document.getElementById('lobby-player-list');
  list.innerHTML = '';
  (players || []).forEach(p => {
    const row = document.createElement('div');
    row.className = 'scoreboard-row';
    row.innerHTML = `<span class="player-name">${p.name}</span>`;
    list.appendChild(row);
  });
}

document.getElementById('btn-begin-game').addEventListener('click', async () => {
  await db.ref(`rooms/${local.roomCode}`).update({
    status: 'playing',
    gameStartMs: firebase.database.ServerValue.TIMESTAMP,
    turnStartMs: firebase.database.ServerValue.TIMESTAMP,
  });
});

// ── Tick ───────────────────────────────────────────────────────────────────

function startTick() {
  if (local.tickInterval) return; // already running
  local.tickInterval = setInterval(tick, 500);
}

function stopTick() {
  clearInterval(local.tickInterval);
  local.tickInterval = null;
}

function tick() {
  if (!local.gameStartMs) return;
  const now = Date.now();

  document.getElementById('total-time').textContent = formatTime(now - local.gameStartMs);
  document.getElementById('active-player-time').textContent = formatTime(now - local.turnStartMs);
}

// ── Game Screen ────────────────────────────────────────────────────────────

function renderScoreboard() {
  const active = local.players[local.activeIndex];
  if (active) {
    document.getElementById('active-player-name').textContent = active.name;
  }

  const list = document.getElementById('scoreboard-list');
  list.innerHTML = '';
  local.players.forEach((p, i) => {
    const row = document.createElement('div');
    row.className = 'scoreboard-row' + (i === local.activeIndex ? ' active-row' : '');
    row.innerHTML = `
      <span class="player-name">${p.name}</span>
      <span class="player-time">${formatTime(p.totalMs)}</span>
    `;
    list.appendChild(row);
  });
}

document.getElementById('btn-end-turn').addEventListener('click', async () => {
  if (!local.turnStartMs) return;

  const turnMs = Date.now() - local.turnStartMs;
  const players = local.players.map((p, i) => {
    if (i !== local.activeIndex) return p;
    return { ...p, totalMs: p.totalMs + turnMs, turns: p.turns + 1 };
  });
  const nextIndex = (local.activeIndex + 1) % players.length;

  await db.ref(`rooms/${local.roomCode}`).update({
    players,
    activeIndex: nextIndex,
    turnStartMs: firebase.database.ServerValue.TIMESTAMP,
  });
});

document.getElementById('btn-end-game').addEventListener('click', async () => {
  if (!local.turnStartMs) return;

  const turnMs = Date.now() - local.turnStartMs;
  const players = local.players.map((p, i) => {
    if (i !== local.activeIndex) return p;
    return { ...p, totalMs: p.totalMs + turnMs, turns: p.turns + 1 };
  });
  const gameEndMs = Date.now();

  await db.ref(`rooms/${local.roomCode}`).update({
    status: 'finished',
    players,
    gameEndMs,
  });
});

// ── Summary Screen ─────────────────────────────────────────────────────────

function renderSummary(data) {
  const totalMs = (data.gameEndMs || Date.now()) - data.gameStartMs;
  document.getElementById('summary-total-time').textContent = formatTime(totalMs);

  const sorted = [...(data.players || [])].sort((a, b) => b.totalMs - a.totalMs);
  const list = document.getElementById('summary-list');
  list.innerHTML = '';

  sorted.forEach((p, i) => {
    const row = document.createElement('div');
    row.className = 'summary-row';
    row.innerHTML = `
      <span class="rank">${i + 1}.</span>
      <span class="player-name">${p.name}</span>
      <div class="summary-row-info">
        <span class="player-time">${formatTime(p.totalMs)}</span>
        <span class="turn-count">${p.turns} turn${p.turns !== 1 ? 's' : ''}</span>
      </div>
    `;
    list.appendChild(row);
  });
}

document.getElementById('btn-new-game').addEventListener('click', () => {
  // Unsubscribe from old room
  if (local.roomCode) {
    db.ref(`rooms/${local.roomCode}`).off();
  }
  stopTick();
  local.roomCode = null;
  local.isHost = false;
  local.players = [];

  playerCount = 2;
  countDisplay.textContent = 2;
  renderNameInputs();
  showScreen('screen-home');
});

// ── Init ───────────────────────────────────────────────────────────────────

renderNameInputs();
