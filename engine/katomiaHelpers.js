

const { elog, eclog } = require('./elog')

const messagePool = {}


// 👉 ctx = (game, playerToken)
// “the current player’s perspective inside a specific game”
// Session = (Game × Player)
// So every method is answering:
// “from THIS player, in THIS game…”

class Ctx {
	constructor(game, playerToken){
		this.game = game
		this.gameId = game.id
		this.playerToken = playerToken
	}

	getPlayerToken(){
		return this.playerToken || null
	}

	getPlayerId(playerToken=this.playerToken){
		const player = this.game.players[playerToken]
		return player?.publicId || null
	}

	getAccount(id){
		return getAccount(this.game, id)  //external see below
	}

	canActOnAccount(account){
		if(!account) return false
		if(account.playerToken === this.playerToken) return true // default rule (today)
		// if(account.open === true) return true // future: hippie mode
		//if(account.delegates?.includes(this.playerToken)) // future: delegation
		return false
	}

  // --- core push ---
  push(type, recipients, message){
		const sender = this.getPlayerId()
		
    if(!Array.isArray(recipients))
      recipients = [recipients]

    messagePool[this.gameId] ||= {}

    for(const token of recipients){
      if(!token) continue

      messagePool[this.gameId][token] ||= {}
      messagePool[this.gameId][token][type] ||= []

      messagePool[this.gameId][token][type].push({ type, message, sender })
    }
  }

  // --- wrappers ---
  send(recipients, payload){
    this.push("event", recipients, payload)
  }

  warn(msg){
    this.push("warning", this.playerToken, msg)
  }

  err(msg){
    this.push("error", this.playerToken, msg)
  }

  // --- pull ---
  pullMessages(type){
    const gameBucket = messagePool[this.gameId]
    if(!gameBucket) return []

    const bucket = gameBucket[this.playerToken]
    if(!bucket) return []

    if(!type){
      const out = []
      for(const t in bucket)
        out.push(...bucket[t])

      delete gameBucket[this.playerToken]
      return out
    }

    const out = bucket[type] || []
    delete bucket[type]

    if(!Object.keys(bucket).length)
      delete gameBucket[this.playerToken]

		//cleanup
		if(!Object.keys(gameBucket).length)
			delete messagePool[this.gameId]

    return out
  }
}


function getAccount(game, id) {

    if (game.accounts[id]) {
        return game.accounts[id]
    }

    const byPublicId = Object.values(game.accounts).find(account => {
        const player = game.players[account.playerToken]
        if (!player) return false

        const publicAccountId = player.publicId + ":" + account.label
        return publicAccountId === id
    })

    if (byPublicId) return byPublicId

    const player = Object.values(game.players).find(player =>
        player.publicId === id
    )
    if (!player) return null

    const accountId = player.accounts[0]
    return game.accounts[accountId]
}





const { getTokensForAccountFromMirror } = require('./kpoolHelpers')


// =========================
// JOIN RULE ENGINE
// Rules controlling whether accounts can join a game.
// =========================

// joinRules
// checkJoinRule

const joinRules = {

    // default rule
    async any(){
        return true
    },

    // accountIdRange rule
    // params: [min,max]
    async accountIdRange(accountId, params){

        if(!accountId) return false

        const parts = accountId.split(".")
        const num = Number(parts[2])

        if(isNaN(num)) return false

        const min = params?.[0] ?? 0
        const max = params?.[1] ?? Number.MAX_SAFE_INTEGER

        return num >= min && num <= max
    }

}

async function checkJoinRule(game, accountId){

    if(!game.joinRule) return true

    // star rule
    if(game.joinRule === "*") return true

    // array whitelist
    if(Array.isArray(game.joinRule)){
        return game.joinRule.includes(accountId)
    }

    // rule object
    if(typeof game.joinRule === "object"){

        const fn = joinRules[game.joinRule.rule]

        if(!fn){
            throw new Error("Unknown join rule: " + game.joinRule.rule)
        }

        return await fn(accountId, game.joinRule.params)
    }

    return false
}







/////////////// seed assets

async function seedAssets(network, hac) {
		if (network === 'playnet')  return { apple:1, banana:1, carrot:1 }
		
		const assets = await getAssetsForAccount(network, hac)
		elog(assets, `mirror info from ${network} ${hac}`,'dev12')
		// todo lookup account assets and generate array
		return assets 
}


async function getAssetsForAccount(network, accountId) {

  const accountTokenInfo =
    await getTokensForAccountFromMirror(network, accountId)

  elog(accountTokenInfo,
       `getTokensForAccountFromMirror ${network} ${accountId}`,
       'dev12')

  const assets = {}

  // ---- fungible balances ----
  if (Array.isArray(accountTokenInfo.fungible)) {
    for (const f of accountTokenInfo.fungible) {
      // assets[f.token_id] = f.balance			
      if(accountTokenInfo.nfts?.[f.token_id]) continue // skip NFTs, these are done below
      assets[f.token_id] = f.balance
    }
  }

  // ---- NFT serials ----
  if (accountTokenInfo.nfts) {
    for (const tokenId in accountTokenInfo.nfts) {
      const serials = accountTokenInfo.nfts[tokenId]

      for (const s of serials) {
        assets[`${tokenId}#${s}`] = 1
      }
    }
  }

  return assets
}




function incr(obj, key, n = 1){
  const v = (obj[key] || 0) + n
  if(v) obj[key] = v
  else delete obj[key]
}	
	

function resetLocksIfNeeded(game) {

    const anyLocked = Object.values(game.accounts)
        .some(a => a.mode === "lock")

    if (!anyLocked) return

    for (const a of Object.values(game.accounts)) {
        a.mode = "shop"
    }
}



const colourPalette = [
    "#e63946",
    "#1d3557",
    "#2a9d8f",
    "#f4a261",
    "#6a4c93",
    "#118ab2",
    "#2b9348",
    "#ef476f"
]

function assignPlayerColour(game, playerId) {
    const usedColours = new Set(
        Object.values(game.players)
            .map(player => player.colour)
            .filter(Boolean)
    )

    const freeColour = colourPalette.find(colour => !usedColours.has(colour))
    if (freeColour) return freeColour

    const ids = Object.keys(game.players).length
    return colourPalette[ids % colourPalette.length]
}


function isValidAccountLabel(game, label) {
    if (!game || !label) return false

    if (game.network === "testnet" || game.network === "mainnet")
        return /^\d+\.\d+\.\d+$/.test(label)

    return true
}


module.exports = { 
	Ctx,
	seedAssets,
	getAssetsForAccount,
	checkJoinRule,
	
	incr,   						 //none
	resetLocksIfNeeded,  //none
	assignPlayerColour,  //-> colourPalette
	isValidAccountLabel  //none

}





//junkyard...


//wip map
// https://edotor.net/?engine=dot#deflate:eNqdlt9v2zYQx9/1Vwjuc9ECW9fmwQMER3XUOmpgKQWGYRho8SSzocWApJoEQ//3HamfpiS7rv1g8e7L092R/NCUFZI87v3PRIsDI/5/nidJ+UCZXG62Xi5KXZIDLBc3wL+DZhlZeF4pKPh/qz15hOVOPPtKv3BY5oxzoL75yQQXcrl4lV+Z7+IfD2iBM1rz7/aDZu+Vv5z7oO8+jTZRGoXJSZ2nql1dQ8YrpUH+W2nGFVbCyQ74cnGPQ6YZqIXXZgDvzBdLYWUmPbUXUt8QtfckKNAbkT2oKI8BKFDvx7ks18Ft6Cd/JWl4e2GeBXa2T3NtRskLeg6DRD/QqzzHRDMJRIPReAWUIJtBRHE15IFwpiAG/STkg8fUVxzTdliANkrVPrS/t6CJeU40xvK+CVZaLzyzWqZFle3Plx+sVl/u4/TXOkCyTFSlHixWUFtGjcA2vKNvsRGE0kbT9KQdGYfC5VOpaE0SDuJ7J8Ba20eFa1uLrdU+fRSyC6UUK8o7Tl5ArjCBSnoUclLxNsDGJHu+N1+DTXQdpNGX2H/jb+83F+9kWXEYNGdrh298u75EM1H2DcpzqBuU7SF7+ITLadTtZrgs73QbXEfxGtfW5J5cvKgms0HaqSSUlYUf1I7Bor6FD3Z3C8xe4nJ9g0x7T0zvqSRPuAOLgoM5jj+Xcuivt8HdjR/G6ygOLz2MdnSUM/hrawzLgpXQp529hz9s2rh3rG5Vx6g3ExbZ7TmF/W+cpgzEya5inNpJNraXs5KuRFli4YAPh0dRgplHypd6RtO8FZMZLifhvAmET8evCiQ0LuRZxWn4DFmlwb7rfP+SME034W2IJ/mX2ocnSHM4YO59D5Pe5rYwz+nV7jdsIdRZhpwVbMf7Tjb2oK3SddRlPQqlG49ht8A7Kn1OqiwDpXrDR8L4z5D8OrwL4+swXp29cpD6htbKQsoBsv/6T39AaxfPjvsY1sY54vmA18bf8XwCU8bfkdwC/Mhibjtj6Bhv+N0At6nliB5GO8dbxzemryMYMLdvwTxwxxonwATu2/ImXFOYN9LBRdBNn7s1xj7DnYZtDfQcec21NnBLOfc/Ru8bvc0CsU/MDqcDNE4nQsfSNkZnmI7SuZ04AxSP6eIIZo70tGp0wB2ZOWoWNGAJ0gPQrt4YdPNYnJkwZrYRuth2uW232TSiZ4h+YobBb4/KplD3bqnP7TQsnWxPSQfEPCVzYXpKeyrVMb8n2z2rnk53rDuR71jc/+E3suEdMjhqzmUycjSXyoCpw03143+konlE

function isValidPlayerToken(token){  //not in use yet/ever
  return typeof token === "string"
    && /^[0-9a-f-]{36}$/i.test(token)
}


function getPlayerProfile(gameId, playerToken){
  const game = games[gameId]
  if(!game) return null

  const p = game.players[playerToken]
  if(!p) return null

  return {
    id: p.publicId,
    name: p.name || p.publicId,
    avatar: p.avatar || null,
    colour: p.colour || null
  }
}



if(0) module.exports = {

  // validation
  isValidNetwork,
  normaliseNetwork,
  isValidAccountLabel,

  // player helpers
  assignPlayerColour,
  defaultAccountLabel,
  seedAssets,

  // account helpers
  getAccount,
  createAccount,

  // join rule engine
  joinRules,
  checkJoinRule,

  // trade graph
  getTradeClusters,
  getActiveAccounts,
  isClusterLocked,

  // trade execution
  executeCluster,
  executeAllActiveClusters,
  executeEligibleClusters,

  // graph utilities
  buildTradeGraph,
  findConnectedComponents,

  // trade state helpers
  anyLockedTradingCircle,
  resetLocksIfNeeded,

  // demo settlement
  executeTrade
}

