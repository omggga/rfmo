import nodePath from 'node:path'
import config from './config.js'
import { RfmoApiHttpError, RfmoApiUsageError } from './errors.js'
import {
	TOKEN_CACHE_KEY,
	buildBaseUrl,
	buildErrorResponseEnvelope,
	buildHeaders,
	buildHttpResponseEnvelope,
	buildRequestEnvelope,
	buildSuccessResponseEnvelope,
	buildUrl,
	isRetryableError,
	isRetryableHttpStatus,
	normalizeCatalogResponse,
	normalizeId,
	normalizeTokenResponse,
	parseResponseByType,
	request,
	safeReadText,
	serializeRequestBody,
	writeEnvelope
} from './helper.js'

class RfmoApi {
	constructor(options = {}) {
		this.cache = options.cache || new Map()
		this.request = options.requestFn || request
		this.rfmo = { ...config.rfmo, ...(options.rfmo || {}) }
		this.baseUrl = buildBaseUrl(this.rfmo)
		this.token = options.token || this._readCachedToken()
		this.captureEnvelopes = Boolean(this.rfmo.captureEnvelopes)
		this.envelopesDir = this.rfmo.envelopesDir
			? nodePath.resolve(this.rfmo.envelopesDir)
			: nodePath.resolve(process.cwd(), 'rfmo-envelopes')
		this.envelopeSequence = 0
	}

	async authenticate(force = false) {
		if (!force && this.token) return this.token

		if (!this.rfmo.username || !this.rfmo.password) {
			throw new RfmoApiUsageError('RFMO_API_USERNAME/RFMO_API_PASSWORD are not configured')
		}

		const payload = await this.call('authenticate', {
			auth: false,
			contentType: 'application/json',
			responseType: 'json',
			body: {
				userName: this.rfmo.username,
				password: this.rfmo.password
			}
		})

		const token = normalizeTokenResponse(payload)
		if (!token) {
			throw new RfmoApiUsageError('JWT token was not found in authenticate response')
		}

		this.token = token
		this._writeCachedToken(token)
		return token
	}

	async getCurrentTe21Catalog() {
		const payload = await this.call('suspect-catalogs/current-te21-catalog')
		return normalizeCatalogResponse(payload)
	}

	async getTe21File(idOrIdXml) {
		return this._requestFileById('suspect-catalogs/current-te21-file', idOrIdXml)
	}

	async getCurrentMvkCatalog() {
		const payload = await this.call('suspect-catalogs/current-mvk-catalog')
		return normalizeCatalogResponse(payload)
	}

	async getMvkFileZip(idOrIdXml) {
		return this._requestFileById('suspect-catalogs/current-mvk-file-zip', idOrIdXml)
	}

	async getCurrentUnCatalog() {
		const payload = await this.call('suspect-catalogs/current-un-catalog')
		return normalizeCatalogResponse(payload)
	}

	async getCurrentUnCatalogRus() {
		const payload = await this.call('suspect-catalogs/current-un-catalog-rus')
		return normalizeCatalogResponse(payload)
	}

	async getUnFile(idOrIdXml) {
		return this._requestFileById('suspect-catalogs/current-un-file', idOrIdXml)
	}

	async call(methodPath, options = {}) {
		const {
			body,
			contentType = 'application/json',
			responseType = 'json',
			auth = true
		} = options

		const retryAttempts = Number(this.rfmo.retryAttempts ?? 2)
		const timeoutMs = Number(this.rfmo.timeoutMs ?? 60_000)
		const retryLimit = Math.max(0, retryAttempts)
		let reloginDone = false
		let retriesUsed = 0
		let attempt = 0

		while (true) {
			attempt += 1
			let requestEnvelope = null
			try {
				if (auth && !this.token) {
					await this.authenticate()
				}

				const url = buildUrl(this.baseUrl, methodPath)
				const headers = buildHeaders(auth, contentType, this.token)
				const serializedBody = serializeRequestBody(body, contentType)
				const reqOptions = {
					method: 'POST',
					headers,
					body: serializedBody
				}
				requestEnvelope = buildRequestEnvelope({
					methodPath,
					url,
					attempt,
					headers,
					contentType,
					body,
					serializedBody
				})
				const response = await this.request(url, reqOptions, timeoutMs)

				if (auth && (response.status === 401 || response.status === 403) && !reloginDone) {
					const responseBody = await safeReadText(response)
					await this._writeEnvelope(methodPath, requestEnvelope, buildHttpResponseEnvelope(response, responseBody))
					reloginDone = true
					await this.authenticate(true)
					continue
				}

				if (!response.ok) {
					const responseBody = await safeReadText(response)
					await this._writeEnvelope(methodPath, requestEnvelope, buildHttpResponseEnvelope(response, responseBody))
					const httpError = new RfmoApiHttpError(methodPath, url, response, responseBody)
					if (retriesUsed < retryLimit && isRetryableHttpStatus(response.status)) {
						retriesUsed += 1
						continue
					}
					throw httpError
				}

				const payload = await parseResponseByType(response, responseType)
				await this._writeEnvelope(methodPath, requestEnvelope, buildSuccessResponseEnvelope(response, payload, responseType))
				return payload
			} catch (err) {
				if (!(err instanceof RfmoApiHttpError)) {
					await this._writeEnvelope(methodPath, requestEnvelope, buildErrorResponseEnvelope(err))
				}
				if (retriesUsed < retryLimit && isRetryableError(err)) {
					retriesUsed += 1
					continue
				}
				throw err
			}
		}
	}

	async _requestFileById(methodPath, id) {
		const normalizedId = normalizeId(id)
		if (!normalizedId) {
			throw new RfmoApiUsageError(`Method "${methodPath}" requires id`)
		}

		return this.call(methodPath, {
			contentType: 'application/x-www-form-urlencoded',
			responseType: 'binary',
			body: { id: normalizedId }
		})
	}

	async _writeEnvelope(methodPath, requestEnvelope, responseEnvelope) {
		if (!this.captureEnvelopes) return

		this.envelopeSequence += 1
		await writeEnvelope({
			enabled: true,
			envelopesDir: this.envelopesDir,
			sequence: this.envelopeSequence,
			methodPath,
			requestEnvelope,
			responseEnvelope
		})
	}

	_readCachedToken() {
		if (typeof this.cache?.get !== 'function') return null
		return this.cache.get(TOKEN_CACHE_KEY) || null
	}

	_writeCachedToken(token) {
		if (typeof this.cache?.set !== 'function') return
		this.cache.set(TOKEN_CACHE_KEY, token)
	}
}

export default RfmoApi
