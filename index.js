const express = require('express');
const bedrock = require('bedrock-protocol');
const { SocksProxyAgent } = require('socks-proxy-agent');

// ==========================================
// 0. STARTUP INFO
// ==========================================
console.log('==========================================');
console.log('🚀 2b2t Pufferfish Bot Starting');
console.log('==========================================');
console.log(`Node: ${process.version}`);

try {
  console.log(
    `bedrock-protocol: ${
      require('bedrock-protocol/package.json').version
    }`
  );
} catch {
  console.log('bedrock-protocol: unknown');
}

try {
  console.log(
    `minecraft-data: ${
      require('minecraft-data/package.json').version
    }`
  );
} catch {
  console.log('minecraft-data: unknown');
}

console.log('==========================================');

// ==========================================
// 1. RENDER WEB SERVER
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
// 2. PROXY POOL
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
// 3. SERVER POPULATION MONITOR
// ==========================================
let statusCheckRunning = false;

async function checkServerStatus() {
  if (statusCheckRunning) {
    console.log(
      '⏳ Previous status check is still running...'
    );
    return;
  }

  statusCheckRunning = true;

  console.log('🔎 Checking server population...');

  try {
    const status = await bedrock.ping({
      host: '2b2tmcpe.org',
      port: 19132,
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

    console.log(
      `📊 SERVER STATUS: ${online}/${max}`
    );

    if (status.motd) {
      console.log(`📝 MOTD: ${status.motd}`);
    }

    if (status.version) {
      console.log(`🎮 VERSION: ${status.version}`);
    }

  } catch (err) {
    console.log(
      `⚠️ SERVER STATUS FAILED: ${
        err?.message || err
      }`
    );
  } finally {
    statusCheckRunning = false;
  }
}

console.log(
  '⏱️ Starting 30-second population monitor...'
);

// Run immediately
checkServerStatus();

// Then every 30 seconds
setInterval(() => {
  console.log(
    '⏰ 30-second population timer fired'
  );

  checkServerStatus();
}, 30000);

// ==========================================
// 4. CLOUD BOT
// ==========================================
function launchCloudBot() {
  if (poolIndex >= proxyPool.length) {
    poolIndex = 0;

    console.log(
      '🔁 All proxy routes attempted. Restarting from route 1...'
    );
  }

  const currentProxy = proxyPool[poolIndex];

  console.log('');
  console.log(
    `🌐 Attempting bypass using Channel Route [` +
    `${poolIndex + 1}/${proxyPool.length}]: ${currentProxy}`
  );

  let actionTimer = null;
  let reconnectScheduled = false;

  // ========================================
  // CLIENT PLAYER TRACKING
  // ========================================
  const onlinePlayers = new Map();

  // ========================================
  // RECONNECT HANDLER
  // ========================================
  function scheduleNextRoute(reason) {
    if (reconnectScheduled) {
      return;
    }

    reconnectScheduled = true;

    if (actionTimer) {
      clearInterval(actionTimer);
      actionTimer = null;
    }

    onlinePlayers.clear();

    console.log(`❌ ${reason}`);

    poolIndex++;

    if (poolIndex >= proxyPool.length) {
      console.log(
        '🔁 All proxy routes attempted. Restarting from route 1...'
      );
    } else {
      console.log(
        `🔄 Moving to next route: ` +
        `${poolIndex + 1}/${proxyPool.length}`
      );
    }

    setTimeout(() => {
      launchCloudBot();
    }, 5000);
  }

  try {
    const agent = new SocksProxyAgent(currentProxy);

    // ========================================
    // CREATE BEDROCK CLIENT
    // ========================================
    const client = bedrock.createClient({
      host: '2b2tmcpe.org',
      port: 19132,
      username: 'PufferfishFarmer99',
      offline: true,
      agent: agent
    });

    // ========================================
    // CONNECTION STAGES
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
        '🟡 JOIN: Joined server, waiting for world/spawn...'
      );
    });

    client.on('play_status', (packet) => {
      console.log(
        '🎮 PLAY_STATUS:',
        packet
      );
    });

    // ========================================
    // SPAWN
    // ========================================
    client.on('spawn', () => {
      console.log(
        '🟢 SPAWN: Bot is fully in the world!'
      );

      // ======================================
      // PERIODIC ARM ANIMATION
      // ======================================
      actionTimer = setInterval(() => {
        try {
          client.queue('animate', {
            action_id: 1,
            runtime_entity_id: client.entityId
          });
        } catch (err) {
          console.log(
            `⚠️ Animation error: ${
              err?.message || err
            }`
          );
        }
      }, 1500);
    });

    // ========================================
    // SERVER TEXT
    // ========================================
    client.on('text', (packet) => {
      try {
        console.log(
          '💬 SERVER:',
          packet.message || packet
        );
      } catch {
        console.log(
          '💬 SERVER MESSAGE RECEIVED'
        );
      }
    });

    // ========================================
    // KICK
    // ========================================
    client.on('kick', (reason) => {
      console.log(
        '🚫 KICK:',
        reason
      );
    });

    // ========================================
    // PLAYER LIST
    // ========================================
    client.on('player_list', (packet) => {
      try {
        if (
          !packet ||
          !Array.isArray(packet.records)
        ) {
          return;
        }

        for (const player of packet.records) {
          if (!player) {
            continue;
          }

          const username = player.username;

          if (!username) {
            continue;
          }

          if (player.type === 'add') {
            const key =
              player.uuid || username;

            onlinePlayers.set(
              key,
              username
            );

            console.log(
              `👤 PLAYER JOINED: ${username}`
            );
          }

          else if (player.type === 'remove') {
            const key =
              player.uuid || username;

            onlinePlayers.delete(key);

            // Fallback removal by username
            for (
              const [
                storedKey,
                storedName
              ] of onlinePlayers
            ) {
              if (
                storedName === username
              ) {
                onlinePlayers.delete(
                  storedKey
                );
              }
            }

            console.log(
              `👋 PLAYER LEFT: ${username}`
            );
          }
        }

        // This is ONLY the client's received
        // player-list count, NOT the server
        // population.
        const names = [
          ...onlinePlayers.values()
        ].sort((a, b) =>
          a.localeCompare(b)
        );

        console.log(
          `👥 CLIENT PLAYER LIST: ${names.length}`
        );

        if (names.length > 0) {
          console.log(
            `👤 ${names.join(', ')}`
          );
        }

      } catch (err) {
        console.log(
          `⚠️ Player-list processing error: ${
            err?.message || err
          }`
        );
      }
    });

    // ========================================
    // CLIENT ERROR
    // ========================================
    client.on('error', (err) => {
      console.log(
        `⚠️ CLIENT ERROR: ${
          err?.message || err
        }`
      );

      scheduleNextRoute(
        'Socket connection failure'
      );
    });

    // ========================================
    // CONNECTION CLOSED
    // ========================================
    client.on('close', () => {
      scheduleNextRoute(
        'Server connection closed'
      );
    });

  } catch (err) {
    console.log(
      `⚠️ CLIENT INITIALIZATION ERROR: ${
        err?.message || err
      }`
    );

    scheduleNextRoute(
      'Client initialization failed'
    );
  }
}

// ==========================================
// 5. START BOT
// ==========================================
console.log('🚀 Starting Cloud Bot...');

launchCloudBot();
