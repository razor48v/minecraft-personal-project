const express = require('express');
const bedrock = require('bedrock-protocol');
const { SocksProxyAgent } = require('socks-proxy-agent');

// ==========================================
// CONFIG
// ==========================================
const SERVER_HOST = '2b2tmcpe.org';
const SERVER_PORT = 19132;
const USERNAME = 'PufferfishFarmer99';

const proxyPool = [
  'socks5://185.195.23.23:1080',
  'socks5://84.46.251.109:1080',
  'socks5://213.230.69.117:1080',
  'socks5://194.233.68.7:443',
  'socks5://45.142.226.130:8080',
  'socks5://68.183.109.113:80'
];

// Maximum attempts before a route is marked bad.
const MAX_ATTEMPTS_PER_ROUTE = 3;

// Time between attempts.
const RETRY_DELAY = 5000;

// Time before retrying the whole process after
// every configured route has failed.
const FULL_CYCLE_DELAY = 30000;

// ==========================================
// STATE
// ==========================================
let currentRoute = 0;
let lastWorkingRoute = -1;

let client = null;
let connecting = false;
let spawned = false;

let reconnectTimer = null;
let actionTimer = null;

let reconnectScheduled = false;

// Number of attempts for each route.
const routeAttempts = new Array(proxyPool.length).fill(0);

// Routes that have failed MAX_ATTEMPTS_PER_ROUTE
// times during the current search cycle.
const failedRoutes = new Set();

// Actual player roster from the connected client.
const onlinePlayers = new Map();

// ==========================================
// RENDER WEB SERVER
// ==========================================
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('2b2t Bedrock Bot Online');
});

app.listen(PORT, () => {
  console.log(`🌐 Web server active on port ${PORT}`);
});

// ==========================================
// STARTUP
// ==========================================
console.log('==========================================');
console.log('🚀 Starting Cloud Bot...');
console.log(`Node: ${process.version}`);

try {
  console.log(
    `bedrock-protocol: ${
      require('bedrock-protocol/package.json').version
    }`
  );
} catch {}

try {
  console.log(
    `minecraft-data: ${
      require('minecraft-data/package.json').version
    }`
  );
} catch {}

console.log('==========================================');

// ==========================================
// PLAYER LIST
// ==========================================
function printPlayerList() {
  const names = [...onlinePlayers.values()]
    .map(player => player.username)
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));

  console.log('');
  console.log('==========================================');
  console.log(`👥 IN-GAME PLAYERS: ${names.length}`);

  if (names.length === 0) {
    console.log('👤 Nobody detected in player list.');
  } else {
    for (const name of names) {
      console.log(`👤 ${name}`);
    }
  }

  console.log('==========================================');
}

// ==========================================
// PLAYER LIST HELPERS
// ==========================================
function getPlayerName(record) {
  if (!record) return null;

  return (
    record.username ||
    record.name ||
    record.display_name ||
    null
  );
}

function getPlayerKey(record) {
  if (!record) return null;

  return (
    record.uuid ||
    record.entity_unique_id?.toString?.() ||
    record.username ||
    null
  );
}

function handlePlayerList(packet) {
  if (!packet) return;

  const records = Array.isArray(packet.records)
    ? packet.records
    : [];

  let changed = false;

  for (const record of records) {
    const key = getPlayerKey(record);
    const username = getPlayerName(record);

    if (!key || !username) {
      continue;
    }

    const type = record.type;

    // Bedrock player_list:
    // add = "add"
    // remove = "remove"
    if (
      type === 'add' ||
      type === 0 ||
      type === 'ADD'
    ) {
      onlinePlayers.set(key, {
        username,
        uuid: record.uuid || null
      });

      changed = true;
    }

    if (
      type === 'remove' ||
      type === 1 ||
      type === 'REMOVE'
    ) {
      if (onlinePlayers.delete(key)) {
        changed = true;
      }
    }
  }

  if (changed) {
    printPlayerList();
  }
}

// ==========================================
// SERVER STATUS
// ==========================================
let statusCheckRunning = false;

async function checkServerStatus() {
  if (statusCheckRunning) return;

  statusCheckRunning = true;

  console.log('🔎 Checking server population...');

  try {
    const status = await bedrock.ping({
      host: SERVER_HOST,
      port: SERVER_PORT,
      transport: 'raknet',
      timeout: 10000
    });

    const online =
      status.playersOnline ??
      status.playerCount ??
      '?';

    const max =
      status.playersMax ??
      status.maxPlayers ??
      '?';

    console.log(`📊 SERVER STATUS: ${online}/${max}`);

    if (status.motd) {
      console.log(`📝 MOTD: ${status.motd}`);
    }

    if (status.version) {
      console.log(`🎮 VERSION: ${status.version}`);
    }

  } catch (err) {
    console.log(
      `⚠️ SERVER STATUS FAILED: ${err?.message || err}`
    );
  } finally {
    statusCheckRunning = false;
  }
}

console.log('⏱️ Starting 30-second population monitor...');

checkServerStatus();

setInterval(() => {
  console.log('⏰ 30-second population timer fired');
  checkServerStatus();
}, 30000);

// ==========================================
// RESET ROUTE SEARCH
// ==========================================
function resetRouteSearch() {
  console.log('');
  console.log('==========================================');
  console.log('🔄 RESETTING ROUTE SEARCH');
  console.log('==========================================');

  failedRoutes.clear();

  for (let i = 0; i < routeAttempts.length; i++) {
    routeAttempts[i] = 0;
  }

  currentRoute = 0;
}

// ==========================================
// FIND NEXT AVAILABLE ROUTE
// ==========================================
function findNextAvailableRoute() {
  // If we know a working route, prefer it.
  if (
    lastWorkingRoute !== -1 &&
    !failedRoutes.has(lastWorkingRoute)
  ) {
    return lastWorkingRoute;
  }

  // Otherwise find the first route that has
  // not exhausted its attempts.
  for (let i = 0; i < proxyPool.length; i++) {
    if (!failedRoutes.has(i)) {
      return i;
    }
  }

  return -1;
}

// ==========================================
// SCHEDULE CONNECTION
// ==========================================
function scheduleReconnect(delay = RETRY_DELAY) {
  if (reconnectScheduled) {
    return;
  }

  reconnectScheduled = true;

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
  }

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    reconnectScheduled = false;

    connectBot();
  }, delay);
}

// ==========================================
// CLEANUP
// ==========================================
function cleanupClient() {
  if (actionTimer) {
    clearInterval(actionTimer);
    actionTimer = null;
  }

  client = null;
  connecting = false;
  spawned = false;

  onlinePlayers.clear();
}

// ==========================================
// MARK ROUTE FAILED
// ==========================================
function markRouteFailed(routeIndex, reason) {
  routeAttempts[routeIndex]++;

  const attempts = routeAttempts[routeIndex];

  console.log('');
  console.log(
    `❌ ROUTE ${routeIndex + 1} FAILED`
  );
  console.log(`📝 Reason: ${reason}`);
  console.log(
    `📈 Attempt ${attempts}/${MAX_ATTEMPTS_PER_ROUTE}`
  );

  if (attempts >= MAX_ATTEMPTS_PER_ROUTE) {
    failedRoutes.add(routeIndex);

    console.log(
      `🚫 ROUTE ${routeIndex + 1} DISABLED FOR THIS SEARCH CYCLE`
    );
  }
}

// ==========================================
// SHOW ROUTE SUMMARY
// ==========================================
function printRouteSummary() {
  console.log('');
  console.log('==========================================');
  console.log('📋 ROUTE SUMMARY');
  console.log('==========================================');

  for (let i = 0; i < proxyPool.length; i++) {
    let state = '⏳ AVAILABLE';

    if (lastWorkingRoute === i) {
      state = '🟢 LAST KNOWN WORKING';
    } else if (failedRoutes.has(i)) {
      state = '🔴 DISABLED';
    }

    console.log(
      `Route ${i + 1}: ` +
      `${routeAttempts[i]}/${MAX_ATTEMPTS_PER_ROUTE} attempts — ${state}`
    );
  }

  console.log('==========================================');
}

// ==========================================
// CONNECT BOT
// ==========================================
function connectBot() {
  if (client || connecting) {
    return;
  }

  const routeIndex = findNextAvailableRoute();

  // ----------------------------------------
  // Everything has failed.
  // ----------------------------------------
  if (routeIndex === -1) {
    printRouteSummary();

    console.log('');
    console.log(
      `⛔ ALL ${proxyPool.length} ROUTES EXHAUSTED.`
    );

    console.log(
      `⏳ Waiting ${FULL_CYCLE_DELAY / 1000} seconds before a fresh search...`
    );

    setTimeout(() => {
      resetRouteSearch();
      connectBot();
    }, FULL_CYCLE_DELAY);

    return;
  }

  currentRoute = routeIndex;

  const routeNumber = routeIndex + 1;
  const proxy = proxyPool[routeIndex];

  connecting = true;

  console.log('');
  console.log('==========================================');
  console.log(
    `🌐 ATTEMPTING ROUTE ${routeNumber}/${proxyPool.length}`
  );
  console.log(`🔗 Proxy: ${proxy}`);
  console.log(
    `📈 Attempt ${routeAttempts[routeIndex] + 1}/${MAX_ATTEMPTS_PER_ROUTE}`
  );
  console.log('==========================================');

  let connectionEnded = false;

  try {
    const agent = new SocksProxyAgent(proxy);

    const newClient = bedrock.createClient({
      host: SERVER_HOST,
      port: SERVER_PORT,
      username: USERNAME,
      offline: true,
      agent
    });

    client = newClient;

    // ======================================
    // CONNECT
    // ======================================
    newClient.on('connect', () => {
      console.log(
        `🔌 Transport connected on route ${routeNumber}`
      );
    });

    // ======================================
    // LOGIN
    // ======================================
    newClient.on('login', () => {
      console.log(
        `🔐 LOGIN received on route ${routeNumber}`
      );
    });

    // ======================================
    // JOIN
    // ======================================
    newClient.on('join', () => {
      console.log(
        '🟡 JOIN: Server accepted login'
      );
    });

    // ======================================
    // PLAY STATUS
    // ======================================
    newClient.on('play_status', packet => {
      console.log(
        '🎮 PLAY_STATUS:',
        packet
      );
    });

    // ======================================
    // PLAYER LIST
    // ======================================
    newClient.on('player_list', packet => {
      try {
        handlePlayerList(packet);
      } catch (err) {
        console.log(
          `⚠️ PLAYER LIST ERROR: ${err?.message || err}`
        );
      }
    });

    // ======================================
    // SPAWN
    // ======================================
    newClient.on('spawn', () => {
      if (connectionEnded) return;

      connecting = false;
      spawned = true;

      // This route is proven to work.
      lastWorkingRoute = routeIndex;

      // Reset its attempt counter because it
      // successfully connected.
      routeAttempts[routeIndex] = 0;

      console.log('');
      console.log('==========================================');
      console.log(
        `🟢 BOT FULLY SPAWNED ON ROUTE ${routeNumber}`
      );
      console.log(
        `⭐ Route ${routeNumber} is now the preferred route.`
      );
      console.log(
        '🔒 Staying here until the connection closes.'
      );
      console.log('==========================================');

      printPlayerList();

      // Small activity packet.
      if (actionTimer) {
        clearInterval(actionTimer);
      }

      actionTimer = setInterval(() => {
        try {
          newClient.queue('animate', {
            action_id: 1,
            runtime_entity_id: newClient.entityId
          });
        } catch (err) {
          console.log(
            `⚠️ Activity packet failed: ${err?.message || err}`
          );
        }
      }, 1500);
    });

    // ======================================
    // CHAT
    // ======================================
    newClient.on('text', packet => {
      if (packet?.message) {
        console.log(
          `💬 SERVER: ${packet.message}`
        );
      }
    });

    // ======================================
    // KICK
    // ======================================
    newClient.on('kick', packet => {
      console.log('🚫 KICK:', packet);
    });

    // ======================================
    // ERROR
    // ======================================
    newClient.on('error', err => {
      const message =
        err?.message || String(err);

      console.log(
        `⚠️ CLIENT ERROR: ${message}`
      );

      if (
        message.includes(
          'Unsupported server protocol 419'
        )
      ) {
        console.log(
          'ℹ️ FAILURE TYPE: incompatible/unsupported Bedrock protocol.'
        );
      } else if (
        message.toLowerCase().includes('already connected')
      ) {
        console.log(
          'ℹ️ FAILURE TYPE: server says this account is already connected.'
        );
      }

      // Once spawned, don't rotate because of an
      // ordinary error event. Wait for close.
      if (spawned) {
        console.log(
          'ℹ️ Bot is already spawned; waiting for the connection to close.'
        );

        return;
      }

      if (connectionEnded) {
        return;
      }

      connectionEnded = true;

      markRouteFailed(
        routeIndex,
        message
      );

      cleanupClient();

      printRouteSummary();

      scheduleReconnect(RETRY_DELAY);
    });

    // ======================================
    // CLOSE
    // ======================================
    newClient.on('close', () => {
      if (connectionEnded) {
        return;
      }

      connectionEnded = true;

      const hadSpawned = spawned;

      console.log('');

      if (hadSpawned) {
        console.log(
          `🔴 ROUTE ${routeNumber} DISCONNECTED AFTER SPAWN`
        );

        // Don't immediately disable a route that
        // previously worked. It gets retried first.
        console.log(
          `⭐ Retaining route ${routeNumber} as the preferred route.`
        );
      } else {
        console.log(
          `❌ ROUTE ${routeNumber} CLOSED BEFORE SPAWN`
        );

        markRouteFailed(
          routeIndex,
          'Connection closed before spawn'
        );
      }

      cleanupClient();

      // If this route worked, retry it first.
      if (
        lastWorkingRoute === routeIndex &&
        hadSpawned
      ) {
        currentRoute = routeIndex;

        console.log(
          `🔁 Retrying known-working route ${routeNumber} in ${RETRY_DELAY / 1000}s...`
        );

        scheduleReconnect(RETRY_DELAY);

        return;
      }

      printRouteSummary();

      scheduleReconnect(RETRY_DELAY);
    });

  } catch (err) {
    const message =
      err?.message || String(err);

    console.log(
      `⚠️ ROUTE INITIALIZATION ERROR: ${message}`
    );

    markRouteFailed(
      routeIndex,
      message
    );

    cleanupClient();

    printRouteSummary();

    scheduleReconnect(RETRY_DELAY);
  }
}

// ==========================================
// START
// ==========================================
connectBot();
