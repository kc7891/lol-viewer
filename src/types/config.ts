/**
 * Configuration type definitions
 */

import { z } from 'zod';

/**
 * Browser type
 */
export type BrowserType = 'chromium' | 'firefox' | 'webkit';

/**
 * Browser configuration schema
 */
export const BrowserConfigSchema = z.object({
  type: z.enum(['chromium', 'firefox', 'webkit']).default('chromium'),
  executablePath: z.string().optional(),
  headless: z.boolean().default(false),
  width: z.number().min(100).max(3840).default(1200),
  height: z.number().min(100).max(2160).default(800),
  reuseExisting: z.boolean().default(true),
});

/**
 * Feature configuration schema
 */
export const FeatureConfigSchema = z.object({
  enabled: z.boolean().default(true),
  trigger: z.enum(['hover', 'pick', 'lock-in']).default('pick'),
});

/**
 * Build guide feature configuration schema
 */
export const BuildGuideConfigSchema = FeatureConfigSchema.extend({
  inGame: z.boolean().default(true),
});

/**
 * LoL Analytics configuration schema
 */
export const LoLAnalyticsConfigSchema = z.object({
  baseUrl: z.string().url().default('https://lolanalytics.com'),
  autoOpenDelay: z.number().min(0).max(10000).default(2000),
  features: z.object({
    matchup: FeatureConfigSchema,
    myCounters: FeatureConfigSchema,
    enemyCounters: FeatureConfigSchema,
    buildGuide: BuildGuideConfigSchema,
  }),
});

/**
 * LCU configuration schema
 */
export const LCUConfigSchema = z.object({
  autoDetect: z.boolean().default(true),
  retryInterval: z.number().min(1000).max(30000).default(5000),
  maxRetries: z.number().min(1).max(100).default(10),
  enableSSL: z.boolean().default(true),
  verifyCertificate: z.boolean().default(false),
});

/**
 * UI configuration schema
 */
export const UIConfigSchema = z.object({
  mode: z.enum(['terminal', 'silent']).default('terminal'),
  showNotifications: z.boolean().default(true),
  verbose: z.boolean().default(false),
  colorEnabled: z.boolean().default(true),
});

/**
 * Main configuration schema
 */
export const ConfigSchema = z.object({
  browser: BrowserConfigSchema,
  lolAnalytics: LoLAnalyticsConfigSchema,
  lcu: LCUConfigSchema,
  ui: UIConfigSchema,
});

/**
 * Configuration type (inferred from schema)
 */
export type Config = z.infer<typeof ConfigSchema>;

/**
 * Browser configuration type
 */
export type BrowserConfig = z.infer<typeof BrowserConfigSchema>;

/**
 * Feature configuration type
 */
export type FeatureConfig = z.infer<typeof FeatureConfigSchema>;

/**
 * Build guide configuration type
 */
export type BuildGuideConfig = z.infer<typeof BuildGuideConfigSchema>;

/**
 * LoL Analytics configuration type
 */
export type LoLAnalyticsConfig = z.infer<typeof LoLAnalyticsConfigSchema>;

/**
 * LCU configuration type
 */
export type LCUConfig = z.infer<typeof LCUConfigSchema>;

/**
 * UI configuration type
 */
export type UIConfig = z.infer<typeof UIConfigSchema>;

/**
 * Default configuration
 */
export const DEFAULT_CONFIG: Config = {
  browser: {
    type: 'chromium',
    headless: false,
    width: 1200,
    height: 800,
    reuseExisting: true,
  },
  lolAnalytics: {
    baseUrl: 'https://lolanalytics.com',
    autoOpenDelay: 2000,
    features: {
      matchup: {
        enabled: true,
        trigger: 'pick',
      },
      myCounters: {
        enabled: true,
        trigger: 'hover',
      },
      enemyCounters: {
        enabled: true,
        trigger: 'pick',
      },
      buildGuide: {
        enabled: true,
        trigger: 'lock-in',
        inGame: true,
      },
    },
  },
  lcu: {
    autoDetect: true,
    retryInterval: 5000,
    maxRetries: 10,
    enableSSL: true,
    verifyCertificate: false,
  },
  ui: {
    mode: 'terminal',
    showNotifications: true,
    verbose: false,
    colorEnabled: true,
  },
};
