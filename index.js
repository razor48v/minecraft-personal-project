'use strict';

const express = require('express');
const bedrock = require('bedrock-protocol');
const { SocksProxyAgent } = require('socks-proxy-agent');

// ============================================================
// CONFIG
// ============================================================

const HOST = '2b2tmcpe.org';
const PORT = 19132;

const USERNAME = 'PufferfishFarmer99';
const OFFLINE_MODE = true;

const WEB_PORT = process.env.PORT || 3000;

const MAX_ATTEMPTS_PER_ROUTE = 3;
const RETRY_DELAY_MS = 5000;
const ROUTE_DELAY_MS = 3000;

const POPULATION_INTERVAL_MS = 30_000;

// ============================================================
// PROXY ROUTES
// ============================================================

const proxyPool = [
  'socks5://185.195.23.23:1080',
  'socks5://84.46.251.109:1080',
  'socks5://213.230.69.117:1080',
  'socks5://194.233.68.7:443',
  'socks5://45.142.226.130:8080',
  'socks5://68.183.109.113:80'
];

// ============================================================
// STATE
// ============================================================

let client = null;
let currentAgent = null;

let connected = false;
let spawned = false;
let shuttingDown = false;
let reconnectScheduled = false;

let currentRoute = 0;

const routeAttempts = new Array(proxyPool.length).fill(0);

// Player names observed from the connected client.
const players = new Map();

// ============================================================
// WEB SERVER
// ============================================================

const app = express();

app.get('/', (req, res) => {
  res.send('2b2t Bedrock bot is running.');
});

app.listen(WEB_PORT, () => {
  console.log(`🌐 Web server active on port ${WEB_PORT}`);
});

// ============================================================
// LOGGING HELPERS
// ============================================================

function logHeader(title) {
  console.log('');
  console.log('==========================================');
  console.log(title);
  console.log('==========================================');
}

function printPlayers() {
  const names = [...players.values()]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));

  console.log(`👥 CLIENT ONLINE: ${names.length}`);

  if (names.length === 0) {
    console.log('   Nobody detected');
    return;
  }

  for (const name of names) {
    console.log(`👤 ${name}`);
  }
}

function printRouteSummary() {
  logHeader('📋 ROUTE SUMMARY');

  proxyPool.forEach((proxy, index) => {
    const attempts = routeAttempts[index];

    let state = '⏳ AVAILABLE';

    if (attempts >= MAX_ATTEMPTS_PER_ROUTE) {
      state = '🔴 DISABLED';
    }

    console.log(
      `Route ${index + 1}: ${attempts}/${MAX_ATTEMPTS_PER_ROUTE} attempts — ${state}`
    );
  });

  console.log('==========================================');
}

// ============================================================
// SERVER STATUS
// ============================================================
//
// This is intentionally separate from the bot connection.
// A server-status query succeeding does NOT mean the bot login
// succeeded.
//
// bedrock-protocol's status/discovery behavior can vary between
// server implementations, so failures here do not restart the bot.
// ============================================================

async function checkServerStatus() {
  console.log('🔎 Checking server population...');

  try {
    const result = await bedrock.ping({
      host: HOST,
      port: PORT
    });

    if (!result) {
      console.log('⚠️ Server status returned no data.');
      return;
    }

    const online =
      result.players?.online ??
      result.online ??
      result.player_count ??
      '?';

    const max =
      result.players?.max ??
      result.max ??
      '?';

    console.log(`📊 SERVER STATUS: ${online}/${max}`);

    if (result.motd) {
      console.log(`📝 MOTD: ${result.motd}`);
    }

    if (result.version?.name) {
      console.log(`🎮 VERSION: ${result.version.name}`);
    }
  } catch (err) {
    console.log(
      `⚠️ Server status unavailable: ${err?.message || String(err)}`
    );
  }
}

// ============================================================
// POPULATION MONITOR
// ============================================================

setInterval(() => {
  console.log('⏰ 30-second population timer fired');
  checkServerStatus();
}, POPULATION_INTERVAL_MS);

// ============================================================
// CLIENT CLEANUP
// ============================================================

function destroyClient(reason = 'cleanup') {
  const oldClient = client;

  client = null;
  connected = false;
  spawned = false;

  players.clear();

  if (!oldClient) {
    return;
  }

  console.log(`🧹 Cleaning up client: ${reason}`);

  try {
    if (typeof oldClient.removeAllListeners === 'function') {
      oldClient.removeAllListeners();
    }
  } catch (_) {}

  try {
    if (typeof oldClient.disconnect === 'function') {
      oldClient.disconnect();
    }
  } catch (_) {}

  try {
    if (typeof oldClient.close === 'function') {
      oldClient.close();
    }
  } catch (_) {}

  currentAgent = null;
}

// ============================================================
// MOVE TO NEXT ROUTE
// ============================================================

function scheduleNextRoute(reason) {
  if (shuttingDown || reconnectScheduled) {
    return;
  }

  reconnectScheduled = true;

  console.log(`🔄 ${reason}`);

  setTimeout(() => {
    reconnectScheduled = false;

    if (shuttingDown) {
      return;
    }

    tryNextAvailableRoute();
  }, ROUTE_DELAY_MS);
}

// ============================================================
// ROUTE SEARCH
// ============================================================

function tryNextAvailableRoute() {
  if (shuttingDown) {
    return;
  }

  // Never create another client while one is active.
  if (client || connected) {
    console.log('🔒 Existing client is active; not opening another connection.');
    return;
  }

  let searched = 0;

  while (searched < proxyPool.length) {
    const index = currentRoute % proxyPool.length;

    if (routeAttempts[index] < MAX_ATTEMPTS_PER_ROUTE) {
      attemptRoute(index);
      return;
    }

    currentRoute = (currentRoute + 1) % proxyPool.length;
    searched++;
  }

  logHeader('🚫 ALL ROUTES EXHAUSTED');

  console.log(
    `No route succeeded after ${MAX_ATTEMPTS_PER_ROUTE} attempts per route.`
  );

  printRouteSummary();

  console.log(`⏳ Waiting ${RETRY_DELAY_MS / 1000}s before a new search cycle...`);

  // Reset attempts for the next search cycle.
  setTimeout(() => {
    if (shuttingDown) {
      return;
    }

    routeAttempts.fill(0);
    currentRoute = 0;

    console.log('🔁 Starting a new route search cycle...');
    tryNextAvailableRoute();
  }, RETRY_DELAY_MS);
}

// ============================================================
// SINGLE ROUTE ATTEMPT
// ============================================================

function attemptRoute(routeIndex) {
  if (shuttingDown) {
    return;
  }

  if (client || connected) {
    console.log('🔒 Client already active. Skipping new connection.');
    return;
  }

  const proxy = proxyPool[routeIndex];

  routeAttempts[routeIndex]++;

  const attemptNumber = routeAttempts[routeIndex];

  logHeader(`🌐 ATTEMPTING ROUTE ${routeIndex + 1}/${proxyPool.length}`);

  console.log(`🔗 Proxy: ${proxy}`);
  console.log(`📈 Attempt ${attemptNumber}/${MAX_ATTEMPTS_PER_ROUTE}`);

  let routeFinished = false;
  let spawnTimeout = null;

  try {
    currentAgent = new SocksProxyAgent(proxy);

    const newClient = bedrock.createClient({
      host: HOST,
      port: PORT,

      username: USERNAME,

      // Keep the setting you were already using.
      offline: OFFLINE_MODE,

      agent: currentAgent
    });

    client = newClient;

    // --------------------------------------------------------
    // LOGIN SUCCESS
    // --------------------------------------------------------

    newClient.on('play_status', (packet) => {
      console.log(`🎮 PLAY_STATUS:`, packet);

      if (packet?.status === 'login_success') {
        connected = true;

        console.log('🟡 JOIN: Server accepted login');
        console.log('🟡 Waiting for player_spawn...');
      }

      if (packet?.status === 'player_spawn') {
        connected = true;
        spawned = true;

        if (spawnTimeout) {
          clearTimeout(spawnTimeout);
          spawnTimeout = null;
        }

        logHeader(`🟢 BOT FULLY SPAWNED ON ROUTE ${routeIndex + 1}`);

        console.log(`⭐ Working route: ${routeIndex + 1}`);
        console.log('🔒 Staying on this route until the connection closes.');

        printPlayers();
      }
    });

    // --------------------------------------------------------
    // SPAWN
    // --------------------------------------------------------

    newClient.on('spawn', () => {
      connected = true;
      spawned = true;

      if (spawnTimeout) {
        clearTimeout(spawnTimeout);
        spawnTimeout = null;
      }

      logHeader(`🟢 BOT FULLY SPAWNED ON ROUTE ${routeIndex + 1}`);

      console.log(`⭐ Working route: ${routeIndex + 1}`);
      console.log('🔒 Staying on this route until the connection closes.');

      printPlayers();
    });

    // --------------------------------------------------------
    // PLAYER LIST
    // --------------------------------------------------------

    newClient.on('player_list', (packet) => {
      try {
        const records = packet?.records || [];

        for (const record of records) {
          const username = record?.username;

          if (!username) {
            continue;
          }

          const uuid = String(
            record.uuid ??
            record.entity_unique_id ??
            username
          );

          if (
            record.type === 'remove' ||
            record.type === 'remove_player'
          ) {
            players.delete(uuid);

            console.log(`👋 PLAYER LEFT: ${username}`);
          } else {
            players.set(uuid, username);

            console.log(`👤 PLAYER JOINED: ${username}`);
          }
        }

        printPlayers();
      } catch (err) {
        console.log(
          `⚠️ Player-list processing error: ${err?.message || String(err)}`
        );
      }
    });

    // --------------------------------------------------------
    // RAW PLAYER LIST DEBUGGING
    // --------------------------------------------------------

    // Uncomment this if you need to inspect the packet again.
    //
    // newClient.on('player_list', packet => {
    //   console.dir(packet, { depth: 2 });
    // });

    // --------------------------------------------------------
    // ERROR
    // --------------------------------------------------------

    newClient.on('error', (err) => {
      const message = err?.message || String(err);

      console.log(`⚠️ CLIENT ERROR: ${message}`);

      if (message.includes('Unsupported server protocol')) {
        console.log(
          'ℹ️ FAILURE TYPE: The installed bedrock-protocol/minecraft-data does not recognize the protocol advertised by the server.'
        );
      }

      if (message.includes('Already connected')) {
        console.log(
          'ℹ️ FAILURE TYPE: Server rejected this connection because it considers the client already connected.'
        );
      }

      if (!spawned) {
        finishFailedRoute(
          `Client error before spawn: ${message}`
        );
      }
    });

    // --------------------------------------------------------
    // CLOSE
    // --------------------------------------------------------

    newClient.on('close', (reason) => {
      console.log('❌ CLIENT CONNECTION CLOSED');

      if (spawnTimeout) {
        clearTimeout(spawnTimeout);
        spawnTimeout = null;
      }

      const hadSpawned = spawned;

      connected = false;
      spawned = false;

      players.clear();

      if (!hadSpawned) {
        finishFailedRoute(
          'Connection closed before spawn'
        );
      } else {
        // A route that successfully spawned should not immediately
        // be treated as a failed route. Move to the next route only
        // after the working connection has actually disconnected.
        finishWorkingRoute(reason);
      }
    });

    // --------------------------------------------------------
    // SPAWN TIMEOUT
    // --------------------------------------------------------

    spawnTimeout = setTimeout(() => {
      if (shuttingDown || spawned || client !== newClient) {
        return;
      }

      console.log('⏰ Spawn timeout reached.');
      console.log(
        '❌ Server accepted the connection but never produced player_spawn.'
      );

      finishFailedRoute(
        'Login accepted but player_spawn was not received before timeout'
      );
    }, 45_000);

  } catch (err) {
    finishFailedRoute(
      `Client initialization error: ${err?.message || String(err)}`
    );
  }

  // ----------------------------------------------------------
  // FAILED BEFORE SPAWN
  // ----------------------------------------------------------

  function finishFailedRoute(reason) {
    if (routeFinished || shuttingDown) {
      return;
    }

    routeFinished = true;

    if (spawnTimeout) {
      clearTimeout(spawnTimeout);
      spawnTimeout = null;
    }

    console.log(`❌ ROUTE ${routeIndex + 1} FAILED`);
    console.log(`📝 Reason: ${reason}`);

    const failedClient = client;

    client = null;
    connected = false;
    spawned = false;
    players.clear();

    try {
      if (failedClient?.removeAllListeners) {
        failedClient.removeAllListeners();
      }
    } catch (_) {}

    try {
      if (failedClient?.disconnect) {
        failedClient.disconnect();
      }
    } catch (_) {}

    try {
      if (failedClient?.close) {
        failedClient.close();
      }
    } catch (_) {}

    currentAgent = null;

    if (routeAttempts[routeIndex] >= MAX_ATTEMPTS_PER_ROUTE) {
      console.log(
        `🚫 ROUTE ${routeIndex + 1} DISABLED FOR THIS SEARCH CYCLE`
      );
    }

    printRouteSummary();

    currentRoute = (routeIndex + 1) % proxyPool.length;

    setTimeout(() => {
      tryNextAvailableRoute();
    }, ROUTE_DELAY_MS);
  }

  // ----------------------------------------------------------
  // WORKING ROUTE DISCONNECTED
  // ----------------------------------------------------------

  function finishWorkingRoute(reason) {
    if (routeFinished || shuttingDown) {
      return;
    }

    routeFinished = true;

    console.log(
      `🔌 Working route ${routeIndex + 1} disconnected.`
    );

    if (reason) {
      console.log(`📝 Disconnect reason:`, reason);
    }

    client = null;
    connected = false;
    spawned = false;
    players.clear();
    currentAgent = null;

    // Reset this route's attempt counter because it successfully
    // reached the world.
    routeAttempts[routeIndex] = 0;

    currentRoute = (routeIndex + 1) % proxyPool.length;

    console.log(
      `➡️ Next connection will begin at route ${currentRoute + 1}/${proxyPool.length}`
    );

    setTimeout(() => {
      tryNextAvailableRoute();
    }, RETRY_DELAY_MS);
  }
}

// ============================================================
// STARTUP
// ============================================================

async function start() {
  logHeader('🚀 Starting Cloud Bot');

  console.log(`🖥️ Node: ${process.version}`);

  try {
    console.log(
      `📦 bedrock-protocol: ${require('bedrock-protocol/package.json').version}`
    );
  } catch (_) {
    console.log('📦 bedrock-protocol: unknown');
  }

  try {
    console.log(
      `📦 minecraft-data: ${require('minecraft-data/package.json').version}`
    );
  } catch (_) {
    console.log('📦 minecraft-data: unknown');
  }

  console.log(`🎮 Server: ${HOST}:${PORT}`);
  console.log(`👤 Username: ${USERNAME}`);
  console.log(`🔐 Offline mode: ${OFFLINE_MODE}`);

  logHeader('⏱️ Starting population monitor');

  await checkServerStatus();

  tryNextAvailableRoute();
}

// ============================================================
// PROCESS SHUTDOWN
// ============================================================

function shutdown(signal) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  console.log(`\n🛑 Received ${signal}. Shutting down...`);

  destroyClient(`shutdown (${signal})`);

  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('uncaughtException', (err) => {
  console.error('💥 UNCAUGHT EXCEPTION:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('💥 UNHANDLED REJECTION:', reason);
});

// ============================================================
// IGNITION
// ============================================================

start().catch((err) => {
  console.error('💥 Startup failure:', err);
  process.exit(1);
});
