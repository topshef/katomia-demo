// katomiaCreate.js
// POST endpoint for creating new Katomia games


const express = require('express')
const router = express.Router()


const gameManager = require('./katomia')



async function handleCreateGame(req,res){

  let body = {}

  try{
    body = req.body ?? {}
  }catch{}

  const config = createGameConfig(body)

  const game = gameManager.createGame(config)

  res.json({
    ok: true,
    gameId: game.id,
    game
  })

}


//
// CREATE GAME
//

router.post('/create', (req,res) => {

  const body = req.body || {}

  // ❌ remove user control of id
  delete body.id

  const game = gameManager.createGame(body)

  res.json({
    ok: true,
    gameId: game.id,
    game
  })

})


const ADMIN_IPS = [
  "130.185.251.53",
]

//
// LIST GAMES
//

router.get('/games', (req,res) => {

  const ip =
    (req.headers['x-forwarded-for'] || '').split(',')[0] ||
    req.socket.remoteAddress

  const isAdmin = ADMIN_IPS.includes(ip)

  const games = gameManager.getGames()

  const visibleGames = isAdmin
    ? games
    : Object.fromEntries(
        Object.entries(games)
          .filter(([id,g]) => g.visibility === "public")
      )

  res.json({
    ok: true,
    count: Object.keys(visibleGames).length,
    games: visibleGames
  })

})

//
// GET SINGLE GAME
//

router.get('/game/:id', (req,res) => {

  const id = req.params.id

  const game = gameManager.getGame(id)

  if(!game)
    return res.status(404).json({
      ok:false,
      error:"game not found"
    })

  if(game.visibility === "private")
    return res.status(403).json({
      ok:false,
      error:"game is private"
    })

  res.json({
    ok:true,
    game
  })

})


router.post('/', handleCreateGame)

module.exports = router