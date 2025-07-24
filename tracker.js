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
	'HGj61NUgkzLpQ1d2KkrSFsjf6HJ9DVt2dfiMDFekWw3Y'
]

// State
const lastSignatures = {}
const notifiedMints = new Set()

// Utility sleep
a function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// Fetch and parse recent transfers for a wallet
async function fetchTransfers(wallet) {
  const pubkey = new PublicKey(wallet)
  // get recent signatures
  const opts = { limit: 20 }
  const signatures = await connection.getSignaturesForAddress(pubkey, opts)
  const transfers = []

  for (const { signature } of signatures) {
    if (lastSignatures[wallet] === signature) break
    const tx = await connection.getParsedTransaction(signature, 'confirmed')
    if (tx?.meta?.tokenBalances) {
      for (const balance of tx.meta.tokenBalances) {
        const mint = balance.mint
        const pre = Number(balance.uiTokenAmount.uiAmountString)
        const post = Number(balance.uiTokenAmount.uiAmountString.replace(/^/, ''))
        // Helius style: uiTokenAmount has pre and post? Instead use tx.meta.postTokenBalances and preTokenBalances
      }
    }
    // advanced: detect from preTokenBalances and postTokenBalances
    const preBalances = tx.meta.preTokenBalances || []
    const postBalances = tx.meta.postTokenBalances || []
    for (const post of postBalances) {
      const pre = preBalances.find(p => p.accountIndex === post.accountIndex)
      const delta = Number(post.uiTokenAmount.uiAmount) - Number(pre?.uiTokenAmount.uiAmount || 0)
      if (delta !== 0) {
        transfers.push({ mint: post.mint, type: delta > 0 ? 'BUY' : 'SELL' })
      }
    }
  }
  if (signatures.length) lastSignatures[wallet] = signatures[0].signature
  return transfers
}

// Main check function
async function checkForMatches() {
  const actionCounts = {}

  for (const wallet of WATCHED_WALLETS) {
    const transfers = await fetchTransfers(wallet)
    const unique = new Map()
    for (const t of transfers) unique.set(`${t.mint}|${t.type}`, t)

    for (const [, t] of unique) {
      if (!actionCounts[t.mint]) actionCounts[t.mint] = { count: 0, types: new Set() }
      actionCounts[t.mint].count++
      actionCounts[t.mint].types.add(t.type)
    }

    await sleep(500) // avoid rate limits
  }

  for (const [mint, info] of Object.entries(actionCounts)) {
    if (info.count >= 2 && !notifiedMints.has(mint)) {
      notifiedMints.add(mint)
      const types = Array.from(info.types).join(', ')
      bot
        .sendMessage(
          CHAT_ID,
          `🚨 (H-H-HAUNTAHOLICS REAL HAUNTED MOUND) ${info.count} wallets ${types} token: ${mint}`
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
