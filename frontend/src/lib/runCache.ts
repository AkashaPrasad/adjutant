import type { Run } from '../api/types'

/** Tiny in-memory cache so a freshly created run renders instantly on the review page. */
export const runCache = new Map<string, Run>()
