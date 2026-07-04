// @ts-check
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, join } from 'path';
import { homedir } from 'os';

/**
 * vtour 目录 — 自动检测：如果 CWD 下有 vtour/ 子目录且含 scenes.config.json 则用它，
 * 否则假设 CWD 本身就是 vtour 目录。
 * @returns {string}
 */
export function vtourDir() {
  const cwd = process.cwd();
  const sub = join(cwd, 'vtour');
  if (existsSync(join(sub, 'scenes.config.json'))) {
    return sub;
  }
  return cwd;
}

/** @returns {string} */
export const configPath       = () => join(vtourDir(), 'scenes.config.json');
export const multiresCachePath= () => join(vtourDir(), '.multires_cache.json');
export const scenesXmlPath    = () => join(vtourDir(), 'scenes.xml');
export const groupsXmlPath    = () => join(vtourDir(), 'skin', 'groups_data.xml');
export const tourXmlPath      = () => join(vtourDir(), 'tour.xml');
export const panosDir         = () => join(vtourDir(), 'panos');
export const hotspotsDir      = () => join(vtourDir(), 'hotspots');
export const mainXmlPath      = () => join(vtourDir(), 'main.xml');
export const tilesConfigPath  = () => join(vtourDir(), '_tiles.config');
export const tempXmlPath      = () => join(vtourDir(), '_makepano_temp.xml');

// ── 全局配置 (~/.pano-cli/config.json) ─────────────────────────────────────

const GLOBAL_CONFIG_DIR = join(homedir(), '.pano-cli');
const GLOBAL_CONFIG_PATH = join(GLOBAL_CONFIG_DIR, 'config.json');

/**
 * 读取全局配置
 * @returns {object}
 */
export function loadGlobalConfig() {
  if (existsSync(GLOBAL_CONFIG_PATH)) {
    return JSON.parse(readFileSync(GLOBAL_CONFIG_PATH, 'utf-8'));
  }
  return {};
}

/**
 * 保存全局配置
 * @param {object} config
 */
export function saveGlobalConfig(config) {
  mkdirSync(GLOBAL_CONFIG_DIR, { recursive: true });
  writeFileSync(GLOBAL_CONFIG_PATH, JSON.stringify(config, null, 4), 'utf-8');
}

/**
 * 读取 scenes.config.json，合并全局配置（项目配置优先）
 * @returns {object}
 */
export function loadConfig() {
  const p = configPath();
  if (!existsSync(p)) {
    throw new ConfigError(`scenes.config.json 未找到: ${p}`);
  }
  const globalCfg = loadGlobalConfig();
  const projectCfg = JSON.parse(readFileSync(p, 'utf-8'));
  // 全局 krpanoToolsPath 作为后备（项目配置优先）
  if (!projectCfg.krpanoToolsPath && globalCfg.krpanoToolsPath) {
    projectCfg.krpanoToolsPath = globalCfg.krpanoToolsPath;
  }
  return projectCfg;
}

/**
 * 读取 .multires_cache.json
 * @returns {Record<string, string>}
 */
export function loadMultiresCache() {
  const p = multiresCachePath();
  if (existsSync(p)) {
    return JSON.parse(readFileSync(p, 'utf-8'));
  }
  return {};
}

/**
 * 写入 .multires_cache.json
 * @param {Record<string, string>} cache
 */
export function saveMultiresCache(cache) {
  writeFileSync(multiresCachePath(), JSON.stringify(cache, null, 2), 'utf-8');
}

/**
 * 校验 scenes.config.json 必填字段。
 * @param {object} config
 * @param {{ requireTools?: boolean }} [opts]
 */
export function validateConfig(config, opts = {}) {
  const required = ['panoSourceDir', 'startScene', 'groups'];
  const missing = required.filter(k => !(k in config));
  if (missing.length) {
    throw new ConfigError(`scenes.config.json 缺少必填字段: ${missing.join(', ')}`);
  }
  if (!config.groups || !config.groups.length) {
    throw new ConfigError('scenes.config.json 中 groups 不能为空');
  }
  if (opts.requireTools) {
    if (!config.krpanoToolsPath) {
      throw new ConfigError('scenes.config.json 缺少 krpanoToolsPath（瓦片生成需要）');
    }
    const exeName = process.platform === 'win32' ? 'krpanotools.exe' : 'krpanotools';
    const exe = join(config.krpanoToolsPath, exeName);
    if (!existsSync(exe)) {
      throw new ToolNotFoundError(`krpanotools 未找到: ${exe}\n请在 scenes.config.json 中正确配置 krpanoToolsPath（krpanotools 所在目录）`);
    }
  }
  const sourceDir = resolve(vtourDir(), config.panoSourceDir);
  if (!existsSync(sourceDir)) {
    throw new ConfigError(`全景图源目录不存在: ${sourceDir}`);
  }
}

// ── Exceptions ──────────────────────────────────────────────────────────────

export class BuildError extends Error {
  constructor(msg) { super(msg); this.name = 'BuildError'; }
}

export class ConfigError extends BuildError {
  constructor(msg) { super(msg); this.name = 'ConfigError'; }
}

export class ToolNotFoundError extends BuildError {
  constructor(msg) { super(msg); this.name = 'ToolNotFoundError'; }
}
