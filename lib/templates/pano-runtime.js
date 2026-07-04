(function () {
  if (window.__pano_runtime_openInfo) return;

  const cache = new Map();
  const greenScreenItems = new Map();
  const pendingGreenScreens = new Set();
  let manifestPromise = null;
  let activeGreenScreenScene = '';
  let suspendedNarrationState = null;

  function getNativeGreenScreenHotspots(kp) {
    if (!kp) return [];
    const hotspots = [];
    const count = parseNum(kp.get('hotspot.count'), 0);
    for (let i = 0; i < count; i++) {
      const name = kp.get(`hotspot[${i}].name`);
      const type = name ? (kp.get(`hotspot[${name}].editor_type`) || kp.get(`hotspot[${name}].type`) || '') : '';
      if (name && type === 'greenscreen') hotspots.push(name);
    }
    return hotspots;
  }

  function removeExisting(ids) {
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (el) safeRemove(el);
    });
  }

  function safeRemove(el) {
    if (!el) return;
    if (typeof el.__panoCleanup === 'function') {
      try {
        el.__panoCleanup();
      } catch (error) {
        console.warn('[pano-runtime] overlay cleanup failed', error);
      }
      el.__panoCleanup = null;
    }
    el.querySelectorAll('video,audio').forEach((media) => {
      try {
        media.pause();
      } catch { }
      try {
        media.removeAttribute('src');
        media.load();
      } catch { }
    });
    el.remove();
    restoreViewerFocus();
  }

  function restoreViewerFocus() {
    const kp = getKrpano();
    if (kp && typeof kp.focus === 'function') {
      try {
        kp.focus();
        return;
      } catch (error) {
        console.warn('[pano-runtime] failed to focus krpano', error);
      }
    }
    const container = document.getElementById('pano');
    if (!container || typeof container.focus !== 'function') return;
    try {
      if (!container.hasAttribute('tabindex')) container.setAttribute('tabindex', '-1');
      container.focus();
    } catch (error) {
      console.warn('[pano-runtime] failed to focus pano container', error);
    }
  }

  function onEscapeClose(el) {
    function escClose(e) {
      if (e.key === 'Escape') {
        safeRemove(el);
        document.removeEventListener('keydown', escClose);
      }
    }
    document.addEventListener('keydown', escClose);
  }

  function suspendNarrationForVideo() {
    if (suspendedNarrationState) return;
    const media = Array.from(document.querySelectorAll('audio')).filter((el) => {
      if (!el || el.ended) return false;
      if (el.closest('#pano-video-overlay')) return false;
      return !el.paused;
    });
    const kp = getKrpano();
    const playingGreenScreens = [];
    getNativeGreenScreenHotspots(kp).forEach((name) => {
      try {
        if (parseBool(kp.get(`hotspot[${name}].ispaused`), false)) return;
        kp.call(`if(hotspot[${name}], hotspot[${name}].pause(););`);
        playingGreenScreens.push(name);
      } catch (error) {
        console.warn('[pano-runtime] failed to pause native greenscreen hotspot', name, error);
      }
    });
    if (!media.length) {
      suspendedNarrationState = { media: [], greenScreens: playingGreenScreens };
      return;
    }

    suspendedNarrationState = {
      media: media.map((el) => ({ el, currentTime: Number.isFinite(el.currentTime) ? el.currentTime : 0 })),
      greenScreens: playingGreenScreens,
    };

    media.forEach((el) => {
      try {
        el.pause();
      } catch (error) {
        console.warn('[pano-runtime] failed to pause narration', error);
      }
    });
  }

  function resumeNarrationAfterVideo() {
    const state = suspendedNarrationState;
    suspendedNarrationState = null;
    if (!state) return;

    const kp = getKrpano();
    (state.greenScreens || []).forEach((name) => {
      if (!kp) return;
      try {
        kp.call(`if(hotspot[${name}], hotspot[${name}].play(););`);
      } catch (error) {
        console.warn('[pano-runtime] failed to resume native greenscreen hotspot', name, error);
      }
    });

    if (!state.media || !state.media.length) return;

    state.media.forEach(({ el, currentTime }) => {
      if (!el || !document.contains(el)) return;
      try {
        if (Number.isFinite(currentTime)) el.currentTime = currentTime;
        const playPromise = el.play();
        if (playPromise && playPromise.catch) playPromise.catch(() => { });
      } catch (error) {
        console.warn('[pano-runtime] failed to resume narration', error);
      }
    });
  }

  function closeLegacyVideoOverlay() {
    const kp = getKrpano();
    if (!kp) return;
    try {
      if (kp.get('layer[videobg#vp].name')) {
        kp.call('closevideo();');
      }
    } catch (error) {
      console.warn('[pano-runtime] failed to close legacy video via action', error);
    }
    try {
      ['btnplay#vp', 'btnclose#vp', 'video#vp', 'videoouter#vp', 'videoarea#vp', 'loading#vp', 'videobg#vp'].forEach(function (name) {
        if (kp.get('layer[' + name + '].name')) {
          kp.call('removelayer(' + name + ',true);');
        }
      });
      if (kp.get('plugin[pp_blur].name')) {
        kp.set('plugin[pp_blur].range', 0);
      }
    } catch (error) {
      console.warn('[pano-runtime] failed to remove legacy video layers', error);
    }
  }

  function getKrpano() {
    const kp = document.getElementById('krpanoSWFObject');
    return kp && typeof kp.get === 'function' ? kp : null;
  }

  function parseBool(value, fallback) {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value === 'boolean') return value;
    const lowered = String(value).toLowerCase();
    if (lowered === 'true' || lowered === '1' || lowered === 'yes') return true;
    if (lowered === 'false' || lowered === '0' || lowered === 'no') return false;
    return fallback;
  }

  function parseNum(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function parseColor(value) {
    const hex = String(value || '#00ff00').trim().replace('#', '');
    const full = hex.length === 3 ? hex.split('').map((ch) => ch + ch).join('') : hex;
    if (!/^[0-9a-fA-F]{6}$/.test(full)) return { r: 0, g: 255, b: 0 };
    return {
      r: parseInt(full.slice(0, 2), 16),
      g: parseInt(full.slice(2, 4), 16),
      b: parseInt(full.slice(4, 6), 16),
    };
  }

  function isEditorEditMode() {
    return !!window.__PANO_EDITOR_ACTIVE
      && typeof window.__pano_editor_getInteractionMode === 'function'
      && window.__pano_editor_getInteractionMode() === 'edit';
  }

  function makeHotspotKey(scene, name) {
    return `${scene}__${name}`;
  }

  async function loadInfoManifest() {
    if (!manifestPromise) {
      manifestPromise = fetch('hotspots/info/index.json', { cache: 'no-store' })
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json();
        })
        .catch((error) => {
          manifestPromise = null;
          throw error;
        });
    }
    return manifestPromise;
  }

  function primeInfoCacheFromManifest(manifest) {
    if (!manifest || typeof manifest !== 'object') return;
    Object.keys(manifest).forEach((key) => {
      if (!cache.has(key)) cache.set(key, manifest[key] || {});
    });
  }

  function warmInfoManifest() {
    loadInfoManifest()
      .then((manifest) => {
        primeInfoCacheFromManifest(manifest);
      })
      .catch(() => { });
  }

  function getCachedInfoData(scene, name) {
    const key = makeHotspotKey(scene, name);
    return cache.has(key) ? (cache.get(key) || {}) : null;
  }

  function invalidateHotspot(scene, name, oldName) {
    if (scene && name) cache.delete(makeHotspotKey(scene, name));
    if (scene && oldName) cache.delete(makeHotspotKey(scene, oldName));
    if (oldName) removeGreenScreen(oldName);
    if (name) removeGreenScreen(name);
  }

  async function getInfoData(scene, name) {
    const key = makeHotspotKey(scene, name);
    if (cache.has(key)) return cache.get(key);
    const url = `hotspots/info/${encodeURIComponent(scene)}__${encodeURIComponent(name)}.json`;
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      cache.set(key, data || {});
      return data || {};
    } catch (e) {
      try {
        const manifest = await loadInfoManifest();
        primeInfoCacheFromManifest(manifest);
        const data = (manifest && manifest[key]) || {};
        cache.set(key, data);
        return data;
      } catch (manifestError) {
        console.warn('[pano-runtime] failed to load hotspot info', scene, name, e, manifestError);
        return {};
      }
    }
  }

  function getCurrentSceneInfo(kp) {
    const sceneId = kp.get('xml.scene') || '';
    if (!sceneId) return null;
    const sourcefile = kp.get(`scene[${sceneId}].sourcefile`) || '';
    return { sceneId, sourcefile };
  }

  function removeGreenScreen(name) {
    const item = greenScreenItems.get(name);
    if (!item) return;
    if (item.video) {
      try {
        item.video.pause();
        item.video.removeAttribute('src');
        item.video.load();
      } catch { }
    }
    if (item.wrapper) item.wrapper.remove();
    if (item.video) item.video.remove();
    greenScreenItems.delete(name);
  }

  function renderGreenScreenFrame(item) {
    const video = item.video;
    const canvas = item.canvas;
    const ctx = item.ctx;
    if (!video || !canvas || !ctx || video.readyState < 2) return;

    const srcWidth = video.videoWidth || 0;
    const srcHeight = video.videoHeight || 0;
    if (!srcWidth || !srcHeight) return;

    const maxDim = 720;
    const scale = Math.min(1, maxDim / Math.max(srcWidth, srcHeight));
    const renderWidth = Math.max(2, Math.round(srcWidth * scale));
    const renderHeight = Math.max(2, Math.round(srcHeight * scale));
    if (canvas.width !== renderWidth || canvas.height !== renderHeight) {
      canvas.width = renderWidth;
      canvas.height = renderHeight;
    }

    ctx.clearRect(0, 0, renderWidth, renderHeight);
    ctx.drawImage(video, 0, 0, renderWidth, renderHeight);

    if (!item.settings.chromaKey) return;

    const imageData = ctx.getImageData(0, 0, renderWidth, renderHeight);
    const pixels = imageData.data;
    const key = item.settings.keyColor;
    const threshold = item.settings.threshold;
    const feather = Math.max(0.001, item.settings.feather);
    const fadeEnd = threshold + feather;
    for (let i = 0; i < pixels.length; i += 4) {
      const dr = pixels[i] - key.r;
      const dg = pixels[i + 1] - key.g;
      const db = pixels[i + 2] - key.b;
      const dist = Math.sqrt(dr * dr + dg * dg + db * db) / 441.67295593;
      if (dist <= threshold) {
        pixels[i + 3] = 0;
      } else if (dist < fadeEnd) {
        pixels[i + 3] = Math.round(pixels[i + 3] * ((dist - threshold) / feather));
      }
    }
    ctx.putImageData(imageData, 0, 0);
  }

  function ensureGreenScreenPlayback(item) {
    if (!item || !item.video) return;
    const video = item.video;
    if (!video.paused || item.userPaused) return;
    if (video.ended) {
      try {
        video.currentTime = 0;
      } catch { }
    }
    if (video.readyState < 2) return;
    const playPromise = video.play();
    if (playPromise && playPromise.catch) {
      playPromise.catch(() => {
        if (!video.paused || item.userPaused) return;
      });
    }
  }

  function updateGreenScreenPosition(kp, item) {
    const hotspotPath = `hotspot[${item.name}]`;
    const ath = parseNum(kp.get(`${hotspotPath}.ath`), NaN);
    const atv = parseNum(kp.get(`${hotspotPath}.atv`), NaN);
    if (!Number.isFinite(ath) || !Number.isFinite(atv)) {
      item.wrapper.style.display = 'none';
      return;
    }

    const halfWidth = item.settings.width / 2;
    const center = kp.spheretoscreen(ath, atv);
    const left = kp.spheretoscreen(ath - halfWidth, atv);
    const right = kp.spheretoscreen(ath + halfWidth, atv);
    if (!center || !left || !right || center.z <= 0 || left.z <= 0 || right.z <= 0) {
      item.wrapper.style.display = 'none';
      return;
    }

    const hotspotWidth = parseNum(kp.get(`${hotspotPath}.width`), NaN);
    const hotspotHeight = parseNum(kp.get(`${hotspotPath}.height`), NaN);
    const hotspotScale = parseNum(kp.get(`${hotspotPath}.scale`), NaN);
    const aspect = (item.video.videoWidth && item.video.videoHeight)
      ? (item.video.videoWidth / item.video.videoHeight)
      : (9 / 16);
    let displayWidth = Math.max(1, Math.abs(right.x - left.x));
    let displayHeight = displayWidth / aspect;
    if (Number.isFinite(hotspotWidth) && hotspotWidth > 0 && Number.isFinite(hotspotScale) && hotspotScale > 0) {
      displayWidth = hotspotWidth * hotspotScale;
      if (Number.isFinite(hotspotHeight) && hotspotHeight > 0) {
        displayHeight = hotspotHeight * hotspotScale;
      } else {
        displayHeight = displayWidth / aspect;
      }
    }
    const stageWidth = parseNum(kp.get('stagewidth'), window.innerWidth || 0);
    const stageHeight = parseNum(kp.get('stageheight'), window.innerHeight || 0);
    const visible = displayWidth > 6
      && center.x > -displayWidth && center.x < stageWidth + displayWidth
      && center.y > -displayHeight && center.y < stageHeight + displayHeight;

    item.wrapper.style.display = visible ? 'block' : 'none';
    if (!visible) return;

    item.wrapper.style.left = `${center.x}px`;
    item.wrapper.style.top = `${center.y}px`;
    item.wrapper.style.width = `${displayWidth}px`;
    item.wrapper.style.height = `${displayHeight}px`;
    item.wrapper.style.filter = item.settings.shadow ? 'drop-shadow(0 14px 20px rgba(0,0,0,0.35))' : 'none';
    item.wrapper.style.pointerEvents = 'auto';
    item.wrapper.style.outline = isEditorEditMode() ? '2px dashed rgba(74,158,255,0.7)' : 'none';
    item.wrapper.style.outlineOffset = isEditorEditMode() ? '3px' : '0';
    item.wrapper.style.cursor = isEditorEditMode() ? 'move' : 'pointer';
    if (item.badge) item.badge.style.display = isEditorEditMode() ? 'block' : 'none';

    kp.set(`${hotspotPath}.alpha`, 0);
    kp.set(`${hotspotPath}.capture`, false);
    kp.set(`${hotspotPath}.muted`, true);
    kp.set(`${hotspotPath}.volume`, 0);
    kp.set(`${hotspotPath}.pausedonstart`, true);
    try {
      kp.call(`if(hotspot[${item.name}].ispaused != true, hotspot[${item.name}].pause(););`);
    } catch { }
  }

  async function ensureGreenScreen(sceneSource, name, currentSceneId) {
    if (greenScreenItems.has(name) || pendingGreenScreens.has(name)) return;
    pendingGreenScreens.add(name);
    try {
      const data = await getInfoData(sceneSource, name);
      const kp = getKrpano();
      const info = kp ? getCurrentSceneInfo(kp) : null;
      if (!kp || !info || info.sceneId !== currentSceneId || info.sourcefile !== sceneSource) return;
      if (!data.video) return;

      const wrapper = document.createElement('div');
      wrapper.id = `pano-greenscreen-${name}`;
      Object.assign(wrapper.style, {
        position: 'fixed',
        left: '0',
        top: '0',
        transform: 'translate(-50%, -100%)',
        transformOrigin: '50% 100%',
        zIndex: '150000',
        pointerEvents: window.__PANO_EDITOR_ACTIVE ? 'none' : 'auto',
        display: 'none',
      });

      const canvas = document.createElement('canvas');
      canvas.style.cssText = 'width:100%;height:100%;display:block;background:transparent;';
      wrapper.appendChild(canvas);

      const badge = document.createElement('div');
      badge.textContent = data.title || '绿幕讲解';
      badge.style.cssText = 'position:absolute;left:50%;bottom:calc(100% + 8px);transform:translateX(-50%);padding:3px 8px;border-radius:999px;background:rgba(18,24,35,0.88);color:#fff;font:12px/1.2 system-ui,sans-serif;white-space:nowrap;display:none;pointer-events:none;';
      wrapper.appendChild(badge);

      const video = document.createElement('video');
      video.src = data.video || '';
      video.autoplay = true;
      video.loop = parseBool(data.loop, true);
      video.muted = parseBool(data.muted, false);
      video.playsInline = true;
      video.preload = 'auto';
      video.crossOrigin = 'anonymous';
      video.style.display = 'none';
      wrapper.title = data.title || name;

      let dragState = null;

      function togglePlayback() {
        if (video.muted) {
          item.userPaused = false;
          video.muted = false;
          const playPromise = video.play();
          if (playPromise && playPromise.catch) playPromise.catch(() => { });
          return;
        }
        if (video.paused) {
          item.userPaused = false;
          const playPromise = video.play();
          if (playPromise && playPromise.catch) playPromise.catch(() => { });
        } else {
          item.userPaused = true;
          video.pause();
        }
      }
      wrapper.addEventListener('pointerdown', (e) => {
        if (!isEditorEditMode()) return;
        const kpNow = getKrpano();
        const currentAth = kpNow ? parseNum(kpNow.get(`hotspot[${name}].ath`), NaN) : NaN;
        const currentAtv = kpNow ? parseNum(kpNow.get(`hotspot[${name}].atv`), NaN) : NaN;
        const anchor = (kpNow && Number.isFinite(currentAth) && Number.isFinite(currentAtv))
          ? kpNow.spheretoscreen(currentAth, currentAtv)
          : null;
        dragState = {
          pointerId: e.pointerId,
          moved: false,
          offsetX: anchor ? (e.clientX - anchor.x) : 0,
          offsetY: anchor ? (e.clientY - anchor.y) : 0,
        };
        wrapper.setPointerCapture(e.pointerId);
        e.preventDefault();
        e.stopPropagation();
      });
      wrapper.addEventListener('pointermove', (e) => {
        if (!dragState || dragState.pointerId !== e.pointerId || !isEditorEditMode()) return;
        const kpNow = getKrpano();
        const panoEl = document.getElementById('krpanoSWFObject');
        if (!kpNow || !panoEl) return;
        const rect = panoEl.getBoundingClientRect();
        const stageX = e.clientX - rect.left - (dragState.offsetX || 0);
        const stageY = e.clientY - rect.top - (dragState.offsetY || 0);
        const coords = kpNow.screentosphere(stageX, stageY);
        if (!coords) return;
        dragState.moved = true;
        kpNow.set(`hotspot[${name}].ath`, coords.x);
        kpNow.set(`hotspot[${name}].atv`, coords.y);
        e.preventDefault();
        e.stopPropagation();
      });
      wrapper.addEventListener('pointerup', async (e) => {
        if (!dragState || dragState.pointerId !== e.pointerId) return;
        const moved = dragState.moved;
        dragState = null;
        try { wrapper.releasePointerCapture(e.pointerId); } catch { }
        if (moved && isEditorEditMode()) {
          const kpNow = getKrpano();
          const infoNow = kpNow ? getCurrentSceneInfo(kpNow) : null;
          if (kpNow && infoNow) {
            const newAth = parseNum(kpNow.get(`hotspot[${name}].ath`), 0);
            const newAtv = parseNum(kpNow.get(`hotspot[${name}].atv`), 0);
            try {
              await fetch('/api/hotspot', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ scene: infoNow.sourcefile, name, ath: newAth, atv: newAtv }),
              });
            } catch (err) {
              console.warn('[pano-runtime] failed to persist greenscreen drag', err);
            }
          }
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        if (window.__PANO_EDITOR_ACTIVE) {
          if (typeof window.__pano_editor_hotspotclick === 'function') {
            window.__pano_editor_hotspotclick(name);
          }
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        togglePlayback();
      });

      document.body.appendChild(wrapper);
      document.body.appendChild(video);

      const item = {
        name,
        wrapper,
        badge,
        canvas,
        video,
        userPaused: false,
        ctx: canvas.getContext('2d', { willReadFrequently: true }),
        settings: {
          width: Math.max(0.5, parseNum(data.width, 12)),
          chromaKey: parseBool(data.chromaKey, true),
          keyColor: parseColor(data.keyColor),
          threshold: Math.min(Math.max(parseNum(data.threshold, 0.26), 0.05), 0.35),
          feather: Math.min(Math.max(parseNum(data.feather, 0.08), 0.02), 0.16),
          shadow: parseBool(data.shadow, true),
        },
      };

      const tryPlay = () => {
        const playPromise = video.play();
        if (playPromise && playPromise.catch) {
          playPromise.catch(() => {
            if (!video.paused) return;
          });
        }
        window.setTimeout(() => {
          if (!video.paused) return;
        }, 250);
      };
      video.addEventListener('loadeddata', tryPlay, { once: true });
      tryPlay();
      greenScreenItems.set(name, item);
    } finally {
      pendingGreenScreens.delete(name);
    }
  }

  function syncGreenScreens() {
    const kp = getKrpano();
    if (!kp) return;
    const sceneInfo = getCurrentSceneInfo(kp);
    if (!sceneInfo || !sceneInfo.sourcefile) {
      greenScreenItems.forEach((_, name) => removeGreenScreen(name));
      activeGreenScreenScene = '';
      return;
    }

    const names = new Set();
    const hotspotCount = parseNum(kp.get('hotspot.count'), 0);
    for (let i = 0; i < hotspotCount; i++) {
      const name = kp.get(`hotspot[${i}].name`);
      const type = kp.get(`hotspot[${i}].editor_type`) || kp.get(`hotspot[${i}].type`) || 'nav';
      if (name && type === 'greenscreen') {
        names.add(name);
        ensureGreenScreen(sceneInfo.sourcefile, name, sceneInfo.sceneId);
      }
    }

    if (activeGreenScreenScene && activeGreenScreenScene !== sceneInfo.sceneId) {
      greenScreenItems.forEach((_, name) => removeGreenScreen(name));
    }
    activeGreenScreenScene = sceneInfo.sceneId;

    for (const name of Array.from(greenScreenItems.keys())) {
      if (!names.has(name)) {
        removeGreenScreen(name);
        continue;
      }
      const item = greenScreenItems.get(name);
      ensureGreenScreenPlayback(item);
      updateGreenScreenPosition(kp, item);
      renderGreenScreenFrame(item);
    }
  }

  function greenScreenLoop() {
    syncGreenScreens();
    window.requestAnimationFrame(greenScreenLoop);
  }

  function showInfoOverlay(data) {
    closeLegacyVideoOverlay();
    removeExisting(['pano-info-overlay', 'pano-link-overlay', 'pano-video-overlay']);

    const backdrop = document.createElement('div');
    backdrop.id = 'pano-info-overlay';
    Object.assign(backdrop.style, {
      position: 'fixed', inset: '0', zIndex: '200000',
      background: 'rgba(0,0,0,0.65)', display: 'flex',
      alignItems: 'center', justifyContent: 'center',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    });
    backdrop.onclick = (e) => { if (e.target === backdrop) backdrop.remove(); };
    onEscapeClose(backdrop);

    const card = document.createElement('div');
    Object.assign(card.style, {
      background: '#fff', borderRadius: '12px', width: '92%', maxWidth: '780px',
      maxHeight: '86vh', overflow: 'hidden', display: 'flex', flexDirection: 'column',
      boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
    });

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;padding:16px 20px;border-bottom:1px solid #eee;gap:12px;';
    const title = document.createElement('div');
    title.style.cssText = 'flex:1;font-size:20px;font-weight:700;color:#222;';
    title.textContent = data.title || '展项详情';
    const closeBtn = document.createElement('button');
    closeBtn.innerHTML = '✕';
    closeBtn.style.cssText = 'background:none;border:none;font-size:20px;cursor:pointer;color:#999;padding:0 4px;';
    closeBtn.onclick = () => backdrop.remove();
    header.appendChild(title);
    header.appendChild(closeBtn);
    card.appendChild(header);

    const content = document.createElement('div');
    content.style.cssText = 'padding:20px;overflow:auto;';

    if (data.audio || data.qrcode) {
      const audioBox = document.createElement('div');
      audioBox.style.cssText = 'background:#f0f6ff;border-radius:10px;padding:14px 18px;margin-bottom:18px;display:flex;gap:16px;align-items:flex-start;';
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

  function showLinkOverlay(url) {
    if (!url) {
      window.alert('未设置链接地址');
      return;
    }

    closeLegacyVideoOverlay();
    removeExisting(['pano-info-overlay', 'pano-link-overlay', 'pano-video-overlay']);

    const backdrop = document.createElement('div');
    backdrop.id = 'pano-link-overlay';
    Object.assign(backdrop.style, {
      position: 'fixed', inset: '0', zIndex: '200000', background: 'rgba(0,0,0,0.65)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    });
    backdrop.onclick = (e) => { if (e.target === backdrop) backdrop.remove(); };
    onEscapeClose(backdrop);

    const card = document.createElement('div');
    Object.assign(card.style, {
      background: '#fff', borderRadius: '12px', width: '94%', maxWidth: '1100px', height: '85vh',
      overflow: 'hidden', display: 'flex', flexDirection: 'column',
      boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
    });

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
    closeBtn.onclick = () => backdrop.remove();
    bar.appendChild(urlLabel);
    bar.appendChild(openNewBtn);
    bar.appendChild(closeBtn);
    card.appendChild(bar);

    const iframeWrap = document.createElement('div');
    iframeWrap.style.cssText = 'flex:1;position:relative;min-height:0;';
    const fallback = document.createElement('div');
    Object.assign(fallback.style, {
      position: 'absolute', inset: '0', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', background: '#fafafa', gap: '16px', zIndex: '1',
    });
    fallback.innerHTML = '<div style="font-size:40px;opacity:0.3;">⏳</div><div style="font-size:14px;color:#888;">正在加载页面...</div>';

    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'width:100%;height:100%;border:none;position:relative;z-index:2;background:#fff;';
    iframe.setAttribute('referrerpolicy', 'no-referrer');
    iframe.src = url;

    let loaded = false;
    iframe.onload = () => {
      loaded = true;
      fallback.style.display = 'none';
    };
    setTimeout(() => {
      if (!loaded) {
        fallback.innerHTML =
          '<div style="font-size:48px;opacity:0.25;">🚫</div>' +
          '<div style="font-size:15px;font-weight:500;color:#555;">该网站不允许在嵌入式窗口中显示</div>' +
          '<div style="font-size:12px;color:#999;max-width:360px;text-align:center;line-height:1.6;">部分网站出于安全策略限制了嵌入访问，请点击下方按钮在新标签页中打开。</div>' +
          '<button id="pano-link-fallback-btn" style="margin-top:8px;background:#4A9EFF;color:#fff;border:none;border-radius:6px;padding:10px 28px;font-size:14px;cursor:pointer;">在新标签页中打开</button>';
        const fbBtn = fallback.querySelector('#pano-link-fallback-btn');
        if (fbBtn) fbBtn.onclick = () => window.open(url, '_blank');
        iframe.style.display = 'none';
      }
    }, 4000);

    iframeWrap.appendChild(fallback);
    iframeWrap.appendChild(iframe);
    card.appendChild(iframeWrap);
    backdrop.appendChild(card);
    document.body.appendChild(backdrop);
  }

  function showVideoOverlay(data) {
    const url = (data && (data.video || data.videoUrl || data.videourl)) || '';
    if (!url) {
      window.alert('未设置视频地址');
      return;
    }

    closeLegacyVideoOverlay();
    removeExisting(['pano-info-overlay', 'pano-link-overlay', 'pano-video-overlay']);
    suspendNarrationForVideo();

    const backdrop = document.createElement('div');
    backdrop.id = 'pano-video-overlay';
    Object.assign(backdrop.style, {
      position: 'fixed', inset: '0', zIndex: '200000', background: 'rgba(0,0,0,0.65)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    });
    backdrop.__panoCleanup = () => {
      try {
        video.pause();
      } catch { }
      resumeNarrationAfterVideo();
    };
    backdrop.onclick = (e) => { if (e.target === backdrop) safeRemove(backdrop); };
    onEscapeClose(backdrop);

    const card = document.createElement('div');
    Object.assign(card.style, {
      background: '#fff', borderRadius: '12px', width: '92%', maxWidth: '960px',
      maxHeight: '86vh', overflow: 'hidden', display: 'flex', flexDirection: 'column',
      boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
    });

    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;align-items:center;padding:16px 20px;border-bottom:1px solid #eee;gap:12px;';
    const title = document.createElement('div');
    title.style.cssText = 'flex:1;font-size:20px;font-weight:700;color:#222;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    title.textContent = data.title || '视频播放';
    const closeBtn = document.createElement('button');
    closeBtn.innerHTML = '✕';
    closeBtn.style.cssText = 'background:none;border:none;font-size:20px;cursor:pointer;color:#999;padding:0 4px;';
    closeBtn.onclick = () => safeRemove(backdrop);
    bar.appendChild(title);
    bar.appendChild(closeBtn);
    card.appendChild(bar);

    const body = document.createElement('div');
    body.style.cssText = 'padding:20px;overflow:auto;';

    if (data.text) {
      const summary = document.createElement('p');
      summary.style.cssText = 'margin:0 0 16px;font-size:13px;line-height:1.9;color:#555;white-space:pre-wrap;';
      summary.textContent = data.text;
      body.appendChild(summary);
    }

    const playerWrap = document.createElement('div');
    playerWrap.style.cssText = 'background:#0f172a;border-radius:10px;padding:12px;box-shadow:inset 0 0 0 1px rgba(255,255,255,0.06);';
    const video = document.createElement('video');
    const playbackNotice = document.createElement('div');
    playbackNotice.style.cssText = 'display:none;margin:0 0 12px;padding:10px 12px;border-radius:8px;background:rgba(255,255,255,0.08);color:#e2e8f0;font-size:13px;line-height:1.6;';
    const playbackAction = document.createElement('button');
    playbackAction.type = 'button';
    playbackAction.textContent = '点击播放视频';
    playbackAction.style.cssText = 'display:none;margin:0 0 12px;padding:9px 14px;border:0;border-radius:999px;background:#38bdf8;color:#082f49;font-size:13px;font-weight:700;cursor:pointer;';
    let playbackDisposed = false;
    let playbackTimer = 0;
    const showPlaybackPrompt = () => {
      playbackNotice.textContent = '浏览器拦截了带声音的自动播放，请点击下方按钮开始播放。';
      playbackNotice.style.display = 'block';
      playbackAction.style.display = 'inline-flex';
    };
    const clearPlaybackPrompt = () => {
      playbackNotice.style.display = 'none';
      playbackNotice.textContent = '';
      playbackAction.style.display = 'none';
    };
    const tryStartPlayback = (userInitiated) => {
      if (playbackDisposed) return;
      try {
        const playPromise = video.play();
        if (playPromise && playPromise.catch) {
          playPromise.catch(() => {
            if (playbackDisposed || !video.paused) return;
            if (!userInitiated) showPlaybackPrompt();
          });
        }
      } catch { }
    };
    const handleCanPlay = () => {
      if (video.paused) tryStartPlayback(false);
    };
    playbackAction.onclick = () => {
      clearPlaybackPrompt();
      tryStartPlayback(true);
    };
    video.controls = true;
    video.autoplay = true;
    video.playsInline = true;
    video.preload = 'metadata';
    video.loop = parseBool(data.loop, false);
    video.muted = false;
    video.src = url;
    if (data.image) video.poster = data.image;
    video.style.cssText = 'width:100%;max-height:68vh;display:block;border-radius:8px;background:#000;';
    video.addEventListener('play', clearPlaybackPrompt);
    video.addEventListener('loadedmetadata', handleCanPlay);
    video.addEventListener('canplay', handleCanPlay);
    playerWrap.appendChild(playbackNotice);
    playerWrap.appendChild(playbackAction);
    playerWrap.appendChild(video);
    body.appendChild(playerWrap);
    card.appendChild(body);

    backdrop.appendChild(card);
    document.body.appendChild(backdrop);
    playbackTimer = window.setTimeout(() => {
      if (video.paused) tryStartPlayback(false);
    }, 120);
    tryStartPlayback(false);
    backdrop.__panoCleanup = () => {
      playbackDisposed = true;
      if (playbackTimer) window.clearTimeout(playbackTimer);
      video.removeEventListener('play', clearPlaybackPrompt);
      video.removeEventListener('loadedmetadata', handleCanPlay);
      video.removeEventListener('canplay', handleCanPlay);
      try {
        video.pause();
      } catch { }
      try {
        video.removeAttribute('src');
        video.load();
      } catch { }
      resumeNarrationAfterVideo();
    };
  }

  window.__pano_runtime_invalidateHotspot = invalidateHotspot;
  window.__pano_runtime_refreshHotspot = invalidateHotspot;

  window.__pano_runtime_openInfo = async function (scene, name) {
    const data = await getInfoData(scene, name);
    if (!data.title) data.title = name;
    showInfoOverlay(data);
  };

  window.__pano_runtime_openLink = async function (scene, name) {
    const data = await getInfoData(scene, name);
    showLinkOverlay(data.linkUrl || '');
  };

  window.__pano_runtime_openVideo = function (scene, name) {
    const cached = getCachedInfoData(scene, name);
    if (cached) {
      if (!cached.title) cached.title = '视频播放';
      showVideoOverlay(cached);
      return;
    }
    getInfoData(scene, name).then((data) => {
      if (!data.title) data.title = '视频播放';
      showVideoOverlay(data);
    });
  };

  window.__pano_runtime_suspendNarrationForVideo = suspendNarrationForVideo;
  window.__pano_runtime_resumeNarrationAfterVideo = resumeNarrationAfterVideo;
  window.__pano_runtime_closeLegacyVideoOverlay = closeLegacyVideoOverlay;

  warmInfoManifest();

  // Use krpano native greenscreen hotspots directly. Do not mount HTML/canvas overlays.

})();
