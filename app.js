// === Configure this after deploying the Apps Script web app (see apps-script/SETUP.md) ===
const API_URL = 'PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE';

const POLL_INTERVAL_MS = 60000;
const TARGET_TOTAL = 500;
const MIN_PICK = 100;
const MAX_PICKS = 3;

let state = { tickets: [], teams: [], config: {}, winners: [], isAdmin: false };
let lastChampion = null;

const $ = id => document.getElementById(id);
const SESSION_KEY = 'footyPoolPassword';

function isConfigured() {
  return API_URL && !API_URL.startsWith('PASTE_');
}

function getPoolPassword() {
  return sessionStorage.getItem(SESSION_KEY) || '';
}

async function apiGet() {
  const url = API_URL + '?password=' + encodeURIComponent(getPoolPassword());
  const res = await fetch(url, { method: 'GET' });
  return res.json();
}

async function apiPost(payload) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload),
  });
  return res.json();
}

function groupTickets(tickets) {
  const byTicket = new Map();
  tickets.forEach(row => {
    if (!byTicket.has(row.TicketId)) {
      byTicket.set(row.TicketId, { ticketId: row.TicketId, name: row.Name, picks: [] });
    }
    byTicket.get(row.TicketId).picks.push({ team: row.Team, amount: Number(row.Amount) });
  });
  return Array.from(byTicket.values());
}

function eliminatedSet(teams) {
  return new Set(teams.filter(t => t.Eliminated === true || t.Eliminated === 'TRUE').map(t => t.Team));
}

function flagImg(team, w, cls) {
  const url = flagUrl(team, w || 80);
  if (!url) return '';
  return `<img src="${url}" alt="${team} flag" loading="lazy" class="${cls || ''}">`;
}

function renderStats(tickets, teams) {
  const totalPool = tickets.reduce((s, t) => s + Number(t.Amount), 0);
  const ticketIds = new Set(tickets.map(t => t.TicketId)).size;
  const aliveTeams = teams.filter(t => !(t.Eliminated === true || t.Eliminated === 'TRUE')).length;

  animateNumber($('statPool'), totalPool, v => `Rs.${v.toLocaleString('en-IN')}`);
  animateNumber($('statPlayers'), ticketIds);
  animateNumber($('statTeamsAlive'), aliveTeams);
}

function animateNumber(el, target, fmt) {
  const from = Number(el.dataset.val || 0);
  const to = Number(target);
  el.dataset.val = to;
  if (from === to) { el.textContent = fmt ? fmt(to) : to; return; }
  const duration = 500;
  const start = performance.now();
  function step(now) {
    const p = Math.min(1, (now - start) / duration);
    const val = Math.round(from + (to - from) * p);
    el.textContent = fmt ? fmt(val) : val;
    if (p < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function renderChampBanner(config) {
  const banner = $('champBanner');
  if (config.Champion) {
    banner.innerHTML = `🏆 <strong>${config.Champion}</strong> are World Cup Champions! Winners are below.`;
    banner.classList.remove('hidden');
    if (lastChampion !== config.Champion) {
      lastChampion = config.Champion;
      launchConfetti();
    }
  } else {
    banner.classList.add('hidden');
  }
}

function renderTeams(teams, config) {
  const grid = $('teamsGrid');
  grid.innerHTML = '';
  const sorted = [...teams].sort((a, b) => String(a.Team).localeCompare(String(b.Team)));
  sorted.forEach(t => {
    const out = t.Eliminated === true || t.Eliminated === 'TRUE';
    const isChamp = config.Champion === t.Team;
    const div = document.createElement('div');
    div.className = 'team-card' + (out ? ' eliminated' : '') + (isChamp ? ' champion' : '');
    div.innerHTML = `${flagImg(t.Team, 80)}<span>${t.Team}${isChamp ? ' 🏆' : ''}</span>`;
    grid.appendChild(div);
  });
}

function renderPlayers(tickets, teams) {
  const out = eliminatedSet(teams);
  const grouped = groupTickets(tickets);
  const list = $('playersList');
  list.innerHTML = '';

  if (grouped.length === 0) {
    list.innerHTML = '<p class="hint">No bets placed yet. Be the first!</p>';
    return;
  }

  grouped
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach(g => {
      const anyAlive = g.picks.some(p => !out.has(p.team));
      const row = document.createElement('div');
      row.className = 'player-row' + (anyAlive ? '' : ' player-out');

      const chipsHtml = g.picks.map(p => {
        const isOut = out.has(p.team);
        return `<span class="pick-chip${isOut ? ' out' : ''}">${flagImg(p.team, 40)}${p.team} · Rs.${p.amount}</span>`;
      }).join('');

      row.innerHTML = `
        <span class="player-name">${g.name}</span>
        <span class="player-picks">${chipsHtml}</span>
        <span class="status-badge ${anyAlive ? 'alive' : 'out'}">${anyAlive ? 'ALIVE' : 'OUT'}</span>
      `;
      list.appendChild(row);
    });
}

function renderWinners(winners) {
  const card = $('winnersCard');
  const list = $('winnersList');
  if (!winners || winners.length === 0) {
    card.classList.add('hidden');
    return;
  }
  card.classList.remove('hidden');
  list.innerHTML = '';
  winners
    .sort((a, b) => Number(b.PayoutShare) - Number(a.PayoutShare))
    .forEach(w => {
      const row = document.createElement('div');
      row.className = 'winner-row';
      row.innerHTML = `<span>🏅 ${w.Name} (staked Rs.${w.StakeOnChampion} on champion)</span><span>Rs.${Number(w.PayoutShare).toLocaleString('en-IN')}</span>`;
      list.appendChild(row);
    });
}

function populateTeamOptions(select, teams) {
  select.innerHTML = '<option value="" disabled selected>Choose team</option>';
  [...teams]
    .sort((a, b) => String(a.Team).localeCompare(String(b.Team)))
    .forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.Team;
      opt.textContent = t.Team;
      select.appendChild(opt);
    });
}

function addPickRow() {
  const container = $('picksContainer');
  if (container.children.length >= MAX_PICKS) return;
  const tpl = $('pickRowTemplate').content.cloneNode(true);
  const row = tpl.querySelector('.pick-row');
  const select = row.querySelector('.pick-team');
  const flagImgEl = row.querySelector('.pick-flag');
  populateTeamOptions(select, state.teams);

  select.addEventListener('change', () => {
    const url = flagUrl(select.value, 60);
    if (url) {
      flagImgEl.src = url;
      flagImgEl.classList.add('show');
    } else {
      flagImgEl.classList.remove('show');
    }
    updateSumIndicator();
  });

  row.querySelector('.remove-pick-btn').addEventListener('click', () => {
    row.remove();
    updateSumIndicator();
  });
  row.querySelector('.pick-amount').addEventListener('input', updateSumIndicator);
  container.appendChild(row);
  updateSumIndicator();
}

function currentPicks() {
  return Array.from(document.querySelectorAll('#picksContainer .pick-row')).map(row => ({
    team: row.querySelector('.pick-team').value,
    amount: Number(row.querySelector('.pick-amount').value || 0),
  }));
}

function updateSumIndicator() {
  const picks = currentPicks();
  const sum = picks.reduce((s, p) => s + p.amount, 0);
  const indicator = $('sumIndicator');
  indicator.textContent = `Rs.${sum} / Rs.${TARGET_TOTAL}`;

  const valid = sum === TARGET_TOTAL && picks.every(p => p.amount >= MIN_PICK && p.amount % 10 === 0 && p.team);
  const over = sum > TARGET_TOTAL;
  indicator.classList.toggle('ok', valid);
  indicator.classList.toggle('bad', !valid && sum > 0);

  const fill = $('sumGaugeFill');
  fill.style.width = Math.min(100, (sum / TARGET_TOTAL) * 100) + '%';
  fill.classList.toggle('over', over);

  $('submitBetBtn').disabled = !valid;
  $('addPickBtn').disabled = document.querySelectorAll('#picksContainer .pick-row').length >= MAX_PICKS;
}

async function handleBetSubmit(e) {
  e.preventDefault();
  const feedback = $('betFeedback');
  feedback.textContent = '';
  feedback.className = 'feedback';

  if (!isConfigured()) {
    feedback.textContent = 'Backend not configured yet.';
    feedback.classList.add('error');
    return;
  }

  const name = $('bettorName').value.trim();
  const password = getPoolPassword();
  const picks = currentPicks();

  $('submitBetBtn').disabled = true;
  try {
    const result = await apiPost({ action: 'placeBet', name, password, picks });
    if (result.ok) {
      feedback.textContent = '⚽ Bet placed! Good luck.';
      feedback.classList.add('success');
      $('betForm').reset();
      $('picksContainer').innerHTML = '';
      addPickRow();
      miniConfetti();
      await refresh();
    } else {
      feedback.textContent = result.error || 'Something went wrong.';
      feedback.classList.add('error');
    }
  } catch (err) {
    feedback.textContent = 'Network error: ' + err.message;
    feedback.classList.add('error');
  } finally {
    updateSumIndicator();
  }
}

async function refresh() {
  if (!isConfigured()) {
    $('configWarning').classList.remove('hidden');
    return;
  }
  try {
    const data = await apiGet();
    if (!data.ok) throw new Error(data.error || 'Failed to load');
    state = data;
    renderStats(data.tickets, data.teams);
    renderChampBanner(data.config);
    renderTeams(data.teams, data.config);
    renderPlayers(data.tickets, data.teams);
    renderWinners(data.winners);
    $('adminTabBtn').classList.toggle('hidden', !data.isAdmin);

    if ($('picksContainer').children.length === 0) addPickRow();
    document.querySelectorAll('#picksContainer .pick-team').forEach(sel => {
      const current = sel.value;
      populateTeamOptions(sel, data.teams);
      if (current) sel.value = current;
    });
  } catch (err) {
    console.error('Refresh failed', err);
  }
}

function setupTabs() {
  const buttons = document.querySelectorAll('.tab-btn');
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      buttons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.panel').forEach(p => p.classList.add('hidden'));
      $('panel-' + btn.dataset.tab).classList.remove('hidden');
    });
  });
}

const CONFETTI_COLORS = ['#1ee08a', '#ffcf4d', '#ff5d5d', '#4a86e8', '#ffffff'];

function miniConfetti() {
  spawnConfetti(40, 1800);
}

function launchConfetti() {
  spawnConfetti(140, 4000);
}

function spawnConfetti(count, duration) {
  const layer = $('confettiLayer');
  for (let i = 0; i < count; i++) {
    const piece = document.createElement('div');
    piece.className = 'confetti-piece';
    piece.style.left = Math.random() * 100 + 'vw';
    piece.style.background = CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)];
    piece.style.animationDuration = (duration / 1000 * (0.7 + Math.random() * 0.6)) + 's';
    piece.style.animationDelay = (Math.random() * 0.5) + 's';
    layer.appendChild(piece);
    setTimeout(() => piece.remove(), duration + 1000);
  }
}

async function tryEnter(password, feedbackEl) {
  if (!isConfigured()) {
    sessionStorage.setItem(SESSION_KEY, password);
    showApp();
    return true;
  }
  const url = API_URL + '?password=' + encodeURIComponent(password);
  try {
    const res = await fetch(url, { method: 'GET' });
    const data = await res.json();
    if (data.ok) {
      sessionStorage.setItem(SESSION_KEY, password);
      showApp();
      return true;
    }
    if (feedbackEl) feedbackEl.textContent = 'Wrong password — ask your organizer.';
    return false;
  } catch (err) {
    if (feedbackEl) feedbackEl.textContent = 'Network error: ' + err.message;
    return false;
  }
}

function showApp() {
  $('gateScreen').classList.add('hidden');
  $('appRoot').classList.remove('hidden');
  startApp();
}

function setupAdminReset() {
  const input = $('resetConfirmInput');
  const btn = $('resetPoolBtn');
  input.addEventListener('input', () => {
    btn.disabled = input.value.trim() !== 'RESET';
  });

  btn.addEventListener('click', async () => {
    const feedback = $('resetFeedback');
    feedback.textContent = '';
    feedback.className = 'feedback';
    btn.disabled = true;
    try {
      const result = await apiPost({ action: 'resetPool', password: getPoolPassword() });
      if (result.ok) {
        feedback.textContent = '✅ Pool reset. All bets, eliminations, and winners cleared.';
        feedback.classList.add('success');
        input.value = '';
        await refresh();
      } else {
        feedback.textContent = result.error || 'Something went wrong.';
        feedback.classList.add('error');
        btn.disabled = false;
      }
    } catch (err) {
      feedback.textContent = 'Network error: ' + err.message;
      feedback.classList.add('error');
      btn.disabled = false;
    }
  });
}

let appStarted = false;
function startApp() {
  if (appStarted) return;
  appStarted = true;
  if (!isConfigured()) {
    $('configWarning').classList.remove('hidden');
  }
  setupTabs();
  setupAdminReset();
  $('addPickBtn').addEventListener('click', addPickRow);
  $('betForm').addEventListener('submit', handleBetSubmit);
  addPickRow();
  refresh();
  setInterval(refresh, POLL_INTERVAL_MS);
}

function initGate() {
  $('gateForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const feedback = $('gateFeedback');
    feedback.textContent = '';
    const password = $('gatePassword').value;
    const ok = await tryEnter(password, feedback);
    if (!ok) $('gatePassword').value = '';
  });

  const remembered = getPoolPassword();
  if (remembered) {
    tryEnter(remembered, null);
  }
}

initGate();
