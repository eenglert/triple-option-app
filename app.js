// app.js — Triple Option
// ----------------------------------------

const API_KEY = "T6SDoIo5R9uq6TSVdejFUkQpDfWi/aHnHwdgGS9nGkMQxDLO5MgGtum+24lqhidd";
const BASE_URL = "https://api.collegefootballdata.com";

const year = new Date().getFullYear();
let week = 1;
let refreshInterval = null;

let users = [];

// ----------------------------------------
// localStorage Helpers
// ----------------------------------------
function saveState() {
  localStorage.setItem("tripleOption_users", JSON.stringify(users));
  localStorage.setItem("tripleOption_week", week);
}

// Returns "setup" | "selection" | "scoreboard" depending on saved progress
function loadState() {
  const savedUsers = localStorage.getItem("tripleOption_users");
  const savedWeek = localStorage.getItem("tripleOption_week");
  if (savedWeek) week = parseInt(savedWeek, 10);

  if (!savedUsers) return "setup";

  users = JSON.parse(savedUsers);
  if (users.length === 0) return "setup";

  return users.every(u => u.locked) ? "scoreboard" : "selection";
}

function resetApp() {
  if (!confirm("Reset everything and start over from setup?")) return;
  localStorage.clear();
  location.reload();
}

// ----------------------------------------
// Background Music Toggle
// ----------------------------------------
function initMusicToggle() {
  const musicBtn = document.getElementById("music-toggle");
  const bgMusic = document.getElementById("bg-music");
  if (!musicBtn || !bgMusic) return;

  let musicPlaying = false;

  musicBtn.addEventListener("click", () => {
    if (musicPlaying) {
      bgMusic.pause();
      musicBtn.textContent = "🔇";
    } else {
      bgMusic.play().catch(err => console.error("Playback blocked:", err));
      musicBtn.textContent = "🔊";
    }
    musicPlaying = !musicPlaying;
  });
}

// ----------------------------------------
// Detect Current Week
// ----------------------------------------
async function getCurrentWeek() {
  try {
    const res = await fetch("https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard");
    const data = await res.json();
    const currentWeek = data.week?.number || 1;
    week = currentWeek;
    document.getElementById("current-week-display").textContent = `Week ${currentWeek}`;
    const weekSelect = document.getElementById("week-select");
    if (weekSelect) weekSelect.value = currentWeek;
    return currentWeek;
  } catch (err) {
    console.error("Failed to detect current week:", err);
    return 1;
  }
}

// ----------------------------------------
// Search by Player Name (filtered by position + year)
// ----------------------------------------
async function fetchPlayersByName(position, searchTerm) {
  try {
    const res = await fetch(
      `${BASE_URL}/player/search?searchTerm=${encodeURIComponent(searchTerm)}&position=${position}&year=${year}`,
      { headers: { "Authorization": `Bearer ${API_KEY}` } }
    );
    const data = await res.json();
    return data.filter(p => !p.lastSeason || p.lastSeason >= year - 1);
  } catch (err) {
    console.error(`Error fetching players by name:`, err);
    return [];
  }
}

// ----------------------------------------
// Search by Team Name (fetch current roster, filter by position)
// ----------------------------------------
async function fetchPlayersByTeam(position, teamName) {
  try {
    const res = await fetch(
      `${BASE_URL}/roster?team=${encodeURIComponent(teamName)}&year=${year}`,
      { headers: { "Authorization": `Bearer ${API_KEY}` } }
    );
    const data = await res.json();
    return data
      .filter(p => p.position === position)
      .map(p => ({
        id: p.id,
        name: `${p.firstName} ${p.lastName}`,
        team: teamName,
        school: teamName,
        position: p.position,
      }));
  } catch (err) {
    console.error(`Error fetching roster for ${teamName}:`, err);
    return [];
  }
}

// ----------------------------------------
// Populate Dropdown
// ----------------------------------------
function populateDropdown(dropdownId, players) {
  const select = document.getElementById(dropdownId);
  select.innerHTML = "";

  if (players.length === 0) {
    const opt = document.createElement("option");
    opt.textContent = "No players found";
    opt.disabled = true;
    select.appendChild(opt);
    return;
  }

  players.forEach(player => {
    const opt = document.createElement("option");
    opt.textContent = `${player.name} - ${player.team || player.school || ""}`;
    opt.dataset.id = player.id;
    opt.dataset.name = player.name;
    opt.dataset.team = player.team || player.school || "";
    opt.dataset.position = player.position;
    opt.dataset.stats = "0 yds, 0 TD";
    opt.dataset.points = 0;
    select.appendChild(opt);
  });
}

// ----------------------------------------
// Build Team Object
// ----------------------------------------
function buildTeam(qbId, rbId, wrId) {
  return {
    QB: getSelected(qbId),
    RB: getSelected(rbId),
    WR: getSelected(wrId)
  };
}

function getSelected(selectId) {
  const sel = document.getElementById(selectId);
  if (!sel || !sel.value || sel.selectedIndex === -1) return null;
  const opt = sel.selectedOptions[0];
  if (opt.disabled) return null;
  return {
    id: opt.dataset.id,
    player: opt.dataset.name,
    team: opt.dataset.team,
    position: opt.dataset.position,
    stats: opt.dataset.stats,
    points: parseFloat(opt.dataset.points),
    gameId: null
  };
}

// ----------------------------------------
// Get ESPN Game ID for a Team
// ----------------------------------------
async function getGameId(teamName) {
  try {
    const res = await fetch(
      `${BASE_URL}/games?year=${year}&week=${week}&team=${encodeURIComponent(teamName)}`,
      { headers: { "Authorization": `Bearer ${API_KEY}` } }
    );
    const data = await res.json();
    if (!data || data.length === 0) return null;
    return data[0].id;
  } catch (err) {
    console.error(`Error fetching game ID for ${teamName}:`, err);
    return null;
  }
}

// ----------------------------------------
// Fetch Game Stats from ESPN
// ----------------------------------------
async function fetchTeamGameStats(teamName, gameId) {
  try {
    const url = `https://site.api.espn.com/apis/site/v2/sports/football/college-football/summary?event=${gameId}`;
    const res = await fetch(url);
    if (!res.ok) return null;

    const data = await res.json();
    const statsMap = {};

    if (data?.boxscore?.players) {
      data.boxscore.players.forEach(teamStats => {
        if (!teamStats?.statistics) return;
        teamStats.statistics.forEach(category => {
          if (!category?.athletes) return;
          const keys = category.keys;
          category.athletes.forEach(athlete => {
            const id = athlete.athlete.id.toString();
            if (!statsMap[id]) {
              statsMap[id] = {
                id,
                name: athlete.athlete.displayName,
                team: teamName,
                headshot: athlete.athlete?.headshot?.href || null,
                passingYards: 0, passingTDs: 0,
                rushingYards: 0, rushingTDs: 0,
                receivingYards: 0, receivingTDs: 0,
                specialTeamsYards: 0, specialTeamsTDs: 0,
                interceptions: 0, fumbles: 0,
              };
            }
            athlete.stats.forEach((val, i) => {
              const key = keys[i];
              const numVal = parseFloat(val) || 0;
              if (category.name === "passing") {
                if (key === "passingYards") statsMap[id].passingYards = numVal;
                if (key === "passingTouchdowns") statsMap[id].passingTDs = numVal;
                if (key === "interceptions") statsMap[id].interceptions = numVal;
              } else if (category.name === "rushing") {
                if (key === "rushingYards") statsMap[id].rushingYards = numVal;
                if (key === "rushingTouchdowns") statsMap[id].rushingTDs = numVal;
              } else if (category.name === "receiving") {
                if (key === "receivingYards") statsMap[id].receivingYards = numVal;
                if (key === "receivingTouchdowns") statsMap[id].receivingTDs = numVal;
              } else if (category.name === "kickReturns" || category.name === "puntReturns") {
                if (key === "kickReturnYards" || key === "puntReturnYards") statsMap[id].specialTeamsYards += numVal;
                if (key === "kickReturnTouchdowns" || key === "puntReturnTouchdowns") statsMap[id].specialTeamsTDs += numVal;
              } else if (category.name === "fumbles") {
                if (key === "fumbles") statsMap[id].fumbles += numVal;
              }
            });
          });
        });
      });
    } else {
      console.log(`No boxscore yet for game ${gameId} (${teamName})`);
    }

    return statsMap;
  } catch (err) {
    console.error(`Error fetching ESPN stats for ${teamName}:`, err);
    return null;
  }
}

// ----------------------------------------
// Calculate Fantasy Points
// ----------------------------------------
function calculatePoints(stats, position) {
  let points = 0;
  if (!stats) return 0;
  if (position === "QB") {
    points += (stats.passingYards || 0) * 0.5;
    points += (stats.passingTDs || 0) * 6;
    points += (stats.rushingYards || 0) * 0.5;
    points += (stats.rushingTDs || 0) * 6;
    points += (stats.interceptions || 0) * -4;
  } else if (position === "RB" || position === "WR") {
    points += (stats.rushingYards || 0) * 0.5;
    points += (stats.rushingTDs || 0) * 6;
    points += (stats.receivingYards || 0) * 0.5;
    points += (stats.receivingTDs || 0) * 6;
    points += (stats.specialTeamsYards || 0) * 0.5;
    points += (stats.specialTeamsTDs || 0) * 6;
  }
  points += (stats.fumbles || 0) * -4;
  return points;
}

// ----------------------------------------
// Update Team Stats
// ----------------------------------------
async function updateTeamStats(teams) {
  const teamMap = {};
  Object.values(teams).forEach(player => {
    if (player?.team && player?.gameId) teamMap[player.team] = player.gameId;
  });

  for (let teamName in teamMap) {
    const statsMap = await fetchTeamGameStats(teamName, teamMap[teamName]);
    if (!statsMap) continue;

    Object.values(teams).forEach(player => {
      if (player?.team === teamName) {
        const stats = statsMap[player.id.toString()] || {};
        const pos = player.position;

        player.stats = pos === "QB"
          ? `Pass: ${stats.passingYards || 0} yds, ${stats.passingTDs || 0} TD, ${stats.interceptions || 0} INT | Rush: ${stats.rushingYards || 0} yds, ${stats.rushingTDs || 0} TD, ${stats.fumbles || 0} FUM`
          : pos === "RB"
          ? `Rush: ${stats.rushingYards || 0} yds, ${stats.rushingTDs || 0} TD, ${stats.fumbles || 0} FUM | Rec: ${stats.receivingYards || 0} yds, ${stats.receivingTDs || 0} TD | ST: ${stats.specialTeamsYards || 0} yds, ${stats.specialTeamsTDs || 0} TD`
          : pos === "WR"
          ? `Rec: ${stats.receivingYards || 0} yds, ${stats.receivingTDs || 0} TD | Rush: ${stats.rushingYards || 0} yds, ${stats.rushingTDs || 0} TD, ${stats.fumbles || 0} FUM | ST: ${stats.specialTeamsYards || 0} yds, ${stats.specialTeamsTDs || 0} TD`
          : "0 yds, 0 TD";

        player.points = calculatePoints(stats, pos);
      }
    });
  }
}

// ----------------------------------------
// Render a Single Team on the Scoreboard
// ----------------------------------------
function renderScoreboardTeam(containerId, teamName, teamObj) {
  let total = 0;
  const html = Object.values(teamObj).map(player => {
    if (!player) return '';
    total += player.points;
    const headshotUrl = player.id
      ? `https://a.espncdn.com/i/headshots/college-football/players/full/${player.id}.png`
      : "helmet_default.png";
    return `
      <div class="player-row">
        <img src="${headshotUrl}" alt="${player.player}" class="player-headshot" />
        <div class="player-info">
          <strong>${player.player}</strong> (${player.position} - ${player.team})
          <small>${player.stats}</small>
        </div>
        <div class="player-score">${player.points.toFixed(2)}</div>
      </div>
    `;
  }).join("");

  document.getElementById(containerId).innerHTML = `
    <h3>${teamName}</h3>
    ${html}
    <div class="total-score">Total: ${total.toFixed(2)}</div>
  `;
}

// ----------------------------------------
// Render Full Scoreboard
// ----------------------------------------
async function renderScoreboard() {
  console.log("Rendering scoreboard...");

  document.getElementById("selection-screen").classList.add("hidden");
  document.getElementById("scoreboard-screen").classList.remove("hidden");

  for (let user of users) {
    if (user.locked) await updateTeamStats(user.team);
  }

  const scoreboard = document.getElementById("scoreboard");
  scoreboard.innerHTML = `
    <h2>Scoreboard</h2>
    <div class="scoreboard-grid"></div>
    <div class="reset-wrapper">
      <button class="reset-btn" onclick="resetApp()">↺ Reset / New Week</button>
    </div>
  `;

  const grid = scoreboard.querySelector(".scoreboard-grid");
  users.forEach((user, idx) => {
    if (user.locked) {
      const containerId = `scoreboard-user${idx + 1}`;
      grid.insertAdjacentHTML("beforeend", `<div id="${containerId}" class="scoreboard-team"></div>`);
      renderScoreboardTeam(containerId, user.name, user.team);
    }
  });

  if (!refreshInterval) {
    refreshInterval = setInterval(async () => {
      for (let user of users) {
        if (user.locked) {
          await updateTeamStats(user.team);
          renderScoreboardTeam(`scoreboard-user${users.indexOf(user) + 1}`, user.name, user.team);
        }
      }
      saveState();
    }, 120000);
  }
}

// ----------------------------------------
// Build Search Row HTML for a position
// ----------------------------------------
function buildSearchRow(pos, idx) {
  const posUpper = pos.toUpperCase();
  const posLabel = posUpper === "QB" ? "Quarterback (QB)"
    : posUpper === "RB" ? "Running Back (RB)"
    : "Wide Receiver (WR)";

  return `
    <div class="search-row">
      <div class="search-mode-toggle">
        <label>${posLabel}:</label>
        <div class="toggle-wrap">
          <span class="toggle-label" id="${pos}-mode-label-user${idx}">Player</span>
          <label class="toggle-switch">
            <input type="checkbox" id="${pos}-toggle-user${idx}" />
            <span class="slider"></span>
          </label>
          <span class="toggle-label">Team</span>
        </div>
      </div>
      <input type="text" id="${pos}-search-user${idx}"
        placeholder="Search by player name" />
      <select id="${pos}-select-user${idx}"></select>
    </div>
  `;
}

// ----------------------------------------
// Build Setup Screen (team count + names)
// ----------------------------------------
function renderTeamNameInputs(count) {
  const container = document.getElementById("team-name-inputs");
  container.innerHTML = "";
  for (let i = 1; i <= count; i++) {
    container.insertAdjacentHTML("beforeend", `
      <label for="team-name-${i}">Team ${i} name:</label>
      <input type="text" id="team-name-${i}" placeholder="e.g. The Blitz Brothers" maxlength="30" />
    `);
  }
}

function initSetupScreen() {
  const teamCountSelect = document.getElementById("team-count-select");
  renderTeamNameInputs(parseInt(teamCountSelect.value, 10));

  teamCountSelect.addEventListener("change", (e) => {
    renderTeamNameInputs(parseInt(e.target.value, 10));
  });

  document.getElementById("start-draft-btn").addEventListener("click", () => {
    const count = parseInt(teamCountSelect.value, 10);
    const newUsers = [];
    for (let i = 1; i <= count; i++) {
      const nameInput = document.getElementById(`team-name-${i}`);
      const name = (nameInput && nameInput.value.trim()) || `Team ${i}`;
      newUsers.push({ name, team: { QB: null, RB: null, WR: null }, locked: false });
    }
    users = newUsers;
    saveState();

    document.getElementById("setup-screen").classList.add("hidden");
    document.getElementById("selection-screen").classList.remove("hidden");
    buildSelectionScreen();
  });
}

// ----------------------------------------
// Build Selection Screen (player picks)
// ----------------------------------------
function buildSelectionScreen() {
  const positions = ["qb", "rb", "wr"];
  const selectionContainer = document.getElementById("selection-container");
  selectionContainer.innerHTML = "";

  users.forEach((user, idx) => {
    const userNum = idx + 1;

    selectionContainer.insertAdjacentHTML("beforeend", `
      <div id="user-${userNum}-selection" class="team-selection">
        <h3 class="team-name-display">${user.name}</h3>
        ${buildSearchRow("qb", userNum)}
        ${buildSearchRow("rb", userNum)}
        ${buildSearchRow("wr", userNum)}
        <button id="lock-team${userNum}">Lock ${user.name}</button>
      </div>
    `);

    positions.forEach(pos => {
      const posUpper = pos.toUpperCase();
      const inputEl = document.getElementById(`${pos}-search-user${userNum}`);
      const selectId = `${pos}-select-user${userNum}`;
      const toggleEl = document.getElementById(`${pos}-toggle-user${userNum}`);

      toggleEl.addEventListener("change", () => {
        const isTeamMode = toggleEl.checked;
        inputEl.value = "";
        document.getElementById(selectId).innerHTML = "";
        inputEl.placeholder = isTeamMode
          ? `Search by team name (e.g. Indiana)`
          : `Search by player name`;
      });

      inputEl.addEventListener("input", async (e) => {
        const val = e.target.value.trim();
        if (val.length < 2) return;
        const isTeamMode = toggleEl.checked;
        const players = isTeamMode
          ? await fetchPlayersByTeam(posUpper, val)
          : await fetchPlayersByName(posUpper, val);
        populateDropdown(selectId, players);
      });
    });

    const lockBtn = document.getElementById(`lock-team${userNum}`);
    lockBtn.addEventListener("click", async () => {
      user.team = buildTeam(
        `qb-select-user${userNum}`,
        `rb-select-user${userNum}`,
        `wr-select-user${userNum}`
      );

      if (!user.team.QB || !user.team.RB || !user.team.WR) {
        alert(`Please select a QB, RB, and WR for ${user.name}.`);
        return;
      }

      for (let pos in user.team) {
        const p = user.team[pos];
        if (p) p.gameId = await getGameId(p.team);
      }

      user.locked = true;
      lockBtn.textContent = `${user.name} — LOCKED ✓`;
      lockBtn.disabled = true;
      lockBtn.style.backgroundColor = "#28a745";
      lockBtn.style.color = "#fff";

      saveState();

      if (users.every(u => u.locked)) {
        await renderScoreboard();
      }
    });
  });
}

// ----------------------------------------
// DOM Ready
// ----------------------------------------
document.addEventListener("DOMContentLoaded", async () => {
  console.log("Triple Option — initializing...");

  initMusicToggle();

  const stage = loadState();
  await getCurrentWeek();

  const weekSelect = document.getElementById("week-select");
  if (weekSelect) {
    weekSelect.value = week;
    weekSelect.addEventListener("change", (e) => {
      week = parseInt(e.target.value, 10);
      saveState();
    });
  }

  if (stage === "scoreboard") {
    document.getElementById("setup-screen").classList.add("hidden");
    document.getElementById("selection-screen").classList.add("hidden");
    await renderScoreboard();
    return;
  }

  if (stage === "selection") {
    document.getElementById("setup-screen").classList.add("hidden");
    document.getElementById("selection-screen").classList.remove("hidden");
    buildSelectionScreen();
    return;
  }

  // stage === "setup"
  initSetupScreen();
});