



async function getTokenMeta(network, tokenId, serial){

	let productId = `${network};${tokenId}`
	if(serial) productId += `-${serial}`

	const params = {
		format: "json",
		productId
	}

	return await Kache.getData("/m", params, 86400)
}



function parseAssetId(assetId){

	assetId = String(assetId)

	if(assetId.includes("#")){
		const [tokenId, serial] = assetId.split("#")
		return { tokenId, serial }
	}

	if(assetId.includes("-")){
		const [tokenId, serial] = assetId.split("-")
		return { tokenId, serial }
	}

	return { tokenId: assetId, serial: null }
}


async function enrichAsset(network, assetId, amount){

	const { tokenId, serial } = parseAssetId(assetId)
	const meta = await getTokenMeta(network, tokenId, serial)

	return {
		assetId,
		tokenId,
		serial,
		meta,
		amount
	}
}

function getDisplayDecimals(tokenClass){

	const tokenDecimals = Number(tokenClass.decimals || 0)

	return Math.max(tokenDecimals - 4, 0)
}

function formatAssetDisplay(asset, meta){

	if(!meta) return asset.assetId

	const tokenClass = meta.token_class || {}
	const type = tokenClass.type
	
	let tokenLabel
	let tokenClassLabel = meta.token_class?.name ?? asset.tokenId

	// NFT
	if(type === "NON_FUNGIBLE_UNIQUE") {
		tokenLabel =  meta.token_instance_name || `${tokenClassLabel} #${asset.serial}`
		return tokenLabel
	}

	// fungible
	const symbol = tokenClass.symbol || asset.tokenId
	const name   = tokenClass.name || asset.tokenId
	
	tokenLabel = symbol ?? name
	
	if(symbol && symbol.toLowerCase().startsWith("hedera://")) tokenLabel = name	
	
	const decimals = Number(tokenClass.decimals || 0)

	if(decimals){
		const value = asset.amount / (10 ** decimals)
		const displayDecimals = getDisplayDecimals(tokenClass)
		const rounded = value.toFixed(displayDecimals)
		return `${tokenLabel} ${rounded}`
	}

	return asset.amount > 1
		? `${tokenLabel} ×${asset.amount}`
		: tokenLabel
}


function getAssetDisplay(assetId, amount){

	glog(`getAssetDisplay`, {assetId, amount})

	window.assetDisplayCache ||= {}

	const meta = window.assetDisplayCache[assetId]

	const { tokenId, serial } = parseAssetId(assetId)


	if(meta){
		const asset = {
			assetId,
			tokenId,
			serial,
			amount
		}

		return formatAssetDisplay(asset, meta)
	}

	return amount > 1
		? `${assetId} ×${amount}`
		: String(assetId)
}


function getAssetMeta(assetId){
	return window.assetDisplayCache?.[assetId] || null
}

function getAssetThumb(meta){

	if(!meta) return null

	// NFT
	if(meta.token_asset_image_URL)
		return meta.token_asset_image_URL

	// future: fungible icons etc
	return null
}


async function enrichVisibleAssets(){

	if(!game?.network) return
	if(!state?.accounts) return

	window.assetDisplayCache ||= {}
	window.assetMetaPending ||= new Set()

	const jobs = []

	Object.values(state.accounts).forEach(account => {

		Object.entries(account.assets || {}).forEach(([assetId, amount]) => {
			if(window.assetDisplayCache[assetId]) return
			if(window.assetMetaPending.has(assetId)) return

			window.assetMetaPending.add(assetId)

			jobs.push(
				(async () => {
					try{
						const enriched = await enrichAsset(game.network, assetId, amount)
						glog(`enrichAsset ${game.network}`,{assetId, amount, enriched})
						
						window.assetDisplayCache[assetId] = enriched.meta
					}
					catch(err){
						console.error("asset enrichment failed", assetId, err)
					}
					finally{
						window.assetMetaPending.delete(assetId)
					}
				})()
			)
		})

		account.basket.forEach(item => {
			const assetId = item.assetId
			const amount = item.amount || 1

			if(window.assetDisplayCache[assetId]) return
			if(window.assetMetaPending.has(assetId)) return

			window.assetMetaPending.add(assetId)

			jobs.push(
				(async () => {
					try{
						const enriched = await enrichAsset(game.network, assetId, amount)
						window.assetDisplayCache[assetId] = enriched.meta
					}
					catch(err){
						console.error("asset enrichment failed", assetId, err)
					}
					finally{
						window.assetMetaPending.delete(assetId)
					}
				})()
			)
		})
	})

	if(jobs.length){
		await Promise.all(jobs)
		render()
	}
}