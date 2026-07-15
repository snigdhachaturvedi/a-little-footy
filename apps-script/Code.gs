/**
 * FIFA World Cup Survivor Pool — Apps Script backend.
 * Deploy as a Web App (Execute as: Me, Who has access: Anyone).
 * Expects a bound Spreadsheet with three tabs: Tickets, Teams, Config.
 * See SETUP.md for the exact sheet layout.
 */

const SHEET_TICKETS = 'Tickets';
const SHEET_TEAMS = 'Teams';
const SHEET_CONFIG = 'Config';
const SHEET_WINNERS = 'Winners';

const TICKET_HEADERS = ['TicketId', 'Name', 'Team', 'Amount', 'Timestamp'];
const TEAM_HEADERS = ['Team', 'Eliminated', 'Round', 'Date'];
const WINNER_HEADERS = ['Name', 'TicketId', 'StakeOnChampion', 'PayoutShare'];

// Group stage is over for good — this is fixed historical fact, not something the live
// results checker can safely re-derive (a single match's win/loss doesn't determine group
// qualification; that needs full standings/tie-breakers). Kept here so it survives an
// admin "reset pool" without needing a manual API call to restore it.
const GROUP_STAGE_ELIMINATED = [
  'Czechia', 'Qatar', 'Haiti', 'Turkey', 'Curacao', 'Tunisia', 'New Zealand',
  'Saudi Arabia', 'Iraq', 'Jordan', 'Uzbekistan', 'Panama',
  'South Korea', 'Scotland', 'Iran', 'Uruguay',
];

function getSheet_(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(name);
  if (!sheet) throw new Error('Missing sheet tab: ' + name);
  return sheet;
}

function readRows_(sheetName) {
  const sheet = getSheet_(sheetName);
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0];
  return values.slice(1)
    .filter(row => row.some(cell => cell !== '' && cell !== null))
    .map(row => {
      const obj = {};
      headers.forEach((h, i) => obj[h] = row[i]);
      return obj;
    });
}

function getConfig_() {
  const rows = readRows_(SHEET_CONFIG);
  const config = {};
  rows.forEach(r => config[r.Key] = r.Value);
  return config;
}

function setConfigValue_(key, value) {
  const sheet = getSheet_(SHEET_CONFIG);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === key) {
      sheet.getRange(i + 1, 2).setValue(value);
      return;
    }
  }
  sheet.appendRow([key, value]);
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  const supplied = e.parameter.password;
  const config = getConfig_();
  const isAdmin = supplied && String(supplied) === String(config.AdminPassword);
  const validPassword = isAdmin || (supplied && String(supplied) === String(config.SharedPassword));

  if (!validPassword) {
    return jsonOut_({ ok: false, error: 'Unauthorized' });
  }

  const tickets = readRows_(SHEET_TICKETS);
  const teams = readRows_(SHEET_TEAMS);
  let winners = [];
  try { winners = readRows_(SHEET_WINNERS); } catch (err) { winners = []; }

  // Never expose passwords to the client.
  delete config.SharedPassword;
  delete config.AdminPassword;

  return jsonOut_({ ok: true, tickets, teams, config, winners, isAdmin });
}

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonOut_({ ok: false, error: 'Invalid JSON body' });
  }

  try {
    switch (body.action) {
      case 'placeBet':
        return jsonOut_(placeBet_(body));
      case 'eliminateTeam':
        return jsonOut_(eliminateTeam_(body));
      case 'reviveTeam':
        return jsonOut_(reviveTeam_(body));
      case 'declareChampion':
        return jsonOut_(declareChampion_(body));
      case 'resetPool':
        return jsonOut_(resetPool_(body));
      case 'seedGroupStage':
        return jsonOut_(seedGroupStage_(body));
      case 'removeTicket':
        return jsonOut_(removeTicket_(body));
      default:
        return jsonOut_({ ok: false, error: 'Unknown action: ' + body.action });
    }
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err) });
  }
}

function checkPassword_(supplied, expectedKey) {
  const config = getConfig_();
  const expected = config[expectedKey];
  if (!supplied || String(supplied) !== String(expected)) {
    throw new Error('Incorrect password');
  }
}

function placeBet_(body) {
  checkPassword_(body.password, 'SharedPassword');

  const name = (body.name || '').trim();
  const picks = body.picks;

  if (!name) throw new Error('Name is required');
  if (!Array.isArray(picks) || picks.length < 1 || picks.length > 3) {
    throw new Error('Must pick between 1 and 3 teams');
  }

  const teamsSeen = new Set();
  let sum = 0;
  const teamRows = readRows_(SHEET_TEAMS);
  const validTeams = new Set(teamRows.map(t => t.Team));
  const eliminatedTeams = new Set(teamRows.filter(t => t.Eliminated === true).map(t => t.Team));

  picks.forEach(p => {
    const team = (p.team || '').trim();
    const amount = Number(p.amount);
    if (!team || !validTeams.has(team)) throw new Error('Invalid team: ' + team);
    if (eliminatedTeams.has(team)) throw new Error(team + ' has already been eliminated');
    if (teamsSeen.has(team)) throw new Error('Duplicate team in one ticket: ' + team);
    teamsSeen.add(team);
    if (!Number.isFinite(amount) || amount < 100) throw new Error('Each pick must be at least Rs.100');
    if (amount % 10 !== 0) throw new Error('Each pick amount must be a multiple of 10');
    sum += amount;
  });

  if (sum !== 500) throw new Error('Picks must sum to exactly Rs.500 (got Rs.' + sum + ')');

  const ticketId = Utilities.getUuid();
  const timestamp = new Date();
  const sheet = getSheet_(SHEET_TICKETS);
  picks.forEach(p => {
    sheet.appendRow([ticketId, name, p.team.trim(), Number(p.amount), timestamp]);
  });

  return { ok: true, ticketId };
}

function findTeamRow_(team) {
  const sheet = getSheet_(SHEET_TEAMS);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === team) return { sheet, rowIndex: i + 1 };
  }
  return null;
}

function eliminateTeam_(body) {
  checkPassword_(body.password, 'AdminPassword');
  const found = findTeamRow_((body.team || '').trim());
  if (!found) throw new Error('Unknown team: ' + body.team);
  found.sheet.getRange(found.rowIndex, 2).setValue(true);
  found.sheet.getRange(found.rowIndex, 3).setValue(body.round || '');
  found.sheet.getRange(found.rowIndex, 4).setValue(new Date());
  return { ok: true };
}

function reviveTeam_(body) {
  // Safety valve for correcting mistaken eliminations.
  checkPassword_(body.password, 'AdminPassword');
  const found = findTeamRow_((body.team || '').trim());
  if (!found) throw new Error('Unknown team: ' + body.team);
  found.sheet.getRange(found.rowIndex, 2).setValue(false);
  found.sheet.getRange(found.rowIndex, 3).setValue('');
  found.sheet.getRange(found.rowIndex, 4).setValue('');
  return { ok: true };
}

function computeWinners_(champion) {
  const tickets = readRows_(SHEET_TICKETS);
  const totalPool = tickets.reduce((s, t) => s + Number(t.Amount), 0);
  const championPicks = tickets.filter(t => t.Team === champion);
  const totalChampionStake = championPicks.reduce((s, t) => s + Number(t.Amount), 0);

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let winnersSheet = ss.getSheetByName(SHEET_WINNERS);
  if (!winnersSheet) {
    winnersSheet = ss.insertSheet(SHEET_WINNERS);
  }
  winnersSheet.clear();
  winnersSheet.appendRow(WINNER_HEADERS);

  if (totalChampionStake > 0) {
    championPicks.forEach(p => {
      const share = (Number(p.Amount) / totalChampionStake) * totalPool;
      winnersSheet.appendRow([p.Name, p.TicketId, Number(p.Amount), Math.round(share * 100) / 100]);
    });
  }

  setConfigValue_('TotalPool', totalPool);
  return { totalPool, totalChampionStake };
}

function declareChampion_(body) {
  checkPassword_(body.password, 'AdminPassword');
  const champion = (body.team || '').trim();
  const validTeams = new Set(readRows_(SHEET_TEAMS).map(t => t.Team));
  if (!validTeams.has(champion)) throw new Error('Unknown team: ' + champion);

  setConfigValue_('Champion', champion);
  const totals = computeWinners_(champion);
  setConfigValue_('WinnersAnnounced', true);

  return { ok: true, champion, totalPool: totals.totalPool, totalChampionStake: totals.totalChampionStake };
}

function removeTicket_(body) {
  checkPassword_(body.password, 'AdminPassword');
  const ticketId = (body.ticketId || '').trim();
  if (!ticketId) throw new Error('ticketId is required');

  const sheet = getSheet_(SHEET_TICKETS);
  const data = sheet.getDataRange().getValues();
  let removed = 0;
  // Walk bottom-up so row deletions don't shift indices we haven't visited yet.
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][0]) === ticketId) {
      sheet.deleteRow(i + 1);
      removed++;
    }
  }
  if (removed === 0) throw new Error('No bet found with that id');

  // If a champion is already declared, payouts depend on total stakes — recompute so the
  // Winners tab stays correct after removing a bet.
  const champion = getConfig_().Champion;
  if (champion) computeWinners_(String(champion));

  return { ok: true, removed };
}

function deleteConfigKey_(key) {
  const sheet = getSheet_(SHEET_CONFIG);
  const data = sheet.getDataRange().getValues();
  for (let i = data.length - 1; i >= 1; i--) {
    if (data[i][0] === key) sheet.deleteRow(i + 1);
  }
}

function resetPool_(body) {
  checkPassword_(body.password, 'AdminPassword');

  // Wipe all bets.
  const ticketsSheet = getSheet_(SHEET_TICKETS);
  const lastRow = ticketsSheet.getLastRow();
  if (lastRow > 1) {
    ticketsSheet.getRange(2, 1, lastRow - 1, ticketsSheet.getLastColumn()).clearContent();
  }

  // Reset every team back to alive.
  const teamsSheet = getSheet_(SHEET_TEAMS);
  const teamsLastRow = teamsSheet.getLastRow();
  if (teamsLastRow > 1) {
    const numTeams = teamsLastRow - 1;
    teamsSheet.getRange(2, 2, numTeams, 1).setValue(false);
    teamsSheet.getRange(2, 3, numTeams, 2).clearContent();
  }

  // Clear champion/winners state.
  deleteConfigKey_('Champion');
  deleteConfigKey_('TotalPool');
  deleteConfigKey_('WinnersAnnounced');

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const winnersSheet = ss.getSheetByName(SHEET_WINNERS);
  if (winnersSheet) {
    winnersSheet.clear();
    winnersSheet.appendRow(WINNER_HEADERS);
  }

  return { ok: true };
}

function seedGroupStage_(body) {
  checkPassword_(body.password, 'AdminPassword');

  const eliminatedSet = new Set(GROUP_STAGE_ELIMINATED);
  const teams = readRows_(SHEET_TEAMS);
  let applied = 0;

  teams.forEach(t => {
    // Never downgrade a team already eliminated at a later stage (e.g. Round of 32) — only
    // fill in group-stage exits that got wiped (typically by a pool reset) and are
    // currently showing alive.
    if (eliminatedSet.has(t.Team) && t.Eliminated !== true) {
      const found = findTeamRow_(t.Team);
      if (found) {
        found.sheet.getRange(found.rowIndex, 2).setValue(true);
        found.sheet.getRange(found.rowIndex, 3).setValue('Group Stage');
        found.sheet.getRange(found.rowIndex, 4).setValue(new Date());
        applied++;
      }
    }
  });

  return { ok: true, applied };
}

/**
 * Server-side auto-updater. Runs on a time-driven trigger (see SETUP.md) so team
 * eliminations stay current even when nobody has the website open. Fetches completed
 * knockout results from ESPN's free scoreboard and marks losers eliminated / declares the
 * champion. Group-stage results are intentionally NOT auto-processed (they depend on full
 * group standings, which ESPN's per-match data doesn't reliably express) — those are seeded
 * separately via GROUP_STAGE_ELIMINATED.
 */
var ESPN_SCOREBOARD_GS = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard';
var TOURNAMENT_START_GS = '20260611';
var ESPN_NAME_MAP_GS = {
  'Bosnia-Herzegovina': 'Bosnia and Herzegovina',
  'Congo DR': 'DR Congo',
  'Curaçao': 'Curacao',
  'Türkiye': 'Turkey',
  'United States': 'USA'
};

function mapEspnTeamGs_(name) {
  return ESPN_NAME_MAP_GS[name] || name;
}

function humanizeRoundGs_(slug) {
  return String(slug || '').split('-').map(function (w) {
    return w.charAt(0).toUpperCase() + w.slice(1);
  }).join(' ');
}

function autoUpdateResults() {
  var end = Utilities.formatDate(new Date(Date.now() + 24 * 60 * 60 * 1000), 'Etc/UTC', 'yyyyMMdd');
  var url = ESPN_SCOREBOARD_GS + '?dates=' + TOURNAMENT_START_GS + '-' + end;
  var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (resp.getResponseCode() !== 200) {
    return { ok: false, error: 'ESPN HTTP ' + resp.getResponseCode() };
  }
  var data = JSON.parse(resp.getContentText());
  var events = data.events || [];

  var teamRows = readRows_(SHEET_TEAMS);
  var known = {}, eliminated = {};
  teamRows.forEach(function (t) {
    known[t.Team] = true;
    if (t.Eliminated === true) eliminated[t.Team] = true;
  });
  var config = getConfig_();
  var changes = [];

  events.forEach(function (ev) {
    var comp = ev.competitions && ev.competitions[0];
    var slug = ev.season && ev.season.slug;
    if (!comp || !slug || slug === 'group-stage') return;
    var st = comp.status && comp.status.type;
    if (!st || !st.completed) return;

    var comps = comp.competitors || [];
    var winner = null, loser = null;
    comps.forEach(function (c) {
      if (c.winner === true) winner = c;
      else if (c.winner === false) loser = c;
    });
    if (!winner || !loser) return;

    var loserName = mapEspnTeamGs_(loser.team.displayName);
    var winnerName = mapEspnTeamGs_(winner.team.displayName);
    var round = humanizeRoundGs_(slug);

    if (known[loserName] && !eliminated[loserName]) {
      var found = findTeamRow_(loserName);
      if (found) {
        found.sheet.getRange(found.rowIndex, 2).setValue(true);
        found.sheet.getRange(found.rowIndex, 3).setValue(round);
        found.sheet.getRange(found.rowIndex, 4).setValue(new Date());
        eliminated[loserName] = true;
        changes.push('Eliminated ' + loserName + ' (' + round + ')');
      }
    }

    if (slug === 'final' && known[winnerName] && config.Champion !== winnerName) {
      setConfigValue_('Champion', winnerName);
      computeWinners_(winnerName);
      setConfigValue_('WinnersAnnounced', true);
      changes.push('Champion: ' + winnerName);
    }
  });

  return { ok: true, changes: changes };
}
