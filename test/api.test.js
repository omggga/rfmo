import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { RfmoApi, RfmoApiHttpError, RfmoApiUsageError } from '../src/index.js'

describe('RfmoApi', () => {
	it('authenticates and caches token', async () => {
		const calls = []
		const cache = new Map()
		const api = new RfmoApi({
			cache,
			rfmo: baseConfig(),
			requestFn: async (url, options, timeoutMs) => {
				calls.push({ url, options, timeoutMs })
				return jsonResponse({ value: { accessToken: 'token-1' } })
			}
		})

		assert.equal(await api.authenticate(), 'token-1')
		assert.equal(await api.authenticate(), 'token-1')
		assert.equal(calls.length, 1)
		assert.equal(cache.get('rfmo:auth:token'), 'token-1')
		assert.equal(calls[0].url, 'http://gateway:3010/rfmo/authenticate')
		assert.equal(calls[0].options.body, '{"userName":"user","password":"secret"}')
		assert.equal(calls[0].timeoutMs, 5000)
	})

	it('uses bearer token for authenticated API calls', async () => {
		const calls = []
		const api = new RfmoApi({
			rfmo: baseConfig(),
			token: 'cached-token',
			requestFn: async (url, options) => {
				calls.push({ url, options })
				return jsonResponse({ IdXml: 'id-1', IsActive: true })
			}
		})

		const catalog = await api.getCurrentTe21Catalog()

		assert.equal(catalog.idXml, 'id-1')
		assert.equal(calls[0].url, 'http://gateway:3010/rfmo/suspect-catalogs/current-te21-catalog')
		assert.equal(calls[0].options.headers.Authorization, 'Bearer cached-token')
	})

	it('uses test-contur prefix and separate cache key in test contour', async () => {
		const cache = new Map()
		const calls = []
		const api = new RfmoApi({
			cache,
			contour: 'test',
			rfmo: baseConfig(),
			requestFn: async (url, options) => {
				calls.push({ url, options })
				if (url.endsWith('/test-contur/authenticate')) {
					return jsonResponse({ value: { accessToken: 'test-token' } })
				}
				return jsonResponse({ idXml: 'te2-id' })
			}
		})

		const catalog = await api.getCurrentTe2Catalog()

		assert.equal(catalog.idXml, 'te2-id')
		assert.equal(cache.get('rfmo:auth:token:test-contur'), 'test-token')
		assert.equal(calls[0].url, 'http://gateway:3010/rfmo/test-contur/authenticate')
		assert.equal(calls[1].url, 'http://gateway:3010/rfmo/test-contur/suspect-catalogs/current-te2-catalog')
		assert.equal(calls[1].options.headers.Authorization, 'Bearer test-token')
	})

	it('re-authenticates once on 401 and repeats original call', async () => {
		const seen = []
		const api = new RfmoApi({
			rfmo: baseConfig(),
			token: 'expired-token',
			requestFn: async (url, options) => {
				seen.push({ url, options })
				if (url.endsWith('/suspect-catalogs/current-mvk-catalog') && seen.length === 1) {
					return textResponse('expired', { status: 401, statusText: 'Unauthorized' })
				}
				if (url.endsWith('/authenticate')) {
					return jsonResponse({ value: { accessToken: 'fresh-token' } })
				}
				return jsonResponse({ IdXml: 'mvk-id' })
			}
		})

		const catalog = await api.getCurrentMvkCatalog()

		assert.equal(catalog.idXml, 'mvk-id')
		assert.equal(seen.length, 3)
		assert.equal(seen[2].options.headers.Authorization, 'Bearer fresh-token')
	})

	it('posts file id as form data and parses binary response', async () => {
		const api = new RfmoApi({
			rfmo: baseConfig(),
			token: 'token',
			requestFn: async (url, options) => {
				assert.equal(url, 'http://gateway:3010/rfmo/suspect-catalogs/current-mvk-file-zip')
				assert.equal(options.headers['Content-Type'], 'application/x-www-form-urlencoded')
				assert.equal(options.body, 'id=xml-id')
				return new Response(Buffer.from('zip-data'), { status: 200, statusText: 'OK' })
			}
		})

		const file = await api.getMvkFileZip({ id: 'xml-id' })
		assert.equal(file.toString('utf8'), 'zip-data')
	})

	it('sends formalized message as multipart form data', async () => {
		const api = new RfmoApi({
			rfmo: baseConfig(),
			token: 'token',
			requestFn: async (url, options) => {
				assert.equal(url, 'http://gateway:3010/rfmo/formalized-message/send')
				assert.ok(options.body instanceof FormData)
				assert.equal(options.headers['Content-Type'], undefined)
				assert.equal(options.headers.Authorization, 'Bearer token')
				assert.ok(options.body.get('file') instanceof Blob)
				assert.ok(options.body.get('sign') instanceof Blob)
				return jsonResponse({ IdFormalizedMessage: 'message-id', IdExternal: 'external-id' })
			}
		})

		const result = await api.sendFormalizedMessage({
			file: { data: Buffer.from('<xml/>'), filename: 'message.xml', contentType: 'application/xml' },
			sign: { data: Buffer.from('sign'), filename: 'message.sig' }
		})

		assert.equal(result.IdFormalizedMessage, 'message-id')
	})

	it('sends formalized message with mchd files', async () => {
		const api = new RfmoApi({
			rfmo: baseConfig(),
			token: 'token',
			requestFn: async (url, options) => {
				assert.equal(url, 'http://gateway:3010/rfmo/formalized-message/send-with-mchd')
				assert.ok(options.body.get('mchd') instanceof Blob)
				assert.ok(options.body.get('mchdSign') instanceof Blob)
				return jsonResponse({ IdFormalizedMessage: 'message-id' })
			}
		})

		await api.sendFormalizedMessageWithMchd({
			file: Buffer.from('<xml/>'),
			sign: Buffer.from('sign'),
			mchd: [Buffer.from('<mchd/>')],
			mchdSign: [Buffer.from('mchd-sign')]
		})
	})

	it('checks formalized message status and downloads ticket', async () => {
		const calls = []
		const api = new RfmoApi({
			rfmo: baseConfig(),
			token: 'token',
			requestFn: async (url, options) => {
				calls.push({ url, options })
				if (url.endsWith('/check-status')) {
					return jsonResponse({ IdFormalizedMessageStatus: 3 })
				}
				return new Response(Buffer.from('ticket'), { status: 200, statusText: 'OK' })
			}
		})

		const status = await api.checkFormalizedMessageStatus({
			idFormalizedMessage: 'message-id',
			idExternal: 'external-id'
		})
		const ticket = await api.getFormalizedMessageTicket({
			IdFormalizedMessage: 'message-id',
			IdExternal: 'external-id'
		})

		assert.equal(status.IdFormalizedMessageStatus, 3)
		assert.equal(ticket.toString('utf8'), 'ticket')
		assert.equal(calls[0].options.body, '{"IdFormalizedMessage":"message-id","IdExternal":"external-id"}')
		assert.equal(calls[1].options.body, '{"IdFormalizedMessage":"message-id","IdExternal":"external-id"}')
	})

	it('does not retry usage errors', async () => {
		const api = new RfmoApi({
			rfmo: baseConfig(),
			token: 'token',
			requestFn: async () => {
				throw new Error('request should not be called')
			}
		})

		await assert.rejects(
			api.getUnFile(''),
			(err) => err instanceof RfmoApiUsageError && /requires id/.test(err.message)
		)
	})

	it('surfaces non-retryable http errors', async () => {
		const api = new RfmoApi({
			rfmo: baseConfig({ retryAttempts: 5 }),
			token: 'token',
			requestFn: async () => textResponse('bad id', { status: 400, statusText: 'Bad Request' })
		})

		await assert.rejects(
			api.getCurrentUnCatalog(),
			(err) => err instanceof RfmoApiHttpError && err.status === 400 && err.responseBody === 'bad id'
		)
	})

	it('retries retryable http errors according to config', async () => {
		let attempts = 0
		const api = new RfmoApi({
			rfmo: baseConfig({ retryAttempts: 1 }),
			token: 'token',
			requestFn: async () => {
				attempts += 1
				if (attempts === 1) {
					return textResponse('temporary', { status: 500, statusText: 'Server Error' })
				}
				return jsonResponse({ IdXml: 'retry-ok' })
			}
		})

		const catalog = await api.getCurrentUnCatalog()
		assert.equal(catalog.idXml, 'retry-ok')
		assert.equal(attempts, 2)
	})
})

function baseConfig(overrides = {}) {
	return {
		protocol: 'http',
		host: 'gateway',
		port: 3010,
		path: '/rfmo',
		username: 'user',
		password: 'secret',
		timeoutMs: 5000,
		retryAttempts: 0,
		captureEnvelopes: false,
		envelopesDir: '',
		...overrides
	}
}

function jsonResponse(payload, init = {}) {
	return new Response(JSON.stringify(payload), {
		status: 200,
		statusText: 'OK',
		headers: { 'Content-Type': 'application/json' },
		...init
	})
}

function textResponse(text, init = {}) {
	return new Response(text, init)
}
