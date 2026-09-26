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

// ==========================================
// STATE
// ==========================================
let currentRoute = 0;
let lastWorkingRoute = -1;

let client = null;
let connecting = false;
let spawned = false;

let retryTimer = null;
let actionTimer = null;
let reconnectScheduled = false;

// Actual in-game player roster received from
// the connected Bedrock client.
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
// STARTUP INFO
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
// PRINT CURRENT IN-GAME PLAYER LIST
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
    console.log('👤 Nobody detected in the client player list.');
  } else {
    for (const name of names) {
      console.log(`👤 ${name}`);
    }
  }

  console.log('==========================================');
}

// ==========================================
// NORMALIZE PLAYER RECORD
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

// ==========================================
// HANDLE PLAYER LIST PACKET
// ==========================================
function handlePlayerList(packet) {
  if (!packet) return;

  const records = Array.isArray(packet.records)
    ? packet.records
    : [];

  if (records.length === 0) {
    return;
  }

  let changed = false;

  for (const record of records) {
    const type = record.type;
    const key = getPlayerKey(record);
    const username = getPlayerName(record);

    if (!key || !username) {
      continue;
    }

    // --------------------------------------
    // ADD
    // --------------------------------------
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

    // --------------------------------------
    // REMOVE
    // --------------------------------------
    else if (
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
// SERVER PING / ADVERTISED STATUS
// ==========================================
let statusCheckRunning = false;

async function checkServerStatus() {
  if (statusCheckRunning) {
    return;
  }

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
      `⚠️ Population check failed: ${err?.message || err}`
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
// RECONNECT SCHEDULER
// ==========================================
function scheduleReconnect(delay = 5000) {
  if (reconnectScheduled) {
    return;
  }

  reconnectScheduled = true;

  if (retryTimer) {
    clearTimeout(retryTimer);
  }

  retryTimer = setTimeout(() => {
    retryTimer = null;
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

  // Clear the roster because this client no
  // longer represents the old connection.
  onlinePlayers.clear();
}

// ==========================================
// ADVANCE ROUTE
// ==========================================
function advanceRoute() {
  currentRoute++;

  if (currentRoute >= proxyPool.length) {
    currentRoute = 0;

    console.log(
      '🔁 Reached the end of the proxy list.'
    );
  }
}

// ==========================================
// CONNECT BOT
// ==========================================
function connectBot() {
  if (client || connecting) {
    console.log(
      '🟢 Connection already active/in progress.'
    );

    return;
  }

  // ----------------------------------------
  // Retry the last known working route first.
  // ----------------------------------------
  if (lastWorkingRoute !== -1) {
    currentRoute = lastWorkingRoute;

    console.log(
      `⭐ Using last known working route: ` +
      `${currentRoute + 1}/${proxyPool.length}`
    );
  }

  const routeNumber = currentRoute + 1;
  const proxy = proxyPool[currentRoute];

  connecting = true;

  console.log('');
  console.log(
    `🌐 Attempting route [` +
    `${routeNumber}/${proxyPool.length}]: ${proxy}`
  );

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
    // CONNECTION
    // ======================================
    newClient.on('connect', () => {
      console.log(
        `🔌 Connection established on route ${routeNumber}`
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
    //
    // This is the important part.
    //
    // We listen directly to the connected
    // client's player_list packet instead of
    // using the server ping for the roster.
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
      if (connectionEnded) {
        return;
      }

      connecting = false;
      spawned = true;

      lastWorkingRoute = currentRoute;

      console.log('');
      console.log('==========================================');
      console.log(
        `🟢 BOT FULLY SPAWNED ON ROUTE ${routeNumber}`
      );
      console.log(
        `⭐ Remembering route ${routeNumber} as working`
      );
      console.log(
        '🔒 Staying on this route until disconnect.'
      );
      console.log('==========================================');

      // Print whatever roster has been received so far.
      printPlayerList();

      // --------------------------------------
      // Small activity packet
      // --------------------------------------
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
          'ℹ️ This route is presenting an unsupported Bedrock protocol.'
        );
      }

      // ------------------------------------
      // If already spawned, DO NOT rotate.
      // Wait for close.
      // ------------------------------------
      if (spawned) {
        console.log(
          'ℹ️ Bot is still considered connected; waiting for close.'
        );

        return;
      }

      if (connectionEnded) {
        return;
      }

      connectionEnded = true;

      cleanupClient();

      if (lastWorkingRoute !== -1) {
        currentRoute = lastWorkingRoute;

        console.log(
          `⭐ Retrying known working route ` +
          `${currentRoute + 1}/${proxyPool.length}`
        );

        scheduleReconnect(5000);

        return;
      }

      advanceRoute();

      console.log(
        `🔄 Moving to route ` +
        `${currentRoute + 1}/${proxyPool.length}`
      );

      scheduleReconnect(5000);
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
          `🔴 Route ${routeNumber} disconnected.`
        );
      } else {
        console.log(
          `❌ Route ${routeNumber} closed before spawn.`
        );
      }

      cleanupClient();

      // ------------------------------------
      // Retry known-good route first.
      // ------------------------------------
      if (lastWorkingRoute !== -1) {
        currentRoute = lastWorkingRoute;

        console.log(
          `⭐ Retrying last known working route ` +
          `${currentRoute + 1}/${proxyPool.length}...`
        );

        scheduleReconnect(5000);

        return;
      }

      // ------------------------------------
      // No known-good route yet.
      // ------------------------------------
      advanceRoute();

      console.log(
        `🔄 Moving to route ` +
        `${currentRoute + 1}/${proxyPool.length}`
      );

      scheduleReconnect(5000);
    });

  } catch (err) {
    console.log(
      `⚠️ Route initialization error: ` +
      `${err?.message || err}`
    );

    cleanupClient();

    if (lastWorkingRoute !== -1) {
      currentRoute = lastWorkingRoute;

      scheduleReconnect(5000);
    } else {
      advanceRoute();

      console.log(
        `🔄 Moving to route ` +
        `${currentRoute + 1}/${proxyPool.length}`
      );

      scheduleReconnect(5000);
    }
  }
}

// ==========================================
// START
// ==========================================
connectBot();
