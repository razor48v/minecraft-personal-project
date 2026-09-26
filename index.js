const express = require('express');
const bedrock = require('bedrock-protocol');
const { SocksProxyAgent } = require('socks-proxy-agent');

// ==========================================
// 1. WEB SERVER
// ==========================================
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('Self-Contained Proxy Pipeline Active!');
});

app.listen(PORT, () => {
  console.log(`Web server active on port ${PORT}`);
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
// 3. CORE BEDROCK CONNECTION CONTROLLER
// ==========================================
function launchCloudBot() {
  if (poolIndex >= proxyPool.length) {
    poolIndex = 0;
  }

  const currentProxy = proxyPool[poolIndex];

  console.log(
    `\n🌐 Attempting bypass using Channel Route [${poolIndex + 1}/${proxyPool.length}]: ${currentProxy}`
  );

  let actionTimer = null;
  let cleanedUp = false;

  // ==========================================
  // TRACK ONLINE PLAYERS
  // ==========================================
  const onlinePlayers = new Map();

  try {
    const agent = new SocksProxyAgent(currentProxy);

    // ==========================================
    // BEDROCK CLIENT
    // ==========================================
    const client = bedrock.createClient({
      host: '2b2tmcpe.org',
      port: 19132,
      username: 'PufferfishFarmer99',
      offline: true,
      agent: agent
    });

    // ==========================================
    // PLAYER LIST
    // ==========================================
    client.on('player_list', (packet) => {
      try {
        if (!packet || !Array.isArray(packet.records)) {
          return;
        }

        for (const player of packet.records) {
          if (!player) continue;

          const username = player.username;

          if (!username) continue;

          // ======================================
          // PLAYER JOINED
          // ======================================
          if (
            player.type === 'add' ||
            player.legacy_type === 0
          ) {
            onlinePlayers.set(
              player.uuid || username,
              username
            );
          }

          // ======================================
          // PLAYER LEFT
          // ======================================
          else if (
            player.type === 'remove' ||
            player.legacy_type === 1
          ) {
            onlinePlayers.delete(
              player.uuid || username
            );
          }
        }

        // ==========================================
        // PRINT CURRENT ONLINE PLAYERS
        // ==========================================
        const names = [...onlinePlayers.values()]
          .sort((a, b) => a.localeCompare(b));

        console.log(
          `👥 ONLINE: ${names.length}`
        );

        if (names.length > 0) {
          console.log(
            `👤 ${names.join(', ')}`
          );
        }

      } catch (err) {
        console.log(
          `⚠️ Player list processing error: ${err.message}`
        );
      }
    });

    // ==========================================
    // SUCCESSFUL SPAWN
    // ==========================================
    client.on('spawn', () => {
      console.log(
        '✅ SUCCESS! Bot cleared firewall and spawned into 2b2t overworld!'
      );

      // ========================================
      // SWING ARM
      // ========================================
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

    // ==========================================
    // CONNECTION ERROR
    // ==========================================
    client.on('error', (err) => {
      console.log(
        `⚠️ Socket stream connection failure: ${
          err?.message || err
        }`
      );

      cleanupAndNext();
    });

    // ==========================================
    // CONNECTION CLOSED
    // ==========================================
    client.on('close', () => {
      console.log(
        '❌ Route dropped or filtered by server.'
      );

      cleanupAndNext();
    });

    // ==========================================
    // CLEANUP + NEXT ROUTE
    // ==========================================
    function cleanupAndNext() {
      // Prevent error + close from creating
      // multiple reconnect loops.
      if (cleanedUp) {
        return;
      }

      cleanedUp = true;

      // Stop animation timer
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
          `🔄 Moving to next route: ${
            poolIndex + 1
          }/${proxyPool.length}`
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
console.log('🚀 Starting Cloud Bot...');

launchCloudBot();
