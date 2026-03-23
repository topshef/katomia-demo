
/* =========================
   CONTROLS
========================= */


function splitAccountLabels(input){
  const parts = []
  let start = 0
  let depth = 0

  for(let i = 0; i < input.length; i++){
    const ch = input[i]

    if(ch === "(") depth++
    else if(ch === ")") depth = Math.max(0, depth - 1)
    else if(ch === "," && depth === 0){
      const part = input.slice(start, i).trim()
      if(part) parts.push(part)
      start = i + 1
    }
  }

  const last = input.slice(start).trim()
  if(last) parts.push(last)

  return parts
}



addAccountBtn.onclick = () => {
  const raw = accountLabelInput.value.trim()
  if(!raw) return

  const labels = splitAccountLabels(raw)
  const playerToken = getOrCreatePlayerToken()

  const sendAll = () => {
    labels.forEach(label => {
      let out = label

      if(game?.network === "testnet" || game?.network === "mainnet"){
        if(/^\d+$/.test(out)){
          out = "0.0." + out
        }
      }

      socket.send(JSON.stringify({
        type: "game_addAccount",
        gameId,
        playerToken,
        label: out
      }))
    })
  }

  if(!socket || socket.readyState !== WebSocket.OPEN){
    connect(sendAll)
  } else {
    sendAll()
  }

  accountLabelInput.value = ""
}


const showTradingAccounts = document.getElementById("showTradingAccounts")
const showTradedAssets = document.getElementById("showTradedAssets")

viewToggle.onchange = e => {
  viewMode = e.target.checked ? "columns" : "merged"
  render()
}

showTradingAccounts.onchange = e => {

  showActiveOnly = e.target.checked

  // if user unticks trading accounts, traded-only cannot stay active
  if(!showActiveOnly){
    showTradedOnly = false
    showTradedAssets.checked = false
  }

  render()
}

showTradedAssets.onchange = e => {

  showTradedOnly = e.target.checked
  showTradingAccounts.checked = e.target.checked

  // if the trading-accounts checkbox is hidden just sync the state
  if(showTradingAccounts.offsetParent === null)
    showActiveOnly = e.target.checked

  render()
}

/* =========================
   NETWORK
========================= */

function connect(onOpenAction){

  if(socket && socket.readyState === WebSocket.OPEN){
    onOpenAction && onOpenAction()
    return
  }

  if(socket && socket.readyState === WebSocket.CONNECTING){
    onOpenAction && socket.addEventListener("open", onOpenAction, { once:true })
    return
  }

  socket = new WebSocket("wss://hapi2.hbar.live/live/ws")

  socket.onopen = () => {

		const payload = {
      type: "game_join",
      gameId,
      playerToken: getOrCreatePlayerToken(),
      playerName: "anon"
    }
	
    socket.send(JSON.stringify(payload))
		glog("payload for game_join", payload)
		
    onOpenAction && onOpenAction()
  }

	
	const alertTimeouts = {warning: 3000, error: 0, info: 3000, success: 4000, event: 5000}
	socket.onmessage = async msg => {

		const data = JSON.parse(msg.data)
		console.log("websocket data received", data)
		
			
		if (data.messages)
			for (const m of data.messages) 
				notify(m.message,m.type, { timeout: alertTimeouts[m.type] ?? 0 }) // persistent
		if(data.type === "game_error") return  // errors included in notify
				
		
		if(data.type !== "game_state") glog(`websocket data IGNORED for type=${data.type}`, data)
		if(data.type !== "game_state") return

		game = data.game || null
		state = data.state
		currentPlayerId = data.myPlayerId || null

		glog(`state received for ${currentPlayerId}`, {game, state})

		render()
    await enrichVisibleAccounts()
		await enrichVisibleAssets()
		await loadThumbCache()
		render()

	}
	
}



function exitGame(){

	if(socket){
		const playerToken = getOrCreatePlayerToken()

		socket.send(JSON.stringify({
			type: "game_exit",
			gameId,
			playerToken
		}))

		socket.close()
	}

	socket = null
	// currentPlayer = null  //stale
	game = null
	state = null
	clearSelection()
	gameEl.innerHTML = ""
}


