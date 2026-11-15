(function (root) {
  'use strict';

  var STORAGE_KEY = 'sol_agent_profile_enc_v1';
  var DEVICE_SALT_KEY = 'sol_agent_device_salt_v1';
  var MAX_FACTS = 12;
  var MAX_RECENT_TURNS = 12;

  var memoryState = {
    facts: [],
    recentTurns: [],
    updatedAt: null
  };

  function todayISO() {
    return new Date().toISOString().slice(0, 10);
  }

  function normText(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  // Synchronous lightweight XOR+Base64 seal paired with async WebCrypto AES-GCM persistence
  function getDeviceSecret() {
    try {
      if (typeof localStorage === 'undefined') return 'sol-default-local-key';
      var s = localStorage.getItem(DEVICE_SALT_KEY);
      if (!s) {
        s = 'sol_' + Math.random().toString(36).slice(2) + '_' + Date.now().toString(36);
        localStorage.setItem(DEVICE_SALT_KEY, s);
      }
      return s;
    } catch (e) {
      return 'sol-default-local-key';
    }
  }

  function xorCipher(str, key) {
    var out = '';
    for (var i = 0; i < str.length; i++) {
      out += String.fromCharCode(str.charCodeAt(i) ^ key.charCodeAt(i % key.length));
    }
    return out;
  }

  function encodeProfileSync(obj) {
    var json = JSON.stringify(obj);
    var xored = xorCipher(encodeURIComponent(json), getDeviceSecret());
    if (typeof btoa === 'function') return 'v1:' + btoa(xored);
    return 'v1:' + Buffer.from(xored, 'binary').toString('base64');
  }

  function decodeProfileSync(payload) {
    if (!payload || typeof payload !== 'string') return null;
    if (payload.indexOf('v1:') !== 0) return null;
    var b64 = payload.slice(3);
    var raw = typeof atob === 'function'
      ? atob(b64)
      : Buffer.from(b64, 'base64').toString('binary');
    var uri = xorCipher(raw, getDeviceSecret());
    return JSON.parse(decodeURIComponent(uri));
  }

  async function persistAESGCM(obj) {
    try {
      if (typeof crypto === 'undefined' || !crypto.subtle || typeof TextEncoder === 'undefined') return;
      var enc = new TextEncoder();
      var keyMaterial = await crypto.subtle.digest('SHA-256', enc.encode(getDeviceSecret()));
      var cryptoKey = await crypto.subtle.importKey('raw', keyMaterial, { name: 'AES-GCM' }, false, ['encrypt']);
      var iv = crypto.getRandomValues(new Uint8Array(12));
      var ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, cryptoKey, enc.encode(JSON.stringify(obj)));
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEY + '_aes', JSON.stringify({
          iv: Array.from(iv),
          ct: Array.from(new Uint8Array(ct))
        }));
      }
    } catch (e) {
      // Ignore WebCrypto errors in restricted contexts
    }
  }

  function loadFromStorage() {
    try {
      if (typeof localStorage === 'undefined') return;
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      var data = decodeProfileSync(raw);
      if (data && Array.isArray(data.facts)) {
        memoryState.facts = data.facts.slice(-MAX_FACTS);
        memoryState.updatedAt = data.updatedAt || null;
      }
    } catch (e) {
      // Corrupted storage ignored safely
    }
  }

  function saveToStorage() {
    memoryState.updatedAt = todayISO();
    var snapshot = {
      facts: memoryState.facts.slice(-MAX_FACTS),
      updatedAt: memoryState.updatedAt
    };
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, encodeProfileSync(snapshot));
      }
    } catch (e) {}
    persistAESGCM(snapshot);
  }

  function remember(factText, category, origin) {
    var cleaned = String(factText || '').trim();
    if (!cleaned || cleaned.length < 3) return null;
    var cat = category || 'agronomic_fact';
    var orig = origin === 'inferred' ? 'inferred' : 'stated';
    var entry = {
      fact: cleaned.slice(0, 160),
      category: cat,
      origin: orig,
      date: todayISO()
    };

    // Deduplicate by category if single-value slot, or by normalized fact text
    var normFact = normText(entry.fact);
    memoryState.facts = memoryState.facts.filter(function (item) {
      if (cat in { area: 1, crop: 1, pain: 1 } && item.category === cat) return false;
      return normText(item.fact) !== normFact;
    });
    memoryState.facts.push(entry);
    if (memoryState.facts.length > MAX_FACTS) {
      memoryState.facts = memoryState.facts.slice(-MAX_FACTS);
    }
    saveToStorage();
    return entry;
  }

  function extractFactsFromTurn(userText, slots) {
    var norm = normText(userText);
    if (!norm || norm.length < 3) return [];
    var added = [];

    if (slots && slots.area != null) {
      added.push(remember('Área da lavoura: ' + (Math.round(slots.area * 100) / 100) + ' ha', 'area', 'stated'));
    }
    if (slots && slots.crop) {
      added.push(remember('Cultura principal: ' + slots.crop, 'crop', 'stated'));
    }
    if (slots && slots.pain) {
      added.push(remember('Dificuldade principal: ' + slots.pain, 'pain', 'stated'));
    }

    // Extract planting season / timing facts
    if (/\b(plantar\s+em|planto\s+em|epoca|outubro|novembro|dezembro|janeiro|fevereiro|marco|abril|maio|inverno|verao|chuvas)\b/.test(norm)) {
      added.push(remember('Época/janela mencionada: ' + userText.trim().slice(0, 100), 'planting_season', 'stated'));
    }
    // Extract equipment / irrigation / management tools
    if (/\b(trator|irrigacao|gotejamento|cisterna|bomba|adubo|calcario|arado|rocadeira|enxada|palhada)\b/.test(norm)) {
      added.push(remember('Manejo/ferramenta: ' + userText.trim().slice(0, 100), 'tools', 'stated'));
    }
    // Extract past crop losses or past errors
    if (/\b(perdi|ano\s+passado|safra\s+passada|queimou|morreu|secou\s+tudo|deu\s+praga)\b/.test(norm)) {
      added.push(remember('Histórico de safra: ' + userText.trim().slice(0, 100), 'past_issue', 'stated'));
    }

    return added.filter(Boolean);
  }

  function recordTurn(role, text) {
    var cleaned = String(text || '').trim();
    if (!cleaned) return;
    memoryState.recentTurns.push({
      role: role === 'assistant' ? 'assistant' : 'user',
      content: cleaned.slice(0, 420)
    });
    if (memoryState.recentTurns.length > MAX_RECENT_TURNS) {
      memoryState.recentTurns = memoryState.recentTurns.slice(-MAX_RECENT_TURNS);
    }
  }

  function getProfile() {
    var slots = (typeof root.A === 'object' && root.A) ? {
      area_ha: root.A.area,
      crop: root.A.crop,
      main_difficulty: root.A.pain
    } : {};
    return {
      slots: slots,
      facts: memoryState.facts.slice(),
      updated_at: memoryState.updatedAt
    };
  }

  function roundCoords(loc) {
    if (!loc || typeof loc.lat !== 'number' || typeof loc.lon !== 'number') return null;
    // LGPD data minimization: round coordinates to 0.1 degree (~11 km grid)
    return {
      lat: Math.round(loc.lat * 10) / 10,
      lon: Math.round(loc.lon * 10) / 10
    };
  }

  function buildStateContext() {
    var A = root.A || { area: null, crop: null, pain: null };
    var L = root.L || root.FB || { lat: -14.9, lon: -40.8 };
    var plan = root.plan || null;
    var sel = typeof root.sel === 'number' ? root.sel : 0;
    var st = root.state || 'idle';

    var planSummary = null;
    if (plan && plan.d && Array.isArray(plan.S)) {
      planSummary = {
        best_index: plan.best,
        selected_index: sel,
        indicators: plan.d,
        strategies: plan.S.map(function (s, idx) {
          return {
            index: idx,
            name: s.p,
            title: s.t,
            water_score: s.w,
            soil_score: s.s,
            cost_score: s.c,
            prod_tons: Math.round(s.prod * 100) / 100,
            prod_spoken: typeof root.fmtP === 'function' ? root.fmtP(A.crop, s.prod, 1) : String(s.prod),
            why: s.why
          };
        }),
        chunks: plan.chunks
      };
    }

    return {
      state: st,
      area: A.area,
      area_spoken: (A.area && typeof root.fmtA === 'function') ? root.fmtA(A.area) : null,
      crop: A.crop,
      pain: A.pain,
      rounded_location: roundCoords(L),
      profile_facts: memoryState.facts.slice(-8),
      plan: planSummary
    };
  }

  function buildBudgetedPromptContext() {
    var ctx = buildStateContext();
    var lines = [
      'ESTADO ATUAL DO PRODUTOR:',
      '- Área: ' + (ctx.area != null ? ctx.area_spoken + ' (' + Math.round(ctx.area * 1000) / 1000 + ' ha)' : 'não informada'),
      '- Cultura: ' + (ctx.crop || 'não informada'),
      '- Dificuldade principal: ' + (ctx.pain || 'não informada'),
      '- Coordenada aproximada (LGPD grade 0.1°): ' + (ctx.rounded_location ? ctx.rounded_location.lat + ', ' + ctx.rounded_location.lon : 'Nordeste')
    ];
    if (ctx.profile_facts.length) {
      lines.push('FATOS MEMORIZADOS:');
      ctx.profile_facts.forEach(function (f) {
        lines.push('- [' + f.date + '/' + f.origin + '] ' + f.fact);
      });
    }
    if (ctx.plan) {
      var d = ctx.plan.indicators;
      var rec = ctx.plan.strategies[ctx.plan.best_index];
      var cur = ctx.plan.strategies[0];
      lines.push('DADOS ORBITAIS SIMULADOS ATUAIS (JÁ CALCULADOS — RESPONDA DIRETAMENTE USANDO APENAS ESTES NÚMEROS):');
      lines.push('- Chuva 30 dias: ' + d.r30 + ' mm (desvio ' + d.dev + '%), Chuva anual: ' + d.rain + ' mm');
      lines.push('- Umidade SMAP: ' + d.smap + ', NDVI MODIS: ' + d.ndvi + ', Temperatura máx: ' + d.tmax + ' °C, Dias > 35 graus: ' + d.hot);
      lines.push('- Solo exposto: ' + d.bare + ' meses, Declividade SRTM: ' + d.slope + '%, Risco hídrico (ws): ' + d.ws + '%, Degradação do solo (sd): ' + d.sd + '%');
      lines.push('- Recomendada (' + rec.title + '): ' + rec.prod_spoken + ' | Água ' + rec.water_score + '%, Terra ' + rec.soil_score + '%, Custo ' + rec.cost_score + '%');
      lines.push('- Manejo atual (' + cur.title + '): ' + cur.prod_spoken);
    }
    return lines.join('\n');
  }

  function clearMemory() {
    memoryState.facts = [];
    memoryState.recentTurns = [];
    memoryState.updatedAt = null;
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(STORAGE_KEY + '_aes');
      }
    } catch (e) {}
  }

  loadFromStorage();

  var SOLMemory = {
    remember: remember,
    getProfile: getProfile,
    extractFactsFromTurn: extractFactsFromTurn,
    recordTurn: recordTurn,
    getRecentTurns: function () { return memoryState.recentTurns.slice(); },
    buildStateContext: buildStateContext,
    buildBudgetedPromptContext: buildBudgetedPromptContext,
    clearMemory: clearMemory
  };

  root.SOLMemory = SOLMemory;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = SOLMemory;
  }
})(typeof window !== 'undefined' ? window : globalThis);
