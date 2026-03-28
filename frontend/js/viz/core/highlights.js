// highlights.js - РѕР±РЅРѕРІР»РµРЅРЅС‹Р№ РґР»СЏ config.js
(function () {
  const sets = { 
    compare: new Set(), 
    swap: new Set(), 
    read: new Set(),
    write: new Set(),
    key: new Set(),
    sorted: new Set()
  };
  
  // РСЃРїРѕР»СЊР·СѓРµРј pulse РёР· VizDUR РёР· config.js
  let pulseSec = window.VizDUR ? VizDUR.pulse : 0.25;

  function _apply() {
    const items = document.querySelectorAll('#stage .item');
    items.forEach(g => {
      g.classList.remove('compare', 'swap', 'write', 'read', 'temp-key');
    });
    
    sets.compare.forEach(i => {
      const n = VizState.nodeAtIndex(i);
      if (n) n.classList.add('compare');
    });
    
    sets.swap.forEach(i => {
      const n = VizState.nodeAtIndex(i);
      if (n) n.classList.add('swap');
    });
    
    sets.read.forEach(i => {
      const n = VizState.nodeAtIndex(i);
      if (n) n.classList.add('read');
    });

    sets.write.forEach(i => {
      const n = VizState.nodeAtIndex(i);
      if (n) n.classList.add('write');
    });
    
    sets.key.forEach(i => {
      const n = VizState.nodeAtIndex(i);
      if (n) n.classList.add('temp-key');
    });
    
    // РћР±РЅРѕРІР»СЏРµРј С‡РёРїСЃС‹ РµСЃР»Рё РµСЃС‚СЊ С„СѓРЅРєС†РёСЏ
    if (window.VizScene && typeof VizScene._renderChips === 'function') {
      VizScene._renderChips();
    }
  }

  function setPulseMs(ms) { 
    pulseSec = Math.max(0.03, (ms|0) / 1000); 
  }

  function pulseCompare(i, j) {
    sets.compare.clear();
    if (Number.isInteger(i)) sets.compare.add(i);
    if (Number.isInteger(j)) sets.compare.add(j);
    _apply();
    
    if (window.gsap) {
      gsap.delayedCall(pulseSec, () => { 
        sets.compare.clear(); 
        _apply(); 
      });
    } else {
      setTimeout(() => {
        sets.compare.clear();
        _apply();
      }, pulseSec * 1000);
    }
  }

  function pulseSwap(i, j) {
    sets.swap.clear();
    if (Number.isInteger(i)) sets.swap.add(i);
    if (Number.isInteger(j)) sets.swap.add(j);
    _apply();
    
    if (window.gsap) {
      gsap.delayedCall(pulseSec, () => { 
        sets.swap.clear(); 
        _apply(); 
      });
    } else {
      setTimeout(() => {
        sets.swap.clear();
        _apply();
      }, pulseSec * 1000);
    }
  }

  function pulseRead(i) {
    if (!Number.isInteger(i)) return;
    
    sets.read.clear();
    sets.read.add(i);
    _apply();
    
    if (window.gsap) {
      gsap.delayedCall(pulseSec, () => { 
        sets.read.clear(); 
        _apply(); 
      });
    } else {
      setTimeout(() => {
        sets.read.clear();
        _apply();
      }, pulseSec * 1000);
    }
  }

  function pulseWrite(i) {
    if (!Number.isInteger(i)) return;

    sets.write.clear();
    sets.write.add(i);
    _apply();

    if (window.gsap) {
      gsap.delayedCall(pulseSec, () => { 
        sets.write.clear(); 
        _apply(); 
      });
    } else {
      setTimeout(() => {
        sets.write.clear();
        _apply();
      }, pulseSec * 1000);
    }
  }

  function pulseNotFound() {
    const items = document.querySelectorAll('#stage .item');
    items.forEach(n => n.classList.add('notfound'));
    const clear = () => items.forEach(n => n.classList.remove('notfound'));
    if (window.gsap) {
      gsap.delayedCall(pulseSec * 1.6, clear);
    } else {
      setTimeout(clear, pulseSec * 1600);
    }
  }

  function setKeyElement(i) {
    if (!Number.isInteger(i)) return;
    sets.key.clear();
    sets.key.add(i);
    _apply();
  }

  function clearKeyElement() {
    sets.key.clear();
    _apply();
  }

  function setSortedRange(endIndex) {
    sets.sorted.clear();
    const arr = window.currentArray || [];
    for (let i = 0; i <= endIndex && i < arr.length; i++) {
      sets.sorted.add(i);
    }
    _apply();
  }

  function clearAll() {
    sets.compare.clear(); 
    sets.swap.clear(); 
    sets.read.clear();
    sets.write.clear();
    sets.key.clear();
    _apply();
  }

  function markNode(i, tag) {
    const g = VizState.nodeAtIndex(i);
    if (!g) return;
    
    // РЈР±РёСЂР°РµРј РІСЃРµ РјРµС‚РєРё
    ['key', 'min', 'pivot', 'sorted'].forEach(cls => {
      g.classList.remove(cls);
    });
    
    // Р”РѕР±Р°РІР»СЏРµРј СѓРєР°Р·Р°РЅРЅСѓСЋ РјРµС‚РєСѓ РµСЃР»Рё РѕРЅР° РґРѕРїСѓСЃС‚РёРјР°
    if (tag && ['key', 'min', 'pivot', 'sorted'].includes(tag)) {
      g.classList.add(tag);
    }
  }

  // Р­РєСЃРїРѕСЂС‚
  window.VizHL = { 
    sets, 
    setPulseMs, 
    pulseCompare, 
    pulseSwap, 
    pulseRead,
    pulseWrite,
    pulseNotFound,
    setKeyElement,
    clearKeyElement,
    setSortedRange,
    clearAll, 
    markNode, 
    _apply 
  };
})();
