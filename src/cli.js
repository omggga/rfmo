#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises'
import nodePath from 'node:path'
import RfmoApi from './api.js'

const COMMANDS = new Set([
	'auth',
	'te2-catalog',
	'te2-file',
	'te21-catalog',
	'te21-file',
	'mvk-catalog',
	'mvk-file-zip',
	'un-catalog',
	'un-catalog-rus',
	'un-file',
	'send-message',
	'send-message-with-mchd',
	'check-status',
	'get-ticket'
])

async function main(argv) {
	const [command = 'te21-catalog', arg, outputPath] = argv

	if (!COMMANDS.has(command)) {
		printUsage()
		process.exitCode = 1
		return
	}

	const api = new RfmoApi()

	switch (command) {
		case 'auth': {
			const token = await api.authenticate(true)
			console.log(JSON.stringify({ accessToken: token }, null, 2))
			return
		}
		case 'te2-catalog':
			return printJson(await api.getCurrentTe2Catalog())
		case 'te2-file':
			return writeBinary(await api.getTe2File(arg), outputPath || 'te2-file.zip')
		case 'te21-catalog':
			return printJson(await api.getCurrentTe21Catalog())
		case 'te21-file':
			return writeBinary(await api.getTe21File(arg), outputPath || 'te21-file.zip')
		case 'mvk-catalog':
			return printJson(await api.getCurrentMvkCatalog())
		case 'mvk-file-zip':
			return writeBinary(await api.getMvkFileZip(arg), outputPath || 'mvk-file.zip')
		case 'un-catalog':
			return printJson(await api.getCurrentUnCatalog())
		case 'un-catalog-rus':
			return printJson(await api.getCurrentUnCatalogRus())
		case 'un-file':
			return writeBinary(await api.getUnFile(arg), outputPath || 'un-file.xml')
		case 'send-message':
			return printJson(await api.sendFormalizedMessage({
				file: await readBinaryPart(arg),
				sign: await readBinaryPart(outputPath)
			}))
		case 'send-message-with-mchd':
			return printJson(await api.sendFormalizedMessageWithMchd({
				file: await readBinaryPart(arg),
				sign: await readBinaryPart(outputPath),
				mchd: await readBinaryPart(argv[3]),
				mchdSign: await readBinaryPart(argv[4])
			}))
		case 'check-status':
			return printJson(await api.checkFormalizedMessageStatus({
				IdFormalizedMessage: arg,
				IdExternal: outputPath
			}))
		case 'get-ticket':
			return writeBinary(
				await api.getFormalizedMessageTicket({
					IdFormalizedMessage: arg,
					IdExternal: outputPath
				}),
				argv[3] || 'ticket.bin'
			)
	}
}

function printJson(payload) {
	console.log(JSON.stringify(payload, null, 2))
}

async function writeBinary(buffer, outputPath) {
	await writeFile(outputPath, buffer)
	console.log(JSON.stringify({ outputPath, bytes: buffer.length }, null, 2))
}

async function readBinaryPart(path) {
	if (!path) return null
	return {
		data: await readFile(path),
		filename: nodePath.basename(path)
	}
}

function printUsage() {
	console.error(`Usage:
  node src/cli.js auth
  node src/cli.js te2-catalog
  node src/cli.js te2-file <idXml> [output.zip]
  node src/cli.js te21-catalog
  node src/cli.js te21-file <idXml> [output.zip]
  node src/cli.js mvk-catalog
  node src/cli.js mvk-file-zip <idXml> [output.zip]
  node src/cli.js un-catalog
  node src/cli.js un-catalog-rus
  node src/cli.js un-file <idXml> [output.xml]
  node src/cli.js send-message <file> <sign>
  node src/cli.js send-message-with-mchd <file> <sign> <mchd> <mchd-sign>
  node src/cli.js check-status <IdFormalizedMessage> <IdExternal>
  node src/cli.js get-ticket <IdFormalizedMessage> <IdExternal> [output.bin]`)
}

main(process.argv.slice(2)).catch((err) => {
	console.error(err)
	process.exitCode = 1
})
