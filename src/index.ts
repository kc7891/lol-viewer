/**
 * Main application entry point
 */

import { EventEmitter } from 'node:events';
import type { Config } from './types/config.js';
import type { ChampSelectEvent, LCUEvent } from './types/event.js';
import type { ChampionPick } from './types/champion.js';
import { loadConfig } from './utils/config.js';
import { logger } from './utils/logger.js';
import { retry } from './utils/retry.js';
import { getLCUCredentials } from './core/lcu/credentials.js';
import { LCUConnector } from './core/lcu/connector.js';
import { ChampSelectEventParser } from './core/lcu/event-parser.js';
import { championDataFetcher } from './core/prediction/champion-data.js';
import { lanePredictor } from './core/prediction/lane-predictor.js';
import { URLBuilder } from './core/analytics/url-builder.js';
import { browserController } from './core/browser/controller.js';

/**
 * Main application class
 */
export class Application extends EventEmitter {
  private config: Config;
  private lcuConnector: LCUConnector;
  private eventParser: ChampSelectEventParser;
  private urlBuilder: URLBuilder;
  private isRunning = false;

  // Track current champion select state
  private allyTeam: ChampionPick[] = [];
  private enemyTeam: ChampionPick[] = [];
  private myChampionPick: ChampionPick | null = null;

  constructor(config: Config) {
    super();
    this.config = config;
    this.lcuConnector = new LCUConnector();
    this.eventParser = new ChampSelectEventParser();
    this.urlBuilder = new URLBuilder('lol-analytics', config.lolAnalytics.baseUrl);
  }

  /**
   * Initialize the application
   */
  async initialize(): Promise<void> {
    logger.info('Initializing LoL Analytics Browser Viewer...');

    // Pre-fetch champion data
    try {
      await championDataFetcher.fetchChampionData();
      logger.success('Champion data loaded');
    } catch (error) {
      logger.warn('Failed to fetch champion data, will retry later', error as Error);
    }

    logger.success('Application initialized');
  }

  /**
   * Start the application
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Application is already running');
      return;
    }

    this.isRunning = true;
    logger.info('Starting application...');

    // Setup LCU event handlers
    this.setupLCUEventHandlers();

    // Connect to LCU with retry
    await this.connectToLCU();

    logger.success('Application started');
  }

  /**
   * Stop the application
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    logger.info('Stopping application...');
    this.isRunning = false;

    // Disconnect from LCU
    this.lcuConnector.disconnect();

    // Clear state
    this.clearChampSelectState();

    logger.success('Application stopped');
  }

  /**
   * Connect to LCU with retry logic
   */
  private async connectToLCU(): Promise<void> {
    try {
      const credentials = await retry(
        () => getLCUCredentials(),
        {
          maxAttempts: this.config.lcu.maxRetries,
          delayMs: this.config.lcu.retryInterval,
          backoff: 'linear',
          onRetry: (attempt) => {
            logger.info(`Waiting for League Client... (attempt ${attempt}/${this.config.lcu.maxRetries})`);
          },
        }
      );

      await this.lcuConnector.connect(credentials);
    } catch (error) {
      logger.error('Failed to connect to League Client', error as Error);
      throw error;
    }
  }

  /**
   * Setup LCU event handlers
   */
  private setupLCUEventHandlers(): void {
    this.lcuConnector.on('event', (event: LCUEvent) => {
      this.handleLCUEvent(event);
    });

    this.lcuConnector.on('disconnected', () => {
      logger.warn('Disconnected from LCU');
      this.clearChampSelectState();
    });

    this.lcuConnector.on('reconnecting', (attempt: number) => {
      logger.info(`Reconnecting to LCU (attempt ${attempt})...`);
    });

    this.lcuConnector.on('error', (error: Error) => {
      logger.error('LCU connection error', error);
    });
  }

  /**
   * Handle LCU events
   */
  private async handleLCUEvent(lcuEvent: LCUEvent): Promise<void> {
    // Parse champion select event
    const champSelectEvent = this.eventParser.parseChampSelectEvent(lcuEvent);
    if (champSelectEvent) {
      await this.handleChampSelectEvent(champSelectEvent);
      return;
    }

    // Parse game start event
    const gameStartEvent = this.eventParser.parseGameStartEvent(lcuEvent);
    if (gameStartEvent) {
      await this.handleGameStart();
      return;
    }
  }

  /**
   * Handle champion select event
   */
  private async handleChampSelectEvent(event: ChampSelectEvent): Promise<void> {
    // Ignore ban events (we only care about picks)
    if (event.type === 'ban') {
      return;
    }

    // Get champion data
    const champion = await championDataFetcher.getChampionById(event.championId);
    if (!champion) {
      logger.warn(`Unknown champion ID: ${event.championId}`);
      return;
    }

    // Update champion name in event
    event = { ...event, championName: champion.name };

    logger.info(`Champion ${event.type}: ${champion.name}`, {
      team: event.team,
      isLocalPlayer: event.isLocalPlayer,
    });

    // Create champion pick
    const pick: ChampionPick = {
      champion,
      team: event.team,
      pickOrder: event.pickOrder,
      isPlayerChampion: event.isLocalPlayer,
    };

    // Predict lane
    const team = event.team === 'ally' ? this.allyTeam : this.enemyTeam;
    const predictedRole = lanePredictor.predict(champion, team, event.pickOrder);
    if (predictedRole) {
      pick.champion = { ...champion, predictedRole };
    }

    // Add to team
    if (event.team === 'ally') {
      this.allyTeam.push(pick);
      if (event.isLocalPlayer) {
        this.myChampionPick = pick;
      }
    } else {
      this.enemyTeam.push(pick);
    }

    // Handle different events
    if (event.isLocalPlayer) {
      await this.handleMyChampionAction(event, pick);
    } else if (event.team === 'enemy') {
      await this.handleEnemyChampionPick(pick);
    }
  }

  /**
   * Handle my champion action (hover/pick/lock-in)
   */
  private async handleMyChampionAction(
    event: ChampSelectEvent,
    pick: ChampionPick
  ): Promise<void> {
    const { champion } = pick;
    const role = champion.predictedRole;

    const urls: string[] = [];

    // Build URLs based on config
    const { features } = this.config.lolAnalytics;

    // Matchup URL (if we know the enemy laner)
    if (features.matchup.enabled && this.shouldTrigger(event.type, features.matchup.trigger)) {
      if (role) {
        const opponent = lanePredictor.predictMatchupOpponent(role, this.enemyTeam);
        if (opponent) {
          const matchupURL = this.urlBuilder.buildMatchupURL(champion.name, opponent.champion.name, role);
          urls.push(matchupURL);
        }
      }
    }

    // My counters URL
    if (features.myCounters.enabled && this.shouldTrigger(event.type, features.myCounters.trigger)) {
      const countersURL = this.urlBuilder.buildCounterURL(champion.name, role);
      urls.push(countersURL);
    }

    // Build guide URL
    if (features.buildGuide.enabled && this.shouldTrigger(event.type, features.buildGuide.trigger)) {
      const buildURL = this.urlBuilder.buildBuildURL(champion.name, role);
      urls.push(buildURL);
    }

    // Open URLs
    if (urls.length > 0) {
      await this.openURLs(urls);
    }
  }

  /**
   * Handle enemy champion pick
   */
  private async handleEnemyChampionPick(pick: ChampionPick): Promise<void> {
    const { champion } = pick;
    const role = champion.predictedRole;

    // Enemy counters URL (to help us counter-pick)
    if (this.config.lolAnalytics.features.enemyCounters.enabled) {
      const countersURL = this.urlBuilder.buildCounterURL(champion.name, role);
      await this.openURLs([countersURL]);
    }
  }

  /**
   * Handle game start
   */
  private async handleGameStart(): Promise<void> {
    if (!this.myChampionPick) {
      return;
    }

    // Open build guide if configured
    if (this.config.lolAnalytics.features.buildGuide.inGame) {
      const { champion } = this.myChampionPick;
      const role = champion.predictedRole;
      const buildURL = this.urlBuilder.buildBuildURL(champion.name, role);
      await this.openURLs([buildURL]);
    }

    // Clear champion select state
    this.clearChampSelectState();
  }

  /**
   * Open URLs with delay
   */
  private async openURLs(urls: string[]): Promise<void> {
    // Wait for configured delay
    await new Promise((resolve) => setTimeout(resolve, this.config.lolAnalytics.autoOpenDelay));

    try {
      await browserController.openMultiple(urls);
    } catch (error) {
      logger.error('Failed to open URLs', error as Error);
    }
  }

  /**
   * Check if event should trigger action based on config
   */
  private shouldTrigger(
    eventType: string,
    configTrigger: 'hover' | 'pick' | 'lock-in'
  ): boolean {
    if (configTrigger === 'hover') {
      return eventType === 'hover';
    }
    if (configTrigger === 'pick') {
      return eventType === 'pick';
    }
    if (configTrigger === 'lock-in') {
      return eventType === 'lock-in';
    }
    return false;
  }

  /**
   * Clear champion select state
   */
  private clearChampSelectState(): void {
    this.allyTeam = [];
    this.enemyTeam = [];
    this.myChampionPick = null;
  }
}

/**
 * Main entry point
 */
async function main() {
  try {
    // Load configuration
    const config = await loadConfig();

    // Create and initialize application
    const app = new Application(config);
    await app.initialize();
    await app.start();

    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      logger.info('Received SIGINT, shutting down...');
      await app.stop();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      logger.info('Received SIGTERM, shutting down...');
      await app.stop();
      process.exit(0);
    });
  } catch (error) {
    logger.error('Application failed to start', error as Error);
    process.exit(1);
  }
}

// Run if this is the main module
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
