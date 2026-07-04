/**
 * pano-cli 编辑器覆盖层
 * 通过 pano serve --edit 注入到 tour.html 中
 */
(function () {
  'use strict';
  window.__PANO_EDITOR_ACTIVE = true;

  // ── 等待 krpano 就绪 ──
  const MAX_WAIT = 10000;
  const POLL = 100;
  let waited = 0;

  function getKrpano() {
    return document.getElementById('krpanoSWFObject');
  }

  function waitForKrpano() {
    const kp = getKrpano();
    if (kp && typeof kp.get === 'function') {
      init(kp);
    } else if (waited < MAX_WAIT) {
      waited += POLL;
      setTimeout(waitForKrpano, POLL);
    } else {
      console.error('[pano-editor] krpano 未就绪');
    }
  }

  // ── 工具函数 ──
  async function api(method, path, body) {
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(path, opts);
    return res.json();
  }

  function round(v, d) {
    const p = Math.pow(10, d || 3);
    return Math.round(v * p) / p;
  }

  function parseBoolSetting(value, fallback) {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value === 'boolean') return value;
    const lowered = String(value).toLowerCase();
    if (lowered === 'true' || lowered === '1' || lowered === 'yes') return true;
    if (lowered === 'false' || lowered === '0' || lowered === 'no') return false;
    return fallback;
  }

  function parseNumSetting(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function toHotspotHexColor(value) {
    const raw = String(value || '').trim().replace('#', '');
    const hex = raw.length === 3 ? raw.split('').map((ch) => ch + ch).join('') : raw;
    return /^[0-9a-fA-F]{6}$/.test(hex) ? `0x${hex.toUpperCase()}` : '0x00FF00';
  }

  const greenScreenEditHandles = new Map();
  let greenScreenHandleLoopStarted = false;
  let hotspotInteractionLoopStarted = false;

  function removeGreenScreenEditHandle(name) {
    const handle = greenScreenEditHandles.get(name);
    if (!handle) return;
    handle.remove();
    greenScreenEditHandles.delete(name);
  }

  function ensureGreenScreenEditHandle(name) {
    let handle = greenScreenEditHandles.get(name);
    if (handle) return handle;
    handle = document.createElement('button');
    handle.type = 'button';
    handle.dataset.greenscreenHandle = name;
    handle.textContent = '🧍 编辑';
    handle.title = `编辑绿幕讲解: ${name}`;
    handle.style.cssText = [
      'position:fixed',
      'left:0',
      'top:0',
      'transform:translate(-50%, -100%)',
      'z-index:100003',
      'display:none',
      'padding:5px 10px',
      'border:none',
      'border-radius:999px',
      'background:rgba(18,24,35,0.92)',
      'color:#fff',
      'font:12px/1.2 system-ui, -apple-system, sans-serif',
      'box-shadow:0 6px 18px rgba(0,0,0,0.35)',
      'cursor:pointer',
      'white-space:nowrap'
    ].join(';');
    handle.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      const kp = getKrpano();
      if (!kp) return;
      showEditHotspotPanel(kp, name);
    };
    document.body.appendChild(handle);
    greenScreenEditHandles.set(name, handle);
    return handle;
  }

  function syncGreenScreenEditHandle(kp, name) {
    const type = kp.get(`hotspot[${name}].editor_type`) || kp.get(`hotspot[${name}].type`) || '';
    if (type !== 'greenscreen' || hotspotInteractionMode !== 'edit') {
      removeGreenScreenEditHandle(name);
      return;
    }

    const ath = parseNumSetting(kp.get(`hotspot[${name}].ath`), NaN);
    const atv = parseNumSetting(kp.get(`hotspot[${name}].atv`), NaN);
    const screen = Number.isFinite(ath) && Number.isFinite(atv) ? kp.spheretoscreen(ath, atv) : null;
    if (!screen || screen.z <= 0) {
      removeGreenScreenEditHandle(name);
      return;
    }

    const stageWidth = parseNumSetting(kp.get('stagewidth'), window.innerWidth || 0);
    const stageHeight = parseNumSetting(kp.get('stageheight'), window.innerHeight || 0);
    const visible = screen.x > -120 && screen.x < stageWidth + 120 && screen.y > -60 && screen.y < stageHeight + 60;
    if (!visible) {
      removeGreenScreenEditHandle(name);
      return;
    }

    const handle = ensureGreenScreenEditHandle(name);
    handle.style.display = 'block';
    handle.style.left = `${screen.x}px`;
    handle.style.top = `${screen.y - 12}px`;
  }

  function syncGreenScreenEditHandles(kp) {
    const activeNames = new Set();
    const count = parseInt(kp.get('hotspot.count')) || 0;
    for (let i = 0; i < count; i++) {
      const name = kp.get(`hotspot[${i}].name`);
      if (!name) continue;
      const type = kp.get(`hotspot[${name}].editor_type`) || kp.get(`hotspot[${name}].type`) || '';
      if (type !== 'greenscreen') continue;
      activeNames.add(name);
      syncGreenScreenEditHandle(kp, name);
    }
    for (const name of Array.from(greenScreenEditHandles.keys())) {
      if (!activeNames.has(name)) removeGreenScreenEditHandle(name);
    }
  }

  function ensureGreenScreenHandleLoop() {
    if (greenScreenHandleLoopStarted) return;
    greenScreenHandleLoopStarted = true;
    const tick = () => {
      const kp = getKrpano();
      if (kp) syncGreenScreenEditHandles(kp);
      window.requestAnimationFrame(tick);
    };
    window.requestAnimationFrame(tick);
  }

  function ensureHotspotClickBindings(kp) {
    const count = parseInt(kp.get('hotspot.count')) || 0;
    for (let i = 0; i < count; i++) {
      const name = kp.get(`hotspot[${i}].name`);
      if (!name) continue;
      const onclick = kp.get(`hotspot[${name}].onclick`) || '';
      if (String(onclick).indexOf('__pano_editor_hotspotclick') === -1) {
        bindHotspot(kp, name);
      }
    }
  }

  function ensureHotspotInteractionLoop() {
    if (hotspotInteractionLoopStarted) return;
    hotspotInteractionLoopStarted = true;
    let lastCheck = 0;
    const tick = () => {
      const now = Date.now();
      if (now - lastCheck > 500 && hotspotInteractionMode === 'edit') {
        lastCheck = now;
        const kp = getKrpano();
        if (kp) ensureHotspotClickBindings(kp);
      }
      window.requestAnimationFrame(tick);
    };
    window.requestAnimationFrame(tick);
  }

  function refreshGreenScreenInteractionState(kp, name) {
    const type = kp.get(`hotspot[${name}].editor_type`) || kp.get(`hotspot[${name}].type`) || '';
    if (type !== 'greenscreen') {
      removeGreenScreenEditHandle(name);
      return;
    }
    const loop = String(kp.get(`hotspot[${name}].loop`) || '').toLowerCase() === 'true';
    // 编辑模式下放宽 alpha hit test，避免抠像过度时完全失去点击区域。
    kp.set(`hotspot[${name}].alphahittest`, hotspotInteractionMode === 'edit' ? 0 : (loop ? 0.5 : 0.1));
    syncGreenScreenEditHandle(kp, name);
  }

  async function applyGreenScreenHotspot(kp, scene, name, rawData) {
    const data = rawData || await api('GET', `/api/hotspot-info?scene=${encodeURIComponent(scene)}&name=${encodeURIComponent(name)}`);
    if (!data || !data.video) return;
    const width = Math.max(0.5, parseNumSetting(data.width, 12));
    const scale = Math.max(0.05, round(width / 40, 3));
    const loop = parseBoolSetting(data.loop, true);
    kp.set(`hotspot[${name}].url`, 'plugins/videoplayer.js');
    kp.set(`hotspot[${name}].videourl`, data.video);
    kp.set(`hotspot[${name}].handcursor`, !loop);
    kp.set(`hotspot[${name}].capture`, !loop);
    kp.set(`hotspot[${name}].alpha`, 1);
    kp.set(`hotspot[${name}].visible`, true);
    kp.set(`hotspot[${name}].distorted`, true);
    kp.set(`hotspot[${name}].zoom`, true);
    kp.set(`hotspot[${name}].scale`, scale);
    kp.set(`hotspot[${name}].alphahittest`, loop ? 0.5 : 0.1);
    kp.set(`hotspot[${name}].pausedonstart`, true);
    kp.set(`hotspot[${name}].loop`, loop);
    kp.set(`hotspot[${name}].muted`, parseBoolSetting(data.muted, true));
    kp.set(`hotspot[${name}].volume`, parseBoolSetting(data.muted, true) ? 0 : 1);
    if (parseBoolSetting(data.chromaKey, true)) {
      kp.set(`hotspot[${name}].chromakey`, `${toHotspotHexColor(data.keyColor)}|${parseNumSetting(data.threshold, 0.694).toFixed(3)}|${parseNumSetting(data.feather, 0.233).toFixed(3)}`);
    } else {
      kp.set(`hotspot[${name}].chromakey`, '');
    }
    kp.set(`hotspot[${name}].greenscreen_autoplay`, true);
    kp.set(`hotspot[${name}].onclick`, `greenscreen_toggle_manual(${name});`);
    kp.set(`hotspot[${name}]._editor_orig_onclick`, `greenscreen_toggle_manual(${name});`);
    refreshGreenScreenInteractionState(kp, name);
  }

  // ── 场景数据 ──
  let sceneMap = {};   // scene_xxx -> filename
  let sceneList = [];  // [{sceneId, filename, title, group}]
  let hotspotInteractionMode = 'edit';
  let hotspotModeButton = null;
  let previewModifierPressed = false;

  async function loadSceneMap() {
    try {
      const res = await api('GET', '/api/scenes');
      if (res && res.scenes) {
        sceneList = res.scenes;
        sceneMap = {};
        for (const s of res.scenes) {
          sceneMap[s.sceneId] = s.filename;
        }
        notifySceneListUpdated();
      }
    } catch (e) {
      console.warn('[pano-editor] 无法加载场景映射', e);
    }
  }

  function currentSceneFilename(kp) {
    const sceneId = kp.get('xml.scene');
    return sceneMap[sceneId] || sceneId;
  }

  function findSceneEntryByFilename(filename) {
    return sceneList.find(s => s.filename === filename) || null;
  }

  function notifySceneListUpdated() {
    document.dispatchEvent(new CustomEvent('pano-scene-list-updated'));
  }

  function bindPanelCleanup(panel, cleanup) {
    const origRemove = panel.remove.bind(panel);
    panel.remove = function () {
      cleanup();
      return origRemove();
    };
  }

  function patchCurrentSceneTitle(kp, filename, title) {
    const sceneEntry = findSceneEntryByFilename(filename);
    if (sceneEntry) {
      sceneEntry.title = title;
    }
    if (!kp) return;
    const currentSceneId = kp.get('xml.scene');
    if (sceneEntry && sceneEntry.sceneId === currentSceneId) {
      kp.set(`scene[${currentSceneId}].title`, title);
    }
    notifySceneListUpdated();
  }

  function patchDocumentTitle(title) {
    const nextTitle = String(title || '').trim();
    if (nextTitle) document.title = nextTitle;
  }

  function updateHotspotModeButton() {
    if (!hotspotModeButton) return;
    const isEdit = hotspotInteractionMode === 'edit';
    hotspotModeButton.innerHTML = isEdit
      ? '🛠️&nbsp;&nbsp;热点模式: 编辑'
      : '👆&nbsp;&nbsp;热点模式: 预览';
    hotspotModeButton.style.background = isEdit ? 'rgba(188,120,30,0.92)' : 'rgba(42,132,92,0.92)';
  }

  function setHotspotInteractionMode(mode, silent) {
    hotspotInteractionMode = mode === 'preview' ? 'preview' : 'edit';
    updateHotspotModeButton();
    const kp = getKrpano();
    if (kp) {
      const count = parseInt(kp.get('hotspot.count')) || 0;
      for (let i = 0; i < count; i++) {
        const name = kp.get(`hotspot[${i}].name`);
        if (name) refreshGreenScreenInteractionState(kp, name);
      }
      syncGreenScreenEditHandles(kp);
    }
    if (!silent) {
      toast(
        hotspotInteractionMode === 'edit'
          ? '热点编辑模式: 左键编辑/拖拽，Ctrl+点击执行真实行为'
          : '热点预览模式: 左键执行真实行为，切回编辑模式可继续修改',
        2800
      );
    }
  }

  window.__pano_editor_getInteractionMode = function () {
    return hotspotInteractionMode;
  };

  function executeOriginalHotspotAction(kp, name) {
    const origOnclick = kp.get(`hotspot[${name}]._editor_orig_onclick`) || '';
    if (origOnclick) {
      kp.call(`callwith(hotspot[${name}], ${origOnclick})`);
      return;
    }

    const linkedscene = kp.get(`hotspot[${name}].linkedscene`) || '';
    if (linkedscene) {
      kp.call(`loadscene('${linkedscene}', null, MERGE, BLEND(1))`);
      return;
    }

    const hotspotType = kp.get(`hotspot[${name}].editor_type`) || kp.get(`hotspot[${name}].type`) || '';
    const scene = currentSceneFilename(kp);
    if (hotspotType === 'info' || hotspotType === 'link' || hotspotType === 'video') {
      api('GET', `/api/hotspot-info?scene=${encodeURIComponent(scene)}&name=${encodeURIComponent(name)}`)
        .then((data) => {
          if (hotspotType === 'info') showInfoOverlay(data || {});
          else if (hotspotType === 'link') showLinkOverlay((data && data.linkUrl) || '');
          else showVideoOverlay((data && data.video) || '', (data && data.title) || name);
        })
        .catch((err) => toast('✗ 无法加载热点内容: ' + err.message, 3000));
      return;
    }

    if (hotspotType === 'greenscreen') {
      toast('绿幕讲解热点会直接显示在场景里', 1800);
      return;
    }

    toast('该热点没有原始点击行为', 1800);
  }


  function executeCapturedHotspotAction(kp, action) {
    if (!kp || !action) return;

    if (action.origOnclick) {
      kp.call(action.origOnclick);
      return;
    }

    if (action.linkedscene) {
      kp.call(`loadscene('${action.linkedscene}', null, MERGE, BLEND(1))`);
      return;
    }

    const hotspotType = action.hotspotType || '';
    const scene = action.scene || currentSceneFilename(kp);
    const name = action.name || '';
    if (hotspotType === 'info' || hotspotType === 'link' || hotspotType === 'video') {
      api('GET', `/api/hotspot-info?scene=${encodeURIComponent(scene)}&name=${encodeURIComponent(name)}`)
        .then((data) => {
          if (hotspotType === 'info') showInfoOverlay(data || {});
          else if (hotspotType === 'link') showLinkOverlay((data && data.linkUrl) || '');
          else showVideoOverlay((data && data.video) || '', (data && data.title) || name);
        })
        .catch((err) => toast('✗ 无法加载热点内容: ' + err.message, 3000));
      return;
    }

    if (hotspotType === 'greenscreen') {
      toast('绿幕讲解热点会直接显示在场景里', 1800);
      return;
    }

    toast('该热点没有原始点击行为', 1800);
  }

  // ── 可用热点样式 ──
  // fw = 每帧宽度（用于裁剪预览第一帧）
  const HOTSPOT_STYLES = [
    { id: 'skin_hotspotstyle', label: '默认箭头', desc: '前进动画', preview: 'panohper/assets/hotspots/arrow-advance.png', fw: 86 },
    { id: 'skin_hotspotstyle|hotspot_forward', label: '前进(白)', desc: '序列帧动画', preview: 'panohper/assets/hotspots/arrow-forward.png', fw: 308 },
    { id: 'skin_hotspotstyle|hotspot_qianjin', label: '前进(720)', desc: '720yun 风格', preview: 'panohper/assets/hotspots/arrow-advance.png', fw: 86 },
    { id: 'skin_hotspotstyle|hotspot_youzhuan', label: '右转', desc: '720yun 风格', preview: 'panohper/assets/hotspots/arrow-right.png', fw: 86 },
    { id: 'skin_hotspotstyle|hotspot_zuozhuan', label: '左转', desc: '720yun 风格', preview: 'panohper/assets/hotspots/arrow-left.png', fw: 86 },
    { id: 'skin_hotspotstyle|hotspot_wurenji', label: '无人机', desc: '720yun 风格', preview: 'panohper/assets/hotspots/drone.png', fw: 86 },
    { id: 'skin_hotspotstyle|hotspot_spotd12', label: '光点(大)', desc: '720yun 风格', preview: 'panohper/assets/hotspots/ring-large.png', fw: 86 },
    { id: 'skin_hotspotstyle|hotspot_spotd6', label: '光点(小)', desc: '720yun 风格', preview: 'panohper/assets/hotspots/ring-small.png', fw: 86 },
    { id: 'hotspot_video', label: '视频图标', desc: '适合视频热点', preview: 'panohper/assets/hotspots/shiping2.png', fw: 86 },
  ];

  // 渲染热点样式第一帧预览
  function makeStylePreview(previewUrl, fw) {
    const SZ = 44;
    const outer = document.createElement('div');
    outer.style.cssText = `width:${SZ}px;height:${SZ}px;overflow:hidden;background:#0d0d18;border-radius:6px;flex-shrink:0;position:relative;`;
    const img = document.createElement('img');
    img.src = previewUrl;
    // Let image load at natural size, then scale so first frame (fw×fw) fills SZ×SZ
    img.style.cssText = `position:absolute;left:0;top:0;max-width:none;transform-origin:0 0;transform:scale(${SZ / fw});`;
    outer.appendChild(img);
    return outer;
  }

  // ── 主初始化 ──
  function init(kp) {
    loadSceneMap().then(() => {
      setupHotspotInteractions(kp);
      window.setTimeout(() => setupHotspotInteractions(kp), 800);
    });
    ensureGreenScreenHandleLoop();
    ensureHotspotInteractionLoop();
    kp.call(`
      set(events[editor_scenechange].keep, true);
      set(events[editor_scenechange].onnewscene, delayedcall(0.3, js(__pano_editor_rebind())) );
    `);
    createToast();
    createToolbar(kp);
    setHotspotInteractionMode('edit', true);
    console.log('[pano-editor] 编辑器已加载');
  }


  // 切场景时自动刷新热点列表
  window.__pano_editor_rebind = async function () {
    const kp = getKrpano();
    if (!kp) return;
    // 场景切换后 krpano 会销毁并重建热点实例，此前设置的 ondown/onup 绑定全部失效，
    // 必须清空已绑定标记，才能对新场景热点重新绑定交互。
    _boundHotspots.clear();

    const fn = currentSceneFilename(kp);
    // 与后端对账：krpano 缓存了初始 scenes.xml 的场景定义，切场景时只会从缓存重建。
    // 因此新增的热点必须在此处重新注入到当前场景，否则看不到。
    try {
      const res = await api('GET', `/api/hotspots?scene=${encodeURIComponent(fn)}`);
      const hotspots = res.hotspots || [];
      // 收集当前 krpano 中已存在的热点名
      const existing = new Set();
      const count = parseInt(kp.get('hotspot.count')) || 0;
      for (let i = 0; i < count; i++) {
        const nm = kp.get(`hotspot[${i}].name`);
        if (nm) existing.add(nm);
      }
      // 缺失的热点 → 重新注入
      for (const hs of hotspots) {
        if (existing.has(hs.name)) continue;
        kp.call(`addhotspot(${hs.name})`);
        kp.set(`hotspot[${hs.name}].ath`, hs.ath);
        kp.set(`hotspot[${hs.name}].atv`, hs.atv);
        kp.set(`hotspot[${hs.name}].distorted`, hs.type === 'greenscreen');
        kp.set(`hotspot[${hs.name}].zoom`, hs.type === 'greenscreen');
        kp.set(`hotspot[${hs.name}].editor_type`, hs.type || 'nav');
        const style = hs.style || 'skin_hotspotstyle';
        if (hs.type !== 'greenscreen') {
          for (const st of style.split('|')) {
            kp.call(`hotspot[${hs.name}].loadstyle(${st})`);
          }
        } else {
          await applyGreenScreenHotspot(kp, fn, hs.name);
        }
        if (hs.type === 'nav' && hs.linkedscene) {
          kp.set(`hotspot[${hs.name}].linkedscene`, hs.linkedscene);
        }
        kp.call(`callwith(hotspot[${hs.name}], skin_hotspotstyle_setup())`);
      }
      // 自动刷新热点管理面板（如果已打开）
      if (document.getElementById('pano-hotspot-panel')) {
        showHotspotPanel(kp, fn, hotspots);
      }
    } catch { }

    // 全量重新绑定交互（包括刚注入的热点）
    setupHotspotInteractions(kp);
    window.setTimeout(() => setupHotspotInteractions(kp), 800);
  };

  // ── Toast 通知 ──
  let toastEl, toastTimer;

  function createToast() {
    toastEl = document.createElement('div');
    toastEl.id = 'pano-toast';
    Object.assign(toastEl.style, {
      position: 'fixed', bottom: '80px', left: '50%', transform: 'translateX(-50%)',
      background: 'rgba(0,0,0,0.85)', color: '#fff', padding: '10px 24px',
      borderRadius: '8px', fontSize: '14px', zIndex: '100001',
      opacity: '0', transition: 'opacity 0.3s', pointerEvents: 'none',
      whiteSpace: 'nowrap', boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
    });
    document.body.appendChild(toastEl);
  }

  function toast(msg, duration) {
    clearTimeout(toastTimer);
    toastEl.textContent = msg;
    toastEl.style.opacity = '1';
    toastTimer = setTimeout(() => { toastEl.style.opacity = '0'; }, duration || 2500);
  }

  // ── 通用样式 ──
  const PANEL_BG = 'rgba(24,24,28,0.96)';
  const BTN_BG = 'rgba(45,62,80,0.92)';
  const BTN_HOVER = 'rgba(55,75,95,1)';
  const ACCENT = '#4A9EFF';

  // ── 响应式样式 ──
  (function injectResponsiveStyles() {
    const style = document.createElement('style');
    style.textContent = `
      /* 面板响应式 — 小屏幕下全宽 */
      @media (max-width: 600px) {
        #pano-add-panel, #pano-edit-panel, #pano-hotspot-panel, #pano-sort-panel, #pano-scene-panel, #pano-global-view-panel {
          width: 96vw !important;
          max-width: none !important;
          max-height: 90vh !important;
          border-radius: 8px !important;
        }
        /* 信息弹窗 */
        #pano-info-overlay > div:last-child {
          width: 96% !important;
          max-width: none !important;
          max-height: 92vh !important;
        }
        /* 链接弹窗 */
        #pano-link-overlay > div:last-child {
          width: 98% !important;
          max-width: none !important;
          height: 90vh !important;
        }
      }
      /* 中等屏幕 */
      @media (min-width: 601px) and (max-width: 1024px) {
        #pano-add-panel, #pano-edit-panel, #pano-hotspot-panel, #pano-sort-panel, #pano-scene-panel, #pano-global-view-panel {
          width: 80vw !important;
          max-width: 560px !important;
        }
      }
    `;
    document.head.appendChild(style);
  })();

  function makeBtn(text, opts) {
    const btn = document.createElement('button');
    btn.textContent = text;
    Object.assign(btn.style, {
      padding: '6px 14px', border: 'none', borderRadius: '5px',
      background: (opts && opts.bg) || BTN_BG, color: '#fff', fontSize: '13px',
      cursor: 'pointer', transition: 'background 0.15s',
    });
    btn.onmouseenter = () => btn.style.background = (opts && opts.hoverBg) || BTN_HOVER;
    btn.onmouseleave = () => btn.style.background = (opts && opts.bg) || BTN_BG;
    if (opts && opts.onClick) btn.onclick = opts.onClick;
    return btn;
  }

  // ── 工具栏 ──
  function createToolbar(kp) {
    const bar = document.createElement('div');
    bar.id = 'pano-editor-toolbar';
    Object.assign(bar.style, {
      position: 'fixed', top: '12px', right: '12px', zIndex: '100000',
      display: 'flex', flexDirection: 'column', gap: '5px',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    });

    const tbBtnStyle = {
      padding: '9px 16px', border: 'none', borderRadius: '7px',
      background: BTN_BG, color: '#fff', fontSize: '13px',
      cursor: 'pointer', whiteSpace: 'nowrap', textAlign: 'left',
      backdropFilter: 'blur(10px)', transition: 'background 0.15s',
      boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
    };

    function addBtn(text, icon, onClick) {
      const btn = document.createElement('button');
      btn.innerHTML = icon + '&nbsp;&nbsp;' + text;
      Object.assign(btn.style, tbBtnStyle);
      btn.onmouseenter = () => btn.style.background = BTN_HOVER;
      btn.onmouseleave = () => btn.style.background = BTN_BG;
      btn.onclick = onClick;
      bar.appendChild(btn);
      return btn;
    }

    hotspotModeButton = addBtn('', '', () => {
      setHotspotInteractionMode(hotspotInteractionMode === 'edit' ? 'preview' : 'edit');
    });
    updateHotspotModeButton();

    // ── 设置为默认视角 ──
    addBtn('设为默认视角', '🎯', async () => {
      const fn = currentSceneFilename(kp);
      const h = round(parseFloat(kp.get('view.hlookat')));
      const v = round(parseFloat(kp.get('view.vlookat')));
      const f = round(parseFloat(kp.get('view.fov')));
      try {
        await api('POST', '/api/scene-view', { scene: fn, hlookat: h, vlookat: v, fov: f });
        toast(`✓ 默认视角已设置: ${fn} (h:${h} v:${v} fov:${f})`);
      } catch (e) {
        toast('✗ 保存失败: ' + e.message, 3000);
      }
    });

    // ── 添加热点 ──
    let addingHotspot = false;
    const addHsBtn = addBtn('添加热点', '📌', () => {
      if (addingHotspot) {
        cancelAdding();
        return;
      }
      addingHotspot = true;
      addHsBtn.innerHTML = '📌&nbsp;&nbsp;点击画面放置…';
      addHsBtn.style.background = 'rgba(220,50,50,0.9)';
      toast('点击全景画面选择热点位置，ESC 取消');
    });

    function cancelAdding() {
      addingHotspot = false;
      addHsBtn.innerHTML = '📌&nbsp;&nbsp;添加热点';
      addHsBtn.style.background = BTN_BG;
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (addingHotspot) { cancelAdding(); toast('已取消'); }
        closeAllPanels();
      }
    });

    // 点击放置 → 弹出配置面板
    document.addEventListener('click', (e) => {
      if (!addingHotspot) return;
      if (bar.contains(e.target)) return;
      if (e.target.closest('#pano-hotspot-panel, #pano-add-panel')) return;

      const mx = kp.get('mouse.stagex');
      const my = kp.get('mouse.stagey');
      const coords = kp.screentosphere(mx, my);
      const ath = round(coords.x);
      const atv = round(coords.y);

      cancelAdding();
      showAddHotspotPanel(kp, ath, atv);
    });

    // ── 管理热点 ──
    addBtn('管理热点', '📋', async () => {
      const fn = currentSceneFilename(kp);
      try {
        const res = await api('GET', `/api/hotspots?scene=${encodeURIComponent(fn)}`);
        showHotspotPanel(kp, fn, res.hotspots || []);
      } catch (e) {
        toast('✗ 加载热点失败: ' + e.message, 3000);
      }
    });

    // ── 场景设置 ──
    addBtn('场景设置', '🧭', () => showSceneSettingsPanel(kp));

    // ── 全局设置 ──
    addBtn('全局设置', '🌐', () => showGlobalViewPanel());

    // ── 重新生成 XML ──
    addBtn('生成 XML', '⚡', async () => {
      try {
        const res = await api('POST', '/api/rebuild-xml');
        if (res.ok) toast('✓ scenes.xml 已重新生成，刷新页面查看');
        else toast('✗ ' + (res.error || '生成失败'), 3000);
      } catch (e) {
        toast('✗ 生成失败: ' + e.message, 3000);
      }
    });

    // ── 场景排序 ──
    addBtn('排序管理', '↕', () => showSortPanel());

    document.body.appendChild(bar);
  }

  // ── 关闭所有面板 ──
  function closeAllPanels() {
    document.querySelectorAll('#pano-hotspot-panel, #pano-add-panel, #pano-edit-panel, #pano-sort-panel, #pano-scene-panel, #pano-global-view-panel').forEach(el => el.remove());
  }

  function closeEditAddPanels() {
    document.querySelectorAll('#pano-add-panel, #pano-edit-panel').forEach(el => el.remove());
  }

  async function showSceneSettingsPanel(kp) {
    const fn = currentSceneFilename(kp);
    const sceneId = kp.get('xml.scene');

    let settings;
    try {
      settings = await api('GET', `/api/scene-settings?scene=${encodeURIComponent(fn)}`);
    } catch (e) {
      toast('✗ 加载场景设置失败: ' + e.message, 3000);
      return;
    }

    const { panel, body, footer } = createPanel('pano-scene-panel', '场景设置', 460);

    const hint = document.createElement('div');
    hint.style.cssText = 'color:#888;font-size:12px;line-height:1.6;margin-bottom:16px;';
    hint.textContent = '这里仅处理当前场景：可以修改场景标题，以及当前场景的最小视野与最大视野。留空表示继承全局视野配置。保存后点击「生成 XML」即可生效。';
    body.appendChild(hint);

    function addField(label, input, help) {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'margin-bottom:14px;';
      const labelEl = document.createElement('div');
      labelEl.style.cssText = 'font-size:12px;color:#b8c0cc;margin-bottom:6px;';
      labelEl.textContent = label;
      wrap.appendChild(labelEl);
      wrap.appendChild(input);
      if (help) {
        const helpEl = document.createElement('div');
        helpEl.style.cssText = 'font-size:11px;color:#666;margin-top:6px;line-height:1.5;';
        helpEl.textContent = help;
        wrap.appendChild(helpEl);
      }
      body.appendChild(wrap);
    }

    function makeInput(value, placeholder, disabled) {
      const input = document.createElement('input');
      input.type = 'text';
      input.value = value || '';
      input.placeholder = placeholder || '';
      input.disabled = !!disabled;
      input.style.cssText = [
        'width:100%',
        'box-sizing:border-box',
        'padding:9px 10px',
        'border-radius:6px',
        'border:1px solid rgba(255,255,255,0.12)',
        'background:' + (disabled ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.06)'),
        'color:' + (disabled ? '#7f8793' : '#fff'),
        'font-size:13px',
        'outline:none'
      ].join(';');
      return input;
    }

    function makeRow() {
      const row = document.createElement('div');
      row.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:10px;';
      return row;
    }

    const filenameInput = makeInput(fn, '', true);
    const sceneIdInput = makeInput(sceneId, '', true);
    const titleInput = makeInput(settings.title || fn, '场景标题');
    const sceneMinInput = makeInput((settings.sceneOverride && settings.sceneOverride.fovmin) || '', '留空表示继承全局');
    const sceneMaxInput = makeInput((settings.sceneOverride && settings.sceneOverride.fovmax) || '', '留空表示继承全局');

    addField('场景文件名', filenameInput);
    addField('场景 ID', sceneIdInput);
    addField('场景标题', titleInput, '此标题会用于场景列表、跳转选择和生成后的 scene title。');

    const sceneSection = document.createElement('div');
    sceneSection.style.cssText = 'margin:0 0 4px;';
    const sceneTitle = document.createElement('div');
    sceneTitle.style.cssText = 'font-size:12px;color:#b8c0cc;margin-bottom:8px;';
    sceneTitle.textContent = '当前场景覆盖';
    sceneSection.appendChild(sceneTitle);
    const sceneRow = makeRow();
    sceneRow.appendChild(sceneMinInput);
    sceneRow.appendChild(sceneMaxInput);
    sceneSection.appendChild(sceneRow);
    const sceneHint = document.createElement('div');
    sceneHint.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:6px;font-size:11px;color:#666;';
    sceneHint.innerHTML = '<div>最小视野 fovmin</div><div>最大视野 fovmax</div>';
    sceneSection.appendChild(sceneHint);
    body.appendChild(sceneSection);

    footer.appendChild(makeBtn('取消', { onClick: () => panel.remove() }));
    footer.appendChild(makeBtn('保存设置', {
      bg: ACCENT,
      hoverBg: '#3A8EEF',
      onClick: async () => {
        const payload = {
          scene: fn,
          title: titleInput.value.trim(),
          sceneFovmin: sceneMinInput.value.trim(),
          sceneFovmax: sceneMaxInput.value.trim(),
        };
        try {
          const res = await api('POST', '/api/scene-settings', payload);
          if (!res.ok) {
            toast('✗ 保存失败: ' + (res.error || '未知错误'), 3000);
            return;
          }
          patchCurrentSceneTitle(kp, fn, titleInput.value.trim() || fn);
          await loadSceneMap();
          panel.remove();
          toast('✓ 场景设置已保存，点击「生成 XML」后刷新页面生效', 4500);
        } catch (e) {
          toast('✗ 保存失败: ' + e.message, 3000);
        }
      },
    }));
  }

  async function showGlobalViewPanel() {
    let settings;
    try {
      settings = await api('GET', '/api/view-defaults');
    } catch (e) {
      toast('✗ 加载全局设置失败: ' + e.message, 3000);
      return;
    }

    const { panel, body, footer } = createPanel('pano-global-view-panel', '全局设置', 460);
    const hint = document.createElement('div');
    hint.style.cssText = 'color:#888;font-size:12px;line-height:1.6;margin-bottom:16px;';
    hint.textContent = '这里设置项目级默认参数。站点总标题会同步写入 tour.html；未单独覆盖的场景会继承这里的默认视野限制。';
    body.appendChild(hint);

    function makeInput(value, placeholder) {
      const input = document.createElement('input');
      input.type = 'text';
      input.value = value || '';
      input.placeholder = placeholder || '';
      input.style.cssText = 'width:100%;box-sizing:border-box;padding:9px 10px;border-radius:6px;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.06);color:#fff;font-size:13px;outline:none;';
      return input;
    }

    const titleLabel = document.createElement('div');
    titleLabel.style.cssText = 'font-size:12px;color:#b8c0cc;margin-bottom:6px;';
    titleLabel.textContent = '站点总标题';
    body.appendChild(titleLabel);

    const siteTitleInput = makeInput(settings.siteTitle || document.title || '', '例如：衢州科技馆');
    siteTitleInput.style.marginBottom = '6px';
    body.appendChild(siteTitleInput);

    const titleHint = document.createElement('div');
    titleHint.style.cssText = 'font-size:11px;color:#666;line-height:1.5;margin-bottom:14px;';
    titleHint.textContent = '用于浏览器标签页标题，并会同步到 vtour / publish 的 tour.html。';
    body.appendChild(titleHint);

    const fovTitle = document.createElement('div');
    fovTitle.style.cssText = 'font-size:12px;color:#b8c0cc;margin-bottom:8px;';
    fovTitle.textContent = '默认视野限制';
    body.appendChild(fovTitle);

    const row = document.createElement('div');
    row.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:10px;';
    const minInput = makeInput(settings.fovmin || '70', '70');
    const maxInput = makeInput(settings.fovmax || '140', '140');
    row.appendChild(minInput);
    row.appendChild(maxInput);
    body.appendChild(row);

    const labels = document.createElement('div');
    labels.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:6px;font-size:11px;color:#666;';
    labels.innerHTML = '<div>最小视野 fovmin</div><div>最大视野 fovmax</div>';
    body.appendChild(labels);

    footer.appendChild(makeBtn('取消', { onClick: () => panel.remove() }));
    footer.appendChild(makeBtn('保存设置', {
      bg: ACCENT,
      hoverBg: '#3A8EEF',
      onClick: async () => {
        try {
          const siteTitle = siteTitleInput.value.trim();
          if (!siteTitle) {
            toast('✗ 站点总标题不能为空', 3000);
            return;
          }
          const res = await api('POST', '/api/view-defaults', {
            siteTitle,
            fovmin: minInput.value.trim(),
            fovmax: maxInput.value.trim(),
          });
          if (!res.ok) {
            toast('✗ 保存失败: ' + (res.error || '未知错误'), 3000);
            return;
          }
          patchDocumentTitle(siteTitle);
          panel.remove();
          toast('✓ 全局设置已保存，站点标题已同步到 tour.html', 4500);
        } catch (e) {
          toast('✗ 保存失败: ' + e.message, 3000);
        }
      },
    }));
  }

  // ── 创建面板容器 ──
  // opts.keepManage: true → 保留管理面板（不关闭 pano-hotspot-panel）
  function createPanel(id, title, width, opts) {
    const keepManage = opts && opts.keepManage;
    if (keepManage) {
      closeEditAddPanels();
    } else {
      closeAllPanels();
    }
    const panel = document.createElement('div');
    panel.id = id;
    Object.assign(panel.style, {
      position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
      background: PANEL_BG, color: '#fff', padding: '0',
      borderRadius: '12px', zIndex: '100002',
      width: '90vw', maxWidth: (width || '420') + 'px',
      maxHeight: '80vh', overflow: 'hidden', display: 'flex', flexDirection: 'column',
      fontFamily: 'system-ui, sans-serif', fontSize: '13px',
      backdropFilter: 'blur(12px)', boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
    });

    // Header
    const header = document.createElement('div');
    Object.assign(header.style, {
      padding: '14px 18px', borderBottom: '1px solid rgba(255,255,255,0.08)',
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      flexShrink: '0',
    });
    const h = document.createElement('div');
    h.style.cssText = 'font-size:15px;font-weight:600;';
    h.textContent = title;
    header.appendChild(h);
    const closeBtn = document.createElement('button');
    closeBtn.innerHTML = '✕';
    closeBtn.style.cssText = 'background:none;border:none;color:#666;font-size:16px;cursor:pointer;padding:2px 6px;border-radius:4px;';
    closeBtn.onmouseenter = () => closeBtn.style.color = '#fff';
    closeBtn.onmouseleave = () => closeBtn.style.color = '#666';
    closeBtn.onclick = () => panel.remove();
    header.appendChild(closeBtn);
    panel.appendChild(header);

    // Body — flex:1 让 footer 始终吸附到底部
    const body = document.createElement('div');
    body.style.cssText = 'padding:16px 18px;overflow-y:auto;flex:1;min-height:0;';
    panel.appendChild(body);

    // Footer — 操作按钮区，固定可见，不随内容滚动
    const footer = document.createElement('div');
    footer.style.cssText = 'padding:12px 18px;border-top:1px solid rgba(255,255,255,0.08);display:flex;gap:10px;justify-content:flex-end;flex-shrink:0;';
    panel.appendChild(footer);

    document.body.appendChild(panel);
    return { panel, body, footer };
  }

  // ── 共用: 样式选择器 ──
  function buildStyleGrid(initialStyleId) {
    let selectedStyle = initialStyleId || HOTSPOT_STYLES[0].id;
    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:18px;';

    function updateSelection() {
      grid.querySelectorAll('[data-style]').forEach(el => {
        const active = el.dataset.style === selectedStyle;
        el.style.border = active ? `2px solid ${ACCENT}` : '2px solid rgba(255,255,255,0.1)';
        el.style.background = active ? 'rgba(74,158,255,0.15)' : 'rgba(255,255,255,0.04)';
      });
    }

    for (const s of HOTSPOT_STYLES) {
      const opt = document.createElement('div');
      opt.dataset.style = s.id;
      Object.assign(opt.style, {
        padding: '6px 8px', borderRadius: '6px', cursor: 'pointer',
        display: 'flex', alignItems: 'center', gap: '8px',
        border: s.id === selectedStyle ? `2px solid ${ACCENT}` : '2px solid rgba(255,255,255,0.1)',
        background: s.id === selectedStyle ? 'rgba(74,158,255,0.15)' : 'rgba(255,255,255,0.04)',
        transition: 'all 0.15s',
      });
      opt.appendChild(makeStylePreview(s.preview, s.fw));
      const textDiv = document.createElement('div');
      textDiv.style.cssText = 'min-width:0;flex:1;';
      textDiv.innerHTML = `<div style="font-size:12px;font-weight:500;">${s.label}</div><div style="font-size:10px;color:#888;">${s.desc}</div>`;
      opt.appendChild(textDiv);
      opt.onclick = () => { selectedStyle = s.id; updateSelection(); };
      grid.appendChild(opt);
    }

    return { grid, getSelected: () => selectedStyle };
  }

  // ══════════════════════════════════════════════════
  //  信息面板：预览覆盖层
  // ══════════════════════════════════════════════════
  function showInfoOverlay(data) {
    const existing = document.getElementById('pano-info-overlay');
    if (existing) existing.remove();

    const backdrop = document.createElement('div');
    backdrop.id = 'pano-info-overlay';
    Object.assign(backdrop.style, {
      position: 'fixed', top: '0', left: '0', right: '0', bottom: '0',
      zIndex: '200000', background: 'rgba(0,0,0,0.65)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    });
    backdrop.onclick = (e) => { if (e.target === backdrop) backdrop.remove(); };
    document.addEventListener('keydown', function escClose(e) {
      if (e.key === 'Escape') { backdrop.remove(); document.removeEventListener('keydown', escClose); }
    });

    const card = document.createElement('div');
    Object.assign(card.style, {
      background: '#fff', color: '#333', borderRadius: '16px',
      width: '92%', maxWidth: '780px', maxHeight: '85vh',
      overflow: 'hidden', display: 'flex', flexDirection: 'column',
      boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
    });

    // 标题栏
    const cardHeader = document.createElement('div');
    cardHeader.style.cssText = 'padding:18px 24px 12px;display:flex;justify-content:space-between;align-items:flex-start;flex-shrink:0;';
    const cardTitle = document.createElement('div');
    cardTitle.style.cssText = 'font-size:18px;font-weight:600;color:#222;line-height:1.3;';
    cardTitle.textContent = data.title || '（无标题）';
    const cardClose = document.createElement('button');
    cardClose.innerHTML = '✕';
    cardClose.style.cssText = 'background:none;border:none;font-size:20px;cursor:pointer;color:#bbb;padding:2px 6px;margin-left:12px;flex-shrink:0;';
    cardClose.onmouseenter = () => cardClose.style.color = '#555';
    cardClose.onmouseleave = () => cardClose.style.color = '#bbb';
    cardClose.onclick = () => backdrop.remove();
    cardHeader.appendChild(cardTitle);
    cardHeader.appendChild(cardClose);
    card.appendChild(cardHeader);

    // 内容区（可滚动）
    const content = document.createElement('div');
    content.style.cssText = 'padding:4px 24px 24px;overflow-y:auto;flex:1;';

    // 音频区（含二维码）
    if (data.audio || data.qrcode) {
      const audioBox = document.createElement('div');
      audioBox.style.cssText = 'background:#f0f6ff;border-radius:10px;padding:14px 18px;margin-bottom:18px;display:flex;gap:16px;align-items:flex-start;';

      // 左侧：标签 + 播放器
      const audioLeft = document.createElement('div');
      audioLeft.style.cssText = 'flex:1;min-width:0;';
      const audioLabel = document.createElement('div');
      audioLabel.style.cssText = 'font-size:14px;font-weight:600;color:#4A9EFF;margin-bottom:10px;';
      audioLabel.textContent = '音频解说';
      audioLeft.appendChild(audioLabel);
      if (data.audio) {
        const audioEl = document.createElement('audio');
        audioEl.controls = true;
        audioEl.src = data.audio;
        audioEl.style.cssText = 'width:100%;outline:none;';
        audioLeft.appendChild(audioEl);
      }
      audioBox.appendChild(audioLeft);

      // 右侧：二维码图片
      if (data.qrcode) {
        const qrWrap = document.createElement('div');
        qrWrap.style.cssText = 'flex-shrink:0;text-align:center;';
        const qrImg = document.createElement('img');
        qrImg.src = data.qrcode;
        qrImg.style.cssText = 'width:80px;height:80px;border-radius:4px;display:block;';
        qrImg.alt = '扫码听讲解';
        qrWrap.appendChild(qrImg);
        const qrTip = document.createElement('div');
        qrTip.style.cssText = 'font-size:10px;color:#999;margin-top:4px;';
        qrTip.textContent = '扫描二维码 听讲解';
        qrWrap.appendChild(qrTip);
        audioBox.appendChild(qrWrap);
      }

      content.appendChild(audioBox);
    }

    // 图片
    if (data.image) {
      const imgWrap = document.createElement('div');
      imgWrap.style.cssText = 'margin-bottom:16px;';
      const imgEl = document.createElement('img');
      imgEl.src = data.image;
      imgEl.style.cssText = 'width:100%;border-radius:8px;display:block;';
      imgEl.alt = data.title || '';
      imgWrap.appendChild(imgEl);
      content.appendChild(imgWrap);
    }

    // 正文
    if (data.text) {
      const textEl = document.createElement('p');
      textEl.style.cssText = 'margin:0;font-size:13px;line-height:1.9;color:#555;white-space:pre-wrap;';
      textEl.textContent = data.text;
      content.appendChild(textEl);
    }

    if (!data.audio && !data.qrcode && !data.image && !data.text) {
      const emptyEl = document.createElement('div');
      emptyEl.style.cssText = 'color:#aaa;text-align:center;padding:24px;font-size:13px;';
      emptyEl.textContent = '（暂无内容）';
      content.appendChild(emptyEl);
    }

    card.appendChild(content);
    backdrop.appendChild(card);
    document.body.appendChild(backdrop);
  }

  // ── 链接弹窗（iframe 打开指定 URL） ──
  function showLinkOverlay(url) {
    if (!url) { toast('未设置链接地址', 2000); return; }
    const existing = document.getElementById('pano-link-overlay');
    if (existing) existing.remove();

    const backdrop = document.createElement('div');
    backdrop.id = 'pano-link-overlay';
    Object.assign(backdrop.style, {
      position: 'fixed', top: '0', left: '0', right: '0', bottom: '0',
      zIndex: '200000', background: 'rgba(0,0,0,0.65)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    });
    backdrop.onclick = (e) => { if (e.target === backdrop) backdrop.remove(); };
    document.addEventListener('keydown', function escClose(e) {
      if (e.key === 'Escape') { backdrop.remove(); document.removeEventListener('keydown', escClose); }
    });

    const card = document.createElement('div');
    Object.assign(card.style, {
      background: '#fff', borderRadius: '12px',
      width: '94%', maxWidth: '1100px', height: '85vh',
      overflow: 'hidden', display: 'flex', flexDirection: 'column',
      boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
    });

    // 顶栏
    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;align-items:center;padding:10px 16px;border-bottom:1px solid #eee;flex-shrink:0;gap:10px;';
    const urlLabel = document.createElement('div');
    urlLabel.style.cssText = 'flex:1;font-size:12px;color:#888;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    urlLabel.textContent = url;
    const openNewBtn = document.createElement('button');
    openNewBtn.textContent = '在新标签页打开';
    openNewBtn.style.cssText = 'background:#4A9EFF;color:#fff;border:none;border-radius:5px;padding:5px 12px;font-size:12px;cursor:pointer;flex-shrink:0;';
    openNewBtn.onclick = () => window.open(url, '_blank');
    const closeBtn = document.createElement('button');
    closeBtn.innerHTML = '✕';
    closeBtn.style.cssText = 'background:none;border:none;font-size:18px;cursor:pointer;color:#aaa;padding:2px 6px;flex-shrink:0;';
    closeBtn.onmouseenter = () => closeBtn.style.color = '#333';
    closeBtn.onmouseleave = () => closeBtn.style.color = '#aaa';
    closeBtn.onclick = () => backdrop.remove();
    bar.appendChild(urlLabel);
    bar.appendChild(openNewBtn);
    bar.appendChild(closeBtn);
    card.appendChild(bar);

    // iframe 容器（含加载状态和错误回退）
    const iframeWrap = document.createElement('div');
    iframeWrap.style.cssText = 'flex:1;position:relative;min-height:0;';

    // 加载/错误回退层
    const fallback = document.createElement('div');
    Object.assign(fallback.style, {
      position: 'absolute', inset: '0', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', background: '#fafafa',
      gap: '16px', zIndex: '1',
    });
    fallback.innerHTML = '<div style="font-size:40px;opacity:0.3;">⏳</div>' +
      '<div style="font-size:14px;color:#888;">正在加载页面...</div>';

    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'width:100%;height:100%;border:none;position:relative;z-index:2;background:#fff;';
    iframe.setAttribute('referrerpolicy', 'no-referrer');
    iframe.src = url;

    // 检测加载结果：成功则隐藏回退层，失败则显示错误提示
    let loaded = false;
    iframe.onload = () => {
      loaded = true;
      fallback.style.display = 'none';
    };
    // 超时后若仍未成功加载，显示错误回退
    setTimeout(() => {
      if (!loaded) {
        fallback.innerHTML =
          '<div style="font-size:48px;opacity:0.25;">🚫</div>' +
          '<div style="font-size:15px;font-weight:500;color:#555;">该网站不允许在嵌入式窗口中显示</div>' +
          '<div style="font-size:12px;color:#999;max-width:360px;text-align:center;line-height:1.6;">部分网站出于安全策略限制了嵌入访问，请点击下方按钮在新标签页中打开。</div>' +
          '<button id="pano-link-fallback-btn" style="margin-top:8px;background:#4A9EFF;color:#fff;border:none;border-radius:6px;padding:10px 28px;font-size:14px;cursor:pointer;">在新标签页中打开</button>';
        const fbBtn = fallback.querySelector('#pano-link-fallback-btn');
        if (fbBtn) fbBtn.onclick = () => window.open(url, '_blank');
        // iframe 加载失败时隐藏它（避免显示浏览器默认错误页面）
        iframe.style.display = 'none';
      }
    }, 4000);

    iframeWrap.appendChild(fallback);
    iframeWrap.appendChild(iframe);
    card.appendChild(iframeWrap);

    backdrop.appendChild(card);
    document.body.appendChild(backdrop);
  }

  function showVideoOverlay(url, titleText) {
    if (!url) {
      window.alert('未设置视频地址');
      return;
    }

    function closeVideoOverlay(backdrop) {
      if (!backdrop) return;
      if (typeof backdrop.__panoCleanup === 'function') {
        backdrop.__panoCleanup();
        backdrop.__panoCleanup = null;
      }
      backdrop.remove();
    }

    const existing = document.getElementById('pano-video-overlay');
    if (existing) closeVideoOverlay(existing);

    const backdrop = document.createElement('div');
    backdrop.id = 'pano-video-overlay';
    Object.assign(backdrop.style, {
      position: 'fixed', inset: '0', zIndex: '200000', background: 'rgba(0,0,0,0.72)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    });
    backdrop.onclick = (e) => { if (e.target === backdrop) closeVideoOverlay(backdrop); };

    const card = document.createElement('div');
    Object.assign(card.style, {
      background: '#111', borderRadius: '12px', width: '94%', maxWidth: '960px',
      maxHeight: '88vh', overflow: 'hidden', display: 'flex', flexDirection: 'column',
      boxShadow: '0 20px 60px rgba(0,0,0,0.55)',
    });

    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;align-items:center;padding:12px 16px;color:#fff;background:#181818;gap:10px;';
    const title = document.createElement('div');
    title.style.cssText = 'flex:1;font-size:15px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    title.textContent = titleText || '视频播放';
    const closeBtn = document.createElement('button');
    closeBtn.innerHTML = '✕';
    closeBtn.style.cssText = 'background:none;border:none;font-size:18px;cursor:pointer;color:#aaa;padding:2px 6px;';
    closeBtn.onclick = () => closeVideoOverlay(backdrop);
    bar.appendChild(title);
    bar.appendChild(closeBtn);
    card.appendChild(bar);

    const body = document.createElement('div');
    body.style.cssText = 'padding:12px;background:#000;';
    const video = document.createElement('video');
    video.controls = true;
    video.autoplay = true;
    video.src = url;
    video.style.cssText = 'width:100%;max-height:72vh;display:block;border-radius:8px;background:#000;';
    body.appendChild(video);
    card.appendChild(body);

    backdrop.appendChild(card);
    document.body.appendChild(backdrop);
    backdrop.__panoCleanup = () => {
      try {
        video.pause();
      } catch { }
      try {
        video.removeAttribute('src');
        video.load();
      } catch { }
    };
  }

  // ── 链接字段组件 ──
  function buildLinkFields(initialUrl) {
    const wrap = document.createElement('div');
    const lbl = document.createElement('div');
    lbl.style.cssText = 'font-weight:600;margin-bottom:8px;';
    lbl.textContent = '链接地址';
    wrap.appendChild(lbl);
    const urlInput = makeInfoInput('https://example.com', initialUrl);
    wrap.appendChild(urlInput);
    const hint = document.createElement('div');
    hint.style.cssText = 'font-size:10px;color:#666;margin-top:4px;';
    hint.textContent = '点击热点将在弹窗中打开此地址（支持 http/https 链接）';
    wrap.appendChild(hint);
    return {
      el: wrap,
      getUrl: () => urlInput.value.trim(),
      setUrl: (v) => { urlInput.value = v || ''; },
    };
  }

  // 通用拖拽上传：封装 dragenter/dragover/dragleave/drop 事件，处理 dragDepth
  // 计数器和高亮样式切换，调用方只需提供 drop 时的文件处理回调。
  // uploader: 要绑定拖拽的 label 元素
  // onFile: drop 时接收文件的异步回调 (file) => Promise<void>
  // baseStyle: uploader 的基础 cssText（用于重置样式）
  function enableDragDrop(uploader, onFile, baseStyle) {
    let dragDepth = 0;
    const setActive = (active) => {
      uploader.style.cssText = baseStyle + (active ? 'border-color:#4A9EFF;background:rgba(74,158,255,0.12);color:#dbe9ff;' : '');
    };
    uploader.addEventListener('dragenter', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragDepth++;
      setActive(true);
    });
    uploader.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    });
    uploader.addEventListener('dragleave', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) setActive(false);
    });
    uploader.addEventListener('drop', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragDepth = 0;
      setActive(false);
      const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) await onFile(file);
    });
  }

  function buildVideoFields(initialData) {
    const data = initialData || {};
    const wrap = document.createElement('div');

    const titleLabel = document.createElement('div');
    titleLabel.style.cssText = 'font-weight:600;margin-bottom:8px;';
    titleLabel.textContent = '视频标题';
    wrap.appendChild(titleLabel);
    const titleInput = makeInfoInput('视频标题', data.title || '');
    wrap.appendChild(titleInput);

    const urlLabel = document.createElement('div');
    urlLabel.style.cssText = 'font-weight:600;margin:14px 0 8px;';
    urlLabel.textContent = '视频地址';
    wrap.appendChild(urlLabel);
    const urlInput = makeInfoInput('assets/video/demo.mp4', data.video || '');
    wrap.appendChild(urlInput);

    const hint = document.createElement('div');
    hint.style.cssText = 'font-size:10px;color:#666;margin-top:4px;line-height:1.6;';
    hint.textContent = '支持填写 mp4/webm 视频地址，也可以上传本地视频文件。';
    wrap.appendChild(hint);

    const uploader = document.createElement('label');
    const uploaderBaseStyle = 'display:flex;align-items:center;gap:8px;margin-top:8px;padding:8px 10px;border:1.5px dashed rgba(255,255,255,0.2);border-radius:6px;cursor:pointer;font-size:12px;color:#888;transition:border-color 0.15s,background 0.15s,color 0.15s;';
    uploader.style.cssText = uploaderBaseStyle;
    uploader.innerHTML = '<span>📹</span><span style="flex:1;">点击选择或拖拽视频到此处</span>';
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'video/mp4,video/webm,.mp4,.webm,.mov,.m4v';
    fileInput.style.display = 'none';
    uploader.appendChild(fileInput);
    wrap.appendChild(uploader);

    const acceptedExt = ['mp4', 'webm', 'mov', 'm4v'];
    const isAcceptedVideo = (file) => {
      if (!file) return false;
      if (file.type && file.type.startsWith('video/')) return true;
      const name = (file.name || '').toLowerCase();
      return acceptedExt.some((ext) => name.endsWith('.' + ext));
    };

    function showVideoRenameDialog(origName) {
      return new Promise((resolve) => {
        const backdrop = document.createElement('div');
        Object.assign(backdrop.style, {
          position: 'fixed', inset: '0', zIndex: '300000',
          background: 'rgba(0,0,0,0.55)', display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          fontFamily: 'system-ui, sans-serif',
        });
        const card = document.createElement('div');
        Object.assign(card.style, {
          background: '#1e1e22', color: '#fff', borderRadius: '12px',
          padding: '24px', width: '92vw', maxWidth: '420px',
          boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
        });
        const title = document.createElement('div');
        title.style.cssText = 'font-size:15px;font-weight:600;margin-bottom:6px;';
        title.textContent = '视频文件名冲突';
        const desc = document.createElement('div');
        desc.style.cssText = 'font-size:12px;color:#aaa;margin-bottom:16px;line-height:1.6;';
        desc.innerHTML = `目标目录已存在同名视频：<br><span style="color:#4A9EFF;word-break:break-all;">${origName}</span>`;
        const input = document.createElement('input');
        input.type = 'text';
        const dotIdx = origName.lastIndexOf('.');
        const baseName = dotIdx > 0 ? origName.substring(0, dotIdx) : origName;
        input.value = origName;
        Object.assign(input.style, {
          width: '100%', boxSizing: 'border-box', padding: '8px 10px',
          background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)',
          borderRadius: '6px', color: '#fff', fontSize: '13px', outline: 'none',
        });
        input.onfocus = () => input.setSelectionRange(0, baseName.length);
        const btnRow = document.createElement('div');
        btnRow.style.cssText = 'display:flex;gap:10px;justify-content:flex-end;margin-top:16px;';
        const btnCancel = document.createElement('button');
        btnCancel.textContent = '取消';
        btnCancel.style.cssText = 'padding:6px 16px;border:1px solid rgba(255,255,255,0.15);border-radius:5px;background:transparent;color:#aaa;font-size:13px;cursor:pointer;';
        const btnOverwrite = document.createElement('button');
        btnOverwrite.textContent = '覆盖原文件';
        btnOverwrite.style.cssText = 'padding:6px 16px;border:none;border-radius:5px;background:#e8654a;color:#fff;font-size:13px;cursor:pointer;';
        const btnRename = document.createElement('button');
        btnRename.textContent = '重命名上传';
        btnRename.style.cssText = 'padding:6px 16px;border:none;border-radius:5px;background:#4A9EFF;color:#fff;font-size:13px;cursor:pointer;';
        btnCancel.onclick = () => { backdrop.remove(); resolve({ action: 'cancel' }); };
        btnOverwrite.onclick = () => { backdrop.remove(); resolve({ action: 'overwrite' }); };
        btnRename.onclick = () => {
          const newName = input.value.trim();
          if (!newName) {
            input.style.borderColor = '#e8654a';
            return;
          }
          backdrop.remove();
          resolve({ action: 'rename', newName });
        };
        input.onkeydown = (e) => { if (e.key === 'Enter') btnRename.click(); };
        btnRow.appendChild(btnCancel);
        btnRow.appendChild(btnOverwrite);
        btnRow.appendChild(btnRename);
        card.appendChild(title);
        card.appendChild(desc);
        card.appendChild(input);
        card.appendChild(btnRow);
        backdrop.appendChild(card);
        document.body.appendChild(backdrop);
        setTimeout(() => input.focus(), 50);
      });
    }

    function getConflictInfo(error, fallbackName) {
      if (error && error.conflict) {
        return { filename: error.filename || fallbackName };
      }
      const message = error && error.message ? String(error.message) : String(error || '');
      try {
        const parsed = JSON.parse(message);
        if (parsed && parsed.error === 'conflict') {
          return { filename: parsed.filename || fallbackName };
        }
      } catch { }
      return null;
    }

    async function doUpload(file, customName, overwrite) {
      if (!file) return;
      try {
        const nameToUse = customName || file.name;
        if (!/\.(mp4|webm|mov|m4v)$/i.test((nameToUse || '').toLowerCase())) {
          throw new Error(`不支持的格式: ${nameToUse}`);
        }
        const buf = await file.arrayBuffer();
        const headers = { 'X-Filename': encodeURIComponent(nameToUse) };
        if (overwrite) headers['X-Overwrite'] = '1';
        const resp = await fetch('/api/upload-asset', {
          method: 'POST',
          headers,
          body: buf,
        });
        if (resp.status === 409) {
          const info = await resp.json();
          throw Object.assign(new Error('conflict'), { conflict: true, filename: info.filename || nameToUse });
        }
        if (!resp.ok) {
          const text = await resp.text();
          throw new Error(text || '上传失败');
        }
        const json = await resp.json();
        urlInput.value = json.url || '';
        toast(`✓ 已上传视频: ${customName || file.name}`);
      } catch (e) {
        const conflict = getConflictInfo(e, customName || file.name);
        if (conflict) {
          const result = await showVideoRenameDialog(conflict.filename);
          if (result.action === 'overwrite') {
            return doUpload(file, customName, true);
          }
          if (result.action === 'rename') {
            return doUpload(file, result.newName, false);
          }
          return;
        }
        toast('✗ 视频上传失败: ' + e.message, 3000);
      }
    }

    fileInput.onchange = async () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;
      try {
        await doUpload(file, file.name, false);
      } finally {
        fileInput.value = '';
      }
    };

    enableDragDrop(uploader, async (file) => {
      if (!isAcceptedVideo(file)) {
        toast('✗ 仅支持 mp4 / webm / mov / m4v 视频', 3000);
        return;
      }
      await doUpload(file, file.name, false);
    }, uploaderBaseStyle);

    return {
      el: wrap,
      getData: () => ({ title: titleInput.value.trim(), video: urlInput.value.trim() }),
      setData: (v) => {
        titleInput.value = (v && v.title) || '';
        urlInput.value = (v && v.video) || '';
      },
    };
  }

  function makeMiniField(labelText, inputEl) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'margin-bottom:12px;';
    const label = document.createElement('div');
    label.style.cssText = 'font-size:11px;color:#888;margin-bottom:4px;font-weight:500;';
    label.textContent = labelText;
    wrap.appendChild(label);
    wrap.appendChild(inputEl);
    return wrap;
  }

  function makeCheckboxField(labelText, checked) {
    const label = document.createElement('label');
    label.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:12px;color:#ddd;cursor:pointer;user-select:none;';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = !!checked;
    input.style.cssText = 'width:16px;height:16px;accent-color:#4A9EFF;';
    const text = document.createElement('span');
    text.textContent = labelText;
    label.appendChild(input);
    label.appendChild(text);
    return { el: label, input };
  }

  function buildGreenScreenFields(initialData) {
    const data = initialData || {};
    const wrap = document.createElement('div');

    function collectData() {
      return {
        title: titleInput.value.trim(),
        video: urlInput.value.trim(),
        width: widthInput.value.trim(),
        keyColor: keyColorInput.value.trim(),
        threshold: thresholdInput.value.trim(),
        feather: featherInput.value.trim(),
        chromaKey: chroma.input.checked,
        muted: muted.input.checked,
        loop: loop.input.checked,
        shadow: shadow.input.checked,
      };
    }

    const titleInput = makeInfoInput('讲解员名称', data.title || '');
    wrap.appendChild(makeMiniField('标题', titleInput));

    const urlInput = makeInfoInput('assets/video/digital-guide.webm', data.video || '');
    wrap.appendChild(makeMiniField('视频地址', urlInput));

    const uploader = document.createElement('label');
    const uploaderBaseStyle = 'display:flex;align-items:center;gap:8px;margin-top:-4px;margin-bottom:12px;padding:8px 10px;border:1.5px dashed rgba(255,255,255,0.2);border-radius:6px;cursor:pointer;font-size:12px;color:#888;transition:border-color 0.15s,background 0.15s,color 0.15s;';
    uploader.style.cssText = uploaderBaseStyle;
    const uploaderText = document.createElement('span');
    uploaderText.style.cssText = 'flex:1;';
    uploaderText.textContent = '点击选择或拖拽绿幕视频到此处';
    const uploaderIcon = document.createElement('span');
    uploaderIcon.textContent = '🎞️';
    uploader.appendChild(uploaderIcon);
    uploader.appendChild(uploaderText);
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'video/mp4,video/webm,.mp4,.webm,.mov,.m4v';
    fileInput.style.display = 'none';
    uploader.appendChild(fileInput);
    wrap.appendChild(uploader);

    const acceptedExt = ['mp4', 'webm', 'mov', 'm4v'];
    const isAcceptedVideo = (file) => {
      if (!file) return false;
      if (file.type && file.type.startsWith('video/')) return true;
      const name = (file.name || '').toLowerCase();
      return acceptedExt.some((ext) => name.endsWith('.' + ext));
    };

    function getConflictInfo(error, fallbackName) {
      if (error && error.conflict) {
        return { filename: error.filename || fallbackName };
      }
      const message = error && error.message ? String(error.message) : String(error || '');
      try {
        const parsed = JSON.parse(message);
        if (parsed && parsed.error === 'conflict') {
          return { filename: parsed.filename || fallbackName };
        }
      } catch { }
      return null;
    }

    function showVideoRenameDialog(origName) {
      return new Promise((resolve) => {
        const backdrop = document.createElement('div');
        Object.assign(backdrop.style, {
          position: 'fixed', inset: '0', zIndex: '300000',
          background: 'rgba(0,0,0,0.55)', display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          fontFamily: 'system-ui, sans-serif',
        });
        const card = document.createElement('div');
        Object.assign(card.style, {
          background: '#1e1e22', color: '#fff', borderRadius: '12px',
          padding: '24px', width: '92vw', maxWidth: '420px',
          boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
        });
        const title = document.createElement('div');
        title.style.cssText = 'font-size:15px;font-weight:600;margin-bottom:6px;';
        title.textContent = '视频文件名冲突';
        const desc = document.createElement('div');
        desc.style.cssText = 'font-size:12px;color:#aaa;margin-bottom:16px;line-height:1.6;';
        desc.innerHTML = `目标目录已存在同名视频：<br><span style="color:#4A9EFF;word-break:break-all;">${origName}</span>`;
        const input = document.createElement('input');
        input.type = 'text';
        const dotIdx = origName.lastIndexOf('.');
        const baseName = dotIdx > 0 ? origName.substring(0, dotIdx) : origName;
        input.value = origName;
        Object.assign(input.style, {
          width: '100%', boxSizing: 'border-box', padding: '8px 10px',
          background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)',
          borderRadius: '6px', color: '#fff', fontSize: '13px', outline: 'none',
        });
        input.onfocus = () => input.setSelectionRange(0, baseName.length);
        const btnRow = document.createElement('div');
        btnRow.style.cssText = 'display:flex;gap:10px;justify-content:flex-end;margin-top:16px;';
        const btnCancel = document.createElement('button');
        btnCancel.textContent = '取消';
        btnCancel.style.cssText = 'padding:6px 16px;border:1px solid rgba(255,255,255,0.15);border-radius:5px;background:transparent;color:#aaa;font-size:13px;cursor:pointer;';
        const btnOverwrite = document.createElement('button');
        btnOverwrite.textContent = '覆盖原文件';
        btnOverwrite.style.cssText = 'padding:6px 16px;border:none;border-radius:5px;background:#e8654a;color:#fff;font-size:13px;cursor:pointer;';
        const btnRename = document.createElement('button');
        btnRename.textContent = '重命名上传';
        btnRename.style.cssText = 'padding:6px 16px;border:none;border-radius:5px;background:#4A9EFF;color:#fff;font-size:13px;cursor:pointer;';
        btnCancel.onclick = () => { backdrop.remove(); resolve({ action: 'cancel' }); };
        btnOverwrite.onclick = () => { backdrop.remove(); resolve({ action: 'overwrite' }); };
        btnRename.onclick = () => {
          const newName = input.value.trim();
          if (!newName) {
            input.style.borderColor = '#e8654a';
            return;
          }
          backdrop.remove();
          resolve({ action: 'rename', newName });
        };
        input.onkeydown = (e) => { if (e.key === 'Enter') btnRename.click(); };
        btnRow.appendChild(btnCancel);
        btnRow.appendChild(btnOverwrite);
        btnRow.appendChild(btnRename);
        card.appendChild(title);
        card.appendChild(desc);
        card.appendChild(input);
        card.appendChild(btnRow);
        backdrop.appendChild(card);
        document.body.appendChild(backdrop);
        setTimeout(() => input.focus(), 50);
      });
    }

    async function uploadGreenScreenVideo(file, customName, overwrite) {
      if (!file) return;
      if (!isAcceptedVideo(file)) {
        toast('✗ 仅支持 mp4 / webm / mov / m4v 视频', 3000);
        return;
      }
      const originalLabel = uploaderText.textContent;
      const uploadName = customName || file.name;
      uploaderText.textContent = `上传中：${uploadName}…`;
      try {
        const buf = await file.arrayBuffer();
        const headers = { 'X-Filename': encodeURIComponent(uploadName) };
        if (overwrite) headers['X-Overwrite'] = '1';
        const resp = await fetch('/api/upload-asset', {
          method: 'POST',
          headers,
          body: buf,
        });
        if (resp.status === 409) {
          const info = await resp.json();
          const result = await showVideoRenameDialog(info.filename || uploadName);
          if (result.action === 'overwrite') {
            return uploadGreenScreenVideo(file, uploadName, true);
          }
          if (result.action === 'rename') {
            return uploadGreenScreenVideo(file, result.newName, false);
          }
          return;
        }
        const json = await resp.json();
        if (!resp.ok) throw new Error(json.error || '上传失败');
        urlInput.value = json.url || '';
        urlInput.dispatchEvent(new Event('input', { bubbles: true }));
        toast(`✓ 已上传绿幕视频: ${uploadName}`);
      } catch (e) {
        const conflict = getConflictInfo(e, uploadName);
        if (conflict) {
          const result = await showVideoRenameDialog(conflict.filename);
          if (result.action === 'overwrite') {
            return uploadGreenScreenVideo(file, uploadName, true);
          }
          if (result.action === 'rename') {
            return uploadGreenScreenVideo(file, result.newName, false);
          }
          return;
        }
        toast('✗ 绿幕视频上传失败: ' + e.message, 3000);
      } finally {
        uploaderText.textContent = originalLabel;
      }
    }

    fileInput.onchange = async () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;
      try { await uploadGreenScreenVideo(file); } finally { fileInput.value = ''; }
    };

    enableDragDrop(uploader, (file) => uploadGreenScreenVideo(file), uploaderBaseStyle);

    const widthInput = makeInfoInput('12', data.width === undefined ? '12' : String(data.width));
    wrap.appendChild(makeMiniField('场景宽度（度）', widthInput));

    const widthHint = document.createElement('div');
    widthHint.style.cssText = 'font-size:10px;color:#666;margin-top:-8px;margin-bottom:12px;line-height:1.6;';
    widthHint.textContent = '用全景角度控制人物占地宽度，视野缩放时会自然跟随变大/变小。';
    wrap.appendChild(widthHint);

    const keyColorInput = makeInfoInput('#00ff00', data.keyColor || '#00ff00');
    wrap.appendChild(makeMiniField('抠像颜色', keyColorInput));

    const thresholdInput = makeInfoInput('0.694', data.threshold === undefined ? '0.694' : String(data.threshold));
    wrap.appendChild(makeMiniField('抠像阈值', thresholdInput));

    const featherInput = makeInfoInput('0.233', data.feather === undefined ? '0.233' : String(data.feather));
    wrap.appendChild(makeMiniField('边缘柔化', featherInput));

    const chroma = makeCheckboxField('自动去除绿幕背景', data.chromaKey !== false);
    const muted = makeCheckboxField('默认静音自动播放（推荐）', data.muted !== false);
    const loop = makeCheckboxField('循环播放', data.loop !== false);
    const shadow = makeCheckboxField('添加地面投影感阴影', data.shadow !== false);

    const optsRow = document.createElement('div');
    optsRow.style.cssText = 'display:flex;flex-direction:column;gap:10px;margin:6px 0 10px;';
    optsRow.appendChild(chroma.el);
    optsRow.appendChild(muted.el);
    optsRow.appendChild(loop.el);
    optsRow.appendChild(shadow.el);
    wrap.appendChild(optsRow);

    const hint = document.createElement('div');
    hint.style.cssText = 'font-size:10px;color:#666;line-height:1.7;';
    hint.textContent = '适合数字讲解员。热点坐标会作为人物脚底锚点；若视频已带透明通道，可关闭“自动去除绿幕背景”。';
    wrap.appendChild(hint);

    return {
      el: wrap,
      getData: collectData,
      setData: (v) => {
        const next = v || {};
        titleInput.value = next.title || '';
        urlInput.value = next.video || '';
        widthInput.value = next.width === undefined ? '12' : String(next.width);
        keyColorInput.value = next.keyColor || '#00ff00';
        thresholdInput.value = next.threshold === undefined ? '0.694' : String(next.threshold);
        featherInput.value = next.feather === undefined ? '0.233' : String(next.feather);
        chroma.input.checked = next.chromaKey !== false;
        muted.input.checked = next.muted !== false;
        loop.input.checked = next.loop !== false;
        shadow.input.checked = next.shadow !== false;
      },
      onLiveChange: (handler) => {
        let timer = null;
        const schedule = () => {
          clearTimeout(timer);
          timer = setTimeout(() => handler(collectData()), 120);
        };
        const controls = Array.from(wrap.querySelectorAll('input'));
        controls.forEach((control) => {
          control.addEventListener('input', schedule);
          control.addEventListener('change', schedule);
        });
        return () => {
          clearTimeout(timer);
          controls.forEach((control) => {
            control.removeEventListener('input', schedule);
            control.removeEventListener('change', schedule);
          });
        };
      },
    };
  }

  // ── 热点类型选择器（支持多类型扩展） ──
  const HOTSPOT_TYPES = [
    { id: 'nav', icon: '🔗', label: '跳转场景', desc: '点击跳转到目标场景' },
    { id: 'info', icon: '📖', label: '信息面板', desc: '弹出展项详情（图文/音频）' },
    { id: 'link', icon: '🌐', label: '打开链接', desc: '弹窗打开指定网页' },
    { id: 'video', icon: '🎬', label: '播放视频', desc: '点击热点弹窗播放视频' },
    { id: 'greenscreen', icon: '🧍', label: '绿幕讲解', desc: '在场景里放置数字讲解员视频' },
  ];

  function buildTypeTab(initialType) {
    let selectedType = initialType || 'nav';
    const _listeners = [];

    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;gap:0;margin-bottom:18px;border:1px solid rgba(255,255,255,0.15);border-radius:7px;overflow:hidden;';

    const elems = [];
    function updateTabs() {
      elems.forEach(({ id, el }) => {
        el.style.background = (id === selectedType) ? ACCENT : 'transparent';
        el.style.color = (id === selectedType) ? '#fff' : '#888';
      });
    }

    HOTSPOT_TYPES.forEach(({ id, icon, label }) => {
      const btn = document.createElement('button');
      btn.textContent = `${icon}  ${label}`;
      btn.title = HOTSPOT_TYPES.find(t => t.id === id).desc;
      btn.style.cssText = 'flex:1;padding:8px 4px;border:none;font-size:12px;cursor:pointer;transition:all 0.15s;';
      btn.onclick = () => {
        if (selectedType === id) return;
        selectedType = id;
        updateTabs();
        _listeners.forEach(fn => fn(id));
      };
      wrap.appendChild(btn);
      elems.push({ id, el: btn });
    });
    updateTabs();

    return {
      wrap,
      getType: () => selectedType,
      onTypeChange: (fn) => { _listeners.push(fn); },
    };
  }

  // ── 信息面板内容字段 ──
  function makeInfoInput(placeholder, value, multiline) {
    const el = multiline ? document.createElement('textarea') : document.createElement('input');
    if (!multiline) el.type = 'text';
    el.placeholder = placeholder;
    el.value = value || '';
    Object.assign(el.style, {
      width: '100%', boxSizing: 'border-box', padding: '7px 10px',
      background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)',
      borderRadius: '6px', color: '#fff', fontSize: '13px', outline: 'none',
      resize: multiline ? 'vertical' : 'none',
      minHeight: multiline ? '70px' : 'auto',
      fontFamily: 'system-ui, sans-serif',
    });
    el.onfocus = () => el.style.borderColor = ACCENT;
    el.onblur = () => el.style.borderColor = 'rgba(255,255,255,0.15)';
    return el;
  }

  function buildInfoFields(initialData) {
    const d = initialData || {};
    const wrap = document.createElement('div');

    function addField(label, input) {
      const row = document.createElement('div');
      row.style.cssText = 'margin-bottom:12px;';
      const lbl = document.createElement('div');
      lbl.style.cssText = 'font-size:11px;color:#888;margin-bottom:4px;font-weight:500;';
      lbl.textContent = label;
      row.appendChild(lbl);
      row.appendChild(input);
      wrap.appendChild(row);
    }

    // 通用上传函数（返回 Promise<relUrl>）
    // overwrite: 是否强制覆盖同名文件
    async function uploadFile(file, acceptRe, customName, overwrite) {
      if (!acceptRe.test(file.name.toLowerCase())) {
        throw new Error(`不支持的格式: ${file.name}`);
      }
      const buf = await file.arrayBuffer();
      const headers = { 'X-Filename': encodeURIComponent(customName || file.name) };
      if (overwrite) headers['X-Overwrite'] = '1';
      const resp = await fetch('/api/upload-asset', {
        method: 'POST',
        headers,
        body: buf,
      });
      if (resp.status === 409) {
        const info = await resp.json();
        throw Object.assign(new Error('conflict'), { conflict: true, filename: info.filename });
      }
      if (!resp.ok) {
        const t = await resp.text();
        throw new Error(t);
      }
      const json = await resp.json();
      return json.url;
    }

    // 文件名冲突时弹出重命名对话框
    function showRenameDialog(origName) {
      return new Promise((resolve) => {
        const backdrop = document.createElement('div');
        Object.assign(backdrop.style, {
          position: 'fixed', inset: '0', zIndex: '300000',
          background: 'rgba(0,0,0,0.55)', display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          fontFamily: 'system-ui, sans-serif',
        });
        const card = document.createElement('div');
        Object.assign(card.style, {
          background: '#1e1e22', color: '#fff', borderRadius: '12px',
          padding: '24px', width: '92vw', maxWidth: '420px',
          boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
        });
        const title = document.createElement('div');
        title.style.cssText = 'font-size:15px;font-weight:600;margin-bottom:6px;';
        title.textContent = '文件名冲突';
        const desc = document.createElement('div');
        desc.style.cssText = 'font-size:12px;color:#aaa;margin-bottom:16px;line-height:1.6;';
        desc.innerHTML = `目标目录已存在同名文件：<br><span style="color:#4A9EFF;word-break:break-all;">${origName}</span>`;
        const input = document.createElement('input');
        input.type = 'text';
        // 提取文件名（不含扩展名）和扩展名
        const dotIdx = origName.lastIndexOf('.');
        const baseName = dotIdx > 0 ? origName.substring(0, dotIdx) : origName;
        const extName = dotIdx > 0 ? origName.substring(dotIdx) : '';
        input.value = origName;
        Object.assign(input.style, {
          width: '100%', boxSizing: 'border-box', padding: '8px 10px',
          background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)',
          borderRadius: '6px', color: '#fff', fontSize: '13px', outline: 'none',
        });
        input.onfocus = () => input.setSelectionRange(0, baseName.length);
        const btnRow = document.createElement('div');
        btnRow.style.cssText = 'display:flex;gap:10px;justify-content:flex-end;margin-top:16px;';
        const btnCancel = document.createElement('button');
        btnCancel.textContent = '取消';
        btnCancel.style.cssText = 'padding:6px 16px;border:1px solid rgba(255,255,255,0.15);border-radius:5px;background:transparent;color:#aaa;font-size:13px;cursor:pointer;';
        const btnOverwrite = document.createElement('button');
        btnOverwrite.textContent = '覆盖原文件';
        btnOverwrite.style.cssText = 'padding:6px 16px;border:none;border-radius:5px;background:#e8654a;color:#fff;font-size:13px;cursor:pointer;';
        const btnRename = document.createElement('button');
        btnRename.textContent = '重命名上传';
        btnRename.style.cssText = 'padding:6px 16px;border:none;border-radius:5px;background:#4A9EFF;color:#fff;font-size:13px;cursor:pointer;';
        btnCancel.onclick = () => { backdrop.remove(); resolve({ action: 'cancel' }); };
        btnOverwrite.onclick = () => { backdrop.remove(); resolve({ action: 'overwrite' }); };
        btnRename.onclick = () => {
          const newName = input.value.trim();
          if (!newName) { input.style.borderColor = '#e8654a'; return; }
          backdrop.remove();
          resolve({ action: 'rename', newName });
        };
        input.onkeydown = (e) => { if (e.key === 'Enter') btnRename.click(); };
        btnRow.appendChild(btnCancel);
        btnRow.appendChild(btnOverwrite);
        btnRow.appendChild(btnRename);
        card.appendChild(title);
        card.appendChild(desc);
        card.appendChild(input);
        card.appendChild(btnRow);
        backdrop.appendChild(card);
        document.body.appendChild(backdrop);
        setTimeout(() => input.focus(), 50);
      });
    }

    function getConflictInfo(error, fallbackName) {
      if (error && error.conflict) {
        return { filename: error.filename || fallbackName };
      }
      const message = error && error.message ? String(error.message) : String(error || '');
      try {
        const parsed = JSON.parse(message);
        if (parsed && parsed.error === 'conflict') {
          return { filename: parsed.filename || fallbackName };
        }
      } catch { }
      return null;
    }

    // 带拖拽+点击上传的字段组件
    function makeUploadField(placeholder, initialValue, acceptAttr, acceptRe, hint) {
      const container = document.createElement('div');

      // URL 文本输入
      const urlInput = makeInfoInput(placeholder, initialValue);

      // 拖拽区域 / 点击上传按钮
      const dropZone = document.createElement('div');
      Object.assign(dropZone.style, {
        marginTop: '5px', padding: '7px 10px',
        border: '1.5px dashed rgba(255,255,255,0.2)', borderRadius: '6px',
        display: 'flex', alignItems: 'center', gap: '8px',
        cursor: 'pointer', transition: 'border-color 0.15s, background 0.15s',
        fontSize: '12px', color: '#888',
      });

      const dropIcon = document.createElement('span');
      dropIcon.textContent = '📎';

      const dropLabel = document.createElement('span');
      dropLabel.style.cssText = 'flex:1;';
      dropLabel.textContent = `拖拽本地${hint}到此，或点击选择文件`;

      const statusSpan = document.createElement('span');
      statusSpan.style.cssText = 'font-size:11px;color:#4AFF9F;display:none;';
      statusSpan.textContent = '上传中…';

      dropZone.appendChild(dropIcon);
      dropZone.appendChild(dropLabel);
      dropZone.appendChild(statusSpan);

      // 隐藏的 file input（用于点击选择）
      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = acceptAttr;
      fileInput.style.display = 'none';

      async function doUpload(file, customName, overwrite) {
        dropLabel.style.display = 'none';
        statusSpan.style.display = '';
        dropZone.style.pointerEvents = 'none';
        try {
          const url = await uploadFile(file, acceptRe, customName, overwrite);
          urlInput.value = url;
          const displayName = customName || file.name;
          toast(`✓ 已上传: ${displayName}`);
          dropLabel.textContent = `✓ ${displayName}`;
        } catch (e) {
          const conflict = getConflictInfo(e, customName || file.name);
          if (conflict) {
            // 文件名冲突 — 弹出重命名对话框
            statusSpan.style.display = 'none';
            dropLabel.style.display = '';
            dropZone.style.pointerEvents = '';
            const result = await showRenameDialog(conflict.filename);
            if (result.action === 'overwrite') {
              return doUpload(file, customName, true);
            } else if (result.action === 'rename') {
              return doUpload(file, result.newName, false);
            }
            // cancel — 不做任何操作
            dropLabel.textContent = `拖拽本地${hint}到此，或点击选择文件`;
            return;
          }
          toast(`✗ 上传失败: ${e.message}`, 3000);
        } finally {
          statusSpan.style.display = 'none';
          dropLabel.style.display = '';
          dropZone.style.pointerEvents = '';
        }
      }

      fileInput.onchange = () => { if (fileInput.files[0]) doUpload(fileInput.files[0]); };
      dropZone.onclick = () => fileInput.click();
      dropZone.onmouseenter = () => { dropZone.style.borderColor = ACCENT; dropZone.style.background = 'rgba(74,158,255,0.08)'; };
      dropZone.onmouseleave = () => { dropZone.style.borderColor = 'rgba(255,255,255,0.2)'; dropZone.style.background = ''; };

      dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.style.borderColor = '#4AFF9F';
        dropZone.style.background = 'rgba(74,255,159,0.08)';
      });
      dropZone.addEventListener('dragleave', (e) => {
        e.stopPropagation();
        dropZone.style.borderColor = 'rgba(255,255,255,0.2)';
        dropZone.style.background = '';
      });
      dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.style.borderColor = 'rgba(255,255,255,0.2)';
        dropZone.style.background = '';
        const file = e.dataTransfer && e.dataTransfer.files[0];
        if (file) doUpload(file);
      });

      container.appendChild(urlInput);
      container.appendChild(dropZone);
      container.appendChild(fileInput);

      container._input = urlInput;
      return container;
    }

    const titleInput = makeInfoInput('展项名称', d.title);
    const textInput = makeInfoInput('展项简介（支持换行）', d.text, true);
    const imageWrap = makeUploadField('图片路径或 URL', d.image, 'image/jpeg,image/png,image/gif,image/webp,image/svg+xml', /\.(jpe?g|png|gif|webp|svg)$/, '图片');
    const audioWrap = makeUploadField('音频路径或 URL（可选）', d.audio, 'audio/mpeg,audio/wav,audio/ogg,audio/aac,audio/mp4', /\.(mp3|wav|ogg|aac|m4a)$/, '音频');
    const qrcodeWrap = makeUploadField('二维码图片路径或 URL（可选）', d.qrcode, 'image/jpeg,image/png,image/gif,image/webp,image/svg+xml', /\.(jpe?g|png|gif|webp|svg)$/, '二维码图片');

    addField('标题', titleInput);
    addField('正文描述', textInput);
    addField('图片', imageWrap);
    addField('音频（可选）', audioWrap);
    addField('语音讲解二维码（可选）', qrcodeWrap);

    return {
      el: wrap,
      getData: () => ({
        title: titleInput.value.trim(),
        text: textInput.value.trim(),
        image: imageWrap._input.value.trim(),
        audio: audioWrap._input.value.trim(),
        qrcode: qrcodeWrap._input.value.trim(),
      }),
      setData: (d2) => {
        if (d2.title !== undefined) titleInput.value = d2.title;
        if (d2.text !== undefined) textInput.value = d2.text;
        if (d2.image !== undefined) imageWrap._input.value = d2.image;
        if (d2.audio !== undefined) audioWrap._input.value = d2.audio;
        if (d2.qrcode !== undefined) qrcodeWrap._input.value = d2.qrcode;
      },
    };
  }

  // ══════════════════════════════════════════════════
  //  添加热点面板
  // ══════════════════════════════════════════════════
  function showAddHotspotPanel(kp, ath, atv) {
    const fn = currentSceneFilename(kp);
    const { panel, body, footer } = createPanel('pano-add-panel', `添加热点 — ${fn}`, 540);

    // 坐标显示
    const coordDiv = document.createElement('div');
    coordDiv.style.cssText = 'margin-bottom:16px;color:#9aa;font-size:12px;';
    coordDiv.textContent = `位置: ath = ${ath}  atv = ${atv}`;
    body.appendChild(coordDiv);

    // ── 热点类型 Tab ──
    const { wrap: typeWrap, getType, onTypeChange } = buildTypeTab('nav');
    body.appendChild(typeWrap);

    // ── 选择热点图标 ──
    const styleLabel = document.createElement('div');
    styleLabel.style.cssText = 'font-weight:600;margin-bottom:8px;';
    styleLabel.textContent = '热点图标';
    body.appendChild(styleLabel);

    const { grid: styleGrid, getSelected: getSelectedStyle } = buildStyleGrid(HOTSPOT_STYLES[0].id);
    body.appendChild(styleGrid);

    // ── Section: 跳转场景 ──
    const navSection = document.createElement('div');

    const sceneLabel = document.createElement('div');
    sceneLabel.style.cssText = 'font-weight:600;margin-bottom:8px;';
    sceneLabel.textContent = '链接到场景（点击热点将跳转到此场景）';
    navSection.appendChild(sceneLabel);

    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.placeholder = '搜索场景…';
    Object.assign(searchInput.style, {
      width: '100%', boxSizing: 'border-box', padding: '8px 10px',
      background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)',
      borderRadius: '6px', color: '#fff', fontSize: '13px', marginBottom: '8px',
      outline: 'none',
    });
    searchInput.onfocus = () => searchInput.style.borderColor = ACCENT;
    searchInput.onblur = () => searchInput.style.borderColor = 'rgba(255,255,255,0.15)';
    navSection.appendChild(searchInput);

    let selectedSceneId = '';
    const sceneListDiv = document.createElement('div');
    sceneListDiv.style.cssText = 'max-height:200px;overflow-y:auto;border:1px solid rgba(255,255,255,0.1);border-radius:6px;margin-bottom:18px;';

    function renderSceneList(filter) {
      sceneListDiv.innerHTML = '';
      const noneOpt = document.createElement('div');
      noneOpt.style.cssText = `padding:7px 10px;cursor:pointer;border-bottom:1px solid rgba(255,255,255,0.05);color:#888;${selectedSceneId === '' ? 'background:rgba(74,158,255,0.15);color:#fff;' : ''}`;
      noneOpt.textContent = '（不链接场景）';
      noneOpt.onclick = () => { selectedSceneId = ''; renderSceneList(filter); };
      sceneListDiv.appendChild(noneOpt);

      let currentGroup = '';
      for (const s of sceneList) {
        const matchText = `${s.filename} ${s.title} ${s.group}`.toLowerCase();
        if (filter && !matchText.includes(filter.toLowerCase())) continue;

        if (s.group !== currentGroup) {
          currentGroup = s.group;
          const groupHeader = document.createElement('div');
          groupHeader.style.cssText = 'padding:5px 10px;font-size:11px;color:#666;background:rgba(255,255,255,0.03);font-weight:600;';
          groupHeader.textContent = `【${currentGroup}】`;
          sceneListDiv.appendChild(groupHeader);
        }

        const row = document.createElement('div');
        const isSelected = selectedSceneId === s.sceneId;
        Object.assign(row.style, {
          padding: '6px 10px', cursor: 'pointer',
          borderBottom: '1px solid rgba(255,255,255,0.04)',
          background: isSelected ? 'rgba(74,158,255,0.15)' : 'transparent',
          transition: 'background 0.1s',
        });
        row.innerHTML = `<span>${s.title || s.filename}</span> <span style="font-size:11px;color:#666;">${s.filename}</span>`;
        row.onmouseenter = () => { if (!isSelected) row.style.background = 'rgba(255,255,255,0.06)'; };
        row.onmouseleave = () => { if (!isSelected) row.style.background = 'transparent'; };
        row.onclick = () => { selectedSceneId = s.sceneId; renderSceneList(filter); };
        sceneListDiv.appendChild(row);
      }
    }

    renderSceneList('');
    searchInput.oninput = () => renderSceneList(searchInput.value);
    const addSceneListRefresh = () => renderSceneList(searchInput.value);
    document.addEventListener('pano-scene-list-updated', addSceneListRefresh);
    bindPanelCleanup(panel, () => document.removeEventListener('pano-scene-list-updated', addSceneListRefresh));
    navSection.appendChild(sceneListDiv);
    body.appendChild(navSection);

    // ── Section: 信息面板字段（默认隐藏）──
    const { el: infoEl, getData: getInfoData } = buildInfoFields();
    infoEl.style.display = 'none';
    body.appendChild(infoEl);

    // ── Section: 链接字段（默认隐藏）──
    const { el: linkEl, getUrl: getLinkUrl } = buildLinkFields();
    linkEl.style.display = 'none';
    body.appendChild(linkEl);

    const { el: videoEl, getData: getVideoData } = buildVideoFields();
    videoEl.style.display = 'none';
    body.appendChild(videoEl);

    const { el: greenScreenEl, getData: getGreenScreenData } = buildGreenScreenFields();
    greenScreenEl.style.display = 'none';
    body.appendChild(greenScreenEl);

    onTypeChange((type) => {
      navSection.style.display = type === 'nav' ? '' : 'none';
      infoEl.style.display = type === 'info' ? '' : 'none';
      linkEl.style.display = type === 'link' ? '' : 'none';
      videoEl.style.display = type === 'video' ? '' : 'none';
      greenScreenEl.style.display = type === 'greenscreen' ? '' : 'none';
      styleLabel.style.display = type === 'greenscreen' ? 'none' : '';
      styleGrid.style.display = type === 'greenscreen' ? 'none' : '';
      // 切换类型后重置滚动位置，避免热点图标被滚出可视区域
      body.scrollTop = 0;
    });

    // ── 操作按钮 ──
    footer.appendChild(makeBtn('取消', { onClick: () => panel.remove() }));

    footer.appendChild(makeBtn('确认添加', {
      bg: ACCENT, hoverBg: '#3A8EEF',
      onClick: async () => {
        const hsType = getType();
        const name = 'spot_' + Date.now();
        const selectedStyle = hsType === 'greenscreen' ? '' : getSelectedStyle();
        const postData = { scene: fn, name, ath, atv, style: selectedStyle, type: hsType };
        if (hsType === 'nav' && selectedSceneId) postData.linkedscene = selectedSceneId;
        try {
          await api('POST', '/api/hotspot', postData);

          // 保存信息面板内容
          if (hsType === 'info') {
            const info = getInfoData();
            await api('POST', '/api/hotspot-info', { scene: fn, name, ...info });
          }
          // 保存链接
          if (hsType === 'link') {
            await api('POST', '/api/hotspot-info', { scene: fn, name, linkUrl: getLinkUrl() });
          }
          if (hsType === 'video') {
            await api('POST', '/api/hotspot-info', { scene: fn, name, ...getVideoData() });
          }
          if (hsType === 'greenscreen') {
            await api('POST', '/api/hotspot-info', { scene: fn, name, ...getGreenScreenData() });
          }
          if (window.__pano_runtime_refreshHotspot) {
            window.__pano_runtime_refreshHotspot(fn, name);
          }

          // krpano 实时添加
          kp.call(`addhotspot(${name})`);
          kp.set(`hotspot[${name}].ath`, ath);
          kp.set(`hotspot[${name}].atv`, atv);
          kp.set(`hotspot[${name}].editor_type`, hsType);
          if (selectedStyle) {
            const styles = selectedStyle.split('|');
            for (const st of styles) {
              kp.call(`hotspot[${name}].loadstyle(${st})`);
            }
          }
          if (hsType === 'nav' && selectedSceneId) {
            kp.set(`hotspot[${name}].linkedscene`, selectedSceneId);
          } else if (hsType === 'greenscreen') {
            kp.set(`hotspot[${name}].distorted`, true);
            kp.set(`hotspot[${name}].zoom`, true);
            await applyGreenScreenHotspot(kp, fn, name, getGreenScreenData());
          }
          kp.call(`callwith(hotspot[${name}], skin_hotspotstyle_setup())`);
          bindHotspot(kp, name);
          // loadstyle 的 onloaded 回调会异步覆盖 onclick，延迟重新检查并修复
          setTimeout(() => { try { ensureHotspotClickBindings(getKrpano()); } catch {} }, 500);

          panel.remove();
          // 添加后自动刷新热点管理面板（如果已打开）
          const fn2 = currentSceneFilename(kp);
          try {
            const res = await api('GET', `/api/hotspots?scene=${encodeURIComponent(fn2)}`);
            if (document.getElementById('pano-hotspot-panel')) {
              showHotspotPanel(kp, fn2, res.hotspots || []);
            }
          } catch { }
          if (hsType === 'info') {
            const d = getInfoData();
            toast(`✓ 信息面板热点已添加 — ${d.title || name}`);
          } else if (hsType === 'link') {
            toast(`✓ 链接热点已添加 → ${getLinkUrl() || '(无链接)'}`);
          } else if (hsType === 'video') {
            const d = getVideoData();
            toast(`✓ 视频热点已添加 — ${d.title || d.video || name}`);
          } else if (hsType === 'greenscreen') {
            const d = getGreenScreenData();
            toast(`✓ 绿幕讲解热点已添加 — ${d.title || d.video || name}`);
          } else {
            const targetName = selectedSceneId
              ? (sceneList.find(s => s.sceneId === selectedSceneId) || {}).title || selectedSceneId
              : '无';
            toast(`✓ 热点已添加 → ${targetName}`);
          }
        } catch (e) {
          toast('✗ 添加失败: ' + e.message, 3000);
        }
      },
    }));
  }

  // ══════════════════════════════════════════════════
  //  热点管理面板
  // ══════════════════════════════════════════════════
  function showHotspotPanel(kp, sceneFn, hotspots) {
    const { panel, body } = createPanel('pano-hotspot-panel', `热点管理 — ${sceneFn}`, 540);

    if (!hotspots || hotspots.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'text-align:center;color:#666;padding:30px 0;';
      empty.textContent = '当前场景没有热点';
      body.appendChild(empty);
      return;
    }

    for (const hs of hotspots) {
      const row = document.createElement('div');
      row.className = 'hs-row';
      Object.assign(row.style, {
        display: 'flex', alignItems: 'center', gap: '8px',
        padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.06)',
      });

      const info = document.createElement('div');
      info.style.cssText = 'flex:1;min-width:0;';
      const nameDiv = document.createElement('div');
      nameDiv.style.cssText = 'font-weight:500;margin-bottom:2px;';
      nameDiv.textContent = hs.name;
      info.appendChild(nameDiv);
      const detailDiv = document.createElement('div');
      detailDiv.style.cssText = 'font-size:11px;color:#888;';
      let detail = `ath:${hs.ath}  atv:${hs.atv}`;
      if (hs.type === 'info') {
        detail += '  [📖 信息面板]';
      } else if (hs.type === 'link') {
        detail += '  [🌐 打开链接]';
      } else if (hs.type === 'video') {
        detail += '  [🎬 播放视频]';
      } else if (hs.type === 'greenscreen') {
        detail += '  [🧍 绿幕讲解]';
      } else if (hs.linkedscene) {
        const target = sceneList.find(s => s.sceneId === hs.linkedscene);
        detail += `  →  ${target ? target.title : hs.linkedscene}`;
      }
      if (hs.style && hs.type !== 'greenscreen') {
        const styleParts = hs.style.split('|');
        detail += `  [${styleParts[styleParts.length - 1]}]`;
      }
      detailDiv.textContent = detail;
      info.appendChild(detailDiv);

      const lookBtn = makeBtn('👁', {
        onClick: () => {
          kp.call(`looktohotspot(${hs.name})`);
          toast(`定位: ${hs.name}`);
        },
      });
      lookBtn.title = '定位到热点';

      const editBtn = makeBtn('✏️', {  // 编辑热点
        onClick: () => {
          kp.call(`looktohotspot(${hs.name})`);
          setTimeout(() => showEditHotspotPanel(kp, hs.name, {
            keepManage: true,
            onSaved: (saved) => {
              // 就地刷新管理面板中的行数据
              let detail = `ath:${hs.ath}  atv:${hs.atv}`;
              if (saved.type === 'info') {
                detail += '  [📖 信息面板]';
              } else if (saved.type === 'link') {
                detail += '  [🌐 打开链接]';
              } else if (saved.type === 'video') {
                detail += '  [🎬 播放视频]';
              } else if (saved.type === 'greenscreen') {
                detail += '  [🧍 绿幕讲解]';
              } else if (saved.linkedscene) {
                const target = sceneList.find(s => s.sceneId === saved.linkedscene);
                detail += `  →  ${target ? target.title || target.filename : saved.linkedscene}`;
              }
              if (saved.style && saved.type !== 'greenscreen') {
                const styleParts = saved.style.split('|');
                detail += `  [${styleParts[styleParts.length - 1]}]`;
              }
              detailDiv.textContent = detail;
              hs.linkedscene = saved.linkedscene;
              hs.style = saved.style;
              hs.type = saved.type;
            },
          }), 300);
        },
      });
      editBtn.title = '编辑热点';

      const delBtn = makeBtn('🗑', {
        bg: 'rgba(220,50,50,0.25)', hoverBg: 'rgba(220,50,50,0.5)',
        onClick: async () => {
          if (!confirm(`确定删除热点 "${hs.name}"？`)) return;
          try {
            await api('DELETE', '/api/hotspot', { scene: sceneFn, name: hs.name });
            kp.call(`removehotspot(${hs.name})`);
            kp.call(`removelayer(label_${hs.name})`);
            row.remove();
            toast(`✓ 已删除: ${hs.name}`);
            if (!body.querySelector('.hs-row')) {
              body.innerHTML = '<div style="text-align:center;color:#666;padding:30px 0;">当前场景没有热点</div>';
            }
          } catch (e) {
            toast('✗ 删除失败: ' + e.message, 3000);
          }
        },
      });
      delBtn.title = '删除热点';

      row.appendChild(info);
      row.appendChild(lookBtn);
      row.appendChild(editBtn);
      row.appendChild(delBtn);
      body.appendChild(row);
    }
  }

  // ══════════════════════════════════════════════════
  //  热点交互：点击编辑 + 拖拽移动
  // ══════════════════════════════════════════════════

  // 已绑定的热点 name 集合，防止重复绑定
  const _boundHotspots = new Set();
  let _dragging = null; // { name, startAth, startAtv }
  const _skipClickOnce = new Set();

  /**
   * 为当前场景所有热点绑定编辑器交互
   */
  function setupHotspotInteractions(kp) {
    const count = kp.get('hotspot.count');
    const scene = currentSceneFilename(kp);
    for (let i = 0; i < count; i++) {
      const name = kp.get(`hotspot[${i}].name`);
      const type = name ? (kp.get(`hotspot[${name}].editor_type`) || kp.get(`hotspot[${name}].type`) || '') : '';
      if (name && type === 'greenscreen') {
        applyGreenScreenHotspot(kp, scene, name).catch((err) => {
          console.warn('[pano-editor] 无法刷新绿幕热点', name, err);
        });
      }
      const onclick = name ? (kp.get(`hotspot[${name}].onclick`) || '') : '';
      if (name && (!_boundHotspots.has(name) || String(onclick).indexOf('__pano_editor_hotspotclick') === -1)) {
        bindHotspot(kp, name);
      }
    }
    syncGreenScreenEditHandles(kp);
  }

  /**
   * 给单个热点绑定点击/预览/拖拽交互
   */
  function bindHotspot(kp, name) {
    _boundHotspots.add(name);

    // 使用 krpano action 绑定事件
    // ondown: 开始拖拽追踪
    // onup: 结束拖拽 / 如果未拖动则为点击
    const origOnclick = kp.get(`hotspot[${name}].onclick`) || '';
    const storedOrigOnclick = kp.get(`hotspot[${name}]._editor_orig_onclick`) || '';

    // 保存原始 onclick，预览模式下继续执行原有动作
    if (String(origOnclick).indexOf('__pano_editor_hotspotclick') === -1) {
      kp.set(`hotspot[${name}]._editor_orig_onclick`, origOnclick || storedOrigOnclick);
    } else if (!storedOrigOnclick) {
      kp.set(`hotspot[${name}]._editor_orig_onclick`, '');
    }

    // 覆盖 ondown：启动拖拽跟踪
    kp.set(`hotspot[${name}].ondown`, `js( __pano_editor_startdrag('${name}') );`);

    // 覆盖 onup：结束拖拽
    kp.set(`hotspot[${name}].onup`, `js( __pano_editor_enddrag('${name}') );`);

    // 覆盖 onclick：编辑器点击处理（用 kp.set 确保新建热点也能正确设置）
    kp.set(`hotspot[${name}].onclick`, `js( __pano_editor_hotspotclick('${name}') );`);
  }

  // 暴露给 krpano js() 调用的全局函数
  let _dragMoved = false;
  let _dragName = null;
  let _dragStartX = 0;
  let _dragStartY = 0;
  let _dragAnimFrame = null;

  window.__pano_editor_startdrag = function (name) {
    const kp = getKrpano();
    if (!kp) return;

    const scene = currentSceneFilename(kp);
    const hotspotType = kp.get(`hotspot[${name}].editor_type`) || kp.get(`hotspot[${name}].type`) || '';

    _dragName = name;
    _dragMoved = false;
    _dragStartX = parseFloat(kp.get('mouse.stagex'));
    _dragStartY = parseFloat(kp.get('mouse.stagey'));
    _dragging = {
      name,
      scene,
      hotspotType,
      origOnclick: kp.get(`hotspot[${name}]._editor_orig_onclick`) || '',
      linkedscene: kp.get(`hotspot[${name}].linkedscene`) || '',
      origAth: parseFloat(kp.get(`hotspot[${name}].ath`)),
      origAtv: parseFloat(kp.get(`hotspot[${name}].atv`)),
    };

    // 锁定视角，防止拖拽时画面跟着动
    kp.call('set(control.usercontrol, off)');

    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('mouseup', onDragEnd);
  };

  window.__pano_editor_enddrag = function (name) {
    // 由 onDragEnd 处理
  };

  window.__pano_editor_hotspotclick = function (name) {
    const kp = getKrpano();
    if (!kp) return;
    if (_skipClickOnce.has(name)) {
      _skipClickOnce.delete(name);
      return;
    }
    if (hotspotInteractionMode === 'preview' || previewModifierPressed) {
      executeOriginalHotspotAction(kp, name);
      return;
    }
    showEditHotspotPanel(kp, name);
  };

  function onDragMove(e) {
    if (!_dragging) return;
    const kp = getKrpano();
    if (!kp) return;

    // 用浏览器原生坐标转换为 krpano stage 坐标，比 kp.get('mouse.stagex') 更实时
    const canvas = document.getElementById('krpanoSWFObject');
    const rect = canvas.getBoundingClientRect();
    const stageX = e.clientX - rect.left;
    const stageY = e.clientY - rect.top;

    const dx = Math.abs(stageX - _dragStartX);
    const dy = Math.abs(stageY - _dragStartY);

    // 超过 5px 才算拖拽
    if (dx + dy > 5) _dragMoved = true;

    if (_dragMoved) {
      // 热点中心跟随鼠标
      const coords = kp.screentosphere(stageX, stageY);
      kp.set(`hotspot[${_dragging.name}].ath`, coords.x);
      kp.set(`hotspot[${_dragging.name}].atv`, coords.y);
    }
  }

  async function onDragEnd(e) {
    document.removeEventListener('mousemove', onDragMove);
    document.removeEventListener('mouseup', onDragEnd);

    const kp = getKrpano();
    if (!kp) return;

    // 恢复用户视角控制
    kp.call('set(control.usercontrol, all)');

    if (!_dragging) return;

    const name = _dragging.name;

    if (_dragMoved) {
      // 拖拽完成：保存新位置
      const newAth = round(parseFloat(kp.get(`hotspot[${name}].ath`)));
      const newAtv = round(parseFloat(kp.get(`hotspot[${name}].atv`)));
      const fn = currentSceneFilename(kp);

      try {
        await api('PUT', '/api/hotspot', { scene: fn, name, ath: newAth, atv: newAtv });
        toast(`✓ 热点已移动: ath:${newAth} atv:${newAtv}`);
      } catch (err) {
        // 恢复原位置
        kp.set(`hotspot[${name}].ath`, _dragging.origAth);
        kp.set(`hotspot[${name}].atv`, _dragging.origAtv);
        toast('✗ 保存位置失败: ' + err.message, 3000);
      }
    } else {
      _skipClickOnce.add(name);
      if (hotspotInteractionMode === 'preview' || previewModifierPressed) {
        executeCapturedHotspotAction(kp, _dragging);
      } else {
        showEditHotspotPanel(kp, name);
      }
    }

    _dragging = null;
    _dragName = null;
  }

  // ══════════════════════════════════════════════════
  // ══════════════════════════════════════════════════
  //  编辑热点面板
  // ══════════════════════════════════════════════════
  // options: { keepManage, onSaved(savedData), onDeleted() }
  async function showEditHotspotPanel(kp, name, options) {
    options = options || {};
    const fn = currentSceneFilename(kp);

    const ath = round(parseFloat(kp.get(`hotspot[${name}].ath`)));
    const atv = round(parseFloat(kp.get(`hotspot[${name}].atv`)));

    // 从服务器获取完整属性
    let hsData = null;
    try {
      const res = await api('GET', `/api/hotspots?scene=${encodeURIComponent(fn)}`);
      hsData = (res.hotspots || []).find(h => h.name === name);
    } catch (e) { /* 继续用当前值 */ }

    const currentStyle = hsData ? (hsData.style || '') : '';
    const currentLinkedScene = hsData ? (hsData.linkedscene || '') : '';
    const currentType = hsData ? (hsData.type || 'nav') : 'nav';

    // 预取信息面板/链接内容
    let currentInfoData = {};
    let currentLinkUrl = '';
    if (currentType === 'info' || currentType === 'link' || currentType === 'video' || currentType === 'greenscreen') {
      try {
        const fetched = await api('GET', `/api/hotspot-info?scene=${encodeURIComponent(fn)}&name=${encodeURIComponent(name)}`);
        if (currentType === 'info') currentInfoData = fetched;
        if (currentType === 'link') currentLinkUrl = fetched.linkUrl || '';
        if (currentType === 'video') currentInfoData = fetched;
        if (currentType === 'greenscreen') currentInfoData = fetched;
      } catch (e) { /* 无内容 */ }
    }

    const { panel, body, footer } = createPanel('pano-edit-panel', `编辑热点 — ${name}`, 540, { keepManage: options.keepManage });

    // ── 热点名（可编辑）──
    const nameLabel = document.createElement('div');
    nameLabel.style.cssText = 'font-weight:600;margin-bottom:6px;';
    nameLabel.textContent = '热点名';
    body.appendChild(nameLabel);

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.value = name;
    Object.assign(nameInput.style, {
      width: '100%', boxSizing: 'border-box', padding: '8px 10px',
      background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)',
      borderRadius: '6px', color: '#fff', fontSize: '13px', marginBottom: '4px',
      outline: 'none', fontFamily: 'monospace',
    });
    nameInput.onfocus = () => nameInput.style.borderColor = ACCENT;
    nameInput.onblur = () => nameInput.style.borderColor = 'rgba(255,255,255,0.15)';
    body.appendChild(nameInput);

    const nameHint = document.createElement('div');
    nameHint.style.cssText = 'color:#777;font-size:11px;margin-bottom:14px;';
    nameHint.textContent = '仅字母/数字/_/-，以字母或 _ 开头；修改后将同步迁移关联数据。';
    body.appendChild(nameHint);

    // 坐标显示
    const coordDiv = document.createElement('div');
    coordDiv.style.cssText = 'margin-bottom:16px;color:#9aa;font-size:12px;';
    coordDiv.textContent = `位置: ath = ${ath}  atv = ${atv}  (拖拽热点可移动位置)`;
    body.appendChild(coordDiv);

    // ── 热点类型 Tab ──
    const { wrap: typeWrap, getType, onTypeChange } = buildTypeTab(currentType);
    body.appendChild(typeWrap);

    // ── 选择热点图标 ──
    const styleLabel = document.createElement('div');
    styleLabel.style.cssText = 'font-weight:600;margin-bottom:8px;';
    styleLabel.textContent = '热点图标';
    body.appendChild(styleLabel);

    const { grid: styleGrid, getSelected: getSelectedStyle } = buildStyleGrid(currentStyle || HOTSPOT_STYLES[0].id);
    body.appendChild(styleGrid);
    if (currentType === 'greenscreen') {
      styleLabel.style.display = 'none';
      styleGrid.style.display = 'none';
    }

    // ── Section: 跳转场景 ──
    const navSection = document.createElement('div');

    const sceneLabel = document.createElement('div');
    sceneLabel.style.cssText = 'font-weight:600;margin-bottom:8px;';
    sceneLabel.textContent = '链接到场景';
    navSection.appendChild(sceneLabel);

    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.placeholder = '搜索场景…';
    Object.assign(searchInput.style, {
      width: '100%', boxSizing: 'border-box', padding: '8px 10px',
      background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)',
      borderRadius: '6px', color: '#fff', fontSize: '13px', marginBottom: '8px',
      outline: 'none',
    });
    searchInput.onfocus = () => searchInput.style.borderColor = ACCENT;
    searchInput.onblur = () => searchInput.style.borderColor = 'rgba(255,255,255,0.15)';
    navSection.appendChild(searchInput);

    let selectedSceneId = currentLinkedScene;
    const sceneListDiv = document.createElement('div');
    sceneListDiv.style.cssText = 'max-height:180px;overflow-y:auto;border:1px solid rgba(255,255,255,0.1);border-radius:6px;';

    function renderSceneList(filter) {
      sceneListDiv.innerHTML = '';
      const noneOpt = document.createElement('div');
      noneOpt.style.cssText = `padding:7px 10px;cursor:pointer;border-bottom:1px solid rgba(255,255,255,0.05);color:#888;${selectedSceneId === '' ? 'background:rgba(74,158,255,0.15);color:#fff;' : ''}`;
      noneOpt.textContent = '（不链接场景）';
      noneOpt.onclick = () => { selectedSceneId = ''; renderSceneList(filter); };
      sceneListDiv.appendChild(noneOpt);

      let currentGroup = '';
      for (const s of sceneList) {
        const matchText = `${s.filename} ${s.title} ${s.group}`.toLowerCase();
        if (filter && !matchText.includes(filter.toLowerCase())) continue;

        if (s.group !== currentGroup) {
          currentGroup = s.group;
          const groupHeader = document.createElement('div');
          groupHeader.style.cssText = 'padding:5px 10px;font-size:11px;color:#666;background:rgba(255,255,255,0.03);font-weight:600;';
          groupHeader.textContent = `【${currentGroup}】`;
          sceneListDiv.appendChild(groupHeader);
        }

        const row = document.createElement('div');
        const isSelected = selectedSceneId === s.sceneId;
        Object.assign(row.style, {
          padding: '6px 10px', cursor: 'pointer',
          borderBottom: '1px solid rgba(255,255,255,0.04)',
          background: isSelected ? 'rgba(74,158,255,0.15)' : 'transparent',
          transition: 'background 0.1s',
        });
        row.innerHTML = `<span>${s.title || s.filename}</span> <span style="font-size:11px;color:#666;">${s.filename}</span>`;
        row.onmouseenter = () => { if (!isSelected) row.style.background = 'rgba(255,255,255,0.06)'; };
        row.onmouseleave = () => { if (!isSelected) row.style.background = 'transparent'; };
        row.onclick = () => { selectedSceneId = s.sceneId; renderSceneList(filter); };
        sceneListDiv.appendChild(row);
      }
    }

    renderSceneList('');
    searchInput.oninput = () => renderSceneList(searchInput.value);
    const editSceneListRefresh = () => renderSceneList(searchInput.value);
    document.addEventListener('pano-scene-list-updated', editSceneListRefresh);
    bindPanelCleanup(panel, () => document.removeEventListener('pano-scene-list-updated', editSceneListRefresh));
    navSection.appendChild(sceneListDiv);

    navSection.style.display = currentType === 'nav' ? '' : 'none';
    body.appendChild(navSection);

    // ── Section: 信息面板字段 ──
    const { el: infoEl, getData: getInfoData, setData: setInfoData } = buildInfoFields(currentInfoData);
    infoEl.style.display = currentType === 'info' ? '' : 'none';
    body.appendChild(infoEl);

    // ── Section: 链接字段 ──
    const { el: linkEl, getUrl: getLinkUrl, setUrl: setLinkUrl } = buildLinkFields(currentLinkUrl);
    linkEl.style.display = currentType === 'link' ? '' : 'none';
    body.appendChild(linkEl);

    const { el: videoEl, getData: getVideoData, setData: setVideoData } = buildVideoFields(currentInfoData);
    videoEl.style.display = currentType === 'video' ? '' : 'none';
    body.appendChild(videoEl);

    const { el: greenScreenEl, getData: getGreenScreenData, setData: setGreenScreenData, onLiveChange: onGreenScreenLiveChange } = buildGreenScreenFields(currentInfoData);
    greenScreenEl.style.display = currentType === 'greenscreen' ? '' : 'none';
    body.appendChild(greenScreenEl);

    let greenScreenPreviewDirty = false;
    const revertGreenScreenPreview = () => {
      if (!greenScreenPreviewDirty) return;
      greenScreenPreviewDirty = false;
      applyGreenScreenHotspot(kp, fn, name, currentInfoData).catch((err) => {
        console.warn('[pano-editor] 无法恢复绿幕实时预览', err);
      });
    };
    bindPanelCleanup(panel, revertGreenScreenPreview);
    const disposeGreenScreenLivePreview = onGreenScreenLiveChange((previewData) => {
      if (getType() !== 'greenscreen') return;
      greenScreenPreviewDirty = true;
      applyGreenScreenHotspot(kp, fn, name, previewData).catch((err) => {
        console.warn('[pano-editor] 无法应用绿幕实时预览', err);
      });
    });
    bindPanelCleanup(panel, disposeGreenScreenLivePreview);

    let _infoLoaded = currentType === 'info';
    let _linkLoaded = currentType === 'link';
    let _videoLoaded = currentType === 'video';
    let _greenScreenLoaded = currentType === 'greenscreen';
    onTypeChange(async (type) => {
      navSection.style.display = type === 'nav' ? '' : 'none';
      infoEl.style.display = type === 'info' ? '' : 'none';
      linkEl.style.display = type === 'link' ? '' : 'none';
      videoEl.style.display = type === 'video' ? '' : 'none';
      greenScreenEl.style.display = type === 'greenscreen' ? '' : 'none';
      styleLabel.style.display = type === 'greenscreen' ? 'none' : '';
      styleGrid.style.display = type === 'greenscreen' ? 'none' : '';
      // 切换类型后重置滚动位置，避免热点图标被滚出可视区域
      body.scrollTop = 0;
      // 切换到 info 时自动加载已有内容
      if (type === 'info' && !_infoLoaded) {
        try {
          const d = await api('GET', `/api/hotspot-info?scene=${encodeURIComponent(fn)}&name=${encodeURIComponent(name)}`);
          setInfoData(d);
        } catch (e) { /* 无内容 */ }
        _infoLoaded = true;
      }
      // 切换到 link 时自动加载
      if (type === 'link' && !_linkLoaded) {
        try {
          const d = await api('GET', `/api/hotspot-info?scene=${encodeURIComponent(fn)}&name=${encodeURIComponent(name)}`);
          setLinkUrl(d.linkUrl || '');
        } catch (e) { /* 无内容 */ }
        _linkLoaded = true;
      }
      if (type === 'video' && !_videoLoaded) {
        try {
          const d = await api('GET', `/api/hotspot-info?scene=${encodeURIComponent(fn)}&name=${encodeURIComponent(name)}`);
          setVideoData(d || {});
        } catch (e) { /* 无内容 */ }
        _videoLoaded = true;
      }
      if (type === 'greenscreen' && !_greenScreenLoaded) {
        try {
          const d = await api('GET', `/api/hotspot-info?scene=${encodeURIComponent(fn)}&name=${encodeURIComponent(name)}`);
          setGreenScreenData(d || {});
        } catch (e) { /* 无内容 */ }
        _greenScreenLoaded = true;
      }
      if (type !== 'greenscreen') revertGreenScreenPreview();
    });

    // ── 操作按钮 ──
    footer.appendChild(makeBtn('取消', { onClick: () => panel.remove() }));

    // 预览按钮（info/link 类型时显示）
    const previewBtn = makeBtn('预览效果', {
      bg: 'rgba(255,193,7,0.25)', hoverBg: 'rgba(255,193,7,0.45)',
      onClick: () => {
        const t = getType();
        if (t === 'info') showInfoOverlay(getInfoData());
        else if (t === 'link') showLinkOverlay(getLinkUrl());
        else if (t === 'video') {
          const d = getVideoData();
          showVideoOverlay(d.video, d.title || name);
        } else if (t === 'greenscreen') {
          toast('绿幕参数已实时预览；确认后再点保存即可', 2200);
        }
      },
    });
    previewBtn.style.display = (currentType === 'info' || currentType === 'link' || currentType === 'video' || currentType === 'greenscreen') ? '' : 'none';
    onTypeChange((type) => { previewBtn.style.display = (type === 'info' || type === 'link' || type === 'video' || type === 'greenscreen') ? '' : 'none'; });
    footer.appendChild(previewBtn);

    // 删除按钮
    footer.appendChild(makeBtn('删除热点', {
      bg: 'rgba(220,50,50,0.4)', hoverBg: 'rgba(220,50,50,0.7)',
      onClick: async () => {
        if (!confirm(`确定删除热点 "${name}"？`)) return;
        try {
          await api('DELETE', '/api/hotspot', { scene: fn, name });
          kp.call(`removehotspot(${name})`);
          kp.call(`removelayer(label_${name})`);
          _boundHotspots.delete(name);
          panel.remove();
          toast(`✓ 已删除: ${name}`);
          if (options.onDeleted) options.onDeleted(name);
        } catch (e) {
          toast('✗ 删除失败: ' + e.message, 3000);
        }
      },
    }));

    footer.appendChild(makeBtn('保存修改', {
      bg: ACCENT, hoverBg: '#3A8EEF',
      onClick: async () => {
        const hsType = getType();
        const selStyle = hsType === 'greenscreen' ? '' : getSelectedStyle();
        const newNameVal = nameInput.value.trim();
        const doRename = newNameVal && newNameVal !== name;
        if (doRename && !/^[A-Za-z_][\w\-]*$/.test(newNameVal)) {
          toast('✗ 热点名仅支持字母/数字/_/-，以字母或 _ 开头', 3000);
          return;
        }
        const putData = { scene: fn, name, style: selStyle, type: hsType, linkedscene: hsType === 'nav' ? selectedSceneId : '' };
        if (doRename) putData.newName = newNameVal;
        try {
          await api('PUT', '/api/hotspot', putData);

          // 信息面板/链接 内容存 api（若改名，用新名字）
          const targetName = doRename ? newNameVal : name;
          if (hsType === 'info') {
            const info = getInfoData();
            await api('POST', '/api/hotspot-info', { scene: fn, name: targetName, ...info });
          }
          if (hsType === 'link') {
            await api('POST', '/api/hotspot-info', { scene: fn, name: targetName, linkUrl: getLinkUrl() });
          }
          if (hsType === 'video') {
            await api('POST', '/api/hotspot-info', { scene: fn, name: targetName, ...getVideoData() });
          }
          if (hsType === 'greenscreen') {
            await api('POST', '/api/hotspot-info', { scene: fn, name: targetName, ...getGreenScreenData() });
            currentInfoData = getGreenScreenData();
            greenScreenPreviewDirty = false;
          }
          if (window.__pano_runtime_refreshHotspot) {
            window.__pano_runtime_refreshHotspot(fn, targetName, doRename ? name : '');
          }

          // krpano：若改名，移除旧 + 添加新；否则按原逻辑更新
          if (doRename) {
            const curAth = kp.get(`hotspot[${name}].ath`);
            const curAtv = kp.get(`hotspot[${name}].atv`);
            kp.call(`removehotspot(${name})`);
            kp.call(`removelayer(label_${name})`);
            _boundHotspots.delete(name);
            kp.call(`addhotspot(${newNameVal})`);
            kp.set(`hotspot[${newNameVal}].ath`, curAth);
            kp.set(`hotspot[${newNameVal}].atv`, curAtv);
            kp.set(`hotspot[${newNameVal}].distorted`, hsType === 'greenscreen');
            kp.set(`hotspot[${newNameVal}].zoom`, hsType === 'greenscreen');
            kp.set(`hotspot[${newNameVal}].editor_type`, hsType);
            if (selStyle) {
              for (const st of selStyle.split('|')) kp.call(`hotspot[${newNameVal}].loadstyle(${st})`);
            }
            if (hsType === 'nav' && selectedSceneId) {
              kp.set(`hotspot[${newNameVal}].linkedscene`, selectedSceneId);
            } else if (hsType === 'greenscreen') {
              await applyGreenScreenHotspot(kp, fn, newNameVal, getGreenScreenData());
            }
            kp.call(`callwith(hotspot[${newNameVal}], skin_hotspotstyle_setup())`);
            bindHotspot(kp, newNameVal);
          } else {
            if (selStyle !== currentStyle && hsType !== 'greenscreen') {
              const styles = selStyle.split('|');
              for (const st of styles) kp.call(`hotspot[${name}].loadstyle(${st})`);
            }
            if (hsType === 'nav') {
              kp.set(`hotspot[${name}].editor_type`, 'nav');
              kp.set(`hotspot[${name}].linkedscene`, selectedSceneId);
              if (selectedSceneId !== currentLinkedScene) kp.call(`removelayer(label_${name})`);
            } else {
              // info/link/video 类型：移除 linkedscene，不跳转
              kp.set(`hotspot[${name}].editor_type`, hsType);
              kp.set(`hotspot[${name}].distorted`, hsType === 'greenscreen');
              kp.set(`hotspot[${name}].zoom`, hsType === 'greenscreen');
              kp.set(`hotspot[${name}].linkedscene`, '');
              kp.call(`removelayer(label_${name})`);
              if (hsType === 'greenscreen') {
                await applyGreenScreenHotspot(kp, fn, name, getGreenScreenData());
              }
            }
            kp.call(`callwith(hotspot[${name}], skin_hotspotstyle_setup())`);
          }

          panel.remove();
          toast(doRename ? `✓ 热点已重命名: ${newNameVal}` : '✓ 热点已更新');
          if (options.onSaved) options.onSaved({ style: selStyle, type: hsType, linkedscene: hsType === 'nav' ? selectedSceneId : '', newName: doRename ? newNameVal : name });
        } catch (e) {
          toast('✗ 更新失败: ' + e.message, 3000);
        }
      },
    }));
  }

  // ══════════════════════════════════════════════════
  //  场景排序管理面板
  // ══════════════════════════════════════════════════
  async function showSortPanel() {
    let sortData;
    try {
      sortData = await api('GET', '/api/sort');
    } catch (e) {
      toast('✗ 加载失败: ' + e.message, 3000);
      return;
    }

    // groups[i] = { name, folders: [{folder}], scenes: [{filename, title}] }
    const groups = JSON.parse(JSON.stringify(sortData.groups || []));

    const { panel, body, footer } = createPanel('pano-sort-panel', '场景排序管理', 500);

    const hint = document.createElement('div');
    hint.style.cssText = 'color:#888;font-size:12px;margin-bottom:14px;line-height:1.5;';
    hint.textContent = '拖拽 ⠿ 可重新排列分组或分组内的场景顺序；点击分组名展开/折叠。';
    body.appendChild(hint);

    const listEl = document.createElement('div');
    listEl.style.cssText = 'display:flex;flex-direction:column;gap:4px;';
    body.appendChild(listEl);

    const expandedSet = new Set();
    let dragState = null; // { type:'group'|'scene', gIdx, sIdx? }

    function clearDropLines() {
      panel.querySelectorAll('.dnd-line').forEach(el => el.remove());
    }

    function makeLine() {
      const ln = document.createElement('div');
      ln.className = 'dnd-line';
      ln.style.cssText = `height:2px;border-radius:1px;background:${ACCENT};margin:2px 6px;pointer-events:none;`;
      return ln;
    }

    function render() {
      listEl.innerHTML = '';

      groups.forEach((group, gIdx) => {
        // ── 分组行 ──
        const gWrap = document.createElement('div');
        gWrap.style.cssText = 'border-radius:7px;background:rgba(255,255,255,0.05);margin-bottom:2px;';

        const gRow = document.createElement('div');
        gRow.draggable = true;
        gRow.style.cssText = 'display:flex;align-items:center;gap:8px;padding:9px 12px;cursor:default;user-select:none;border-radius:7px;';

        const gHandle = document.createElement('span');
        gHandle.textContent = '⠿';
        gHandle.style.cssText = 'color:#555;font-size:15px;cursor:grab;flex-shrink:0;';
        gHandle.title = '拖拽排序分组';

        const gArrow = document.createElement('span');
        gArrow.textContent = expandedSet.has(gIdx) ? '▼' : '▶';
        gArrow.style.cssText = 'color:#888;font-size:9px;flex-shrink:0;width:12px;cursor:pointer;';

        const gName = document.createElement('span');
        gName.style.cssText = 'flex:1;font-weight:600;font-size:13px;cursor:pointer;';
        gName.textContent = group.name;

        const gCount = document.createElement('span');
        gCount.style.cssText = 'color:#555;font-size:11px;';
        gCount.textContent = (group.scenes || []).length + ' 个场景';

        gRow.appendChild(gHandle);
        gRow.appendChild(gArrow);
        gRow.appendChild(gName);
        gRow.appendChild(gCount);

        // 点击分组名/箭头展开收起
        const toggleExpand = () => {
          if (expandedSet.has(gIdx)) expandedSet.delete(gIdx);
          else expandedSet.add(gIdx);
          render();
        };
        gArrow.onclick = toggleExpand;
        gName.onclick = toggleExpand;

        // 分组拖拽事件
        gRow.addEventListener('dragstart', (e) => {
          dragState = { type: 'group', gIdx };
          e.dataTransfer.effectAllowed = 'move';
          e.stopPropagation();
          setTimeout(() => { gWrap.style.opacity = '0.4'; }, 0);
        });
        gRow.addEventListener('dragend', () => {
          gWrap.style.opacity = '1';
          dragState = null;
          clearDropLines();
        });
        gWrap.addEventListener('dragover', (e) => {
          if (!dragState || dragState.type !== 'group') return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          clearDropLines();
          const rect = gWrap.getBoundingClientRect();
          const before = e.clientY < rect.top + rect.height / 2;
          gWrap.insertAdjacentElement(before ? 'beforebegin' : 'afterend', makeLine());
          gWrap._dropBefore = before;
        });
        gWrap.addEventListener('drop', (e) => {
          e.preventDefault();
          if (!dragState || dragState.type !== 'group') return;
          const srcIdx = dragState.gIdx;
          if (srcIdx === gIdx) { clearDropLines(); return; }
          const before = gWrap._dropBefore;
          const destIdx = before ? gIdx : gIdx + 1;
          const [moved] = groups.splice(srcIdx, 1);
          const insertAt = destIdx > srcIdx ? destIdx - 1 : destIdx;
          groups.splice(insertAt, 0, moved);
          clearDropLines();
          render();
        });

        gWrap.appendChild(gRow);

        // ── 场景列表（展开时显示可拖拽的场景行）──
        if (expandedSet.has(gIdx)) {
          const sceneContainer = document.createElement('div');
          sceneContainer.style.cssText = 'padding:0 8px 8px 34px;display:flex;flex-direction:column;gap:2px;';

          const scenes = group.scenes || [];
          if (scenes.length === 0) {
            const empty = document.createElement('div');
            empty.style.cssText = 'color:#555;font-size:11px;padding:4px 10px;';
            empty.textContent = '（无场景）';
            sceneContainer.appendChild(empty);
          } else {
            scenes.forEach((sceneItem, sIdx) => {
              const sWrap = document.createElement('div');

              const sRow = document.createElement('div');
              sRow.draggable = true;
              sRow.style.cssText = 'display:flex;align-items:center;gap:8px;padding:5px 10px;border-radius:5px;cursor:default;user-select:none;transition:background 0.1s;';
              sRow.onmouseenter = () => { if (!dragState) sRow.style.background = 'rgba(255,255,255,0.06)'; };
              sRow.onmouseleave = () => { sRow.style.background = ''; };

              const sHandle = document.createElement('span');
              sHandle.textContent = '⠿';
              sHandle.style.cssText = 'color:#444;font-size:13px;cursor:grab;flex-shrink:0;';
              sHandle.title = '拖拽排序场景';

              const sTitle = document.createElement('span');
              sTitle.style.cssText = 'flex:1;font-size:12px;';
              sTitle.textContent = sceneItem.title !== sceneItem.filename
                ? sceneItem.title + ' '
                : '';

              const sFilename = document.createElement('span');
              sFilename.style.cssText = 'color:#666;font-size:11px;';
              sFilename.textContent = sceneItem.filename;

              sRow.appendChild(sHandle);
              sRow.appendChild(sTitle);
              sRow.appendChild(sFilename);

              // 场景拖拽事件（只在同一分组内排序）
              sRow.addEventListener('dragstart', (e) => {
                dragState = { type: 'scene', gIdx, sIdx };
                e.dataTransfer.effectAllowed = 'move';
                e.stopPropagation();
                setTimeout(() => { sWrap.style.opacity = '0.4'; }, 0);
              });
              sRow.addEventListener('dragend', () => {
                sWrap.style.opacity = '1';
                dragState = null;
                clearDropLines();
              });
              sWrap.addEventListener('dragover', (e) => {
                if (!dragState || dragState.type !== 'scene' || dragState.gIdx !== gIdx) return;
                if (dragState.sIdx === sIdx) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                clearDropLines();
                const rect = sWrap.getBoundingClientRect();
                const before = e.clientY < rect.top + rect.height / 2;
                sWrap.insertAdjacentElement(before ? 'beforebegin' : 'afterend', makeLine());
                sWrap._dropBefore = before;
              });
              sWrap.addEventListener('drop', (e) => {
                e.preventDefault();
                if (!dragState || dragState.type !== 'scene' || dragState.gIdx !== gIdx) return;
                const srcSIdx = dragState.sIdx;
                if (srcSIdx === sIdx) { clearDropLines(); return; }
                const before = sWrap._dropBefore;
                const destSIdx = before ? sIdx : sIdx + 1;
                const [moved] = scenes.splice(srcSIdx, 1);
                const insertAt = destSIdx > srcSIdx ? destSIdx - 1 : destSIdx;
                scenes.splice(insertAt, 0, moved);
                clearDropLines();
                render();
              });

              sWrap.appendChild(sRow);
              sceneContainer.appendChild(sWrap);
            });
          }

          gWrap.appendChild(sceneContainer);
        }

        listEl.appendChild(gWrap);
      });
    }

    render();

    footer.appendChild(makeBtn('取消', { onClick: () => panel.remove() }));
    footer.appendChild(makeBtn('保存排序', {
      bg: ACCENT, hoverBg: '#3A8EEF',
      onClick: async () => {
        const saveData = {
          groups: groups.map(g => ({
            name: g.name,
            folders: (g.folders || []).map(f => f.folder),
            scenes: (g.scenes || []).map(s => s.filename),
          })),
        };
        try {
          const res = await api('POST', '/api/sort', saveData);
          if (res.ok) {
            panel.remove();
            toast('✓ 排序已保存，点击「生成 XML」后刷新页面生效', 4000);
          } else {
            toast('✗ 保存失败: ' + (res.error || '未知错误'), 3000);
          }
        } catch (e) {
          toast('✗ 保存失败: ' + e.message, 3000);
        }
      },
    }));
  }

  // ── 启动 ──
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Control') previewModifierPressed = true;
  });
  document.addEventListener('keyup', (e) => {
    if (e.key === 'Control') previewModifierPressed = false;
  });
  window.addEventListener('blur', () => {
    previewModifierPressed = false;
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', waitForKrpano);
  } else {
    waitForKrpano();
  }
})();
