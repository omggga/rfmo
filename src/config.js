const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on'])

function toBool(value) {
	return TRUE_VALUES.has(String(value || '').toLowerCase())
}

function loadConfig(env = process.env) {
	return {
		rfmo: {
			contour: env.RFMO_CONTOUR || 'prod',
			protocol: env.RFMO_MTLS_PROTOCOL || 'http',
			host: env.RFMO_MTLS_HOST || 'localhost',
			port: env.RFMO_MTLS_PORT === '' ? '' : Number(env.RFMO_MTLS_PORT || 3010),
			path: env.RFMO_MTLS_PATH || '/rfmo',
			username: env.RFMO_API_USERNAME || '',
			password: env.RFMO_API_PASSWORD || '',
			timeoutMs: Number(env.RFMO_API_TIMEOUT_MS || 60_000),
			retryAttempts: Number(env.RFMO_API_RETRY_ATTEMPTS || 2),
			captureEnvelopes: toBool(env.RFMO_CAPTURE_ENVELOPES),
			envelopesDir: env.RFMO_ENVELOPES_DIR || ''
		},
		fedsfmPortal: {
			origin: env.FEDSFMPORTAL_ORIGIN || 'https://portal.fedsfm.ru',
			login: env.FEDSFMPORTAL_LOGIN || env.RFMO_API_USERNAME || '',
			password: env.FEDSFMPORTAL_PASSWORD || env.RFMO_API_PASSWORD || '',
			pageSize: Number(env.FEDSFMPORTAL_NOTIFICATIONS_PAGE_SIZE || 100),
			tlsVerify: env.FEDSFMPORTAL_TLS_VERIFY === undefined
				? true
				: toBool(env.FEDSFMPORTAL_TLS_VERIFY),
			maxAckPasses: Number(env.FEDSFMPORTAL_NOTIFICATIONS_ACK_PASSES || 5)
		}
	}
}

const config = loadConfig()

export {
	toBool,
	loadConfig
}

export default config
