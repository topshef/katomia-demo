

const { elog, eclog } = require('./elog')

const fetch = global.fetch || require('node-fetch')

const { games, resolveTxSuccess, resolveTxFailed } = require('./katomia')

const { txRead } = require('./kpool')
const { kmon } = require('./kmon')

const INTERVAL = 5000  // 5 seconds
const WARN_AFTER_MS = 5 * 60 * 1000   // 5 mins
const FAIL_AFTER_MS = 60 * 60 * 1000  // 1 hour

// elog({INTERVAL, WARN_AFTER_MS, FAIL_AFTER_MS},"starting startCleanupTxPending")
console.log("starting startCleanupTxPending")
// const { startCleanupTxPending } = require('./katomiaWorker')
startCleanupTxPending()

function startCleanupTxPending(){

  setInterval(async () => {
		// elog({INTERVAL, WARN_AFTER_MS, FAIL_AFTER_MS}," startCleanupTxPending", "dev17")
		
    for(const game of Object.values(games)){

      for(const pch in game.txPending){

        const tx = game.txPending[pch]
				eclog({pch, tx, INTERVAL, WARN_AFTER_MS, FAIL_AFTER_MS}, `startCleanupTxPending ${pch}`, "dev17")

        if(!tx?.txid) continue
				
				tx.createdAt ||= Date.now()

        // ---- expiry check ----
        const now = Date.now()

        tx.expiry ||= getExpiryFromTxId(tx.txid)

        if(now < tx.expiry) continue
				
				const age = now - tx.createdAt
				// const age = Date.now() - (tx.createdAt ||= Date.now())   //ai????
				
				if(age > FAIL_AFTER_MS){
					alertTxPending('fail', game, tx, pch, age)
					resolveTxFailed(game, pch)
					continue
				}
								
				if(age > WARN_AFTER_MS && !tx.warned){
					tx.warned = true
					alertTxPending('warn', game, tx, pch, age)
				}


        try{

					//if doing external
          // const res = await fetch(`..external /txRead?network=${game.network}&txid=${tx.txid}`)
          // const data = await res.json()

					//but its internal
					const query = {
							network: game.network,
							txid: tx.txid,
							// checksum: pch,
							checksum: '*',  //check all for now, until txSave uses same pch as katomia !!!
							mirror: true
						}
					const data = await txRead({query})
					
					elog({query,data}, `startCleanupTxPending ${pch}`, "dev17")
					
					if(typeof data === 'string') continue
					
					tx.lifecycle ||= {
						status: 'pending',
						isFinalStatus: false,
						lastUpdated: Date.now()
					}					
					
					tx.lifecycle.status = data?.comboStatus || tx.lifecycle.status
					tx.lifecycle.isFinalStatus = Boolean(data?.isStatusFinal)
					tx.lifecycle.lastUpdated = Date.now()
					
          if(!data?.isStatusFinal) continue
					
					const statusNorm = String(data.comboStatus || '').toUpperCase()


          if(statusNorm === "SUCCESS")
            resolveTxSuccess(game, pch)
          else
            resolveTxFailed(game, pch)

        }catch(err){
          console.error("katomiaTxWorker error", err)
        }
				
      }
    }

  }, INTERVAL)
}


// ---- helper ----
function alertTxPending(status, game, tx, pch, age){
  kmon(
    // 'hapi katomia cleanup txPending',
    'hapi katomia warning',
    status,
    {
      network: game.network,
      txid: tx.txid,
      pch,
      ageMs: age
    }
  )
}

function getExpiryFromTxId(txid){

  try{
    const part = txid.split("@")[1]
    const seconds = Number(part.split(".")[0])
    return (seconds * 1000) + (2 * 60 * 1000) // +2 mins
  }catch{
    return Date.now() + (2 * 60 * 1000)
  }
}


module.exports = { startCleanupTxPending }






// also todo...

/*
KATOMIA – INACTIVITY / PURGE WORKER (future)

Goal
----
Prevent stalled games when players disappear while holding offers/baskets.
Keep implementation simple and configurable.

Account fields
--------------
lastSeen    // timestamp updated when player reconnects / joins
lastAction  // timestamp updated on any meaningful interaction

Events that update timestamps
------------------------------
JOIN / reconnect        -> update lastSeen
OFFER / WITHDRAW        -> update lastAction
REJECT / ACCEPT         -> update lastAction
LOCK / UNLOCK           -> update lastAction
ADD / REMOVE ACCOUNT    -> update lastAction

Derived values (computed during worker sweep)
---------------------------------------------
idleSeen   = now - lastSeen
idleAction = now - lastAction

Account classification (computed dynamically)
---------------------------------------------
EMPTY_ACCOUNT
    no reserved items
    no basket items

PASSIVE_RECEIVER
    basket contains items
    no reserved items

ACTIVE_TRADER
    reserved items exist (sending offers)

LOCKED
    account lock active


Initial timeout policy (start conservative)
-------------------------------------------
EMPTY_ACCOUNT      -> 24h
PASSIVE_RECEIVER   -> 24h
ACTIVE_TRADER      -> 24h
LOCKED             -> 48h

(Values intentionally long to avoid aggressive purging.
Can be tuned later once real usage patterns appear.)


Worker behaviour (runs periodically)
------------------------------------
interval: every ~5 minutes

for each game
  for each account
    classify account state
    compute idleSeen / idleAction
    compare against timeout table


On timeout
----------
1. Cancel activity
       clear reserved items
       clear basket items
       unlock account

2. Mark account inactive
       account.inactive = true
       account.inactiveAt = now

3. Keep account visible so user sees that timeout occurred


Optional later cleanup
----------------------
If account.inactive > 24h
    remove account from game entirely


Notes
-----
• Timers are measured from lastSeen (not from basket/offer events)
  so users are not punished for offers arriving while offline.

• This worker only cleans stalled activity.
  It does NOT delete games.

• Entire games may later expire based on game.lastActivity.

• System intentionally avoids complex state rules.
  Classification is derived dynamically at sweep time.
*/
