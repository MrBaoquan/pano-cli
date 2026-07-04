// @ts-check
import { existsSync, readFileSync, rmSync, mkdirSync, copyFileSync, readdirSync, statSync, writeFileSync } from 'fs';
import { join, resolve, dirname, basename } from 'path';
import { spawnSync } from 'child_process';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import {
  loadConfig, vtourDir, tourXmlPath, scenesXmlPath, panosDir,
  loadMultiresCache, saveMultiresCache, ConfigError, BuildError
} from '../core/config.js';
import { scanSourceImages } from '../core/scanner.js';
import { detectMultiresFromTiles } from '../core/tiles.js';
import { generateScenesXml, generateGroupsXml } from '../core/xml-gen.js';
import { log } from '../core/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = join(__dirname, '..', 'templates');

/**
 * 递归复制目录，支持排除指定文件/子目录名。
 * @param {string} src
 * @param {string} dst
 * @param {string[]} [exclude]
 */
function copyDir(src, dst, exclude = [], depth = 0) {
  if (!existsSync(src)) {
    log.warn(`目录不存在，跳过: ${src.split(/[\\/]/).pop()}/`);
    return;
  }

  mkdirSync(dst, { recursive: true });
  const entries = readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    if (exclude.includes(entry.name)) continue;
    const srcPath = join(src, entry.name);
    const dstPath = join(dst, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, dstPath, exclude, depth + 1);
    } else {
      copyFileSync(srcPath, dstPath);
    }
  }

  if (depth === 0) {
    const { count, size } = dirStats(dst);
    log.info(`  + ${src.split(/[\\/]/).pop()}/  (${count} 个文件, ${(size / 1024 / 1024).toFixed(1)} MB)`);
  }
}

/**
 * @param {string} dir
 * @returns {{ count: number, size: number }}
 */
function dirStats(dir) {
  let count = 0, size = 0;
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, entry.name);
      if (entry.isDirectory()) {
        walk(p);
      } else {
        count++;
        size += statSync(p).size;
      }
    }
  };
  walk(dir);
  return { count, size };
}

function ensureRuntimeScript(htmlPath, runtimeFile = 'pano-runtime.js') {
  if (!existsSync(htmlPath)) return;
  const marker = `<script src="${runtimeFile}"></script>`;
  let html = readFileSync(htmlPath, 'utf-8');
  if (html.includes(marker)) return;
  if (html.includes('<script src="tour.js"></script>')) {
    html = html.replace('<script src="tour.js"></script>', `<script src="tour.js"></script>\n<script src="${runtimeFile}"></script>`);
    writeFileSync(htmlPath, html, 'utf-8');
    log.info(`  + 注入运行时: ${runtimeFile}`);
  } else {
    log.warn(`未找到 tour.js 注入点，跳过运行时脚本注入: ${htmlPath}`);
  }
}

function buildPublishVersion() {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('') + '-' + [
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0'),
  ].join('');
}

function extractHtmlTitle(html) {
  const match = String(html || '').match(/<title>([\s\S]*?)<\/title>/i);
  return match ? match[1].trim() : '';
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function getProjectSiteTitle(config) {
  if (config && typeof config.siteTitle === 'string' && config.siteTitle.trim()) {
    return config.siteTitle.trim();
  }
  const htmlPath = join(vtourDir(), 'tour.html');
  if (existsSync(htmlPath)) {
    return extractHtmlTitle(readFileSync(htmlPath, 'utf-8')) || '';
  }
  return '';
}

function updateHtmlTitle(htmlPath, siteTitle) {
  if (!siteTitle || !existsSync(htmlPath)) return false;
  const html = readFileSync(htmlPath, 'utf-8');
  const next = html.includes('<title>')
    ? html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(siteTitle)}</title>`)
    : html.replace(/<head>/i, `<head>\n\t<title>${escapeHtml(siteTitle)}</title>`);
  if (next !== html) writeFileSync(htmlPath, next, 'utf-8');
  return true;
}

function createZipArchive(publishDir, versionTag) {
  const zipPath = join(dirname(publishDir), `${basename(publishDir)}-v${versionTag}.zip`);
  if (existsSync(zipPath)) rmSync(zipPath, { force: true });

  // Windows 自带 tar 对大目录与深路径更稳定，优先使用。
  if (process.platform === 'win32') {
    const tarRes = spawnSync('tar', ['-a', '-c', '-f', zipPath, '-C', publishDir, '.'], { stdio: 'pipe', encoding: 'utf-8' });
    if (tarRes.status === 0 && existsSync(zipPath)) return zipPath;
  }

  if (process.platform === 'win32') {
    const psScript = [
      `$src = '${publishDir.replace(/'/g, "''")}'`,
      `$dst = '${zipPath.replace(/'/g, "''")}'`,
      `Compress-Archive -Path (Join-Path $src '*') -DestinationPath $dst -Force`,
    ].join('; ');
    const res = spawnSync('powershell', ['-NoProfile', '-Command', psScript], { stdio: 'pipe', encoding: 'utf-8' });
    if (res.status === 0 && existsSync(zipPath)) return zipPath;
    throw new BuildError(`压缩包生成失败: ${res.stderr || res.stdout || '未知错误'}`);
  }

  const pyCode = [
    'import os, sys, zipfile',
    'src = sys.argv[1]',
    'dst = sys.argv[2]',
    'with zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED) as zf:',
    '    for root, _, files in os.walk(src):',
    '        for name in files:',
    '            full = os.path.join(root, name)',
    '            rel = os.path.relpath(full, src)',
    '            zf.write(full, rel)',
  ].join('\n');
  for (const exe of ['python3', 'python']) {
    const res = spawnSync(exe, ['-c', pyCode, publishDir, zipPath], { stdio: 'pipe', encoding: 'utf-8' });
    if (res.status === 0 && existsSync(zipPath)) return zipPath;
  }
  throw new BuildError('压缩包生成失败：未找到可用的 PowerShell 或 Python 环境');
}

function isExternalAssetPath(value) {
  return /^(https?:|data:|blob:|\/)/i.test(value || '');
}

function collectFiles(dir) {
  if (!existsSync(dir)) return [];
  const results = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else results.push(full);
    }
  };
  walk(dir);
  return results;
}

function clearDirectoryContents(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const target = join(dir, entry.name);
    try {
      rmSync(target, { recursive: true, force: true });
    } catch (error) {
      if (error && (error.code === 'EPERM' || error.code === 'EBUSY')) {
        log.warn(`跳过被占用的发布目录项: ${target}`);
        continue;
      }
      throw error;
    }
  }
}

function buildHotspotInfoManifest(vdir, publishDir) {
  const infoDir = join(vdir, 'hotspots', 'info');
  if (!existsSync(infoDir)) return { entryCount: 0, aliasCount: 0 };

  const manifest = {};
  const runtimeAssetsDir = join(publishDir, 'runtime-assets');
  mkdirSync(runtimeAssetsDir, { recursive: true });
  const aliasMap = new Map();

  const ensureAliasedAsset = (relativePath) => {
    const normalized = String(relativePath || '').replace(/\\/g, '/');
    if (!normalized || isExternalAssetPath(normalized)) return normalized;
    if (aliasMap.has(normalized)) return aliasMap.get(normalized);

    const sourcePath = join(vdir, normalized);
    if (!existsSync(sourcePath)) return normalized;

    const extMatch = normalized.match(/(\.[^.\/]+)$/);
    const ext = extMatch ? extMatch[1].toLowerCase() : '';
    const digest = createHash('sha1').update(normalized).digest('hex').slice(0, 16);
    const aliasRel = `runtime-assets/${digest}${ext}`;
    const aliasAbs = join(publishDir, aliasRel.replace(/\//g, '\\'));
    if (!existsSync(aliasAbs)) {
      mkdirSync(dirname(aliasAbs), { recursive: true });
      copyFileSync(sourcePath, aliasAbs);
    }
    aliasMap.set(normalized, aliasRel);
    return aliasRel;
  };

  for (const file of collectFiles(infoDir)) {
    if (!file.toLowerCase().endsWith('.json')) continue;
    const base = file.split(/[\\/]/).pop();
    const pivot = base.lastIndexOf('__');
    if (pivot <= 0) continue;
    const scene = base.slice(0, pivot);
    const hotspot = base.slice(pivot + 2, -5);
    let data = {};
    try {
      data = JSON.parse(readFileSync(file, 'utf-8'));
    } catch {
      continue;
    }
    const out = { ...data };
    if (out.image) out.image = ensureAliasedAsset(out.image);
    if (out.audio) out.audio = ensureAliasedAsset(out.audio);
    if (out.qrcode) out.qrcode = ensureAliasedAsset(out.qrcode);
    manifest[`${scene}__${hotspot}`] = out;
  }

  const indexPath = join(publishDir, 'hotspots', 'info', 'index.json');
  mkdirSync(dirname(indexPath), { recursive: true });
  writeFileSync(indexPath, JSON.stringify(manifest, null, 2), 'utf-8');
  return { entryCount: Object.keys(manifest).length, aliasCount: aliasMap.size };
}

async function compressPublishImages(publishDir) {
  const targets = [
    join(publishDir, 'assets'),
    join(publishDir, 'runtime-assets'),
    join(publishDir, 'panohper', 'example', 'assets'),
  ];
  const imageFiles = [];
  for (const dir of targets) {
    for (const file of collectFiles(dir)) {
      if (/\.(jpe?g|png|webp)$/i.test(file)) imageFiles.push(file);
    }
  }
  if (!imageFiles.length) return { scanned: 0, compressed: 0, bytesSaved: 0 };

  let compressed = 0;
  let bytesSaved = 0;
  for (const file of imageFiles) {
    try {
      let input = readFileSync(file);
      if (input.length < 250 * 1024) continue;

      let transformer = sharp(input, { failOn: 'none' }).rotate();
      let metadata;
      try {
        metadata = await transformer.metadata();
      } catch {
        continue;
      }
      const width = metadata.width || 0;
      if (width > 2200) {
        transformer = transformer.resize({ width: 2200, withoutEnlargement: true });
      }

      const ext = file.toLowerCase();
      let output;
      try {
        if (ext.endsWith('.jpg') || ext.endsWith('.jpeg')) {
          output = await transformer.jpeg({ quality: 80, mozjpeg: true }).toBuffer();
        } else if (ext.endsWith('.png')) {
          output = await transformer.png({ compressionLevel: 9, quality: 80, effort: 10, palette: true }).toBuffer();
        } else if (ext.endsWith('.webp')) {
          output = await transformer.webp({ quality: 80, effort: 6 }).toBuffer();
        } else {
          continue;
        }
      } catch {
        continue;
      }

      if (!output || output.length >= input.length * 0.98) continue;
      writeFileSync(file, output);
      compressed++;
      bytesSaved += input.length - output.length;
    } catch (error) {
      if (error && (error.code === 'ENOENT' || error.code === 'EPERM' || error.code === 'EBUSY')) {
        log.warn(`压缩时跳过异常文件: ${file}`);
        continue;
      }
      throw error;
    }
  }

  return { scanned: imageFiles.length, compressed, bytesSaved };
}

/**
 * 打包发布文件。
 * @param {{ oss?: boolean, skipPanos?: boolean, compressImages?: boolean }} opts
 */
export async function cmdPublish(opts = {}) {
  log.title('krpano Build: 打包发布');

  const config = loadConfig();
  const siteTitle = getProjectSiteTitle(config);
  const useOss = !!opts.oss;
  const skipPanos = !!opts.skipPanos;
  const compressImages = !!opts.compressImages;
  const versionTag = buildPublishVersion();

  const ossBaseUrl = (config.ossBaseUrl || '').replace(/\/+$/, '');
  const ossBucket = config.ossBucket || '';

  if (useOss && !ossBaseUrl) {
    throw new ConfigError(
      '使用 --oss 时，scenes.config.json 中必须配置 ossBaseUrl\n' +
      '示例: "ossBaseUrl": "https://your-bucket.oss-cn-hangzhou.aliyuncs.com"'
    );
  }

  const panosBase = useOss ? `${ossBaseUrl}/panos` : null;

  // 必须处于 include 模式
  const tourContent = readFileSync(tourXmlPath(), 'utf-8');
  if (!tourContent.includes('<include url="scenes.xml"')) {
    throw new BuildError('当前处于编辑模式（场景已内联），请先运行: pano save');
  }
  if (!existsSync(scenesXmlPath())) {
    throw new BuildError('scenes.xml 不存在，请先运行: pano xml');
  }

  const publishDirRel = config.publishDir || '../publish';
  const publishDir = resolve(vtourDir(), publishDirRel);

  log.step(1, 7, `输出目录: ${publishDir}`);
  log.info(`  发布版本: v${versionTag}`);
  if (useOss) log.info(`  [OSS] 瓦片基础 URL: ${panosBase}`);
  if (skipPanos) {
    log.info('  [跳过全景图] 本次不会打包 panos/，适用于线上 panos 未变化时的增量发布');
  }
  if (compressImages) {
    log.info('  [图片压缩] 本次会压缩发布包中的非全景图片资源，不修改源文件');
  }
  if (existsSync(publishDir)) {
    try {
      rmSync(publishDir, { recursive: true, force: true });
      log.info('已清除旧发布目录');
    } catch (error) {
      if (error && (error.code === 'EPERM' || error.code === 'EBUSY')) {
        clearDirectoryContents(publishDir);
        log.info('发布目录被占用，已改为清空目录内容');
      } else {
        throw error;
      }
    }
  }
  mkdirSync(publishDir, { recursive: true });

  // ── 重新生成 scenes.xml ──
  log.step(2, 7, '生成 scenes.xml / groups_data.xml ...');
  const scenes = scanSourceImages(config);
  const cache = loadMultiresCache();
  const panos = panosDir();
  for (const scene of scenes) {
    if (!(scene.filename in cache)) {
      const detected = detectMultiresFromTiles(join(panos, scene.tilesFolder));
      cache[scene.filename] = detected || '512,1024,2048,4096';
    }
  }
  generateScenesXml(scenes, cache, config, panosBase);
  saveMultiresCache(cache);
  generateGroupsXml(config);

  log.step(3, 7, '准备发布态运行时...');
  const runtimeSrc = join(TEMPLATES_DIR, 'pano-runtime.js');
  if (!existsSync(runtimeSrc)) {
    throw new BuildError(`缺少发布态运行时模板: ${runtimeSrc}`);
  }

  // ── 单文件 ──
  log.step(4, 7, '复制核心文件...');
  const vdir = vtourDir();
  const directFiles = ['tour.html', 'tour.js', 'tour.xml', 'main.xml', 'scenes.xml'];
  for (const fname of directFiles) {
    const src = join(vdir, fname);
    if (existsSync(src)) {
      copyFileSync(src, join(publishDir, fname));
      log.info(`  + ${fname}`);
    } else {
      log.warn(`找不到: ${fname}`);
    }
  }
  copyFileSync(runtimeSrc, join(publishDir, 'pano-runtime.js'));
  log.info('  + pano-runtime.js');
  ensureRuntimeScript(join(publishDir, 'tour.html'));
  updateHtmlTitle(join(publishDir, 'tour.html'), siteTitle);

  // ── 目录 ──
  log.step(5, 7, '复制资源目录...');

  if (useOss) {
    const bucketPath = ossBucket || 'oss://your-bucket/panos';
    log.info(`  [OSS] panos/ 跳过，瓦片由 ${panosBase} 提供`);
    log.info(`  同步命令: ossutil sync ./panos ${bucketPath} --update`);
  } else if (skipPanos) {
    log.info('  [skip-panos] 已跳过 panos/ 复制，请确保服务器上保留现有 panos/ 目录');
  } else {
    copyDir(join(vdir, 'panos'), join(publishDir, 'panos'));
  }

  copyDir(join(vdir, 'assets'), join(publishDir, 'assets'));
  copyDir(join(vdir, 'hotspots'), join(publishDir, 'hotspots'));
  copyDir(join(vdir, 'skin'), join(publishDir, 'skin'));
  copyDir(join(vdir, 'plugins'), join(publishDir, 'plugins'));
  copyDir(join(vdir, 'panohper'), join(publishDir, 'panohper'), ['README.md', 'LICENSE', '.git', '.gitattributes', '.gitignore']);
  const manifestStats = buildHotspotInfoManifest(vdir, publishDir);
  if (manifestStats.entryCount) {
    log.info(`  + hotspot info manifest  (${manifestStats.entryCount} 条, ${manifestStats.aliasCount} 个别名资源)`);
  }

  if (compressImages) {
    log.step(6, 8, '压缩图片资源...');
    const result = await compressPublishImages(publishDir);
    log.info(`图片扫描: ${result.scanned}`);
    log.info(`压缩成功: ${result.compressed}`);
    log.info(`节省体积: ${(result.bytesSaved / 1024 / 1024).toFixed(1)} MB`);
  }

  // ── 统计 ──
  log.step(compressImages ? 7 : 6, compressImages ? 8 : 7, '生成压缩包...');
  const zipPath = createZipArchive(publishDir, versionTag);
  log.info(`压缩包: ${zipPath}`);

  log.step(compressImages ? 8 : 7, compressImages ? 8 : 7, '统计...');
  const { count: totalCount, size: totalSize } = dirStats(publishDir);
  log.info(`文件数量: ${totalCount}`);
  log.info(`总大小:   ${(totalSize / 1024 / 1024).toFixed(1)} MB`);
  log.info(`输出路径: ${publishDir}`);

  log.title('发布打包完成');
  if (useOss) {
    log.info('scenes.xml 中瓦片路径已指向 OSS，请先上传 panos/：');
    log.info(`  ossutil sync ./panos ${ossBucket || 'oss://your-bucket/panos'} --update`);
    log.info('然后将 publish/ 内容上传到服务器根目录。\n');
  } else {
    log.info('提示: 如果 panos/ 全景瓦片没有变化，下次可使用 pano publish --skip-panos 减小包体。');
    log.info('提示: 如果图文热点图片较大，可使用 pano publish --compress-images 压缩发布包图片。');
    log.info(`上传服务器时，将 publish/ 目录下的所有内容上传到网站根目录即可。压缩包位于: ${zipPath}\n`);
  }
}
