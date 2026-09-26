const express = require('express');
const bedrock = require('bedrock-protocol');
const { SocksProxyAgent } = require('socks-proxy-agent');

// ==========================================
// 0. VERSION / ENVIRONMENT CHECK
// ==========================================
console.log('==========================================');
console.log('🚀 2b2t Pufferfish Bot Starting');
console.log('==========================================');
console.log('Node:', process.version);

try {
  console.log(
    'bedrock-protocol:',
    require('bedrock-protocol/package.json').version
  );
} catch (err) {
  console.log('bedrock-protocol version: unknown');
}

try {
  console.log(
    'minecraft-data:',
    require('minecraft-data/package.json').version
  );
} catch (err) {
  console.log('minecraft-data version: unknown');
}

console.log('==========================================');

// ==========================================
// 1. WEB SERVER - RENDER
// ==========================================
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('Self-Contained Proxy Pipeline Active!');
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
// 3. SERVER STATUS CHECK
// ==========================================
// Uses bedrock-protocol's built-in ping() to
// ask the server for its advertised status.
//
// This is independent from the bot's SOCKS
// connection.
// ==========================================
let statusCheckRunning = false;

async function checkServerStatus() {
  // Prevent overlapping status checks
  if (statusCheckRunning) {
    return;
  }

  statusCheckRunning = true;

  try {
    const status = await bedrock.ping({
      host: '2b2tmcpe.org',
      port: 19132,
      transport: 'raknet',
      timeout: 5000
    });

    const playerCount =
      status.playersOnline ??
      status.playerCount ??
      0;

    const maxPlayers =
      status.playersMax ??
      status.maxPlayers ??
      '?';

    console.log(
      `📊 SERVER ONLINE: ${playerCount}/${maxPlayers}`
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

// ==========================================
// 4. START SERVER STATUS MONITOR
// ==========================================
// Check immediately, then every 30 seconds.
// ==========================================
checkServerStatus();

const statusInterval = setInterval(() => {
  checkServerStatus();
}, 30000);

// ==========================================
// 5. CORE BEDROCK CONNECTION CONTROLLER
// ==========================================
function launchCloudBot() {
  if (poolIndex >= proxyPool.length) {
    poolIndex = 0;
  }

  const currentProxy = proxyPool[poolIndex];

  console.log('');
  console.log(
    `🌐 Attempting bypass using Channel Route [` +
    `${poolIndex + 1}/${proxyPool.length}]: ${currentProxy}`
  );

  let actionTimer = null;
  let cleanedUp = false;

  // ========================================
  // PLAYER LIST TRACKER
  // ========================================
  const onlinePlayers = new Map();

  try {
    const agent = new SocksProxyAgent(currentProxy);

    // ========================================
    // BEDROCK CLIENT
    // ========================================
    const client = bedrock.createClient({
      host: '2b2tmcpe.org',
      port: 19132,
      username: 'PufferfishFarmer99',
      offline: true,
      agent: agent
    });

    // ========================================
    // PLAYER LIST
    // ========================================
    client.on('player_list', (packet) => {
      try {
        if (!packet || !Array.isArray(packet.records)) {
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

          // Your server sends:
          // type: 'add'
          // type: 'remove'

          if (player.type === 'add') {
            const key = player.uuid || username;

            onlinePlayers.set(
              key,
              username
            );
          }

          else if (player.type === 'remove') {
            const key = player.uuid || username;

            onlinePlayers.delete(key);

            // Fallback removal by username
            for (
              const [storedKey, storedName]
              of onlinePlayers
            ) {
              if (storedName === username) {
                onlinePlayers.delete(storedKey);
              }
            }
          }
        }

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
            err.message
          }`
        );
      }
    });

    // ========================================
    // SUCCESSFUL SPAWN
    // ========================================
    client.on('spawn', () => {
      console.log(
        '✅ SUCCESS! Bot cleared firewall and spawned into 2b2t overworld!'
      );

      // ======================================
      // PERIODIC ANIMATION
      // ======================================
      actionTimer = setInterval(() => {
        try {
          client.queue('animate', {
            action_id: 1,
            runtime_entity_id: client.entityId
          });
        } catch (err) {
          console.log(
            `⚠️ Animation packet error: ${
              err.message
            }`
          );
        }
      }, 1500);
    });

    // ========================================
    // SERVER ERROR
    // ========================================
    client.on('error', (err) => {
      console.log(
        `⚠️ Socket stream connection failure: ${
          err?.message || err
        }`
      );

      cleanupAndNext();
    });

    // ========================================
    // CONNECTION CLOSED
    // ========================================
    client.on('close', () => {
      console.log(
        '❌ Route dropped or filtered by server.'
      );

      cleanupAndNext();
    });

    // ========================================
    // CLEANUP + NEXT ROUTE
    // ========================================
    function cleanupAndNext() {
      // Prevent error + close from creating
      // multiple reconnect loops.
      if (cleanedUp) {
        return;
      }

      cleanedUp = true;

      if (actionTimer) {
        clearInterval(actionTimer);
        actionTimer = null;
      }

      onlinePlayers.clear();

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

  } catch (err) {
    console.log(
      `⚠️ Agent initialization error: ${
        err.message
      }`
    );

    if (!cleanedUp) {
      cleanedUp = true;

      poolIndex++;

      setTimeout(() => {
        launchCloudBot();
      }, 5000);
    }
  }
}

// ==========================================
// 6. START BOT
// ==========================================
launchCloudBot();
