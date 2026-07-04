// @ts-check
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { vtourDir, loadGlobalConfig, saveGlobalConfig, BuildError } from '../core/config.js';
import { log } from '../core/logger.js';

function validateKrpano(path) {
  const resolved = resolve(path);
  const exeName = process.platform === 'win32' ? 'krpanotools.exe' : 'krpanotools';
  if (!existsSync(join(resolved, exeName))) {
    throw new BuildError(`未找到 ${exeName}: ${resolved}`);
  }
  return resolved.replace(/\\/g, '/');
}

/**
 * 查看或修改配置。
 * --global: 操作全局配置 (~/.pano-cli/config.json)
 * 默认: 操作项目配置 (scenes.config.json)
 * @param {{ krpano?: string, source?: string, global?: boolean }} opts
 */
export async function cmdConfig(opts = {}) {
  if (opts.global) {
    const config = loadGlobalConfig();
    let changed = false;

    if (opts.krpano) {
      config.krpanoToolsPath = validateKrpano(opts.krpano);
      changed = true;
      log.info(`[全局] krpanoToolsPath = ${config.krpanoToolsPath}`);
    }

    if (changed) {
      saveGlobalConfig(config);
      log.info('\n全局配置已更新。');
    } else {
      log.title('全局配置');
      log.info(`krpanoToolsPath: ${config.krpanoToolsPath || '(未设置)'}`);
      log.info('');
      log.info('全局配置作为所有项目的默认值，项目配置可覆盖。');
    }
    return;
  }

  // 项目配置
  const configPath = join(vtourDir(), 'scenes.config.json');
  if (!existsSync(configPath)) {
    throw new BuildError('scenes.config.json 不存在，请先在 vtour 目录下运行。');
  }

  const config = JSON.parse(readFileSync(configPath, 'utf-8'));
  const globalCfg = loadGlobalConfig();
  let changed = false;

  if (opts.krpano) {
    config.krpanoToolsPath = validateKrpano(opts.krpano);
    changed = true;
    log.info(`krpanoToolsPath = ${config.krpanoToolsPath}`);
  }

  if (opts.source) {
    config.panoSourceDir = opts.source;
    changed = true;
    log.info(`panoSourceDir = ${config.panoSourceDir}`);
  }

  if (changed) {
    writeFileSync(configPath, JSON.stringify(config, null, 4), 'utf-8');
    log.info('\nscenes.config.json 已更新。');
  } else {
    const effectiveKrpano = config.krpanoToolsPath || globalCfg.krpanoToolsPath;
    log.title('当前配置');
    log.info(`krpanoToolsPath: ${effectiveKrpano || '(未设置)'}${!config.krpanoToolsPath && globalCfg.krpanoToolsPath ? ' (来自全局)' : ''}`);
    log.info(`panoSourceDir:   ${config.panoSourceDir || '(未设置)'}`);
    log.info(`startScene:      ${config.startScene || '(未设置)'}`);
    log.info(`groups:          ${(config.groups || []).map(g => g.name).join(', ') || '(无)'}\n`);
  }
}
