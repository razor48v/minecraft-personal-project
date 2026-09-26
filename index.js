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

// Last route that actually reached spawn.
// -1 means we don't have a known-good route yet.
let lastWorkingRoute = -1;

let client = null;
let connecting = false;
let spawned = false;
let retryTimer = null;
let actionTimer = null;

// Prevent multiple close/error handlers from
// scheduling several reconnects at once.
let reconnectScheduled = false;

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
// VERSION INFO
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
// SCHEDULE RECONNECT
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
}

// ==========================================
// PICK NEXT ROUTE
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
// CONNECTION
// ==========================================
function connectBot() {
  if (client || connecting) {
    console.log(
      '🟢 A connection is already active/in progress.'
    );
    return;
  }

  // ----------------------------------------
  // IMPORTANT:
  //
  // If we previously had a route reach spawn,
  // always retry that route first.
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
    // CONNECT
    // ======================================
    newClient.on('connect', () => {
      console.log(
        `🔌 TCP/RakNet connection established on route ${routeNumber}`
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
        `🟡 JOIN: Server accepted login`
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
    // SPAWN
    //
    // This is the important success point.
    // ======================================
    newClient.on('spawn', () => {
      if (connectionEnded) return;

      connecting = false;
      spawned = true;

      // Remember this route permanently for
      // the lifetime of this process.
      lastWorkingRoute = currentRoute;

      console.log('');
      console.log('==========================================');
      console.log(
        `🟢 BOT FULLY SPAWNED ON ROUTE ${routeNumber}`
      );
      console.log(
        `⭐ Remembering route ${routeNumber} as the working route`
      );
      console.log(
        '🔒 Staying on this route until the connection closes.'
      );
      console.log('==========================================');

      // Keep your existing small activity packet.
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
    // SERVER CHAT
    // ======================================
    newClient.on('text', packet => {
      if (packet?.message) {
        console.log(`💬 SERVER: ${packet.message}`);
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
    //
    // IMPORTANT:
    // Don't immediately rotate if we're already
    // spawned. Wait for close.
    // ======================================
    newClient.on('error', err => {
      const message = err?.message || String(err);

      console.log(
        `⚠️ CLIENT ERROR: ${message}`
      );

      if (
        message.includes(
          'Unsupported server protocol 419'
        )
      ) {
        console.log(
          'ℹ️ This proxy is not compatible with the server protocol.'
        );
      }

      if (spawned) {
        console.log(
          'ℹ️ Bot is already spawned; waiting for close before changing routes.'
        );

        return;
      }

      // Before spawn, this route failed.
      console.log(
        `❌ Route ${routeNumber} failed before spawn.`
      );

      if (connectionEnded) return;

      connectionEnded = true;

      cleanupClient();

      // If we don't have a known working route,
      // try the next proxy.
      if (lastWorkingRoute === -1) {
        advanceRoute();

        console.log(
          `🔄 Moving to route ` +
          `${currentRoute + 1}/${proxyPool.length}`
        );

        scheduleReconnect(5000);

        return;
      }

      // We DO have a known working route.
      // Don't forget it.
      console.log(
        `⭐ Known working route is ` +
        `${lastWorkingRoute + 1}/${proxyPool.length}`
      );

      console.log(
        '🔁 Retrying the known working route.'
      );

      currentRoute = lastWorkingRoute;

      scheduleReconnect(5000);
    });

    // ======================================
    // CLOSE
    // ======================================
    newClient.on('close', () => {
      if (connectionEnded) return;

      connectionEnded = true;

      const wasSpawned = spawned;

      console.log('');

      if (wasSpawned) {
        console.log(
          `🔴 Route ${routeNumber} disconnected after successful spawn.`
        );
      } else {
        console.log(
          `❌ Route ${routeNumber} closed before spawn.`
        );
      }

      cleanupClient();

      // ------------------------------------
      // IF THIS ROUTE WORKED BEFORE:
      //
      // Retry it first.
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
      // NO KNOWN GOOD ROUTE YET:
      //
      // Continue through proxy list.
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
      `⚠️ Failed to initialize route ${routeNumber}: ` +
      `${err?.message || err}`
    );

    cleanupClient();

    if (lastWorkingRoute !== -1) {
      currentRoute = lastWorkingRoute;

      console.log(
        `⭐ Retrying known working route ` +
        `${currentRoute + 1}/${proxyPool.length}`
      );

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
