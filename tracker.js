import fs from 'fs';
import path from 'path';
import axios from 'axios';
import cron from 'node-cron';
import TelegramBot from 'node-telegram-bot-api';

// ========== CONFIGURATION ==========
const HELIUS_API_KEY = 'e6e31935-bdca-4fc1-a743-b88c4e2f0e54'  // e.g. 
const TELEGRAM_BOT_TOKEN = '7869104239:AAHxdigyUTyn_2BjxitBkt9qHw_Nlpv93T4';
const CHAT_ID = '@Sacr1fyc3';  // numeric or @username

// SPL Token mints to track
const TOKENS = [
  '9YDozC9nm9iZRPS4m4ftMUrvccfqcZYP77bfHpF2bonk',
  '9X45NjtGbGo9zdCFmMyqZyNzC6Wa67KFbfvGc8nubonk',
  'FsoHx5hsEHtvRMiGgyyRcK4MvCCVcZxbLHem4cB1bonk',
  '5kLu7okC3yrL2NKznwQtkvCVoGGyo3iWz2nht1fXbonk'
];

// File to store smart wallets
const SMART_WALLETS_FILE = path.resolve(__dirname, 'smart_wallets.json');
let smartWallets = {};
if (fs.existsSync(SMART_WALLETS_FILE)) {
  smartWallets = JSON.parse(fs.readFileSync(SMART_WALLETS_FILE));
}

// Initialize Telegram bot (polling not used for received messages, just for sendMessage)
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN);

// ========== HELPERS ==========
// Fetch recent transactions for a given SPL token mint via Helius API
async function fetchSwapsForToken(mint) {
  const url = `https://api.helius.xyz/v0/token/${mint}/transfers?api-key=${HELIUS_API_KEY}`;
  const { data } = await axios.get(url);
  // Filter for swap types (Raydium, Orca)
  return data.filter(tx => tx.type === 'SWAP' && tx.swapProgram && ['Orca', 'Raydium'].includes(tx.swapProgram));
}

// Fetch approximate price of token in USDC at a given timestamp (placeholder: latest price)
async function fetchPriceUSD(mint) {
  // Placeholder: use simple REST-price from CoinGecko or Helius price if available
  const url = `https://api.helius.xyz/v0/token/${mint}/price?api-key=${HELIUS_API_KEY}`;
  const { data } = await axios.get(url);
  return data.priceUsd || null;
}

// Save smartWallets to file
function persistSmartWallets() {
  fs.writeFileSync(SMART_WALLETS_FILE, JSON.stringify(smartWallets, null, 2));
}

// Send message in Telegram
async function notifyTelegram(text) {
  try {
    await bot.sendMessage(CHAT_ID, text);
  } catch (err) {
    console.error('Telegram send error:', err.message);
  }
}

// ========== CORE LOGIC ==========
async function analyzeTokens() {
  for (const mint of TOKENS) {
    try {
      const swaps = await fetchSwapsForToken(mint);
      for (const tx of swaps) {
        const wallet = tx.wallet;  // buyer wallet
        const entryPrice = tx.amountOut ? tx.amountIn / tx.amountOut : null;
        if (!entryPrice) continue;
        const currentPrice = await fetchPriceUSD(mint);
        if (!currentPrice) continue;
        const profitX = currentPrice / entryPrice;
        if (profitX >= 10) {
          if (!smartWallets[mint]) smartWallets[mint] = {};
          if (!smartWallets[mint][wallet]) {
            smartWallets[mint][wallet] = profitX;
            console.log(`Found smart wallet ${wallet} on ${mint} with ${profitX.toFixed(2)}x`);
          }
        }
      }
    } catch (err) {
      console.error(`Error processing ${mint}:`, err.message);
    }
  }
  persistSmartWallets();
}

// Real-time polling: check if tracked wallets buy same new token
async function monitorSmartBuys() {
  const recentBuys = {};
  for (const mint of TOKENS) {
    const swaps = await fetchSwapsForToken(mint);
    for (const tx of swaps) {
      const wallet = tx.wallet;
      // if wallet is in any smart list
      if (Object.values(smartWallets).some(m => m[wallet])) {
        recentBuys[mint] = (recentBuys[mint] || new Set()).add(wallet);
      }
    }
  }
  // Check groups
  for (const [mint, wallets] of Object.entries(recentBuys)) {
    if (wallets.size >= 2) {
      const list = Array.from(wallets).join(', ');
      await notifyTelegram(`🚨 ${wallets.size} tracked wallets (${list}) bought ${mint} recently!`);
    }
  }
}

// Schedule polling every minute
cron.schedule('* * * * *', async () => {
  console.log(new Date().toISOString(), 'Polling for smart wallets...');
  await analyzeTokens();
  await monitorSmartBuys();
});

console.log('Tracker started. Polling every minute.');
