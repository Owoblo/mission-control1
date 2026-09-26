// sharp 0.35 exposes separate ESM/CJS entry points; use its server CJS API.
interface ImagePipeline { rotate(): ImagePipeline; resize(width: number, height: number, options: { fit: string }): ImagePipeline; greyscale(): ImagePipeline; removeAlpha(): ImagePipeline; raw(): ImagePipeline; toBuffer(): Promise<Buffer> }
const sharp = require('sharp') as (input: Buffer, options: { limitInputPixels: number }) => ImagePipeline
import { photoSignature, potentiallySamePhoto } from '@/lib/photo-similarity'
export async function findSimilarLeadPhotos(assets: Array<{ id: string; url: string; room?: string }>) {
  // Suggestions only: never merge different files automatically. Keep work bounded.
  const photos = assets.slice(0, 60)
  const signatures: Array<ReturnType<typeof photoSignature> | null> = []
  for (let start = 0; start < photos.length; start += 6) {
    signatures.push(...await Promise.all(photos.slice(start, start + 6).map(async photo => {
      try {
        const response = await fetch(photo.url, { signal: AbortSignal.timeout(5000), cache: 'force-cache' })
        if (!response.ok || Number(response.headers.get('content-length') || 0) > 15000000) return null
        const data = await response.arrayBuffer()
        if (data.byteLength > 15000000) return null
        const pixels = await sharp(Buffer.from(data), { limitInputPixels: 40000000 }).rotate().resize(9, 8, { fit: 'fill' }).greyscale().removeAlpha().raw().toBuffer()
        return photoSignature(pixels)
      } catch { return null }
    })))
  }
  const pairs: Array<{ firstId: string; secondId: string }> = []
  for (let i = 0; i < photos.length; i++) for (let j = i + 1; j < photos.length; j++) {
    if (signatures[i] && signatures[j] && potentiallySamePhoto(signatures[i]!, signatures[j]!)) pairs.push({ firstId: photos[i].id, secondId: photos[j].id })
    if (pairs.length >= 12) return pairs
  }
  return pairs
}
