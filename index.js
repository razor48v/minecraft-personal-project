const express = require('express');
const bedrock = require('bedrock-protocol');
const { SocksProxyAgent } = require('socks-proxy-agent');

// ==========================================
// STARTUP
// ==========================================
console.log('==========================================');
console.log('🚀 2b2t Pufferfish Bot Starting');
console.log('==========================================');
console.log(`Node: ${process.version}`);

try {
  console.log(
    `bedrock-protocol: ${require('bedrock-protocol/package.json').version}`
  );
} catch {}

try {
  console.log(
    `minecraft-data: ${require('minecraft-data/package.json').version}`
  );
} catch {}

console.log('==========================================');

// ==========================================
// RENDER WEB SERVER
// ==========================================
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('Pufferfish Bedrock Bot Online');
});

app.listen(PORT, () => {
  console.log(`🌐 Web server active on port ${PORT}`);
});

// ==========================================
// SERVER
// ==========================================
const SERVER_HOST = '2b2tmcpe.org';
const SERVER_PORT = 19132;

// ==========================================
// PROXIES
// ==========================================
const proxyPool = [
  'socks5://185.195.23.23:1080',
  'socks5://84.46.251.109:1080',
  'socks5://213.230.69.117:1080',
  'socks5://194.233.68.7:443',
  'socks5://45.142.226.130:8080',
  'socks5://68.183.109.113:80'
];

let poolIndex = 0;
let connectionInProgress = false;

// ==========================================
// SERVER POPULATION
// ==========================================
let statusCheckRunning = false;

async function checkServerStatus() {
  if (statusCheckRunning) {
    console.log('⏳ Population check already running...');
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
// CONNECTION
// ==========================================
function launchCloudBot() {
  if (connectionInProgress) {
    console.log('⏳ Connection already in progress.');
    return;
  }

  connectionInProgress = true;

  if (poolIndex >= proxyPool.length) {
    poolIndex = 0;
  }

  const currentProxy = proxyPool[poolIndex];

  console.log('');
  console.log(
    `🌐 Attempting route [` +
    `${poolIndex + 1}/${proxyPool.length}]: ${currentProxy}`
  );

  let actionTimer = null;
  let finished = false;

  function cleanup() {
    if (actionTimer) {
      clearInterval(actionTimer);
      actionTimer = null;
    }

    connectionInProgress = false;
  }

  function moveToNextRoute(reason) {
    if (finished) {
      return;
    }

    finished = true;

    cleanup();

    console.log(`❌ ${reason}`);

    poolIndex++;

    if (poolIndex >= proxyPool.length) {
      console.log(
        '🔁 Finished all proxy routes.'
      );

      poolIndex = 0;

      console.log(
        '⏳ Waiting 15 seconds before retrying route 1...'
      );

      setTimeout(() => {
        launchCloudBot();
      }, 15000);

      return;
    }

    console.log(
      `🔄 Moving to route ${poolIndex + 1}/${proxyPool.length}`
    );

    setTimeout(() => {
      launchCloudBot();
    }, 5000);
  }

  try {
    const agent = new SocksProxyAgent(currentProxy);

    const client = bedrock.createClient({
      host: SERVER_HOST,
      port: SERVER_PORT,

      username: 'PufferfishFarmer99',

      // Preserve your existing offline configuration.
      offline: true,

      agent
    });

    // ========================================
    // CONNECTION EVENTS
    // ========================================

    client.on('connect', () => {
      console.log(
        '🔌 CONNECT: RakNet connection established'
      );
    });

    client.on('login', () => {
      console.log(
        '🔐 LOGIN: Login stage completed'
      );
    });

    client.on('join', () => {
      console.log(
        '🟡 JOIN: Server accepted login'
      );
    });

    client.on('spawn', () => {
      console.log(
        '🟢 SPAWN: Bot fully entered the world!'
      );

      if (actionTimer) {
        clearInterval(actionTimer);
      }

      actionTimer = setInterval(() => {
        try {
          client.queue('animate', {
            action_id: 1,
            runtime_entity_id: client.entityId
          });
        } catch (err) {
          console.log(
            `⚠️ Animation error: ${err?.message || err}`
          );
        }
      }, 1500);
    });

    // ========================================
    // PLAY STATUS
    // ========================================

    client.on('play_status', (packet) => {
      console.log(
        '🎮 PLAY_STATUS:',
        packet
      );
    });

    // ========================================
    // SERVER CHAT
    // ========================================

    client.on('text', (packet) => {
      if (packet?.message) {
        console.log(
          `💬 SERVER: ${packet.message}`
        );
      }
    });

    // ========================================
    // KICK
    // ========================================

    client.on('kick', (packet) => {
      console.log(
        '🚫 KICK:',
        packet
      );

      const message =
        packet?.message || '';

      if (
        message.toLowerCase().includes('already connected')
      ) {
        console.log(
          'ℹ️ Server says this username is already connected.'
        );

        console.log(
          'ℹ️ Waiting before retrying instead of rapidly rotating proxies.'
        );

        moveToNextRoute(
          'Existing bot session detected'
        );

        return;
      }

      moveToNextRoute(
        'Server kicked the client'
      );
    });

    // ========================================
    // ERROR
    // ========================================

    client.on('error', (err) => {
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
          'ℹ️ This route is presenting Bedrock protocol 419.'
        );

        console.log(
          'ℹ️ Not forcing an incompatible protocol onto the connection.'
        );
      }

      moveToNextRoute(
        'Client connection failure'
      );
    });

    // ========================================
    // CLOSE
    // ========================================

    client.on('close', () => {
      moveToNextRoute(
        'Server connection closed'
      );
    });

  } catch (err) {
    console.log(
      `⚠️ CLIENT INITIALIZATION ERROR: ${
        err?.message || err
      }`
    );

    moveToNextRoute(
      'Client initialization failed'
    );
  }
}

// ==========================================
// START
// ==========================================
console.log('🚀 Starting Cloud Bot...');

launchCloudBot();
