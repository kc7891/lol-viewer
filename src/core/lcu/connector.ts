/**
 * LCU WebSocket connector
 */

import { WebSocket } from 'ws';
import https from 'node:https';
import { EventEmitter } from 'node:events';
import type { LCUCredentials } from './credentials.js';
import type { LCUEvent, LCUConnectionStatus } from '../../types/event.js';
import { logger } from '../../utils/logger.js';
import { LCUConnectionError } from '../../utils/errors.js';

/**
 * LCU Connector class
 */
export class LCUConnector extends EventEmitter {
  private ws: WebSocket | null = null;
  private status: LCUConnectionStatus = 'disconnected';
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 5000;
  private lastCredentials: LCUCredentials | null = null;
  private reconnectTimeout: NodeJS.Timeout | null = null;

  /**
   * Connect to LCU WebSocket
   */
  async connect(credentials: LCUCredentials): Promise<void> {
    if (this.status === 'connected') {
      logger.warn('Already connected to LCU');
      return;
    }

    // Save credentials for reconnection
    this.lastCredentials = credentials;

    this.status = 'connecting';
    logger.info('Connecting to LCU WebSocket...', {
      host: credentials.host,
      port: credentials.port,
    });

    try {
      // Create HTTPS agent that ignores self-signed certificates
      const agent = new https.Agent({
        rejectUnauthorized: false,
      });

      // Create WebSocket URL with basic auth
      const auth = Buffer.from(`${credentials.username}:${credentials.password}`).toString(
        'base64'
      );
      const wsUrl = `wss://${credentials.host}:${credentials.port}/`;

      // Create WebSocket connection
      this.ws = new WebSocket(wsUrl, {
        headers: {
          Authorization: `Basic ${auth}`,
        },
        agent,
      } as any);

      // Setup event handlers
      this.setupEventHandlers();

      // Wait for connection to open
      await new Promise<void>((resolve, reject) => {
        if (!this.ws) {
          reject(new LCUConnectionError('WebSocket not initialized'));
          return;
        }

        this.ws.once('open', () => resolve());
        this.ws.once('error', (error) => reject(error));
      });

      // Subscribe to all events
      this.subscribe('/');

      this.status = 'connected';
      this.reconnectAttempts = 0;
      logger.success('Connected to LCU WebSocket');
      this.emit('connected');
    } catch (error) {
      this.status = 'error';
      const lcuError = new LCUConnectionError('Failed to connect to LCU', error as Error);
      logger.error('LCU connection failed', lcuError);
      this.emit('error', lcuError);
      throw lcuError;
    }
  }

  /**
   * Disconnect from LCU WebSocket
   */
  disconnect(): void {
    // Clear reconnect timeout
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.ws) {
      logger.info('Disconnecting from LCU WebSocket...');
      this.ws.close();
      this.ws = null;
      this.status = 'disconnected';
      this.emit('disconnected');
    }

    // Reset reconnection attempts
    this.reconnectAttempts = 0;
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.status === 'connected' && this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * Get connection status
   */
  getStatus(): LCUConnectionStatus {
    return this.status;
  }

  /**
   * Subscribe to LCU events
   */
  private subscribe(path: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      logger.warn('Cannot subscribe: WebSocket not connected');
      return;
    }

    const message = JSON.stringify([5, 'OnJsonApiEvent']);
    this.ws.send(message);
    logger.debug(`Subscribed to LCU events: ${path}`);
  }

  /**
   * Setup WebSocket event handlers
   */
  private setupEventHandlers(): void {
    if (!this.ws) return;

    this.ws.on('message', (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());

        // LCU WebSocket messages are in format: [opcode, event, data]
        if (Array.isArray(message) && message.length >= 3) {
          const [opcode, eventType, eventData] = message;

          if (opcode === 8 && eventType === 'OnJsonApiEvent') {
            const lcuEvent: LCUEvent = {
              uri: eventData.uri,
              eventType: eventData.eventType,
              data: eventData.data,
            };

            logger.debug('LCU event received', { uri: lcuEvent.uri, type: lcuEvent.eventType });
            this.emit('event', lcuEvent);
          }
        }
      } catch (error) {
        logger.error('Failed to parse LCU message', error as Error);
      }
    });

    this.ws.on('error', (error: Error) => {
      logger.error('LCU WebSocket error', error);
      this.status = 'error';
      this.emit('error', new LCUConnectionError('WebSocket error', error));
    });

    this.ws.on('close', (code: number, reason: Buffer) => {
      logger.warn('LCU WebSocket closed', { code, reason: reason.toString() });
      this.status = 'disconnected';
      this.emit('disconnected');

      // Attempt to reconnect
      if (this.reconnectAttempts < this.maxReconnectAttempts && this.lastCredentials) {
        this.reconnectAttempts++;
        logger.info(`Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
        this.emit('reconnecting', this.reconnectAttempts);

        this.reconnectTimeout = setTimeout(async () => {
          try {
            await this.connect(this.lastCredentials!);
          } catch (error) {
            logger.error('Reconnection failed', error as Error);
          }
        }, this.reconnectDelay);
      }
    });
  }
}
