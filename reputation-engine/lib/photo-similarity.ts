export interface PhotoSignature { hash: string; contrast: number; mean: number }
export function photoSignature(pixels: Uint8Array): PhotoSignature {
  if (pixels.length !== 72) throw new Error('Expected a 9 by 8 grayscale image')
  let bits = ''
  let contrast = 0
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    const difference = pixels[y * 9 + x] - pixels[y * 9 + x + 1]
    bits += difference > 0 ? '1' : '0'
    contrast += Math.abs(difference)
  }
  return { hash: Array.from({ length: 16 }, (_, i) => parseInt(bits.slice(i * 4, i * 4 + 4), 2).toString(16)).join(''), contrast: contrast / 64, mean: pixels.reduce((sum, value) => sum + value, 0) / 72 }
}
export function potentiallySamePhoto(a: PhotoSignature, b: PhotoSignature) {
  if (a.contrast < 5 || b.contrast < 5 || Math.abs(a.mean - b.mean) > 25) return false
  let distance = 0
  for (let i = 0; i < 16; i++) {
    let bits = parseInt(a.hash[i], 16) ^ parseInt(b.hash[i], 16)
    while (bits) { distance++; bits &= bits - 1 }
  }
  return distance <= 5
}
