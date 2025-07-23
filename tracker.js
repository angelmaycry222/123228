import axios from 'axios'
import TelegramBot from 'node-telegram-bot-api'
import cron from 'node-cron'

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN
const CHAT_ID = process.env.CHAT_ID
const HELIUS_API_KEY = process.env.HELIUS_API_KEY

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: false })

const WATCHED_WALLETS = [
	'Ab2LKcStUSNCxbZ2RKeEyCz1nrKw3AgKBjYMrgsaRdtN',
	'8N4vAeG7sYLHjnaADggH2nkbWDwTXEnEeJRRrHKX6fuj',
	'6TbHffE6GxcGp536avxZpNMEd8uKp2EoP2egAeWWbonk',
	'4zLnAxHtXFqSccSX4kYunfoK6UjbP1gx62ZyycPX7Wi7',
	'7FREb7zknSCCq5p8tbaD7EkfgmDvaJ4Jawq2o67VFRcC',
	'AtFS2W1dMWX2oBef9dJ3gSx5VKXfzqvasbY1iMWAMxGT',
	'HfqckzgVY2L16qYd1W5m674jBFt5jLGNW7iksKFLMJaf',
]

const notifiedMints = new Set()

async function fetchRecentBuys(wallet) {
	const url = `https://api.helius.xyz/v0/addresses/${wallet}/transactions?api-key=${HELIUS_API_KEY}`
	try {
		const { data } = await axios.get(url)
		console.log(`Fetched ${data.length} tx for ${wallet}`)
		return (
			data
				.filter(tx => {
					console.log(JSON.stringify(tx, null, 2))
					return tx.type === 'SWAP' && tx.swapChanges && tx.swapChanges.after
				})
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
		const unique = new Set(buys)
		console.log(`Wallet ${wallet} recent buys:`, Array.from(unique))
		for (const mint of unique) {
			buyCounts[mint] = (buyCounts[mint] || 0) + 1
		}
	}

	for (const [mint, count] of Object.entries(buyCounts)) {
		if (count >= 1 && !notifiedMints.has(mint)) {
			notifiedMints.add(mint)
			bot
				.sendMessage(CHAT_ID, `🚨 ${count} wallets bought token: ${mint}`)
				.catch(err => console.error('Telegram error:', err.message))
		}
	}
}

cron.schedule('*/15 * * * * *', async () => {
	console.log(new Date().toISOString(), 'Checking recent buys by wallets...')
	await checkForMatches()
})

console.log('Watcher started. Monitoring SWAPs every 15 seconds.')
