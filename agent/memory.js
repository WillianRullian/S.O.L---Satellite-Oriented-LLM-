(function (root) {
  'use strict';

  var STORAGE_KEY = 'sol_agent_profile_enc_v1';
  var DEVICE_SALT_KEY = 'sol_agent_device_salt_v1';
  var MAX_FACTS = 24;
  var MAX_RECENT_TURNS = 12;
  var MAX_RESEARCH_NOTES = 8;
  var SINGLE_VALUE_CATEGORIES = { area: 1, crop: 1, pain: 1, knowledge_level: 1 };
  var MULTI_VALUE_CAP_BY_CATEGORY = {
    goal: 3,
    resources: 4,
    family_context: 2,
    constraints: 3,
    market_channel: 2,
    traditions: 3,
    tools: 3,
    past_issue: 3,
    planting_season: 2
  };

  var memoryState = {
    facts: [],
    recentTurns: [],
    researchNotes: [],
    contextSnapshot: null,
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
      }
      if (data && Array.isArray(data.recentTurns)) {
        memoryState.recentTurns = data.recentTurns.slice(-MAX_RECENT_TURNS);
      }
      if (data && Array.isArray(data.researchNotes)) {
        memoryState.researchNotes = data.researchNotes.slice(-MAX_RESEARCH_NOTES);
      }
      if (data && data.contextSnapshot && typeof data.contextSnapshot === 'object') {
        memoryState.contextSnapshot = data.contextSnapshot;
      }
      if (data && data.updatedAt) {
        memoryState.updatedAt = data.updatedAt;
      }
    } catch (e) {
      // Corrupted storage ignored safely
    }
  }

  function captureRuntimeSnapshot() {
    var A = root.A || {};
    var L = root.L || root.FB || null;
    var plan = root.plan || null;
    return {
      state: root.state || 'idle',
      sel: typeof root.sel === 'number' ? root.sel : 0,
      area: A.area != null ? A.area : null,
      crop: A.crop || null,
      pain: A.pain || null,
      rounded_location: roundCoords(L),
      indicators: plan && plan.d ? plan.d : null,
      best_index: plan && typeof plan.best === 'number' ? plan.best : null
    };
  }

  function saveToStorage() {
    memoryState.updatedAt = todayISO();
    memoryState.contextSnapshot = captureRuntimeSnapshot();
    var snapshot = {
      facts: memoryState.facts.slice(-MAX_FACTS),
      recentTurns: memoryState.recentTurns.slice(-MAX_RECENT_TURNS),
      researchNotes: memoryState.researchNotes.slice(-MAX_RESEARCH_NOTES),
      contextSnapshot: memoryState.contextSnapshot,
      updatedAt: memoryState.updatedAt
    };
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, encodeProfileSync(snapshot));
      }
    } catch (e) {}
    persistAESGCM(snapshot);
  }

  function saveContextSnapshot() {
    saveToStorage();
    return memoryState.contextSnapshot;
  }

  function restoreContextToRuntime() {
    var snap = memoryState.contextSnapshot;
    if (!snap || typeof root.A !== 'object' || !root.A) return false;
    var changed = false;
    if (root.A.area == null && snap.area != null) {
      root.A.area = snap.area;
      changed = true;
    }
    if (!root.A.crop && snap.crop) {
      root.A.crop = snap.crop;
      changed = true;
    }
    if (!root.A.pain && snap.pain) {
      root.A.pain = snap.pain;
      changed = true;
    }
    if (typeof snap.sel === 'number' && changed) {
      root.sel = snap.sel;
    }
    if (changed && root.A.area != null && root.A.crop && root.A.pain && !root.plan && typeof root.build === 'function') {
      root.L = root.L || root.FB;
      root.plan = root.build();
      root.state = 'ready';
    }
    return changed;
  }

  function recordResearchNote(topic, category, summary, metrics) {
    var cleanTopic = String(topic || '').trim().slice(0, 100);
    var cleanSummary = String(summary || '').trim().slice(0, 260);
    if (!cleanSummary) return null;
    var entry = {
      topic: cleanTopic || 'pesquisa_agronomica',
      category: String(category || 'general'),
      summary: cleanSummary,
      metrics: metrics || null,
      date: todayISO()
    };
    var normTopic = normText(entry.topic);
    memoryState.researchNotes = memoryState.researchNotes.filter(function (item) {
      return normText(item.topic) !== normTopic;
    });
    memoryState.researchNotes.push(entry);
    if (memoryState.researchNotes.length > MAX_RESEARCH_NOTES) {
      memoryState.researchNotes = memoryState.researchNotes.slice(-MAX_RESEARCH_NOTES);
    }
    saveToStorage();
    return entry;
  }

  function insertFact(factText, category, origin, skipSave) {
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

    var normFact = normText(entry.fact);
    memoryState.facts = memoryState.facts.filter(function (item) {
      if (SINGLE_VALUE_CATEGORIES[cat] && item.category === cat) return false;
      return normText(item.fact) !== normFact;
    });

    var cap = MULTI_VALUE_CAP_BY_CATEGORY[cat];
    if (cap) {
      var sameCat = memoryState.facts.filter(function (item) { return item.category === cat; });
      while (sameCat.length >= cap) {
        var oldest = sameCat.shift();
        memoryState.facts = memoryState.facts.filter(function (item) { return item !== oldest; });
      }
    }

    memoryState.facts.push(entry);
    if (memoryState.facts.length > MAX_FACTS) {
      memoryState.facts = memoryState.facts.slice(-MAX_FACTS);
    }
    if (!skipSave) {
      saveToStorage();
    }
    return entry;
  }

  function remember(factText, category, origin) {
    return insertFact(factText, category, origin, false);
  }

  function isFillerNoise(norm) {
    return !norm || norm.length < 4 || /^(oi|ola|bom dia|boa tarde|boa noite|tudo bem|ok|certo|sim|nao|hum|uhum|aha|obrigado|obrigada|valeu)$/.test(norm);
  }

  function extractFactsFromTurn(userText, slots) {
    var raw = String(userText || '').trim();
    var norm = normText(raw);
    if (isFillerNoise(norm)) return [];
    var added = [];

    if (slots && slots.area != null) {
      added.push(insertFact('Área da lavoura: ' + (Math.round(slots.area * 100) / 100) + ' ha', 'area', 'stated', true));
    }
    if (slots && slots.crop) {
      added.push(insertFact('Cultura principal: ' + slots.crop, 'crop', 'stated', true));
    }
    if (slots && slots.pain) {
      added.push(insertFact('Dificuldade principal: ' + slots.pain, 'pain', 'stated', true));
    }

    // Smallholder goals, dreams and growth targets
    if (/\b(quero|queria|meu sonho|objetivo|meta|preciso|aumentar a renda|viver da roca|melhorar a colheita|crescer|diversificar|vender mais|sustentar|alimentar a familia)\b/.test(norm)) {
      added.push(insertFact('Objetivo do produtor: ' + raw.slice(0, 120), 'goal', 'stated', true));
    }

    // Available resources, strengths and farm assets to leverage
    if (/\b(cisterna|poco|acude|rio|nascente|esterco|galinha|gado|porco|composto|semente crioula|energia solar|bomba|irrigacao|gotejamento|reserva|terra descansada)\b/.test(norm)) {
      added.push(insertFact('Recurso/força disponível: ' + raw.slice(0, 120), 'resources', 'stated', true));
    }

    // Family context & community support
    if (/\b(familia|esposa|marido|esposo|filho|filhos|pai|mae|irmao|sozinho|sozinha|mutirao|associacao|cooperativa|sindicato|comunidade)\b/.test(norm)) {
      added.push(insertFact('Contexto familiar/rede: ' + raw.slice(0, 120), 'family_context', 'stated', true));
    }

    // Practical or financial constraints
    if (/\b(sem dinheiro|pouco dinheiro|apertado|sem credito|sem financiamento|sem agua|sem bomba|sem transporte|estrada ruim|falta gente|mao de obra|nao tenho condicoes|sem recurso)\b/.test(norm)) {
      added.push(insertFact('Limitação prática: ' + raw.slice(0, 120), 'constraints', 'stated', true));
    }

    // Market & sales channels
    if (/\b(feira|pnae|paa|merenda|atravessador|mercadinho|supermercado|vender na cidade|vizinho|consumo proprio|subsistencia|entrega)\b/.test(norm)) {
      added.push(insertFact('Canal de venda/destino: ' + raw.slice(0, 120), 'market_channel', 'stated', true));
    }

    // Traditional knowledge & hands-on experience
    if (/\b(lua|consorcio|semente antiga|do meu pai|do meu avo|dos antigos|adubo caseiro|calda|cobertura morta|folha seca|experiencia propria)\b/.test(norm)) {
      added.push(insertFact('Saber/prática tradicional: ' + raw.slice(0, 120), 'traditions', 'stated', true));
    }

    // Communication register detection (technical vs practical/traditional)
    if (root.SOLPrompts && typeof root.SOLPrompts.detectTechnicalRegister === 'function' && root.SOLPrompts.detectTechnicalRegister(raw)) {
      added.push(insertFact('Perfil técnico-científico: usa indicadores orbitais/agronômicos', 'knowledge_level', 'inferred', true));
    }

    // Extract planting season / timing facts
    if (/\b(plantar\s+em|planto\s+em|epoca|outubro|novembro|dezembro|janeiro|fevereiro|marco|abril|maio|inverno|verao|chuvas)\b/.test(norm)) {
      added.push(insertFact('Época/janela mencionada: ' + raw.slice(0, 100), 'planting_season', 'stated', true));
    }
    // Extract equipment / irrigation / management tools
    if (/\b(trator|arado|rocadeira|enxada|palhada|calcario|adubo|plantio direto|curva de nivel)\b/.test(norm)) {
      added.push(insertFact('Manejo/ferramenta: ' + raw.slice(0, 100), 'tools', 'stated', true));
    }
    // Extract past crop losses or past errors
    if (/\b(perdi|ano\s+passado|safra\s+passada|queimou|morreu|secou\s+tudo|deu\s+praga)\b/.test(norm)) {
      added.push(insertFact('Histórico de safra: ' + raw.slice(0, 100), 'past_issue', 'stated', true));
    }

    var filtered = added.filter(Boolean);
    if (filtered.length > 0) {
      saveToStorage();
    }
    return filtered;
  }

  function recordTurn(role, text) {
    var cleaned = String(text || '').trim();
    if (!cleaned || cleaned.length < 2) return;
    memoryState.recentTurns.push({
      role: role === 'assistant' ? 'assistant' : 'user',
      content: cleaned.slice(0, 420)
    });
    if (memoryState.recentTurns.length > MAX_RECENT_TURNS) {
      memoryState.recentTurns = memoryState.recentTurns.slice(-MAX_RECENT_TURNS);
    }
    saveToStorage();
  }

  function groupFactsByCategory(categories) {
    var catSet = {};
    categories.forEach(function (c) { catSet[c] = 1; });
    return memoryState.facts
      .filter(function (f) { return !!catSet[f.category]; })
      .map(function (f) { return f.fact; });
  }

  function buildFarmerProfileSummary() {
    var isTechnical = memoryState.facts.some(function (f) { return f.category === 'knowledge_level'; });
    return {
      goals: groupFactsByCategory(['goal']),
      resources_and_strengths: groupFactsByCategory(['resources', 'tools', 'traditions']),
      family_and_market: groupFactsByCategory(['family_context', 'market_channel']),
      constraints_and_history: groupFactsByCategory(['constraints', 'past_issue', 'planting_season']),
      communication_register: isTechnical ? 'technical' : 'practical_accessible'
    };
  }

  function getProfile() {
    var slots = (typeof root.A === 'object' && root.A) ? {
      area_ha: root.A.area,
      crop: root.A.crop,
      main_difficulty: root.A.pain
    } : {};
    return {
      slots: slots,
      farmer_profile_summary: buildFarmerProfileSummary(),
      facts: memoryState.facts.slice(),
      research_notes: memoryState.researchNotes.slice(),
      saved_context: memoryState.contextSnapshot,
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
      farmer_profile_summary: buildFarmerProfileSummary(),
      profile_facts: memoryState.facts.slice(-14),
      research_notes: memoryState.researchNotes.slice(-4),
      saved_context: memoryState.contextSnapshot,
      plan: planSummary
    };
  }

  function buildBudgetedPromptContext() {
    var ctx = buildStateContext();
    var fp = ctx.farmer_profile_summary || {};
    var lines = [
      'ESTADO ATUAL DO PRODUTOR:',
      '- Área: ' + (ctx.area != null ? ctx.area_spoken + ' (' + Math.round(ctx.area * 1000) / 1000 + ' ha)' : 'não informada'),
      '- Cultura: ' + (ctx.crop || 'não informada'),
      '- Dificuldade principal: ' + (ctx.pain || 'não informada'),
      '- Coordenada aproximada (LGPD grade 0.1°): ' + (ctx.rounded_location ? ctx.rounded_location.lat + ', ' + ctx.rounded_location.lon : 'Nordeste')
    ];

    lines.push('PERFIL HUMANO E PRODUTIVO DO PEQUENO AGRICULTOR (ADAPTE E APROVEITE O QUE ELE JÁ TEM):');
    lines.push('- Registro de comunicação: ' + (fp.communication_register === 'technical'
      ? 'Técnico/orbital — pode usar métricas científicas explicando implicações práticas'
      : 'Prático/popular — linguagem simples, calorosa, sem jargões nem infantilização, valorizando saberes locais'));
    if (fp.goals && fp.goals.length) {
      lines.push('- Metas e objetivos: ' + fp.goals.join(' | '));
    }
    if (fp.resources_and_strengths && fp.resources_and_strengths.length) {
      lines.push('- Forças, recursos e saberes já disponíveis: ' + fp.resources_and_strengths.join(' | '));
    }
    if (fp.family_and_market && fp.family_and_market.length) {
      lines.push('- Realidade familiar e mercado: ' + fp.family_and_market.join(' | '));
    }
    if (fp.constraints_and_history && fp.constraints_and_history.length) {
      lines.push('- Limitações práticas e histórico: ' + fp.constraints_and_history.join(' | '));
    }

    if (ctx.profile_facts.length) {
      lines.push('FATOS MEMORIZADOS:');
      ctx.profile_facts.forEach(function (f) {
        lines.push('- [' + f.date + '/' + f.origin + '] ' + f.fact);
      });
    }
    if (ctx.research_notes && ctx.research_notes.length) {
      lines.push('PESQUISAS E DADOS MOCK JÁ SALVOS:');
      ctx.research_notes.forEach(function (r) {
        lines.push('- [' + r.category + '] ' + r.topic + ': ' + r.summary);
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
    memoryState.researchNotes = [];
    memoryState.contextSnapshot = null;
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
    recordResearchNote: recordResearchNote,
    saveContextSnapshot: saveContextSnapshot,
    restoreContextToRuntime: restoreContextToRuntime,
    getProfile: getProfile,
    extractFactsFromTurn: extractFactsFromTurn,
    recordTurn: recordTurn,
    getRecentTurns: function () { return memoryState.recentTurns.slice(); },
    getResearchNotes: function () { return memoryState.researchNotes.slice(); },
    buildStateContext: buildStateContext,
    buildBudgetedPromptContext: buildBudgetedPromptContext,
    clearMemory: clearMemory
  };

  root.SOLMemory = SOLMemory;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = SOLMemory;
  }
})(typeof window !== 'undefined' ? window : globalThis);
