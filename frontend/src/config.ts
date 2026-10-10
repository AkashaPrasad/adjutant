const rawBase = (import.meta.env.VITE_API_BASE || 'http://localhost:8000').trim()

export const API_BASE = rawBase.replace(/\/+$/, '')
export const FRONTEND_SHA = (import.meta.env.VITE_GIT_SHA || 'dev').trim() || 'dev'
export const BUILD_TIME = (import.meta.env.VITE_BUILD_TIME || '').trim()

/** The only LLM in the system. Used for planning and for judging done-criteria. */
export const MODEL_ID = 'muse-spark-1.3-contributor'
export const MODEL_NAME = 'Muse Spark 1.3 Contributor'
export const MODEL_FULL_NAME = 'Meta Muse Spark 1.3 Contributor'
