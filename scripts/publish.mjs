import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { createInterface } from 'node:readline/promises'

const root = resolve(import.meta.dirname, '..')
const skipVerify = process.argv.includes('--skip-verify')
const noGit = process.argv.includes('--no-git')

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', ...options })
  if (result.status !== 0) process.exit(result.status || 1)
}

run(process.execPath, [join(root, 'scripts/generate-catalog.mjs'), ...(skipVerify ? [] : ['--verify'])])
run('npm', ['test'])
run('npm', ['run', 'build'])

if (noGit || !process.stdin.isTTY || !existsSync(join(root, '.git'))) {
  console.log('Contenido preparado. Haz commit y push para publicar GitHub Pages.')
  process.exit(0)
}

const rl = createInterface({ input: process.stdin, output: process.stdout })
const answer = await rl.question('¿Preparar commit y enviar los cambios a GitHub? [s/N] ')
rl.close()
if (!/^s(i|í)?$/i.test(answer.trim())) {
  console.log('Los archivos quedaron preparados, sin commit ni push.')
  process.exit(0)
}

const categoryMetadata = readdirSync(root, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .flatMap((entry) => ['descripcion.md', 'recursos.yml'].map((file) => join(entry.name, file)))
  .filter((path) => existsSync(join(root, path)))
const generated = ['taxonomy.yml', 'public/catalog.json', 'public/search-index.json', 'public/thumbs', 'public/analisis']

run('git', ['add', '--', ...generated, ...categoryMetadata])
run('git', ['commit', '-m', `content: actualizar Archivo Divergente ${new Date().toISOString().slice(0, 10)}`])

const remote = spawnSync('git', ['remote'], { cwd: root, encoding: 'utf8' }).stdout.trim()
if (!remote) {
  console.log('Commit creado. Configura el remoto de GitHub y ejecuta git push -u origin main.')
  process.exit(0)
}
run('git', ['push'])
