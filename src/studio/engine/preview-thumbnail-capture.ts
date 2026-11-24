/**
 * Embedded ES5 frame-capture helper for isolated preview iframes (`PREVIEW_PUBLIC_ORIGIN`).
 * Lazily loads `/api/vendor/snapdom.js` only when Studio requests client-side thumbnail frames,
 * keeping normal interactive preview loads completely untouched.
 */
export const PREVIEW_THUMBNAIL_CAPTURE = `
  var snapdomPromise=null;
  function loadSnapdom(){
    if(typeof window.snapdom==='function') return Promise.resolve(window.snapdom);
    if(snapdomPromise) return snapdomPromise;
    snapdomPromise=new Promise(function(resolve,reject){
      var s=document.createElement('script');
      s.src='/api/vendor/snapdom.js';
      s.async=true;
      s.onload=function(){
        if(typeof window.snapdom==='function') resolve(window.snapdom);
        else { snapdomPromise=null; reject(new Error('snapdom global missing')); }
      };
      s.onerror=function(){ snapdomPromise=null; reject(new Error('Failed to load snapdom')); };
      (document.head||document.documentElement).appendChild(s);
    });
    return snapdomPromise;
  }
  function waitTwoFrames(){
    return new Promise(function(resolve){
      var settled=false;
      var timer=setTimeout(function(){
        if(settled) return;
        settled=true;
        resolve();
      },250);
      requestAnimationFrame(function(){
        if(settled) return;
        requestAnimationFrame(function(){
          if(settled) return;
          settled=true;
          clearTimeout(timer);
          resolve();
        });
      });
    });
  }
  function withPreviewRedirectSafeFetch(run,fetchCache){
    var origFetch=window.fetch;
    if(typeof origFetch!=='function') return run();
    window.fetch=function(input,init){
      var method=(init&&init.method?String(init.method):'GET').toUpperCase();
      var cacheKey=null;
      try {
        var rawUrl=typeof input==='string'?input:(input&&typeof input.url==='string'?input.url:'');
        if(rawUrl){
          var parsed=new URL(rawUrl,location.href);
          if(parsed.origin===location.origin&&/^\\/api\\/projects\\/[^/]+\\/preview\\//.test(parsed.pathname)){
            if(init&&init.credentials==='include'){
              init=Object.assign({},init,{credentials:'same-origin'});
            }
            if(fetchCache&&method==='GET') cacheKey=parsed.href;
          }
        }
      } catch(_){}
      if(cacheKey&&fetchCache[cacheKey]){
        return fetchCache[cacheKey].then(function(entry){
          return new Response(entry.buffer.slice(0),{status:entry.status,statusText:entry.statusText,headers:entry.headers});
        });
      }
      var resPromise=origFetch.call(this,input,init);
      if(cacheKey&&typeof Response==='function'){
        var cached=resPromise.then(function(resp){
          if(!resp||!resp.ok||typeof resp.clone!=='function'||typeof resp.arrayBuffer!=='function'){
            delete fetchCache[cacheKey];
            return null;
          }
          var headers=[];
          if(resp.headers&&typeof resp.headers.forEach==='function'){
            resp.headers.forEach(function(v,k){ headers.push([k,v]); });
          }
          return resp.clone().arrayBuffer().then(function(buf){
            return {status:resp.status,statusText:resp.statusText,headers:headers,buffer:buf};
          });
        },function(err){
          delete fetchCache[cacheKey];
          throw err;
        });
        fetchCache[cacheKey]=cached;
        return resPromise.then(function(resp){
          if(!resp||!resp.ok||typeof resp.clone!=='function') delete fetchCache[cacheKey];
          return resp;
        });
      }
      return resPromise;
    };
    function restore(){ if(window.fetch!==origFetch) window.fetch=origFetch; }
    var pending;
    try { pending=Promise.resolve(run()); }
    catch(err){ restore(); return Promise.reject(err); }
    return pending.then(
      function(val){ restore(); return val; },
      function(err){ restore(); throw err; }
    );
  }
  function inlineDecodedCaptureImages(root){
    if(!root||typeof root.querySelectorAll!=='function') return;
    var imgs=root.querySelectorAll('img');
    if(!imgs||!imgs.length) return;
    var cache={};
    for(var i=0;i<imgs.length;i++){
      var img=imgs[i];
      if(!img||!img.complete||!(img.naturalWidth>0)||!(img.naturalHeight>0)) continue;
      var rawSrc=img.getAttribute&&img.getAttribute('src')||'';
      if(rawSrc.indexOf('data:')===0) continue;
      var key=img.currentSrc||img.src||rawSrc;
      if(!key) continue;
      var dataUrl=cache[key];
      if(dataUrl===undefined){
        try {
          var natW=img.naturalWidth, natH=img.naturalHeight;
          var scale=Math.min(1,480/Math.max(natW,natH));
          var cw=Math.max(1,Math.round(natW*scale));
          var ch=Math.max(1,Math.round(natH*scale));
          var cv=document.createElement('canvas');
          cv.width=cw; cv.height=ch;
          var ctx=cv.getContext('2d');
          if(!ctx){ cache[key]=null; continue; }
          ctx.drawImage(img,0,0,cw,ch);
          dataUrl=cv.toDataURL('image/png');
          cache[key]=dataUrl;
        } catch(_){
          cache[key]=null;
          continue;
        }
      }
      if(!dataUrl) continue;
      if(!img.hasAttribute('width')&&!img.hasAttribute('height')){
        img.setAttribute('width',String(img.naturalWidth));
        img.setAttribute('height',String(img.naturalHeight));
      }
      img.removeAttribute('srcset');
      img.removeAttribute('sizes');
      img.setAttribute('src',dataUrl);
    }
  }
  function waitForCaptureMedia(timeoutMs){
    var done=false;
    var tasks=[];
    if(document.fonts&&document.fonts.ready) tasks.push(document.fonts.ready.catch(function(){}));
    var imgs=document.querySelectorAll('img');
    for(var i=0;i<imgs.length;i++){
      var img=imgs[i];
      if(img.complete) continue;
      if(!img.getAttribute('src')&&!img.getAttribute('srcset')) continue;
      if(img.loading==='lazy') img.loading='eager';
      tasks.push(new Promise(function(resolve){
        var el=img;
        function finish(){ el.removeEventListener('load',finish); el.removeEventListener('error',finish); resolve(); }
        el.addEventListener('load',finish,{once:true});
        el.addEventListener('error',finish,{once:true});
      }));
    }
    if(!tasks.length) return Promise.resolve(false);
    return Promise.race([
      Promise.all(tasks),
      new Promise(function(resolve){ setTimeout(function(){ done=true; resolve(); },timeoutMs||2000); })
    ]).then(function(){ return done; });
  }
  function findPureCanvasTarget(root,stageW,stageH){
    if(!root||root.nodeType!==1) return null;
    if(root.tagName==='CANVAS') return root;
    var canvases=root.querySelectorAll('canvas');
    if(canvases.length!==1) return null;
    var text=(root.textContent||'').replace(/\\s+/g,'').trim();
    if(text.length>0) return null;
    if(root.querySelector('img,svg,video')) return null;
    var c=canvases[0];
    var rect=c.getBoundingClientRect();
    if(rect.width>=stageW*0.9&&rect.height>=stageH*0.9) return c;
    return null;
  }
  function releaseCanvasBacking(canvas){
    if(!canvas) return;
    try { canvas.width=0; canvas.height=0; } catch(_){}
  }
  function canvasToJpegBuffer(source,outW,outH){
    var out=document.createElement('canvas');
    out.width=outW; out.height=outH;
    var ctx=out.getContext('2d');
    if(!ctx){ releaseCanvasBacking(out); return Promise.reject(new Error('2D context unavailable')); }
    ctx.drawImage(source,0,0,outW,outH);
    return new Promise(function(resolve,reject){
      out.toBlob(function(blob){
        releaseCanvasBacking(out);
        if(!blob){ reject(new Error('JPEG encode failed')); return; }
        blob.arrayBuffer().then(resolve,reject);
      },'image/jpeg',0.78);
    });
  }
  function capturePreviewFrames(message,onFrame){
    var times=Array.isArray(message.times)?message.times:[];
    if(!times.length) return Promise.resolve({frames:[],mimeType:'image/jpeg',width:240,height:135,aspect:16/9});
    var p=player();
    if(!p||typeof p.seek!=='function') return Promise.reject(new Error('Preview player is not ready'));
    if(typeof p.pause==='function') p.pause();
    var root=document.querySelector('[data-composition-id]')||document.body;
    var target=root;
    if(message.selector){
      try {
        var list=document.querySelectorAll(String(message.selector));
        var idx=Number(message.selectorIndex)||0;
        if(list[idx]) target=list[idx];
      } catch(_){}
    }
    var stageW=Number(root&&root.getAttribute&&root.getAttribute('data-width'))||(root&&root.clientWidth)||window.innerWidth||1280;
    var stageH=Number(root&&root.getAttribute&&root.getAttribute('data-height'))||(root&&root.clientHeight)||window.innerHeight||720;
    if(target!==root){
      var trect=target.getBoundingClientRect();
      if(trect.width>0&&trect.height>0){ stageW=trect.width; stageH=trect.height; }
    }
    var maxW=Math.max(48,Math.min(480,Number(message.width)||240));
    var maxH=Math.max(27,Math.min(480,Math.round(maxW*2)));
    var outW=maxW;
    var outH=Math.max(27,Math.min(maxH,Math.round(outW*stageH/Math.max(1,stageW))));
    if(outH===maxH&&stageH>0){
      outW=Math.max(48,Math.min(maxW,Math.round(outH*stageW/Math.max(1,stageH))));
    }
    var scale=Math.min(2,outW/Math.max(1,stageW));
    var aspect=stageW/Math.max(1,stageH);
    var progressive=typeof onFrame==='function';
    var order=[];
    if(progressive&&times.length>=3){
      var coverIdx=Math.floor(times.length/2);
      order.push(coverIdx);
      for(var k=0;k<times.length;k++){ if(k!==coverIdx) order.push(k); }
    } else {
      for(var m=0;m<times.length;m++) order.push(m);
    }
    // Kick off SnapDOM load concurrently with media/font readiness when DOM capture is needed.
    var snapdomReady=findPureCanvasTarget(target,stageW,stageH)?Promise.resolve(null):loadSnapdom();
    return waitForCaptureMedia(2000).then(function(){
      inlineDecodedCaptureImages(target);
      var fetchCache={};
      var frames=[];
      var chain=Promise.resolve();
      for(var i=0;i<order.length;i++){
        (function(frameIdx,t){
          chain=chain.then(function(){
            p.seek(Math.max(0,Number(t)||0));
            return waitTwoFrames();
          }).then(function(){
            var pureCanvas=findPureCanvasTarget(target,stageW,stageH);
            if(pureCanvas) return canvasToJpegBuffer(pureCanvas,outW,outH);
            return snapdomReady.then(function(fn){
              return fn||loadSnapdom();
            }).then(function(fn){
              return withPreviewRedirectSafeFetch(function(){
                return fn(target,{scale:scale,fast:true,embedFonts:false,exclude:'video'})
                  .then(function(res){ return res.toCanvas(); });
              },fetchCache);
            }).then(function(cv){
              return canvasToJpegBuffer(cv,outW,outH).then(
                function(buf){ releaseCanvasBacking(cv); return buf; },
                function(err){ releaseCanvasBacking(cv); throw err; }
              );
            });
          }).then(function(buf){
            if(progressive){
              onFrame({index:frameIdx,total:times.length,frame:buf,mimeType:'image/jpeg',width:outW,height:outH,aspect:aspect},buf);
            } else {
              frames.push(buf);
            }
            return new Promise(function(r){ setTimeout(r,0); });
          });
        })(order[i],times[order[i]]);
      }
      return chain.then(function(){
        fetchCache=null;
        if(progressive){
          return {frames:[],streamed:true,frameCount:times.length,mimeType:'image/jpeg',width:outW,height:outH,aspect:aspect};
        }
        return {frames:frames,mimeType:'image/jpeg',width:outW,height:outH,aspect:aspect};
      },function(err){
        fetchCache=null;
        throw err;
      });
    });
  }
`;
