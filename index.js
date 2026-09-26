const express = require('express');
const bedrock = require('bedrock-protocol');
const { SocksProxyAgent } = require('socks-proxy-agent');
const https = require('https');

// ==========================================
// 1. WEB SERVER FRAMEWORK (For Render / UptimeRobot)
// ==========================================
const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Infinite GitHub Proxy Pipeline Active!'));
app.listen(PORT, () => console.log(`Web server active on port ${PORT}`));

let proxyPool = [];
let poolIndex = 0;

// ==========================================
// 2. LIVE GITHUB PROXY SCRAPER
// ==========================================
// Automatically pulls fresh, live checked SOCKS5 lists straight from GitHub developer repos
function fetchLiveGitHubProxies() {
  return new Promise((resolve) => {
    console.log("📥 Accessing GitHub live developer networks for fresh SOCKS5 nodes...");
    
    // Sourcing from a top auto-updated public proxy hub on GitHub
    const url = 'https://githubusercontent.com';
    
    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        const lines = data.split('\n').filter(line => line.trim().includes(':'));
        if (lines.length === 0) {
          resolve([]);
          return;
        }
        // Map raw text into fully formatted socks5 string URLs
        const formatted = lines.map(line => `socks5://${line.trim()}`);
        console.log(`✨ Successfully loaded ${formatted.length} fresh live proxies from GitHub!`);
        resolve(formatted);
      });
    }).on('error', (err) => {
      console.log("⚠️ GitHub live source error:", err.message);
      resolve([]);
    });
  });
}

// ==========================================
// 3. CORE BEDROCK CONNECTION CONTROLLER
// ==========================================
async function launchCloudBot() {
  // If the pool is empty or we looped through it, fetch a brand new set of live IPs
  if (proxyPool.length === 0 || poolIndex >= proxyPool.length) {
    proxyPool = await fetchLiveGitHubProxies();
    poolIndex = 0;
    
    if (proxyPool.length === 0) {
      console.log("❌ Failed to grab proxy pool. Backing off for 15 seconds...");
      return setTimeout(launchCloudBot, 15000);
    }
  }

  const currentProxy = proxyPool[poolIndex];
  console.log(`\n🌐 Attempting bypass using Proxy [${poolIndex + 1}/${proxyPool.length}]: ${currentProxy}`);

  let actionTimer = null;

  try {
    const agent = new SocksProxyAgent(currentProxy);
    
    const client = bedrock.createClient({
      host: '2b2tmcpe.org',
      port: 19132,
      username: 'PufferfishFarmer99',
      offline: true, // Offline mode bypasses Microsoft parental locks
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
      console.log(`⚠️ Socket stream error. Skipping...`);
      cleanupAndNext();
    });

  } catch (e) {
    console.log(`⚠️ Agent initialization error. Skipping...`);
    cleanupAndNext();
  }

  function cleanupAndNext() {
    if (actionTimer) clearInterval(actionTimer);
    poolIndex++; // Immediately jump to the next proxy node in the massive array
    setTimeout(launchCloudBot, 2000); // 2 second pause to protect server connection limits
  }
}

// Ignition
launchCloudBot();
