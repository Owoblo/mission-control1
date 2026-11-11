"""Pure phone syntax normalization; never carrier, owner or outreach validation."""
import re
import unicodedata
from urllib.parse import unquote

PHONE_NORMALIZATION_VERSION = 'ssm-phone-normalization/1'
EXT = re.compile(r'(?:;ext=|\bext(?:ension)?\.?\s*[:=]?\s*|\bx\s*|#\s*)([0-9]{1,10})\s*$', re.I)
_PUNCTUATION = str.maketrans({**{c: ' ' for c in '\u00a0\u2007\u2009\u202f'},
                            **{c: '-' for c in '\u2010\u2011\u2012\u2013\u2014\u2212'}})
_NANP = re.compile(r'[2-9][0-9]{2}[2-9][0-9]{6}')

EMAIL_NORMALIZATION_VERSION = 'ssm-email-normalization/1'
EMAIL_ASSET_TLDS = {'png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'css', 'js', 'woff', 'woff2', 'ico'}
EMAIL_PLACEHOLDER_DOMAINS = {'example.com', 'example.org', 'example.net'}


def parse_email_candidate(value):
    """Conservative dot-atom local part; round-trip-safe stdlib IDNA2003 domains.

    No EAI/quoted-local repair and no percent/entity decoding at this layer.
    IDNA mappings that change the Unicode spelling beyond NFC/lowercase are
    unsupported (e.g. sharp-s to ss), rather than silently targeting another host.
    """
    raw = str(value or '')
    result = {'raw_value': raw, 'email': None, 'status': 'invalid', 'reason': None,
              'normalization_version': EMAIL_NORMALIZATION_VERSION}
    def reject(reason, status='invalid'):
        result.update(reason=reason, status=status)
        return result
    if any(unicodedata.category(c) in ('Cc', 'Cf') for c in raw):
        return reject('control_or_format_character')
    candidate = raw.strip().strip('<>').rstrip('.,;:')
    result['candidate_value'] = candidate
    if candidate.count('@') != 1:
        return reject('invalid_at_count')
    local, domain = candidate.rsplit('@', 1)
    if local.startswith('"') or local.endswith('"') or domain.startswith('['):
        return reject('quoted_local_or_domain_literal', 'unsupported')
    if any(ord(c) > 127 for c in local):
        return reject('unicode_local_part', 'unsupported')
    if not re.fullmatch(r"[A-Za-z0-9!#$%&'*+/=?^_`{|}~.-]{1,64}", local) or local.startswith('.') or local.endswith('.') or '..' in local:
        return reject('invalid_local_part')
    domain = unicodedata.normalize('NFC', domain).lower()
    if not domain or any(c.isspace() for c in domain) or '.' not in domain:
        return reject('invalid_domain')
    labels = []
    for label in domain.split('.'):
        try:
            encoded = label.encode('idna').decode('ascii').lower()
            decoded = encoded.encode('ascii').decode('idna')
        except UnicodeError:
            return reject('invalid_idna_label')
        if any(ord(c) > 127 for c in label) and unicodedata.normalize('NFC', decoded).lower() != label:
            return reject('non_roundtrip_idna_mapping', 'unsupported')
        if not re.fullmatch(r'[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?', encoded):
            return reject('invalid_domain_label')
        labels.append(encoded)
    host = '.'.join(labels)
    if not (re.fullmatch(r'[a-z]{2,63}', labels[-1]) or labels[-1].startswith('xn--')):
        return reject('unsupported_tld', 'unsupported')
    if len(host) > 253 or len(local + '@' + host) > 254:
        return reject('address_too_long')
    if labels[-1] in EMAIL_ASSET_TLDS or host in EMAIL_PLACEHOLDER_DOMAINS:
        return reject('asset_or_placeholder')
    result.update(email=local + '@' + host, status='normalized', reason='supported_syntax_only')
    return result


def parse_phone_candidate(value):
    """Retain raw/rejected candidates without placing them in valid-phone output.

    International support is explicit-plus E.164 *shape* only. No country-code
    registry, trunk-prefix guessing, carrier lookup or geographic inference.
    """
    raw = str(value)
    result = {'raw_value': raw, 'e164': None, 'extension': '', 'status': 'invalid',
              'reason': None, 'normalization_version': PHONE_NORMALIZATION_VERSION}

    def reject(reason, status='invalid'):
        result.update(reason=reason, status=status)
        return result

    decoded = unquote(raw)
    if re.search(r'[\x00-\x1f\x7f]', decoded):
        return reject('control_character')
    base = re.sub(r'^tel:', '', decoded.strip(), flags=re.I).split('?', 1)[0].translate(_PUNCTUATION).strip()
    extension = EXT.search(base)
    if extension:
        result['extension'] = extension.group(1)
        base = base[:extension.start()].strip()
    if not base:
        return reject('empty_number')
    if re.search(r'[^0-9 ()+.\-]', base):
        return reject('unsupported_character_or_uri_parameter', 'unsupported')
    explicit = base.startswith('+')
    if base.count('+') != (1 if explicit else 0):
        return reject('misplaced_or_multiple_plus')
    if base.count('(') != base.count(')') or base.count('(') > 1 or ('(' in base and not re.search(r'\([0-9 ]+\)', base)):
        return reject('malformed_parentheses')
    digits = re.sub(r'[^0-9]', '', base)
    if explicit and not digits.startswith('1'):
        if not re.fullmatch(r'[2-9][0-9]{7,14}', digits):
            return reject('invalid_international_shape')
        result.update(e164='+' + digits, status='normalized', reason='international_shape_only')
        return result
    # An explicit +1 must have precisely 11 digits and valid NANP NPA/NXX.
    # It can never fall through to the international branch.
    national = digits[1:] if len(digits) == 11 and digits.startswith('1') else digits
    if (explicit and (len(digits) != 11 or not digits.startswith('1'))) or not _NANP.fullmatch(national):
        return reject('invalid_nanp' if explicit or len(digits) in (10, 11) else 'country_context_required')
    result.update(e164='+1' + national, status='normalized', reason='nanp_shape_only')
    return result
