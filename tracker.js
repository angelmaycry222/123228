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

// Храним последнюю подпись
const lastSignatures = {}
const notifiedMints = new Set()

// Задержка между запросами к API (мс)
const REQUEST_DELAY = 500

// Функция задержки
function sleep(ms) {
	return new Promise(res => setTimeout(res, ms))
}

// Получаем транзакции одного кошелька, ограничиваем количеством, с retry при 429
async function fetchWalletTx(wallet) {
	const url = `https://api.helius.xyz/v0/addresses/${wallet}/transactions?limit=20&api-key=${HELIUS_API_KEY}`
	try {
		const { data } = await axios.get(url)
		return data
	} catch (err) {
		const status = err.response?.status
		console.error(`Error fetching tx for ${wallet}:`, status || err.message)
		if (status === 429) {
			console.warn(`Rate limited for ${wallet}, retrying after delay...`)
			await sleep(REQUEST_DELAY * 10) // 5 сек
			try {
				const { data: retryData } = await axios.get(url)
				return retryData
			} catch (retryErr) {
				console.error(
					`Retry failed for ${wallet}:`,
					retryErr.response?.status || retryErr.message
				)
			}
		}
		return []
	}
}

// Парсим новые токен-трансферы
function parseNewTransfers(txs, wallet) {
	const since = lastSignatures[wallet]
	const newList = []
	for (const tx of txs) {
		if (since && tx.signature === since) break
		if (tx.tokenTransfers?.length) {
			tx.tokenTransfers.forEach(t =>
				newList.push({
					mint: t.mint,
					type: Number(t.amount) > 0 ? 'BUY' : 'SELL',
				})
			)
		}
	}
	if (txs.length) lastSignatures[wallet] = txs[0].signature
	return newList
}

// Кеш названий
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

// Проверяем пересечения
async function checkForMatches() {
	const actionCounts = {}

	for (const wallet of WATCHED_WALLETS) {
		const txs = await fetchWalletTx(wallet)
		const transfers = parseNewTransfers(txs, wallet)
		const unique = new Map()
		transfers.forEach(t => unique.set(`${t.mint}|${t.type}`, t))

		unique.forEach(t => {
			actionCounts[t.mint] = actionCounts[t.mint] || {
				count: 0,
				types: new Set(),
			}
			actionCounts[t.mint].count++
			actionCounts[t.mint].types.add(t.type)
		})

		await sleep(REQUEST_DELAY)
	}

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

// Запуск раз в 30 секунд
cron.schedule('*/30 * * * * *', async () => {
	console.log(new Date().toISOString(), 'Checking wallets sequentially...')
	await checkForMatches()
})

console.log('Watcher started. Sequential mode, checking every 30s.')
