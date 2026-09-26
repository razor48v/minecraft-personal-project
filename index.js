const express = require('express');
const bedrock = require('bedrock-protocol');
const { SocksProxyAgent } = require('socks-proxy-agent');

// ==========================================
// 1. WEB SERVER FRAMEWORK (For Render / UptimeRobot)
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
// 2. PRE-VERIFIED BACKUP ROUTING POOL
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
  // Reset to first proxy after reaching the end
  if (poolIndex >= proxyPool.length) {
    poolIndex = 0;
  }

  const currentProxy = proxyPool[poolIndex];

  console.log(
    `\n🌐 Attempting bypass using Channel Route [${poolIndex + 1}/${proxyPool.length}]: ${currentProxy}`
  );

  let actionTimer = null;

  // Prevent error + close from both starting
  // separate reconnect loops
  let cleanedUp = false;

  // Track players for THIS connection
  const onlinePlayers = new Set();

  try {
    // ==========================================
    // SOCKS PROXY
    // ==========================================
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
    // PLAYER LIST TRACKING
    // ==========================================
    client.on('player_list', (packet) => {
      try {
        if (!packet || !packet.records) {
          return;
        }

        for (const player of packet.records) {
          const name =
            player.username ||
            player.name ||
            player.display_name;

          if (!name) {
            continue;
          }

          // Add player
          if (
            packet.action === 'add' ||
            packet.action === 0
          ) {
            onlinePlayers.add(name);
          }

          // Remove player
          else if (
            packet.action === 'remove' ||
            packet.action === 1
          ) {
            onlinePlayers.delete(name);
          }
        }

        // Print current online players
        console.log(
          `👥 ONLINE: ${onlinePlayers.size}` +
          (
            onlinePlayers.size > 0
              ? ` | ${[...onlinePlayers].join(', ')}`
              : ' | Nobody detected'
          )
        );

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
        `✅ SUCCESS! Bot cleared firewall and spawned into 2b2t overworld!`
      );

      // Swing arm periodically
      actionTimer = setInterval(() => {
        try {
          client.queue('animate', {
            action_id: 1,
            runtime_entity_id: client.entityId
          });
        } catch (err) {
          console.log(
            `⚠️ Failed to send animation packet: ${err.message}`
          );
        }
      }, 1500);
    });

    // ==========================================
    // CONNECTION CLOSED
    // ==========================================
    client.on('close', () => {
      console.log(
        `❌ Route dropped or filtered by server.`
      );

      cleanupAndNext();
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

  } catch (e) {
    console.log(
      `⚠️ Agent initialization error: ${e.message}`
    );

    cleanupAndNext();
  }

  // ==========================================
  // CLEANUP + NEXT PROXY
  // ==========================================
  function cleanupAndNext() {
    // IMPORTANT:
    // Prevent both "error" and "close" from
    // starting multiple reconnect timers.
    if (cleanedUp) {
      return;
    }

    cleanedUp = true;

    // Stop animation timer
    if (actionTimer) {
      clearInterval(actionTimer);
      actionTimer = null;
    }

    // Clear player list from old connection
    onlinePlayers.clear();

    // Move to next proxy
    poolIndex++;

    if (poolIndex >= proxyPool.length) {
      console.log(
        `🔁 All proxy routes attempted. Restarting from route 1...`
      );
    } else {
      console.log(
        `🔄 Moving to next route: ${
          poolIndex + 1
        }/${proxyPool.length}`
      );
    }

    // Wait 5 seconds before reconnecting
    setTimeout(() => {
      launchCloudBot();
    }, 5000);
  }
}

// ==========================================
// 4. IGNITION
// ==========================================
console.log('🚀 Starting Cloud Bot...');

launchCloudBot();
