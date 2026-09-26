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
// 3. CONNECTION CONTROLLER
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

  // Players detected on this connection
  const onlinePlayers = new Set();

  // ==========================================
  // CONNECT
  // ==========================================
  try {
    const agent = new SocksProxyAgent(currentProxy);

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
        // Print the first packet so we can see the
        // exact structure your server is sending.
        if (!client.__printedPlayerPacket) {
          client.__printedPlayerPacket = true;

          console.log('\n==========================================');
          console.log('📋 RAW PLAYER LIST PACKET');
          console.log('==========================================');

          console.dir(packet, {
            depth: 6,
            colors: false
          });

          console.log('==========================================\n');
        }

        if (!packet || !packet.records) {
          console.log('⚠️ Player list packet contained no records.');
          return;
        }

        // ==========================================
        // DETERMINE ADD / REMOVE
        // ==========================================
        const action = packet.action;

        const isAdd =
          action === 0 ||
          action === 'add' ||
          action === 'ADD';

        const isRemove =
          action === 1 ||
          action === 'remove' ||
          action === 'REMOVE';

        // ==========================================
        // PROCESS PLAYERS
        // ==========================================
        for (const player of packet.records) {
          if (!player) continue;

          // Try all common Bedrock player-name fields.
          const name =
            player.username ||
            player.name ||
            player.display_name ||
            player.displayName;

          if (!name) {
            continue;
          }

          if (isAdd) {
            onlinePlayers.add(String(name));
          } else if (isRemove) {
            onlinePlayers.delete(String(name));
          }
        }

        // ==========================================
        // PRINT ONLINE COUNT
        // ==========================================
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
          `⚠️ Player-list processing error: ${err.message}`
        );
      }
    });

    // ==========================================
    // SPAWN
    // ==========================================
    client.on('spawn', () => {
      console.log(
        '✅ SUCCESS! Bot cleared firewall and spawned into 2b2t overworld!'
      );

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
    // CLEANUP / NEXT PROXY
    // ==========================================
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
          `🔄 Moving to next route: ${
            poolIndex + 1
          }/${proxyPool.length}`
        );
      }

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
// 4. START
// ==========================================
console.log('🚀 Starting Cloud Bot...');

launchCloudBot();
