// === Configure this after deploying the Apps Script web app (see apps-script/SETUP.md) ===
const API_URL = 'https://script.google.com/macros/s/AKfycbwKqPwghev-jNNa5MVmYeQt7DihgTqRRLzNiBBHorlMyD60CyE41y5XuuplzM1ymJ4F8A/exec';

const POLL_INTERVAL_MS = 60000;
const TARGET_TOTAL = 500;
const MIN_PICK = 100;
const MAX_PICKS = 3;

// Free, no-key public scoreboard — used to auto-detect knockout eliminations and the champion.
const ESPN_SCOREBOARD_URL = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard';
const TOURNAMENT_START = '20260611';
const LIVE_CHECK_INTERVAL_MS = 5 * 60 * 1000;

// ESPN's team names that differ from the ones in our Teams sheet.
const ESPN_NAME_MAP = {
  'Bosnia-Herzegovina': 'Bosnia and Herzegovina',
  'Congo DR': 'DR Congo',
  'Curaçao': 'Curacao',
  'Türkiye': 'Turkey',
  'United States': 'USA',
};

function mapEspnTeam(name) {
  return ESPN_NAME_MAP[name] || name;
}

function humanizeRound(slug) {
  return String(slug || '')
    .split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

let state = { tickets: [], teams: [], config: {}, winners: [], isAdmin: false };
let lastChampion = null;

const $ = id => document.getElementById(id);
const SESSION_KEY = 'footyPoolPassword'; // legacy key, purged on load — no longer used for storage

// Kept in memory only (not sessionStorage) so every page load requires re-entering the
// password. This is what lets an admin re-authenticate as admin after a shared-password
// visit, instead of silently staying logged in as whichever password was typed first.
let poolPassword = '';

function isConfigured() {
  return API_URL && !API_URL.startsWith('PASTE_');
}

function getPoolPassword() {
  return poolPassword;
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

function renderAdminBets(tickets, teams) {
  const list = $('adminBetsList');
  if (!list) return;
  const out = eliminatedSet(teams);
  const grouped = groupTickets(tickets);
  list.innerHTML = '';

  if (grouped.length === 0) {
    list.innerHTML = '<p class="hint">No bets to manage yet.</p>';
    return;
  }

  grouped
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach(g => {
      const row = document.createElement('div');
      row.className = 'admin-bet-row';

      const info = document.createElement('div');
      info.className = 'admin-bet-info';
      const nameEl = document.createElement('span');
      nameEl.className = 'player-name';
      nameEl.textContent = g.name; // textContent avoids HTML injection from user names
      const picksEl = document.createElement('span');
      picksEl.className = 'player-picks';
      g.picks.forEach(p => {
        const chip = document.createElement('span');
        chip.className = 'pick-chip' + (out.has(p.team) ? ' out' : '');
        chip.textContent = `${p.team} · Rs.${p.amount}`;
        picksEl.appendChild(chip);
      });
      info.appendChild(nameEl);
      info.appendChild(picksEl);

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'remove-bet-btn';
      btn.textContent = '🗑️ Remove';
      btn.addEventListener('click', () => removeBet(g.ticketId, g.name));

      row.appendChild(info);
      row.appendChild(btn);
      list.appendChild(row);
    });
}

async function removeBet(ticketId, name) {
  const feedback = $('removeBetFeedback');
  feedback.textContent = '';
  feedback.className = 'feedback';
  if (!window.confirm(`Remove ${name}'s bet? This can't be undone.`)) return;

  try {
    const result = await apiPost({ action: 'removeTicket', ticketId, password: getPoolPassword() });
    if (result.ok) {
      feedback.textContent = `Removed ${name}'s bet.`;
      feedback.classList.add('success');
      await refresh();
    } else {
      feedback.textContent = result.error || 'Something went wrong.';
      feedback.classList.add('error');
    }
  } catch (err) {
    feedback.textContent = 'Network error: ' + err.message;
    feedback.classList.add('error');
  }
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

function populateTeamOptions(select, teams, keepValue) {
  select.innerHTML = '<option value="" disabled selected>Choose team</option>';
  const alive = teams.filter(t => !(t.Eliminated === true || t.Eliminated === 'TRUE'));
  // Keep a team the user already had selected visible (greyed out) even if it just got eliminated.
  const keepTeam = keepValue && !alive.some(t => t.Team === keepValue)
    ? teams.find(t => t.Team === keepValue)
    : null;

  [...alive]
    .sort((a, b) => String(a.Team).localeCompare(String(b.Team)))
    .forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.Team;
      opt.textContent = t.Team;
      select.appendChild(opt);
    });

  if (keepTeam) {
    const opt = document.createElement('option');
    opt.value = keepTeam.Team;
    opt.textContent = keepTeam.Team + ' (eliminated — pick another team)';
    opt.disabled = true;
    select.appendChild(opt);
  }
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

  const eliminated = eliminatedSet(state.teams);
  const valid = sum === TARGET_TOTAL && picks.every(p => p.amount >= MIN_PICK && p.amount % 10 === 0 && p.team && !eliminated.has(p.team));
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
    if (data.isAdmin) renderAdminBets(data.tickets, data.teams);

    if ($('picksContainer').children.length === 0) addPickRow();
    document.querySelectorAll('#picksContainer .pick-team').forEach(sel => {
      const current = sel.value;
      populateTeamOptions(sel, data.teams, current);
      if (current) sel.value = current;
      updateSumIndicator();
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
      if (btn.dataset.tab === 'fixtures') { loadWinnerOdds(); loadFixtures(); }
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
    poolPassword = password;
    showApp();
    return true;
  }
  const url = API_URL + '?password=' + encodeURIComponent(password);
  try {
    const res = await fetch(url, { method: 'GET' });
    const data = await res.json();
    if (data.ok) {
      poolPassword = password;
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

function logOut() {
  // A full reload (rather than resetting in-place state) guarantees a clean slate: no
  // stacked event listeners or duplicate setInterval timers left over from the previous
  // login, which is what was causing the admin/non-admin state to feel unstable.
  location.reload();
}

function todayCompact() {
  const d = new Date(Date.now() + 24 * 60 * 60 * 1000); // +1 day buffer for timezones
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

async function fetchLiveEvents() {
  const url = `${ESPN_SCOREBOARD_URL}?dates=${TOURNAMENT_START}-${todayCompact()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Scoreboard fetch failed: ' + res.status);
  const data = await res.json();
  return data.events || [];
}

// ---- Title-winner odds (Polymarket) ----
const POLYMARKET_URL = 'https://gamma-api.polymarket.com/events?slug=world-cup-winner';
let winnerOddsLoaded = false;

// Polymarket team names that differ from our Teams-sheet names (mostly identical; a few safety maps).
const POLY_NAME_MAP = {
  'United States': 'USA',
  'South Korea': 'South Korea',
  'Ivory Coast': 'Ivory Coast',
  'DR Congo': 'DR Congo',
  'Bosnia and Herzegovina': 'Bosnia and Herzegovina',
};
function mapPolyTeam(name) { return POLY_NAME_MAP[name] || name; }

async function loadWinnerOdds(force) {
  if (winnerOddsLoaded && !force) return;
  const list = $('winnerOddsList');
  if (!list) return;
  if (!winnerOddsLoaded) list.innerHTML = '<p class="hint">Loading title odds…</p>';

  try {
    const res = await fetch(POLYMARKET_URL);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const ev = Array.isArray(data) ? data[0] : data;
    const markets = (ev && ev.markets) || [];
    const eliminated = eliminatedSet(state.teams);

    const rows = markets
      .filter(m => m.active && !m.closed)
      .map(m => {
        let prob = 0;
        try { prob = Number(JSON.parse(m.outcomePrices || '["0"]')[0]) || 0; } catch (e) { prob = 0; }
        return { team: mapPolyTeam(m.groupItemTitle || ''), prob };
      })
      .filter(r => r.team && !eliminated.has(r.team) && r.prob > 0)
      .sort((a, b) => b.prob - a.prob);

    renderWinnerOdds(rows);
    winnerOddsLoaded = true;
  } catch (err) {
    list.innerHTML = `<p class="hint">Couldn't load title odds right now (${err.message}).</p>`;
  }
}

function renderWinnerOdds(rows) {
  const list = $('winnerOddsList');
  list.innerHTML = '';
  if (!rows || rows.length === 0) {
    list.innerHTML = '<p class="hint">No title-odds market available right now.</p>';
    return;
  }
  const max = rows[0].prob || 1;
  rows.forEach((r, i) => {
    const pct = Math.round(r.prob * 100);
    const row = document.createElement('div');
    row.className = 'odds-row' + (i === 0 ? ' leader' : '');
    row.innerHTML =
      `<span class="odds-rank">${i + 1}</span>` +
      `<span class="odds-flag">${flagImg(r.team, 40) || ''}</span>` +
      `<span class="odds-team">${r.team}</span>` +
      `<span class="odds-bar-wrap"><span class="odds-bar" style="width:${Math.max(4, (r.prob / max) * 100)}%"></span></span>` +
      `<span class="odds-pct">${pct}%</span>`;
    list.appendChild(row);
  });
}

// ---- Fixtures & match odds (ESPN) ----
const TOURNAMENT_END = '20260720';
let fixturesLoaded = false;

async function loadFixtures(force) {
  if (fixturesLoaded && !force) return;
  const list = $('fixturesList');
  if (!list) return;
  if (!fixturesLoaded) list.innerHTML = '<p class="hint">Loading fixtures…</p>';

  try {
    const url = `${ESPN_SCOREBOARD_URL}?dates=${todayCompact()}-${TOURNAMENT_END}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const upcoming = (data.events || []).filter(ev => {
      const st = ev.competitions && ev.competitions[0] && ev.competitions[0].status;
      return st && st.type && st.type.state === 'pre';
    });
    renderFixtures(upcoming);
    fixturesLoaded = true;
  } catch (err) {
    list.innerHTML = `<p class="hint">Couldn't load fixtures right now (${err.message}). Try again shortly.</p>`;
  }
}

// American moneyline -> implied win probability (includes bookmaker margin).
function impliedProb(ml) {
  if (ml < 0) return (-ml) / ((-ml) + 100);
  return 100 / (ml + 100);
}

// details looks like "ESP -110" / "USA +135" -> { abbr, ml }.
function parseOddsDetails(details) {
  const m = String(details || '').match(/^([A-Za-z]+)\s+([+-]\d+)$/);
  if (!m) return null;
  return { abbr: m[1], ml: Number(m[2]) };
}

function isPlaceholderName(name) {
  return /winner|loser|tbd/i.test(name || '');
}

function renderFixtures(events) {
  const list = $('fixturesList');
  list.innerHTML = '';
  if (!events || events.length === 0) {
    list.innerHTML = '<p class="hint">No upcoming fixtures — the tournament may be finished. 🏆</p>';
    return;
  }

  events
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .forEach(ev => {
      const comp = ev.competitions[0];
      const round = humanizeRound(ev.season && ev.season.slug);
      const competitors = comp.competitors || [];
      const home = competitors.find(c => c.homeAway === 'home') || competitors[0] || {};
      const away = competitors.find(c => c.homeAway === 'away') || competitors[1] || {};

      const odds = (comp.odds || [])[0];
      const parsed = odds ? parseOddsDetails(odds.details) : null;

      const card = document.createElement('div');
      card.className = 'fixture-card';

      const kickoff = new Date(ev.date).toLocaleString(undefined, {
        weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
      });

      const head = document.createElement('div');
      head.className = 'fixture-head';
      head.innerHTML = `<span class="fixture-round">${round}</span><span class="fixture-time">${kickoff}</span>`;
      card.appendChild(head);

      const body = document.createElement('div');
      body.className = 'fixture-body';
      body.appendChild(fixtureTeamEl(home, parsed));
      const vs = document.createElement('span');
      vs.className = 'fixture-vs';
      vs.textContent = 'vs';
      body.appendChild(vs);
      body.appendChild(fixtureTeamEl(away, parsed));
      card.appendChild(body);

      const meta = document.createElement('div');
      meta.className = 'fixture-odds';
      if (parsed) {
        const favName = favoredTeamName(competitors, parsed.abbr);
        const pct = Math.round(impliedProb(parsed.ml) * 100);
        const drawMl = odds.drawOdds && odds.drawOdds.moneyLine;
        meta.innerHTML =
          `<span class="odds-chip">⭐ ${favName || parsed.abbr} favoured · ${parsed.ml > 0 ? '+' : ''}${parsed.ml} (~${pct}%)</span>` +
          (odds.overUnder != null ? `<span class="odds-chip subtle">O/U ${odds.overUnder} goals</span>` : '') +
          (drawMl != null ? `<span class="odds-chip subtle">Draw ${drawMl > 0 ? '+' : ''}${drawMl}</span>` : '');
      } else {
        meta.innerHTML = '<span class="odds-chip subtle">Odds not posted yet</span>';
      }
      card.appendChild(meta);

      list.appendChild(card);
    });
}

function favoredTeamName(competitors, abbr) {
  const c = competitors.find(x => x.team && x.team.abbreviation === abbr);
  return c ? mapEspnTeam(c.team.displayName) : null;
}

function fixtureTeamEl(competitor, parsed) {
  const el = document.createElement('div');
  el.className = 'fixture-team';
  const espnName = (competitor.team && competitor.team.displayName) || 'TBD';
  const placeholder = isPlaceholderName(espnName) || !competitor.team;
  const name = placeholder ? espnName : mapEspnTeam(espnName);
  const isFav = parsed && competitor.team && competitor.team.abbreviation === parsed.abbr;

  const flag = placeholder ? '' : flagImg(name, 60);
  el.innerHTML = `${flag || '<span class="fixture-flag-tbd">🏳️</span>'}<span class="fixture-team-name">${name}</span>`;
  if (isFav) el.classList.add('fav');
  return el;
}

let liveCheckRunning = false;

async function checkLiveResults(manual) {
  const statusEl = $('liveCheckStatus');
  if (!state.isAdmin) return;
  if (liveCheckRunning) return;
  liveCheckRunning = true;
  if (statusEl) statusEl.textContent = 'Checking latest results…';

  try {
    // Group-stage results are fixed history on the backend (see GROUP_STAGE_ELIMINATED in
    // Code.gs) and re-applied here every check so an accidental "reset pool" doesn't leave
    // those 16 teams looking alive until someone remembers to restore them by hand.
    const seedResult = await apiPost({ action: 'seedGroupStage', password: getPoolPassword() });
    const restoredGroupStage = seedResult.ok && seedResult.applied > 0;

    const events = await fetchLiveEvents();
    const eliminated = eliminatedSet(state.teams);
    const knownTeams = new Set(state.teams.map(t => t.Team));
    const actions = [];

    // Group stage is intentionally NOT auto-processed here: a single match's win/loss/draw
    // doesn't determine group-stage elimination (that depends on the full group table,
    // goal difference, and tie-breakers). ESPN's per-match `advance` field looked promising
    // but turned out to just mirror that match's own winner flag, not real standings — e.g.
    // it showed Germany as "eliminated" partway through the group stage despite them
    // finishing top of their group. Only knockout-stage matches (a clean, unambiguous
    // winner) are auto-processed below.
    events.forEach(ev => {
      const comp = ev.competitions && ev.competitions[0];
      const slug = ev.season && ev.season.slug;
      if (!comp || !slug || slug === 'group-stage') return;
      if (!comp.status || !comp.status.type || !comp.status.type.completed) return;

      const competitors = comp.competitors || [];
      const winner = competitors.find(c => c.winner === true);
      const loser = competitors.find(c => c.winner === false);
      if (!winner || !loser) return;

      const winnerTeam = mapEspnTeam(winner.team.displayName);
      const loserTeam = mapEspnTeam(loser.team.displayName);
      const round = humanizeRound(slug);

      if (knownTeams.has(loserTeam) && !eliminated.has(loserTeam)) {
        actions.push({ type: 'eliminate', team: loserTeam, round });
      }
      if (slug === 'final' && knownTeams.has(winnerTeam) && state.config.Champion !== winnerTeam) {
        actions.push({ type: 'champion', team: winnerTeam });
      }
    });

    if (actions.length === 0) {
      if (restoredGroupStage) {
        if (statusEl) statusEl.textContent = `Restored ${seedResult.applied} group-stage elimination(s) that had reverted to alive.`;
        await refresh();
      } else if (statusEl) {
        statusEl.textContent = `No new results as of ${new Date().toLocaleTimeString()}.`;
      }
      return;
    }

    for (const action of actions) {
      if (action.type === 'eliminate') {
        await apiPost({ action: 'eliminateTeam', team: action.team, round: action.round, password: getPoolPassword() });
      } else if (action.type === 'champion') {
        await apiPost({ action: 'declareChampion', team: action.team, password: getPoolPassword() });
      }
    }

    const summary = actions.map(a => a.type === 'champion' ? `${a.team} crowned champion!` : `${a.team} eliminated (${a.round})`).join(', ');
    const prefix = restoredGroupStage ? `Also restored ${seedResult.applied} group-stage elimination(s). ` : '';
    if (statusEl) statusEl.textContent = `${prefix}Updated: ${summary}`;
    await refresh();
  } catch (err) {
    if (statusEl) statusEl.textContent = 'Live check failed: ' + err.message;
    console.error('checkLiveResults failed', err);
  } finally {
    liveCheckRunning = false;
  }
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
  const checkNowBtn = $('checkLiveNowBtn');
  if (checkNowBtn) checkNowBtn.addEventListener('click', () => checkLiveResults(true));
  const logOutBtn = $('logOutBtn');
  if (logOutBtn) logOutBtn.addEventListener('click', logOut);
  addPickRow();
  refresh().then(() => checkLiveResults());
  setInterval(refresh, POLL_INTERVAL_MS);
  setInterval(() => checkLiveResults(), LIVE_CHECK_INTERVAL_MS);
  // Refresh odds/fixtures periodically, but only once the user has opened that tab.
  setInterval(() => {
    if (fixturesLoaded) loadFixtures(true);
    if (winnerOddsLoaded) loadWinnerOdds(true);
  }, LIVE_CHECK_INTERVAL_MS);
}

function initGate() {
  // Purge any leftover password from an older version of this app that used sessionStorage.
  try { sessionStorage.removeItem(SESSION_KEY); } catch (err) { /* ignore */ }

  $('gateForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const feedback = $('gateFeedback');
    feedback.textContent = '';
    const password = $('gatePassword').value;
    const ok = await tryEnter(password, feedback);
    if (!ok) $('gatePassword').value = '';
  });
}

initGate();
