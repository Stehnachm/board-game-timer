// ── State ──────────────────────────────────────────────────────────────────

const state = {
  playerCount: 2,
  players: [],          // [{ name, totalMs, turns }]
  activeIndex: 0,
  gameStartMs: null,
  turnStartMs: null,
  tickInterval: null,
};

// ── Helpers ────────────────────────────────────────────────────────────────

function formatTime(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return [h, m, s].map(n => String(n).padStart(2, '0')).join(':');
}

function now() {
  return Date.now();
}

// ── Setup Screen ───────────────────────────────────────────────────────────

const countDisplay = document.getElementById('player-count-display');
const playerNamesDiv = document.getElementById('player-names');

function renderNameInputs() {
  playerNamesDiv.innerHTML = '';
  for (let i = 0; i < state.playerCount; i++) {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'player-name-input';
    input.placeholder = `Player ${i + 1} name`;
    input.maxLength = 20;
    input.setAttribute('aria-label', `Player ${i + 1} name`);
    playerNamesDiv.appendChild(input);
  }
}

document.getElementById('count-down').addEventListener('click', () => {
  if (state.playerCount > 2) {
    state.playerCount--;
    countDisplay.textContent = state.playerCount;
    renderNameInputs();
  }
});

document.getElementById('count-up').addEventListener('click', () => {
  if (state.playerCount < 6) {
    state.playerCount++;
    countDisplay.textContent = state.playerCount;
    renderNameInputs();
  }
});

document.getElementById('btn-start').addEventListener('click', () => {
  const inputs = playerNamesDiv.querySelectorAll('input');
  state.players = Array.from(inputs).map((input, i) => ({
    name: input.value.trim() || `Player ${i + 1}`,
    totalMs: 0,
    turns: 0,
  }));
  startGame();
});

// ── Game Logic ─────────────────────────────────────────────────────────────

function startGame() {
  state.activeIndex = 0;
  state.gameStartMs = now();
  state.turnStartMs = now();

  renderScoreboard();
  showScreen('screen-game');
  startTick();
}

function startTick() {
  clearInterval(state.tickInterval);
  state.tickInterval = setInterval(tick, 500);
}

function tick() {
  const elapsed = now() - state.gameStartMs;
  document.getElementById('total-time').textContent = formatTime(elapsed);

  const turnElapsed = now() - state.turnStartMs;
  document.getElementById('active-player-time').textContent = formatTime(turnElapsed);
}

function endTurn() {
  const turnMs = now() - state.turnStartMs;
  const active = state.players[state.activeIndex];
  active.totalMs += turnMs;
  active.turns++;

  state.activeIndex = (state.activeIndex + 1) % state.players.length;
  state.turnStartMs = now();

  updateActiveCard();
  renderScoreboard();
}

function updateActiveCard() {
  const active = state.players[state.activeIndex];
  document.getElementById('active-player-name').textContent = active.name;
  document.getElementById('active-player-time').textContent = '00:00:00';
}

function renderScoreboard() {
  const list = document.getElementById('scoreboard-list');
  list.innerHTML = '';
  state.players.forEach((p, i) => {
    const row = document.createElement('div');
    row.className = 'scoreboard-row' + (i === state.activeIndex ? ' active-row' : '');

    const nameEl = document.createElement('span');
    nameEl.className = 'player-name';
    nameEl.textContent = p.name;

    const timeEl = document.createElement('span');
    timeEl.className = 'player-time';
    timeEl.textContent = formatTime(p.totalMs);

    row.appendChild(nameEl);
    row.appendChild(timeEl);
    list.appendChild(row);
  });

  updateActiveCard();
}

document.getElementById('btn-end-turn').addEventListener('click', endTurn);

document.getElementById('btn-end-game').addEventListener('click', () => {
  // Capture the current player's in-progress turn time
  const turnMs = now() - state.turnStartMs;
  state.players[state.activeIndex].totalMs += turnMs;
  state.players[state.activeIndex].turns++;

  clearInterval(state.tickInterval);
  showSummary();
});

// ── Summary Screen ─────────────────────────────────────────────────────────

function showSummary() {
  const totalMs = now() - state.gameStartMs;
  document.getElementById('summary-total-time').textContent = formatTime(totalMs);

  const sorted = [...state.players].sort((a, b) => b.totalMs - a.totalMs);
  const list = document.getElementById('summary-list');
  list.innerHTML = '';

  sorted.forEach((p, i) => {
    const row = document.createElement('div');
    row.className = 'summary-row';

    const rank = document.createElement('span');
    rank.className = 'rank';
    rank.textContent = `${i + 1}.`;

    const name = document.createElement('span');
    name.className = 'player-name';
    name.textContent = p.name;

    const info = document.createElement('div');
    info.className = 'summary-row-info';

    const time = document.createElement('span');
    time.className = 'player-time';
    time.textContent = formatTime(p.totalMs);

    const turns = document.createElement('span');
    turns.className = 'turn-count';
    turns.textContent = `${p.turns} turn${p.turns !== 1 ? 's' : ''}`;

    info.appendChild(time);
    info.appendChild(turns);

    row.appendChild(rank);
    row.appendChild(name);
    row.appendChild(info);
    list.appendChild(row);
  });

  showScreen('screen-summary');
}

document.getElementById('btn-new-game').addEventListener('click', () => {
  state.playerCount = 2;
  countDisplay.textContent = 2;
  renderNameInputs();
  showScreen('screen-setup');
});

// ── Screen Switcher ────────────────────────────────────────────────────────

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// ── Init ───────────────────────────────────────────────────────────────────

renderNameInputs();
