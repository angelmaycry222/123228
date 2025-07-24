import { Connection, PublicKey } from '@solana/web3.js'
import TelegramBot from 'node-telegram-bot-api'
import cron from 'node-cron'

// Environment variables
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN
const CHAT_ID = process.env.CHAT_ID
const QUICKNODE_RPC = process.env.QUICKNODE_RPC

// Initialize Telegram bot and Solana connection
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: false })
const connection = new Connection(QUICKNODE_RPC, 'confirmed')

// Watched wallets
const WATCHED_WALLETS = [
	'Ab2LKcStUSNCxbZ2RKeEyCz1nrKw3AgKBjYMrgsaRdtN',
	'8N4vAeG7sYLHjnaADggH2nkbWDwTXEnEeJRRrHKX6fuj',
	'6TbHffE6GxcGp536avxZpNMEd8uKp2EoP2egAeWWbonk',
	'4zLnAxHtXFqSccSX4kYunfoK6UjbP1gx62ZyycPX7Wi7',
	'7FREb7zknSCCq5p8tbaD7EkfgmDvaJ4Jawq2o67VFRcC',
	'AtFS2W1dMWX2oBef9dJ3gSx5VKXfzqvasbY1iMWAMxGT',
	'HfqckzgVY2L16qYd1W5m674jBFt5jLGNW7iksKFLMJaf',
	'FjFvvt381a9eJccuCMxVXRmJBm33rMkZGUy7ghk8rFpV',
	'7eEeUwRu8VXZNcjfWkPPoz4Vcf62n2WjBNCxdFTE2XF',
	'HGj61NUgkzLpQ1d2KkrSFsjf6HJ9DVt2dfiMDFekWw3Y',
]

// State
const lastSignatures = {}
const notifiedMints = new Set()

// Utility sleep
function sleep(ms) {
	return new Promise(resolve => setTimeout(resolve, ms))
}

// Fetch and parse recent transfers for a wallet
async function fetchTransfers(wallet) {
	const pubkey = new PublicKey(wallet)
	const sigInfos = await connection.getSignaturesForAddress(pubkey, {
		limit: 20,
	})
	const transfers = []

	for (const { signature } of sigInfos) {
		if (lastSignatures[wallet] === signature) break

		// <-- вот эта строка изменена -->
		const tx = await connection.getParsedTransaction(signature, {
			commitment: 'confirmed',
			maxSupportedTransactionVersion: 0,
		})

		if (tx?.meta) {
			const pre = tx.meta.preTokenBalances || []
			const post = tx.meta.postTokenBalances || []
			for (const p of post) {
				const prev = pre.find(x => x.accountIndex === p.accountIndex)
				const delta =
					Number(p.uiTokenAmount.uiAmount) -
					Number(prev?.uiTokenAmount.uiAmount || 0)
				if (delta !== 0) {
					transfers.push({ mint: p.mint, type: delta > 0 ? 'BUY' : 'SELL' })
				}
			}
		}
	}

	if (sigInfos.length) lastSignatures[wallet] = sigInfos[0].signature
	return transfers
}

// Main check function
// Main check function
async function checkForMatches() {
	const actionCounts = {}

	for (const wallet of WATCHED_WALLETS) {
		const tr = await fetchTransfers(wallet)
		// Оставляем только покупки
		const buys = tr.filter(t => t.type === 'BUY')
		// Уникальные минты (на случай, если один кошелёк купил токен дважды)
		const uniqueBuys = new Set(buys.map(t => t.mint))

		for (const mint of uniqueBuys) {
			if (!actionCounts[mint]) {
				actionCounts[mint] = {
					wallets: new Set(),
				}
			}
			actionCounts[mint].wallets.add(wallet)
		}

		await sleep(1000) // mitigate rate limits
	}

	for (const [mint, info] of Object.entries(actionCounts)) {
		// Если купили как минимум два разных кошелька
		if (info.wallets.size >= 2 && !notifiedMints.has(mint)) {
			notifiedMints.add(mint)
			bot
				.sendMessage(
					CHAT_ID,
					`🚨 (H-H-HAUNTAHOLICS REAL HAUNTED MOUND) ${info.wallets.size} разных кошелька купили токен ${mint}`
				)
				.catch(err => console.error('Telegram error:', err.message))
		}
	}
}

// Schedule every minute
cron.schedule('*/60 * * * * *', async () => {
	console.log(new Date().toISOString(), 'Checking with QuickNode RPC...')
	await checkForMatches()
})

console.log('Watcher started using QuickNode RPC.')
