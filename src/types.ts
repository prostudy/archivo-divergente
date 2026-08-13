export type ResourceType = 'pdf' | 'audio' | 'video' | 'image' | 'text' | 'document'

export interface Territory {
  id: string
  title: string
  eyebrow: string
  description: string
  accent: 'sage' | 'clay' | 'blue' | 'plum'
  order: number
}

export interface Collection {
  id: string
  title: string
  territoryId: string
  description: string
  summary: string
  tags: string[]
  order: number
  resourceCount: number
}

export interface Resource {
  id: string
  collectionId: string
  title: string
  filename: string
  type: ResourceType
  mime: string
  url: string
  downloadUrl: string
  thumbnail: string | null
  size: number
  updatedAt: string
  tags: string[]
  summary: string
  featured: boolean
  pageCount: number | null
  textContent: string | null
  relatedPdf: string | null
  hash: string
}

export interface Catalog {
  version: number
  generatedAt: string
  site: {
    title: string
    tagline: string
    mediaBaseUrl: string
    downloadBaseUrl: string
  }
  territories: Territory[]
  collections: Collection[]
  resources: Resource[]
}

export interface SearchEntry {
  id: string
  kind: 'collection' | 'resource'
  collectionId: string
  resourceId: string | null
  page: number | null
  title: string
  tags: string[]
  text: string
}

export interface ResourceProgress {
  page?: number
  pageCount?: number
  seconds?: number
  duration?: number
  playbackRate?: number
  scroll?: number
  updatedAt: string
}

export interface LibraryState {
  version: 1
  favorites: string[]
  recent: string[]
  lastResourceId: string | null
  progress: Record<string, ResourceProgress>
  filters: {
    territory: string
    type: string
    tag: string
    favoritesOnly: boolean
    viewMode: 'board' | 'compact'
  }
}
