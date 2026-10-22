import { inferSalesBranchFromCity } from './sales-phones'
/** GTA coverage uses the shared city routing; retain established other-market assignments. */
export function partnershipHandoffBranch(city: string | null) {
  if (inferSalesBranchFromCity(city) === 'toronto') return 'toronto'
  const value = String(city || '').toLowerCase()
  if (/ottawa|kanata|orleans|nepean/.test(value)) return 'ottawa'
  if (/london|woodstock|guelph|kitchener|waterloo|cambridge|sarnia|chatham/.test(value)) return 'kitchener'
  return 'windsor'
}
