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
  thresholdsPulsed: new Set(),
  // Pause
  isPaused: false,
  gameElapsedMs: null,
  turnElapsedMs: null,
  // Round mode
  roundMode: false,
  currentRound: 1,
  // Navigation
  prevStatus: null,
};

// ── Audio ──────────────────────────────────────────────────────────────────

let audioCtx = null;
let soundEnabled = localStorage.getItem('soundEnabled') !== 'false'; // default on

function getAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioCtx;
}

// Unlock audio context on first user interaction anywhere on the page
document.addEventListener('pointerdown', () => getAudioContext(), { once: true });

function playTones(freqs, { spacing = 0.13, duration = 0.3, volume = 0.28 } = {}) {
  if (!soundEnabled) return;
  try {
    const ctx = getAudioContext();
    freqs.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.value = freq;
      const t = ctx.currentTime + i * spacing;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(volume, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
      osc.start(t);
      osc.stop(t + duration);
    });
  } catch (e) { /* audio blocked — silent fail */ }
}

function playTurnSound()      { playTones([523.25, 659.25]); }                                                // C5 → E5
function playGameEndSound()  { playTones([523.25, 659.25, 783.99], { spacing: 0.15, duration: 0.5 }); }     // C5 → E5 → G5
function play30sSound() {
  // Rapid ticking clock — 5 quick clicks to signal 30s urgency
  if (!soundEnabled) return;
  try {
    const ctx = getAudioContext();
    for (let i = 0; i < 5; i++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'square';
      osc.frequency.value = 900;
      const t = ctx.currentTime + i * 0.11;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.12, t + 0.004);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
      osc.start(t);
      osc.stop(t + 0.05);
    }
  } catch (e) { /* silent fail */ }
}
function playBongSound() {
  // Deep clock-tower bong — loud bell with long decay, repeats every 60s
  if (!soundEnabled) return;
  try {
    const ctx = getAudioContext();
    const partials = [
      { freq: 130.8, vol: 0.55, decay: 2.8 }, // C3 fundamental
      { freq: 261.6, vol: 0.25, decay: 1.8 }, // C4 octave
      { freq: 392.0, vol: 0.12, decay: 1.0 }, // G4 fifth
    ];
    partials.forEach(({ freq, vol, decay }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.value = freq;
      const t = ctx.currentTime;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(vol, t + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.001, t + decay);
      osc.start(t);
      osc.stop(t + decay);
    });
  } catch (e) { /* silent fail */ }
}

function playGameStartSound() {
  // Snappy ascending arpeggio — C4 E4 G4 C5
  playTones([261.63, 329.63, 392, 523.25], { spacing: 0.09, duration: 0.32, volume: 0.3 });
}

const GAME_START_PHRASES = [
  'Game On!',
  'May the best player win!',
  'Good Luck Everyone!',
  'Pause for Snacks!',
  'Time to play!',
];

function showGameStartSplash() {
  playGameStartSound();
  const phrase = GAME_START_PHRASES[Math.floor(Math.random() * GAME_START_PHRASES.length)];
  const el = document.createElement('div');
  el.className = 'game-start-splash';
  el.textContent = phrase;
  document.body.appendChild(el);
  el.addEventListener('animationend', () => el.remove());
}

function updateSoundToggleUI() {
  const btn = document.getElementById('btn-sound-toggle');
  if (!btn) return;
  btn.textContent = soundEnabled ? '🔊' : '🔇';
  btn.setAttribute('aria-label', soundEnabled ? 'Mute sound' : 'Unmute sound');
}

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

function showScreen(id, back = false) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active', 'back'));
  const next = document.getElementById(id);
  if (back) next.classList.add('back');
  next.classList.add('active');
}

// ── Setup Screen ───────────────────────────────────────────────────────────

let playerCount = 2;
const countDisplay = document.getElementById('player-count-display');
const playerNamesDiv = document.getElementById('player-names');

function renderNameInputs() {
  const existingValues = Array.from(playerNamesDiv.querySelectorAll('input')).map(i => i.value);
  playerNamesDiv.innerHTML = '';
  for (let i = 0; i < playerCount; i++) {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'player-name-input';
    input.placeholder = `Player ${i + 1} name`;
    input.maxLength = 20;
    input.setAttribute('aria-label', `Player ${i + 1} name`);
    if (existingValues[i]) input.value = existingValues[i];
    playerNamesDiv.appendChild(input);
  }
}

document.getElementById('count-down').addEventListener('click', () => {
  if (playerCount > 2) { playerCount--; countDisplay.textContent = playerCount; renderNameInputs(); }
});
document.getElementById('count-up').addEventListener('click', () => {
  if (playerCount < 6) { playerCount++; countDisplay.textContent = playerCount; renderNameInputs(); }
});

document.getElementById('btn-host').addEventListener('click', () => {
  const createBtn = document.getElementById('btn-create-room');
  createBtn.disabled = false;
  createBtn.textContent = 'Create Room';
  showScreen('screen-setup');
});
document.getElementById('btn-back-setup').addEventListener('click', () => showScreen('screen-home', true));
document.getElementById('btn-join-screen').addEventListener('click', () => {
  document.getElementById('join-code-input').value = '';
  document.getElementById('join-error').textContent = '';
  showScreen('screen-join');
});
document.getElementById('btn-back-join').addEventListener('click', () => showScreen('screen-home', true));

document.getElementById('btn-create-room').addEventListener('click', async () => {
  const btn = document.getElementById('btn-create-room');
  const errorEl = document.getElementById('setup-error');
  errorEl.textContent = '';
  btn.disabled = true;
  btn.textContent = 'Creating…';

  try {
    const inputs = playerNamesDiv.querySelectorAll('input');
    const players = Array.from(inputs).map((inp, i) => ({
      name: inp.value.trim() || `Player ${i + 1}`,
      totalMs: 0,
      turns: 0,
    }));

    const code = generateRoomCode();
    local.roomCode = code;
    local.isHost = true;

    const roundMode = document.getElementById('round-mode-toggle').checked;

    await db.ref(`rooms/${code}`).set({
      status: 'lobby',
      players,
      activeIndex: 0,
      gameStartMs: null,
      turnStartMs: null,
      isPaused: false,
      gameElapsedMs: null,
      turnElapsedMs: null,
      roundMode,
      currentRound: 1,
    });

    subscribeToRoom(code);
    document.getElementById('lobby-room-code').textContent = code;
    const beginBtn = document.getElementById('btn-begin-game');
    beginBtn.style.display = 'block';
    beginBtn.disabled = false;
    beginBtn.textContent = 'Start Game';
    document.getElementById('waiting-msg').style.display = 'none';
    showScreen('screen-lobby');
  } catch (err) {
    errorEl.textContent = 'Could not create room. Check your connection and try again.';
    btn.disabled = false;
    btn.textContent = 'Create Room';
  }
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
  const btn = document.getElementById('btn-join');
  const code = joinInput.value.trim().toUpperCase();
  const errorEl = document.getElementById('join-error');
  errorEl.textContent = '';

  if (code.length !== 5) {
    errorEl.textContent = 'Please enter the full 5-character code.';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Joining…';

  try {
    const snapshot = await db.ref(`rooms/${code}`).once('value');
    if (!snapshot.exists()) {
      errorEl.textContent = 'Room not found. Check the code and try again.';
      btn.disabled = false;
      btn.textContent = 'Join';
      return;
    }

    const data = snapshot.val();
    if (data.status === 'finished') {
      errorEl.textContent = 'That game has already ended.';
      btn.disabled = false;
      btn.textContent = 'Join';
      return;
    }

    local.roomCode = code;
    local.isHost = false;

    subscribeToRoom(code);
    document.getElementById('lobby-room-code').textContent = code;
    document.getElementById('btn-begin-game').style.display = 'none';
    document.getElementById('waiting-msg').style.display = 'block';
    showScreen('screen-lobby');
  } catch (err) {
    errorEl.textContent = 'Connection error. Check your network and try again.';
    btn.disabled = false;
    btn.textContent = 'Join';
  }
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
    local.isPaused = data.isPaused || false;
    local.gameElapsedMs = data.gameElapsedMs != null ? data.gameElapsedMs : null;
    local.turnElapsedMs = data.turnElapsedMs != null ? data.turnElapsedMs : null;
    local.roundMode = data.roundMode || false;
    local.currentRound = data.currentRound || 1;
    // Reset threshold tracker whenever the turn changes
    if (data.turnStartMs !== local.turnStartMs) {
      local.thresholdsPulsed = new Set();
    }
    local.turnStartMs = data.turnStartMs;

    if (data.status === 'lobby') {
      renderLobbyPlayers(data.players);
    } else if (data.status === 'playing') {
      renderScoreboard();
      updatePauseUI();
      document.getElementById('game-room-code').textContent = local.roomCode;
      showScreen('screen-game');
      startTick();
      if (local.prevStatus === 'lobby') showGameStartSplash();
    } else if (data.status === 'between-rounds') {
      stopTick();
      renderBetweenRounds(data);
      showScreen('screen-between-rounds');
    } else if (data.status === 'finished') {
      stopTick();
      renderSummary(data);
      showScreen('screen-summary');
    }
    local.prevStatus = data.status;
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
  const btn = document.getElementById('btn-begin-game');
  btn.disabled = true;
  btn.textContent = 'Starting…';
  try {
    await db.ref(`rooms/${local.roomCode}`).update({
      status: 'playing',
      gameStartMs: firebase.database.ServerValue.TIMESTAMP,
      turnStartMs: firebase.database.ServerValue.TIMESTAMP,
    });
  } catch (err) {
    btn.disabled = false;
    btn.textContent = 'Start Game';
  }
});

// ── Tick ───────────────────────────────────────────────────────────────────

function startTick() {
  if (local.tickInterval) return; // already running
  local.tickInterval = setInterval(tick, 500);
}

function stopTick() {
  clearInterval(local.tickInterval);
  local.tickInterval = null;
  const turnEl = document.getElementById('active-player-time');
  if (turnEl) {
    turnEl.classList.remove('timer-safe', 'timer-warning', 'timer-critical', 'timer-pulse');
  }
  const cardEl = document.getElementById('active-player-card');
  if (cardEl) cardEl.classList.remove('card-critical');
}

function tick() {
  if (!local.gameStartMs) return;

  if (local.isPaused) {
    if (local.gameElapsedMs != null)
      document.getElementById('total-time').textContent = formatTime(local.gameElapsedMs);
    if (local.turnElapsedMs != null)
      document.getElementById('active-player-time').textContent = formatTime(local.turnElapsedMs);
    return;
  }

  const now = Date.now();
  const turnMs = now - local.turnStartMs;

  document.getElementById('total-time').textContent = formatTime(now - local.gameStartMs);

  const turnEl = document.getElementById('active-player-time');
  turnEl.textContent = formatTime(turnMs);

  // Threshold coloring: 0–30s green, 31–60s yellow, 60s+ red
  const seconds = turnMs / 1000;
  turnEl.classList.toggle('timer-safe',     seconds < 30);
  turnEl.classList.toggle('timer-warning',  seconds >= 30 && seconds < 60);
  turnEl.classList.toggle('timer-critical', seconds >= 60);

  // 30s ticking clock — fires once
  if (seconds >= 30 && !local.thresholdsPulsed.has(30)) {
    local.thresholdsPulsed.add(30);
    play30sSound();
    turnEl.classList.add('timer-pulse');
    setTimeout(() => turnEl.classList.remove('timer-pulse'), 600);
  }

  // Bong at 60, 120, 180, … seconds
  const bongCount = Math.floor(seconds / 60);
  if (bongCount > 0 && !local.thresholdsPulsed.has(`bong${bongCount}`)) {
    local.thresholdsPulsed.add(`bong${bongCount}`);
    playBongSound();
    turnEl.classList.add('timer-pulse');
    setTimeout(() => turnEl.classList.remove('timer-pulse'), 600);
  }

  // Critical glow on the active player card at 60s+
  const cardEl = document.getElementById('active-player-card');
  if (cardEl) cardEl.classList.toggle('card-critical', seconds >= 60);

  // Live running time on the active scoreboard row
  const activeRowTimeEl = document.getElementById('active-row-time');
  if (activeRowTimeEl) {
    activeRowTimeEl.textContent = formatTime(local.players[local.activeIndex].totalMs + turnMs);
  }
}

// ── Game Screen ────────────────────────────────────────────────────────────

function renderScoreboard() {
  const active = local.players[local.activeIndex];
  if (active) {
    const nameEl = document.getElementById('active-player-name');
    if (nameEl.textContent !== active.name) {
      nameEl.textContent = active.name;
      nameEl.classList.remove('name-enter');
      void nameEl.offsetWidth; // force reflow to restart animation
      nameEl.classList.add('name-enter');
    }
  }

  // Round indicator
  const roundEl = document.getElementById('round-indicator');
  if (local.roundMode) {
    roundEl.textContent = `Round ${local.currentRound}`;
    roundEl.style.display = 'block';
  } else {
    roundEl.style.display = 'none';
  }

  // Show End Round for last player in round mode, otherwise End Turn
  const isLastPlayer = local.activeIndex === local.players.length - 1;
  const endTurnBtn  = document.getElementById('btn-end-turn');
  const endRoundBtn = document.getElementById('btn-end-round');
  if (local.roundMode && isLastPlayer) {
    endTurnBtn.style.display  = 'none';
    endRoundBtn.style.display = '';
  } else {
    endTurnBtn.style.display  = '';
    endRoundBtn.style.display = 'none';
  }

  const list = document.getElementById('scoreboard-list');
  list.innerHTML = '';
  local.players.forEach((p, i) => {
    const row = document.createElement('div');
    row.className = 'scoreboard-row' + (i === local.activeIndex ? ' active-row' : '');
    row.innerHTML = `
      <span class="player-name">${p.name}</span>
      <span class="player-time"${i === local.activeIndex ? ' id="active-row-time"' : ''}>${formatTime(p.totalMs)}</span>
    `;
    list.appendChild(row);
  });
}

document.getElementById('btn-end-turn').addEventListener('click', async () => {
  if (!local.turnStartMs) return;
  const btn = document.getElementById('btn-end-turn');
  btn.disabled = true;
  playTurnSound();

  try {
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
  } catch (err) {
    // silently re-enable — game state is unchanged on failure
  } finally {
    btn.disabled = false;
  }
});

document.getElementById('btn-end-game').addEventListener('click', async () => {
  if (!local.turnStartMs) return;
  if (!window.confirm('End the game for everyone? This cannot be undone.')) return;

  playGameEndSound();
  const btn = document.getElementById('btn-end-game');
  btn.disabled = true;
  btn.textContent = 'End Game';

  try {
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
  } catch (err) {
    btn.disabled = false;
    btn.textContent = 'End Game';
  }
});

// ── Pause / Resume ─────────────────────────────────────────────────────────

document.getElementById('btn-pause').addEventListener('click', async () => {
  const btn = document.getElementById('btn-pause');
  btn.disabled = true;
  try {
    if (local.isPaused) {
      const now = Date.now();
      await db.ref(`rooms/${local.roomCode}`).update({
        isPaused: false,
        gameStartMs: now - local.gameElapsedMs,
        turnStartMs: now - local.turnElapsedMs,
        gameElapsedMs: null,
        turnElapsedMs: null,
      });
    } else {
      await db.ref(`rooms/${local.roomCode}`).update({
        isPaused: true,
        gameElapsedMs: Date.now() - local.gameStartMs,
        turnElapsedMs: Date.now() - local.turnStartMs,
      });
    }
  } catch (err) {
    btn.disabled = false;
  }
});

function updatePauseUI() {
  const pauseBtn    = document.getElementById('btn-pause');
  const endTurnBtn  = document.getElementById('btn-end-turn');
  const endRoundBtn = document.getElementById('btn-end-round');
  const endGameBtn  = document.getElementById('btn-end-game');
  const badge       = document.getElementById('paused-badge');

  pauseBtn.disabled = false;
  if (local.isPaused) {
    pauseBtn.textContent = '▶';
    pauseBtn.setAttribute('aria-label', 'Resume game');
    endTurnBtn.disabled  = true;
    endRoundBtn.disabled = true;
    endGameBtn.disabled  = true;
    badge.style.display  = 'block';
  } else {
    pauseBtn.textContent = '⏸';
    pauseBtn.setAttribute('aria-label', 'Pause game');
    endTurnBtn.disabled  = false;
    endRoundBtn.disabled = false;
    endGameBtn.disabled  = false;
    badge.style.display  = 'none';
  }
}

// ── End Round ──────────────────────────────────────────────────────────────

document.getElementById('btn-end-round').addEventListener('click', async () => {
  if (!local.turnStartMs) return;
  const btn = document.getElementById('btn-end-round');
  btn.disabled = true;
  playTurnSound();

  try {
    const now = Date.now();
    const turnMs = now - local.turnStartMs;
    const players = local.players.map((p, i) => {
      if (i !== local.activeIndex) return p;
      return { ...p, totalMs: p.totalMs + turnMs, turns: p.turns + 1 };
    });

    await db.ref(`rooms/${local.roomCode}`).update({
      status: 'between-rounds',
      players,
      isPaused: true,
      gameElapsedMs: now - local.gameStartMs,
      turnElapsedMs: 0,
    });
  } catch (err) {
    btn.disabled = false;
  }
});

// ── Between Rounds ─────────────────────────────────────────────────────────

function renderBetweenRounds(data) {
  document.getElementById('round-complete-number').textContent = data.currentRound;
  const beginBtn = document.getElementById('btn-begin-round');
  beginBtn.textContent = `Begin Round ${data.currentRound + 1}`;
  beginBtn.disabled = false;

  const list = document.getElementById('reorder-list');
  list.innerHTML = '';
  (data.players || []).forEach((p, i) => {
    const row = document.createElement('div');
    row.className = 'reorder-row';
    const isFirst = i === 0;
    const isLast  = i === (data.players.length - 1);
    row.innerHTML = `
      <span class="reorder-position">${i + 1}</span>
      <span class="reorder-name">${p.name}</span>
      <div class="reorder-controls">
        <button class="reorder-btn" data-index="${i}" data-dir="-1"
          aria-label="Move ${p.name} up" ${isFirst ? 'disabled' : ''}>↑</button>
        <button class="reorder-btn" data-index="${i}" data-dir="1"
          aria-label="Move ${p.name} down" ${isLast ? 'disabled' : ''}>↓</button>
      </div>
    `;
    list.appendChild(row);
  });

  list.querySelectorAll('.reorder-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const idx = parseInt(btn.dataset.index);
      const dir = parseInt(btn.dataset.dir);

      // Animate rows sliding into each other's positions
      const allRows = Array.from(list.querySelectorAll('.reorder-row'));
      const rowA = allRows[idx];
      const rowB = allRows[idx + dir];
      const dist = rowA.offsetHeight + 8; // row height + gap

      // Disable all buttons for the duration of the animation
      list.querySelectorAll('.reorder-btn').forEach(b => { b.disabled = true; });

      rowA.style.zIndex = '2';
      rowA.style.transition = 'transform 220ms cubic-bezier(0.4, 0, 0.2, 1)';
      rowB.style.transition = 'transform 220ms cubic-bezier(0.4, 0, 0.2, 1)';
      rowA.style.transform = `translateY(${dir * dist}px)`;
      rowB.style.transform = `translateY(${-dir * dist}px)`;

      await new Promise(r => setTimeout(r, 220));

      const newPlayers = [...local.players];
      [newPlayers[idx], newPlayers[idx + dir]] = [newPlayers[idx + dir], newPlayers[idx]];
      await db.ref(`rooms/${local.roomCode}`).update({ players: newPlayers });
    });
  });
}

document.getElementById('btn-begin-round').addEventListener('click', async () => {
  const btn = document.getElementById('btn-begin-round');
  btn.disabled = true;
  btn.textContent = 'Starting…';
  try {
    const now = Date.now();
    await db.ref(`rooms/${local.roomCode}`).update({
      status: 'playing',
      isPaused: false,
      activeIndex: 0,
      currentRound: local.currentRound + 1,
      gameStartMs: now - local.gameElapsedMs,
      turnStartMs: now,
      gameElapsedMs: null,
      turnElapsedMs: null,
    });
  } catch (err) {
    btn.disabled = false;
    btn.textContent = `Begin Round ${local.currentRound + 1}`;
  }
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
    row.style.animationDelay = `${i * 80}ms`;
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
  local.isPaused = false;
  local.gameElapsedMs = null;
  local.turnElapsedMs = null;
  local.roundMode = false;
  local.currentRound = 1;

  playerCount = 2;
  countDisplay.textContent = 2;
  renderNameInputs();
  showScreen('screen-home');
});

// ── Sound Toggle ───────────────────────────────────────────────────────────

document.getElementById('btn-sound-toggle').addEventListener('click', () => {
  soundEnabled = !soundEnabled;
  localStorage.setItem('soundEnabled', soundEnabled);
  updateSoundToggleUI();
});

// ── Ripple Effect ─────────────────────────────────────────────────────────

document.querySelectorAll('.btn').forEach(btn => {
  btn.addEventListener('click', function(e) {
    if (this.disabled) return;
    const ripple = document.createElement('span');
    ripple.className = 'ripple';
    const rect = this.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    ripple.style.width = ripple.style.height = `${size}px`;
    ripple.style.left = `${e.clientX - rect.left - size / 2}px`;
    ripple.style.top = `${e.clientY - rect.top - size / 2}px`;
    this.appendChild(ripple);
    ripple.addEventListener('animationend', () => ripple.remove());
  });
});

// ── Init ───────────────────────────────────────────────────────────────────

renderNameInputs();
updateSoundToggleUI();
