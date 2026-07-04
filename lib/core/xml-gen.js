// @ts-check
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { scenesXmlPath, groupsXmlPath, hotspotsDir } from './config.js';
import { escapeXml } from './encoder.js';
import { log } from './logger.js';

function jsStringLiteral(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function toHexColor(value, fallback = '0x00FF00') {
  const raw = String(value || '').trim().replace('#', '');
  const hex = raw.length === 3 ? raw.split('').map((ch) => ch + ch).join('') : raw;
  return /^[0-9a-fA-F]{6}$/.test(hex) ? `0x${hex.toUpperCase()}` : fallback;
}

function parseBool(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const lowered = String(value).toLowerCase();
  if (lowered === 'true' || lowered === '1' || lowered === 'yes') return true;
  if (lowered === 'false' || lowered === '0' || lowered === 'no') return false;
  return fallback;
}

function parseNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function buildGreenScreenAttrs(sceneFilename, hotspotName) {
  const infoFile = join(hotspotsDir(), 'info', `${sceneFilename}__${hotspotName}.json`);
  if (!existsSync(infoFile)) return null;
  try {
    const data = JSON.parse(readFileSync(infoFile, 'utf-8')) || {};
    if (!data.video) return null;
    const width = Math.max(0.5, parseNumber(data.width, 12));
    const scale = Math.max(0.05, Number((width / 40).toFixed(3)));
    const loop = parseBool(data.loop, true);
    const userMuted = parseBool(data.muted, true);
    const attrs = {
      url: 'plugins/videoplayer.js',
      videourl: String(data.video),
      handcursor: loop ? 'false' : 'true',
      capture: loop ? 'false' : 'true',
      alpha: '1.0',
      visible: 'true',
      distorted: 'true',
      zoom: 'true',
      scale: String(scale),
      loop: loop ? 'true' : 'false',
      pausedonstart: 'true',
      muted: userMuted ? 'true' : 'false',
      volume: userMuted ? '0.0' : '1.0',
      alphahittest: loop ? '0.5' : '0.1',
      greenscreen_autoplay: 'true',
      onclick: `greenscreen_toggle_manual(${hotspotName});`,
    };
    if (parseBool(data.chromaKey, true)) {
      attrs.chromakey = [
        toHexColor(data.keyColor, '0x00FF00'),
        parseNumber(data.threshold, 0.694).toFixed(3),
        parseNumber(data.feather, 0.233).toFixed(3),
      ].join('|');
    }
    return attrs;
  } catch (err) {
    log.warn(`读取绿幕热点配置失败 ${sceneFilename}/${hotspotName}: ${err.message}`);
    return null;
  }
}

function parseHotspotAttrs(line) {
  const attrs = {};
  const re = /([\w:-]+)="([^"]*)"/g;
  let m;
  while ((m = re.exec(line)) !== null) {
    attrs[m[1]] = m[2];
  }
  return attrs;
}

function serializeHotspot(attrs) {
  const order = ['name', 'url', 'style', 'ath', 'atv', 'distorted', 'zoom', 'scale', 'editor_type', 'type', 'linkedscene', 'videourl', 'chromakey', 'greenscreen_autoplay', 'alphahittest', 'pausedonstart', 'loop', 'muted', 'volume', 'handcursor', 'capture', 'alpha', 'visible', 'onclick'];
  const used = new Set();
  const parts = [];
  for (const key of order) {
    if (attrs[key] !== undefined && attrs[key] !== '') {
      used.add(key);
      parts.push(`${key}="${escapeXml(String(attrs[key]))}"`);
    }
  }
  for (const [key, value] of Object.entries(attrs)) {
    if (used.has(key) || value === undefined || value === '') continue;
    parts.push(`${key}="${escapeXml(String(value))}"`);
  }
  return `<hotspot ${parts.join(' ')} />`;
}

function enhanceHotspotContent(sceneFilename, hotspotContent) {
  if (!hotspotContent) return hotspotContent;
  return hotspotContent.split('\n').map((line) => {
    if (!line.includes('<hotspot') || (!line.includes('editor_type="info"') && !line.includes('editor_type="link"') && !line.includes('editor_type="video"') && !line.includes('editor_type="greenscreen"') && !line.includes('type="info"') && !line.includes('type="link"') && !line.includes('type="video"') && !line.includes('type="greenscreen"'))) {
      return line;
    }

    const attrs = parseHotspotAttrs(line);
    if (!attrs.name) return line;
    const semanticType = attrs.editor_type || attrs.type;
    if (!semanticType) return line;
    if (attrs.type && semanticType !== 'image' && semanticType !== 'container') {
      delete attrs.type;
    }
    attrs.editor_type = semanticType;

    attrs.distorted = attrs.distorted || 'false';
    attrs.zoom = attrs.zoom || 'false';

    if (semanticType === 'info') {
      delete attrs.linkedscene;
      attrs.onclick = `js(window.__pano_runtime_openInfo('${jsStringLiteral(sceneFilename)}','${jsStringLiteral(attrs.name)}'));`;
      return serializeHotspot(attrs);
    }

    if (semanticType === 'link') {
      delete attrs.linkedscene;
      attrs.onclick = `js(window.__pano_runtime_openLink('${jsStringLiteral(sceneFilename)}','${jsStringLiteral(attrs.name)}'));`;
      return serializeHotspot(attrs);
    }

    if (semanticType === 'video') {
      delete attrs.linkedscene;
      attrs.onclick = `js(window.__pano_runtime_openVideo('${jsStringLiteral(sceneFilename)}','${jsStringLiteral(attrs.name)}'));`;
      return serializeHotspot(attrs);
    }

    if (semanticType === 'greenscreen') {
      delete attrs.linkedscene;
      delete attrs.style;
      Object.assign(attrs, buildGreenScreenAttrs(sceneFilename, attrs.name) || {});
      return serializeHotspot(attrs);
    }

    return line;
  }).join('\n');
}

/**
 * 生成 scenes.xml — 所有场景定义。
 * @param {Array<{filename:string, encoded:string, title:string, group:string, tilesFolder:string}>} scenes
 * @param {Record<string, string>} multiresCache
 * @param {object} config
 * @param {string|null} [panosBase=null] 瓦片基础路径
 * @returns {string|null} startSceneId
 */
export function generateScenesXml(scenes, multiresCache, config, panosBase = null) {
  const startSceneName = config.startScene || '';
  if (!panosBase) panosBase = 'panos';

  const now = new Date();
  const ts = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

  const lines = [
    '<!-- scenes.xml — 自动生成，请勿手动编辑 -->',
    `<!-- Generated: ${ts} -->`,
    '<krpano>',
    '',
  ];

  let startSceneId = null;
  const hotspotsPath = hotspotsDir();

  // 构建 sceneOverrides 查找表（按文件名索引）
  const overrides = {};
  if (config.sceneOverrides) {
    for (const [key, val] of Object.entries(config.sceneOverrides)) {
      overrides[key] = val;
    }
  }
  const viewDefaults = config.viewDefaults || {};

  for (let idx = 0; idx < scenes.length; idx++) {
    const scene = scenes[idx];
    const { filename: fn, encoded, tilesFolder: tiles, title, group } = scene;
    const multires = multiresCache[fn] || '512,1024,2048,4096';
    const sceneId = `scene_${encoded}`;

    if (fn === startSceneName) startSceneId = sceneId;

    // 加载热点覆盖文件
    let hotspotContent = '';
    const hotspotFile = join(hotspotsPath, `${fn}.xml`);
    if (existsSync(hotspotFile)) {
      hotspotContent = enhanceHotspotContent(fn, readFileSync(hotspotFile, 'utf-8').trim());
    }

    lines.push(`\t<!-- [${idx + 1}] ${fn} -->`);
    lines.push(
      `\t<scene name="${sceneId}" title="${escapeXml(title)}"` +
      ` sourcefile="${escapeXml(fn)}"` +
      ` scenegroup="${escapeXml(group)}"` +
      ` onstart="" thumburl="${panosBase}/${tiles}/thumb.jpg"` +
      ` lat="" lng="" heading="">`
    );
    lines.push(`\t\t`);
    lines.push(`\t\t<control bouncinglimits="calc:image.cube ? true : false" />`);
    lines.push(`\t\t`);

    // 视角参数：优先使用 sceneOverrides 中的值
    const ov = overrides[fn] || {};
    const hlookat = ov.hlookat ?? '0.0';
    const vlookat = ov.vlookat ?? '0.0';
    const fov = ov.fov ?? '120';
    const fovmin = ov.fovmin ?? viewDefaults.fovmin ?? '70';
    const fovmax = ov.fovmax ?? viewDefaults.fovmax ?? '140';
    lines.push(
      `\t\t<view hlookat="${hlookat}" vlookat="${vlookat}" fovtype="MFOV" fov="${fov}"` +
      ` maxpixelzoom="2.0" fovmin="${fovmin}" fovmax="${fovmax}" limitview="auto" />`
    );
    lines.push(`\t\t`);
    lines.push(`\t\t<preview url="${panosBase}/${tiles}/preview.jpg" />`);
    lines.push(`\t\t`);
    lines.push(`\t\t<image>`);
    lines.push(
      `\t\t\t<cube url="${panosBase}/${tiles}/%s/l%l/%v/l%l_%s_%v_%h.jpg"` +
      ` multires="${multires}" />`
    );
    lines.push(`\t\t</image>`);

    if (hotspotContent) {
      lines.push(`\t\t`);
      lines.push(`\t\t<!-- hotspots/${fn}.xml -->`);
      for (const hl of hotspotContent.split('\n')) {
        lines.push(`\t\t${hl}`);
      }
    }

    lines.push('');
    lines.push(`\t</scene>`);
    lines.push('');
  }

  lines.push('</krpano>');

  writeFileSync(scenesXmlPath(), lines.join('\n'), 'utf-8');

  log.info(`生成: scenes.xml`);
  log.info(`场景总数: ${scenes.length}`);
  if (startSceneId) {
    log.info(`起始场景: ${startSceneId} (${startSceneName})`);
  }

  return startSceneId;
}

/**
 * 生成 skin/groups_data.xml — 分组按钮数据（项目特定）。
 * 框架代码在 panohper/scene_groups.xml 中。
 * @param {object} config
 */
export function generateGroupsXml(config) {
  const filePath = groupsXmlPath();
  mkdirSync(dirname(filePath), { recursive: true });

  const groups = config.groups;
  const groupCount = groups.length + 1; // +1 for "全部"

  const btnLines = [];
  btnLines.push(
    `\t\tset(layer[skin_gbtn_0].html, '全部');       set(layer[skin_gbtn_0].groupid, 'all');`
  );
  for (let i = 0; i < groups.length; i++) {
    const idx = i + 1;
    const name = groups[i].name;
    btnLines.push(
      `\t\tset(layer[skin_gbtn_${idx}].html, '${name}'); set(layer[skin_gbtn_${idx}].groupid, '${name}');`
    );
  }

  const lines = [
    '<!-- groups_data.xml — 自动生成，请勿手动编辑 -->',
    '<krpano>',
    '',
    '\t<!-- 设置分组数量 -->',
    '\t<action name="skin_apply_group_data">',
    `\t\tset(global.group_count, ${groupCount});`,
    '\t</action>',
    '',
    '\t<!-- 设置分组按钮标签 -->',
    '\t<action name="skin_set_group_btn_labels">',
    ...btnLines,
    '\t</action>',
    '',
    '</krpano>',
  ];

  writeFileSync(filePath, lines.join('\n'), 'utf-8');

  log.info('生成: skin/groups_data.xml');
  log.info(`分组: 全部 + ${groups.map(g => g.name).join(', ')}`);
}

/**
 * 打印场景名称映射表。
 * @param {Array<{filename:string, encoded:string, title:string, group:string}>} scenes
 */
export function printSceneMapping(scenes) {
  log.info('\n  场景映射表:');
  log.info('  ' + '-'.repeat(64));
  let currentGroup = null;
  for (const scene of scenes) {
    if (scene.group !== currentGroup) {
      currentGroup = scene.group;
      log.info(`\n  【${currentGroup}】`);
    }
    const sceneId = `scene_${scene.encoded}`;
    const extra = scene.title !== scene.filename ? `  (title: ${scene.title})` : '';
    log.info(`    ${sceneId} = ${scene.filename}${extra}`);
  }
}
