// @ts-check
import { createServer } from 'http';
import { readFileSync, writeFileSync, existsSync, statSync, realpathSync, mkdirSync, renameSync } from 'fs';
import { join, extname, dirname, resolve } from 'path';
import { exec } from 'child_process';
import { fileURLToPath } from 'url';
import { vtourDir, configPath, loadConfig, hotspotsDir, loadMultiresCache, saveMultiresCache, panosDir } from '../core/config.js';
import { scanSourceImages } from '../core/scanner.js';
import { generateScenesXml, generateGroupsXml } from '../core/xml-gen.js';
import { detectMultiresFromTiles } from '../core/tiles.js';
import { log } from '../core/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = join(__dirname, '..', 'templates');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.swf': 'application/x-shockwave-flash',
};

/**
 * 尝试在指定端口启动，返回 Promise<boolean> 表示是否成功。
 * @param {import('http').Server} server
 * @param {number} port
 * @returns {Promise<boolean>}
 */
function tryListen(server, port) {
  return new Promise((resolve) => {
    const onError = (err) => {
      if (err.code === 'EADDRINUSE') {
        server.removeListener('error', onError);
        resolve(false);
      } else {
        throw err;
      }
    };
    server.on('error', onError);
    server.listen(port, () => {
      server.removeListener('error', onError);
      resolve(true);
    });
  });
}

/**
 * 解析 POST 请求体（JSON）
 * @param {import('http').IncomingMessage} req
 * @returns {Promise<any>}
 */
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(data)); }
      catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function normalizeOptionalNumber(value, fieldName) {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string' && value.trim() === '') return '';
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new Error(`Invalid ${fieldName}`);
  }
  return String(n);
}

/**
 * 构建 sceneId -> filename 映射
 * @returns {Array<{sceneId:string, filename:string, title:string, group:string}>}
 */
function buildSceneList() {
  try {
    const config = loadConfig();
    const scenes = scanSourceImages(config);
    return scenes.map(s => ({
      sceneId: `scene_${s.encoded}`,
      filename: s.filename,
      title: s.title,
      group: s.group,
    }));
  } catch {
    return [];
  }
}

/**
 * 解析热点 XML 文件 → 热点对象数组
 * @param {string} content
 * @returns {Array<{name:string, ath:string, atv:string, linkedscene:string, type:string, raw:string}>}
 */
function parseHotspots(content) {
  const result = [];
  const re = /<hotspot\s+([^>]*)\/?>/gi;
  let m;
  while ((m = re.exec(content)) !== null) {
    const attrs = m[1];
    const get = (k) => { const mm = attrs.match(new RegExp(`${k}="([^"]*)"`)); return mm ? mm[1] : ''; };
    result.push({
      name: get('name'),
      ath: get('ath'),
      atv: get('atv'),
      linkedscene: get('linkedscene'),
      style: get('style'),
      type: get('editor_type') || get('type') || 'nav',
      raw: m[0],
    });
  }
  return result;
}

/**
 * 信息面板内容存储路径: hotspots/info/<scene>__<name>.json
 */
function hotspotInfoPath(scene, name) {
  return join(hotspotsDir(), 'info', `${scene}__${name}.json`);
}

/**
 * 热点变更后重新生成 scenes.xml，使 krpano 切回场景时能读取到最新热点。
 */
function regenerateScenesXmlAfterHotspotChange() {
  try {
    const config = loadConfig();
    const scenes = scanSourceImages(config);
    const cache = loadMultiresCache();
    const pDir = panosDir();
    let cacheUpdated = false;
    for (const scene of scenes) {
      if (!(scene.filename in cache)) {
        const detected = detectMultiresFromTiles(join(pDir, scene.tilesFolder));
        cache[scene.filename] = detected || '512,1024,2048,4096';
        cacheUpdated = true;
      }
    }
    if (cacheUpdated) saveMultiresCache(cache);
    generateScenesXml(scenes, cache, config);
  } catch (e) {
    log.warn(`热点变更后 scenes.xml 重新生成失败: ${e.message}`);
  }
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
  if (!existsSync(htmlPath)) return false;
  const html = readFileSync(htmlPath, 'utf-8');
  const next = html.includes('<title>')
    ? html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(siteTitle)}</title>`)
    : html.replace(/<head>/i, `<head>\n\t<title>${escapeHtml(siteTitle)}</title>`);
  if (next !== html) writeFileSync(htmlPath, next, 'utf-8');
  return true;
}

function syncProjectSiteTitle(config, siteTitle) {
  updateHtmlTitle(join(vtourDir(), 'tour.html'), siteTitle);
  const publishDirRel = config.publishDir || '../publish';
  const publishHtmlPath = resolve(vtourDir(), publishDirRel, 'tour.html');
  updateHtmlTitle(publishHtmlPath, siteTitle);
}

/**
 * 处理编辑器 API 请求（/api/*）
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {string} urlPath
 * @param {string} rawUrl
 * @returns {Promise<boolean>} 是否已处理
 */
async function handleApi(req, res, urlPath, rawUrl) {
  if (!urlPath.startsWith('/api/')) return false;

  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  try {
    // GET /api/config — 读取 scenes.config.json
    if (req.method === 'GET' && urlPath === '/api/config') {
      const cfgFile = configPath();
      if (!existsSync(cfgFile)) {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'scenes.config.json not found' }));
      } else {
        res.writeHead(200);
        res.end(readFileSync(cfgFile, 'utf-8'));
      }
      return true;
    }

    // GET /api/scenes — 获取场景列表（sceneId, filename, title, group）
    if (req.method === 'GET' && urlPath === '/api/scenes') {
      const scenes = buildSceneList();
      res.writeHead(200);
      res.end(JSON.stringify({ scenes }));
      return true;
    }

    // GET /api/view-defaults — 读取全局视野限制
    if (req.method === 'GET' && urlPath === '/api/view-defaults') {
      const config = loadConfig();
      const viewDefaults = config.viewDefaults || {};
      res.writeHead(200);
      res.end(JSON.stringify({
        siteTitle: getProjectSiteTitle(config),
        fovmin: viewDefaults.fovmin ?? '70',
        fovmax: viewDefaults.fovmax ?? '140',
      }));
      return true;
    }

    // GET /api/scene-settings?scene=xxx — 读取场景标题与全局/局部视野限制
    if (req.method === 'GET' && urlPath === '/api/scene-settings') {
      const url = new URL(rawUrl, 'http://localhost');
      const scene = url.searchParams.get('scene');
      if (!scene) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Missing scene param' }));
        return true;
      }

      const config = loadConfig();
      const sceneOverride = (config.sceneOverrides && config.sceneOverrides[scene]) || {};
      const viewDefaults = config.viewDefaults || {};

      res.writeHead(200);
      res.end(JSON.stringify({
        scene,
        title: sceneOverride.title || scene,
        viewDefaults: {
          fovmin: viewDefaults.fovmin ?? '70',
          fovmax: viewDefaults.fovmax ?? '140',
        },
        sceneOverride: {
          fovmin: sceneOverride.fovmin ?? '',
          fovmax: sceneOverride.fovmax ?? '',
        },
      }));
      return true;
    }

    // POST /api/scene-view — 保存场景视角参数
    if (req.method === 'POST' && urlPath === '/api/scene-view') {
      const body = await parseBody(req);
      const { scene, hlookat, vlookat, fov, fovmin, fovmax } = body;
      if (!scene) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Missing scene name' }));
        return true;
      }

      const cfgFile = configPath();
      const config = JSON.parse(readFileSync(cfgFile, 'utf-8'));
      if (!config.sceneOverrides) config.sceneOverrides = {};
      if (!config.sceneOverrides[scene]) config.sceneOverrides[scene] = {};

      const ov = config.sceneOverrides[scene];
      if (hlookat !== undefined) ov.hlookat = String(hlookat);
      if (vlookat !== undefined) ov.vlookat = String(vlookat);
      if (fov !== undefined) ov.fov = String(fov);
      if (fovmin !== undefined) ov.fovmin = String(fovmin);
      if (fovmax !== undefined) ov.fovmax = String(fovmax);

      writeFileSync(cfgFile, JSON.stringify(config, null, 4), 'utf-8');
      log.info(`API: 保存视角 ${scene} → h:${hlookat} v:${vlookat} fov:${fov}`);
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true }));
      return true;
    }

    // POST /api/scene-settings — 保存场景标题与全局/局部视野限制
    if (req.method === 'POST' && urlPath === '/api/scene-settings') {
      const body = await parseBody(req);
      const { scene, title } = body;
      if (!scene) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Missing scene name' }));
        return true;
      }

      const globalFovmin = normalizeOptionalNumber(body.globalFovmin, 'globalFovmin');
      const globalFovmax = normalizeOptionalNumber(body.globalFovmax, 'globalFovmax');
      const sceneFovmin = normalizeOptionalNumber(body.sceneFovmin, 'sceneFovmin');
      const sceneFovmax = normalizeOptionalNumber(body.sceneFovmax, 'sceneFovmax');

      const cfgFile = configPath();
      const config = JSON.parse(readFileSync(cfgFile, 'utf-8'));
      if (!config.sceneOverrides) config.sceneOverrides = {};
      if (!config.sceneOverrides[scene]) config.sceneOverrides[scene] = {};
      if (!config.viewDefaults) config.viewDefaults = {};

      const sceneOverride = config.sceneOverrides[scene];
      if (typeof title === 'string') {
        const trimmedTitle = title.trim();
        if (trimmedTitle && trimmedTitle !== scene) sceneOverride.title = trimmedTitle;
        else delete sceneOverride.title;
      }

      if (globalFovmin !== undefined) {
        if (globalFovmin === '') delete config.viewDefaults.fovmin;
        else config.viewDefaults.fovmin = globalFovmin;
      }
      if (globalFovmax !== undefined) {
        if (globalFovmax === '') delete config.viewDefaults.fovmax;
        else config.viewDefaults.fovmax = globalFovmax;
      }
      if (sceneFovmin !== undefined) {
        if (sceneFovmin === '') delete sceneOverride.fovmin;
        else sceneOverride.fovmin = sceneFovmin;
      }
      if (sceneFovmax !== undefined) {
        if (sceneFovmax === '') delete sceneOverride.fovmax;
        else sceneOverride.fovmax = sceneFovmax;
      }

      if (Object.keys(sceneOverride).length === 0) {
        delete config.sceneOverrides[scene];
      }
      if (config.viewDefaults && Object.keys(config.viewDefaults).length === 0) {
        delete config.viewDefaults;
      }

      writeFileSync(cfgFile, JSON.stringify(config, null, 4), 'utf-8');
      log.info(`API: 场景设置已保存 ${scene}`);
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true }));
      return true;
    }

    // POST /api/view-defaults — 保存全局视野限制
    if (req.method === 'POST' && urlPath === '/api/view-defaults') {
      const body = await parseBody(req);
      const globalFovmin = normalizeOptionalNumber(body.fovmin, 'fovmin');
      const globalFovmax = normalizeOptionalNumber(body.fovmax, 'fovmax');
      const nextSiteTitle = body.siteTitle === undefined ? undefined : String(body.siteTitle).trim();

      const cfgFile = configPath();
      const config = JSON.parse(readFileSync(cfgFile, 'utf-8'));
      if (!config.viewDefaults) config.viewDefaults = {};

      if (nextSiteTitle !== undefined) {
        if (!nextSiteTitle) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: '站点总标题不能为空' }));
          return true;
        }
        config.siteTitle = nextSiteTitle;
      }

      if (globalFovmin !== undefined) {
        if (globalFovmin === '') delete config.viewDefaults.fovmin;
        else config.viewDefaults.fovmin = globalFovmin;
      }
      if (globalFovmax !== undefined) {
        if (globalFovmax === '') delete config.viewDefaults.fovmax;
        else config.viewDefaults.fovmax = globalFovmax;
      }
      if (Object.keys(config.viewDefaults).length === 0) {
        delete config.viewDefaults;
      }

      writeFileSync(cfgFile, JSON.stringify(config, null, 4), 'utf-8');
      if (nextSiteTitle !== undefined) {
        syncProjectSiteTitle(config, nextSiteTitle);
      }
      log.info('API: 全局视野限制已保存');
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true }));
      return true;
    }

    // GET /api/hotspots?scene=xxx — 获取指定场景的热点
    if (req.method === 'GET' && urlPath.startsWith('/api/hotspots')) {
      const url = new URL(rawUrl, 'http://localhost');
      const scene = url.searchParams.get('scene');
      if (!scene) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Missing scene param' }));
        return true;
      }
      const hsFile = join(hotspotsDir(), `${scene}.xml`);
      let hotspots = [];
      if (existsSync(hsFile)) {
        hotspots = parseHotspots(readFileSync(hsFile, 'utf-8'));
      }
      res.writeHead(200);
      res.end(JSON.stringify({ hotspots }));
      return true;
    }

    // GET /api/hotspot-info?scene=X&name=Y — 获取信息面板内容
    if (req.method === 'GET' && urlPath === '/api/hotspot-info') {
      const url = new URL(rawUrl, 'http://localhost');
      const scene = url.searchParams.get('scene');
      const name = url.searchParams.get('name');
      if (!scene || !name) { res.writeHead(400); res.end(JSON.stringify({ error: 'Missing params' })); return true; }
      const infoFile = hotspotInfoPath(scene, name);
      res.writeHead(200);
      res.end(existsSync(infoFile) ? readFileSync(infoFile, 'utf-8') : JSON.stringify({}));
      return true;
    }

    // POST /api/upload-asset — 上传本地文件（图片/音频）到 vtour/assets/ 按类型分目录
    // 请求头: X-Filename: 原始文件名；Body: 二进制文件内容
    if (req.method === 'POST' && urlPath === '/api/upload-asset') {
      const filename = decodeURIComponent(req.headers['x-filename'] || 'file');
      const ext = extname(filename).toLowerCase();
      const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg']);
      const AUDIO_EXT = new Set(['.mp3', '.wav', '.ogg', '.aac', '.m4a']);
      const VIDEO_EXT = new Set(['.mp4', '.webm', '.mov', '.m4v']);
      const ALLOWED_EXT = new Set([...IMAGE_EXT, ...AUDIO_EXT, ...VIDEO_EXT]);
      if (!ALLOWED_EXT.has(ext)) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: '不支持的文件类型' }));
        return true;
      }
      // 根据文件类型选择子目录
      const subDir = AUDIO_EXT.has(ext) ? 'audio' : VIDEO_EXT.has(ext) ? 'video' : 'images';
      const assetsDir = join(vtourDir(), 'assets', subDir);
      mkdirSync(assetsDir, { recursive: true });
      // 保持原始文件名（仅替换路径分隔符等危险字符）
      const safeBase = filename.replace(/[\\\/:\*\?"<>\|]/g, '_');
      const finalName = safeBase;
      const destPath = join(assetsDir, finalName);
      // 检查文件是否已存在 — 冲突时返回 409 让客户端提示用户重命名
      const overwrite = req.headers['x-overwrite'] === '1';
      if (!overwrite && existsSync(destPath)) {
        res.writeHead(409);
        res.end(JSON.stringify({ error: 'conflict', filename: finalName }));
        return true;
      }
      await new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', c => chunks.push(c));
        req.on('end', () => {
          writeFileSync(destPath, Buffer.concat(chunks));
          resolve();
        });
        req.on('error', reject);
      });
      const relUrl = `assets/${subDir}/${finalName}`;
      log.info(`API: 文件已上传 ${relUrl}`);
      res.writeHead(200);
      res.end(JSON.stringify({ url: relUrl }));
      return true;
    }

    // POST /api/hotspot-info — 保存信息面板内容
    // Body: { scene, name, title, text, image, audio }
    if (req.method === 'POST' && urlPath === '/api/hotspot-info') {
      const b = await parseBody(req);
      const { scene, name } = b;
      if (!scene || !name) { res.writeHead(400); res.end(JSON.stringify({ error: 'Missing scene or name' })); return true; }
      const infoDir = join(hotspotsDir(), 'info');
      mkdirSync(infoDir, { recursive: true });
      const data = {
        title: b.title || '',
        text: b.text || '',
        image: b.image || '',
        audio: b.audio || '',
        qrcode: b.qrcode || '',
        linkUrl: b.linkUrl || '',
        video: b.video || '',
        width: b.width ?? '',
        keyColor: b.keyColor || '',
        threshold: b.threshold ?? '',
        feather: b.feather ?? '',
        chromaKey: b.chromaKey !== undefined ? !!b.chromaKey : true,
        muted: b.muted !== undefined ? !!b.muted : true,
        loop: b.loop !== undefined ? !!b.loop : true,
        shadow: b.shadow !== undefined ? !!b.shadow : true,
      };
      writeFileSync(hotspotInfoPath(scene, name), JSON.stringify(data, null, 2), 'utf-8');
      log.info(`API: 信息面板已保存 ${scene}/${name}`);
      regenerateScenesXmlAfterHotspotChange();
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true }));
      return true;
    }

    // POST /api/hotspot — 添加热点
    // Body: { scene, name, ath, atv, style?, linkedscene?, type? }
    if (req.method === 'POST' && urlPath === '/api/hotspot') {
      const body = await parseBody(req);
      const { scene, name, ath, atv, style, linkedscene, type } = body;
      if (!scene || !name) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Missing scene or name' }));
        return true;
      }

      const hsDir = hotspotsDir();
      mkdirSync(hsDir, { recursive: true });
      const hsFile = join(hsDir, `${scene}.xml`);
      let content = existsSync(hsFile) ? readFileSync(hsFile, 'utf-8').trim() : '';

      const styleAttr = style ? ` style="${style}"` : (type === 'greenscreen' ? '' : ' style="skin_hotspotstyle"');
      const typeAttr = (type && type !== 'nav') ? ` editor_type="${type}"` : '';
      const linkedAttr = (type !== 'info' && linkedscene) ? ` linkedscene="${linkedscene}"` : '';
      const line = `<hotspot name="${name}"${styleAttr} ath="${ath}" atv="${atv}" distorted="false" zoom="false"${typeAttr}${linkedAttr} />`;

      content = content ? content + '\n' + line : line;
      writeFileSync(hsFile, content, 'utf-8');
      log.info(`API: 热点添加 ${scene}/${name} (${ath}, ${atv}) type=${type || 'nav'}`);
      regenerateScenesXmlAfterHotspotChange();
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true }));
      return true;
    }

    // PUT /api/hotspot — 更新热点属性（位置、样式、链接场景、重命名）
    // Body: { scene, name, ath?, atv?, style?, linkedscene?, newName? }
    if (req.method === 'PUT' && urlPath === '/api/hotspot') {
      const body = await parseBody(req);
      const { scene, name } = body;
      if (!scene || !name) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Missing scene or name' }));
        return true;
      }

      const hsFile = join(hotspotsDir(), `${scene}.xml`);
      if (!existsSync(hsFile)) {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Hotspot file not found' }));
        return true;
      }

      // 校验新名字合法性与唯一性
      const newName = typeof body.newName === 'string' ? body.newName.trim() : '';
      const doRename = newName && newName !== name;
      if (doRename) {
        if (!/^[A-Za-z_][\w\-]*$/.test(newName)) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: '热点名只能包含字母/数字/_/-，且以字母或 _ 开头' }));
          return true;
        }
      }

      let content = readFileSync(hsFile, 'utf-8');
      const lines = content.split('\n');
      // 唯一性检查
      if (doRename) {
        const conflict = lines.some(l => l.includes(`name="${newName}"`));
        if (conflict) {
          res.writeHead(409);
          res.end(JSON.stringify({ error: `热点名已存在: ${newName}` }));
          return true;
        }
      }
      let found = false;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(`name="${name}"`)) {
          let line = lines[i];
          // 更新各属性
          if (doRename) line = line.replace(/name="[^"]*"/, `name="${newName}"`);
          if (body.ath !== undefined) line = line.replace(/ath="[^"]*"/, `ath="${body.ath}"`);
          if (body.atv !== undefined) line = line.replace(/atv="[^"]*"/, `atv="${body.atv}"`);
          if (body.style !== undefined) {
            if (line.includes('style="')) {
              line = line.replace(/style="[^"]*"/, `style="${body.style}"`);
            } else {
              line = line.replace(/name="[^"]*"/, `$& style="${body.style}"`);
            }
          }
          if (body.type !== undefined) {
            if (body.type === 'nav' || body.type === '') {
              line = line.replace(/\s*type="[^"]*"/, '');
              line = line.replace(/\s*editor_type="[^"]*"/, '');
              line = line.replace(/\s*type="[^"]*"/, '');
            } else if (line.includes('editor_type="')) {
              line = line.replace(/editor_type="[^"]*"/, `editor_type="${body.type}"`);
            } else if (line.includes('type="')) {
              line = line.replace(/type="[^"]*"/, `editor_type="${body.type}"`);
            } else {
              line = line.replace(/\/>$/, `editor_type="${body.type}" />`);
            }
          }
          if (body.linkedscene !== undefined) {
            if (body.linkedscene === '' || body.type === 'info') {
              // 移除 linkedscene 属性（切换为信息面板或取消链接）
              line = line.replace(/\s*linkedscene="[^"]*"/, '');
            } else if (line.includes('linkedscene="')) {
              line = line.replace(/linkedscene="[^"]*"/, `linkedscene="${body.linkedscene}"`);
            } else {
              line = line.replace(/\/>$/, `linkedscene="${body.linkedscene}" />`);
            }
          }
          lines[i] = line;
          found = true;
          break;
        }
      }

      if (!found) {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Hotspot not found' }));
        return true;
      }

      writeFileSync(hsFile, lines.join('\n'), 'utf-8');
      // 若改名，同步迁移 info JSON
      if (doRename) {
        try {
          const oldInfo = hotspotInfoPath(scene, name);
          const newInfo = hotspotInfoPath(scene, newName);
          if (existsSync(oldInfo)) renameSync(oldInfo, newInfo);
        } catch (e) {
          log.warn(`重命名信息面板 JSON 失败: ${e.message}`);
        }
      }
      log.info(`API: 热点更新 ${scene}/${name}${doRename ? ' → ' + newName : ''}`);
      regenerateScenesXmlAfterHotspotChange();
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true, newName: doRename ? newName : name }));
      return true;
    }

    // DELETE /api/hotspot — 删除热点
    // Body: { scene, name }
    if (req.method === 'DELETE' && urlPath === '/api/hotspot') {
      const body = await parseBody(req);
      const { scene, name } = body;
      if (!scene || !name) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Missing scene or name' }));
        return true;
      }

      const hsFile = join(hotspotsDir(), `${scene}.xml`);
      if (existsSync(hsFile)) {
        let content = readFileSync(hsFile, 'utf-8');
        // 删除包含该 name 的整行
        const lines = content.split('\n').filter(l => {
          return !l.includes(`name="${name}"`);
        });
        writeFileSync(hsFile, lines.join('\n').trim(), 'utf-8');
        log.info(`API: 热点删除 ${scene}/${name}`);
        regenerateScenesXmlAfterHotspotChange();
      }
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true }));
      return true;
    }

    // GET /api/sort — 获取分组及场景排序（含场景标题）
    if (req.method === 'GET' && urlPath === '/api/sort') {
      try {
        const config = loadConfig();
        // buildSceneList 内部调用 scanSourceImages，已按 group.scenes 顺序排好
        const sceneList = buildSceneList();
        // 按分组聚合场景（保留扫描顺序）
        const groupSceneMap = new Map();
        for (const s of sceneList) {
          if (!groupSceneMap.has(s.group)) groupSceneMap.set(s.group, []);
          groupSceneMap.get(s.group).push({ filename: s.filename, title: s.title });
        }
        const groups = (config.groups || []).map(g => ({
          name: g.name,
          folders: (g.folders || []).map(folder => ({ folder })),
          scenes: groupSceneMap.get(g.name) || [],
        }));
        res.writeHead(200);
        res.end(JSON.stringify({ groups }));
      } catch (e) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: e.message }));
      }
      return true;
    }

    // POST /api/sort — 保存分组及场景排序
    if (req.method === 'POST' && urlPath === '/api/sort') {
      const body = await parseBody(req);
      const { groups } = body;
      if (!groups || !Array.isArray(groups)) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Invalid groups data' }));
        return true;
      }
      const cfgFile = configPath();
      const config = JSON.parse(readFileSync(cfgFile, 'utf-8'));
      // 更新 groups 顺序及组内场景排序
      config.groups = groups.map(g => {
        const entry = {
          name: String(g.name),
          folders: (g.folders || []).filter(f => typeof f === 'string' && f),
        };
        // 仅在有明确排序时才写入 scenes 字段（避免污染全新项目的 config）
        if (g.scenes && g.scenes.length > 0) {
          entry.scenes = g.scenes.filter(s => typeof s === 'string' && s);
        }
        return entry;
      });
      writeFileSync(cfgFile, JSON.stringify(config, null, 4), 'utf-8');
      log.info('API: 场景排序已保存');
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true }));
      return true;
    }

    // POST /api/rebuild-xml — 重新生成 scenes.xml
    if (req.method === 'POST' && urlPath === '/api/rebuild-xml') {
      try {
        const config = loadConfig();
        const scenes = scanSourceImages(config);
        const cache = loadMultiresCache();
        const pDir = panosDir();
        for (const scene of scenes) {
          if (!(scene.filename in cache)) {
            const detected = detectMultiresFromTiles(join(pDir, scene.tilesFolder));
            cache[scene.filename] = detected || '512,1024,2048,4096';
          }
        }
        saveMultiresCache(cache);
        generateScenesXml(scenes, cache, config);
        generateGroupsXml(config); // 同时更新分组导航 XML
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true }));
        log.info('API: scenes.xml + groups_data.xml 已重新生成');
      } catch (e) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: e.message }));
      }
      return true;
    }

    // 未匹配的 API 路由
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Unknown API endpoint' }));
    return true;
  } catch (err) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: err.message }));
    return true;
  }
}

/**
 * 启动本地预览服务器（替代 tour_testingserver.exe）。
 * @param {{ port?: number, portSpecified?: boolean, edit?: boolean }} opts
 */
export async function cmdServe(opts = {}) {
  let port = opts.port || 8090;
  const portSpecified = !!opts.portSpecified;
  const editMode = !!opts.edit;
  const root = vtourDir();

  if (!existsSync(join(root, 'tour.html')) && !existsSync(join(root, 'tour.xml'))) {
    log.error('当前目录不是有效的 vtour 目录（未找到 tour.html / tour.xml）');
    process.exit(1);
  }

  const server = createServer(async (req, res) => {
    // CORS headers for krpano
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Decode URL and strip query string
    let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    const rawUrl = req.url || '/';

    // API routes (editor features)
    try {
      if (await handleApi(req, res, urlPath, rawUrl)) return;
    } catch { /* fall through to static */ }

    // 编辑器 JS（--edit 模式下提供内置文件）
    if (editMode && urlPath === '/__editor__.js') {
      const editorJs = readFileSync(join(TEMPLATES_DIR, 'editor', 'editor.js'));
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(editorJs);
      return;
    }

    // Default to tour.html
    if (urlPath === '/') urlPath = '/tour.html';

    // Prevent path traversal
    const filePath = join(root, urlPath);
    const realRoot = realpathSync(root);
    const realFile = existsSync(filePath) ? realpathSync(filePath) : filePath;
    if (!realFile.startsWith(realRoot)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('403 Forbidden');
      log.debug(`403 ${urlPath} (path traversal blocked)`);
      return;
    }

    if (!existsSync(filePath) || !statSync(filePath).isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
      log.debug(`404 ${urlPath}`);
      return;
    }

    const ext = extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    try {
      let data = readFileSync(filePath);

      // --edit 模式：在 tour.html 中注入编辑器脚本
      if (editMode && urlPath === '/tour.html' && ext === '.html') {
        let html = data.toString('utf-8');
        // 确保 pano-runtime.js 已注入（老项目可能缺少）
        if (!html.includes('pano-runtime.js')) {
          html = html.replace(/<script src="tour\.js"><\/script>/, '<script src="tour.js"></script>\n<script src="pano-runtime.js"></script>');
        }
        html = html.replace('</body>', '<script src="/__editor__.js"></script>\n</body>');
        data = Buffer.from(html, 'utf-8');
      } else if (urlPath === '/tour.html' && ext === '.html') {
        // 非 edit 模式也确保 pano-runtime.js 已注入
        let html = data.toString('utf-8');
        if (!html.includes('pano-runtime.js')) {
          html = html.replace(/<script src="tour\.js"><\/script>/, '<script src="tour.js"></script>\n<script src="pano-runtime.js"></script>');
          data = Buffer.from(html, 'utf-8');
        }
      }

      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': data.length,
        'Cache-Control': 'no-cache',
      });
      res.end(data);
      log.debug(`200 ${urlPath} (${(data.length / 1024).toFixed(1)} KB)`);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('500 Internal Server Error');
      log.error(`500 ${urlPath}: ${err.message}`);
    }
  });

  // 端口分配：用户指定则直接尝试，未指定则自动递增查找可用端口
  if (portSpecified) {
    const ok = await tryListen(server, port);
    if (!ok) {
      log.error(`端口 ${port} 已被占用，请使用其他端口，例如: pano serve -p ${port + 1}`);
      process.exit(1);
    }
  } else {
    const maxAttempts = 20;
    let ok = false;
    for (let i = 0; i < maxAttempts; i++) {
      ok = await tryListen(server, port);
      if (ok) break;
      log.debug(`端口 ${port} 已被占用，尝试 ${port + 1}...`);
      port++;
    }
    if (!ok) {
      log.error(`端口 8090-${port} 均被占用，请使用 -p 手动指定端口`);
      process.exit(1);
    }
  }

  {
    const url = `http://localhost:${port}/`;
    log.title(editMode ? 'krpano 编辑模式' : 'krpano 本地预览服务器');
    log.info(`地址: ${url}`);
    log.info(`根目录: ${root}`);
    if (editMode) {
      log.info('');
      log.info('编辑器功能:');
      log.info('  🎯 设为默认视角 → scenes.config.json 的 sceneOverrides');
      log.info('  📌 添加/管理热点 → hotspots/*.xml');
      log.info('  ⚡ 生成 XML → 重新构建 scenes.xml');
    }
    log.info('');
    log.info('按 Ctrl+C 停止服务器');

    // Auto-open browser
    const cmd = process.platform === 'win32' ? `start ${url}`
      : process.platform === 'darwin' ? `open ${url}`
        : `xdg-open ${url}`;
    exec(cmd, () => { });
  }

  // Keep process alive
  await new Promise(() => { });
}
