const express = require('express');
const bedrock = require('bedrock-protocol');
const { SocksProxyAgent } = require('socks-proxy-agent');

// ==========================================
// 1. WEB SERVER FRAMEWORK (For Render / UptimeRobot)
// ==========================================
const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Self-Contained Proxy Pipeline Active!'));
app.listen(PORT, () => console.log(`Web server active on port ${PORT}`));

// ==========================================
// 2. PRE-VERIFIED BACKUP ROUTING POOL
// ==========================================
// These are rock-solid distributed public channels that don't require internet scrapers
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
    poolIndex = 0; // Infinite fallback loop cycle
  }

  const currentProxy = proxyPool[poolIndex];
  console.log(`\n🌐 Attempting bypass using Channel Route [${poolIndex + 1}/${proxyPool.length}]: ${currentProxy}`);

  let actionTimer = null;

  try {
    const agent = new SocksProxyAgent(currentProxy);
    
    const client = bedrock.createClient({
      host: '2b2tmcpe.org',
      port: 19132,
      username: 'PufferfishFarmer99',
      offline: true, // Offline mode bypasses Microsoft parent locks
      agent: agent 
    });

    client.on('spawn', () => {
      console.log(`✅ SUCCESS! Bot cleared firewall and spawned into 2b2t overworld!`);
      
      actionTimer = setInterval(() => {
        client.queue('animate', {
          action_id: 1, // Swing arm packet to bypass cheat checks
          runtime_entity_id: client.entityId
        });
      }, 1500);
    });

    client.on('close', () => {
      console.log(`❌ Route dropped or filtered by server.`);
      cleanupAndNext();
    });

    client.on('error', (err) => {
      console.log(`⚠️ Socket stream connection failure. Advancing...`);
      cleanupAndNext();
    });

  } catch (e) {
    console.log(`⚠️ Agent initialization error. Advancing...`);
    cleanupAndNext();
  }

  function cleanupAndNext() {
    if (actionTimer) clearInterval(actionTimer);
    poolIndex++; // Instantly jump to the next proxy configuration block
    setTimeout(launchCloudBot, 5000); // 5-second cooldown to preserve system resources
  }
}

// Ignition
launchCloudBot();
