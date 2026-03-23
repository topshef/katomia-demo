// websocket.js
const { WebSocketServer } = require('ws')

const { elog, eclog } = require('./elog')

const subscriptions = new Map()

// CIRCLE_HACK helper notifier injection — avoids circular dependency between websocketserver and kpoolHelpers
const { setTxNotify } = require('./kpoolHelpers')

//katomia
const gameSubscriptions = new Map()
const gameManager = require('./katomia')

const { Ctx } = require('./katomiaHelpers')


const attachWebsocketServer = server => {

	const wss = new WebSocketServer({
		server,
		path: '/ws'
	})

	wss.on('connection', socket => {


		socket.on('message', async msg => {

				let data
				try {
						data = JSON.parse(msg.toString())
				} catch {
						return
				}

				if(handleSubscriptionMessage(socket,data)) return

				let trigger = "game_"
				if(data.type?.startsWith(trigger)){
						const action = data.type.slice(trigger.length)
						await handleGameMessage({socket, data, action})
						return
				}

		})

		socket.on('close', () => {
			for (const subs of subscriptions.values()) {
				subs.delete(socket)
			}
			
			if (socket.gameMeta) { // katomia
                const { gameId } = socket.gameMeta
                gameSubscriptions.get(gameId)?.delete(socket)
			}
		})
	})



	function handleSubscriptionMessage(socket,data){

			if (data.type === 'subscribe') {

					const txid = data.txid
					if (!txid) return true

					if (!subscriptions.has(txid))
							subscriptions.set(txid,new Set())

					subscriptions.get(txid).add(socket)
					return true
			}

			if (data.type === 'unsubscribe') {

					const txid = data.txid
					if (!txid) return true

					subscriptions.get(txid)?.delete(socket)
					return true
			}

			return false
	}


	async function handleGameMessage({socket,data, action}){
			
			elog(data,`game action = ${action}  playerToken=${socket.playerToken}`,'katomia')
			
			
			if(action !== "join" && !socket.playerToken){
					elog(data,"game action ignored because socket.playerToken missing","katomia")
					return
			}


			const { gameId } = data
			const game = gameManager.getGame(gameId)
			
			if(!game){
				elog({ gameId }, "Invalid gameId", "katomia")
				return sendGameError(socket, gameId, [{
					type: "error",
					message: `Invalid game ${gameId} / YD29932`,
					sender: null
				}])
			}

			const ctx = new Ctx(game, socket.playerToken)
			
			
			if(action === "join"){

					const { playerToken, playerName } = data
					if(!gameId || !playerToken) return

					const meta = gameManager.getGameMeta(gameId)

					gameManager.joinGame(gameId,playerToken,playerName)
					// gameManager.touch(gameId, playerToken)

					if(!gameSubscriptions.has(gameId))
							gameSubscriptions.set(gameId,new Set())

					gameSubscriptions.get(gameId).add(socket)

					socket.playerToken = playerToken
					socket.gameMeta = { gameId, playerToken }

					broadcastGame(gameId)
					return
			}

			// mark we have "seen" the player here
			gameManager.touch(gameId, socket.playerToken, 'seen')

			if(["addAccount", "removeAccount"].includes(action)){
				const res = await gameManager[action](ctx, data)
				return processGameResult(socket, gameId, res)
			}
			
			//consider the remaining events "action"
			gameManager.touch(gameId, socket.playerToken, 'action')

			// if(action === "offer"){
			if(["offer", "reject", "withdraw", "toggleLock", "exit"].includes(action)){
				const res = await gameManager[action](ctx, data)
				return processGameResult(socket, gameId, res)
			}

	}


	function canViewGame(socket,gameId,game){
			if(!game) return false

			if(game.visibility === "public") return true

			if(game.visibility === "unlisted") return true

			if(game.visibility === "private"){
					if(!socket.playerToken) return false

					const gameState = gameManager.getState(gameId)

					const ctx = new Ctx(game, socket.playerToken)
					const playerId = ctx.getPlayerId()
					
					if(!playerId) return false

					const playerAccounts = Object.values(gameState.accounts)
							.filter(a => a.playerId === playerId)

					return playerAccounts.length > 0
			}

			return false
	}


	function processGameResult(socket, gameId, res){
	
		// const ctx = new Ctx(gameId, socket.playerToken)
		const game = gameManager.getGame(gameId)
		const ctx = new Ctx(game, socket.playerToken)
			
		const messages = ctx.pullMessages('error')

		if(messages.length) elog(messages, "errors found", "dev14")
		if(messages.length) return sendGameError(socket, gameId, messages)

		if(!res) return   // maintain old behaviour
	
		elog(res, "broadcastGame", "dev14")
		broadcastGame(gameId)
	}


	function broadcastGame(gameId){
			const sockets = gameSubscriptions.get(gameId)
			if(!sockets || sockets.size === 0) return

			const state = gameManager.getState(gameId)
			const game = gameManager.getGameMeta(gameId)
			
			for(const socket of sockets){
					try{
							// elog(JSON.parse(JSON.stringify(socket)),"socket", "dev15")
							// elog(socket,"socket", "dev15")

							const game = gameManager.getGame(gameId)
							const ctx = new Ctx(game, socket.playerToken)
							// const ctx = new Ctx(gameId, socket.playerToken)

							const messages = ctx.pullMessages()
							const myPlayerId = socket.playerToken
								? ctx.getPlayerId()
								: null
								
							if(canViewGame(socket,gameId,game)){
									socket.send(JSON.stringify({
											type:"game_state",
											gameId,
											game,
											state,
											myPlayerId,
											messages
									}))
							}
					}
					catch(e){
							console.warn("[WS] game send failed", e)
					}
			}
	}	

	function sendGameError(socket, gameId, messages){
		elog(messages, "sendGameError", "dev14")
		socket.send(JSON.stringify({
			type: "game_error",
			gameId,
			messages
		}))
	}	

	return {
		notifyTxUpdate: (txid, payload) => {
			const sockets = subscriptions.get(txid)

			const count = sockets ? sockets.size : 0

			elog(`[WS] notifyTxUpdate txid=${txid} subscribers=${count}`)

			if (!sockets || count === 0) {
				elog(`[WS] no subscribers for ${txid}`)
				return
			}

			const msg = JSON.stringify({
				type: 'txUpdate',
				txid,
				data: payload
			})

			for (const socket of sockets) {
				try {
					socket.send(msg)
					elog(`[WS] sent update to subscriber for ${txid}`)
				} catch (e) {
					console.warn('[WS] send failed', e)
				}
			}
		}
	}
}

const { kmon } = require('./kmon')  //kpay monitor


function txNotify(txid, data) {
	if (!global.wsApi) {
		kmon('kpool.txNotify', 'error', { error: 'global.wsApi was not set HW83747', txid, data })
		elog("error global.wsApi was not set see kmon HW83747", "dev HW83747")
		return
	}
	try {
		const type = data.type || 'KY93843 no type'
		// elog(data, `${type} txNotify sending for ${txid}`)
		elog(data, `${type} txNotify sending for ${txid}`, "dev9")
		global.wsApi.notifyTxUpdate(txid, data)
	} catch (e) {
		elog(e, `WS notify failed for ${txid}`)
	}
}

/*
#CIRCLE_HACK
websocketserver → katomia → kpoolHelpers → websocketserver created a circular require.
kpoolHelpers used to import txNotify from websocketserver directly.
Instead we inject it at startup:
    setTxNotify(txNotify)
This breaks the loop while still letting helpers trigger websocket updates.
*/
// CIRCLE_HACK register websocket tx notifier so helpers can emit updates without importing websocketserver
setTxNotify(txNotify)

module.exports = {
	attachWebsocketServer,
	txNotify
}