// Website gallery: bundled photos are copied in once, then everything is managed from the admin.
import { builtInPhotos } from '../../shared/gallery.js'
import { GalleryPhoto, Setting } from '../db/models.js'
import { signedUrls } from './storage.js'

const SEEDED = 'gallery_seeded'

export async function ensureGallery() {
  if (await Setting.exists({ _id: SEEDED })) return
  // Claim the flag first so two requests can't both copy the photos in.
  const claimed = await Setting.updateOne({ _id: SEEDED }, { $setOnInsert: { value: true } }, { upsert: true })
  if (!claimed.upsertedCount) return
  await GalleryPhoto.insertMany(builtInPhotos.map((p, i) => ({ static_src: p.src, caption: p.caption, category: p.category, sort_order: i + 1 })))
}

/** Gallery rows in display order, each with a `src` the browser can load (signed links last an hour). */
export async function listGallery({ includeHidden = false } = {}) {
  await ensureGallery()
  const rows = await GalleryPhoto.find(includeHidden ? {} : { is_published: true }).sort({ sort_order: 1, created_at: -1 }).lean()
  const urls = await signedUrls(rows.map((r) => r.file_id))
  return rows
    .map((r) => ({ ...r, src: r.static_src ?? urls.get(String(r.file_id)) ?? null }))
    .filter((r) => r.src)
}

/** Sort position that puts a new photo first. */
export async function firstSortOrder() {
  const top = await GalleryPhoto.findOne({}, 'sort_order').sort({ sort_order: 1 }).lean()
  return (top?.sort_order ?? 1) - 1
}
