/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-shadow */

import { getRedisClient } from './redis-utils/get-client'
import { RedisStore } from './store/redis-store'
import { currentTimestamp } from './utils'

interface Options {
  cacheSeconds: number
  tags?: string[]
}

const cache = new RedisStore<CacheResponse>({
  client: getRedisClient(),
  updateCache: true
})

export function cacheFunctionResult<F extends (...args: any[]) => any>(
  fn: F,
  args: Parameters<F>,
  options?: Options
) {
  const { tags = [], cacheSeconds = 0 } = options || {}

  const key = [...tags, fn.name, ...args.map((a) => String(a))].join('-')

  return cache.getOrSet(key, () => generateResponse(fn, args, cacheSeconds), cacheSeconds)
}

type CacheMeta = {
  cacheTimestamp: number
  cacheSeconds: number
}

export type CacheResponse = CacheMeta &
  (
    | { result: any }
    | {
        error: string
        status: number
      }
  )

// includes error in the cache function output,
// this is needed for preventing someone to abuse
// an endpoint which does not cache due to revert
async function generateResponse<F extends (...args: any[]) => any>(
  fn: F,
  args: Parameters<F>,
  cacheSeconds: number
): Promise<CacheResponse> {
  try {
    const result = await fn(...args)
    if (result.result) {
      // allows to override `cacheTimestamp`
      return {
        ...result,
        cacheTimestamp: Math.min(
          result.cacheTimestamp ?? Number.MAX_SAFE_INTEGER,
          currentTimestamp()
        ),
        cacheSeconds
      }
    } else {
      return { result, cacheTimestamp: currentTimestamp(), cacheSeconds }
    }
  } catch (error: any) {
    if (error instanceof TypeError) {
      console.error('caught in generateResponse', error)
    }

    // cache the error resp (to prevent DoS, hitting with an input which reverts in middle
    if (error.status && error.status < 500) {
      // cache normal errors for 15 seconds
      return {
        error: error.message,
        status: error.status,
        cacheTimestamp: currentTimestamp(),
        cacheSeconds: Math.min(cacheSeconds, 15)
      }
    } else {
      // do not cache server errors they might be temporary
      return {
        error: error.message,
        status: error.status,
        cacheSeconds: 0,
        cacheTimestamp: 0
      }
    }
  }
}

export async function flushall() {
  await cache.client.flushall()
}
