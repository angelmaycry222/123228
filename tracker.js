import fs from 'fs'
import path from 'path'
import axios from 'axios'
import TelegramBot from 'node-telegram-bot-api'
import cron from 'node-cron'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN
const CHAT_ID = process.env.CHAT_ID
const HELIUS_API_KEY = process.env.HELIUS_API_KEY

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: false })

const WATCHED_WALLETS = [
	'Ab2LKcStUSNCxbZ2RKeEyCz1nrKw3AgKBjYMrgsaRdtN',
	'8N4vAeG7sYLHjnaADggH2nkbWDwTXEnEeJRRrHKX6fuj',
	'6TbHffE6GxcGp536avxZpNMEd8uKp2EoP2egAeWWbonk',
	'4zLnAxHtXFqSccSX4kYunfoK6UjbP1gx62ZyycPX7Wi7',
	'Wallet5PublicKey',
]

const notifiedMints = new Set()

// Fetch recent swap mints bought by a wallet in the last interval
async function fetchRecentBuys(wallet) {
	const url = `https://api.helius.xyz/v0/addresses/${wallet}/transactions?api-key=${HELIUS_API_KEY}`
	try {
		const { data } = await axios.get(url)
		// Filter only SWAP transactions and extract destination mint
		return (
			data
				.filter(
					tx => tx.type === 'SWAP' && tx.swapChanges && tx.swapChanges.after
				)
				.map(tx => tx.swapChanges.after.mint) || []
		)
	} catch (err) {
		console.error(
			`Error fetching tx for ${wallet}:`,
			err.response?.status || err.message
		)
		return []
	}
}

async function checkForMatches() {
	const buyCounts = {}
	for (const wallet of WATCHED_WALLETS) {
		const buys = await fetchRecentBuys(wallet)
		console.log(`Wallet ${wallet} bought:`, buys)
		const unique = new Set(buys)
		for (const mint of unique) {
			buyCounts[mint] = (buyCounts[mint] || 0) + 1
		}
	}

	// Notify for any token bought by 2 or more wallets in this interval
	for (const [mint, count] of Object.entries(buyCounts)) {
		if (count >= 2 && !notifiedMints.has(mint)) {
			notifiedMints.add(mint)
			bot
				.sendMessage(CHAT_ID, `🚨 ${count} wallets bought token: ${mint}`)
				.catch(err => console.error('Telegram error:', err.message))
		}
	}
}

// Check every 15 seconds
cron.schedule('*/15 * * * * *', async () => {
	console.log(new Date().toISOString(), 'Checking recent buys by wallets...')
	await checkForMatches()
})

console.log('Watcher started. Monitoring SWAPs every 15 seconds.')
