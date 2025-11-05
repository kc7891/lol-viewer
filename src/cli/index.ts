#!/usr/bin/env node
/**
 * CLI entry point
 */

import { Command } from 'commander';
import { loadConfig } from '../utils/config.js';
import { logger } from '../utils/logger.js';
import { URLBuilder } from '../core/analytics/url-builder.js';
import { browserController } from '../core/browser/controller.js';
import { Application } from '../index.js';
import { version, description } from '../../package.json';

/**
 * Main CLI function
 */
async function main() {
  const program = new Command();

  program
    .name('lol-analytics-viewer')
    .description(description)
    .version(version);

  // Start command (default)
  program
    .command('start', { isDefault: true })
    .description('Start the LoL Analytics Browser Viewer')
    .option('-c, --config <path>', 'Path to custom config file')
    .option('-v, --verbose', 'Enable verbose logging')
    .action(async (options) => {
      try {
        const config = await loadConfig(options.config);

        if (options.verbose) {
          config.ui.verbose = true;
        }

        const app = new Application(config);
        await app.initialize();
        await app.start();

        logger.info('Press Ctrl+C to stop');
      } catch (error) {
        logger.error('Failed to start application', error as Error);
        process.exit(1);
      }
    });

  // Matchup command
  program
    .command('matchup <champ1> <champ2>')
    .description('Open matchup page for two champions')
    .option('-r, --role <role>', 'Specify role (top, jungle, mid, adc, support)')
    .action(async (champ1: string, champ2: string, options) => {
      try {
        const config = await loadConfig();
        const urlBuilder = new URLBuilder('lol-analytics', config.lolAnalytics.baseUrl);

        const url = urlBuilder.buildMatchupURL(champ1, champ2, options.role);
        logger.info(`Opening matchup: ${champ1} vs ${champ2}`, { role: options.role });

        await browserController.open(url);
        logger.success('Opened matchup page');
        process.exit(0);
      } catch (error) {
        logger.error('Failed to open matchup', error as Error);
        process.exit(1);
      }
    });

  // Counters command
  program
    .command('counters <champion>')
    .description('Open counters page for a champion')
    .option('-r, --role <role>', 'Specify role (top, jungle, mid, adc, support)')
    .action(async (champion: string, options) => {
      try {
        const config = await loadConfig();
        const urlBuilder = new URLBuilder('lol-analytics', config.lolAnalytics.baseUrl);

        const url = urlBuilder.buildCounterURL(champion, options.role);
        logger.info(`Opening counters for: ${champion}`, { role: options.role });

        await browserController.open(url);
        logger.success('Opened counters page');
        process.exit(0);
      } catch (error) {
        logger.error('Failed to open counters', error as Error);
        process.exit(1);
      }
    });

  // Counter-of command (what counters this champion)
  program
    .command('counter-of <champion>')
    .description('Open counters page to see what counters this champion')
    .option('-r, --role <role>', 'Specify role (top, jungle, mid, adc, support)')
    .action(async (champion: string, options) => {
      try {
        const config = await loadConfig();
        const urlBuilder = new URLBuilder('lol-analytics', config.lolAnalytics.baseUrl);

        const url = urlBuilder.buildCounterURL(champion, options.role);
        logger.info(`Opening counters for: ${champion}`, { role: options.role });

        await browserController.open(url);
        logger.success('Opened counters page');
        process.exit(0);
      } catch (error) {
        logger.error('Failed to open counters', error as Error);
        process.exit(1);
      }
    });

  // Build command
  program
    .command('build <champion>')
    .description('Open build guide for a champion')
    .option('-r, --role <role>', 'Specify role (top, jungle, mid, adc, support)')
    .action(async (champion: string, options) => {
      try {
        const config = await loadConfig();
        const urlBuilder = new URLBuilder('lol-analytics', config.lolAnalytics.baseUrl);

        const url = urlBuilder.buildBuildURL(champion, options.role);
        logger.info(`Opening build guide for: ${champion}`, { role: options.role });

        await browserController.open(url);
        logger.success('Opened build guide');
        process.exit(0);
      } catch (error) {
        logger.error('Failed to open build guide', error as Error);
        process.exit(1);
      }
    });

  // Champion command
  program
    .command('champion <name>')
    .alias('champ')
    .description('Open champion page')
    .option('-r, --role <role>', 'Specify role (top, jungle, mid, adc, support)')
    .action(async (name: string, options) => {
      try {
        const config = await loadConfig();
        const urlBuilder = new URLBuilder('lol-analytics', config.lolAnalytics.baseUrl);

        const url = urlBuilder.buildChampionURL(name, options.role);
        logger.info(`Opening champion page for: ${name}`, { role: options.role });

        await browserController.open(url);
        logger.success('Opened champion page');
        process.exit(0);
      } catch (error) {
        logger.error('Failed to open champion page', error as Error);
        process.exit(1);
      }
    });

  await program.parseAsync(process.argv);
}

main().catch((error) => {
  logger.error('CLI error', error);
  process.exit(1);
});
