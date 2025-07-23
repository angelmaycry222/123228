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

async function fetchRecentTransfers(wallet) {
	const url = `https://api.helius.xyz/v0/addresses/${wallet}/transactions?api-key=${HELIUS_API_KEY}`
	try {
		const { data } = await axios.get(url)
		return data
			.filter(tx => tx.tokenTransfers?.length || tx.tokenBalanceChanges?.length)
			.flatMap(tx => {
				const changes = tx.tokenTransfers || tx.tokenBalanceChanges || []
				return changes.map(c => ({
					mint: c.mint,
					amount: c.tokenAmount || c.amount,
					type: c.tokenAmount > 0 || c.amount > 0 ? 'BUY' : 'SELL',
				}))
			})
	} catch (err) {
		console.error(
			`Error fetching tx for ${wallet}:`,
			err.response?.status || err.message
		)
		return []
	}
}

async function getTokenName(mint) {
	const url = `https://api.helius.xyz/v0/tokens/metadata?api-key=${HELIUS_API_KEY}`
	try {
		const { data } = await axios.post(url, { mintAccounts: [mint] })
		return data[0]?.onChainMetadata?.metadata?.name || 'Unknown'
	} catch {
		return 'Unknown'
	}
}

async function checkForMatches() {
	const tokenCounts = {}
	const tokenActions = {}
	for (const wallet of WATCHED_WALLETS) {
		const transfers = await fetchRecentTransfers(wallet)
		const unique = new Map()
		for (const t of transfers) {
			unique.set(t.mint, t.type)
		}
		for (const [mint, type] of unique) {
			tokenCounts[mint] = (tokenCounts[mint] || 0) + 1
			tokenActions[mint] = tokenActions[mint] || new Set()
			tokenActions[mint].add(type)
		}
	}

	for (const [mint, count] of Object.entries(tokenCounts)) {
		if (count >= 2 && !notifiedMints.has(mint)) {
			notifiedMints.add(mint)
			const name = await getTokenName(mint)
			const actions = Array.from(tokenActions[mint]).join(', ')
			bot
				.sendMessage(
					CHAT_ID,
					`🚨(HAUNTED MOUND EXCLUSIVE) ${count} wallets ${actions} token: ${mint} (${name})`
				)
				.catch(err => console.error('Telegram error:', err.message))
		}
	}
}

cron.schedule('*/15 * * * * *', async () => {
	await checkForMatches()
})

console.log('Watcher started. Monitoring buys and sells every 15 seconds.')
