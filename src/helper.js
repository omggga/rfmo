import { mkdir, writeFile } from 'node:fs/promises'
import nodePath from 'node:path'
import { Readable } from 'node:stream'
import { RfmoApiHttpError, RfmoApiUsageError } from './errors.js'

const TOKEN_CACHE_KEY = 'rfmo:auth:token'

function buildTokenCacheKey(contour = 'prod') {
	const normalized = normalizeContour(contour)
	return normalized === 'test' ? `${TOKEN_CACHE_KEY}:test-contur` : TOKEN_CACHE_KEY
}

function normalizeContour(contour = 'prod') {
	const value = String(contour || 'prod').trim().toLowerCase()
	if (['test', 'test-contur', 'test_contur'].includes(value)) return 'test'
	return 'prod'
}

function buildMethodPath(methodPath, contour = 'prod') {
	const cleanPath = String(methodPath || '').replace(/^\/+/, '')
	if (normalizeContour(contour) !== 'test' || cleanPath.startsWith('test-contur/')) {
		return cleanPath
	}
	return `test-contur/${cleanPath}`
}

async function request(url, opts = {}, timeoutMs = 60_000) {
	const options = { method: 'GET', headers: {}, ...opts }
	let timeoutId

	if (options.signal == null) {
		const controller = new AbortController()
		options.signal = controller.signal
		timeoutId = setTimeout(() => controller.abort(), timeoutMs)
	}

	if (options.body instanceof Readable) {
		options.body = Readable.toWeb(options.body)
	}

	try {
		return await fetch(url, options)
	} catch (err) {
		if (err?.name === 'AbortError') throw err
		const cause = err?.cause ?? err
		const code = cause?.code ?? cause?.errno ?? cause?.name ?? 'UNKNOWN'
		const baseMsg = err?.message ?? 'fetch failed'
		const Ctor = err?.constructor ?? Error
		throw new Ctor(`${baseMsg}; code=${code}, url=${url}`, { cause })
	} finally {
		clearTimeout(timeoutId)
	}
}

function buildBaseUrl(rfmoCfg) {
	const protocol = String(rfmoCfg.protocol || 'http').replace(/:$/, '')
	const host = String(rfmoCfg.host || '').trim()
	const port = rfmoCfg.port == null ? '' : String(rfmoCfg.port).trim()
	const path = String(rfmoCfg.path || '').trim()

	if (!host) {
		throw new RfmoApiUsageError('RFMO mTLS host is not configured')
	}

	const normalizedPath = path ? (path.startsWith('/') ? path : `/${path}`) : ''
	const hostPort = port ? `${host}:${port}` : host
	return `${protocol}://${hostPort}${normalizedPath.replace(/\/+$/, '')}`
}

function buildUrl(baseUrl, methodPath) {
	const cleanPath = String(methodPath || '').replace(/^\/+/, '')
	return `${baseUrl}/${cleanPath}`
}

function buildHeaders(auth, contentType, token) {
	const headers = {}

	if (contentType) {
		headers['Content-Type'] = contentType
	}

	if (auth && token) {
		headers.Authorization = `Bearer ${token}`
	}

	return headers
}

function serializeRequestBody(body, contentType) {
	if (body == null) return undefined

	if (contentType?.includes('application/json')) {
		return JSON.stringify(body)
	}

	if (contentType?.includes('application/x-www-form-urlencoded')) {
		const params = new URLSearchParams()
		for (const [key, value] of Object.entries(body)) {
			if (value == null) continue
			params.append(key, String(value))
		}
		return params.toString()
	}

	return body
}

async function parseResponseByType(response, responseType) {
	if (responseType === 'binary' || responseType === 'buffer') {
		return Buffer.from(await response.arrayBuffer())
	}

	if (responseType !== 'json') {
		throw new RfmoApiUsageError(`Unsupported responseType: ${responseType}`)
	}

	const text = await response.text()
	if (!text) return null
	return JSON.parse(text)
}

function normalizeTokenResponse(payload) {
	return payload?.value?.accessToken || null
}

function normalizeCatalogResponse(payload) {
	if (!payload || typeof payload !== 'object') return payload

	return {
		...payload,
		date: payload.date ?? payload.Date ?? null,
		idXml: payload.idXml ?? payload.IdXml ?? null,
		isActive: payload.isActive ?? payload.IsActive ?? null
	}
}

function normalizeId(value) {
	if (typeof value === 'string' || typeof value === 'number') {
		const normalized = String(value).trim()
		return normalized || null
	}

	if (value && typeof value === 'object') {
		return normalizeNullableString(value.id)
	}

	return null
}

function buildFormalizedMessageForm({ file, sign, mchd = [], mchdSign = [] } = {}) {
	if (!file) {
		throw new RfmoApiUsageError('formalized-message/send requires file')
	}
	if (!sign) {
		throw new RfmoApiUsageError('formalized-message/send requires sign')
	}

	const form = new FormData()
	appendBinaryFormPart(form, 'file', file, 'message.xml')
	appendBinaryFormPart(form, 'sign', sign, 'message.sig')

	for (const [index, item] of asArray(mchd).entries()) {
		appendBinaryFormPart(form, 'mchd', item, `mchd-${index + 1}.xml`)
	}
	for (const [index, item] of asArray(mchdSign).entries()) {
		appendBinaryFormPart(form, 'mchdSign', item, `mchd-${index + 1}.sig`)
	}

	return form
}

function normalizeFormalizedMessageRef(value) {
	const payload = value && typeof value === 'object' ? value : {}
	const IdFormalizedMessage = normalizeNullableString(
		payload.IdFormalizedMessage ?? payload.idFormalizedMessage
	)
	const IdExternal = normalizeNullableString(payload.IdExternal ?? payload.idExternal)

	if (!IdFormalizedMessage) {
		throw new RfmoApiUsageError('IdFormalizedMessage is required')
	}
	if (!IdExternal) {
		throw new RfmoApiUsageError('IdExternal is required')
	}

	return { IdFormalizedMessage, IdExternal }
}

function appendBinaryFormPart(form, name, part, defaultFilename) {
	const { data, filename, contentType } = normalizeBinaryPart(part, defaultFilename)
	const blob = data instanceof Blob
		? data
		: new Blob([data], contentType ? { type: contentType } : undefined)
	form.append(name, blob, filename)
}

function normalizeBinaryPart(part, defaultFilename) {
	if (part instanceof Blob) {
		return {
			data: part,
			filename: part.name || defaultFilename,
			contentType: part.type || ''
		}
	}

	if (Buffer.isBuffer(part) || part instanceof Uint8Array || part instanceof ArrayBuffer) {
		return {
			data: part,
			filename: defaultFilename,
			contentType: ''
		}
	}

	if (part && typeof part === 'object' && part.data) {
		return {
			data: part.data,
			filename: part.filename || defaultFilename,
			contentType: part.contentType || ''
		}
	}

	throw new RfmoApiUsageError(`Invalid binary form part: ${defaultFilename}`)
}

function asArray(value) {
	if (value == null) return []
	return Array.isArray(value) ? value : [value]
}

function normalizeNullableString(value) {
	if (value == null) return null
	const normalized = String(value).trim()
	return normalized || null
}

function isRetryableHttpStatus(status) {
	return status === 429 || status >= 500
}

function isRetryableError(err) {
	if (err instanceof RfmoApiHttpError) {
		return isRetryableHttpStatus(err.status)
	}

	if (err?.name === 'AbortError') {
		return true
	}

	if (err instanceof RfmoApiUsageError) {
		return false
	}

	return err instanceof TypeError
}

async function safeReadText(response) {
	try {
		return (await response.text()) || ''
	} catch {
		return ''
	}
}

function buildRequestEnvelope({
	methodPath,
	url,
	attempt,
	headers,
	contentType,
	body,
	serializedBody
}) {
	return {
		at: new Date().toISOString(),
		attempt,
		methodPath,
		url,
		httpMethod: 'POST',
		contentType: contentType || null,
		headers: sanitizeHeaders(headers),
		body: sanitizeRequestBody(body),
		bodySerialized: typeof serializedBody === 'string' ? serializedBody : null
	}
}

function buildHttpResponseEnvelope(response, responseBody = '') {
	return {
		at: new Date().toISOString(),
		ok: false,
		status: response.status,
		statusText: response.statusText,
		body: responseBody || ''
	}
}

function buildSuccessResponseEnvelope(response, payload, responseType) {
	return {
		at: new Date().toISOString(),
		ok: true,
		status: response.status,
		statusText: response.statusText,
		responseType,
		payload: serializePayloadForEnvelope(payload, responseType)
	}
}

function buildErrorResponseEnvelope(err) {
	return {
		at: new Date().toISOString(),
		ok: false,
		error: {
			name: err?.name || 'Error',
			message: err?.message || String(err || 'Unknown error')
		}
	}
}

function serializePayloadForEnvelope(payload, responseType) {
	if (responseType === 'binary' || responseType === 'buffer') {
		if (!Buffer.isBuffer(payload)) return { kind: 'binary', size: 0, bodyBase64: '' }
		return {
			kind: 'binary',
			size: payload.length,
			bodyBase64: payload.toString('base64')
		}
	}
	return payload
}

function sanitizeHeaders(headers = {}) {
	const output = { ...headers }
	if (output.Authorization) {
		output.Authorization = maskBearer(output.Authorization)
	}
	return output
}

function maskBearer(value) {
	const text = String(value || '')
	if (!text) return text
	const [scheme = '', token = ''] = text.split(/\s+/, 2)
	if (/^bearer$/i.test(scheme)) {
		if (token.length <= 10) return 'Bearer ***'
		return `Bearer ${token.slice(0, 6)}...${token.slice(-4)}`
	}
	return '***'
}

function sanitizeRequestBody(body) {
	if (!body || typeof body !== 'object' || Array.isArray(body)) {
		return body ?? null
	}
	const copy = { ...body }
	if (Object.prototype.hasOwnProperty.call(copy, 'password')) {
		copy.password = '***'
	}
	return copy
}

function sanitizeMethodPath(methodPath) {
	const value = String(methodPath || 'method')
	return value
		.replace(/\/+/g, '__')
		.replace(/[^a-zA-Z0-9._-]/g, '_')
}

async function writeEnvelope({
	enabled,
	envelopesDir,
	sequence,
	methodPath,
	requestEnvelope,
	responseEnvelope
}) {
	if (!enabled) return false

	try {
		await mkdir(envelopesDir, { recursive: true })
		const seq = String(sequence).padStart(4, '0')
		const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
		const name = `${timestamp}_${seq}_${sanitizeMethodPath(methodPath)}`

		await writeFile(
			nodePath.join(envelopesDir, `${name}.request.json`),
			JSON.stringify(requestEnvelope || {}, null, 2)
		)
		await writeFile(
			nodePath.join(envelopesDir, `${name}.response.json`),
			JSON.stringify(responseEnvelope || {}, null, 2)
		)
		return true
	} catch {
		return false
	}
}

export {
	TOKEN_CACHE_KEY,
	buildTokenCacheKey,
	normalizeContour,
	buildMethodPath,
	request,
	buildBaseUrl,
	buildUrl,
	buildHeaders,
	serializeRequestBody,
	parseResponseByType,
	normalizeTokenResponse,
	normalizeCatalogResponse,
	normalizeId,
	buildFormalizedMessageForm,
	normalizeFormalizedMessageRef,
	isRetryableHttpStatus,
	isRetryableError,
	safeReadText,
	buildRequestEnvelope,
	buildHttpResponseEnvelope,
	buildSuccessResponseEnvelope,
	buildErrorResponseEnvelope,
	sanitizeHeaders,
	sanitizeRequestBody,
	writeEnvelope
}
