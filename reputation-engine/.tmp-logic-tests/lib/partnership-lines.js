"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_PARTNERSHIP_EMAIL = exports.DEFAULT_PARTNERSHIP_FROM_NUMBER = exports.PARTNERSHIP_REPLY_SENDER_NUMBERS = exports.DEFAULT_PARTNERSHIP_SENDER_NUMBERS = exports.ALL_PARTNERSHIP_SENDER_NUMBERS = exports.TEMP_PARTNERSHIP_SALES_RECOVERY_NUMBER = exports.PARTNERSHIP_LINES = void 0;
exports.getPartnershipMessagingServiceSidForNumber = getPartnershipMessagingServiceSidForNumber;
exports.normalizePartnershipCityKey = normalizePartnershipCityKey;
exports.getPartnershipLinesForMarket = getPartnershipLinesForMarket;
exports.getPartnershipSenderNumbersForMarket = getPartnershipSenderNumbersForMarket;
exports.getPartnershipPrimaryNumberForMarket = getPartnershipPrimaryNumberForMarket;
exports.getPartnershipLineLabel = getPartnershipLineLabel;
exports.isPartnershipSenderNumber = isPartnershipSenderNumber;
const WINDSOR_ESSEX_AND_CHATHAM_CITIES = [
    'windsor',
    'lasalle',
    'la salle',
    'tecumseh',
    'amherstburg',
    'lakeshore',
    'belle river',
    'comber',
    'stoney point',
    'st. joachim',
    'st joachim',
    'puce',
    'emeryville',
    'anderdon',
    'leamington',
    'kingsville',
    'essex',
    'harrow',
    'mcgregor',
    'cottam',
    'ruthven',
    'colchester',
    'maidstone',
    'wheatley',
    'chatham',
    'chatham kent',
    'chatham-kent',
    'tilbury',
    'wallaceburg',
    'dresden',
    'pain court',
    'blenheim',
    'merlin',
    'charing cross',
    'cedar springs',
    'dealtown',
    'ridgetown',
    'thamesville',
    'bothwell',
    'highgate',
    'morpeth',
    'muirkirk',
    "mitchell's bay",
    'mitchells bay',
    'lighthouse cove',
    'erieau',
    'shrewsbury',
    'erie beach',
];
const WATERLOO_KWG_CITIES = [
    'kitchener',
    'waterloo',
    'cambridge',
    'guelph',
    'kw',
    'k w',
    'kwc',
    'kwg',
    'wkg',
    'kitchener waterloo',
    'kitchener-waterloo',
    'kitchener and waterloo',
    'elmira',
    'st jacobs',
    'st. jacobs',
    'conestogo',
    'breslau',
    'woolwich',
    'new hamburg',
    'baden',
    'wellesley',
    'wilmot',
    'ayr',
    'north dumfries',
    'puslinch',
    'guelph eramosa',
    'guelph-eramosa',
    'rockwood',
    'fergus',
    'elora',
    'centre wellington',
    'drayton',
    'mapleton',
    'arthur',
    'palmerston',
    'stratford',
    'listowel',
    'paris',
];
const LONDON_MIDDLESEX_SARNIA_WOODSTOCK_CITIES = [
    'london',
    'lucan',
    'lucan biddulph',
    'ailsa craig',
    'parkhill',
    'ilderton',
    'north middlesex',
    'strathroy',
    'strathroy-caradoc',
    'mount brydges',
    'kerwood',
    'glencoe',
    'newbury',
    'wardsville',
    'adelaide-metcalfe',
    'southwest middlesex',
    'komoka',
    'middlesex centre',
    'dorchester',
    'thames centre',
    'belmont',
    'st thomas',
    'st. thomas',
    'st-thomas',
    'central elgin',
    'southwold',
    'talbotville',
    'shedden',
    'fingal',
    'port stanley',
    'dutton',
    'dutton-dunwich',
    'west lorne',
    'rodney',
    'aylmer',
    'springfield',
    'malahide',
    'bayham',
    'vienna',
    'port burwell',
    'st marys',
    'st. marys',
    'sarnia',
    'point edward',
    'brights grove',
    'camlachie',
    'corunna',
    'mooretown',
    'courtright',
    'sombra',
    'port lambton',
    'st clair',
    'st. clair',
    'dawn-euphemia',
    'petrolia',
    'oil springs',
    'brigden',
    'wyoming',
    'plympton-wyoming',
    'watford',
    'warwick',
    'alvinston',
    'brooke-alvinston',
    'arkona',
    'forest',
    'thedford',
    'grand bend',
    'lambton shores',
    'port franks',
    'ipperwash',
    'woodstock',
    'ingersoll',
    'beachville',
    'sweaburg',
    'burgessville',
    'otterville',
    'norwich',
    'mount elgin',
    'courtland',
    'tillsonburg',
    'tavistock',
    'thamesford',
    'innerkip',
    'east zorra-tavistock',
    'embro',
    'hickson',
    'kintore',
    'zorra',
    'drumbo',
    'princeton',
    'plattsville',
    'bright',
    'delhi',
];
const OTTAWA_CITIES = [
    'ottawa',
    'kanata',
    'nepean',
    'orleans',
    'orléans',
    'barrhaven',
    'gloucester',
    'stittsville',
    'manotick',
    'rockland',
    'carp',
];
exports.PARTNERSHIP_LINES = [
    {
        number: '+12268870667',
        label: 'Windsor Partnership',
        market: 'windsor',
        cityKeys: WINDSOR_ESSEX_AND_CHATHAM_CITIES,
        primary: true,
    },
    {
        number: '+12266055008',
        label: 'Windsor Partnership 2',
        market: 'windsor',
        cityKeys: WINDSOR_ESSEX_AND_CHATHAM_CITIES,
    },
    {
        number: '+12262419853',
        label: 'Kitchener / Waterloo Partnership',
        market: 'waterloo',
        cityKeys: WATERLOO_KWG_CITIES,
        primary: true,
    },
    {
        number: '+15486391428',
        label: 'London Partnership',
        market: 'london',
        cityKeys: LONDON_MIDDLESEX_SARNIA_WOODSTOCK_CITIES,
        primary: true,
    },
    {
        number: '+15482908695',
        label: 'Ottawa Partnership',
        market: 'ottawa',
        cityKeys: OTTAWA_CITIES,
        primary: true,
    },
];
exports.TEMP_PARTNERSHIP_SALES_RECOVERY_NUMBER = '+12267732993';
exports.ALL_PARTNERSHIP_SENDER_NUMBERS = exports.PARTNERSHIP_LINES.map(line => line.number);
exports.DEFAULT_PARTNERSHIP_SENDER_NUMBERS = exports.PARTNERSHIP_LINES
    .filter(line => line.primary)
    .map(line => line.number);
exports.PARTNERSHIP_REPLY_SENDER_NUMBERS = [
    ...exports.ALL_PARTNERSHIP_SENDER_NUMBERS,
    exports.TEMP_PARTNERSHIP_SALES_RECOVERY_NUMBER,
];
exports.DEFAULT_PARTNERSHIP_FROM_NUMBER = exports.PARTNERSHIP_LINES.find(line => line.market === 'windsor' && line.primary)?.number ||
    exports.PARTNERSHIP_LINES[0]?.number ||
    '+12268870667';
exports.DEFAULT_PARTNERSHIP_EMAIL = 'partnerships@starmovers.ca';
const PARTNERSHIP_MESSAGING_SERVICE_BY_NUMBER = {
    '+12262419853': 'MGd5a83e63bb6dec9869788e5c1e9b128b',
    '+15486391428': 'MG340c67baa0824a8880ad0bb91c8701df',
};
function getPartnershipMessagingServiceSidForNumber(number) {
    return number ? PARTNERSHIP_MESSAGING_SERVICE_BY_NUMBER[number] || null : null;
}
function normalizePartnershipCityKey(value) {
    return (value || '')
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}
function getPartnershipLinesForMarket(market) {
    const key = normalizePartnershipCityKey(market);
    const exactMarket = exports.PARTNERSHIP_LINES.filter(line => line.market === key);
    if (exactMarket.length > 0)
        return exactMarket;
    const cityMatch = exports.PARTNERSHIP_LINES.filter(line => line.cityKeys.some(cityKey => {
        const city = normalizePartnershipCityKey(cityKey);
        return city === key || (!!key && key.includes(city)) || (!!city && city.includes(key));
    }));
    if (cityMatch.length > 0)
        return cityMatch;
    return exports.PARTNERSHIP_LINES.filter(line => line.market === 'windsor');
}
function getPartnershipSenderNumbersForMarket(market, options) {
    const lines = getPartnershipLinesForMarket(market);
    if (options?.includeSecondary)
        return lines.map(line => line.number);
    const primaryLines = lines.filter(line => line.primary);
    return (primaryLines.length > 0 ? primaryLines : lines).map(line => line.number);
}
function getPartnershipPrimaryNumberForMarket(market) {
    const lines = getPartnershipLinesForMarket(market);
    return lines.find(line => line.primary)?.number || lines[0]?.number || exports.DEFAULT_PARTNERSHIP_FROM_NUMBER;
}
function getPartnershipLineLabel(number) {
    const line = exports.PARTNERSHIP_LINES.find(item => item.number === number);
    return line?.label || 'Partnership line';
}
function isPartnershipSenderNumber(number, options) {
    const allowed = options?.includeRecovery ? exports.PARTNERSHIP_REPLY_SENDER_NUMBERS : exports.ALL_PARTNERSHIP_SENDER_NUMBERS;
    return !!number && allowed.includes(number);
}
