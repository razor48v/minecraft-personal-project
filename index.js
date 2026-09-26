const express = require('express');
const bedrock = require('bedrock-protocol');
const { SocksProxyAgent } = require('socks-proxy-agent');

// ============================================================
// CONFIG
// ============================================================

const SERVER_HOST = '2b2tmcpe.org';
const SERVER_PORT = 19132;

const USERNAME = 'PufferfishFarmer99';

// Keep offline mode.
// This only works if the server accepts offline identities.
const OFFLINE_MODE = true;

const proxyPool = [
  'socks5://185.195.23.23:1080',
  'socks5://84.46.251.109:1080',
  'socks5://213.230.69.117:1080',
  'socks5://194.233.68.7:443',
  'socks5://45.142.226.130:8080',
  'socks5://68.183.109.113:80'
];

const MAX_ATTEMPTS_PER_ROUTE = 3;
const RETRY_DELAY = 5000;
const FULL_CYCLE_DELAY = 30000;

// ============================================================
// WEB SERVER
// ============================================================

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('2b2tMCPE bot online');
});

app.listen(PORT, () => {
  console.log(`🌐 Web server active on port ${PORT}`);
});

// ============================================================
// STATE
// ============================================================

let client = null;

let connecting = false;
let spawned = false;

let currentRoute = -1;
let workingRoute = -1;

let reconnectTimer = null;
let reconnectScheduled = false;
let actionTimer = null;

let connectionGeneration = 0;

// Route attempt counters.
const routeAttempts = new Array(proxyPool.length).fill(0);

// Routes that have exhausted their attempts.
const disabledRoutes = new Set();

// Current player list.
const onlinePlayers = new Map();

// ============================================================
// STARTUP INFO
// ============================================================

console.log('==========================================');
console.log('🚀 Starting Cloud Bot...');
console.log(`🖥️ Node: ${process.version}`);

try {
  console.log(
    `📦 bedrock-protocol: ${
      require('bedrock-protocol/package.json').version
    }`
  );
} catch {}

try {
  console.log(
    `📦 minecraft-data: ${
      require('minecraft-data/package.json').version
    }`
  );
} catch {}

console.log(`🎮 Server: ${SERVER_HOST}:${SERVER_PORT}`);
console.log(`👤 Username: ${USERNAME}`);
console.log(`🔐 Offline mode: ${OFFLINE_MODE}`);
console.log('==========================================');

// ============================================================
// PLAYER LIST
// ============================================================

function printPlayers() {
  const names = [...onlinePlayers.values()]
    .map(p => p.username)
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));

  console.log('');
  console.log('==========================================');
  console.log(`👥 CLIENT PLAYER LIST: ${names.length}`);

  if (names.length === 0) {
    console.log('👤 Nobody detected');
  } else {
    for (const name of names) {
      console.log(`👤 ${name}`);
    }
  }

  console.log('==========================================');
}

function handlePlayerList(packet) {
  if (!packet || !Array.isArray(packet.records)) {
    return;
  }

  let changed = false;

  for (const record of packet.records) {
    if (!record) continue;

    const username =
      record.username ||
      record.name ||
      null;

    const key =
      record.uuid ||
      record.entity_unique_id?.toString?.() ||
      username;

    if (!key || !username) {
      continue;
    }

    const type = record.type;

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
    printPlayers();
  }
}

// ============================================================
// SERVER STATUS
// ============================================================

let statusRunning = false;

async function checkServerStatus() {
  if (statusRunning) {
    return;
  }

  statusRunning = true;

  console.log('🔎 Checking server population...');

  try {
    const status = await bedrock.ping({
      host: SERVER_HOST,
      port: SERVER_PORT,
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
    statusRunning = false;
  }
}

console.log('⏱️ Starting 30-second population monitor...');

checkServerStatus();

setInterval(() => {
  console.log('⏰ 30-second population timer fired');
  checkServerStatus();
}, 30000);

// ============================================================
// HARD CLEANUP
// ============================================================

function forceCleanup(reason = 'new connection attempt') {
  console.log(`🧹 Cleaning up previous client: ${reason}`);

  if (actionTimer) {
    clearInterval(actionTimer);
    actionTimer = null;
  }

  if (client) {
    const oldClient = client;

    // Detach listeners first so our cleanup doesn't
    // accidentally trigger another reconnect.
    try {
      oldClient.removeAllListeners();
    } catch {}

    try {
      if (typeof oldClient.disconnect === 'function') {
        oldClient.disconnect();
      }
    } catch (err) {
      console.log(
        `⚠️ disconnect() warning: ${err?.message || err}`
      );
    }

    try {
      if (typeof oldClient.close === 'function') {
        oldClient.close();
      }
    } catch (err) {
      console.log(
        `⚠️ close() warning: ${err?.message || err}`
      );
    }

    client = null;
  }

  connecting = false;
  spawned = false;

  onlinePlayers.clear();
}

// ============================================================
// RECONNECT SCHEDULER
// ============================================================

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

// ============================================================
// ROUTE HELPERS
// ============================================================

function findNextRoute() {
  // If a known working route exists, always prefer it.
  if (
    workingRoute >= 0 &&
    !disabledRoutes.has(workingRoute)
  ) {
    return workingRoute;
  }

  for (let i = 0; i < proxyPool.length; i++) {
    if (!disabledRoutes.has(i)) {
      return i;
    }
  }

  return -1;
}

function disableRoute(index) {
  disabledRoutes.add(index);

  console.log(
    `🚫 ROUTE ${index + 1} DISABLED FOR THIS SEARCH CYCLE`
  );
}

function markFailure(index, reason) {
  routeAttempts[index]++;

  console.log('');
  console.log(`❌ ROUTE ${index + 1} FAILED`);
  console.log(`📝 Reason: ${reason}`);
  console.log(
    `📈 Attempt ${routeAttempts[index]}/${MAX_ATTEMPTS_PER_ROUTE}`
  );

  if (
    routeAttempts[index] >= MAX_ATTEMPTS_PER_ROUTE
  ) {
    disableRoute(index);
  }
}

function printRouteSummary() {
  console.log('');
  console.log('==========================================');
  console.log('📋 ROUTE SUMMARY');
  console.log('==========================================');

  for (let i = 0; i < proxyPool.length; i++) {
    let state = '⏳ AVAILABLE';

    if (workingRoute === i) {
      state = '🟢 WORKING/PREFERRED';
    } else if (disabledRoutes.has(i)) {
      state = '🔴 DISABLED';
    }

    console.log(
      `Route ${i + 1}: ` +
      `${routeAttempts[i]}/${MAX_ATTEMPTS_PER_ROUTE} attempts — ${state}`
    );
  }

  console.log('==========================================');
}

function resetSearchCycle() {
  console.log('');
  console.log('🔄 Starting a fresh route search cycle...');

  disabledRoutes.clear();

  for (let i = 0; i < routeAttempts.length; i++) {
    routeAttempts[i] = 0;
  }

  workingRoute = -1;
}

// ============================================================
// CONNECTION
// ============================================================

function connectBot() {
  // ----------------------------------------------------------
  // Absolutely prevent multiple simultaneous clients.
  // ----------------------------------------------------------

  if (client || connecting) {
    console.log(
      '⏸️ Connection already active/in progress; not creating another client.'
    );

    return;
  }

  const routeIndex = findNextRoute();

  // ----------------------------------------------------------
  // Every route exhausted.
  // ----------------------------------------------------------

  if (routeIndex === -1) {
    printRouteSummary();

    console.log('');
    console.log(
      `⛔ All ${proxyPool.length} routes exhausted.`
    );

    console.log(
      `⏳ Waiting ${FULL_CYCLE_DELAY / 1000}s before trying a fresh cycle.`
    );

    setTimeout(() => {
      resetSearchCycle();
      connectBot();
    }, FULL_CYCLE_DELAY);

    return;
  }

  currentRoute = routeIndex;

  const routeNumber = routeIndex + 1;
  const proxy = proxyPool[routeIndex];

  // ----------------------------------------------------------
  // Clean any previous client BEFORE making another one.
  // ----------------------------------------------------------

  forceCleanup(
    `preparing route ${routeNumber}`
  );

  connecting = true;

  const generation = ++connectionGeneration;

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

  let ended = false;

  function isCurrentConnection() {
    return generation === connectionGeneration;
  }

  function finishBeforeSpawn(reason) {
    if (ended) {
      return;
    }

    ended = true;

    markFailure(
      routeIndex,
      reason
    );

    forceCleanup(
      `route ${routeNumber} failed`
    );

    printRouteSummary();

    scheduleReconnect(RETRY_DELAY);
  }

  try {
    const agent = new SocksProxyAgent(proxy);

    const newClient = bedrock.createClient({
      host: SERVER_HOST,
      port: SERVER_PORT,
      username: USERNAME,
      offline: OFFLINE_MODE,
      agent
    });

    client = newClient;

    // ========================================================
    // TRANSPORT CONNECT
    // ========================================================

    newClient.on('connect', () => {
      if (!isCurrentConnection()) return;

      console.log(
        `🔌 Transport connected on route ${routeNumber}`
      );
    });

    // ========================================================
    // LOGIN
    // ========================================================

    newClient.on('login', () => {
      if (!isCurrentConnection()) return;

      console.log(
        `🔐 LOGIN packet received on route ${routeNumber}`
      );
    });

    // ========================================================
    // JOIN
    // ========================================================

    newClient.on('join', () => {
      if (!isCurrentConnection()) return;

      console.log(
        '🟡 JOIN: Server accepted login'
      );
    });

    // ========================================================
    // PLAY STATUS
    // ========================================================

    newClient.on('play_status', packet => {
      if (!isCurrentConnection()) return;

      console.log(
        '🎮 PLAY_STATUS:',
        packet
      );
    });

    // ========================================================
    // PLAYER LIST
    // ========================================================

    newClient.on('player_list', packet => {
      if (!isCurrentConnection()) return;

      try {
        handlePlayerList(packet);
      } catch (err) {
        console.log(
          `⚠️ PLAYER LIST ERROR: ${err?.message || err}`
        );
      }
    });

    // ========================================================
    // SPAWN
    // ========================================================

    newClient.on('spawn', () => {
      if (!isCurrentConnection() || ended) {
        return;
      }

      connecting = false;
      spawned = true;

      // Remember this route.
      workingRoute = routeIndex;

      // A successful connection resets its failure count.
      routeAttempts[routeIndex] = 0;

      console.log('');
      console.log('==========================================');
      console.log(
        `🟢 BOT FULLY SPAWNED ON ROUTE ${routeNumber}`
      );
      console.log(
        `⭐ Remembering route ${routeNumber} as working`
      );
      console.log(
        '🔒 Staying on this route until it disconnects.'
      );
      console.log('==========================================');

      printPlayers();

      // Optional small activity.
      if (actionTimer) {
        clearInterval(actionTimer);
      }

      actionTimer = setInterval(() => {
        if (!client || !spawned) {
          return;
        }

        try {
          client.queue('animate', {
            action_id: 1,
            runtime_entity_id: client.entityId
          });
        } catch (err) {
          console.log(
            `⚠️ Activity packet failed: ${err?.message || err}`
          );
        }
      }, 1500);
    });

    // ========================================================
    // CHAT
    // ========================================================

    newClient.on('text', packet => {
      if (!isCurrentConnection()) return;

      if (packet?.message) {
        console.log(
          `💬 SERVER: ${packet.message}`
        );
      }
    });

    // ========================================================
    // KICK
    // ========================================================

    newClient.on('kick', packet => {
      if (!isCurrentConnection()) return;

      console.log('🚫 KICK:', packet);

      const message =
        packet?.message ||
        packet?.filtered_message ||
        packet?.reason ||
        'Unknown kick reason';

      // Already connected gets a specific message.
      if (
        String(message)
          .toLowerCase()
          .includes('already connected')
      ) {
        console.log('');
        console.log(
          '⚠️ SERVER SAYS THIS OFFLINE IDENTITY IS ALREADY CONNECTED.'
        );
        console.log(
          'ℹ️ This process can clean up its own clients, but cannot remotely kick a stale server-side session.'
        );
      }
    });

    // ========================================================
    // ERROR
    // ========================================================

    newClient.on('error', err => {
      if (!isCurrentConnection()) {
        return;
      }

      const message =
        err?.message ||
        String(err);

      console.log(
        `⚠️ CLIENT ERROR: ${message}`
      );

      if (
        message.includes(
          'Unsupported server protocol 419'
        )
      ) {
        console.log(
          'ℹ️ FAILURE TYPE: Bedrock protocol 419 is not supported by the installed minecraft-data.'
        );

        console.log(
          'ℹ️ This is a client/protocol compatibility problem, not proof that the proxy itself is bad.'
        );
      }

      if (
        message
          .toLowerCase()
          .includes('already connected')
      ) {
        console.log(
          'ℹ️ FAILURE TYPE: server reports the offline identity as already connected.'
        );
      }

      // Once fully spawned, do NOT rotate merely
      // because an error event occurs.
      if (spawned) {
        console.log(
          'ℹ️ Bot already spawned; waiting for the connection close event.'
        );

        return;
      }

      finishBeforeSpawn(message);
    });

    // ========================================================
    // CLOSE
    // ========================================================

    newClient.on('close', () => {
      if (!isCurrentConnection()) {
        return;
      }

      if (ended) {
        return;
      }

      ended = true;

      const wasSpawned = spawned;

      console.log('');

      if (wasSpawned) {
        console.log(
          `🔴 ROUTE ${routeNumber} DISCONNECTED AFTER SPAWN`
        );

        console.log(
          `⭐ Keeping route ${routeNumber} as preferred route.`
        );

        // Clean local connection.
        forceCleanup(
          `route ${routeNumber} disconnected`
        );

        // Retry the known working route.
        console.log(
          `🔁 Retrying route ${routeNumber} in ${RETRY_DELAY / 1000}s...`
        );

        scheduleReconnect(RETRY_DELAY);

        return;
      }

      console.log(
        `❌ ROUTE ${routeNumber} CLOSED BEFORE SPAWN`
      );

      markFailure(
        routeIndex,
        'Connection closed before spawn'
      );

      forceCleanup(
        `route ${routeNumber} closed before spawn`
      );

      printRouteSummary();

      scheduleReconnect(RETRY_DELAY);
    });

  } catch (err) {
    const message =
      err?.message ||
      String(err);

    console.log(
      `⚠️ CLIENT INITIALIZATION ERROR: ${message}`
    );

    finishBeforeSpawn(message);
  }
}

// ============================================================
// START
// ============================================================

connectBot();
