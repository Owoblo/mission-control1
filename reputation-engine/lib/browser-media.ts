const DEFAULT_MAX_IMAGE_DIMENSION = 1600
const DEFAULT_MAX_IMAGE_BYTES = 2_800_000
const DEFAULT_MAX_UPLOAD_BYTES = 3_500_000

function isBrowserImage(file: File) {
  return file.type.startsWith('image/') && file.type !== 'image/gif' && file.type !== 'image/svg+xml'
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Could not prepare this photo for upload. Try another image.'))
    }
    image.src = url
  })
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (!blob) {
        reject(new Error('Could not prepare this photo for upload.'))
        return
      }
      resolve(blob)
    }, 'image/jpeg', quality)
  })
}

function resizedDimensions(width: number, height: number, maxDimension: number) {
  const largest = Math.max(width, height)
  if (largest <= maxDimension) return { width, height }
  const scale = maxDimension / largest
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

export async function prepareUploadFile(
  file: File,
  options: {
    maxImageDimension?: number
    maxImageBytes?: number
    maxUploadBytes?: number
  } = {}
) {
  const maxImageDimension = options.maxImageDimension || DEFAULT_MAX_IMAGE_DIMENSION
  const maxImageBytes = options.maxImageBytes || DEFAULT_MAX_IMAGE_BYTES
  const maxUploadBytes = options.maxUploadBytes || DEFAULT_MAX_UPLOAD_BYTES

  if (!isBrowserImage(file)) {
    if (file.size > maxUploadBytes) {
      throw new Error('That file is too large. Please choose a smaller file or send photos instead of video.')
    }
    return file
  }

  if (file.size <= maxImageBytes) return file

  const image = await loadImage(file)
  const firstSize = resizedDimensions(image.naturalWidth || image.width, image.naturalHeight || image.height, maxImageDimension)
  const canvas = document.createElement('canvas')
  canvas.width = firstSize.width
  canvas.height = firstSize.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Could not prepare this photo for upload.')
  context.drawImage(image, 0, 0, canvas.width, canvas.height)

  for (const quality of [0.82, 0.72, 0.62, 0.52]) {
    const blob = await canvasToBlob(canvas, quality)
    if (blob.size <= maxImageBytes) {
      const safeName = (file.name || 'photo').replace(/\.[^.]+$/, '')
      return new File([blob], `${safeName}.jpg`, { type: 'image/jpeg', lastModified: Date.now() })
    }
  }

  const fallbackSize = resizedDimensions(image.naturalWidth || image.width, image.naturalHeight || image.height, 1200)
  canvas.width = fallbackSize.width
  canvas.height = fallbackSize.height
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  const blob = await canvasToBlob(canvas, 0.68)
  if (blob.size > maxImageBytes) {
    throw new Error('That photo is too large. Please retake it or choose a smaller photo.')
  }
  const safeName = (file.name || 'photo').replace(/\.[^.]+$/, '')
  return new File([blob], `${safeName}.jpg`, { type: 'image/jpeg', lastModified: Date.now() })
}
