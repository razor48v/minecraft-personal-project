'use strict';

const bedrock = require('bedrock-protocol');

// ============================================================
// CONFIG
// ============================================================

const HOST = '2b2tmcpe.org';
const PORT = 19132;

const USERNAME = 'PufferfishFarmer99';
const OFFLINE_MODE = true;

const RETRY_DELAY_MS = 5000;
const POPULATION_INTERVAL_MS = 30_000;

// ============================================================
// STATE
// ============================================================

let client = null;
let connected = false;
let spawned = false;
let shuttingDown = false;
let reconnectScheduled = false;

const players = new Map();

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

  console.log(`👥 CLIENTS ONLINE: ${names.length}`);

  if (names.length === 0) {
    console.log('   Nobody detected');
    return;
  }

  for (const name of names) {
    console.log(`👤 ${name}`);
  }
}

// ============================================================
// SERVER STATUS MONITOR
// ============================================================

async function checkServerStatus() {
  console.log('🔎 Checking server status...');

  try {
    const result = await bedrock.ping({
      host: HOST,
      port: PORT
    });

    if (!result) {
      console.log('⚠️ Server status returned no data.');
      return;
    }

    const online = result.players?.online ?? result.online ?? result.player_count ?? '?';
    const max = result.players?.max ?? result.max ?? '?';

    console.log(`📊 SERVER STATUS: ${online}/${max}`);

    if (result.motd) {
      console.log(`📝 MOTD: ${result.motd}`);
    }
  } catch (err) {
    console.log(`⚠️ Server status ping failed: ${err?.message || String(err)}`);
  }
}

setInterval(() => {
  if (connected) {
    checkServerStatus();
  }
}, POPULATION_INTERVAL_MS);

// ============================================================
// CLIENT CLEANUP & RECONNECT
// ============================================================

function destroyClient(reason = 'cleanup') {
  const oldClient = client;

  client = null;
  connected = false;
  spawned = false;
  players.clear();

  if (!oldClient) return;

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
}

function scheduleReconnect(reason) {
  if (shuttingDown || reconnectScheduled) return;

  reconnectScheduled = true;
  console.log(`🔄 ${reason}`);

  setTimeout(() => {
    reconnectScheduled = false;
    if (shuttingDown) return;
    connectToServer();
  }, RETRY_DELAY_MS);
}

// ============================================================
// CONNECTION LOGIC
// ============================================================

function connectToServer() {
  if (shuttingDown) return;

  if (client || connected) {
    console.log('🔒 Existing client is active; skipping duplicate connection.');
    return;
  }

  logHeader(`🌐 CONNECTING TO ${HOST}:${PORT}`);

  let spawnTimeout = null;

  try {
    const newClient = bedrock.createClient({
      host: HOST,
      port: PORT,
      username: USERNAME,
      offline: OFFLINE_MODE,
      skipPing: true // Speeds up login handshake over UDP
    });

    client = newClient;

    // --------------------------------------------------------
    // LOGIN & SPAWN EVENTS
    // --------------------------------------------------------

    newClient.on('play_status', (packet) => {
      if (packet?.status === 'login_success') {
        connected = true;
        console.log('🟡 JOIN: Server accepted login packet');
        console.log('🟡 Waiting for world spawn...');
      }

      if (packet?.status === 'player_spawn') {
        connected = true;
        spawned = true;

        if (spawnTimeout) {
          clearTimeout(spawnTimeout);
          spawnTimeout = null;
        }

        logHeader('🟢 BOT FULLY SPAWNED ON SERVER');
        printPlayers();
      }
    });

    newClient.on('spawn', () => {
      connected = true;
      spawned = true;

      if (spawnTimeout) {
        clearTimeout(spawnTimeout);
        spawnTimeout = null;
      }

      logHeader('🟢 BOT FULLY SPAWNED ON SERVER');
      printPlayers();
    });

    // --------------------------------------------------------
    // PLAYER LIST EVENTS
    // --------------------------------------------------------

    newClient.on('player_list', (packet) => {
      try {
        const records = packet?.records || [];

        for (const record of records) {
          const username = record?.username;
          if (!username) continue;

          const uuid = String(record.uuid ?? record.entity_unique_id ?? username);

          if (record.type === 'remove' || record.type === 'remove_player') {
            players.delete(uuid);
            console.log(`👋 PLAYER LEFT: ${username}`);
          } else {
            players.set(uuid, username);
            console.log(`👤 PLAYER JOINED: ${username}`);
          }
        }

        printPlayers();
      } catch (err) {
        console.log(`⚠️ Player list processing error: ${err?.message || String(err)}`);
      }
    });

    // --------------------------------------------------------
    // ERROR & DISCONNECT HANDLERS
    // --------------------------------------------------------

    newClient.on('error', (err) => {
      const message = err?.message || String(err);
      console.log(`⚠️ CLIENT ERROR: ${message}`);

      destroyClient(`Client error: ${message}`);
      scheduleReconnect('Reconnecting after network error...');
    });

    newClient.on('close', () => {
      console.log('❌ CLIENT CONNECTION CLOSED');

      if (spawnTimeout) {
        clearTimeout(spawnTimeout);
        spawnTimeout = null;
      }

      destroyClient('Disconnected by server');
      scheduleReconnect('Reconnecting after disconnect...');
    });

    // --------------------------------------------------------
    // SPAWN TIMEOUT GUARD
    // --------------------------------------------------------

    spawnTimeout = setTimeout(() => {
      if (shuttingDown || spawned || client !== newClient) return;

      console.log('⏰ Spawn timeout reached.');
      destroyClient('Connected, but server never sent player_spawn packet');
      scheduleReconnect('Retrying connection...');
    }, 45_000);

  } catch (err) {
    console.log(`💥 Initialization error: ${err?.message || String(err)}`);
    destroyClient('Initialization failed');
    scheduleReconnect('Retrying initialization...');
  }
}

// ============================================================
// STARTUP & CLEAN SHUTDOWN
// ============================================================

async function start() {
  logHeader('🚀 Starting Local Bot');

  console.log(`🖥️ Node: ${process.version}`);
  console.log(`🎮 Target Server: ${HOST}:${PORT}`);
  console.log(`👤 Username: ${USERNAME}`);
  console.log(`🔐 Offline mode: ${OFFLINE_MODE}`);

  await checkServerStatus();
  connectToServer();
}

function shutdown(signal) {
  if (shuttingDown) return;

  shuttingDown = true;
  console.log(`\n🛑 Received ${signal}. Shutting down cleanly...`);
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

start().catch((err) => {
  console.error('💥 Startup failure:', err);
  process.exit(1);
});
