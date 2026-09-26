const express = require('express');
const bedrock = require('bedrock-protocol');
const https = require('https');

// ==========================================
// 1. THE STAY-AWAKE WEB SERVER (For Render)
// ==========================================
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('Fishing bot proxy router is currently active!');
});

app.listen(PORT, () => {
  console.log(`Web server listening on port ${PORT}`);
});

// ==========================================
// 2. AUTOMATIC PROXY HARVESTER (FIXED)
// ==========================================
function getFreeProxyList() {
  return new Promise((resolve) => {
    console.log("Fetching fresh proxy lists from secure text API...");
    // Swapped to a raw-text provider that does not block data centers
    const url = 'https://pubproxy.com';
    
    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        // Splitting by lines and ensuring it's a valid string format
        const lines = data.split('\n').filter(line => line.trim().includes(':'));
        
        if (lines.length === 0) {
          console.log("⚠️ Received empty or invalid proxy data from API.");
          resolve([]);
          return;
        }

        const formattedProxies = lines.map(line => {
          const [host, port] = line.trim().split(':');
          return { host, port: parseInt(port) };
        });
        resolve(formattedProxies);
      });
    }).on('error', (err) => {
      console.log("API connection error:", err.message);
      resolve([]);
    });
  });
}


// ==========================================
// 3. THE BEDROCK CONNECTION CONTROLLER
// ==========================================
async function startBot() {
  const proxies = await getFreeProxyList();
  
  if (proxies.length === 0) {
    console.log("⚠️ Could not fetch proxies. Retrying in 10 seconds...");
    return setTimeout(startBot, 10000);
  }

  // Grab the very first proxy from the freshly scraped internet list
  const activeProxy = proxies[Math.floor(Math.random() * proxies.length)];
  console.log(`\n🔄 Routing bot connection through Scraped Proxy: ${activeProxy.host}:${activeProxy.port}`);

  const client = bedrock.createClient({
    host: '2b2tmcpe.org', // Target Anarchy Server
    port: 19132,          // Default Bedrock Port
    username: 'PufferfishFarmer99', // Custom username for Offline Mode
    offline: true,        // Skips Microsoft Account/License checks completely
    proxy: activeProxy    // Automatically injects the working scraped IP
  });

  // ==========================================
  // 4. THE AUTO-FISHING PACKET TIMER
  // ==========================================
  let fishingInterval = null;

  client.on('spawn', () => {
    console.log(`✅ Success! Bot spawned into 2b2tmcpe via proxy: ${activeProxy.host}`);
    
    // Sends the interact packet every 1.5 seconds to cast the line safely
    fishingInterval = setInterval(() => {
      client.queue('inventory_transaction', {
        transaction_type: 'item_use',
        action_type: 'click',
        item: { network_id: 0 },
        position: { x: 0, y: 0, z: 0 },
        click_position: { x: 0, y: 0, z: 0 }
      });
    }, 1500);
  });

  // ==========================================
  // 5. FAILOVER / DISCONNECT RECONNECT
  // ==========================================
  // If the server anti-cheat kicks the proxy, grab a brand new one and restart
  client.on('close', () => {
    console.log(`❌ Proxy ${activeProxy.host} was disconnected or blocked.`);
    if (fishingInterval) clearInterval(fishingInterval);
    console.log("Scraping a new IP address and rejoining in 10 seconds...");
    setTimeout(startBot, 10000); 
  });

  client.on('error', (err) => {
    console.log(`⚠️ Network Error on proxy ${activeProxy.host}. Cycling...`);
    if (fishingInterval) clearInterval(fishingInterval);
    try { client.disconnect(); } catch(e) {}
  });
}

// Launch the automated cloud engine
startBot();
