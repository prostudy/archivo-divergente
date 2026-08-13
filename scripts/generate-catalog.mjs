import { createHash } from 'node:crypto'
import { execFile, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { extname, join, relative, resolve } from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import YAML from 'yaml'

const root = resolve(import.meta.dirname, '..')
const publicDir = join(root, 'public')
const thumbsDir = join(publicDir, 'thumbs')
const cacheDir = join(root, '.catalog-cache')
const taxonomyPath = join(root, 'taxonomy.yml')
const supported = new Set(['.pdf', '.m4a', '.mp4', '.png', '.txt', '.md', '.docx'])
const typeByExtension = {
  '.pdf': 'pdf',
  '.m4a': 'audio',
  '.mp4': 'video',
  '.png': 'image',
  '.txt': 'text',
  '.md': 'text',
  '.docx': 'document',
}
const mimeByExtension = {
  '.pdf': 'application/pdf',
  '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4',
  '.png': 'image/png',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
}
const stopWords = new Set(['para', 'como', 'esto', 'esta', 'este', 'the', 'and', 'with', 'from', 'your', 'una', 'del', 'las', 'los', 'que', 'por', 'segun'])
const execFileAsync = promisify(execFile)

mkdirSync(publicDir, { recursive: true })
mkdirSync(thumbsDir, { recursive: true })
mkdirSync(cacheDir, { recursive: true })

const taxonomy = YAML.parse(readFileSync(taxonomyPath, 'utf8'))
const mediaBase = taxonomy.site.mediaBaseUrl.replace(/\/$/, '')
const downloadBase = taxonomy.site.downloadBaseUrl
const verifyRemote = process.argv.includes('--verify')
const doOcr = !process.argv.includes('--no-ocr')
const previousCatalog = existsSync(join(publicDir, 'catalog.json'))
  ? JSON.parse(readFileSync(join(publicDir, 'catalog.json'), 'utf8'))
  : { resources: [] }
const previousSearchEntries = existsSync(join(publicDir, 'search-index.json'))
  ? JSON.parse(readFileSync(join(publicDir, 'search-index.json'), 'utf8')).entries || []
  : []
const previousResourcesByFile = new Map(previousCatalog.resources.map((resource) => [`${resource.collectionId}/${resource.filename}`, resource]))

function slugify(value) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

function displayTitle(filename) {
  return filename
    .replace(extname(filename), '')
    .replace(/\s*\(\d+\)$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function encodePath(path) {
  return path.split('/').map(encodeURIComponent).join('/')
}

function hashFile(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function firstParagraph(markdown) {
  const clean = markdown
    .replace(/^---[\s\S]*?---\s*/, '')
    .replace(/^#+\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
  const sentence = clean.match(/^.{80,360}?[.!?](?:\s|$)/)?.[0] || clean.slice(0, 300)
  return sentence.trim()
}

function inferTags(title, collectionTags, type) {
  const titleTags = title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 4 && !stopWords.has(word))
    .slice(0, 3)
  return [...new Set([...collectionTags, type, ...titleTags])]
}

function readResourceOverrides(collectionDir) {
  const path = join(collectionDir, 'recursos.yml')
  if (!existsSync(path)) return []
  const parsed = YAML.parse(readFileSync(path, 'utf8'))
  return Array.isArray(parsed) ? parsed : parsed?.resources || []
}

function writeResourceOverrides(collectionDir, resources) {
  const path = join(collectionDir, 'recursos.yml')
  const content = YAML.stringify({
    resources: resources.map(({ id, file, title, tags, summary, featured }) => ({
      id,
      file,
      title,
      tags,
      ...(summary ? { summary } : {}),
      ...(featured ? { featured: true } : {}),
    })),
  }, { lineWidth: 0 })
  writeFileSync(path, content)
}

function commandAvailable(command) {
  try {
    execFileSync('sh', ['-c', `command -v ${command}`], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

const canExtractPdf = commandAvailable('pdftotext')
const canRenderPdf = commandAvailable('pdftoppm')
const canOcr = commandAvailable('tesseract')
const canWebp = commandAvailable('cwebp')

async function extractPdfPages(path, hash) {
  const cachedPath = join(cacheDir, `${hash}-${doOcr ? 'ocr' : 'text'}.json`)
  if (existsSync(cachedPath)) return JSON.parse(readFileSync(cachedPath, 'utf8'))

  let extracted = ''
  if (canExtractPdf) {
    try {
      extracted = execFileSync('pdftotext', ['-layout', path, '-'], { encoding: 'utf8', maxBuffer: 30 * 1024 * 1024 })
    } catch {
      extracted = ''
    }
  }

  let pages = extracted.split('\f').map((text, index) => ({ page: index + 1, text: text.replace(/\s+/g, ' ').trim() })).filter((page) => page.text)
  const visibleText = pages.reduce((total, page) => total + page.text.length, 0)

  if (visibleText < 120 && doOcr && canRenderPdf && canOcr) {
    let pageCount = 1
    try {
      const info = execFileSync('pdfinfo', [path], { encoding: 'utf8' })
      pageCount = Number(info.match(/^Pages:\s+(\d+)/m)?.[1] || 1)
    } catch {
      pageCount = 1
    }

    const pendingPages = []
    for (let page = 1; page <= pageCount; page += 1) {
      const imageBase = join(cacheDir, `${hash}-ocr-${page}`)
      const imagePath = `${imageBase}.png`
      if (!existsSync(imagePath)) {
        execFileSync('pdftoppm', ['-f', String(page), '-l', String(page), '-singlefile', '-scale-to-x', '1600', '-scale-to-y', '-1', '-png', path, imageBase], { stdio: 'ignore' })
      }
      pendingPages.push({ page, imagePath })
    }

    pages = []
    for (let index = 0; index < pendingPages.length; index += 4) {
      const batch = await Promise.all(pendingPages.slice(index, index + 4).map(async ({ page, imagePath }) => {
        try {
          const { stdout } = await execFileAsync('tesseract', [imagePath, 'stdout', '-l', 'spa+eng', '--psm', '6'], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 })
          return { page, text: stdout.replace(/\s+/g, ' ').trim() }
        } catch {
          return { page, text: '' }
        }
      }))
      pages.push(...batch)
    }
  }

  writeFileSync(cachedPath, JSON.stringify(pages))
  return pages
}

function generateThumbnail(path, resourceId, type, pairedPdf) {
  const output = join(thumbsDir, `${resourceId}.webp`)
  if (existsSync(output)) return `./thumbs/${resourceId}.webp`
  if (!canWebp) return null

  try {
    if (type === 'image') {
      execFileSync('cwebp', ['-quiet', '-resize', '720', '0', '-q', '76', path, '-o', output])
      return `./thumbs/${resourceId}.webp`
    }
    const pdfSource = type === 'pdf' ? path : pairedPdf
    if (pdfSource && canRenderPdf) {
      const base = join(cacheDir, `${resourceId}-cover`)
      const png = `${base}.png`
      execFileSync('pdftoppm', ['-f', '1', '-l', '1', '-singlefile', '-scale-to-x', '720', '-scale-to-y', '-1', '-png', pdfSource, base], { stdio: 'ignore' })
      execFileSync('cwebp', ['-quiet', '-q', '76', png, '-o', output])
      return `./thumbs/${resourceId}.webp`
    }
  } catch {
    return null
  }
  return null
}

async function verify(url, requireRange = false, expectedMime = '') {
  const response = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(15_000) })
  if (!response.ok) throw new Error(`${response.status} ${url}`)
  if (!response.headers.get('access-control-allow-origin')) throw new Error(`Falta CORS en ${url}`)
  if (requireRange && !response.headers.get('accept-ranges')) throw new Error(`Falta Accept-Ranges en ${url}`)
  if (expectedMime && !response.headers.get('content-type')?.toLowerCase().startsWith(expectedMime.toLowerCase())) {
    throw new Error(`MIME inesperado en ${url}: ${response.headers.get('content-type') || 'sin Content-Type'}`)
  }
}

async function verifyDownload(url) {
  const response = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(15_000) })
  if (!response.ok) throw new Error(`${response.status} ${url}`)
  if (!response.headers.get('content-disposition')?.toLowerCase().startsWith('attachment')) {
    throw new Error(`La descarga no fuerza attachment en ${url}`)
  }
}

const territories = [...taxonomy.territories].sort((a, b) => a.order - b.order)
const collections = []
const resources = []
const searchEntries = []
const usedResourceIds = new Set()

for (const [slug, config] of Object.entries(taxonomy.collections)) {
  const collectionDir = join(root, slug)
  if (!existsSync(collectionDir)) continue
  const descriptionPath = join(collectionDir, 'descripcion.md')
  const description = existsSync(descriptionPath) ? readFileSync(descriptionPath, 'utf8').trim() : ''
  const summary = description ? firstParagraph(description) : `Notas y recursos de ${config.title.toLowerCase()}.`
  const existingOverrides = readResourceOverrides(collectionDir)
  const overridesByFile = new Map(existingOverrides.map((entry) => [entry.file, entry]))
  const localFileNames = readdirSync(collectionDir)
    .filter((name) => supported.has(extname(name).toLowerCase()) && name !== 'descripcion.md')
    .sort((a, b) => a.localeCompare(b, 'es'))
  const fileNames = [...new Set([...localFileNames, ...existingOverrides.map((entry) => entry.file).filter(Boolean)])]
    .sort((a, b) => a.localeCompare(b, 'es'))
  const generatedOverrides = []

  collections.push({
    id: slug,
    title: config.title,
    territoryId: config.territory,
    description,
    summary,
    tags: config.tags,
    order: config.order,
    resourceCount: fileNames.length,
  })
  searchEntries.push({ id: `collection:${slug}`, kind: 'collection', collectionId: slug, resourceId: null, page: null, title: config.title, tags: config.tags, text: `${config.title} ${summary} ${description}` })

  const pdfByStem = new Map(fileNames.filter((name) => extname(name).toLowerCase() === '.pdf').map((name) => [displayTitle(name).toLowerCase(), join(collectionDir, name)]))

  for (const filename of fileNames) {
    const extension = extname(filename).toLowerCase()
    const type = typeByExtension[extension]
    const override = overridesByFile.get(filename) || {}
    const title = override.title || displayTitle(filename)
    const baseId = override.id || slugify(`${slug}-${title}`)
    const id = usedResourceIds.has(baseId) ? `${baseId}-${type}` : baseId
    usedResourceIds.add(id)
    const filePath = join(collectionDir, filename)
    const hasLocalFile = existsSync(filePath)
    const previousResource = previousResourcesByFile.get(`${slug}/${filename}`)
    if (!hasLocalFile && !previousResource) {
      console.warn(`Se omitió ${slug}/${filename}: no existe localmente ni en el catálogo anterior.`)
      continue
    }
    const relativePath = relative(root, filePath).split('\\').join('/')
    const hash = hasLocalFile ? hashFile(filePath) : previousResource.hash
    const tags = override.tags?.length ? override.tags : inferTags(title, config.tags, type)
    const resourceSummary = override.summary || summary
    const encodedPath = encodePath(relativePath)
    const url = `${mediaBase}/${encodedPath}`
    const downloadUrl = `${downloadBase}?path=${encodeURIComponent(relativePath)}`
    const pairedPdf = type === 'document' ? pdfByStem.get(title.toLowerCase()) : null
    const thumbnail = hasLocalFile ? generateThumbnail(filePath, id, type, pairedPdf) : previousResource.thumbnail
    const stats = hasLocalFile ? statSync(filePath) : null
    let pageCount = previousResource?.pageCount || null
    let textContent = previousResource?.textContent || null

    if (!hasLocalFile && previousResource) {
      const preservedEntries = previousSearchEntries
        .filter((entry) => entry.resourceId === previousResource.id)
        .map((entry) => ({ ...entry, resourceId: id, title, tags }))
      searchEntries.push(...(preservedEntries.length ? preservedEntries : [{ id: `resource:${id}`, kind: 'resource', collectionId: slug, resourceId: id, page: null, title, tags, text: `${title} ${resourceSummary}` }]))
    } else if (type === 'pdf') {
      const pages = await extractPdfPages(filePath, hash)
      pageCount = pages.length || null
      for (const page of pages) {
        if (!page.text) continue
        searchEntries.push({ id: `resource:${id}:page:${page.page}`, kind: 'resource', collectionId: slug, resourceId: id, page: page.page, title, tags, text: page.text })
      }
    } else if (type === 'text') {
      textContent = readFileSync(filePath, 'utf8')
      searchEntries.push({ id: `resource:${id}`, kind: 'resource', collectionId: slug, resourceId: id, page: null, title, tags, text: textContent })
    } else {
      searchEntries.push({ id: `resource:${id}`, kind: 'resource', collectionId: slug, resourceId: id, page: null, title, tags, text: `${title} ${resourceSummary}` })
    }

    const relatedPdf = type === 'document'
      ? resources.find((resource) => resource.collectionId === slug && resource.type === 'pdf' && resource.title.toLowerCase() === title.toLowerCase())?.id || null
      : null

    resources.push({
      id,
      collectionId: slug,
      title,
      filename,
      type,
      mime: mimeByExtension[extension],
      url,
      downloadUrl,
      thumbnail,
      size: stats?.size ?? previousResource?.size ?? 0,
      updatedAt: stats?.mtime.toISOString() ?? previousResource?.updatedAt ?? new Date().toISOString(),
      tags,
      summary: resourceSummary,
      featured: Boolean(override.featured),
      pageCount,
      textContent,
      relatedPdf,
      hash,
    })
    generatedOverrides.push({ id, file: filename, title, tags, summary: override.summary, featured: override.featured })

    if (verifyRemote) {
      await verify(url, type === 'audio' || type === 'video' || type === 'pdf', mimeByExtension[extension].split(';')[0])
      await verifyDownload(downloadUrl)
    }
  }

  writeResourceOverrides(collectionDir, generatedOverrides)
}

const catalog = {
  version: 1,
  generatedAt: new Date().toISOString(),
  site: taxonomy.site,
  territories,
  collections,
  resources,
}

for (const resource of resources) {
  if (resource.type !== 'document' || resource.relatedPdf) continue
  resource.relatedPdf = resources.find((candidate) =>
    candidate.collectionId === resource.collectionId
    && candidate.type === 'pdf'
    && candidate.title.toLowerCase() === resource.title.toLowerCase(),
  )?.id || null
}

writeFileSync(join(publicDir, 'catalog.json'), JSON.stringify(catalog, null, 2))
writeFileSync(join(publicDir, 'search-index.json'), JSON.stringify({ version: 1, entries: searchEntries }, null, 2))

console.log(`Catálogo listo: ${collections.length} colecciones, ${resources.length} recursos y ${searchEntries.length} fragmentos de búsqueda.`)
