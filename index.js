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
// 3. BOT CONTROLLER
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
  // ONLINE PLAYER TRACKER
  // ========================================
  const onlinePlayers = new Map();

  try {
    const agent = new SocksProxyAgent(currentProxy);

    // ========================================
    // BEDROCK CONNECTION
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

          // Your server's packet uses:
          //
          // type: 'add'
          // type: 'remove'
          //
          // rather than packet.action.
          if (player.type === 'add') {
            const key = player.uuid || username;

            onlinePlayers.set(key, username);
          }

          else if (player.type === 'remove') {
            const key = player.uuid || username;

            onlinePlayers.delete(key);

            // Fallback in case the remove packet
            // doesn't contain the UUID we stored.
            for (const [storedKey, storedName] of onlinePlayers) {
              if (storedName === username) {
                onlinePlayers.delete(storedKey);
              }
            }
          }
        }

        // ======================================
        // PRINT ONLINE COUNT
        // ======================================
        const names = [...onlinePlayers.values()]
          .sort((a, b) => a.localeCompare(b));

        console.log('');
        console.log(`👥 ONLINE: ${names.length}`);

        if (names.length > 0) {
          console.log(`👤 ${names.join(', ')}`);
        } else {
          console.log('👤 Nobody detected');
        }

      } catch (err) {
        console.log(
          `⚠️ Player-list processing error: ${err.message}`
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
            `⚠️ Animation packet error: ${err.message}`
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

      // Stop animation
      if (actionTimer) {
        clearInterval(actionTimer);
        actionTimer = null;
      }

      // Clear old player list
      onlinePlayers.clear();

      // Move to next proxy
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

      // Wait before reconnecting
      setTimeout(() => {
        launchCloudBot();
      }, 5000);
    }

  } catch (err) {
    console.log(
      `⚠️ Agent initialization error: ${err.message}`
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
// 4. IGNITION
// ==========================================
launchCloudBot();
