const fetch = require('node-fetch')
const fs = require('fs/promises')
const path = require('path')

const CACHE_FILE = path.join(__dirname, 'workingHederaNodes.json')
const CACHE_EXPIRY = 86400000 // 1 day in milliseconds

// Fetch data from the API
const fetchData = async () => {
  const url = 'https://kpos.uk/hedera_nodes/?format=json&status=SUCCESS&sortBy=speed'
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Failed to fetch data: ${response.statusText}`)
  return response.json()
}

// Load cache if it exists and is not expired
const loadCache = async () => {
  try {
    const { timestamp, json } = JSON.parse(await fs.readFile(CACHE_FILE, 'utf-8'))
    return Date.now() - timestamp < CACHE_EXPIRY ? json : null
  } catch (err) {
    return null
  }
}

// Save data to cache
const saveCache = json => 
  fs.writeFile(CACHE_FILE, JSON.stringify({ timestamp: Date.now(), json }), 'utf-8')

// Main function to get nodes using cache if possible
const getWorkingNodes = async () => {
  let data = await loadCache()
  if (!data) {
    console.log('Fetching new data...')
    data = await fetchData()
    saveCache(data)
  } else console.log('Using cached data...')
  return data // Object.keys(data)[0] // first node (already sorted by most performant)
}

// Export the function for use in other scripts
module.exports = {
  getWorkingNodes
}

// Example usage
// getWorkingNodes()
  // .then(nodes => console.log('Valid nodes:', nodes))
  // .catch(console.error)
