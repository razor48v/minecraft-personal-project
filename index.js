const express = require('express');
const bedrock = require('bedrock-protocol');

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
// 2. OPEN FAILOVER PROXY CHANNEL POOL
// ==========================================
// These are heavily distributed open-proxy channels that don't block cloud servers.
const proxyPool = [
  { host: '185.195.23.23', port: 1080 },
  { host: '45.142.226.130', port: 8080 },
  { host: '194.233.68.7', port: 443 },
  { host: '185.162.229.170', port: 80 },
  { host: '84.46.251.109', port: 1080 },
  { host: '103.149.131.22', port: 80 }
];

let attemptIndex = 0;

// ==========================================
// 3. THE BEDROCK CONNECTION CONTROLLER
// ==========================================
function startBot() {
  // Loop back to the start of the list if we hit the limit
  if (attemptIndex >= proxyPool.length) {
    attemptIndex = 0;
  }

  const activeProxy = proxyPool[attemptIndex];
  console.log(`\n🔄 Routing bot connection through Channel [${attemptIndex + 1}/${proxyPool.length}]: ${activeProxy.host}:${activeProxy.port}`);

  const client = bedrock.createClient({
    host: '2b2tmcpe.org', 
    port: 19132,          
    username: 'PufferfishFarmer99', 
    offline: true,        // Bypasses the Microsoft Family group / login lockouts
    proxy: activeProxy    
  });

  let fishingInterval = null;

  client.on('spawn', () => {
    console.log(`✅ Success! Bot spawned into 2b2tmcpe via channel proxy: ${activeProxy.host}`);
    
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
  // 4. AUTOMATED CHANNEL ROTATION
  // ==========================================
  client.on('close', () => {
    console.log(`❌ Channel proxy ${activeProxy.host} was rejected or disconnected.`);
    if (fishingInterval) clearInterval(fishingInterval);
    attemptIndex++; // Move to the next connection address instantly
    console.log("Switching to next backup channel route in 5 seconds...");
    setTimeout(startBot, 5000); 
  });

  client.on('error', (err) => {
    console.log(`⚠️ Route error on channel ${activeProxy.host}. Skipping...`);
    if (fishingInterval) clearInterval(fishingInterval);
    try { client.disconnect(); } catch(e) {}
  });
}

// Ignition
startBot();
