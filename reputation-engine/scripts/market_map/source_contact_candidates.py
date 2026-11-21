"""Find literal public contact candidates without an LLM or inferred emails.

Presence in a page is not organizational ownership, deliverability or outreach consent.
"""
import re

EMAIL = re.compile(r"(?<![\w.+-])[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}(?![\w.-])")
PHONE = re.compile(r'(?<!\d)(?:\+?1[ .-]?)?(?:\(\d{3}\)|\d{3})[ .-]\d{3}[ .-]\d{4}(?!\d)')


def extract(source):
    text = source['text']
    found = []
    seen = set()
    for kind, regex in [('email', EMAIL), ('phone_or_fax', PHONE)]:
        for match in regex.finditer(text):
            value = match.group()
            key = (kind, value.casefold() if kind == 'email' else re.sub(r'\D', '', value))
            if key in seen:
                continue
            seen.add(key)
            found.append({'type': kind, 'literal_value': value,
                          'context': text[max(0,match.start()-120):match.end()+120],
                          'source_url': source['url'], 'body_sha256': source['body_sha256'],
                          'text_start': match.start(), 'text_end': match.end(),
                          'organization_scope': 'requires_review',
                          'deliverability': 'not_tested', 'outreach_eligible': False})
    return found
