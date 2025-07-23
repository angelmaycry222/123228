import fs from 'fs'
import path from 'path'
import axios from 'axios'
import cron from 'node-cron'
import TelegramBot from 'node-telegram-bot-api'
import { fileURLToPath } from 'url'

// ========== ES Module dirname workaround ==========
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// ========== CONFIGURATION ==========
const HELIUS_API_KEY = process.env.HELIUS_API_KEY // set in Railway env
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN
const CHAT_ID = process.env.CHAT_ID // numeric or @username

// SPL Token mints to track
const TOKENS = [
	'9YDozC9nm9iZRPS4m4ftMUrvccfqcZYP77bfHpF2bonk',
	'9X45NjtGbGo9zdCFmMyqZyNzC6Wa67KFbfvGc8nubonk',
	'FsoHx5hsEHtvRMiGgyyRcK4MvCCVcZxbLHem4cB1bonk',
	'5kLu7okC3yrL2NKznwQtkvCVoGGyo3iWz2nht1fXbonk',
]

// File to store smart wallets
const SMART_WALLETS_FILE = path.resolve(__dirname, 'smart_wallets.json')
let smartWallets = {}
if (fs.existsSync(SMART_WALLETS_FILE)) {
	smartWallets = JSON.parse(fs.readFileSync(SMART_WALLETS_FILE, 'utf8'))
}

// Initialize Telegram bot (sending only)
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: false })

// ========== HELPERS ==========
// Fetch recent transactions for a given SPL token via Helius API
async function fetchSwapsForToken(mint) {
	const url = `https://api.helius.xyz/v0/token/${mint}/transfers?api-key=${HELIUS_API_KEY}`
	const { data } = await axios.get(url)
	return data.filter(
		tx =>
			tx.type === 'SWAP' &&
			tx.swapProgram &&
			['Orca', 'Raydium'].includes(tx.swapProgram)
	)
}

// Fetch price USD for token
async function fetchPriceUSD(mint) {
	const url = `https://api.helius.xyz/v0/token/${mint}/price?api-key=${HELIUS_API_KEY}`
	const { data } = await axios.get(url)
	return data.priceUsd || null
}

// Persist smartWallets
function persistSmartWallets() {
	fs.writeFileSync(SMART_WALLETS_FILE, JSON.stringify(smartWallets, null, 2))
}

// Notify in Telegram
async function notifyTelegram(text) {
	try {
		await bot.sendMessage(CHAT_ID, text)
	} catch (err) {
		console.error('Telegram send error:', err.message)
	}
}

// ========== CORE LOGIC ==========
async function analyzeTokens() {
	for (const mint of TOKENS) {
		try {
			const swaps = await fetchSwapsForToken(mint)
			for (const tx of swaps) {
				const wallet = tx.wallet
				const entryPrice = tx.amountOut ? tx.amountIn / tx.amountOut : null
				if (!entryPrice) continue
				const currentPrice = await fetchPriceUSD(mint)
				if (!currentPrice) continue
				const profitX = currentPrice / entryPrice
				if (profitX >= 10) {
					if (!smartWallets[mint]) smartWallets[mint] = {}
					if (!smartWallets[mint][wallet]) {
						smartWallets[mint][wallet] = profitX
						console.log(
							`Found smart wallet ${wallet} on ${mint} with ${profitX.toFixed(
								2
							)}x`
						)
					}
				}
			}
		} catch (err) {
			console.error(`Error processing ${mint}:`, err.message)
		}
	}
	persistSmartWallets()
}

async function monitorSmartBuys() {
	const recentBuys = {}
	for (const mint of TOKENS) {
		const swaps = await fetchSwapsForToken(mint)
		for (const tx of swaps) {
			const wallet = tx.wallet
			if (Object.values(smartWallets).some(m => m[wallet])) {
				recentBuys[mint] = recentBuys[mint] || new Set()
				recentBuys[mint].add(wallet)
			}
		}
	}
	for (const [mint, wallets] of Object.entries(recentBuys)) {
		if (wallets.size >= 2) {
			const list = Array.from(wallets).join(', ')
			await notifyTelegram(
				`🚨 ${wallets.size} tracked wallets (${list}) bought ${mint} recently!`
			)
		}
	}
}

// Schedule polling every minute
cron.schedule('* * * * *', async () => {
	console.log(new Date().toISOString(), 'Polling for smart wallets...')
	await analyzeTokens()
	await monitorSmartBuys()
})

console.log('Tracker started. Polling every minute.')
