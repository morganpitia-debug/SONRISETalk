import path from 'node:path'
import express from 'express'

export function serveWebClient(app, buildDirectory) {
  app.use(express.static(buildDirectory, { index: false, maxAge: '1h' }))
  app.use((request, response, next) => {
    if (request.method !== 'GET' || request.path === '/api' || request.path.startsWith('/api/') || !request.accepts('html')) {
      next()
      return
    }
    response.sendFile(path.join(buildDirectory, 'index.html'), (error) => {
      if (error) next(error)
    })
  })
}
