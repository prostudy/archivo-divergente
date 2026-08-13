import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import test from 'node:test'

const root = resolve(import.meta.dirname, '..')
const catalog = JSON.parse(readFileSync(join(root, 'public/catalog.json'), 'utf8'))
const searchIndex = JSON.parse(readFileSync(join(root, 'public/search-index.json'), 'utf8'))

test('el catálogo contiene territorios, colecciones y recursos únicos', () => {
  assert.equal(catalog.territories.length, 4)
  assert.equal(catalog.collections.length, 14)
  assert.ok(catalog.resources.length >= 59)
  assert.equal(new Set(catalog.resources.map((resource) => resource.id)).size, catalog.resources.length)
})

test('cada recurso pertenece a una colección y usa URLs web seguras', () => {
  const collectionIds = new Set(catalog.collections.map((collection) => collection.id))
  for (const resource of catalog.resources) {
    assert.ok(collectionIds.has(resource.collectionId), `${resource.id} no tiene colección`)
    assert.match(resource.url, /^https:\/\/agilpm\.com\/conocimiento\//)
    assert.equal(resource.url.includes(' '), false, `${resource.id} contiene espacios sin codificar`)
    assert.match(resource.downloadUrl, /^https:\/\/agilpm\.com\/conocimiento\/download\.php\?path=/)
  }
})

test('el índice no apunta a recursos huérfanos', () => {
  const resourceIds = new Set(catalog.resources.map((resource) => resource.id))
  const collectionIds = new Set(catalog.collections.map((collection) => collection.id))
  for (const entry of searchIndex.entries) {
    assert.ok(collectionIds.has(entry.collectionId), `${entry.id} tiene una colección inexistente`)
    if (entry.resourceId) assert.ok(resourceIds.has(entry.resourceId), `${entry.id} tiene un recurso inexistente`)
  }
})

test('los PDF visuales conservan búsqueda por página', () => {
  const pdfPages = searchIndex.entries.filter((entry) => entry.resourceId && Number.isInteger(entry.page))
  assert.ok(pdfPages.length >= 180, `sólo se generaron ${pdfPages.length} páginas indexadas`)
  assert.ok(pdfPages.some((entry) => entry.text.toLowerCase().includes('inteligencia')))
})

test('el despliegue público sólo contiene activos ligeros', () => {
  const forbidden = new Set(['.pdf', '.m4a', '.mp4', '.docx'])
  const files = readdirSync(join(root, 'public'), { recursive: true, withFileTypes: true })
  for (const file of files) {
    if (!file.isFile()) continue
    assert.equal(forbidden.has(extname(file.name).toLowerCase()), false, `${file.name} no debe publicarse en GitHub Pages`)
  }
})
