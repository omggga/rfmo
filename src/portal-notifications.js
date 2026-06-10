import makeFetchCookie from 'fetch-cookie'
import { CookieJar } from 'tough-cookie'
import config from './config.js'
import { RfmoApiUsageError } from './errors.js'

class FedsfmPortalNotifications {
	constructor(options = {}) {
		const portal = options.fedsfmPortal || config.fedsfmPortal || {}
		this.origin = normalizeOrigin(options.origin || portal.origin || 'https://portal.fedsfm.ru')
		this.login = options.login ?? portal.login
		this.password = options.password ?? portal.password
		this.pageSize = Number(options.pageSize || portal.pageSize || 100)
		this.tlsVerify = options.tlsVerify ?? portal.tlsVerify ?? true
		this.maxAckPasses = Number(options.maxAckPasses || portal.maxAckPasses || 5)
		this.jar = options.jar || new CookieJar()
		this.fetch = makeFetchCookie(options.fetch || globalThis.fetch, this.jar)
	}

	async acknowledgeAllUnread() {
		await this.authenticate()

		let acknowledged = 0
		for (let pass = 1; pass <= this.maxAckPasses; pass += 1) {
			const notificationIds = await this._getUnreadNotificationIds()
			if (notificationIds.length === 0) return acknowledged

			await this._postJson('/EventNotifications/GetCheckedNotifications', notificationIds)
			acknowledged += notificationIds.length
		}

		throw new Error(`Could not acknowledge all notifications after ${this.maxAckPasses} attempts`)
	}

	async authenticate() {
		if (!this.login || !this.password) {
			throw new RfmoApiUsageError(
				'Set FEDSFMPORTAL_LOGIN/FEDSFMPORTAL_PASSWORD or RFMO_API_USERNAME/RFMO_API_PASSWORD'
			)
		}

		this._configureTls()
		await this._openLoginPage()
		await this._login()
	}

	async getNotificationsPage(pageIndex = 1) {
		return this._getNotificationsPage(pageIndex)
	}

	async _openLoginPage() {
		const response = await this.fetch(`${this.origin}/account/login`, {
			method: 'GET',
			headers: {
				accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
				'accept-language': this._headers()['accept-language'],
				'user-agent': this._headers()['user-agent']
			},
			redirect: 'manual'
		})
		await consumeResponse(response)
		if (!response.ok) {
			throw new Error(`GET /account/login failed: ${response.status} ${response.statusText}`)
		}
	}

	async _login() {
		const response = await this.fetch(`${this.origin}/account/login`, {
			method: 'POST',
			headers: {
				...this._headers(),
				accept: 'application/json, text/javascript, */*; q=0.01',
				'content-type': 'application/json, charset=UTF-8',
				referer: `${this.origin}/account/login`
			},
			body: JSON.stringify({ Login: this.login, Password: this.password }),
			redirect: 'manual'
		})

		const body = await readText(response)
		if (!response.ok) {
			throw new Error(`POST /account/login failed: ${response.status} ${response.statusText}. ${preview(body)}`)
		}

		const cookies = await this.jar.getCookies(this.origin)
		if (!cookies.some(cookie => cookie.key === 'FedsfmPortal')) {
			throw new Error(`POST /account/login did not set FedsfmPortal cookie. ${preview(body)}`)
		}
	}

	async _getUnreadNotificationIds() {
		const unreadIds = new Set()
		let pageIndex = 1
		let pageTotal = 1
		let unreadTotal = 0

		while (pageIndex <= pageTotal) {
			const body = await this._getNotificationsPage(pageIndex)
			const data = body?.data || {}
			const notifications = Array.isArray(data.notifications) ? data.notifications : []
			for (const item of notifications) {
				if (item?.isRead === false && item.idNotification) unreadIds.add(item.idNotification)
			}

			unreadTotal = Number(data.unreadbleCount || 0)
			pageTotal = resolvePageTotal(data, this.pageSize, pageIndex)
			if (notifications.length === 0 || (unreadTotal > 0 && unreadIds.size >= unreadTotal)) break

			pageIndex += 1
		}

		return [...unreadIds]
	}

	async _getNotificationsPage(pageIndex) {
		const result = await this._postJson('/EventNotifications/GetNotifications', {
			pageIndex,
			pageSize: this.pageSize,
			pageTotal: 0,
			recordTotal: 0,
			unreadbleCount: 0,
			notifications: []
		})

		if (!Array.isArray(result?.data?.notifications)) {
			throw new Error(`Unexpected GetNotifications response: ${preview(JSON.stringify(result))}`)
		}

		return result
	}

	async _postJson(path, payload = undefined) {
		const response = await this.fetch(`${this.origin}${path}`, {
			method: 'POST',
			headers: {
				...this._headers(),
				'content-type': 'application/json'
			},
			body: payload === undefined ? undefined : JSON.stringify(payload),
			redirect: 'manual'
		})
		const text = await response.text()

		if (!response.ok) {
			throw new Error(`${path} failed: ${response.status} ${response.statusText}. ${preview(text)}`)
		}

		try {
			return text ? JSON.parse(text) : null
		} catch (error) {
			throw new Error(`${path} returned non-JSON: ${preview(text)}`, { cause: error })
		}
	}

	_headers() {
		return {
			accept: 'application/json, text/plain, */*',
			'accept-language': 'ru-RU,ru;q=0.9,en;q=0.8',
			origin: this.origin,
			referer: `${this.origin}/`,
			'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/148.0.0.0 Safari/537.36',
			'x-requested-with': 'XMLHttpRequest'
		}
	}

	_configureTls() {
		if (!this.tlsVerify) process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
	}
}

function resolvePageTotal(data, pageSize, fallback) {
	const pageTotal = Number(data.pageTotal)
	if (Number.isFinite(pageTotal) && pageTotal > 0) return pageTotal

	const recordTotal = Number(data.recordTotal)
	if (Number.isFinite(recordTotal) && recordTotal > 0) {
		return Math.max(1, Math.ceil(recordTotal / pageSize))
	}

	return fallback
}

function normalizeOrigin(value) {
	return String(value || '').replace(/\/+$/, '')
}

async function consumeResponse(response) {
	try {
		await response.arrayBuffer()
	} catch {
		// Cookie processing is complete even when the response body cannot be consumed.
	}
}

async function readText(response) {
	try {
		return await response.text()
	} catch {
		return ''
	}
}

function preview(value, maxLength = 300) {
	const text = typeof value === 'string' ? value : JSON.stringify(value)
	return text.length > maxLength ? `${text.slice(0, maxLength)}<..>` : text
}

export default FedsfmPortalNotifications
