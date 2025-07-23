import fs from 'fs';
import path from 'path';
import axios from 'axios';
import cron from 'node-cron';
import TelegramBot from 'node-telegram-bot-api';
import { fileURLToPath } from 'url';

// ========== ES Module dirname workaround ==========
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ========== CONFIGURATION ==========
const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const MAX_SMART_TO_ALERT = 2; // threshold of tracked wallets

// File to store smart wallets
const SMART_WALLETS_FILE = path.resolve(__dirname, 'smart_wallets.json');
let smartWallets = {};
if (fs.existsSync(SMART_WALLETS_FILE)) {
  smartWallets = JSON.parse(fs.readFileSync(SMART_WALLETS_FILE, 'utf8'));
}

// Initialize Telegram bot
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: false });

// ========== HELPERS ==========
// Dynamically fetch latest "cabal" token mints based on volume spike (example: Birdeye API)
async function fetchCabalTokens() {
  // Use Birdeye API key if provided, else fallback to static list
  const BIRDEYE_KEY = process.env.BIRDEYE_API_KEY;
  if (!BIRDEYE_KEY) {
    console.warn('No BIRDEYE_API_KEY set, using static token list');
    return [
      '9YDozC9nm9iZRPS4m4ftMUrvccfqcZYP77bfHpF2bonk',
      '9X45NjtGbGo9zdCFmMyqZyNzC6Wa67KFbfvGc8nubonk',
      'FsoHx5hsEHtvRMiGgyyRcK4MvCCVcZxbLHem4cB1bonk',
      '5kLu7okC3yrL2NKznwQtkvCVoGGyo3iWz2nht1fXbonk'
    ];
  }

  try {
    const { data } = await axios.get(
      'https://api.birdeye.so/v2/solana/coins/spike',
      {
        params: { period: '1h', minVolume: 10000 },
        headers: { Authorization: `Bearer ${BIRDEYE_KEY}` }
      }
    );
    return data.map(token => token.mint).slice(0, 10);
  } catch (err) {
    console.error('Error fetching cabal tokens:', err.response?.status, err.message);
    console.warn('Falling back to static token list');
    return [
      '9YDozC9nm9iZRPS4m4ftMUrvccfqcZYP77bfHpF2bonk',
      '9X45NjtGbGo9zdCFmMyqZyNzC6Wa67KFbfvGc8nubonk',
      'FsoHx5hsEHtvRMiGgyyRcK4MvCCVcZxbLHem4cB1bonk',
      '5kLu7okC3yrL2NKznwQtkvCVoGGyo3iWz2nht1fXbonk'
    ];
  }
} = await axios.get('https://api.birdeye.so/v2/solana/coins/spike', { params: { period: '1h', minVolume: 10000 } });
    // Assume API returns array of objects with mint property
    return data.map(token => token.mint).slice(0, 10);
  } catch (err) {
    console.error('Error fetching cabal tokens:', err.message);
    // Fallback to static list if needed
    return [
      '9YDozC9nm9iZRPS4m4ftMUrvccfqcZYP77bfHpF2bonk',
      '9X45NjtGbGo9zdCFmMyqZyNzC6Wa67KFbfvGc8nubonk',
      'FsoHx5hsEHtvRMiGgyyRcK4MvCCVcZxbLHem4cB1bonk',
      '5kLu7okC3yrL2NKznwQtkvCVoGGyo3iWz2nht1fXbonk'
    ];
  }
}

// Fetch recent swap transactions for a given token via Helius
async function fetchSwapsForToken(mint) {
  const url = `https://api.helius.xyz/v0/token/${mint}/transfers?api-key=${HELIUS_API_KEY}`;
  try {
    const { data } = await axios.get(url);
    return data.filter(tx => tx.type === 'SWAP' && tx.swapProgram && ['Orca', 'Raydium'].includes(tx.swapProgram));
  } catch (err) {
    if (err.response && err.response.status === 404) return [];
    console.error(`Error fetching swaps for ${mint}:`, err.message);
    return [];
  }
}

// Fetch price USD for token
async function fetchPriceUSD(mint) {
  const url = `https://api.helius.xyz/v0/token/${mint}/price?api-key=${HELIUS_API_KEY}`;
  try {
    const { data } = await axios.get(url);
    return data.priceUsd || null;
  } catch (err) {
    if (err.response && err.response.status === 404) return null;
    console.error(`Error fetching price for ${mint}:`, err.message);
    return null;
  }
}

// Persist smartWallets
function persistSmartWallets() {
  fs.writeFileSync(SMART_WALLETS_FILE, JSON.stringify(smartWallets, null, 2));
}

// Notify in Telegram
async function notifyTelegram(text) {
  try {
    await bot.sendMessage(CHAT_ID, text);
  } catch (err) {
    console.error('Telegram send error:', err.message);
  }
}

// ========== CORE LOGIC ==========
async function analyzeTokens(tokens) {
  for (const mint of tokens) {
    const swaps = await fetchSwapsForToken(mint);
    for (const tx of swaps) {
      const wallet = tx.wallet;
      const entryPrice = tx.amountOut ? (tx.amountIn / tx.amountOut) : null;
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
  }
  persistSmartWallets();
}

async function monitorSmartBuys(tokens) {
  const recentBuys = {};
  for (const mint of tokens) {
    const swaps = await fetchSwapsForToken(mint);
    for (const tx of swaps) {
      const wallet = tx.wallet;
      if (Object.values(smartWallets).some(m => m[wallet])) {
        recentBuys[mint] = recentBuys[mint] || new Set();
        recentBuys[mint].add(wallet);
      }
    }
  }
  for (const [mint, wallets] of Object.entries(recentBuys)) {
    if (wallets.size >= MAX_SMART_TO_ALERT) {
      const list = Array.from(wallets).join(', ');
      await notifyTelegram(`🚨 ${wallets.size} tracked wallets (${list}) bought ${mint} recently!`);
    }
  }
}

// Schedule polling every minute
cron.schedule('* * * * *', async () => {
  console.log(new Date().toISOString(), 'Polling for fresh cabal tokens...');
  const tokens = await fetchCabalTokens();
  console.log('Tracking tokens:', tokens);
  await analyzeTokens(tokens);
  await monitorSmartBuys(tokens);
});

console.log('Dynamic Tracker started. Polling every minute for new cabal tokens.');
