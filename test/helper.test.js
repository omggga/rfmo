import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
	buildBaseUrl,
	normalizeCatalogResponse,
	normalizeId,
	normalizeTokenResponse,
	serializeRequestBody
} from '../src/index.js'

describe('helper functions', () => {
	it('builds mTLS gateway base URL', () => {
		assert.equal(
			buildBaseUrl({
				protocol: 'http',
				host: 'localhost',
				port: 3010,
				path: '/rfmo/'
			}),
			'http://localhost:3010/rfmo'
		)
	})

	it('normalizes token response used by RFMO authenticate', () => {
		assert.equal(
			normalizeTokenResponse({ value: { accessToken: 'jwt-token' } }),
			'jwt-token'
		)
	})

	it('normalizes catalog field casing', () => {
		assert.deepEqual(
			normalizeCatalogResponse({
				Date: '2026-05-15',
				IdXml: 'catalog-id',
				IsActive: true,
				name: 'TE21'
			}),
			{
				Date: '2026-05-15',
				IdXml: 'catalog-id',
				IsActive: true,
				name: 'TE21',
				date: '2026-05-15',
				idXml: 'catalog-id',
				isActive: true
			}
		)
	})

	it('serializes json and urlencoded request bodies', () => {
		assert.equal(
			serializeRequestBody({ a: 1 }, 'application/json'),
			'{"a":1}'
		)
		assert.equal(
			serializeRequestBody({ id: ' 42 ', skip: null }, 'application/x-www-form-urlencoded'),
			'id=+42+'
		)
	})

	it('normalizes ids from strings, numbers and objects', () => {
		assert.equal(normalizeId(' 123 '), '123')
		assert.equal(normalizeId(123), '123')
		assert.equal(normalizeId({ id: ' abc ' }), 'abc')
		assert.equal(normalizeId({ nope: 'abc' }), null)
	})
})
