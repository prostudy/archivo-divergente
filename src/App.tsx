import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Bookmark,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Download,
  FileText,
  Grid2X2,
  Headphones,
  Image as ImageIcon,
  LayoutList,
  Library,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Video,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import ReactMarkdown from 'react-markdown'
import type {
  Catalog,
  Collection,
  LibraryState,
  Resource,
  ResourceProgress,
  ResourceType,
  Territory,
} from './types'

type FullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void
}

type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null
  webkitExitFullscreen?: () => Promise<void> | void
}

type LockableOrientation = ScreenOrientation & {
  lock?: (orientation: 'landscape') => Promise<void>
  unlock?: () => void
}

const STORAGE_KEY = 'archivo-divergente:v1'
const emptyState: LibraryState = {
  version: 1,
  favorites: [],
  archived: [],
  recent: [],
  lastResourceId: null,
  progress: {},
  filters: {
    territory: 'all',
    type: 'all',
    tag: 'all',
    favoritesOnly: false,
    archivedOnly: false,
    viewMode: 'board',
  },
}

const typeLabels: Record<ResourceType, string> = {
  pdf: 'PDF',
  audio: 'Audio',
  video: 'Video',
  image: 'Imagen',
  text: 'Texto',
  document: 'Documento',
}

const typeIcons: Record<ResourceType, typeof FileText> = {
  pdf: FileText,
  audio: Headphones,
  video: Video,
  image: ImageIcon,
  text: FileText,
  document: FileText,
}

function loadLibraryState(): LibraryState {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '') as Partial<LibraryState>
    return {
      ...emptyState,
      ...stored,
      filters: { ...emptyState.filters, ...stored.filters },
      progress: stored.progress || {},
      archived: stored.archived || [],
      recent: stored.recent || [],
    }
  } catch {
    return emptyState
  }
}

function formatBytes(bytes: number) {
  if (!bytes) return ''
  const units = ['B', 'KB', 'MB', 'GB']
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / 1024 ** index).toFixed(index > 1 ? 1 : 0)} ${units[index]}`
}

function formatTime(seconds = 0) {
  if (!Number.isFinite(seconds)) return '0:00'
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remaining = Math.floor(seconds % 60)
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remaining).padStart(2, '0')}`
    : `${minutes}:${String(remaining).padStart(2, '0')}`
}

function progressPercent(resource: Resource, progress?: ResourceProgress) {
  if (!progress) return 0
  if (resource.type === 'pdf' && progress.page && (resource.pageCount || progress.pageCount)) {
    return Math.min(100, (progress.page / (resource.pageCount || progress.pageCount || 1)) * 100)
  }
  if ((resource.type === 'audio' || resource.type === 'video') && progress.seconds && progress.duration) {
    return Math.min(100, (progress.seconds / progress.duration) * 100)
  }
  if (resource.type === 'text' && progress.scroll) return Math.min(100, progress.scroll * 100)
  return 0
}

function LibraryMark() {
  return (
    <div className="library-mark" aria-hidden="true">
      <span />
      <span />
      <span />
    </div>
  )
}

function App() {
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [loadError, setLoadError] = useState('')
  const [libraryState, setLibraryState] = useState<LibraryState>(loadLibraryState)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [requestedPage, setRequestedPage] = useState<number | null>(null)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const lastFocusedElement = useRef<HTMLElement | null>(null)
  const recentCarouselRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}catalog.json`)
      .then((response) => {
        if (!response.ok) throw new Error('No pudimos abrir el catálogo.')
        return response.json() as Promise<Catalog>
      })
      .then((data) => {
        setCatalog(data)
        const params = new URLSearchParams(window.location.search)
        const resourceId = params.get('resource')
        const page = Number(params.get('page'))
        if (resourceId && data.resources.some((resource) => resource.id === resourceId)) {
          setSelectedId(resourceId)
          setRequestedPage(page > 0 ? page : null)
        }
      })
      .catch((error: Error) => setLoadError(error.message))
  }, [])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(libraryState))
  }, [libraryState])

  useEffect(() => {
    const onPopState = () => {
      const params = new URLSearchParams(window.location.search)
      setSelectedId(params.get('resource'))
      const page = Number(params.get('page'))
      setRequestedPage(page > 0 ? page : null)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && selectedId) closeResource()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  const updateState = useCallback((updater: (current: LibraryState) => LibraryState) => {
    setLibraryState((current) => updater(current))
  }, [])

  const saveProgress = useCallback((resourceId: string, update: Partial<ResourceProgress>) => {
    updateState((current) => ({
      ...current,
      progress: {
        ...current.progress,
        [resourceId]: {
          ...current.progress[resourceId],
          ...update,
          updatedAt: new Date().toISOString(),
        },
      },
    }))
  }, [updateState])

  const saveSelectedProgress = useCallback((update: Partial<ResourceProgress>) => {
    if (selectedId) saveProgress(selectedId, update)
  }, [saveProgress, selectedId])

  const collectionsById = useMemo(
    () => new Map(catalog?.collections.map((collection) => [collection.id, collection]) || []),
    [catalog],
  )
  const resourcesById = useMemo(
    () => new Map(catalog?.resources.map((resource) => [resource.id, resource]) || []),
    [catalog],
  )
  const territoriesById = useMemo(
    () => new Map(catalog?.territories.map((territory) => [territory.id, territory]) || []),
    [catalog],
  )

  const visibleResources = useMemo(() => {
    if (!catalog) return []
    return catalog.resources
      .filter((resource) => {
        const collection = collectionsById.get(resource.collectionId)
        const isArchived = libraryState.archived.includes(resource.id)
        if (libraryState.filters.archivedOnly ? !isArchived : isArchived) return false
        if (libraryState.filters.territory !== 'all' && collection?.territoryId !== libraryState.filters.territory) return false
        if (libraryState.filters.type !== 'all' && resource.type !== libraryState.filters.type) return false
        if (libraryState.filters.tag !== 'all' && !resource.tags.includes(libraryState.filters.tag)) return false
        if (libraryState.filters.favoritesOnly && !libraryState.favorites.includes(resource.id)) return false
        return true
      })
      .sort((a, b) => {
        const collectionA = collectionsById.get(a.collectionId)
        const collectionB = collectionsById.get(b.collectionId)
        return (collectionA?.order || 0) - (collectionB?.order || 0) || a.title.localeCompare(b.title, 'es')
      })
  }, [catalog, collectionsById, libraryState.archived, libraryState.favorites, libraryState.filters])

  const topTags = useMemo(() => {
    if (!catalog) return []
    const counts = new Map<string, number>()
    const formatTags = new Set(['pdf', 'audio', 'video', 'image', 'text', 'document'])
    catalog.resources.forEach((resource) => resource.tags.forEach((tag) => {
      if (!formatTags.has(tag.toLowerCase())) counts.set(tag, (counts.get(tag) || 0) + 1)
    }))
    return [...counts].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([tag]) => tag)
  }, [catalog])

  const recentResources = useMemo(
    () => libraryState.recent
      .map((resourceId) => resourcesById.get(resourceId))
      .filter((resource): resource is Resource => Boolean(resource))
      .filter((resource) => !libraryState.archived.includes(resource.id))
      .slice(0, 10),
    [libraryState.archived, libraryState.recent, resourcesById],
  )
  const selectedResource = selectedId ? resourcesById.get(selectedId) : undefined

  useEffect(() => {
    const viewerOpen = Boolean(selectedResource)
    document.documentElement.classList.toggle('viewer-open', viewerOpen)
    document.body.classList.toggle('viewer-open', viewerOpen)

    if (viewerOpen && window.scrollX !== 0) {
      window.scrollTo({ left: 0, top: window.scrollY, behavior: 'auto' })
    }

    return () => {
      document.documentElement.classList.remove('viewer-open')
      document.body.classList.remove('viewer-open')
    }
  }, [selectedResource])

  function openResource(resource: Resource, page: number | null = null) {
    lastFocusedElement.current = document.activeElement as HTMLElement | null
    const params = new URLSearchParams(window.location.search)
    params.set('resource', resource.id)
    if (page) params.set('page', String(page))
    else params.delete('page')
    window.history.pushState({}, '', `${window.location.pathname}?${params.toString()}`)
    setSelectedId(resource.id)
    setRequestedPage(page)
    updateState((current) => ({
      ...current,
      lastResourceId: resource.id,
      recent: [resource.id, ...current.recent.filter((id) => id !== resource.id)].slice(0, 10),
    }))
  }

  function scrollRecent(direction: -1 | 1) {
    const carousel = recentCarouselRef.current
    if (!carousel) return
    carousel.scrollBy({ left: direction * Math.max(280, carousel.clientWidth * .72), behavior: 'smooth' })
  }

  function clearRecent() {
    if (!window.confirm('¿Borrar los recursos recientes? Tu progreso y favoritos se conservarán.')) return
    updateState((current) => ({ ...current, lastResourceId: null, recent: [] }))
  }

  function closeResource() {
    const fullscreenDocument = document as FullscreenDocument
    ;(screen.orientation as LockableOrientation | undefined)?.unlock?.()
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined)
    else if (fullscreenDocument.webkitFullscreenElement) void fullscreenDocument.webkitExitFullscreen?.()
    const params = new URLSearchParams(window.location.search)
    params.delete('resource')
    params.delete('page')
    window.history.pushState({}, '', `${window.location.pathname}${params.size ? `?${params}` : ''}`)
    setSelectedId(null)
    setRequestedPage(null)
    window.setTimeout(() => lastFocusedElement.current?.focus(), 0)
  }

  function toggleFavorite(resourceId: string) {
    updateState((current) => ({
      ...current,
      favorites: current.favorites.includes(resourceId)
        ? current.favorites.filter((id) => id !== resourceId)
        : [resourceId, ...current.favorites],
    }))
  }

  function toggleArchive(resourceId: string) {
    updateState((current) => ({
      ...current,
      archived: current.archived.includes(resourceId)
        ? current.archived.filter((id) => id !== resourceId)
        : [resourceId, ...current.archived],
    }))
  }

  function setFilter<K extends keyof LibraryState['filters']>(key: K, value: LibraryState['filters'][K]) {
    updateState((current) => ({ ...current, filters: { ...current.filters, [key]: value } }))
  }

  if (loadError) {
    return (
      <main className="status-screen">
        <LibraryMark />
        <h1>No pudimos abrir la biblioteca.</h1>
        <p>{loadError}</p>
        <button type="button" onClick={() => window.location.reload()}><RotateCcw size={16} /> Intentar de nuevo</button>
      </main>
    )
  }

  if (!catalog) {
    return (
      <main className="status-screen status-screen--loading" aria-live="polite">
        <LibraryMark />
        <p>Abriendo un espacio para pensar…</p>
      </main>
    )
  }

  return (
    <div className={`app-shell ${selectedResource ? 'has-viewer' : ''}`}>
      <div className="ambient ambient--one" />
      <div className="ambient ambient--two" />
      <header className="site-header" aria-hidden={Boolean(selectedResource)}>
        <a className="brand" href={import.meta.env.BASE_URL} aria-label="Archivo Divergente, inicio">
          <LibraryMark />
          <span><strong>Archivo</strong> Divergente</span>
        </a>
        <div className="header-actions">
          <span className="quiet-status"><span /> Todo en calma</span>
          <button className="icon-button" type="button" onClick={() => setFiltersOpen((open) => !open)} aria-label="Abrir filtros" aria-expanded={filtersOpen}>
            <SlidersHorizontal size={18} />
          </button>
        </div>
      </header>

      <main className="content" aria-hidden={Boolean(selectedResource)}>
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-copy">
            <p className="eyebrow"><Sparkles size={13} /> Ideas para volver a lo que importa</p>
            <h1 id="hero-title">Un lugar para<br /><em>encontrar el hilo.</em></h1>
            <p className="hero-intro">Explora conexiones, retoma una lectura o deja que una palabra te lleve a la idea que necesitabas.</p>
          </div>
          <div className="hero-orbit" aria-hidden="true">
            <div className="orbit-line orbit-line--outer" />
            <div className="orbit-line orbit-line--inner" />
            <span className="orbit-dot orbit-dot--one" />
            <span className="orbit-dot orbit-dot--two" />
            <div className="orbit-center"><Library size={25} /></div>
          </div>
        </section>

        {recentResources.length > 0 && (
          <section className="continue-section" aria-labelledby="continue-title">
            <div className="section-heading continue-heading">
              <div>
                <p className="eyebrow"><Clock3 size={13} /> Tus últimas huellas</p>
                <h2 id="continue-title">Continúa donde estabas</h2>
              </div>
              <div className="continue-heading-actions">
                <span>{recentResources.length} {recentResources.length === 1 ? 'recurso reciente' : 'recursos recientes'}</span>
                <div className="continue-carousel-controls" aria-label="Controles del historial reciente">
                  <button type="button" onClick={() => scrollRecent(-1)} disabled={recentResources.length < 2} aria-label="Ver recursos anteriores"><ChevronLeft size={17} /></button>
                  <button type="button" onClick={() => scrollRecent(1)} disabled={recentResources.length < 2} aria-label="Ver recursos siguientes"><ChevronRight size={17} /></button>
                </div>
                <button className="clear-recent" type="button" onClick={clearRecent}><Trash2 size={14} /> Borrar historial</button>
              </div>
            </div>
            <div className="continue-carousel" ref={recentCarouselRef} role="group" aria-label="Últimos recursos consultados">
              {recentResources.map((resource) => (
                <ContinueCard
                  key={resource.id}
                  resource={resource}
                  collection={collectionsById.get(resource.collectionId)!}
                  territory={territoriesById.get(collectionsById.get(resource.collectionId)!.territoryId)!}
                  progress={libraryState.progress[resource.id]}
                  onOpen={() => openResource(resource)}
                />
              ))}
            </div>
          </section>
        )}

        <section className="territories-section" aria-labelledby="territories-title">
          <div className="section-heading section-heading--territories">
            <div>
              <p className="eyebrow">Cuatro formas de entrar</p>
              <h2 id="territories-title">Territorios de conocimiento</h2>
            </div>
            <p>{catalog.collections.length} colecciones · {catalog.resources.length} recursos</p>
          </div>
          <p className="territory-carousel-hint" aria-hidden="true">Desliza para explorar <span>→</span></p>
          <div className="territory-grid" role="group" aria-label="Carrusel de territorios de conocimiento">
            {catalog.territories.map((territory, index) => (
              <TerritoryCard
                key={territory.id}
                territory={territory}
                index={index}
                collections={catalog.collections.filter((collection) => collection.territoryId === territory.id)}
                active={libraryState.filters.territory === territory.id}
                onSelect={() => {
                  setFilter('territory', libraryState.filters.territory === territory.id ? 'all' : territory.id)
                  document.querySelector('#library-board')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                }}
              />
            ))}
          </div>
        </section>

        <section className="library-section" id="library-board" aria-labelledby="library-title">
          <div className="section-heading library-heading">
            <div>
              <p className="eyebrow">La biblioteca viva</p>
              <h2 id="library-title">{libraryState.filters.archivedOnly ? 'Recursos archivados' : 'Todo lo que has reunido'}</h2>
            </div>
            <div className="view-switch" aria-label="Cambiar vista">
              <button type="button" className={libraryState.filters.viewMode === 'board' ? 'active' : ''} onClick={() => setFilter('viewMode', 'board')} aria-label="Vista de tablero"><Grid2X2 size={17} /></button>
              <button type="button" className={libraryState.filters.viewMode === 'compact' ? 'active' : ''} onClick={() => setFilter('viewMode', 'compact')} aria-label="Vista compacta"><LayoutList size={17} /></button>
            </div>
          </div>

          <FilterBar
            catalog={catalog}
            filters={libraryState.filters}
            topTags={topTags}
            archivedCount={libraryState.archived.length}
            open={filtersOpen}
            onFilter={setFilter}
            onReset={() => updateState((current) => ({ ...current, filters: emptyState.filters }))}
          />

          <p className="result-count" aria-live="polite">
            {visibleResources.length} {visibleResources.length === 1 ? (libraryState.filters.archivedOnly ? 'archivado' : 'recurso') : (libraryState.filters.archivedOnly ? 'archivados' : 'recursos')}
          </p>

          {visibleResources.length ? (
            <div className={`resource-grid resource-grid--${libraryState.filters.viewMode}`}>
              {visibleResources.map((resource, index) => (
                <ResourceCard
                  key={resource.id}
                  resource={resource}
                  collection={collectionsById.get(resource.collectionId)!}
                  territory={territoriesById.get(collectionsById.get(resource.collectionId)!.territoryId)!}
                  progress={libraryState.progress[resource.id]}
                  favorite={libraryState.favorites.includes(resource.id)}
                  archived={libraryState.archived.includes(resource.id)}
                  searchPage={null}
                  index={index}
                  viewMode={libraryState.filters.viewMode}
                  onOpen={(page) => openResource(resource, page)}
                  onFavorite={() => toggleFavorite(resource.id)}
                  onArchive={() => toggleArchive(resource.id)}
                />
              ))}
            </div>
          ) : (
            <div className="empty-results">
              <RotateCcw size={25} />
              <h3>{libraryState.filters.archivedOnly ? 'No tienes recursos archivados.' : 'No hay recursos con estos filtros.'}</h3>
              <p>{libraryState.filters.archivedOnly ? 'Cuando archives un recurso, podrás recuperarlo desde aquí.' : 'Limpia los filtros para volver a ver toda la biblioteca.'}</p>
              <button type="button" onClick={() => updateState((current) => ({ ...current, filters: emptyState.filters }))}>Ver toda la biblioteca</button>
            </div>
          )}
        </section>
      </main>

      <footer className="site-footer" aria-hidden={Boolean(selectedResource)}>
        <LibraryMark />
        <div className="pdf-toolbar__pagination">
          <strong>Archivo Divergente</strong>
          <p>Una biblioteca personal, viva y en movimiento.</p>
        </div>
        <button type="button" onClick={() => {
          if (window.confirm('¿Borrar favoritos, archivados, recientes y progreso guardado en este dispositivo?')) setLibraryState(emptyState)
        }}>Borrar progreso local</button>
      </footer>

      {selectedResource && (
        <ResourceViewer
          resource={selectedResource}
          collection={collectionsById.get(selectedResource.collectionId)!}
          relatedPdf={selectedResource.type === 'document'
            ? catalog.resources.find((resource) => resource.collectionId === selectedResource.collectionId && resource.type === 'pdf' && resource.title === selectedResource.title)
            : undefined}
          progress={libraryState.progress[selectedResource.id]}
          initialPage={requestedPage}
          favorite={libraryState.favorites.includes(selectedResource.id)}
          archived={libraryState.archived.includes(selectedResource.id)}
          onClose={closeResource}
          onFavorite={() => toggleFavorite(selectedResource.id)}
          onArchive={() => toggleArchive(selectedResource.id)}
          onProgress={saveSelectedProgress}
        />
      )}
    </div>
  )
}

function ContinueCard({ resource, collection, territory, progress, onOpen }: {
  resource: Resource
  collection: Collection
  territory: Territory
  progress?: ResourceProgress
  onOpen: () => void
}) {
  const Icon = typeIcons[resource.type]
  const percent = progressPercent(resource, progress)
  const resumeLabel = resource.type === 'pdf' && progress?.page
    ? `Página ${progress.page}`
    : (resource.type === 'audio' || resource.type === 'video') && progress?.seconds
      ? formatTime(progress.seconds)
      : resource.type === 'text' && percent
        ? `${Math.round(percent)}% leído`
        : 'Recién abierto'
  return (
    <button type="button" className={`continue-card accent-${territory.accent}`} onClick={onOpen}>
      <div className="continue-visual">
        {resource.thumbnail ? <img src={resource.thumbnail} alt="" /> : <Icon size={32} />}
        <span className="continue-play"><Play size={17} fill="currentColor" /></span>
      </div>
      <div className="continue-copy">
        <span className="resource-meta"><Icon size={13} /> {resource.isAnalysis ? 'Análisis' : typeLabels[resource.type]} · {collection.title}</span>
        <h3>{resource.title}</h3>
        <p>{resource.summary}</p>
        <div className="progress-row"><span><Clock3 size={13} /> {resumeLabel}</span><strong>Continuar <ChevronRight size={15} /></strong></div>
        <span className="progress-track"><span style={{ width: `${Math.max(percent, 4)}%` }} /></span>
      </div>
    </button>
  )
}

function TerritoryCard({ territory, collections, active, onSelect, index }: {
  territory: Territory
  collections: Collection[]
  active: boolean
  onSelect: () => void
  index: number
}) {
  const count = collections.reduce((total, collection) => total + collection.resourceCount, 0)
  return (
    <button type="button" className={`territory-card accent-${territory.accent} ${active ? 'active' : ''}`} onClick={onSelect} style={{ '--delay': `${index * 55}ms` } as React.CSSProperties}>
      <span className="territory-number">0{index + 1}</span>
      <span className="territory-eyebrow">{territory.eyebrow}</span>
      <h3>{territory.title}</h3>
      <p>{territory.description}</p>
      <span className="territory-collections">{collections.map((collection) => collection.title).join(' · ')}</span>
      <span className="territory-count">{count} recursos <ChevronRight size={15} /></span>
    </button>
  )
}

function FilterBar({ catalog, filters, topTags, archivedCount, open, onFilter, onReset }: {
  catalog: Catalog
  filters: LibraryState['filters']
  topTags: string[]
  archivedCount: number
  open: boolean
  onFilter: <K extends keyof LibraryState['filters']>(key: K, value: LibraryState['filters'][K]) => void
  onReset: () => void
}) {
  const isFiltered = filters.territory !== 'all' || filters.type !== 'all' || filters.tag !== 'all' || filters.favoritesOnly || filters.archivedOnly
  return (
    <div className={`filter-bar ${open ? 'filter-bar--open' : ''}`}>
      <div className="filter-scroll">
        <button type="button" className={filters.territory === 'all' ? 'active' : ''} onClick={() => onFilter('territory', 'all')}>Todos</button>
        {catalog.territories.map((territory) => (
          <button key={territory.id} type="button" className={filters.territory === territory.id ? 'active' : ''} onClick={() => onFilter('territory', filters.territory === territory.id ? 'all' : territory.id)}>{territory.title}</button>
        ))}
        <span className="filter-divider" />
        {(['pdf', 'audio', 'video', 'image', 'text'] as ResourceType[]).map((type) => (
          <button key={type} type="button" className={filters.type === type ? 'active' : ''} onClick={() => onFilter('type', filters.type === type ? 'all' : type)}>{typeLabels[type]}</button>
        ))}
        <button type="button" className={filters.tag === 'análisis' ? 'active' : ''} onClick={() => {
          if (filters.tag === 'análisis') onFilter('tag', 'all')
          else {
            onFilter('type', 'all')
            onFilter('tag', 'análisis')
          }
        }}><FileText size={14} /> Análisis</button>
        <button type="button" className={filters.favoritesOnly ? 'active' : ''} onClick={() => onFilter('favoritesOnly', !filters.favoritesOnly)}><Bookmark size={14} fill={filters.favoritesOnly ? 'currentColor' : 'none'} /> Favoritos</button>
        <button type="button" className={filters.archivedOnly ? 'active' : ''} onClick={() => onFilter('archivedOnly', !filters.archivedOnly)}><Archive size={14} /> Archivados ({archivedCount})</button>
      </div>
      {isFiltered && <div className="filter-actions"><button className="reset-filters" type="button" onClick={onReset}>Limpiar filtros <X size={14} /></button></div>}
      <div className="filter-details">
        <span>Etiquetas</span>
        <div className="pdf-toolbar__zoom">
          {topTags.map((tag) => <button type="button" key={tag} className={filters.tag === tag ? 'active' : ''} onClick={() => onFilter('tag', filters.tag === tag ? 'all' : tag)}>{tag}</button>)}
        </div>
      </div>
    </div>
  )
}

function ResourceCard({ resource, collection, territory, progress, favorite, archived, searchPage, index, viewMode, onOpen, onFavorite, onArchive }: {
  resource: Resource
  collection: Collection
  territory: Territory
  progress?: ResourceProgress
  favorite: boolean
  archived: boolean
  searchPage: number | null
  index: number
  viewMode: 'board' | 'compact'
  onOpen: (page: number | null) => void
  onFavorite: () => void
  onArchive: () => void
}) {
  const Icon = typeIcons[resource.type]
  const percent = progressPercent(resource, progress)
  return (
    <article className={`resource-card accent-${territory.accent} ${resource.thumbnail ? 'has-cover' : ''} ${archived ? 'is-archived' : ''}`} style={{ '--delay': `${Math.min(index, 12) * 35}ms` } as React.CSSProperties}>
      <button type="button" className="resource-card__main" onClick={() => onOpen(searchPage)} aria-label={`Abrir ${resource.title}`}>
        <div className="resource-cover">
          {resource.thumbnail ? <img src={resource.thumbnail} alt="" loading="lazy" /> : (
            <div className="resource-monogram"><Icon size={28} /><span>{collection.title.slice(0, 2)}</span></div>
          )}
          <span className="format-pill"><Icon size={12} /> {resource.isAnalysis ? 'Análisis' : typeLabels[resource.type]}</span>
          {archived && <span className="archived-pill"><Archive size={12} /> Archivado</span>}
          {searchPage && <span className="page-hit">Coincide en pág. {searchPage}</span>}
        </div>
        <div className="resource-card__copy">
          <span className="collection-label">{collection.title}</span>
          <h3>{resource.title}</h3>
          {viewMode === 'board' && <p>{resource.summary}</p>}
          <div className="resource-tags">{resource.tags.slice(0, viewMode === 'board' ? 3 : 2).map((tag) => <span key={tag}>#{tag}</span>)}</div>
          <div className="resource-card__footer">
            <span>{percent ? `${Math.round(percent)}% recorrido` : formatBytes(resource.size)}</span>
            <strong>Abrir <ChevronRight size={14} /></strong>
          </div>
          {percent > 0 && <span className="card-progress"><span style={{ width: `${percent}%` }} /></span>}
        </div>
      </button>
      <div className="resource-actions">
        <button type="button" onClick={onFavorite} aria-label={favorite ? `Quitar ${resource.title} de favoritos` : `Guardar ${resource.title} en favoritos`}><Bookmark size={16} fill={favorite ? 'currentColor' : 'none'} /></button>
        <button type="button" onClick={onArchive} aria-label={archived ? `Restaurar ${resource.title}` : `Archivar ${resource.title}`} title={archived ? 'Restaurar' : 'Archivar'}>{archived ? <ArchiveRestore size={16} /> : <Archive size={16} />}</button>
        <a href={resource.downloadUrl} download={resource.isAnalysis ? `${resource.id}.md` : undefined} aria-label={`Descargar ${resource.title}`} title="Descargar"><Download size={16} /></a>
      </div>
    </article>
  )
}

function ResourceViewer({ resource, collection, relatedPdf, progress, initialPage, favorite, archived, onClose, onFavorite, onArchive, onProgress }: {
  resource: Resource
  collection: Collection
  relatedPdf?: Resource
  progress?: ResourceProgress
  initialPage: number | null
  favorite: boolean
  archived: boolean
  onClose: () => void
  onFavorite: () => void
  onArchive: () => void
  onProgress: (update: Partial<ResourceProgress>) => void
}) {
  const viewerRef = useRef<HTMLElement>(null)
  const [immersive, setImmersive] = useState(false)
  const [orientationHint, setOrientationHint] = useState('')
  const actualResource = resource.type === 'document' && relatedPdf ? relatedPdf : resource

  useEffect(() => {
    viewerRef.current?.focus()
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || !viewerRef.current) return
      const focusable = [...viewerRef.current.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])')]
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', trapFocus)
    return () => document.removeEventListener('keydown', trapFocus)
  }, [resource.id])

  useEffect(() => {
    const onFullscreenChange = () => {
      const fullscreenDocument = document as FullscreenDocument
      if (!document.fullscreenElement && !fullscreenDocument.webkitFullscreenElement) {
        setImmersive(false)
        ;(screen.orientation as LockableOrientation | undefined)?.unlock?.()
      }
    }
    document.addEventListener('fullscreenchange', onFullscreenChange)
    document.addEventListener('webkitfullscreenchange', onFullscreenChange)
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange)
      document.removeEventListener('webkitfullscreenchange', onFullscreenChange)
    }
  }, [])

  async function toggleImmersive() {
    const fullscreenDocument = document as FullscreenDocument
    const fullscreenElement = document.fullscreenElement || fullscreenDocument.webkitFullscreenElement
    if (immersive || fullscreenElement) {
      setImmersive(false)
      ;(screen.orientation as LockableOrientation | undefined)?.unlock?.()
      if (document.fullscreenElement) await document.exitFullscreen().catch(() => undefined)
      else if (fullscreenDocument.webkitFullscreenElement) await fullscreenDocument.webkitExitFullscreen?.()
      return
    }

    setImmersive(true)
    setOrientationHint('')
    const element = viewerRef.current as FullscreenElement | null
    try {
      if (element?.requestFullscreen) await element.requestFullscreen()
      else if (element?.webkitRequestFullscreen) await element.webkitRequestFullscreen()
      else throw new Error('fullscreen-not-supported')
      const orientation = screen.orientation as LockableOrientation | undefined
      if (orientation?.lock) await orientation.lock('landscape')
      else setOrientationHint('Gira tu teléfono para verlo en horizontal.')
    } catch {
      setOrientationHint('Vista ampliada activa. Gira tu teléfono para usarla en horizontal.')
    }
  }

  function leaveViewer() {
    const fullscreenDocument = document as FullscreenDocument
    ;(screen.orientation as LockableOrientation | undefined)?.unlock?.()
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined)
    else if (fullscreenDocument.webkitFullscreenElement) void fullscreenDocument.webkitExitFullscreen?.()
    onClose()
  }

  return (
    <aside className={`resource-viewer ${immersive ? 'is-immersive' : ''}`} ref={viewerRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label={`Sala de lectura: ${resource.title}`}>
      <header className="viewer-header">
        <button type="button" className="viewer-back" onClick={leaveViewer}><ArrowLeft size={18} /> <span>Volver a la biblioteca</span></button>
        <div className="viewer-actions">
          <button type="button" onClick={onFavorite} aria-label={favorite ? 'Quitar de favoritos' : 'Guardar en favoritos'}><Bookmark size={17} fill={favorite ? 'currentColor' : 'none'} /></button>
          <button type="button" onClick={onArchive} aria-label={archived ? 'Restaurar recurso' : 'Archivar recurso'} title={archived ? 'Restaurar' : 'Archivar'}>{archived ? <ArchiveRestore size={17} /> : <Archive size={17} />}</button>
          <a href={resource.downloadUrl} download={resource.isAnalysis ? `${resource.id}.md` : undefined} aria-label={`Descargar ${resource.title}`} title="Descargar original"><Download size={17} /></a>
          <button type="button" className="viewer-fullscreen" onClick={() => void toggleImmersive()} aria-label={immersive ? 'Salir de pantalla completa' : 'Pantalla completa horizontal'} title={immersive ? 'Salir de pantalla completa' : 'Pantalla completa horizontal'}>
            {immersive ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
          </button>
          <button className="viewer-close" type="button" onClick={leaveViewer} aria-label="Cerrar recurso"><X size={18} /></button>
        </div>
      </header>
      {orientationHint && <p className="viewer-orientation-hint" role="status"><RotateCw size={15} /> {orientationHint}</p>}
      <div className="viewer-titlebar">
        <span>{collection.title} · {resource.isAnalysis ? 'Análisis Markdown' : typeLabels[resource.type]}</span>
        <h2>{resource.title}</h2>
        <div>{archived && <span className="is-archived-tag"><Archive size={11} /> Archivado</span>}{resource.tags.slice(0, 4).map((tag) => <span key={tag}>#{tag}</span>)}</div>
      </div>
      <div className={`viewer-stage viewer-stage--${actualResource.type}`}>
        {resource.type === 'document' && relatedPdf && <p className="document-note"><Check size={15} /> Mostrando la versión PDF. El documento editable está disponible en el icono de descarga.</p>}
        {actualResource.type === 'pdf' && (
          <PdfViewer resource={actualResource} initialPage={initialPage || progress?.page || 1} onProgress={onProgress} />
        )}
        {actualResource.type === 'audio' && <MediaViewer kind="audio" resource={actualResource} progress={progress} onProgress={onProgress} />}
        {actualResource.type === 'video' && <MediaViewer kind="video" resource={actualResource} progress={progress} onProgress={onProgress} />}
        {actualResource.type === 'image' && <ImageViewer resource={actualResource} />}
        {actualResource.type === 'text' && <TextViewer resource={actualResource} progress={progress} onProgress={onProgress} />}
        {actualResource.type === 'document' && !relatedPdf && (
          <div className="unsupported-viewer"><FileText size={38} /><h3>Documento editable</h3><p>Este formato se conserva como archivo original.</p><a href={resource.downloadUrl}><Download size={16} /> Descargar documento</a></div>
        )}
      </div>
    </aside>
  )
}

function PdfViewer({ resource, initialPage, onProgress }: { resource: Resource; initialPage: number; onProgress: (update: Partial<ResourceProgress>) => void }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const pageRefs = useRef(new Map<number, HTMLDivElement>())
  const restoredPage = useRef(false)
  const [documentProxy, setDocumentProxy] = useState<PDFDocumentProxy | null>(null)
  const [page, setPage] = useState(initialPage)
  const [pageCount, setPageCount] = useState(resource.pageCount || 0)
  const [zoom, setZoom] = useState(1)
  const [pageRatio, setPageRatio] = useState(1 / 1.414)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    import('pdfjs-dist').then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()
      return pdfjs.getDocument({ url: resource.url, withCredentials: false }).promise
    }).then((pdf) => {
      if (!active) return
      setDocumentProxy(pdf)
      setPageCount(pdf.numPages)
      const restoredPage = Math.min(Math.max(initialPage, 1), pdf.numPages)
      setPage(restoredPage)
      void pdf.getPage(restoredPage).then((pdfPage) => {
        if (!active) return
        const viewport = pdfPage.getViewport({ scale: 1 })
        setPageRatio(viewport.width / viewport.height)
      })
      setLoading(false)
    }).catch(() => {
      if (!active) return
      setError('No se pudo mostrar el PDF. Comprueba que el archivo esté publicado y permita CORS desde este dominio.')
      setLoading(false)
    })
    return () => { active = false; void documentProxy?.destroy() }
    // documentProxy is intentionally excluded to avoid destroying a freshly loaded document.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resource.id, resource.url])

  const goToPage = useCallback((target: number) => {
    const nextPage = Math.min(Math.max(target, 1), pageCount || 1)
    setPage(nextPage)
    onProgress({ page: nextPage, pageCount })
    const element = pageRefs.current.get(nextPage)
    if (element && scrollRef.current) scrollRef.current.scrollTo({ top: Math.max(0, element.offsetTop - 8), behavior: 'smooth' })
  }, [onProgress, pageCount])

  const markVisible = useCallback((visiblePage: number) => {
    setPage((current) => {
      if (current === visiblePage) return current
      onProgress({ page: visiblePage, pageCount })
      return visiblePage
    })
  }, [onProgress, pageCount])

  const registerPage = useCallback((pageNumber: number, element: HTMLDivElement | null) => {
    if (element) pageRefs.current.set(pageNumber, element)
    else pageRefs.current.delete(pageNumber)
  }, [])

  useEffect(() => {
    if (!documentProxy || !pageCount || restoredPage.current) return
    restoredPage.current = true
    const frame = window.requestAnimationFrame(() => {
      const element = pageRefs.current.get(page)
      if (element && scrollRef.current) scrollRef.current.scrollTo({ top: Math.max(0, element.offsetTop - 8), behavior: 'auto' })
      onProgress({ page, pageCount })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [documentProxy, onProgress, page, pageCount])

  if (error) return <ViewerError message={error} url={resource.url} />
  return (
    <div className="pdf-viewer">
      <div className="pdf-toolbar">
        <div>
          <button type="button" onClick={() => goToPage(page - 1)} disabled={page <= 1} aria-label="Página anterior"><ChevronLeft size={18} /></button>
          <span>Página <strong>{page}</strong> de {pageCount || '…'}</span>
          <button type="button" onClick={() => goToPage(page + 1)} disabled={!pageCount || page >= pageCount} aria-label="Página siguiente"><ChevronRight size={18} /></button>
        </div>
        <small className="pdf-scroll-hint">Desliza entre páginas</small>
        <div>
          <button type="button" onClick={() => setZoom((value) => Math.max(.7, value - .15))} aria-label="Alejar"><ZoomOut size={17} /></button>
          <span>{Math.round(zoom * 100)}%</span>
          <button type="button" onClick={() => setZoom((value) => Math.min(1.8, value + .15))} aria-label="Acercar"><ZoomIn size={17} /></button>
        </div>
      </div>
      <div className="pdf-pages-scroll" ref={scrollRef}>
        {loading && <div className="viewer-loading"><span /> Preparando las páginas…</div>}
        {documentProxy && (
          <div className="pdf-pages">
            {Array.from({ length: pageCount }, (_, index) => index + 1).map((pageNumber) => (
              <PdfPageCanvas
                key={pageNumber}
                documentProxy={documentProxy}
                pageNumber={pageNumber}
                zoom={zoom}
                defaultRatio={pageRatio}
                scrollRoot={scrollRef}
                onVisible={markVisible}
                registerPage={registerPage}
                title={resource.title}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function PdfPageCanvas({ documentProxy, pageNumber, zoom, defaultRatio, scrollRoot, onVisible, registerPage, title }: {
  documentProxy: PDFDocumentProxy
  pageNumber: number
  zoom: number
  defaultRatio: number
  scrollRoot: React.RefObject<HTMLDivElement | null>
  onVisible: (page: number) => void
  registerPage: (page: number, element: HTMLDivElement | null) => void
  title: string
}) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null)
  const [shouldRender, setShouldRender] = useState(false)
  const [ratio, setRatio] = useState(defaultRatio)

  useEffect(() => {
    const wrapper = wrapperRef.current
    if (!wrapper) return
    registerPage(pageNumber, wrapper)
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) setShouldRender(true)
        if (entry.intersectionRatio >= .22) onVisible(pageNumber)
      }
    }, { root: scrollRoot.current, rootMargin: '700px 0px', threshold: [0, .1, .22, .6] })
    observer.observe(wrapper)
    return () => {
      observer.disconnect()
      registerPage(pageNumber, null)
    }
  }, [onVisible, pageNumber, registerPage, scrollRoot])

  useEffect(() => {
    if (!shouldRender || !canvasRef.current) return
    let active = true
    documentProxy.getPage(pageNumber).then((pdfPage) => {
      if (!active || !canvasRef.current) return
      const viewport = pdfPage.getViewport({ scale: 1.35 * zoom })
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
      const canvas = canvasRef.current
      const context = canvas.getContext('2d')
      if (!context) return
      setRatio(viewport.width / viewport.height)
      canvas.width = Math.floor(viewport.width * pixelRatio)
      canvas.height = Math.floor(viewport.height * pixelRatio)
      renderTaskRef.current?.cancel()
      const task = pdfPage.render({
        canvasContext: context,
        viewport,
        transform: pixelRatio === 1 ? undefined : [pixelRatio, 0, 0, pixelRatio, 0, 0],
      })
      renderTaskRef.current = task
      return task.promise
    }).catch((reason) => {
      if (reason?.name !== 'RenderingCancelledException') setShouldRender(false)
    })
    return () => {
      active = false
      renderTaskRef.current?.cancel()
    }
  }, [documentProxy, pageNumber, shouldRender, zoom])

  return (
    <div
      className="pdf-page"
      ref={wrapperRef}
      style={{
        aspectRatio: String(ratio),
        width: `${zoom * 100}%`,
        maxWidth: `${960 * zoom}px`,
        marginInline: zoom <= 1 ? 'auto' : '0',
      }}
      data-page={pageNumber}
    >
      <canvas ref={canvasRef} aria-label={`Página ${pageNumber} de ${title}`} />
      {!shouldRender && <span className="pdf-page-number">{pageNumber}</span>}
    </div>
  )
}

function MediaViewer({ kind, resource, progress, onProgress }: {
  kind: 'audio' | 'video'
  resource: Resource
  progress?: ResourceProgress
  onProgress: (update: Partial<ResourceProgress>) => void
}) {
  const mediaRef = useRef<HTMLMediaElement>(null)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(progress?.seconds || 0)
  const [duration, setDuration] = useState(progress?.duration || 0)
  const [rate, setRate] = useState(progress?.playbackRate || 1)
  const [error, setError] = useState(false)
  const restored = useRef(false)
  const lastSavedSecond = useRef(-1)

  function onLoadedMetadata() {
    const media = mediaRef.current
    if (!media) return
    setDuration(media.duration)
    media.playbackRate = rate
    if (!restored.current && progress?.seconds && progress.seconds < media.duration - 3) {
      media.currentTime = progress.seconds
      restored.current = true
    }
  }

  function onTimeUpdate() {
    const media = mediaRef.current
    if (!media) return
    setCurrentTime(media.currentTime)
    const wholeSecond = Math.floor(media.currentTime)
    if (wholeSecond !== lastSavedSecond.current) {
      lastSavedSecond.current = wholeSecond
      onProgress({ seconds: media.currentTime, duration: media.duration, playbackRate: media.playbackRate })
    }
  }

  function togglePlayback() {
    const media = mediaRef.current
    if (!media) return
    if (media.paused) void media.play()
    else media.pause()
  }

  function seek(value: number) {
    if (!mediaRef.current) return
    mediaRef.current.currentTime = value
    setCurrentTime(value)
  }

  function changeRate(value: number) {
    setRate(value)
    if (mediaRef.current) mediaRef.current.playbackRate = value
    onProgress({ playbackRate: value })
  }

  if (error) return <ViewerError message="No se pudo reproducir este archivo. Comprueba que esté publicado con el tipo de contenido correcto." url={resource.url} />
  return (
    <div className={`media-viewer media-viewer--${kind}`}>
      {kind === 'video' ? (
        <video ref={mediaRef as React.RefObject<HTMLVideoElement>} src={resource.url} preload="metadata" playsInline controls controlsList="nodownload" onLoadedMetadata={onLoadedMetadata} onTimeUpdate={onTimeUpdate} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onError={() => setError(true)} />
      ) : (
        <audio ref={mediaRef as React.RefObject<HTMLAudioElement>} src={resource.url} preload="metadata" onLoadedMetadata={onLoadedMetadata} onTimeUpdate={onTimeUpdate} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onError={() => setError(true)} />
      )}
      {kind === 'audio' && (
        <div className="audio-art" aria-hidden="true">
          <div className="audio-disc"><Headphones size={35} /></div>
          <div className="waveform">{Array.from({ length: 44 }).map((_, index) => <span key={index} style={{ height: `${18 + ((index * 17) % 54)}%` }} />)}</div>
        </div>
      )}
      <div className="media-controls">
        <button className="play-button" type="button" onClick={togglePlayback} aria-label={playing ? 'Pausar' : 'Reproducir'}>{playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}</button>
        <span>{formatTime(currentTime)}</span>
        <input type="range" min="0" max={duration || 0} step=".1" value={Math.min(currentTime, duration || 0)} onChange={(event) => seek(Number(event.target.value))} aria-label="Posición de reproducción" />
        <span>{formatTime(duration)}</span>
        <select value={rate} onChange={(event) => changeRate(Number(event.target.value))} aria-label="Velocidad de reproducción">
          {[.75, 1, 1.25, 1.5, 2].map((value) => <option key={value} value={value}>{value}×</option>)}
        </select>
      </div>
    </div>
  )
}

function ImageViewer({ resource }: { resource: Resource }) {
  const [zoomed, setZoomed] = useState(false)
  const [error, setError] = useState(false)
  if (error) return <ViewerError message="No se pudo mostrar la imagen. Comprueba que esté publicada en ÁgilPM." url={resource.url} />
  return (
    <div className={`image-viewer ${zoomed ? 'zoomed' : ''}`}>
      <button type="button" onClick={() => setZoomed((value) => !value)} aria-label={zoomed ? 'Reducir imagen' : 'Ampliar imagen'}>
        <img src={resource.url} alt={resource.title} onError={() => setError(true)} />
      </button>
      <span><ZoomIn size={14} /> Toca la imagen para {zoomed ? 'reducir' : 'ampliar'}</span>
    </div>
  )
}

function TextViewer({ resource, progress, onProgress }: { resource: Resource; progress?: ResourceProgress; onProgress: (update: Partial<ResourceProgress>) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const restored = useRef(false)
  const lastSavedPercent = useRef(progress?.scroll || 0)
  useEffect(() => {
    const container = ref.current
    if (!container || !progress?.scroll || restored.current) return
    requestAnimationFrame(() => {
      container.scrollTop = progress.scroll! * Math.max(0, container.scrollHeight - container.clientHeight)
      restored.current = true
    })
  }, [progress?.scroll, resource.id])
  function onScroll() {
    const container = ref.current
    if (!container) return
    const total = container.scrollHeight - container.clientHeight
    const percent = total > 0 ? container.scrollTop / total : 1
    if (Math.abs(percent - lastSavedPercent.current) >= .01 || percent === 1) {
      lastSavedPercent.current = percent
      onProgress({ scroll: percent })
    }
  }
  return (
    <div className="text-viewer" ref={ref} onScroll={onScroll}>
      <article><ReactMarkdown>{resource.textContent || resource.summary}</ReactMarkdown></article>
    </div>
  )
}

function ViewerError({ message, url }: { message: string; url: string }) {
  return (
    <div className="viewer-error">
      <span>—</span>
      <h3>El recurso todavía no responde.</h3>
      <p>{message}</p>
      <a href={url} target="_blank" rel="noreferrer">Abrir URL original <ChevronRight size={15} /></a>
    </div>
  )
}

export default App
