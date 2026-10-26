// Every /api/* request is handled by the API router in src/server.
import { handleApi } from '@/server/api.js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export const GET = handleApi
export const POST = handleApi
export const PUT = handleApi
export const PATCH = handleApi
export const DELETE = handleApi
export const HEAD = handleApi
