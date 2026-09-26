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
} catch {
  console.log('bedrock-protocol: unknown');
}

try {
  console.log(
    `minecraft-data: ${require('minecraft-data/package.json').version}`
  );
} catch {
  console.log('minecraft-data: unknown');
}

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
// PROXY POOL
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

// ==========================================
// CONNECTION STATE
// ==========================================
let activeClient = null;
let connectionInProgress = false;
let activeRoute = false;

// ==========================================
// SERVER POPULATION MONITOR
// ==========================================
let statusCheckRunning = false;

async function checkServerStatus() {
  if (statusCheckRunning) {
    console.log('⏳ Previous population check still running...');
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
// MOVE TO NEXT ROUTE
// ==========================================
function moveToNextRoute(reason) {
  if (connectionInProgress) {
    connectionInProgress = false;
  }

  activeRoute = false;
  activeClient = null;

  console.log(`❌ ${reason}`);

  poolIndex++;

  if (poolIndex >= proxyPool.length) {
    console.log(
      '🔁 All routes exhausted. Restarting from route 1...'
    );

    poolIndex = 0;
  } else {
    console.log(
      `🔄 Moving to route ${poolIndex + 1}/${proxyPool.length}`
    );
  }

  setTimeout(() => {
    launchCloudBot();
  }, 5000);
}

// ==========================================
// LAUNCH BOT
// ==========================================
function launchCloudBot() {
  // ----------------------------------------
  // NEVER START ANOTHER CONNECTION IF ONE
  // IS ALREADY ACTIVE
  // ----------------------------------------
  if (activeClient || activeRoute || connectionInProgress) {
    console.log(
      '🟢 Existing connection is active. Staying on current route.'
    );

    return;
  }

  if (poolIndex >= proxyPool.length) {
    poolIndex = 0;
  }

  connectionInProgress = true;

  const currentRouteNumber = poolIndex + 1;
  const currentProxy = proxyPool[poolIndex];

  console.log('');
  console.log(
    `🌐 Attempting route [` +
    `${currentRouteNumber}/${proxyPool.length}]: ${currentProxy}`
  );

  let actionTimer = null;
  let finished = false;

  try {
    const agent = new SocksProxyAgent(currentProxy);

    const client = bedrock.createClient({
      host: SERVER_HOST,
      port: SERVER_PORT,
      username: 'PufferfishFarmer99',
      offline: true,
      agent
    });

    activeClient = client;

    // ======================================
    // RAKNET CONNECT
    // ======================================
    client.on('connect', () => {
      console.log(
        `🔌 CONNECTED through route ${currentRouteNumber}`
      );
    });

    // ======================================
    // LOGIN
    // ======================================
    client.on('login', () => {
      console.log(
        `🔐 LOGIN SUCCESS through route ${currentRouteNumber}`
      );
    });

    // ======================================
    // JOIN
    // ======================================
    client.on('join', () => {
      console.log(
        `🟡 JOIN: Server accepted login on route ${currentRouteNumber}`
      );
    });

    // ======================================
    // PLAY STATUS
    // ======================================
    client.on('play_status', (packet) => {
      console.log(
        '🎮 PLAY_STATUS:',
        packet
      );
    });

    // ======================================
    // SPAWN = ROUTE IS NOW ACTIVE
    // ======================================
    client.on('spawn', () => {
      if (finished) {
        return;
      }

      // This is the important part:
      // once spawned, STOP rotating routes.
      activeRoute = true;
      connectionInProgress = false;

      console.log('');
      console.log(
        '=========================================='
      );
      console.log(
        `🟢 BOT ONLINE — ROUTE ${currentRouteNumber} IS WORKING`
      );
      console.log(
        `🌐 Active proxy: ${currentProxy}`
      );
      console.log(
        '🔒 Staying on this route until disconnect.'
      );
      console.log(
        '=========================================='
      );

      // --------------------------------------
      // ARM ANIMATION
      // --------------------------------------
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

    // ======================================
    // SERVER CHAT
    // ======================================
    client.on('text', (packet) => {
      if (packet?.message) {
        console.log(
          `💬 SERVER: ${packet.message}`
        );
      }
    });

    // ======================================
    // KICK
    // ======================================
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
          'ℹ️ Server reports this username is already connected.'
        );
      }
    });

    // ======================================
    // ERROR
    // ======================================
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
          'ℹ️ Route returned unsupported Bedrock protocol 419.'
        );
      }

      // If we're already fully connected,
      // let CLOSE handle the actual rotation.
      if (activeRoute) {
        console.log(
          '⚠️ Active route encountered an error; waiting for connection close.'
        );

        return;
      }

      if (!finished) {
        finished = true;

        if (actionTimer) {
          clearInterval(actionTimer);
          actionTimer = null;
        }

        activeClient = null;
        activeRoute = false;
        connectionInProgress = false;

        console.log(
          '🔄 Connection failed before spawn; trying next route.'
        );

        poolIndex++;

        if (poolIndex >= proxyPool.length) {
          poolIndex = 0;

          console.log(
            '🔁 All routes failed. Restarting from route 1 in 15 seconds...'
          );

          setTimeout(() => {
            launchCloudBot();
          }, 15000);
        } else {
          console.log(
            `🔄 Moving to route ${poolIndex + 1}/${proxyPool.length}`
          );

          setTimeout(() => {
            launchCloudBot();
          }, 5000);
        }
      }
    });

    // ======================================
    // CLOSE
    // ======================================
    client.on('close', () => {
      if (finished) {
        return;
      }

      finished = true;

      if (actionTimer) {
        clearInterval(actionTimer);
        actionTimer = null;
      }

      const wasActive = activeRoute;

      activeClient = null;
      activeRoute = false;
      connectionInProgress = false;

      console.log('');

      if (wasActive) {
        console.log(
          '🔴 ACTIVE BOT CONNECTION LOST.'
        );

        console.log(
          `🔄 Route ${currentRouteNumber} disconnected.`
        );
      } else {
        console.log(
          '❌ Connection closed before spawn.'
        );
      }

      poolIndex++;

      if (poolIndex >= proxyPool.length) {
        poolIndex = 0;

        console.log(
          '🔁 All routes exhausted. Returning to route 1.'
        );
      } else {
        console.log(
          `🔄 Next route: ${poolIndex + 1}/${proxyPool.length}`
        );
      }

      setTimeout(() => {
        launchCloudBot();
      }, 5000);
    });

  } catch (err) {
    activeClient = null;
    activeRoute = false;
    connectionInProgress = false;

    console.log(
      `⚠️ CLIENT INITIALIZATION ERROR: ${
        err?.message || err
      }`
    );

    poolIndex++;

    if (poolIndex >= proxyPool.length) {
      poolIndex = 0;

      console.log(
        '🔁 All routes exhausted. Retrying route 1 in 15 seconds...'
      );

      setTimeout(() => {
        launchCloudBot();
      }, 15000);
    } else {
      console.log(
        `🔄 Moving to route ${poolIndex + 1}/${proxyPool.length}`
      );

      setTimeout(() => {
        launchCloudBot();
      }, 5000);
    }
  }
}

// ==========================================
// START
// ==========================================
console.log('🚀 Starting Cloud Bot...');

launchCloudBot();
