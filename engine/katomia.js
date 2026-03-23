// katomia / gameManager

const { elog, eclog } = require('./elog')

const { 
	Ctx,
	seedAssets,
	getAssetsForAccount,
	checkJoinRule,
	incr,   						 //none
	resetLocksIfNeeded,  //none
	assignPlayerColour,  //-> colourPalette
	isValidAccountLabel,  //none	

} = require('./katomiaHelpers')


const {
    computePchFromDeal,
  
} = require('./kpoolHelpers')


const {
    offer,
    reject,
    withdraw,
    //toggleLock,
    exitGame,
		addAccount,
		removeAccount,
} = require('./katomiaActions')


// =========================
// GAME CORE
// Core game lifecycle, storage, and basic metadata access.
// =========================

// createGame
// generateGameId
// getGames
// getGame
// getGameMeta
// getState
// touch

const games = {}

function createGame(input={}){

  let game = {
    id: generateGameId(),
    network: "playnet",
    visibility: "unlisted",
    joinRule: "*",
    lockRule: "cluster",
    players: {},
    accounts: {},
		txPending: {},
    nextPlayerRef: 1,
		
    config: {},
    profile: {},
    permissions: {},
    economy: {}		
  }

  Object.assign(game, input)
  game.network = normaliseNetwork(game.network)
	
	while(games[game.id]) game.id = generateGameId()  // defend against collision - retry if needed

  games[game.id] = game
  return game
}


/* todo for later consider...

config: {
  maxPlayers: 10,
  turnTime: 60,
  scoring: "standard"
}


profile: {
  name,
  description,
  thumbnail,
  icon,
  tags,
  createdBy,
  createdAt
}

permissions: {
  admins: [],
  moderators: [],
  allowSpectators: true,
  allowChat: true,
  allowJoin: true
}

permissions: {
  join: "*",
  kick: ["admin","moderator"],
  ban: ["admin"]
}
*/

function generateGameId(len = 6){

  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
  let id = ""

  for(let i=0;i<len;i++)
    id += chars[Math.floor(Math.random() * chars.length)]

  return id
}

function zzgenerateGameId(){

  // const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ"
  const digits = "123456789"

  let id = "KAT"

  // for(let i=0;i<3;i++)
    // id += letters[Math.floor(Math.random() * letters.length)]

  for(let i=0;i<5;i++)
    id += digits[Math.floor(Math.random() * digits.length)]

  return id
}

// base62 id generator (youtube-style)
function zzgenerateGameId(len = 12){

  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"
  let id = ""

  for(let i=0;i<len;i++)
    id += chars[Math.floor(Math.random() * chars.length)]

  return id
}

createGame({id: "demo-playnet",     network: "playnet", visibility: "public", joinRule: "*"})
createGame({id: "demo-testnet",     network: "testnet", visibility: "private", joinRule: "*"})
createGame({id: "demo-mainnet",     network: "mainnet", visibility: "public", joinRule: "*"})

createGame({id: "demo-private",	   network: "playnet", visibility: "private",
		joinRule: { rule:"accountIdRange", params:[0,500000] }})

createGame({id: "demo-unlisted",   network: "playnet", visibility: "unlisted",
		joinRule: { rule:"accountIdRange", params:[0,200000] }})



function getGames(){
  const out = {}
  for(const id in games) out[id] = getGameMeta(id)
  return out
}

function getGame(id){
  return games[id] || null
}


function getGameMeta(gameId) {
    const game = games[gameId]
    if (!game) return null

		elog(game, `getGameMeta for ${gameId}`, 'katomia')
		// return {...game} // reveals too much eg player tokens
    return {
        id: game.id,
        network: game.network,
				visibility: game.visibility,
				joinRule: game.joinRule,
        lockRule: game.lockRule
    }
}


function joinGame(gameId, playerToken, playerName){

		const game = games[gameId] 
		// const game = ctx.game

		if(!game) return

    if(!game.players[playerToken]){
        game.players[playerToken] = {
            id: playerToken,
            name: playerName || "anon",
            accounts: [],
            colour: assignPlayerColour(game, playerToken),
            publicId: "p" + game.nextPlayerRef++,
						events: {}
        }
    }
    else{
        game.players[playerToken].name = playerName || game.players[playerToken].name || "anon"
    }
		touch(gameId, playerToken)
    return game
}




function getTxPending(game) {
    const pending = []
		for (let [pch, rec] of Object.entries(game.txPending)) {
				pending.push({
					txid: rec.txid,
					txhex: rec.hex2,
					pch: rec.deal?.pch,
					pchbasis: rec.deal?.pchbasis,
					lifecycle: rec.lifecycle,
				})
						
		}
		elog(pending, `pending gameId=${game.id}`, "dev16")
		return pending
}

function getState(gameId) {

    const game = games[gameId]
    if (!game) return

    const players = {}
    const accounts = {}

    // ---- build account view (new canonical state)
		for (const account of Object.values(game.accounts)) {

				const player = game.players[account.playerToken]
				if (!player) continue

				const publicAccountId = player.publicId + ":" + account.label

				accounts[publicAccountId] = {
						id: publicAccountId,
						label: account.label,
						playerId: player.publicId,
						playerName: player.name,
						colour: player.colour || null,

						assets: account.assets,
						basket: account.basket.map(item => {
								const fromAccount = game.accounts[item.from]
								if (!fromAccount) {
										return {
												assetId: item.assetId,
												amount: item.amount || 1,
												fromId: null
										}
								}

								const fromPlayer = game.players[fromAccount.playerToken]
								const publicFromId = fromPlayer.publicId + ":" + fromAccount.label

								return {
										assetId: item.assetId,
										amount: item.amount || 1,
										fromId: publicFromId
								}
						}),
						mode: account.mode
				}
		}


    // ---- build legacy player view (first account only)
    for (const [playerId, player] of Object.entries(game.players)) {

				const account = game.accounts[player.accounts[0]] || { assets: {}, basket: [], mode: "shop" }

				players[player.publicId] = {
						id: player.publicId,
						name: player.name,
						colour: player.colour || null,
            account: account.assets,
            basket: account.basket,
            mode: account.mode
        }
    }


		const tx = {}
		tx.pending = getTxPending(game)
		

    return {
        players,   // old frontend
        accounts,   // new frontend
				tx
    }
}

/*
Event telemetry per player:

events[type] = {
  first            // first occurrence timestamp
  last             // most recent occurrence timestamp
  count            // total events observed
  minInterval      // smallest observed gap between events
  avgIntervalEMA   // exponential moving average of seconds between events
}

avgIntervalEMA tracks recent activity rate and reacts quickly to bursts.
minInterval captures the fastest observed interaction and helps detect
automation or bot-like behaviour without storing full event logs.
*/
function touch(gameId, playerToken, type="seen"){
    const player = games[gameId]?.players[playerToken]
    if(!player) return

    const ts = Date.now()
    player.events ||= {}

    const e = player.events[type] ||= { first: ts, last: ts, count: 0, avgIntervalEMA: 0, minInterval: Infinity  }

    const interval = (ts - e.last) / 1000

    if(e.count > 0){
        const alpha = 0.2
        e.avgIntervalEMA = e.avgIntervalEMA
            ? e.avgIntervalEMA + alpha * (interval - e.avgIntervalEMA)
            : interval
				
				if(interval < e.minInterval) e.minInterval = interval
    }

    e.count++
    e.last = ts
}




// =========================
// TRADE ENGINE & SETTLEMENT
// Graph building, cluster detection, and settlement execution.
// =========================

// getTradeClusters
// buildTradeGraph
// findConnectedComponents
// getActiveAccounts
// isClusterLocked
// anyLockedTradingCircle

// attemptSettlement
// getLockedClusters
// getActiveMegaCluster
// allLocked
// allActiveAccountsAreLocked

// postClusters
// postCluster
// resolveTxSuccess
// resolveTxFailed


function getTradeClusters(game){

    const graph = {}

    for(const account of Object.values(game.accounts))
        graph[account.id] = new Set()

    for(const account of Object.values(game.accounts)){
        for(const item of account.basket){
            graph[account.id].add(item.from)
            graph[item.from]?.add(account.id)
        }
    }

    const visited = new Set()
    const clusters = []

    for(const id of Object.keys(graph)){

        if(visited.has(id)) continue

        const stack = [id]
        const component = []

        while(stack.length){

            const node = stack.pop()
            if(visited.has(node)) continue

            visited.add(node)
            component.push(node)

            for(const n of graph[node])
                if(!visited.has(n))
                    stack.push(n)
        }

        clusters.push(component)
    }

    return clusters
}

function isClusterLocked(game, cluster){ // true if all nodes (accounts) are locked

    const active = getActiveAccounts(game)

    const activeMembers = cluster.filter(id => active.has(id))

    if(activeMembers.length === 0)
        return false

    return activeMembers.every(id => {
        const acc = game.accounts[id]
        return acc && acc.mode === "lock"
    })
}


function getActiveAccounts(game){

    const active = new Set()

    for(const account of Object.values(game.accounts)){

        if(account.basket.length > 0)
            active.add(account.id)

        for(const item of account.basket)
            active.add(item.from)
    }

    return active
}




async function toggleLock(ctx, {accountId}) {
		const { game, playerToken } = ctx

    const account = ctx.getAccount(accountId)
    if (!account) return
		
		if (!ctx.canActOnAccount(account)) return

    account.mode = account.mode === "shop" ? "lock" : "shop"

		await attemptSettlement(game)

    return game
}


async function attemptSettlement(game){

  const clusters = getTradeClusters(game)
  let outputClusters = []

  switch(game.lockRule){

    case "cluster":
      outputClusters = getLockedClusters(game, clusters)
      break

    case "active":
      if(!allActiveAccountsAreLocked(game)) return
      outputClusters = getActiveMegaCluster(game, clusters)
      break

    case "all":
      if(!allLocked(game)) return
      outputClusters = getActiveMegaCluster(game, clusters)
      break

    default:
      return
  }

  if(!outputClusters.length) return

 await postClusters(game, outputClusters)
}


function getLockedClusters(game, clusters){

  const out = []

  for(const cluster of clusters)
    if(isClusterLocked(game, cluster))
      out.push(cluster)

  return out
}


function allLocked(game) {   // yes it is used 

    return Object.values(game.accounts)
        .every(a => a.mode === "lock")
}

function allActiveAccountsAreLocked(game) {
    const accounts = Object.values(game.accounts)
    const active = new Set()

    // accounts receiving assets
    for (const account of accounts) {
        if (account.basket.length > 0)
            active.add(account.id)
        for (const item of account.basket)
            active.add(item.from)
    }

    // if nobody is active, do nothing
    if (active.size === 0) return false

    // check only active accounts
    for (const id of active) {
        const account = game.accounts[id]
        if (!account || account.mode !== "lock")
            return false
    }

    return true
}


function getActiveMegaCluster(game, clusters){

  const active = getActiveAccounts(game)
  const mega = []

  for(const cluster of clusters)
    if(cluster.some(id => active.has(id)))
      mega.push(...cluster)

  return mega.length ? [mega] : []
}


async function postClusters(game, clusters){
  for(const cluster of clusters){
    elog(game, "before postCluster", "dev12")
    const pchShort = await postCluster(game, cluster)
    elog(game, `pchShort=${pchShort} after postCluster`, "dev12")
		
    // resolveTxSuccess(game, pchShort)
    // resolveTxFailed(game, txid)
    elog(game, "after resolve", "dev12")
  }
}

// hook to kpool - temp placeholder
if(0) global.zzzkatomiaOnTxResult = ({ txid, pch, status }) => {
	// note this wont pick up expired.. a separate polling is needed to cleanup expired txPending
	// using eg kpool/txRead?network=mainnet&txid=0.0.10177400@1773827521.166751072
	// "comboStatus": "Expired",
	// "isStatusFinal": true,
	
	elog({txid, pch, status}, `resolveTx status = ${status} txid pch= ${txid} ${pch}`, "dev16")
/*
resolveTx status = SUCCESS txid pch= 0.0.10177400@1773828796.739432082 e560c6
{
  "txid": "0.0.10177400@1773828796.739432082",
  "pch": "e560c6",
  "status": "SUCCESS"
}
*/
	
  for(const game of Object.values(games)){
    const pending = game.txPending[pch?.slice(0,6)]
    if(!pending) continue
		
    if(status === "SUCCESS")
      resolveTxSuccess(game, pch.slice(0,6))
    else
      resolveTxFailed(game, pch.slice(0,6))
  }
}

global.katomiaOnTxResult = ({ txid, pch, status, isFinalStatus }) => {
	elog({txid, pch, status, isFinalStatus}, `resolveTx status = ${status} txid pch= ${txid} ${pch}`, "dev16")

	const pchShort = pch?.slice(0, 6)
	if (!pchShort) return

	for (const game of Object.values(games)) {
		const pending = game.txPending[pchShort]
		if (!pending) continue

		patchTxLifecycle(game, pchShort, {
			status: status || pending.lifecycle?.status || 'pending',
			isFinalStatus: Boolean(isFinalStatus)
		})

		const statusNorm = String(status || '').toUpperCase()

		elog({statusNorm, pchShort, txid, hasPending: !!pending}, 'status check', 'dev16')
		if (statusNorm === 'SUCCESS') {
			resolveTxSuccess(game, pchShort)
			continue
		}

		if (isFinalStatus) {
			resolveTxFailed(game, pchShort)
		}
	}
}

function patchTxLifecycle(game, pch, patch = {}) {
	const rec = game.txPending[pch]
	if (!rec) return null

	rec.lifecycle ||= {
		status: 'pending',
		isFinalStatus: false,
		lastUpdated: Date.now()
	}

	Object.assign(rec.lifecycle, patch, {
		lastUpdated: Date.now()
	})

	return rec
}

function resolveTxSuccess(game, pch) {
	const pending = game.txPending[pch]
	if (!pending?.raw) return

	patchTxLifecycle(game, pch, {
		status: 'SUCCESS',
		isFinalStatus: true
	})

	for (const item of pending.raw) {
		const to = game.accounts[item.to]
		if (!to) continue
		incr(to.assets, item.assetId, item.amount)
	}

	elog(game.txPending[pch], `resolveTxSuccess pch=${pch}`, "dev16")
	delete game.txPending[pch]
}

function resolveTxFailed(game, pch) {
	const pending = game.txPending[pch]
	if (!pending?.raw) return

	patchTxLifecycle(game, pch, {
		status: pending.lifecycle?.status || 'FAILED',
		isFinalStatus: true
	})

	for (const item of pending.raw) {
		const owner = game.accounts[item.from]
		if (!owner) continue
		incr(owner.assets, item.assetId, item.amount)
	}

	elog(game.txPending[pch], `resolveTxFailed pch=${pch}`, "dev16")
	delete game.txPending[pch]
}

const { dealCreateTx } = require('./deal')
const { initializeClient } = require('./functions')

async function postCluster(game, cluster){
    const clusterSet = new Set(cluster)
    const rawLines = []

    for(const accountId of cluster){
        const account = game.accounts[accountId]
        if(!account) continue
        const remaining = []

        for(const item of account.basket){
            if(clusterSet.has(item.from))
                rawLines.push({
                    to: account.id,
                    from: item.from,
                    assetId: item.assetId,
                    amount: item.amount || 1
                })
            else remaining.push(item)
        }
        account.basket = remaining
        account.mode = "shop"
    }

    if(!rawLines.length) return null
		
		
    // const txid = shortHash(JSON.stringify(rawLines))
				
		// const raw = game.txPending[txid].raw
		const deal = buildDealFromRaw(game, rawLines)
		elog(deal, 'KATOMIA DEAL BEFORE PCH ZXXXXXXXXXXXXXXXXXXXXXXXXX', 'devPCH')
		const { pch, pchbasis } = computePchFromDeal(deal)

		// attach (non-mutating style if you want, but keep it simple)
		deal.pch = pch
		deal.pchbasis = pchbasis

		const pchShort = pch.slice(0,6)

		// elog({rawLines, rawDeal,deal}, "xxxxxxxxxxxxx", "dev15")
		//shoudl we use pch as the key? what if same tx intent is tried more than once at different times? 
		// could eb a spanner.. try it
		
		const body = {deal, kpool: true}
		const query = {}
		
		let txid
		let dealRes
		if (game.network == 'playnet') {
			txid = 'n/a for playnet'
			dealRes = 'n/a for playnet'
			
		} else {
			const client = initializeClient(game.network)
			dealRes = await dealCreateTx(client, {body, query})
			txid = dealRes.txid
			
		}
		
		const now = Date.now()

		const lifecycle = {status: 'pending', isFinalStatus: false, lastUpdated: now}
		game.txPending[pchShort] =  {txid, raw: rawLines, deal, dealRes, lifecycle, createdAt: now}

		//for now just recolve playnet instantly
		if (game.network == 'playnet') resolveTxSuccess(game, pchShort)
			
		
		// deal.pch ||= shortHash(JSON.stringify(rawLines))  // aim to have this set upfront 
    
    return pchShort

}

/*  buildDealFromRaw
		eg convert these 2 raw lines...
      "raw": [
        {
          "to": "a9f0ec6c-ad8f-4244-8f21-b510c9856b90:0.0.333",
          "from": "a9f0ec6c-ad8f-4244-8f21-b510c9856b90:0.0.25200",
          "assetId": "0.0.456858",
          "amount": 1000000
        },
        {
          "to": "a9f0ec6c-ad8f-4244-8f21-b510c9856b90:0.0.345",
          "from": "a9f0ec6c-ad8f-4244-8f21-b510c9856b90:0.0.25200",
          "assetId": "0.0.1263996#8",
          "amount": 1
        },
				
			into 3 transfer lines on hedera

        "addTokenTransfer": [
            {
                "tokenId": "0.0.456858",
                "accountId": "0.0.25200",
                "value": "-1000000"
            },            
						{
                "tokenId": "0.0.456858",
                "accountId": "0.0.333",
                "value": "1000000"
            },
       "addNftTransfer": [
            {
                "tokenId": "0.0.1263996",
                "serial": "8",
                "sender": "0.0.25200",
                "receiver": "0.0.345",
            }
*/		

function buildDealFromRaw(game, rawLines){

  const deal = {
		display: {thumbnail:'https://tools.gomint.me/files/84863a4b4ccbff83c10a9b0d47f705096dbd5e09097f988c18c53cc9674a3c06.png'},
    network: game.network,
    addHbarTransfer: [],
    addTokenTransfer: [],
    addNftTransfer: []
  }

  const ftMap = {}
  const hbarMap = {}

  for(const line of rawLines){

    const from = line.from.split(":")[1]
    const to   = line.to.split(":")[1]
    const { assetId, amount } = line

    if(assetId.includes("#")){
      const [tokenId, serial] = assetId.split("#")

      deal.addNftTransfer.push({
        tokenId,
        serial: Number(serial),
        sender: from,
        receiver: to
      })
      continue
    }

    if(assetId === "hbar"){
      hbarMap[from] ||= 0
      hbarMap[to]   ||= 0

      hbarMap[from] -= amount
      hbarMap[to]   += amount
      continue
    }

    const tokenId = assetId

    ftMap[tokenId] ||= {}
    ftMap[tokenId][from] ||= 0
    ftMap[tokenId][to]   ||= 0

    ftMap[tokenId][from] -= amount
    ftMap[tokenId][to]   += amount
  }

  // flatten FT
  for(const tokenId in ftMap){
    for(const accountId in ftMap[tokenId]){
      const value = ftMap[tokenId][accountId]
      if(!value) continue
      deal.addTokenTransfer.push({ tokenId, accountId, value })
    }
  }

  // flatten HBAR
  for(const accountId in hbarMap){
    const value = hbarMap[accountId]
    if(!value) continue
    deal.addHbarTransfer.push({ accountId, value })
  }

  return deal
}

/*
shape that dealSignEscrow expects:

{
  deal: {
    header: {
      network: "testnet" | "mainnet" | "previewnet",
      dealOperator?: "0.0.x"
    },

    addHbarTransfer: [
      { accountId: "0.0.x", value: number }   // + / -
    ],

    addTokenTransfer: [
      { tokenId: "0.0.x", accountId: "0.0.x", value: number } // + / -
    ],

    addNftTransfer: [
      {
        tokenId: "0.0.x",
        serial: number,
        sender: "0.0.x",
        receiver: "0.0.x",
        spender?: "0.0.x" // optional (for allowance)
      }
    ]
  },

  memo?: "string",
  operatorId?: "0.0.x",   // fallback if not in deal.header
  kpool?: true,           // you WANT this true
  submit?: false          // default false → goes to kpool
}



*/
const crypto = require('crypto')


function shortHash(str){
    let h = 0
    for(let i=0;i<str.length;i++)
        h = (h*31 + str.charCodeAt(i)) | 0
    return Math.abs(h).toString(36)
}



function buildTradeGraph(game){

    const graph = {}

    for(const account of Object.values(game.accounts))
        graph[account.id] = new Set()

    for(const account of Object.values(game.accounts)){
        for(const item of account.basket){
            graph[account.id].add(item.from)
            graph[item.from]?.add(account.id)
        }
    }

    return graph
}


function findConnectedComponents(graph){

    const visited = new Set()
    const components = []

    for(const start of Object.keys(graph)){

        if(visited.has(start)) continue

        const stack = [start]
        const component = []

        while(stack.length){
            const node = stack.pop()
            if(visited.has(node)) continue

            visited.add(node)
            component.push(node)

            for(const n of graph[node])
                if(!visited.has(n))
                    stack.push(n)
        }

        components.push(component)
    }

    return components
}

function anyLockedTradingCircle(game){

    const graph = buildTradeGraph(game)
    const components = findConnectedComponents(graph)

    for(const component of components){

        const active = component.filter(id => {
            const acc = game.accounts[id]
            return acc && acc.basket.length > 0 ||
                   Object.values(game.accounts).some(a =>
                       a.basket.some(i => i.from === id)
                   )
        })

        if(active.length === 0)
            continue

        const allLocked = active.every(id => {
            const acc = game.accounts[id]
            return acc && acc.mode === "lock"
        })

        if(allLocked)
            return true
    }

    return false
}




// =========================
// VALIDATION & HELPERS
// Shared helpers for validation, IDs, accounts, and asset seeding.
// =========================

// isValidNetwork
// normaliseNetwork

// assignPlayerColour
// defaultAccountLabel
// seedAssets
// getAssetsForAccount
// isValidPlayerToken
// getPlayerProfile





function isValidNetwork(network) {
    return network === "playnet" || network === "testnet" || network === "mainnet"
}

function normaliseNetwork(network) {
    return isValidNetwork(network) ? network : "playnet"
}





// function defaultAccountId(playerId) {
    // return playerId + ":default"
// }

function defaultAccountLabel() {
    return "default"
}





module.exports = {
		games,
		resolveTxSuccess,
		resolveTxFailed,
		
    //for api
		createGame,
		getGames, 
		getGame,
		
		//for websocket
		joinGame,
    offer,
    reject,
    withdraw,
    toggleLock,
    exitGame,
    getState,
		getTxPending,
		
		addAccount,
		removeAccount,
		getGameMeta,
		touch
}

// module.exports.games = games
// module.exports.resolveTxSuccess = resolveTxSuccess
// module.exports.resolveTxFailed = resolveTxFailed
