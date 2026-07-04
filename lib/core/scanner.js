// @ts-check
import { readdirSync, statSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve, join, parse as parsePath } from 'path';
import { vtourDir, configPath } from './config.js';
import { krpanoEncode, naturalSortKey } from './encoder.js';
import { log } from './logger.js';

/**
 * 自然排序比较函数
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function naturalCompare(a, b) {
  const ka = naturalSortKey(a);
  const kb = naturalSortKey(b);
  for (let i = 0; i < Math.max(ka.length, kb.length); i++) {
    const va = ka[i] ?? '';
    const vb = kb[i] ?? '';
    if (typeof va === 'number' && typeof vb === 'number') {
      if (va !== vb) return va - vb;
    } else {
      const sa = String(va);
      const sb = String(vb);
      if (sa !== sb) return sa < sb ? -1 : 1;
    }
  }
  return 0;
}

/**
 * 自动扫描 panoSourceDir，根据实际文件夹结构同步 scenes.config.json 的 groups。
 * - 扫描 panoSourceDir 下的所有子文件夹（含 .jpg 的）
 * - 按自然排序生成 groups（文件夹名去掉前缀数字序号作为 group name）
 * - 根目录的 .jpg 归入第一个分组
 * - 保留已有 groups 中的 name 映射
 * @param {object} config
 * @returns {object} 更新后的 config
 */
export function syncConfigGroups(config) {
  const sourceDir = resolve(vtourDir(), config.panoSourceDir);
  if (!existsSync(sourceDir)) {
    log.warn(`全景图源目录不存在: ${sourceDir}`);
    return config;
  }

  // 扫描子文件夹（含 .jpg 图片的）
  const entries = readdirSync(sourceDir)
    .filter(name => {
      const fullPath = join(sourceDir, name);
      if (!statSync(fullPath).isDirectory()) return false;
      // 文件夹内须有 .jpg/.jpeg 文件
      return readdirSync(fullPath).some(f => /\.(jpe?g)$/i.test(f));
    })
    .sort((a, b) => naturalCompare(a, b));

  if (entries.length === 0) {
    // 检查根目录有没有图片
    const rootJpgs = readdirSync(sourceDir).filter(f => /\.(jpe?g)$/i.test(f));
    if (rootJpgs.length > 0) {
      config.groups = [{ name: '默认分组', folders: ['.'] }];
    }
    return config;
  }

  // 构建已有 folder→name 映射（保留用户自定义的 group name）
  const existingNameMap = {};
  for (const g of (config.groups || [])) {
    for (const f of g.folders) {
      existingNameMap[f] = g.name;
    }
  }

  // 从文件夹名推导 group name：去掉前缀数字和分隔符 (如 "0-展馆外观" → "展馆外观")
  function deriveGroupName(folderName) {
    if (existingNameMap[folderName]) return existingNameMap[folderName];
    return folderName.replace(/^\d+[-_.\s]*/, '') || folderName;
  }

  const newGroups = entries.map(folderName => ({
    name: deriveGroupName(folderName),
    folders: [folderName],
  }));

  // 根目录有图片时追加到第一个分组
  const rootJpgs = readdirSync(sourceDir).filter(f => /\.(jpe?g)$/i.test(f));
  if (rootJpgs.length > 0) {
    newGroups[0].folders.unshift('.');
  }

  config.groups = newGroups;

  // 写回 scenes.config.json
  writeFileSync(configPath(), JSON.stringify(config, null, 4), 'utf-8');
  log.info(`已同步 groups（${newGroups.length} 个分组）到 scenes.config.json`);

  return config;
}

/**
 * 扫描全景图源目录，按 config 中的分组和目录顺序返回场景列表。
 * @param {object} config
 * @returns {Array<{filename:string, encoded:string, title:string, group:string, source:string, tilesFolder:string}>}
 */
export function scanSourceImages(config) {
  const sourceDir = resolve(vtourDir(), config.panoSourceDir);
  const overrides = config.sceneOverrides || {};
  const scenes = [];

  /**
   * 扫描一个文件夹中的 .jpg，返回场景对象数组（不直接 push）
   */
  function scanFolderIntoArray(folderPath, groupName) {
    const images = readdirSync(folderPath)
      .filter(f => /\.(jpe?g)$/i.test(f))
      .sort((a, b) => naturalCompare(parsePath(a).name, parsePath(b).name));

    return images.map(imgFile => {
      const filename = parsePath(imgFile).name;
      const override = overrides[filename] || {};
      const encoded = krpanoEncode(filename);
      return {
        filename,
        encoded,
        title: override.title || filename,
        group: groupName,
        source: join(folderPath, imgFile),
        tilesFolder: `${encoded}.tiles`,
      };
    });
  }

  for (const group of config.groups) {
    // 收集本组所有文件夹中的场景（文件夹内按自然排序）
    const groupScenes = [];
    for (const folderName of group.folders) {
      const folderPath = folderName === '.' ? sourceDir : join(sourceDir, folderName);
      if (!existsSync(folderPath)) {
        log.warn(`目录不存在: ${folderName}`);
        continue;
      }
      groupScenes.push(...scanFolderIntoArray(folderPath, group.name));
    }

    // 如果配置中有明确的场景排序列表，按该顺序重排
    if (group.scenes && group.scenes.length > 0) {
      const byFilename = new Map(groupScenes.map(s => [s.filename, s]));
      const ordered = [];
      for (const filename of group.scenes) {
        const s = byFilename.get(filename);
        if (s) { ordered.push(s); byFilename.delete(filename); }
      }
      // 将未在排序列表中的新场景追加到末尾
      for (const s of byFilename.values()) ordered.push(s);
      scenes.push(...ordered);
    } else {
      scenes.push(...groupScenes);
    }
  }

  return scenes;
}
