import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import process from 'node:process'

const root = resolve(import.meta.dirname, '..')
const indexPath = join(root, 'dist/index.html')
if (!existsSync(indexPath)) process.exit(0)

const [owner, repository] = (process.env.GITHUB_REPOSITORY || '').split('/')
const defaultUrl = owner && repository
  ? (repository.toLowerCase() === `${owner.toLowerCase()}.github.io`
      ? `https://${repository}`
      : `https://${owner}.github.io/${repository}`)
  : ''
const publicUrl = (process.env.PUBLIC_SITE_URL || defaultUrl).replace(/\/$/, '')

if (publicUrl) {
  const html = readFileSync(indexPath, 'utf8')
    .replaceAll('content="./og.png"', `content="${publicUrl}/og.png"`)
    .replace('</head>', `    <meta property="og:url" content="${publicUrl}/" />\n  </head>`)
  writeFileSync(indexPath, html)
  console.log(`Metadatos sociales preparados para ${publicUrl}`)
}
