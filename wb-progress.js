/* WheelerBrothers progress v1: percentage only when measurable. */
(function(global){'use strict';
  function start(title){
    const host=document.createElement('div');host.setAttribute('role','status');host.setAttribute('aria-live','polite');
    host.style.cssText='position:fixed;z-index:2147483600;left:12px;right:12px;bottom:max(16px,env(safe-area-inset-bottom));max-width:480px;margin:auto;background:#17202b;color:#fff;padding:14px 16px;border:1px solid #718096;border-radius:12px;box-shadow:0 8px 30px #0006;font:14px/1.4 system-ui,sans-serif';
    host.innerHTML='<div data-title style="font-weight:700"></div><div data-stage style="margin:6px 0"></div><div data-bar style="height:9px;background:#3c4755;border-radius:8px;overflow:hidden"><div data-fill style="width:0%;height:100%;background:#7bc4ff;transition:width .12s"></div></div><div data-detail style="font-size:12px;margin-top:5px;opacity:.9"></div>';
    document.body.appendChild(host);
    const titleEl=host.querySelector('[data-title]'),stageEl=host.querySelector('[data-stage]'),fill=host.querySelector('[data-fill]'),bar=host.querySelector('[data-bar]'),detailEl=host.querySelector('[data-detail]');
    titleEl.textContent=title;
    return {update(stage,done,total,detail){
      const valid=Number.isFinite(done)&&Number.isFinite(total)&&total>0;
      stageEl.textContent=stage+(valid?' — '+Math.round(Math.max(0,Math.min(1,done/total))*100)+' %':' — en cours');
      bar.style.display=valid?'block':'none';if(valid)fill.style.width=(100*Math.max(0,Math.min(1,done/total)))+'%';
      detailEl.textContent=detail||((valid?done+' / '+total:'') );
    },close(){host.remove();}};
  }
  global.WBProgress={start};
})(window);
