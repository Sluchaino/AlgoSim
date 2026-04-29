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
  
  // Базовые длительности пульса по типам действий
  const pulseMs = {
    compare: Math.round(((window.VizDUR ? VizDUR.pulse : 0.25) || 0.25) * 1000),
    swap: Math.round(((window.VizDUR ? VizDUR.pulse : 0.25) || 0.25) * 1000),
    read: Math.round(((window.VizDUR ? VizDUR.pulse : 0.25) || 0.25) * 1000),
    write: Math.round(((window.VizDUR ? VizDUR.pulse : 0.25) || 0.25) * 1000),
    notFound: Math.round(((window.VizDUR ? VizDUR.pulse : 0.25) || 0.25) * 1600)
  };

  function pulseSecFor(kind) {
    const ms = Number.isFinite(pulseMs[kind]) ? pulseMs[kind] : 250;
    return Math.max(0.03, ms / 1000);
  }

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
    const val = Math.max(30, ms | 0);
    pulseMs.compare = val;
    pulseMs.swap = val;
    pulseMs.read = val;
    pulseMs.write = val;
    pulseMs.notFound = Math.max(60, Math.round(val * 1.6));
  }

  function setPulseProfile(profile) {
    if (!profile || typeof profile !== 'object') return;
    const apply = (key, minMs = 30) => {
      const raw = profile[key];
      if (!Number.isFinite(raw)) return;
      pulseMs[key] = Math.max(minMs, Math.round(raw));
    };
    apply('compare');
    apply('swap');
    apply('read');
    apply('write');
    apply('notFound', 60);
  }

  function getPulseMs(kind) {
    const key = String(kind || '').trim();
    if (!key) return null;
    const val = pulseMs[key];
    if (!Number.isFinite(val)) return null;
    return Math.max(30, Math.round(val));
  }

  function pulseCompare(i, j) {
    const sec = pulseSecFor('compare');
    sets.compare.clear();
    if (Number.isInteger(i)) sets.compare.add(i);
    if (Number.isInteger(j)) sets.compare.add(j);
    _apply();
    
    if (window.gsap) {
      gsap.delayedCall(sec, () => {
        sets.compare.clear(); 
        _apply(); 
      });
    } else {
      setTimeout(() => {
        sets.compare.clear();
        _apply();
      }, sec * 1000);
    }
  }

  function pulseSwap(i, j) {
    const sec = pulseSecFor('swap');
    sets.swap.clear();
    if (Number.isInteger(i)) sets.swap.add(i);
    if (Number.isInteger(j)) sets.swap.add(j);
    _apply();
    
    if (window.gsap) {
      gsap.delayedCall(sec, () => {
        sets.swap.clear(); 
        _apply(); 
      });
    } else {
      setTimeout(() => {
        sets.swap.clear();
        _apply();
      }, sec * 1000);
    }
  }

  function pulseRead(i, durationMs) {
    const sec = Number.isFinite(durationMs)
      ? Math.max(0.03, Number(durationMs) / 1000)
      : pulseSecFor('read');
    if (!Number.isInteger(i)) return;
    
    sets.read.clear();
    sets.read.add(i);
    _apply();
    animateReadPulse(i, sec);
    
    if (window.gsap) {
      gsap.delayedCall(sec, () => {
        sets.read.clear(); 
        _apply(); 
      });
    } else {
      setTimeout(() => {
        sets.read.clear();
        _apply();
      }, sec * 1000);
    }
  }

  function animateReadPulse(i, sec) {
    const node = (window.VizState && typeof VizState.nodeAtIndex === 'function')
      ? VizState.nodeAtIndex(i)
      : null;
    if (!node) return;
    const circle = node.querySelector('circle');
    if (!circle) return;

    const ns = (node.ownerSVGElement && node.ownerSVGElement.namespaceURI)
      ? node.ownerSVGElement.namespaceURI
      : 'http://www.w3.org/2000/svg';
    const baseR = Number(circle.getAttribute('r'));
    const startR = Number.isFinite(baseR) ? Math.max(4, baseR * 0.72) : 10;
    const endR = Number.isFinite(baseR) ? (baseR + 8) : 18;

    const prevRipple = node.querySelector('circle.read-ripple');
    if (prevRipple) prevRipple.remove();

    const ripple = document.createElementNS(ns, 'circle');
    ripple.setAttribute('class', 'read-ripple');
    ripple.setAttribute('cx', '0');
    ripple.setAttribute('cy', '0');
    ripple.setAttribute('r', String(startR));
    ripple.setAttribute('fill', 'none');
    ripple.setAttribute('stroke', '#38bdf8');
    ripple.setAttribute('stroke-width', '2.2');
    ripple.setAttribute('opacity', '0.85');
    ripple.setAttribute('pointer-events', 'none');
    node.appendChild(ripple);

    const done = () => { if (ripple.parentNode) ripple.remove(); };
    if (window.gsap) {
      gsap.to(ripple, {
        attr: { r: endR },
        opacity: 0,
        duration: Math.max(0.06, sec),
        ease: 'none',
        overwrite: 'auto',
        onComplete: done
      });
      return;
    }

    if (typeof ripple.animate === 'function') {
      const anim = ripple.animate(
        [
          { opacity: 0.85, r: startR },
          { opacity: 0.00, r: endR }
        ],
        {
          duration: Math.max(60, Math.round(sec * 1000)),
          easing: 'linear',
          fill: 'forwards'
        }
      );
      anim.onfinish = done;
      return;
    }

    setTimeout(done, Math.max(60, Math.round(sec * 1000)));
  }

  function pulseWrite(i) {
    const sec = pulseSecFor('write');
    if (!Number.isInteger(i)) return;

    sets.write.clear();
    sets.write.add(i);
    _apply();

    if (window.gsap) {
      gsap.delayedCall(sec, () => {
        sets.write.clear(); 
        _apply(); 
      });
    } else {
      setTimeout(() => {
        sets.write.clear();
        _apply();
      }, sec * 1000);
    }
  }

  function pulseNotFound() {
    const sec = Math.max(0.06, (pulseMs.notFound || 400) / 1000);
    const items = document.querySelectorAll('#stage .item');
    items.forEach(n => n.classList.add('notfound'));
    const clear = () => items.forEach(n => n.classList.remove('notfound'));
    if (window.gsap) {
      gsap.delayedCall(sec, clear);
    } else {
      setTimeout(clear, sec * 1000);
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
    setPulseProfile,
    getPulseMs,
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
