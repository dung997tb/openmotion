import { createHash } from 'node:crypto';
import { PREVIEW_FIRST_FRAME } from './preview-first-frame.ts';
import { PREVIEW_ASSET_READINESS } from './preview-asset-readiness.ts';
import { PREVIEW_INSPECTOR } from './preview-inspector.ts';
import { PREVIEW_INSPECTOR_STYLES } from './preview-inspector-styles.ts';
import { PREVIEW_TIMELINE_MANIFEST } from './preview-timeline-manifest.ts';
import { PREVIEW_LAYERS } from './preview-layers.ts';
import { PREVIEW_INLINE_TEXT } from './preview-inline-text.ts';
import { PREVIEW_CANVAS_DRAG } from './preview-canvas-drag.ts';
import { PREVIEW_PEER_TIMING } from './preview-peer-timing.ts';
import type { PreviewLiveEdits } from '../../../shared/preview-timing.ts';
import { PREVIEW_THUMBNAIL_CAPTURE } from './preview-thumbnail-capture.ts';
import { PREVIEW_BROWSER_EXPORT } from './preview-browser-export.ts';

function scopedScript(configuration: string, body: string): string {
  return `(function(){
  var SOURCE='openmotion-preview-bridge', PARENT='openmotion-studio', VERSION=1;
  ${configuration}
  var token=new globalThis.URL(location.href).searchParams.get('pt');
  if(!token || window.parent===window) return;
  var parentWindow=window.parent;
  var parentOrigin='*';
  try { if(document.referrer) parentOrigin=new globalThis.URL(document.referrer).origin; } catch (_) {}
  function post(type,payload,requestId,transfer,explicitOrigin){
    var message=Object.assign({source:SOURCE,version:VERSION,type:type,projectId:projectId,token:token},payload||{});
    if(requestId) message.requestId=requestId;
    var targetOrigin=explicitOrigin||(parentOrigin==='null'?'*':parentOrigin);
    if(transfer&&transfer.length) parentWindow.postMessage(message,targetOrigin,transfer);
    else parentWindow.postMessage(message,targetOrigin);
  }
  ${body}
})();`;
}

export function previewBuildBusyScript(projectId: string, retryAfterSeconds: number): string {
  return scopedScript(`var projectId=${JSON.stringify(projectId).replace(/</g, '\\u003c')};`,
    `post('preview-build-busy',{retryAfterMs:${retryAfterSeconds * 1000}});`);
}

/**
 * Install the cookie-less preview bridge used when a preview is served from
 * PREVIEW_PUBLIC_ORIGIN. The bridge is inert without a project token, so local
 * same-origin previews keep their existing DOM/runtime fast path.
 */
export const PREVIEW_SOURCE_IDENTITY = `
  function sourceIdentity(raw) {
    if (!raw) return {};
    return raw.startsWith('"patch:') ? {fileVersion:raw} : {sha256:raw, fileVersion:'"sha256:'+raw+'"'};
  }
`;

export const PREVIEW_BRIDGE_SCRIPT = scopedScript(`
  var settings=JSON.parse(document.currentScript.getAttribute('data-openmotion-preview'));
  var projectId=settings.projectId, compositionPath=settings.compositionPath, sourceVersions=settings.sourceVersions;`, `
  ${PREVIEW_SOURCE_IDENTITY}
  var pickMode=false, picked=null;
  var isCaptureMode=new globalThis.URL(location.href).searchParams.get('capture')==='1';
  var durationBootAnnounced=false;
  var bootPoll=null;
  function player(){ return window.__player || null; }
  ${PREVIEW_FIRST_FRAME}
  ${PREVIEW_ASSET_READINESS}
  function assetState(duration){
    if(isCaptureMode) return {status:'ready',completed:0,total:0,failed:[]};
    if(!(duration>0)) return {status:'loading',completed:0,total:0,failed:[]};
    return ensureAssetTracker(function(snapshot){ post('asset-readiness',snapshot); }).snapshot();
  }
  function timeline(includeManifest){
    var p=player();
    var currentTime=p&&typeof p.getTime==='function'?Number(p.getTime())||0:0;
    var duration=p&&typeof p.getDuration==='function'?Number(p.getDuration())||0:0;
    return {currentTime:currentTime,duration:duration,firstFrame:isCaptureMode?'ready':(duration>0?visualFrameStatus(currentTime):'loading'),
      assets:assetState(duration),
      isPlaying:p&&typeof p.isPlaying==='function'?p.isPlaying()===true:false,
      width:window.__clipManifest&&window.__clipManifest.compositionWidth, height:window.__clipManifest&&window.__clipManifest.compositionHeight,
      fps:window.__clipManifest&&window.__clipManifest.fps,
      durationInFrames:window.__clipManifest&&Number(window.__clipManifest.durationInFrames)||0,
      timelinePath:includeManifest?compositionPath:undefined,
      timelineVersion:includeManifest?sourceIdentity(sourceVersions?.[compositionPath]).fileVersion:undefined,
      clips:includeManifest&&window.__clipManifest&&Array.isArray(window.__clipManifest.clips)?authoredTimelineClips(window.__clipManifest.clips):undefined};
  }
  function sourceFileForElement(element){
    var owner=element.parentElement&&element.parentElement.closest('[data-composition-file],[data-composition-src]');
    return (owner&&(owner.getAttribute('data-composition-file')||owner.getAttribute('data-composition-src'))) || compositionPath;
  }
  function describe(element){
    if(!element || element.nodeType!==1) return null;
    var rect=element.getBoundingClientRect();
    var text=(element.innerText||element.textContent||'').replace(/\\s+/g,' ').trim().slice(0,240);
    var hfId=element.getAttribute('data-hf-id');
    return {elementId:element.id||null,hfId:hfId,sourceFile:sourceFileForElement(element),
      selector:element.id?'#'+CSS.escape(element.id):hfId?'[data-hf-id="'+CSS.escape(hfId)+'"]':null,
      tagName:element.tagName.toLowerCase(),text:text||null,textContent:element.textContent,
      geometry:{x:rect.left,y:rect.top,width:rect.width,height:rect.height},
      viewport:{width:innerWidth,height:innerHeight}};
  }
  ${PREVIEW_TIMELINE_MANIFEST}
  ${PREVIEW_CANVAS_DRAG}
  ${PREVIEW_INLINE_TEXT}
  ${PREVIEW_PEER_TIMING}
  ${PREVIEW_INSPECTOR}
  ${PREVIEW_INSPECTOR_STYLES}
  ${PREVIEW_LAYERS}
  ${PREVIEW_THUMBNAIL_CAPTURE}
  ${PREVIEW_BROWSER_EXPORT}
  function respond(requestId,result,error,transfer,explicitOrigin){
    var message=Object.assign({source:SOURCE,version:VERSION,type:'response',projectId:projectId,token:token},error?{ok:false,error:String(error)}:{ok:true,result:result});
    if(requestId) message.requestId=requestId;
    var targetOrigin=explicitOrigin||(parentOrigin==='null'?'*':parentOrigin);
    if(transfer&&transfer.length) parentWindow.postMessage(message,targetOrigin,transfer);
    else parentWindow.postMessage(message,targetOrigin);
  }
  function ready(){
    post('preview-ready',{timingDocumentId:timingDocumentId,styleDocumentId:styleDocumentId,liveEdits:settings.liveEdits,htmlSources:settings.htmlSources,capabilities:['selection','selection-geometry','edit-element','timeline','playback-control','pick-mode','layer-tree','layer-select','layer-family','inspect-element','canvas-framing','canvas-drag','inline-text','asset-readiness','thumbnail-capture','browser-export']});
    var state=timeline(true);
    if(state.duration>0){
      durationBootAnnounced=true;
      if(bootPoll){ clearInterval(bootPoll); bootPoll=null; }
    }
    post('timeline-state',state);
  }
  function announceDurationIfReady(){
    if(durationBootAnnounced) return true;
    if(document.readyState==='loading') return false;
    var p=player();
    var d=p&&typeof p.getDuration==='function'?Number(p.getDuration())||0:0;
    if(!(d>0)) return false;
    durationBootAnnounced=true;
    if(bootPoll){ clearInterval(bootPoll); bootPoll=null; }
    post('timeline-state',timeline(true));
    return true;
  }
  window.addEventListener('message',function(event){
    if(event.source!==parentWindow) return;
    var message=event.data;
    if(!message || message.source!==PARENT || message.version!==VERSION || message.projectId!==projectId || message.token!==token) return;
    var requestId=message.requestId;
    try {
      if(message.type==='peer-timing' || message.type==='peer-presentation'){
        if (!settings.studioOrigin || settings.studioOrigin !== event.origin) return;
        respond(requestId,applyPeerTiming(message)); return;
      }
      if(message.type==='handshake'){
        if(message.timelineOnly) post('timeline-state',timeline(true));
        else { ready(); respond(requestId,{ready:true}); }
        return;
      }
      if(message.type==='retry-failed-assets'){
        var tracker=ensureAssetTracker(function(snapshot){ post('asset-readiness',snapshot); });
        tracker.retryFailed(function(snapshot){ post('asset-readiness',snapshot); respond(requestId,snapshot); });
        return;
      }
      if(message.type==='capture-frames'){
        var onFrame=message.progressive===true?function(frameEvent,buf){
          post('capture-frame',frameEvent,requestId,buf?[buf]:undefined);
        }:null;
        capturePreviewFrames(message,onFrame).then(function(result){
          respond(requestId,result,null,result&&Array.isArray(result.frames)&&result.frames.length?result.frames:undefined);
        },function(error){
          respond(requestId,null,error);
        });
        return;
      }
      if(message.type==='browser-export-start'){
        if(!settings.studioOrigin || settings.studioOrigin !== event.origin) return;
        var exportTargetOrigin=settings.studioOrigin;
        startBridgeBrowserExport(message,function(update){
          post('browser-export-progress',update,requestId,undefined,exportTargetOrigin);
        }).then(function(result){
          respond(requestId,result,null,result&&result.buffer?[result.buffer]:undefined,exportTargetOrigin);
        },function(error){
          respond(requestId,null,error,undefined,exportTargetOrigin);
        });
        return;
      }
      if(message.type==='browser-export-cancel'){
        if(!settings.studioOrigin || settings.studioOrigin !== event.origin) return;
        respond(requestId,{cancelled:cancelBridgeBrowserExport(message)},null,undefined,settings.studioOrigin);
        return;
      }
      if(message.type==='playback-control'){
        var p=player(), action=message.action;
        if(!p) throw new Error('Preview player is not ready');
        if(action==='play' && typeof p.play==='function') p.play();
        else if(action==='pause' && typeof p.pause==='function') p.pause();
        else if(action==='seek' && typeof p.seek==='function') p.seek(Math.max(0,Number(message.time)||0));
        else throw new Error('Unsupported playback action');
        post('timeline-state',timeline()); respond(requestId,timeline()); return;
      }
      if(message.type==='canvas-framing'){
        var canvas=document.querySelector('[data-composition-id]');
        respond(requestId,canvas?{sourceFile:compositionPath,fit:canvas.getAttribute('data-canvas-fit')==='cover'?'cover':'contain'}:null); return;
      }
      if(message.type==='inspect-element'){ respond(requestId,inspectPreviewElement(message)); return; }
      if(message.type==='inspector-styles'){
        if(settings.studioOrigin && settings.studioOrigin === event.origin) previewInspectorStyles(message);
        return;
      }
      if(message.type==='layer-tree'){ previewLayerTree(message); return; }
      if(message.type==='layer-family'){ respond(requestId,previewLayerFamily(message)); return; }
      if(message.type==='layer-select'){ respond(requestId,selectPreviewLayer(message)); return; }
      if(message.type==='inline-text'){
        var textTarget=editInlineText(message);
        if(message.phase==='pick') respond(requestId,textTarget);
        return;
      }
      if(message.type==='canvas-drag'){
        var result=canvasDrag(message);
        if(message.phase==='start'){
          const hit=result?drag.element:document.elementFromPoint(message.x * innerWidth,message.y * innerHeight)?.closest('[data-hf-id],[id]');
          if(hit && hit!==document.body && hit!==document.documentElement) reportLayerSelection(hit, result?drag.selection:describe(hit));
        }
        if(message.phase==='start' || message.phase==='finish') respond(requestId,result);
        return;
      }
      if(message.type==='pick-mode'){
        pickMode=message.enabled===true;
        respond(requestId,{enabled:pickMode}); return;
      }
      if(message.type==='selection-geometry'){
        var target=message.elementId?document.getElementById(String(message.elementId)):null;
        respond(requestId,target?describe(target):null); if(target) post('selection-geometry',{selection:describe(target)}); return;
      }
      if(message.type==='edit-element'){
        if(!message.operation){
          window.dispatchEvent(new CustomEvent('openmotion:edit-element',{detail:message}));
          respond(requestId,{accepted:true}); return;
        }
        if(!picked || !picked.isConnected || describe(picked).selector!==message.selector)
          throw new Error('Preview selection changed');
        var op=message.operation;
        if(!op || typeof op.value!=='string' || typeof op.property!=='string') throw new Error('Invalid edit');
        if(op.type==='inline-style') picked.style.setProperty(op.property,op.value);
        else if(op.type==='text-content') picked.textContent=op.value;
        else if(op.type==='attribute') picked.setAttribute('data-'+op.property,op.value);
        else throw new Error('Unsupported edit');
        respond(requestId,{accepted:true}); return;
      }
      respond(requestId,{accepted:false},'Unsupported preview message');
    } catch(error) { respond(requestId,null,error); post('runtime-error',{message:String(error&&error.message||error),sourceType:'bridge'}); }
  });
  document.addEventListener('click',function(event){
    if(!pickMode) return;
    var target=event.target;
    var detail=describe(target);
    if(detail && detail.selector){ picked=target; pickMode=false; post('select-element',{selection:detail}); }
  },true);
  window.addEventListener('error',function(event){ post('runtime-error',{message:String(event.message||'Preview runtime error'),filename:event.filename||null,line:event.lineno||null}); });
  window.addEventListener('unhandledrejection',function(event){ post('runtime-error',{message:String(event.reason&&event.reason.message||event.reason||'Unhandled preview rejection')}); });
  window.addEventListener('load',ready);
  document.addEventListener('DOMContentLoaded',announceDurationIfReady);
  if(isCaptureMode) loadSnapdom().catch(function(){});
  if(!announceDurationIfReady()){
    var bootPollTicks=0;
    bootPoll=setInterval(function(){
      if(announceDurationIfReady() || ++bootPollTicks>=160){
        clearInterval(bootPoll);
        bootPoll=null;
      }
    },25);
  }
  setInterval(function(){ if(document.visibilityState!=='hidden' && !(isCaptureMode && durationBootAnnounced)) post('timeline-state',timeline()); },500);
`);

export const PREVIEW_BRIDGE_PATH = '/api/preview-bridge.js';
export const PREVIEW_BRIDGE_VERSION = createHash('sha256').update(PREVIEW_BRIDGE_SCRIPT).digest('hex');
export const PREVIEW_BRIDGE_ASSET = '/api/preview-bridge/' + PREVIEW_BRIDGE_VERSION + '.js';
export const PREVIEW_BRIDGE_ASSET_RE = /^\/api\/preview-bridge\/([a-f0-9]{64})\.js$/;
const bridgeIntegrity = 'sha256-' + Buffer.from(PREVIEW_BRIDGE_VERSION, 'hex').toString('base64');

function htmlAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function bridgeDocumentTags(origin: string, projectId: string, compositionPath: string, sourceVersions: Record<string, string>, studioOrigin?: string, canRebindTiming?: boolean, htmlSources?: string[], liveEdits?: PreviewLiveEdits) {
  const src = new URL(PREVIEW_BRIDGE_ASSET, origin);
  const settings = htmlAttribute(JSON.stringify({ projectId, compositionPath, sourceVersions, studioOrigin, htmlSources, liveEdits, ...(canRebindTiming && { canRebindTiming }) }));
  // A pod from before this route existed may still serve an asset request
  // during rollout. Reuse the player's bounded preview retry if loading fails.
  const retry = htmlAttribute(previewBuildBusyScript(projectId, 1));
  return {
    preload: `<link rel="preload" as="script" href="${src.href}" integrity="${bridgeIntegrity}">`,
    script: `<script src="${src.href}" data-openmotion-preview="${settings}" integrity="${bridgeIntegrity}" onerror="${retry}"></script>\n`,
  };
}
