/**
 * Configuration loader with Zod validation
 */

import { readFile, access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ConfigSchema, DEFAULT_CONFIG, type Config } from '../types/config.js';
import { logger } from './logger.js';

/**
 * Default config file locations (in order of precedence)
 */
const CONFIG_PATHS = [
  './config.json',
  join(homedir(), '.lol-viewer', 'config.json'),
  './config/default.json',
];

/**
 * Check if a file exists
 */
async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Load configuration from file
 */
async function loadConfigFile(path: string): Promise<Partial<Config> | null> {
  try {
    const exists = await fileExists(path);
    if (!exists) {
      return null;
    }

    const content = await readFile(path, 'utf-8');
    const json = JSON.parse(content);

    logger.debug(`Loaded config from ${path}`);
    return json;
  } catch (error) {
    logger.warn(`Failed to load config from ${path}`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Deep merge two objects
 */
function deepMerge<T extends Record<string, unknown>>(target: T, source: Partial<T>): T {
  const result = { ...target };

  for (const key in source) {
    const sourceValue = source[key];
    const targetValue = result[key];

    if (
      sourceValue &&
      typeof sourceValue === 'object' &&
      !Array.isArray(sourceValue) &&
      targetValue &&
      typeof targetValue === 'object' &&
      !Array.isArray(targetValue)
    ) {
      result[key] = deepMerge(
        targetValue as Record<string, unknown>,
        sourceValue as Record<string, unknown>
      ) as T[Extract<keyof T, string>];
    } else if (sourceValue !== undefined) {
      result[key] = sourceValue as T[Extract<keyof T, string>];
    }
  }

  return result;
}

/**
 * Load and validate configuration
 *
 * @param customPath - Optional custom config file path
 * @returns Validated configuration
 */
export async function loadConfig(customPath?: string): Promise<Config> {
  let config: Partial<Config> = {};

  // Try to load from default locations
  if (!customPath) {
    for (const path of CONFIG_PATHS) {
      const loaded = await loadConfigFile(path);
      if (loaded) {
        config = deepMerge(config, loaded);
        break; // Use first found config
      }
    }
  } else {
    // Load custom config
    const loaded = await loadConfigFile(customPath);
    if (loaded) {
      config = loaded;
    } else {
      logger.warn(`Custom config file not found: ${customPath}, using defaults`);
    }
  }

  // Merge with defaults
  const merged = deepMerge(DEFAULT_CONFIG, config);

  // Validate with Zod
  try {
    const validated = ConfigSchema.parse(merged);
    logger.info('Configuration loaded successfully');
    return validated;
  } catch (error) {
    logger.error('Configuration validation failed, using defaults', error as Error);
    return DEFAULT_CONFIG;
  }
}

/**
 * Load configuration synchronously (for testing)
 * Note: Only returns defaults, doesn't actually load from files
 */
export function loadConfigSync(): Config {
  return DEFAULT_CONFIG;
}
