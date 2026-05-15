class RfmoApiUsageError extends Error {
	constructor(message) {
		super(message)
		this.name = 'RfmoApiUsageError'
		this.retryable = false
	}
}

class RfmoApiHttpError extends Error {
	constructor(methodPath, url, response, responseBody = '') {
		super(`RFMO API HTTP error [${response.status}] ${response.statusText}; method=${methodPath}; url=${url}`)
		this.name = 'RfmoApiHttpError'
		this.methodPath = methodPath
		this.url = url
		this.status = response.status
		this.statusText = response.statusText
		this.responseBody = responseBody
	}
}

export {
	RfmoApiUsageError,
	RfmoApiHttpError
}
