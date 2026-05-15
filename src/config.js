const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on'])

function toBool(value) {
	return TRUE_VALUES.has(String(value || '').toLowerCase())
}

function loadConfig(env = process.env) {
	return {
		rfmo: {
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
		}
	}
}

const config = loadConfig()

export {
	toBool,
	loadConfig
}

export default config
