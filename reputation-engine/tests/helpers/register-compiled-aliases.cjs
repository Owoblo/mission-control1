const Module = require('node:module')
const path = require('node:path')

// TypeScript preserves the app's @/ imports in the CommonJS test output.
const resolveFilename = Module._resolveFilename
Module._resolveFilename = function (request, parent, ...options) {
  const resolved = request.startsWith('@/')
    ? path.resolve(__dirname, '../../.tmp-logic-tests', request.slice(2))
    : request
  return resolveFilename.call(this, resolved, parent, ...options)
}
