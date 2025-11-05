/**
 * Terminal UI components
 */

import chalk from 'chalk';
import ora, { type Ora } from 'ora';

/**
 * Create a spinner
 */
export function createSpinner(text: string): Ora {
  return ora({
    text,
    color: 'cyan',
  });
}

/**
 * Display welcome banner
 */
export function displayBanner(): void {
  console.log(chalk.cyan.bold('\n╔════════════════════════════════════════╗'));
  console.log(chalk.cyan.bold('║  LoL Analytics Browser Viewer          ║'));
  console.log(chalk.cyan.bold('╚════════════════════════════════════════╝\n'));
}

/**
 * Display connection status
 */
export function displayConnectionStatus(connected: boolean): void {
  if (connected) {
    console.log(chalk.green('✓ Connected to League Client'));
  } else {
    console.log(chalk.yellow('⚠ Waiting for League Client...'));
  }
}

/**
 * Display champion select info
 */
export function displayChampionSelect(championName: string, role?: string): void {
  console.log(chalk.blue(`\n→ Champion selected: ${chalk.bold(championName)}`));
  if (role) {
    console.log(chalk.gray(`  Role: ${role}`));
  }
}

/**
 * Display URL opened
 */
export function displayURLOpened(url: string): void {
  console.log(chalk.green(`✓ Opened: ${chalk.underline(url)}`));
}

/**
 * Display error
 */
export function displayError(message: string, error?: Error): void {
  console.error(chalk.red(`✗ ${message}`));
  if (error && error.message) {
    console.error(chalk.red(`  ${error.message}`));
  }
}

/**
 * Display info message
 */
export function displayInfo(message: string): void {
  console.log(chalk.blue(`ℹ ${message}`));
}

/**
 * Display success message
 */
export function displaySuccess(message: string): void {
  console.log(chalk.green(`✓ ${message}`));
}

/**
 * Clear console
 */
export function clearConsole(): void {
  console.clear();
}
