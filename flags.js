// Team name -> ISO 3166-1 alpha-2 (or flagcdn special) code, for https://flagcdn.com
const TEAM_FLAG_CODES = {
  'Mexico': 'mx', 'South Africa': 'za', 'South Korea': 'kr', 'Czechia': 'cz',
  'Switzerland': 'ch', 'Canada': 'ca', 'Bosnia and Herzegovina': 'ba', 'Qatar': 'qa',
  'Brazil': 'br', 'Morocco': 'ma', 'Scotland': 'gb-sct', 'Haiti': 'ht',
  'USA': 'us', 'Australia': 'au', 'Paraguay': 'py', 'Turkey': 'tr',
  'Germany': 'de', 'Ivory Coast': 'ci', 'Ecuador': 'ec', 'Curacao': 'cw',
  'Netherlands': 'nl', 'Japan': 'jp', 'Sweden': 'se', 'Tunisia': 'tn',
  'Belgium': 'be', 'Egypt': 'eg', 'Iran': 'ir', 'New Zealand': 'nz',
  'Spain': 'es', 'Cape Verde': 'cv', 'Uruguay': 'uy', 'Saudi Arabia': 'sa',
  'France': 'fr', 'Norway': 'no', 'Senegal': 'sn', 'Iraq': 'iq',
  'Argentina': 'ar', 'Austria': 'at', 'Algeria': 'dz', 'Jordan': 'jo',
  'Colombia': 'co', 'Portugal': 'pt', 'DR Congo': 'cd', 'Uzbekistan': 'uz',
  'England': 'gb-eng', 'Croatia': 'hr', 'Ghana': 'gh', 'Panama': 'pa',
};

function flagUrl(team, width) {
  const code = TEAM_FLAG_CODES[team];
  const w = width || 80;
  if (!code) return '';
  return `https://flagcdn.com/w${w}/${code}.png`;
}
