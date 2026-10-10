const rawBase = (import.meta.env.VITE_API_BASE || 'http://localhost:8000').trim()

export const API_BASE = rawBase.replace(/\/+$/, '')
export const FRONTEND_SHA = (import.meta.env.VITE_GIT_SHA || 'dev').trim() || 'dev'
export const BUILD_TIME = (import.meta.env.VITE_BUILD_TIME || '').trim()
