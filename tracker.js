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

// Fetch tokens held by a given wallet; returns array of mint addresses
async function fetchWalletTokens(wallet) {
	const url = `https://api.helius.xyz/v0/addresses/${wallet}/tokens?api-key=${HELIUS_API_KEY}`
	try {
		const { data } = await axios.get(url)
		return data.map(t => t.mint)
	} catch (err) {
		if (err.response && err.response.status === 404) {
			console.warn(`No token data for wallet ${wallet}`)
			return []
		}
		console.error(`Error fetching tokens for ${wallet}:`, err.message)
		return []
	}
}

async function checkForMatches() {
	const tokenCounts = {}
	for (const wallet of WATCHED_WALLETS) {
		const tokens = await fetchWalletTokens(wallet)
		const unique = new Set(tokens)
		unique.forEach(mint => {
			tokenCounts[mint] = (tokenCounts[mint] || 0) + 1
		})
	}

	// Notify for any token held by 2 or more wallets
	Object.entries(tokenCounts).forEach(([mint, count]) => {
		if (count >= 2 && !notifiedMints.has(mint)) {
			notifiedMints.add(mint)
			bot
				.sendMessage(
					CHAT_ID,
					`🚨 Multiple wallets (${count}) hold token: ${mint}`
				)
				.catch(err =>
					console.error('Failed to send Telegram message:', err.message)
				)
		}
	})
}

// Check every 15 seconds
cron.schedule('*/15 * * * * *', async () => {
	console.log(new Date().toISOString(), 'Checking for common tokens...')
	await checkForMatches()
})

console.log('Watcher started. Checking every 15 seconds.')
