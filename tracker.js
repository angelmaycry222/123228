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

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: false })

const WATCHED_WALLETS = [
	'Wallet1PublicKey',
	'Wallet2PublicKey',
	'Wallet3PublicKey',
	'Wallet4PublicKey',
	'Wallet5PublicKey',
]

const HELIUS_API_KEY = process.env.HELIUS_API_KEY

const notifiedMints = new Set()

async function fetchWalletTokens(wallet) {
	const url = `https://api.helius.xyz/v0/addresses/${wallet}/tokens?api-key=${HELIUS_API_KEY}`
	const { data } = await axios.get(url)
	return data.map(t => t.mint)
}

async function checkForMatches() {
	const allTokens = []
	for (const wallet of WATCHED_WALLETS) {
		const tokens = await fetchWalletTokens(wallet)
		allTokens.push(new Set(tokens))
	}

	const commonTokens = [...allTokens[0]]
	for (let i = 1; i < allTokens.length; i++) {
		commonTokens = commonTokens.filter(token => allTokens[i].has(token))
	}

	for (const mint of commonTokens) {
		if (!notifiedMints.has(mint)) {
			notifiedMints.add(mint)
			await bot.sendMessage(
				CHAT_ID,
				`🚨 Multiple wallets bought token: ${mint}`
			)
		}
	}
}

cron.schedule('*/15 * * * * *', async () => {
	console.log('Checking for common tokens...')
	await checkForMatches()
})

console.log('Watcher started. Checking every 15 seconds.')
