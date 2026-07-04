// @ts-check
import chalk from 'chalk';

let level = 'info'; // 'debug' | 'info' | 'warn' | 'error'

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

export function setLogLevel(l) {
  level = l;
}

function shouldLog(msgLevel) {
  return LEVELS[msgLevel] >= LEVELS[level];
}

export const log = {
  debug(...args) {
    if (shouldLog('debug')) console.log(chalk.gray(...args));
  },
  info(...args) {
    if (shouldLog('info')) console.log(...args);
  },
  warn(...args) {
    if (shouldLog('warn')) console.log(chalk.yellow('WARN'), ...args);
  },
  error(...args) {
    if (shouldLog('error')) console.error(chalk.red('ERROR'), ...args);
  },
  /** 带步骤标号的信息 */
  step(current, total, msg) {
    if (shouldLog('info')) console.log(chalk.cyan(`[${current}/${total}]`), msg);
  },
  /** 分隔线标题 */
  title(msg) {
    if (shouldLog('info')) console.log(`\n══ ${msg} ══\n`);
  },
};
