import axios from 'axios'
import TelegramBot from 'node-telegram-bot-api'
import cron from 'node-cron'

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN
const CHAT_ID = process.env.CHAT_ID
const HELIUS_API_KEY = process.env.HELIUS_API_KEY

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: false })
// Отслеживаемые кошельки
const WATCHED_WALLETS = [
	'Ab2LKcStUSNCxbZ2RKeEyCz1nrKw3AgKBjYMrgsaRdtN',
	'8N4vAeG7sYLHjnaADggH2nkbWDwTXEnEeJRRrHKX6fuj',
	'6TbHffE6GxcGp536avxZpNMEd8uKp2EoP2egAeWWbonk',
	'4zLnAxHtXFqSccSX4kYunfoK6UjbP1gx62ZyycPX7Wi7',
	'7FREb7zknSCCq5p8tbaD7EkfgmDvaJ4Jawq2o67VFRcC',
	'AtFS2W1dMWX2oBef9dJ3gSx5VKXfzqvasbY1iMWAMxGT',
	'HfqckzgVY2L16qYd1W5m674jBFt5jLGNW7iksKFLMJaf',
	'FjFvvt381a9eJccuCMxVXRmJBm33rMkZGUy7ghk8rFpV',
]

// Храним последний просмотренный подпись для каждого кошелька
const lastSignatures = {}
const notifiedMints = new Set()

// Batch fetch transactions for all wallets
async function fetchRecentTxBatch() {
	const url = `https://api.helius.xyz/v0/addresses/transactions?api-key=${HELIUS_API_KEY}`
	try {
		const { data } = await axios.post(url, { addresses: WATCHED_WALLETS })
		return data // объект { address: [tx...] }
	} catch (err) {
		console.error('Batch fetch error:', err.response?.status || err.message)
		return {}
	}
}

// Извлекаем переводы токенов (mint, amount, type)
function parseTransfers(txList, wallet) {
	const sinceSig = lastSignatures[wallet]
	const newTransfers = []
	for (const tx of txList) {
		if (sinceSig && tx.signature === sinceSig) break // уже видели дальше
		if (tx.tokenTransfers?.length) {
			for (const t of tx.tokenTransfers) {
				newTransfers.push({
					mint: t.mint,
					amount: t.amount, // положительное при зачислении
					type: Number(t.amount) > 0 ? 'BUY' : 'SELL',
				})
			}
		}
	}
	if (txList.length) lastSignatures[wallet] = txList[0].signature
	return newTransfers
}

// Получаем название токена
const tokenNameCache = {}
async function getTokenName(mint) {
	if (tokenNameCache[mint]) return tokenNameCache[mint]
	const url = `https://api.helius.xyz/v0/tokens/metadata?api-key=${HELIUS_API_KEY}`
	try {
		const { data } = await axios.post(url, { mintAccounts: [mint] })
		const name = data[0]?.onChainMetadata?.metadata?.name || mint
		tokenNameCache[mint] = name
		return name
	} catch {
		return mint
	}
}

// Основная проверка
async function checkForMatches() {
	const batchData = await fetchRecentTxBatch()
	const actionCounts = {}

	for (const wallet of WATCHED_WALLETS) {
		const txs = batchData[wallet] || []
		const transfers = parseTransfers(txs, wallet)
		// Уникально по mint+type
		const unique = new Map()
		for (const tr of transfers) unique.set(`${tr.mint}|${tr.type}`, tr)

		for (const [key, tr] of unique) {
			const { mint, type } = tr
			actionCounts[mint] = actionCounts[mint] || { count: 0, types: new Set() }
			actionCounts[mint].count++
			actionCounts[mint].types.add(type)
		}
	}

	// Уведомляем о токенах с count>=2
	for (const [mint, info] of Object.entries(actionCounts)) {
		if (info.count >= 2 && !notifiedMints.has(mint)) {
			notifiedMints.add(mint)
			const types = Array.from(info.types).join(', ')
			const name = await getTokenName(mint)
			bot
				.sendMessage(
					CHAT_ID,
					`🚨 ${info.count} wallets ${types} token ${name} (${mint})`
				)
				.catch(err => console.error('Telegram error:', err.message))
		}
	}
}

// Cron раз в минуту
cron.schedule('*/30 * * * * *', async () => {
	console.log(new Date().toISOString(), 'Batch checking wallets...')
	await checkForMatches()
})

console.log('Watcher started. Batch mode, checking every minute.')
