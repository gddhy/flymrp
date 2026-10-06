/* ============================================================================
 * flymrp · 飞牛 fnOS 集成层
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 flymrp contributors
 *
 * 职责：
 *  1. 宿主判定（PC iframe / 移动端 Flutter WebView / 独立浏览器）
 *  2. 「打开 MRP」来源二选一：本机文件 / 飞牛 NAS 文件
 *  3. 截图保存二选一：保存到本机 / 保存到 NAS
 *  4. 文件关联打开（?path=/vol1/xx.mrp，双击 MRP 文件直接进模拟器）
 *  5. 页面版本指纹自校验（升级 fpk 后防旧缓存）
 * 本文件不依赖构建工具， vanilla JS；SDK 由 vendor/trimjs-web-app.js 全局提供。
 * ========================================================================== */
(function (global) {
  'use strict';

  var VERSION = '1.0.0';
  var BRIDGE_LOG = [];
  var sdk = null;
  var sdkReady = false;
  var flutterPlatformReady = false;
  var launchHandled = false;
  var inFnOS = false;

  /* ---------------- 基础工具 ---------------- */

  function apiBase() {
    var p = global.location.pathname || '/';
    if (/\/[^\/]*\.[^\/]*$/.test(p)) p = p.replace(/\/[^\/]*$/, '/');
    return p.replace(/\/+$/, '');
  }
  function apiUrl(p) {
    return /^https?:\/\//i.test(p) ? p : apiBase() + (p[0] === '/' ? p : '/' + p);
  }
  function $(sel) { return document.querySelector(sel); }
  function baseName(p) { return String(p).replace(/\\/g, '/').split('/').pop() || p; }

  function toast(msg, ms) {
    var t = $('#fnos-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'fnos-toast';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._timer);
    t._timer = setTimeout(function () { t.classList.remove('show'); }, ms || 2600);
  }

  /* ---------------- 宿主判定（双分支，见文档） ---------------- */

  function inIframeNow() {
    try { return global.self !== global.top; } catch (e) { return true; }
  }
  function isMobileWebView() {
    if (global.flutter_inappwebview) return true;
    if (flutterPlatformReady) return true;
    return /FNAppType\/|FNOS\//.test(navigator.userAgent || '');
  }
  function computeInFnOS() {
    if (!sdk) return false;
    if (sdk.isWeb === false) return isMobileWebView();
    if (sdk.isStandaloneWeb === true) return false;
    return inIframeNow();
  }
  function refreshHostDetection() {
    var now = computeInFnOS();
    if (now && !inFnOS) {
      inFnOS = true;                       // 一旦确认为 true 就保持，避免握手抖动
    }
    return inFnOS;
  }

  /* ---------------- 错误码（-1 才是用户取消） ---------------- */

  var ERROR_TEXT = {
    '-1': '已取消',
    '1000000': '服务异常，请稍后重试',
    '1000001': '登录状态失效，请重新登录',
    '1000002': '应用权限不足，请重新安装应用',
    '1000030': '当前路径不支持该操作',
    '1000300': '应用未安装或未运行',
    '1000701': '路径不存在，请重新选择',
    '1003103': '应用权限校验失败，请重新安装应用，或先在文件应用中收藏目标目录后重试',
    '1003201': '管理员已关闭普通用户授权，请联系管理员'
  };
  var lastPickError = null;
  function isUserCancel() {
    return !!(lastPickError && (lastPickError.code === -1 ||
      /取消|cancel/i.test(lastPickError.msg || '')));
  }
  function handleBridgeResponse(r) {
    if (r && !Array.isArray(r) && typeof r.code === 'number') {
      if (r.code === 0) {
        lastPickError = null;
        var d = r.data;
        if (Array.isArray(d)) return d.length ? d[0] : null;
        if (typeof d === 'string' && d) return d;
        return null;
      }
      lastPickError = { code: r.code, msg: r.msg || '' };
      toast(ERROR_TEXT[String(r.code)] || ('操作失败: ' + (r.msg || r.code)));
      return null;
    }
    if (Array.isArray(r)) { lastPickError = null; return r.length ? r[0] : null; }
    return null;
  }

  /* ---------------- bridge 探针（真机排查用） ---------------- */

  function instrumentBridge() {
    var fb = global.flutter_inappwebview;
    if (!fb || typeof fb.callHandler !== 'function' || fb.__flymrpProbed) return;
    var orig = fb.callHandler;
    fb.callHandler = function (name) {
      var ret = orig.apply(this, arguments);
      if (ret && typeof ret.then === 'function') {
        return ret.then(function (raw) {
          BRIDGE_LOG.push({ at: Date.now(), method: name, raw: raw });
          if (BRIDGE_LOG.length > 30) BRIDGE_LOG.shift();
          return raw;
        });
      }
      return ret;
    };
    fb.__flymrpProbed = true;
  }

  /* ---------------- SDK 初始化 ---------------- */

  function initSdk() {
    if (typeof global.TrimApp !== 'function') return;   // 独立浏览器调试，无 SDK
    try {
      sdk = new global.TrimApp();
    } catch (e) { return; }
    instrumentBridge();
    // 移动端 bridge 可能晚于脚本加载
    global.addEventListener('flutterInAppWebViewPlatformReady', function () {
      flutterPlatformReady = true;
      instrumentBridge();
      refreshHostDetection();
    });
    sdk.ready().then(function () {
      sdkReady = true;
      refreshHostDetection();
      syncFnosButtons();
    }, function () { /* 独立浏览器 ready 会 resolve，失败忽略 */ });
    refreshHostDetection();
  }

  /* ---------------- 打开 MRP：本机 / NAS 二选一 ---------------- */

  function loadFromBytes(name, bytes) {
    var input = $('#file');
    if (!input) { toast('模拟器尚未就绪，请稍候重试'); return; }
    var file = new File([bytes], name, { type: 'application/octet-stream' });
    var dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function openNasMrp() {
    if (!sdk) { toast('未在飞牛环境中运行'); return; }
    sdk.ready().then(function () {
      return sdk.pickUserFile({
        directory: false, multiple: false, title: '选择 MRP 文件',
        accept: ['.mrp']
      });
    }).then(function (r) {
      var p = handleBridgeResponse(r);
      if (!p) return;                          // 取消或已提示错误
      if (!/\.mrp$/i.test(p)) { toast('请选择 .mrp 文件'); return; }
      toast('正在读取 NAS 文件…');
      return fetch(apiUrl('/api/open-file?path=' + encodeURIComponent(p)), { cache: 'no-store' })
        .then(function (res) {
          if (!res.ok) throw new Error('读取失败（HTTP ' + res.status + '）');
          return res.arrayBuffer().then(function (buf) { loadFromBytes(baseName(p), buf); });
        })
        .catch(function (e) { toast(e.message || '读取 NAS 文件失败'); });
    }, function () { /* SDK ready 失败静默 */ });
  }

  function showSourcePick() {
    var d = $('#fnos-src-dialog');
    if (d && typeof d.showModal === 'function') { d.showModal(); return; }
    openNasMrp();                              // 无 dialog 支持时直接走 NAS
  }

  var programmaticPick = false;   // 「本机文件」编程触发 click 时绕过来源二选一拦截

  function hookFileEntry() {
    var input = $('#file');
    if (!input || input.__flymrpHooked) return;
    input.__flymrpHooked = true;
    // 捕获阶段拦截：飞牛环境改为来源二选一，浏览器环境保持原生
    input.addEventListener('click', function (e) {
      if (programmaticPick) { programmaticPick = false; return; }
      if (refreshHostDetection()) { e.preventDefault(); showSourcePick(); }
    }, true);
  }

  /* ---------------- 截图：保存到本机 / NAS ---------------- */

  function rememberSaveDir(dir) {
    if (!dir) return;
    try {
      localStorage.setItem('flymrp.lastSaveDir', dir);
      var hist = JSON.parse(localStorage.getItem('flymrp.lastSaveDirs') || '[]');
      if (!Array.isArray(hist)) hist = [];
      hist = hist.filter(function (x) { return x !== dir; });
      hist.unshift(dir);
      localStorage.setItem('flymrp.lastSaveDirs', JSON.stringify(hist.slice(0, 8)));
    } catch (e) { /* 隐私模式忽略 */ }
  }

  function saveShotToNas(blob, name) {
    if (!sdk) { toast('未在飞牛环境中运行'); return; }
    var last = null;
    try { last = localStorage.getItem('flymrp.lastSaveDir'); } catch (e) { /* 忽略 */ }
    sdk.ready().then(function () {
      return sdk.pickUserFile({
        directory: true, title: '选择保存目录',
        sidebarGroup: last ? undefined : ['myFiles', 'otherShare']
      });
    }).then(function (r) {
      var dir = handleBridgeResponse(r);
      if (!dir) {
        if (!isUserCancel()) { /* 鉴权类失败已在 handleBridgeResponse 提示 */ }
        return;
      }
      rememberSaveDir(dir);
      var fr = new FileReader();
      fr.onload = function () {
        var b64 = String(fr.result).slice(String(fr.result).indexOf(',') + 1);
        toast('正在保存到 NAS…');
        fetch(apiUrl('/api/save-file'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dir: dir, name: name, data: b64 })
        }).then(function (res) { return res.json().catch(function () { return {}; }); })
          .then(function (j) {
            if (j && j.ok) toast('已保存到 ' + dir + '/' + name);
            else toast('保存失败: ' + ((j && j.error) || '未知错误'));
          })
          .catch(function () { toast('保存失败：无法连接应用服务'); });
      };
      fr.readAsDataURL(blob);
    }, function () { /* 忽略 */ });
  }

  function hookScreenshot() {
    var btn = $('#screenshot');
    var canvas = $('#screen');
    if (!btn || !canvas || btn.__flymrpHooked) return;
    btn.__flymrpHooked = true;
    // 克隆节点丢弃播放器内置的"本机下载"监听，改由本层统一提供两种保存方式
    var clone = btn.cloneNode(true);
    btn.parentNode.replaceChild(clone, btn);
    clone.addEventListener('click', function () {
      var title = ($('#game-title') && $('#game-title').textContent) || 'flymrp';
      var name = (title.trim() || 'flymrp').replace(/[\\/:*?"<>|]/g, '_') + '.png';
      canvas.toBlob(function (blob) {
        if (!blob) { toast('截图失败'); return; }
        if (refreshHostDetection()) {
          var d = $('#fnos-save-dialog');
          d._blob = blob; d._name = name;
          if (typeof d.showModal === 'function') d.showModal();
          else downloadBlob(blob, name);
        } else {
          downloadBlob(blob, name);
        }
      }, 'image/png');
    });
  }

  function downloadBlob(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name; a.click();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  /* ---------------- 文件关联打开（?path=/vol1/xx.mrp） ---------------- */

  function getQueryParam(name) {
    // 宿主用 form-urlencoded 传参（空格是 '+'），URLSearchParams 一次搞定两种编码。
    // 返回值已是解码结果，链路上不得再 decodeURIComponent。
    var r = null;
    try { r = new URLSearchParams(global.location.search).get(name); } catch (e) { /* 忽略 */ }
    if (r != null && r !== '') return r;
    try {
      if (global.parent && global.parent !== global && global.parent.location) {
        var pv = new URLSearchParams(String(global.parent.location.search || '')).get(name);
        if (pv != null && pv !== '') return pv;
      }
    } catch (e2) { /* 跨域忽略 */ }
    return null;
  }

  function waitForFileInput(cb, tries) {
    var input = $('#file');
    if (input && input.__flymrpHooked !== false) { cb(input); return; }
    if (tries <= 0) { toast('模拟器加载超时'); return; }
    setTimeout(function () { waitForFileInput(cb, tries - 1); }, 300);
  }

  function handleLaunch() {
    if (launchHandled) return;
    var path = getQueryParam('path');
    if (!path) return;
    if (!/\.mrp$/i.test(path)) return;
    launchHandled = true;
    waitForFileInput(function () {
      toast('正在打开 ' + baseName(path) + ' …');
      fetch(apiUrl('/api/open-file?path=' + encodeURIComponent(path)), { cache: 'no-store' })
        .then(function (res) {
          if (!res.ok) throw new Error('读取失败（HTTP ' + res.status + '）');
          return res.arrayBuffer();
        })
        .then(function (buf) { loadFromBytes(baseName(path), buf); })
        .catch(function (e) { toast(e.message || '打开文件失败'); });
    }, 40);
  }

  /* ---------------- 版本指纹自校验 ---------------- */

  function checkStalePage() {
    var localStamp = global.__FLYMRP_WWW_STAMP;
    if (!localStamp) return;
    fetch(apiUrl('/api/health'), { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        var s = j && j.wwwStamp;
        if (!s || s === localStamp) return;
        var last = parseInt(sessionStorage.getItem('flymrp_stale_reload_at') || '0', 10) || 0;
        if (Date.now() - last < 60000) return;
        sessionStorage.setItem('flymrp_stale_reload_at', String(Date.now()));
        var u = new URL(global.location.href);
        u.searchParams.set('_v', s);
        global.location.replace(u.toString());
      })
      .catch(function () { /* 忽略 */ });
  }

  /* ---------------- UI：弹层与样式 ---------------- */

  function injectUi() {
    var css = document.createElement('style');
    css.textContent = [
      '#fnos-toast{position:fixed;left:50%;bottom:96px;transform:translateX(-50%);',
      'background:rgba(20,20,20,.86);color:#fff;padding:9px 16px;border-radius:10px;',
      'font:14px/1.4 system-ui,sans-serif;opacity:0;pointer-events:none;transition:opacity .25s;',
      'z-index:9999;max-width:80vw;text-align:center}',
      '#fnos-toast.show{opacity:1}',
      '.fnos-dialog{border:none;border-radius:14px;padding:20px 22px;min-width:260px;',
      'max-width:86vw;font:15px/1.5 system-ui,sans-serif;box-shadow:0 8px 32px rgba(0,0,0,.25)}',
      '.fnos-dialog::backdrop{background:rgba(0,0,0,.4)}',
      '.fnos-dialog h3{margin:0 0 14px;font-size:16px}',
      '.fnos-dialog .fnos-btns{display:flex;gap:10px;margin-top:16px}',
      '.fnos-dialog button{flex:1;padding:10px 8px;border-radius:9px;border:1px solid #c9c9c9;',
      'background:#f5f5f5;font:inherit;cursor:pointer}',
      '.fnos-dialog button.primary{background:#1a73e8;border-color:#1a73e8;color:#fff}',
      '@media (prefers-color-scheme: dark){',
      '.fnos-dialog{background:#1e1e1e;color:#eee}',
      '.fnos-dialog button{background:#2c2c2c;border-color:#444;color:#eee}}'
    ].join('');
    document.head.appendChild(css);

    function makeDialog(id, title, buttons) {
      var d = document.createElement('dialog');
      d.id = id; d.className = 'fnos-dialog';
      var h = document.createElement('h3'); h.textContent = title; d.appendChild(h);
      var row = document.createElement('div'); row.className = 'fnos-btns';
      buttons.forEach(function (b) {
        var btn = document.createElement('button');
        btn.textContent = b.label;
        if (b.primary) btn.className = 'primary';
        btn.addEventListener('click', function () {
          if (typeof d.close === 'function') d.close();
          b.action();
        });
        row.appendChild(btn);
      });
      d.appendChild(row);
      document.body.appendChild(d);
      return d;
    }

    makeDialog('fnos-src-dialog', '选择 MRP 来源', [
      { label: '本机文件', action: function () {
          var i = $('#file'); if (!i) return;
          programmaticPick = true;             // 防止再次被来源二选一拦截
          try { i.click(); } catch (err) { programmaticPick = false; }
          // 若点击被外部取消（未弹出），200ms 后复位标记
          setTimeout(function () { programmaticPick = false; }, 300);
        } },
      { label: '飞牛 NAS', primary: true, action: openNasMrp }
    ]);
    makeDialog('fnos-save-dialog', '保存截图到', [
      { label: '本机', action: function () {
          var d = $('#fnos-save-dialog');
          downloadBlob(d._blob, d._name);
        } },
      { label: '飞牛 NAS', primary: true, action: function () {
          var d = $('#fnos-save-dialog');
          saveShotToNas(d._blob, d._name);
        } }
    ]);
  }

  function syncFnosButtons() {
    // ready() 之后复核一次宿主判定，避免首次同步执行时 bridge 未握手
    refreshHostDetection();
  }

  /* ---------------- 对外 API（控制台排查用） ---------------- */

  global.flymrpFnos = {
    version: VERSION,
    isInFnOSWindow: function () { return refreshHostDetection(); },
    diagnose: function () {
      return {
        sdkLoaded: typeof global.TrimApp === 'function',
        sdkReady: sdkReady,
        inFnOS: inFnOS,
        hasTrimAppCtor: typeof global.TrimApp === 'function',
        isIframe: (function () { try { return global.self !== global.top; } catch (e) { return true; } })(),
        isStandaloneWeb: sdk ? sdk.isStandaloneWeb : null,
        isWeb: sdk ? sdk.isWeb : null,
        flutterPlatformReady: flutterPlatformReady,
        location: global.location.href
      };
    },
    report: function () {
      return JSON.stringify({
        diag: this.diagnose(),
        bridge: BRIDGE_LOG
      }, null, 2);
    },
    getBridgeLog: function () { return BRIDGE_LOG.slice(); },
    openNasMrp: openNasMrp,
    handleLaunch: handleLaunch
  };

  /* ---------------- 启动 ---------------- */

  function boot() {
    injectUi();
    initSdk();
    hookFileEntry();
    hookScreenshot();
    handleLaunch();          // 幂等；文件关联打开不依赖宿主判定
    checkStalePage();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
  global.addEventListener('load', function () {
    hookFileEntry(); hookScreenshot(); refreshHostDetection(); handleLaunch();
  });
})(window);
