
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




// =========================
// GAME ACTIONS (ENTRY POINTS)
// Main externally-invoked game actions via websocket/API.
// =========================

// joinGame
// addAccount
// removeAccount
// addAssetsToAccount
// offer
// reject
// withdraw
// toggleLock
// exitGame




// async function createAccount(game, playerToken, hac) {  //hac = hedera account (or label for playnet)
async function createAccount(game, playerToken, hac, assetFilter="*") {

    const internalId = playerToken + ":" + hac
		
		const ts = Date.now()
		
    const account = {
        id: internalId,
        label: hac,
        playerToken,
        // assets: await seedAssets(game.network, hac),
				assets: await seedAssets(game.network, hac),
        basket: [],
        mode: "shop"	
    }

		// apply asset filter
		if(assetFilter !== "*"){

			const filtered = {}

			for(const id of assetFilter){
				if(account.assets[id])
					filtered[id] = account.assets[id]
			}

			account.assets = filtered
		}

    game.accounts[internalId] = account

    if (!game.players[playerToken]) {
        game.players[playerToken] = {
            id: playerToken,
            name: null,
            accounts: [],
            colour: assignPlayerColour(game, playerToken)
        }
    }

    game.players[playerToken].accounts.push(internalId)

    return account
}

async function addAccount(ctx, {label}){
		const { gameId, game, playerToken } = ctx
		let assetFilter = "*"

		// parse label filters like:
		// 0.0.1234(apple,banana)
		// playwallet(apple,banana)
		// account(*)

		const m = label.match(/^([^()]+)\(([^()]*)\)$/)

		if(m){
			label = m[1].trim()

			const raw = m[2].trim()

			if(raw === "*" || raw === ""){
				assetFilter = "*"
			}
			else{
				// assetFilter = raw.split(",").map(x => x.trim()).filter(Boolean)
				assetFilter = raw.split(",").map(x => x.trim().replace("-", "#")).filter(Boolean)
			}
		}

    if(!game || !playerToken || !label) return

		// check join rule
		const allowed = await checkJoinRule(game,label)

		if(!allowed){
				elog({gameId, playerToken, label}, "Join rejected by rule")
				return
		}
		
		if(!isValidAccountLabel(game, label)) return  // label should be an actual hedera account id if testnet or mainnet

    if(!game.players[playerToken]){
        joinGame(gameId, playerToken, "anon")
    }

		const internalId = playerToken + ":" + label

		// account exists → try append assets
		if(game.accounts[internalId]){

				// wildcard only allowed on first add
				if(assetFilter === "*")
					return ctx.err(`Account ${label} already added. Use a filter to add missing assets eg alice(apple,carrot)`)

				await addAssetsToAccount(ctx, {account: game.accounts[internalId], assetFilter})
				return game
		}

    await createAccount(game, playerToken, label,assetFilter)

    return game
}


async function addAssetsToAccount(ctx, {account, assetFilter="*"}){  // only allow this if not already trading?
	const { game, playerToken } = ctx
	
  // collect assets already present in baskets
  const basketAssets = new Set()
  for(const a of Object.values(game.accounts))
    for(const item of a.basket)
      basketAssets.add(item.assetId)
		
  const assets = await seedAssets(game.network, account.label)

  let filtered = assets

  if(assetFilter !== "*"){
		filtered = {}
		for(const id of assetFilter){
			if(!assets[id]){
				ctx.warn(`Asset not found: ${id} / GR94843`)
				elog(`Asset not found: ${id} / GR94843`)
				continue
			}
			filtered[id] = assets[id]
		}
  }

	for(const id in filtered){
			if(account.assets[id])  {ctx.warn(`Asset already added: ${id} / YH83743`);continue}
			if(basketAssets.has(id)){ctx.warn(`Asset already added: ${id} / PU87273`);continue}
			incr(account.assets, id, filtered[id])
	}
	
  return true
}


function removeAccount(ctx, {accountId}){
		const { game, playerToken } = ctx
    if(!game) return

    const account = ctx.getAccount(accountId)
		if(!account || !ctx.canActOnAccount(account)) return

    const player = game.players[playerToken]
    if(!player) return

    // remove items offered FROM this account
    for(const other of Object.values(game.accounts)){
        other.basket = other.basket.filter(item => {
            if(item.from === account.id){
								incr(account.assets, item.assetId)
                return false
            }
            return true
        })
    }

    // return items sitting IN this basket
    for(const item of account.basket){
        const owner = game.accounts[item.from]
        if(owner) incr(owner.assets, item.assetId)
    }

    account.basket = []

    player.accounts = player.accounts.filter(id => id !== account.id)

    delete game.accounts[account.id]

    if(player.accounts.length === 0)
        delete game.players[playerToken]

    return game
}




function offer(ctx, { fromId, toId, assetId, amount = 1 }) {
		const { game, playerToken } = ctx

		const from = ctx.getAccount(fromId)
		const to   = ctx.getAccount(toId)

    if (!from || !to) return
		
		if (!ctx.canActOnAccount(from)) return
		
    if (from.mode !== "shop") return

		const available = from.assets[assetId] || 0
		if(available < amount) return
		incr(from.assets, assetId, -amount)

		to.basket.push({
				assetId,
				amount,
				from: from.id
		})
		
    resetLocksIfNeeded(game)
		
		ctx.send([to.playerToken], `${fromId} placed ${assetId}`)
		
    return game
}

function reject(ctx, {accountId, assetId}) {
		const { game, playerToken } = ctx

    const account = ctx.getAccount(accountId)
    if (!account) return
		
		if (!ctx.canActOnAccount(account)) return

    const idx = account.basket.findIndex(a => a.assetId === assetId)
    if (idx === -1) return

    const item = account.basket.splice(idx,1)[0]

    const owner = ctx.getAccount(item.from)
    if (!owner) return

		incr(owner.assets, item.assetId, item.amount || 1)
			
    resetLocksIfNeeded(game)
		// elog({owner, gameId, accountId, assetId, playerToken},"reject xxxxx","dev14")
		ctx.send([owner.playerToken], `${owner.label} rejected your item ${item.assetId}`)  //label is account
		// ctx.send([owner.playerToken], `{{sender}} rejected your item ${item.assetId}`) //client to hydrate sender 
		//todo tidy up ui how client presents messaging.. sender is a player id as listed in players array
		
    return game
}

// function withdraw(gameId, fromAccountId, toAccountId, assetId, playerToken) {
function withdraw(ctx, {fromId, toId, assetId}) {
		const { game, playerToken } = ctx

    const from = ctx.getAccount(fromId)
    const to   = ctx.getAccount(toId)

    if (!from || !to) return
		
		if (!ctx.canActOnAccount(from)) return

    const idx = to.basket.findIndex(
				a => a.assetId === assetId && a.from === from.id
    )

    if (idx === -1) return

    const item = to.basket.splice(idx,1)[0]

		incr(from.assets, item.assetId, item.amount || 1)
			
    resetLocksIfNeeded(game)
		const fromPlayerId = ctx.getPlayerId(from.playerToken)
				
		elog({from, to, assetId, playerToken},"withdraw xxxxx","dev14")  // todo 

		ctx.send([to.playerToken], `${fromPlayerId} ${from.label} withdrew item ${item.assetId}`) 
		
    return game
}


function exit(ctx){ 
  const { game, playerToken } = ctx

  const player = game.players[playerToken]
  if(!player) return

  // clone because removeAccount mutates
  const accounts = [...player.accounts]

  for(const accountId of accounts)
    removeAccount(ctx, { accountId })

  //delete player is done inside removeAccount if no accounts left
  // delete game.players[playerToken]
		
  return game
}



module.exports = {
    offer,
    reject,
    withdraw,
    // toggleLock,
    exit,
		addAccount,
		removeAccount,
}




