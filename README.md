# RFMO API Client for Node.js

Small standalone Node.js client for RFMO API calls through an mTLS gateway.

## What This Repository Contains

- Node.js `24.15.0` ESM project.
- Docker image based on `node:24.15.0-bookworm-slim`.
- `RfmoApi` client with token caching, retries, binary downloads, and optional
  request/response envelope capture.
- CLI example for manual RFMO calls.
- Unit tests with mocked HTTP responses only.

This repository does not implement GOST mTLS by itself. RFMO requests are sent
to a local or network mTLS gateway, then the gateway connects to RFMO with the
client certificate.

Use this mTLS gateway example:

https://github.com/omggga/mtls

The implementation was checked against RFMO user guide version `1.2`
dated `28.08.2025` for NFO/NKO service users.

## Architecture

```text
your code / this client
  -> http://localhost:3010/rfmo/...
  -> mTLS gateway from https://github.com/omggga/mtls
  -> https://portal.fedsfm.ru:8081/Services/fedsfm-service/...
```

The RFMO mTLS profile in the gateway repository maps `/rfmo/` to
`portal.fedsfm.ru:8081/Services/fedsfm-service`. This client only needs the
gateway URL and RFMO username/password.

## Install

```bash
npm install
npm test
```

The package has no runtime dependencies. It uses Node.js built-in `fetch`,
`AbortController`, `URLSearchParams`, and `node:test`.

## Configuration

Copy `.env.example` to `.env` or provide the same values through your runtime
environment.

```bash
RFMO_API_USERNAME=your-rfmo-login
RFMO_API_PASSWORD=your-rfmo-password

RFMO_MTLS_PROTOCOL=http
RFMO_MTLS_HOST=localhost
RFMO_MTLS_PORT=3010
RFMO_MTLS_PATH=/rfmo

RFMO_CONTOUR=prod
RFMO_API_TIMEOUT_MS=60000
RFMO_API_RETRY_ATTEMPTS=2
RFMO_CAPTURE_ENVELOPES=0
RFMO_ENVELOPES_DIR=./rfmo-envelopes
```

Do not commit real RFMO credentials, private keys, certificates, PINs, or real
certificate thumbprints.

## Run With Local Node

Node.js can load the env file directly:

```bash
node --env-file=.env src/cli.js te21-catalog
node --env-file=.env src/cli.js mvk-catalog
node --env-file=.env src/cli.js un-catalog
```

For the test contour, set `RFMO_CONTOUR=test`. The client will call
`test-contur/...` methods and keep a separate cached JWT token:

```bash
RFMO_CONTOUR=test node --env-file=.env src/cli.js te2-catalog
```

Download methods require `idXml` from the corresponding catalog response:

```bash
node --env-file=.env src/cli.js te2-file "<idXml>" te2-file.zip
node --env-file=.env src/cli.js te21-file "<idXml>" te21-file.zip
node --env-file=.env src/cli.js mvk-file-zip "<idXml>" mvk-file.zip
node --env-file=.env src/cli.js un-file "<idXml>" un-file.xml
```

Formalized message calls:

```bash
node --env-file=.env src/cli.js send-message message.xml message.sig
node --env-file=.env src/cli.js send-message-with-mchd message.xml message.sig mchd.xml mchd.sig
node --env-file=.env src/cli.js check-status "<IdFormalizedMessage>" "<IdExternal>"
node --env-file=.env src/cli.js get-ticket "<IdFormalizedMessage>" "<IdExternal>" ticket.bin
```

## Run With Docker

Build this client:

```bash
docker build -t rfmo-api-client:local .
```

Run it against a gateway reachable from the container:

```bash
docker run --rm --env-file .env \
  -e RFMO_MTLS_HOST=host.docker.internal \
  rfmo-api-client:local node src/cli.js te21-catalog
```

If this container and the mTLS gateway are in the same Docker network, set
`RFMO_MTLS_HOST` to the gateway container name instead.

## Library Usage

```js
import { RfmoApi } from '@omggga/rfmo'

const api = new RfmoApi()

const catalog = await api.getCurrentTe21Catalog()
const fileZip = await api.getTe21File(catalog.idXml)
```

Test contour:

```js
const api = new RfmoApi({ contour: 'test' })

const catalog = await api.getCurrentTe2Catalog()
const fileZip = await api.getTe2File(catalog.idXml)
```

Formalized messages:

```js
import { promises as fs } from 'node:fs'

const result = await api.sendFormalizedMessage({
  file: { data: await fs.readFile('message.xml'), filename: 'message.xml' },
  sign: { data: await fs.readFile('message.sig'), filename: 'message.sig' }
})

const status = await api.checkFormalizedMessageStatus({
  IdFormalizedMessage: result.IdFormalizedMessage,
  IdExternal: result.IdExternal
})
```

You can also pass config directly instead of using environment variables:

```js
import { RfmoApi } from './src/index.js'

const api = new RfmoApi({
  contour: 'prod',
  rfmo: {
    protocol: 'http',
    host: 'localhost',
    port: 3010,
    path: '/rfmo',
    username: process.env.RFMO_API_USERNAME,
    password: process.env.RFMO_API_PASSWORD,
    timeoutMs: 60000,
    retryAttempts: 2
  }
})
```

## Supported Methods

| Method | RFMO path | Result |
| --- | --- | --- |
| `authenticate()` | `authenticate` | JWT access token |
| `getCurrentTe2Catalog()` | `suspect-catalogs/current-te2-catalog` | legacy/test catalog JSON |
| `getTe2File(idXml)` | `suspect-catalogs/current-te2-file` | `Buffer` with ZIP payload |
| `getCurrentTe21Catalog()` | `suspect-catalogs/current-te21-catalog` | catalog JSON |
| `getTe21File(idXml)` | `suspect-catalogs/current-te21-file` | `Buffer` with ZIP payload |
| `getCurrentMvkCatalog()` | `suspect-catalogs/current-mvk-catalog` | catalog JSON |
| `getMvkFileZip(idXml)` | `suspect-catalogs/current-mvk-file-zip` | `Buffer` with ZIP payload |
| `getCurrentUnCatalog()` | `suspect-catalogs/current-un-catalog` | catalog JSON |
| `getCurrentUnCatalogRus()` | `suspect-catalogs/current-un-catalog-rus` | catalog JSON |
| `getUnFile(idXml)` | `suspect-catalogs/current-un-file` | `Buffer` with XML payload |
| `sendFormalizedMessage({ file, sign })` | `formalized-message/send` | registration JSON |
| `sendFormalizedMessageWithMchd({ file, sign, mchd, mchdSign })` | `formalized-message/send-with-mchd` | registration JSON |
| `checkFormalizedMessageStatus(ref)` | `formalized-message/check-status` | status JSON |
| `getFormalizedMessageTicket(ref)` | `formalized-message/get-ticket` | `Buffer` with ticket payload |

Catalog responses are normalized so `Date`, `IdXml`, and `IsActive` are also
available as `date`, `idXml`, and `isActive`.

When `contour: 'test'` or `RFMO_CONTOUR=test` is used, method paths are prefixed
with `test-contur/`.

## Envelope Capture

For debugging, set:

```bash
RFMO_CAPTURE_ENVELOPES=1
RFMO_ENVELOPES_DIR=./rfmo-envelopes
```

The client writes paired `*.request.json` and `*.response.json` files. Passwords
and bearer tokens are masked. Binary responses are saved as base64.

Envelope capture is best-effort: a file write failure never breaks the API call.

## Testing

```bash
npm test
npm run check
```

Tests are unit tests only. They do not call RFMO and do not require the mTLS
gateway, RFMO credentials, certificates, CryptoPro, or network access.

## mTLS Gateway Notes

In the gateway repository, configure the `rfmo` profile in `conf/profiles.yaml`
with your real client certificate thumbprint and trust chain:

```yaml
profiles:
  - profile: rfmo
    incoming:
      path_prefix: /rfmo/
    upstream:
      scheme: https
      host: portal.fedsfm.ru
      port: 8081
      soap_path: /Services/fedsfm-service
    mtls:
      client_cert_thumbprint: "CHANGE_ME_RFMO_CLIENT_CERT_THUMBPRINT"
      sni_host: portal.fedsfm.ru
      host_header: portal.fedsfm.ru
```

Then point this client to the gateway with `RFMO_MTLS_HOST`,
`RFMO_MTLS_PORT`, and `RFMO_MTLS_PATH`.
