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
// Для каждого mint — Set кошельков, которые купили и ещё не продали
const heldMints = {}

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
async function checkForMatches() {
	// Process each wallet's transfers and update heldMints
	for (const wallet of WATCHED_WALLETS) {
		const tr = await fetchTransfers(wallet)

		for (const { mint, type } of tr) {
			if (!heldMints[mint]) heldMints[mint] = new Set()

			if (type === 'BUY') {
				heldMints[mint].add(wallet)
			} else if (type === 'SELL') {
				heldMints[mint].delete(wallet)
			}
		}

		await sleep(1000) // mitigate rate limits
	}

	// Notify if two or more wallets currently hold the same mint
	for (const [mint, walletsSet] of Object.entries(heldMints)) {
		if (walletsSet.size >= 2 && !notifiedMints.has(mint)) {
			notifiedMints.add(mint)
			bot
				.sendMessage(
					CHAT_ID,
					`🚨 ${walletsSet.size} разных кошелька(ов) купили и ещё не продали токен ${mint}`
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
