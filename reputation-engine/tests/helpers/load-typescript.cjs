const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
module.exports = function createLoader(root, mocks = {}) {
  const cache = new Map()
  function load(file) {
    file = path.resolve(file)
    if (cache.has(file)) return cache.get(file).exports
    const mod = { exports: {} }; cache.set(file, mod)
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
    function resolve(specifier) {
      if (Object.hasOwn(mocks, specifier)) return mocks[specifier]
      const candidate = specifier.startsWith('@/') ? path.join(root, specifier.slice(2)) : specifier.startsWith('.') ? path.resolve(path.dirname(file), specifier) : null
      if (!candidate) return require(specifier)
      for (const name of [candidate + '.ts', candidate + '.tsx', candidate + '/index.ts']) if (fs.existsSync(name)) return load(name)
      return require(candidate)
    }
    new Function('require', 'module', 'exports', code)(resolve, mod, mod.exports)
    return mod.exports
  }
  return load
}
