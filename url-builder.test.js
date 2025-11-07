const { buildLoLAnalyticsUrl } = require('./url-builder');

describe('buildLoLAnalyticsUrl', () => {
  test('builds correct URL for champion name', () => {
    const url = buildLoLAnalyticsUrl('Ashe');
    expect(url).toBe('https://lolalytics.com/lol/ashe/build/');
  });

  test('normalizes champion name to lowercase', () => {
    const url = buildLoLAnalyticsUrl('YASUO');
    expect(url).toBe('https://lolalytics.com/lol/yasuo/build/');
  });

  test('trims whitespace from champion name', () => {
    const url = buildLoLAnalyticsUrl('  Jinx  ');
    expect(url).toBe('https://lolalytics.com/lol/jinx/build/');
  });

  test('builds URL for counters page', () => {
    const url = buildLoLAnalyticsUrl('Swain', 'counters');
    expect(url).toBe('https://lolalytics.com/lol/swain/counters/');
  });

  test('throws error for empty champion name', () => {
    expect(() => buildLoLAnalyticsUrl('')).toThrow('Champion name cannot be empty');
  });

  test('throws error for whitespace-only champion name', () => {
    expect(() => buildLoLAnalyticsUrl('   ')).toThrow('Champion name cannot be empty');
  });

  test('throws error for null champion name', () => {
    expect(() => buildLoLAnalyticsUrl(null)).toThrow('Champion name must be a non-empty string');
  });

  test('throws error for invalid page type', () => {
    expect(() => buildLoLAnalyticsUrl('Ashe', 'invalid')).toThrow('Page must be one of: build, counters');
  });
});
