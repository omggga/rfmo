#!/usr/bin/env node
import { writeFile } from 'node:fs/promises'
import RfmoApi from './api.js'

const COMMANDS = new Set([
	'auth',
	'te21-catalog',
	'te21-file',
	'mvk-catalog',
	'mvk-file-zip',
	'un-catalog',
	'un-catalog-rus',
	'un-file'
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
	}
}

function printJson(payload) {
	console.log(JSON.stringify(payload, null, 2))
}

async function writeBinary(buffer, outputPath) {
	await writeFile(outputPath, buffer)
	console.log(JSON.stringify({ outputPath, bytes: buffer.length }, null, 2))
}

function printUsage() {
	console.error(`Usage:
  node src/cli.js auth
  node src/cli.js te21-catalog
  node src/cli.js te21-file <idXml> [output.zip]
  node src/cli.js mvk-catalog
  node src/cli.js mvk-file-zip <idXml> [output.zip]
  node src/cli.js un-catalog
  node src/cli.js un-catalog-rus
  node src/cli.js un-file <idXml> [output.xml]`)
}

main(process.argv.slice(2)).catch((err) => {
	console.error(err)
	process.exitCode = 1
})
