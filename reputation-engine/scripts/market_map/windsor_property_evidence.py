"""Small source-backed property batch; preserve contact scope and unknown ownership."""
import hashlib
import html
import json
from pathlib import Path
from .windsor_operator_groups import VisibleText
from .windsor_physical_report import ROOT


def build():
    output = ROOT / 'artifacts/windsor-property-evidence-20261029'
    output.mkdir(exist_ok=True)
    specs = [('Greenwood Apartments', '9935 Riverside Drive East', 'residential_apartment', 'greenwood-apartments', 'greenwood'),
             ('Pine Aire Towers', '1385 Riverside Drive West', 'residential_apartment', 'pine-aire-towers', 'pine'),
             ('Riverside Plaza', '8400 Wyandotte St E', 'commercial_retail_plaza', 'riverside-plaza', 'plaza')]
    records, observations, sources = [], [], []
    group_id = hashlib.sha256(b'https://bakerinvestmentsltd.com/').hexdigest()[:20]
    for name, address, use, slug, local in specs:
        url = 'https://bakerinvestmentsltd.com/property-item/'+slug+'/'
        body = Path('/private/tmp/windsor-baker-'+local+'.html').read_bytes()
        parser = VisibleText(); parser.feed(body.decode()); text = '\n'.join(parser.parts)
        expected = [name, address, 'Windsor', 'Baker Investments Limited', 'info@bakerinvestmentsltd.com', '519-253-7219', '615 Pelissier St.']
        if not all(value in text for value in expected):
            raise ValueError('Source assertion missing; review saved page')
        raw = output / (slug+'.html'); raw.write_bytes(body)
        sid = hashlib.sha256(url.encode()).hexdigest()[:20]
        source = {'source_id': sid, 'source_url': url, 'checked_on': '2026-10-29',
                  'sha256': hashlib.sha256(body).hexdigest(), 'raw_evidence_reference': str(raw.relative_to(ROOT)),
                  'licence': 'No established bulk reuse licence; internal factual research only; raw page not publicly republished.'}
        sources.append(source)
        record = {**source, 'property': name, 'address': address, 'municipality': 'Windsor',
                  'published_building_use': use, 'type_evidence': 'Explicit property-page description; not inferred from floors or zoning',
                  'organization': 'Baker Investments Limited', 'group_id': group_id,
                  'relationship_type': 'listed_in_company_property_portfolio',
                  'legal_property_owner_verified': False, 'management_contract_verified': False,
                  'current_commercial_occupants': [], 'private_residents_collected': False,
                  'individual_decision_maker': None, 'outreach_eligible': False,
                  'research_next': 'Identify property operations/facilities contact; confirm scope. For the plaza, research commercial tenants separately.'}
        records.append(record)
        observations.append({'organization': name, 'address': address, 'unit_or_floor': None,
            'relationship': 'Property listed by Baker Investments Limited; '+use+'; management/ownership contract unverified',
            'source_url': url, 'status': 'company_property_page_address_supported',
            'checked_on': '2026-10-29', 'raw_evidence_reference': source['raw_evidence_reference'],
            'group_name': 'Baker Investments Limited', 'group_id': group_id})
    contacts = [{'contact_id': 'baker-company-leasing-enquiry', 'organization': 'Baker Investments Limited',
        'person_name': None, 'published_role': 'Leasing inquiries / general company contact',
        'email': 'info@bakerinvestmentsltd.com', 'phone': '519-253-7219',
        'office_address': '615 Pelissier St., Windsor, ON, N9A 4L4',
        'scope': 'Shared company contact published on three reviewed property pages; not three separate people',
        'procurement_authority_verified': False, 'source_ids': [s['source_id'] for s in sources],
        'checked_on': '2026-10-29', 'communication_eligibility': 'not_assessed', 'outreach_eligible': False}]
    # Policy hold stores source metadata only, not the restricted contact/property content.
    holds = [{'source_url': 'https://www.scpl.com/residential-rental/lonsdale-apartments',
              'policy_url': 'https://www.scpl.com/terms-of-use', 'status': 'commercial_reuse_restricted',
              'reason': 'Publisher limits downloaded materials to personal non-commercial use; no content/contact imported into this dataset.',
              'next_action': 'Use an independently reusable source or seek publisher permission before collection.'}]
    result = {'properties': records, 'contacts': contacts, 'source_policy_holds': holds,
              'property_count': len(records), 'distinct_company_contact_channels': len(contacts),
              'new_verified_organizations': None, 'database_writes': 0}
    (output/'evidence.json').write_text(json.dumps(result, indent=2))
    path = Path(__file__).with_name('windsor_address_evidence.json'); evidence = json.loads(path.read_text())
    urls = {s['source_url'] for s in sources}
    evidence['observations'] = [o for o in evidence['observations'] if o['source_url'] not in urls] + observations
    path.write_text(json.dumps(evidence, indent=2)+'\n')
    rows = ''.join('<tr><td>'+html.escape(r['property'])+'</td><td>'+html.escape(r['address'])+'</td><td>'+r['published_building_use'].replace('_',' ')+'</td><td><a href="'+r['source_url']+'">Source</a></td></tr>' for r in records)
    (output/'index.html').write_text('<!doctype html><meta charset="utf-8"><title>Windsor property evidence</title><style>body{background:#101b28;color:#edf5ff;font:17px system-ui;max-width:1100px;margin:40px auto;padding:20px}td{padding:14px;border-bottom:1px solid #587080}a{color:#72dfcb}p{line-height:1.6}</style><h1>Properties, organizations and contact scope</h1><p><a href="../windsor-address-investigation-20261029/index.html">Windsor research progress</a></p><h2>Baker Investments Limited</h2><table>'+rows+'</table><p>These three properties appear in the company’s own portfolio. Ownership and management-contract details remain unverified. The two apartment buildings are commercial relationship leads at the property-management level; no residents are enumerated.</p><h2>One shared company contact</h2><p>Leasing/general inquiries: info@bakerinvestmentsltd.com · 519-253-7219<br>Office: 615 Pelissier St., Windsor, ON, N9A 4L4.</p><p>Not a named owner or verified procurement decision-maker. Repeated contact details across properties count once. No outreach has been activated.</p><h2>Source access gap</h2><p>One other property publisher restricts commercial reuse. Its property/contact information has not been imported. Research can continue through independent permitted sources.</p>')
    print(json.dumps({k:v for k,v in result.items() if k not in ('properties','contacts','source_policy_holds')}, indent=2))


if __name__ == '__main__': build()
