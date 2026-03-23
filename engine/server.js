require('dotenv').config()

const express = require('express')
const cors = require('cors')

const app = express()

// basic middleware
app.use(express.json())
app.use(cors())

console.log('Runtime Node:', process.version)

// --- Katomia cleanup worker (optional but useful)
require('./katomiaWorker').startCleanupTxPending()

// --- Katomia API
const katomiaApi = require('./katomiaApi')
app.use('/katomia', katomiaApi)

// --- health check (nice to have)
app.get('/', (req, res) => {
  res.send({ ok: true, service: 'katomia-demo' })
})

// --- 404 fallback
app.use((req, res) => {
  res.status(404).json({
    ok: false,
    message: `Invalid route: ${req.method} ${req.originalUrl}`
  })
})

// --- start server
const PORT = process.env.PORT || 8080

const server = app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`)
})

// --- WebSocket (Katomia real-time)
const { attachWebsocketServer } = require('./websocketserver')
attachWebsocketServer(server)