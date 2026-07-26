export type ExperimentVariant = {
  id: string
  weight: number
}

function stableHash(value: string) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

export function assignExperimentVariant(input: {
  experimentKey: string
  subjectId: string
  variants: ExperimentVariant[]
}) {
  const variants = input.variants.filter(variant => variant.id && variant.weight > 0)
  if (variants.length === 0) throw new Error('At least one weighted experiment variant is required.')
  const totalWeight = variants.reduce((sum, variant) => sum + variant.weight, 0)
  const bucket = stableHash(`${input.experimentKey}:${input.subjectId}`) % totalWeight
  let cursor = 0
  for (const variant of variants) {
    cursor += variant.weight
    if (bucket < cursor) return variant.id
  }
  return variants[variants.length - 1].id
}
