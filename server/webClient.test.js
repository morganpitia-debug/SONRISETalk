import assert from 'node:assert/strict'
import { once } from 'node:events'
import express from 'express'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { serveWebClient } from './webClient.js'

test('web client serves the frontend root and application routes without swallowing API paths', async (context) => {
  const buildDirectory = await mkdtemp(path.join(tmpdir(), 'sonrisetalk-web-build-'))
  await mkdir(path.join(buildDirectory, 'assets'))
  await writeFile(path.join(buildDirectory, 'index.html'), '<div id="root">SONRISETALK</div>')
  await writeFile(path.join(buildDirectory, 'assets', 'app.js'), 'window.appReady = true')
  await writeFile(path.join(buildDirectory, 'manifest.webmanifest'), '{"name":"SONRISETALK"}')
  await writeFile(path.join(buildDirectory, 'service-worker.js'), 'self.addEventListener("push", () => {})')
  context.after(() => rm(buildDirectory, { recursive: true, force: true }))

  const app = express()
  app.get('/api/health', (_request, response) => response.json({ status: 'ok' }))
  serveWebClient(app, buildDirectory)
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  context.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  }))
  const baseUrl = `http://127.0.0.1:${server.address().port}`

  const root = await fetch(baseUrl, { headers: { Accept: 'text/html' } })
  assert.equal(root.status, 200)
  assert.match(await root.text(), /SONRISETALK/)

  const appRoute = await fetch(`${baseUrl}/messages`, { headers: { Accept: 'text/html' } })
  assert.equal(appRoute.status, 200)
  assert.match(await appRoute.text(), /SONRISETALK/)

  const asset = await fetch(`${baseUrl}/assets/app.js`)
  assert.equal(asset.status, 200)
  assert.match(await asset.text(), /appReady/)

  const manifest = await fetch(`${baseUrl}/manifest.webmanifest`)
  assert.equal(manifest.status, 200)
  assert.match(manifest.headers.get('content-type'), /application\/manifest\+json/)
  assert.equal(manifest.headers.get('cache-control'), 'no-cache')

  const serviceWorker = await fetch(`${baseUrl}/service-worker.js`)
  assert.equal(serviceWorker.status, 200)
  assert.equal(serviceWorker.headers.get('cache-control'), 'no-cache')

  const health = await fetch(`${baseUrl}/api/health`)
  assert.equal(health.status, 200)
  assert.deepEqual(await health.json(), { status: 'ok' })

  const unknownApi = await fetch(`${baseUrl}/api/missing`, { headers: { Accept: 'text/html' } })
  assert.equal(unknownApi.status, 404)
})
