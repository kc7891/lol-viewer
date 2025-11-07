/**
 * Build LoLAnalytics URL for a champion
 * @param {string} championName - The champion name
 * @param {string} page - The page type ('build' or 'counters')
 * @returns {string} The LoLAnalytics URL
 */
function buildLoLAnalyticsUrl(championName, page = 'build') {
  if (typeof championName !== 'string') {
    throw new Error('Champion name must be a non-empty string');
  }

  const normalizedName = championName.trim().toLowerCase();

  if (normalizedName === '') {
    throw new Error('Champion name cannot be empty');
  }

  const validPages = ['build', 'counters'];
  if (!validPages.includes(page)) {
    throw new Error(`Page must be one of: ${validPages.join(', ')}`);
  }

  return `https://lolalytics.com/lol/${normalizedName}/${page}/`;
}

module.exports = { buildLoLAnalyticsUrl };
