/**
 * Embedded ES5 browser-export runner helper for isolated preview iframes (`PREVIEW_PUBLIC_ORIGIN`).
 * Lazily loads `/api/vendor/browser-export.js` only when Studio initiates a browser export,
 * keeping normal interactive preview loads completely untouched.
 */
export const PREVIEW_BROWSER_EXPORT = `
  var browserExportBundlePromise=null;
  var activeBrowserExports={};
  function loadBrowserExportRunner(){
    if(window.__openmotionBrowserExport && typeof window.__openmotionBrowserExport.run==='function'){
      return Promise.resolve(window.__openmotionBrowserExport);
    }
    if(browserExportBundlePromise) return browserExportBundlePromise;
    browserExportBundlePromise=new Promise(function(resolve,reject){
      var s=document.createElement('script');
      s.src='/api/vendor/browser-export.js';
      s.async=true;
      s.onload=function(){
        if(window.__openmotionBrowserExport && typeof window.__openmotionBrowserExport.run==='function'){
          resolve(window.__openmotionBrowserExport);
        } else {
          browserExportBundlePromise=null;
          reject(new Error('Browser export runner unavailable'));
        }
      };
      s.onerror=function(){
        browserExportBundlePromise=null;
        reject(new Error('Failed to load browser export runner'));
      };
      (document.head||document.documentElement).appendChild(s);
    });
    return browserExportBundlePromise;
  }
  function startBridgeBrowserExport(message,onProgress){
    var exportId=String(message.exportId||message.requestId||'default');
    var controller=typeof AbortController==='function'?new AbortController():null;
    if(controller) activeBrowserExports[exportId]=controller;
    return loadBrowserExportRunner().then(function(runner){
      if(controller && controller.signal && controller.signal.aborted){
        throw new DOMException('Aborted','AbortError');
      }
      return runner.run(message.payload||{}, {
        signal: controller ? controller.signal : undefined,
        onProgress: function(update){
          if(typeof onProgress==='function'){
            onProgress({
              exportId: exportId,
              progress: update && typeof update.progress==='number' ? update.progress : 0,
              stage: update && typeof update.stage==='string' ? update.stage : ''
            });
          }
        }
      });
    }).then(function(result){
      delete activeBrowserExports[exportId];
      return result;
    },function(error){
      delete activeBrowserExports[exportId];
      throw error;
    });
  }
  function cancelBridgeBrowserExport(message){
    var exportId=String(message.exportId||message.requestId||'default');
    var controller=activeBrowserExports[exportId];
    if(controller){
      delete activeBrowserExports[exportId];
      try { controller.abort(); } catch(_){}
      return true;
    }
    return false;
  }
`;
