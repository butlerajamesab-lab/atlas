const FIXED_DOMAIN_MAPPINGS = Object.freeze({
  cfpb: 'consumer_protection',
  osha: 'labor',
  epa: 'environment',
  hud: 'housing',
  courtlistener: 'judicial',
  openstates: 'legislative',
  bls: 'labor',
  census: 'civic',
  fec: 'fiscal',
  sec: 'fiscal',
  usaspending: 'fiscal',
  irs: 'fiscal',
  opensecrets: 'legislative',
  fara: 'legislative',
  regulationsgov: 'regulatory',
  grantsgov: 'civic',
  propublica: 'legislative'
});

const DOMAIN_KEYWORDS = Object.freeze({
  housing: ['eviction', 'rent', 'lease', 'tenant', 'housing'],
  labor: ['wage', 'labor', 'employment', 'osha', 'workplace'],
  benefits: ['snap', 'benefit', 'medicaid', 'unemployment'],
  insurance: ['claim denied', 'coverage denied', 'insurance'],
  healthcare: ['hospital', 'medical', 'healthcare'],
  legal: ['court', 'lawsuit', 'petition', 'hearing']
});

const CANONICAL_DOMAIN_MAP = Object.freeze({
  wage: 'labor',
  legal: 'judicial',
  insurance: 'consumer_protection'
});

export function resolveCanonicalDomain(signalType, sourceAdapter, metadata = {}) {
  if (metadata?.domain_override) {
    return metadata.domain_override;
  }

  const adapterKey = String(sourceAdapter || '').toLowerCase().replace(/[^a-z]/g, '');

  if (FIXED_DOMAIN_MAPPINGS[adapterKey]) {
    return FIXED_DOMAIN_MAPPINGS[adapterKey];
  }

  const text = JSON.stringify({ signalType, metadata }).toLowerCase();

  for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
    if (keywords.some(keyword => text.includes(keyword.toLowerCase()))) {
      return CANONICAL_DOMAIN_MAP[domain] || domain;
    }
  }

  return 'civic';
}
