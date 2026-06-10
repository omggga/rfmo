import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { FedsfmPortalNotifications, RfmoApiUsageError } from '../src/index.js'

describe('FedsfmPortalNotifications', () => {
	it('acknowledges unread notifications from every page', async () => {
		const requests = []
		let acknowledged = false

		const fetch = async (url, options = {}) => {
			const path = new URL(url).pathname
			requests.push({ path, method: options.method || 'GET', body: options.body || '' })

			if (path === '/account/login' && options.method === 'GET') {
				return responseWithUrl(new Response('', { status: 200 }), url)
			}

			if (path === '/account/login' && options.method === 'POST') {
				return responseWithUrl(new Response('{"IsAuthenticated":true}', {
					status: 200,
					headers: { 'set-cookie': 'FedsfmPortal=session; Path=/; HttpOnly' }
				}), url)
			}

			if (path === '/EventNotifications/GetNotifications') {
				const pageIndex = JSON.parse(options.body).pageIndex
				const notifications = acknowledged
					? []
					: pageIndex === 1
						? [{ idNotification: 'n1', isRead: false }, { idNotification: 'n2', isRead: true }]
						: [{ idNotification: 'n3', isRead: false }, { idNotification: 'n4', isRead: false }]

				return jsonResponse({
					isError: false,
					data: {
						notifications,
						pageIndex,
						pageSize: 2,
						pageTotal: acknowledged ? 1 : 2,
						recordTotal: acknowledged ? 0 : 4,
						unreadbleCount: acknowledged ? 0 : 3
					}
				}, url)
			}

			if (path === '/EventNotifications/GetCheckedNotifications') {
				acknowledged = true
				return jsonResponse({ isError: false }, url)
			}

			throw new Error(`Unexpected request: ${path}`)
		}

		const client = new FedsfmPortalNotifications({
			origin: 'https://portal.test',
			login: 'user',
			password: 'password',
			pageSize: 2,
			tlsVerify: true,
			fetch
		})

		assert.equal(await client.acknowledgeAllUnread(), 3)
		const request = requests.find(item => item.path === '/EventNotifications/GetCheckedNotifications')
		assert.deepEqual(JSON.parse(request.body), ['n1', 'n3', 'n4'])
		assert.equal(requests.filter(item => item.path === '/EventNotifications/GetNotifications').length, 3)
	})

	it('requires credentials', async () => {
		const client = new FedsfmPortalNotifications({
			origin: 'https://portal.test',
			login: '',
			password: '',
			fetch: async () => { throw new Error('request should not be called') }
		})

		await assert.rejects(client.authenticate(), RfmoApiUsageError)
	})
})

function jsonResponse(payload, url) {
	return responseWithUrl(new Response(JSON.stringify(payload), {
		status: 200,
		headers: { 'content-type': 'application/json' }
	}), url)
}

function responseWithUrl(response, url) {
	Object.defineProperty(response, 'url', { value: url })
	return response
}
