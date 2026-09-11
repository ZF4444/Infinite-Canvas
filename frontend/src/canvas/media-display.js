// 从 frontend/src/canvas/main.js 剪切出的媒体展示/下载逻辑（M11 拆分批次）。
// 剪切时未改动任何函数签名/内部逻辑，只做了纯粹的位置搬移。
//
// 为什么这里不用 ES module 的 export/import（跟 M1-M10 同一个原因）：
// canvas.js 依赖经典 <script> 的全局作用域语义，
// static/canvas.html 里 57 处内联 onclick="xxx()" 都依赖这一点。
// 所以这里同样只做"物理文件拆分"：media-display.js 保持经典脚本语法，通过
// <script src="media-display.js"> 排在 upload.js 之后、canvas-render.js
// 之前加载（本文件是 mediaKindForItem/thumbMediaHtml 等基础媒体类型判定
// 工具，canvas-render.js/image-editor.js 等多个模块都会调用；不过classic
// <script> 之间函数调用是运行时解析、不要求定义顺序在调用之前，所以放在
// 哪个位置都不影响正确性，这里放前面只是为了阅读顺序更自然）。
//
// 本文件覆盖节点媒体展示与下载的全部逻辑（原文件 3361-4037 行区间，约
// 680行）：
//   1. 媒体类型判定：isVideoMediaItem / isAudioMediaItem / isTextMediaItem /
//      isFileMediaItem / outputMediaKindForItem / defaultOutputExtForKind /
//      normalizeOutputMediaItems / mediaKindForFile / mediaKindForItem /
//      mediaKindForUrls / looksLikeImageMediaUrl / imageRefsOnly /
//      videoRefsOnly / audioRefsOnly
//   2. 结果 URL 归一化：resultMediaUrls（兼容各家 API 千奇百怪的返回
//      结构，抽取出统一的 {url, file_id, kind, name} 列表）/
//      localDisplayUrlForMediaItem / imageForDisplay
//   3. 缩略图/尺寸展示：thumbMediaHtml / imageResolutionLabel /
//      imageResolutionBadgeHtml / thumbDisplaySize / thumbItemStyle /
//      applyThumbDisplaySizeToElement / singleMediaHtml
//   4. 节点内实时媒体元素（video/audio）的播放状态保存与恢复：
//      smartNodeHasLiveMedia / mediaSignaturePartFromElement /
//      captureMediaPlaybackState(s) / restoreMediaPlaybackState(s) /
//      transplantSmartMediaElements（渲染重建 DOM 时把旧的 video/audio
//      元素原地"移植"到新节点，避免打断正在播放的媒体）
//   5. 画布内视频预览播放/退出全屏：captureVideoPreviewFrame /
//      isVideoPreviewFullscreen / deactivateCanvasVideoPreview /
//      handleCanvasVideoFullscreenExit / syncActiveCanvasVideoSize /
//      activateCanvasVideoPreview
//   6. 文件 URL/代理/下载相关：outputUrlLooksVideo / filePreviewUrl /
//      fileThumbnailUrl / proxiedMediaUrl / thumbMediaUrl /
//      renderedThumbSrcForRef / videoPosterHtml / displayMediaUrl /
//      bindImageProxyFallback / safeExportFileName / fileNameFromUrl /
//      fileIdFromUrl / fileDownloadUrl / extensionForMediaItem /
//      downloadNameForMediaItem
//   7. 下载动作：downloadPreviewImage / downloadPreviewFile /
//      previewDownloadGroupItems / downloadPreviewGroup /
//      isGroupShortcutNode / downloadGroupNodeImages
//
// 明确排除、留在 main.js 的内容：
//   - updateNodeElementDuringResize 及其前面的节点拖拽/缩放函数（物理上
//     紧邻本文件开头，但是节点拖拽调整尺寸时的 DOM 实时更新逻辑，跟
//     媒体展示无关，属于 canvas-render.js 同类关注点，本次不动）。
//   - smartRunPlatformLabel/smartRunSnapshot/addSmartGenerationLog 及其
//     后的生成运行日志系统（物理上紧邻本文件结尾，但是"运行日志"功能
//     ——记录每次生成任务的模型/耗时/结果，不是媒体展示/下载功能）。
//     这个日志系统会调用本文件里的 smartRunTaskLabel（本文件内定义，
//     随本次搬移），是 main.js → media-display.js 的正向引用，跟经典
//     脚本共享全局作用域的调用方式一致，不受先后加载顺序影响。

function isVideoMediaItem(img){
    if(!img) return false;
    if(img.kind === 'video') return true;
    const url = String(img.url || '').toLowerCase();
    return /\.(mp4|webm|mov|m4v)(\?|$)/.test(url);
}
function isAudioMediaItem(img){
    if(!img) return false;
    if(img.kind === 'audio') return true;
    const url = String(img.url || '').toLowerCase();
    return /\.(mp3|wav|m4a|aac|ogg|flac)(\?|$)/.test(url);
}
function isTextMediaItem(img){
    if(!img) return false;
    if(img.kind === 'text') return true;
    const url = String(img.url || '').toLowerCase();
    return /\.(txt|json|csv|srt|vtt|md)(\?|$)/.test(url);
}
function isFileMediaItem(img){
    if(!img) return false;
    if(img.kind === 'file') return true;
    const url = String(img.url || '').toLowerCase();
    return /\.(zip|rar|7z|tar|gz|psd|psb|ply|splat|glb|gltf|obj|fbx|stl)(\?|$)/.test(url);
}
function outputMediaKindForItem(item, fallback='image'){
    const obj = typeof item === 'string' ? {url:item} : (item || {});
    const explicit = String(obj.kind || obj.type || obj.mediaKind || '').toLowerCase();
    if(['image','video','audio','text','file'].includes(explicit)) return explicit;
    return mediaKindForItem({...obj, kind:''}) || fallback || 'image';
}
function defaultOutputExtForKind(kind='image'){
    if(kind === 'video') return 'mp4';
    if(kind === 'audio') return 'mp3';
    if(kind === 'text') return 'txt';
    if(kind === 'file') return 'zip';
    return 'png';
}
function normalizeOutputMediaItems(items=[], fallbackKind='image', meta=null){
    return (items || []).map((item, i) => {
        const source = typeof item === 'string' ? {url:item} : (item || {});
        const url = source.url || source.path || source.src || source.uri || '';
        if(!url) return null;
        const kind = outputMediaKindForItem(source, fallbackKind);
        const ext = defaultOutputExtForKind(kind);
        const image = {
            ...source,
            url,
            file_id:source.file_id || fileIdFromUrl(url),
            name:source.name || source.filename || `output-${i + 1}.${ext}`,
            kind,
            generatedResult:true
        };
        return kind === 'image' && meta
            ? generatedImageWithRunMeta(image, meta)
            : stripImageGenerationMeta(image);
    }).filter(item => item?.url);
}
function mediaKindForFile(file){
    const type = String(file?.type || '').toLowerCase();
    const name = String(file?.name || '').toLowerCase();
    if(type.startsWith('video/') || /\.(mp4|webm|mov|m4v|avi|mkv)(\?|$)/.test(name)) return 'video';
    if(type.startsWith('audio/') || /\.(mp3|wav|m4a|aac|ogg|flac)(\?|$)/.test(name)) return 'audio';
    if(type.startsWith('text/') || /\.(txt|json|csv|srt|vtt|md)(\?|$)/.test(name)) return 'text';
    if(/\.(zip|rar|7z|tar|gz|psd|psb|ply|splat|glb|gltf|obj|fbx|stl)(\?|$)/.test(name)) return 'file';
    return 'image';
}
function mediaKindForItem(img){
    if(isFileMediaItem(img)) return 'file';
    if(isTextMediaItem(img)) return 'text';
    if(isAudioMediaItem(img)) return 'audio';
    if(isVideoMediaItem(img)) return 'video';
    return 'image';
}
function localDisplayUrlForMediaItem(img){
    if(!img) return '';
    const candidates = [
        img.originalLocalUrl,
        img.localUrl,
        img.sourceUrl,
        img.local_url,
        img.source_url,
        img.url
    ];
    const local = candidates.find(url => url && !/^https?:\/\//i.test(String(url)));
    return local || img.url || '';
}
function imageForDisplay(img){
    if(!img || typeof img !== 'object') return img;
    const localUrl = localDisplayUrlForMediaItem(img);
    if(!localUrl || localUrl === img.url) return img;
    return {
        ...img,
        url:localUrl,
        originalLocalUrl:img.originalLocalUrl || localUrl
    };
}
function resultMediaUrls(result){
    const urls = [];
    const add = value => {
        if(!value) return;
        if(typeof value === 'string'){
            urls.push(value);
            return;
        }
        if(Array.isArray(value)){
            value.forEach(add);
            return;
        }
        if(typeof value === 'object'){
            if(value.url || value.path || value.src || value.uri){
                const url = value.url || value.path || value.src || value.uri;
                if(url){
                    const item = {
                    url,
                    file_id:value.file_id || value.fileId || '',
                    kind:value.kind || value.type || value.mediaKind || '',
                    name:value.name || value.filename || ''
                    };
                    const size = value.size || value.size_bytes || value.file_size;
                    const createdAt = value.created_at || value.createdAt;
                    const width = value.natural_w || value.width || value.w;
                    const height = value.natural_h || value.height || value.h;
                    if(size) item.size = size;
                    if(createdAt) item.created_at = createdAt;
                    if(width) item.natural_w = width;
                    if(height) item.natural_h = height;
                    urls.push(item);
                }
            }
            ['items','outputs','videos','video_items','videoItems','audios','audio_items','audioItems','texts','files','file_items','fileItems','images','image_items','imageItems','urls','data','result','output','url'].forEach(key => add(value[key]));
            ['path','src','uri','output_url','outputUrl','video','video_url','videoUrl','mp4_url','mp4Url','download_url','downloadUrl','preview_url','previewUrl'].forEach(key => add(value[key]));
        }
    };
    add(result);
    const seen = new Map();
    const deduped = [];
    urls.map(item => {
        const url = typeof item === 'string' ? item : item?.url || item?.path || '';
        if(!url) return null;
        return typeof item === 'object' ? {...item, url} : url;
    }).filter(Boolean).forEach(item => {
        const url = typeof item === 'string' ? item : item?.url || '';
        if(!url) return;
        if(!seen.has(url)){
            seen.set(url, deduped.length);
            deduped.push(item);
            return;
        }
        const index = seen.get(url);
        const existing = deduped[index];
        if(typeof existing === 'string' && typeof item === 'object') deduped[index] = item;
    });
    return deduped;
}
function mediaKindForUrls(urls, fallback='image'){
    const items = (urls || []).map(item => typeof item === 'string' ? {url:item} : (item || {}));
    if(items.some(isFileMediaItem)) return 'file';
    if(items.some(isVideoMediaItem)) return 'video';
    if(items.some(isAudioMediaItem)) return 'audio';
    if(items.some(isTextMediaItem)) return 'text';
    if(fallback && fallback !== 'image') return fallback;
    return fallback;
}
function imageRefsOnly(refs){
    return (refs || []).filter(ref => ref?.url && mediaKindForItem(ref) === 'image');
}
function looksLikeImageMediaUrl(url){
    const text = String(url || '').trim().toLowerCase();
    if(!text) return false;
    if(text.startsWith('data:image/')) return true;
    if(text.startsWith('asset://')) return false;
    const path = text.split('?', 1)[0].split('#', 1)[0];
    return /\.(png|jpe?g|webp|gif|bmp|tiff)$/i.test(path);
}
function videoRefsOnly(refs){
    return (refs || []).filter(ref => ref?.url && mediaKindForItem(ref) === 'video' && !looksLikeImageMediaUrl(ref.url));
}
function audioRefsOnly(refs){
    return (refs || []).filter(ref => ref?.url && mediaKindForItem(ref) === 'audio');
}
function thumbMediaHtml(img){
    if(isFileMediaItem(img) || isTextMediaItem(img)){
        if(!isTextMediaItem(img) && /\.zip(\?|$)/i.test(String(img.url || '')))
            return `<img src="/static/images/zip-placeholder.svg" data-original-src="${escapeAttr(img.url || '')}" data-kind="file" draggable="false">`;
        return `<div class="media-thumb file-thumb" data-media-url="${escapeAttr(img.url || '')}" data-media-kind="${escapeAttr(mediaKindForItem(img))}"><i data-lucide="${isTextMediaItem(img) ? 'file-text' : 'file'}"></i><span>${escapeHtml(img.name || (isTextMediaItem(img) ? 'Text' : 'File'))}</span></div>`;
    }
    if(isAudioMediaItem(img)) return `<div class="media-thumb audio-thumb" data-media-url="${escapeAttr(img.url || '')}" data-media-kind="audio"><i data-lucide="file-audio"></i><span>${escapeHtml(img.name || 'Audio')}</span></div>`;
    if(isVideoMediaItem(img)) return `<div class="media-thumb video-thumb" data-video-preview-container="1">${videoPosterHtml(img, 'video-poster is-blurred')}<span class="smart-video-badge"><i data-lucide="play"></i></span></div>`;
    return `<img src="${escapeHtml(thumbMediaUrl(img))}" data-original-src="${escapeAttr(img.url || '')}" draggable="false">`;
}
function imageResolutionLabel(img){
    const w = Number(img?.natural_w || img?.width || img?.w || 0);
    const h = Number(img?.natural_h || img?.height || img?.h || 0);
    return w > 0 && h > 0 ? `${Math.round(w)} x ${Math.round(h)}` : '';
}
function imageResolutionBadgeHtml(img){
    return '';
}
function thumbDisplaySize(img, maxSize){
    const limit = Math.max(28, Math.round(Number(maxSize) || 96));
    const w = Number(img?.natural_w || img?.width || img?.w || 0);
    const h = Number(img?.natural_h || img?.height || img?.h || 0);
    if(!(w > 0 && h > 0)) return {width:limit, height:limit};
    const fit = Math.min(limit / w, limit / h);
    return {
        width:Math.max(28, Math.round(w * fit)),
        height:Math.max(28, Math.round(h * fit))
    };
}
function thumbItemStyle(img, maxSize){
    const size = thumbDisplaySize(img, maxSize);
    return `--thumb-w:${size.width}px;--thumb-h:${size.height}px`;
}
function applyThumbDisplaySizeToElement(itemEl, img, maxSize=0){
    if(!itemEl?.classList?.contains('thumb-item')) return;
    const limit = Math.max(
        28,
        Math.round(
            Number(maxSize || 0)
            || Number(itemEl.style.getPropertyValue('--thumb-size').replace('px', ''))
            || Math.max(itemEl.clientWidth || 0, itemEl.clientHeight || 0)
            || 96
        )
    );
    const size = thumbDisplaySize(img, limit);
    itemEl.style.setProperty('--thumb-w', `${size.width}px`);
    itemEl.style.setProperty('--thumb-h', `${size.height}px`);
}
function singleMediaHtml(img, w, h){
    if(isFileMediaItem(img) || isTextMediaItem(img)){
        if(!isTextMediaItem(img) && /\.zip(\?|$)/i.test(String(img.url || '')))
            return `<img class="node-img" src="/static/images/zip-placeholder.svg" data-original-src="${escapeAttr(img.url || '')}" data-kind="file" draggable="false" style="width:${w}px;height:${h}px">`;
        return `<div class="node-img media-card media-file-card" style="width:${w}px;height:${h}px"><div class="media-card-icon"><i data-lucide="${isTextMediaItem(img) ? 'file-text' : 'file'}"></i></div><div class="media-card-title">${escapeHtml(img.name || (isTextMediaItem(img) ? 'Text' : 'File'))}</div><div class="media-card-sub">${isTextMediaItem(img) ? 'TEXT' : 'FILE'}</div></div>`;
    }
    if(isAudioMediaItem(img)) return `<div class="node-img media-card media-audio-card" style="width:${w}px;height:${h}px"><div class="media-card-icon"><i data-lucide="file-audio"></i></div><div class="media-card-title">${escapeHtml(img.name || 'Audio')}</div><div class="media-card-sub">AUDIO</div><audio src="${escapeAttr(img.url || '')}" data-url="${escapeAttr(img.url || '')}" controls preload="metadata"></audio></div>`;
    if(isVideoMediaItem(img)) return `<div class="node-img media-card media-video-card" data-video-preview-container="1" style="width:${w}px;height:${h}px">${videoPosterHtml(img, 'node-img video-poster is-blurred', `width:${w}px;height:${h}px`)}<span class="smart-video-badge large"><i data-lucide="play"></i></span></div>`;
    return `<img class="node-img" src="${escapeHtml(thumbMediaUrl(img))}" data-original-src="${escapeAttr(img.url || '')}" draggable="false" style="width:${w}px;height:${h}px">`;
}
function smartNodeHasLiveMedia(node){
    return Boolean(!node?.pending && (node?.images || []).some(img => isVideoMediaItem(img) || isAudioMediaItem(img)));
}
function mediaSignaturePartFromElement(itemEl){
    if(itemEl?.dataset?.mediaSignature) return itemEl.dataset.mediaSignature;
    const media = itemEl?.querySelector?.('video,audio,img');
    if(media){
        const tag = media.tagName.toLowerCase();
        const kind = tag === 'video' ? 'video' : tag === 'audio' ? 'audio' : 'image';
        const url = media.dataset?.url || media.dataset?.originalSrc || media.getAttribute('src') || '';
        return `${kind}:${url}`;
    }
    const audioThumb = itemEl?.querySelector?.('.audio-thumb[data-media-url]');
    if(audioThumb) return `audio:${audioThumb.dataset.mediaUrl || ''}`;
    return '';
}
function captureMediaPlaybackState(media){
    if(!media) return null;
    return {
        currentTime:Number.isFinite(media.currentTime) ? media.currentTime : 0,
        paused:Boolean(media.paused),
        playbackRate:Number.isFinite(media.playbackRate) ? media.playbackRate : 1,
        muted:Boolean(media.muted),
        volume:Number.isFinite(media.volume) ? media.volume : 1
    };
}
function restoreMediaPlaybackState(media, state){
    if(!media || !state) return;
    try { media.playbackRate = state.playbackRate || 1; } catch(e) {}
    try { media.muted = state.muted; } catch(e) {}
    try { media.volume = state.volume; } catch(e) {}
    const applyTime = () => {
        if(Number.isFinite(state.currentTime) && state.currentTime > 0 && Math.abs((media.currentTime || 0) - state.currentTime) > 0.2){
            try { media.currentTime = state.currentTime; } catch(e) {}
        }
        if(!state.paused && typeof media.play === 'function'){
            const playPromise = media.play();
            if(playPromise?.catch) playPromise.catch(() => {});
        }
    };
    if(media.readyState >= 1) applyTime();
    else media.addEventListener('loadedmetadata', applyTime, {once:true});
}
function transplantSmartMediaElements(oldNodeEl, newNodeEl){
    const oldItems = [...(oldNodeEl?.querySelectorAll?.('.thumb-item,.image-wrap') || [])];
    const newItems = [...(newNodeEl?.querySelectorAll?.('.thumb-item,.image-wrap') || [])];
    oldItems.forEach((oldItem, index) => {
        const oldMedia = oldItem.querySelector('video,audio');
        if(!oldMedia) return;
        const selector = oldMedia.tagName.toLowerCase();
        const oldUrl = oldMedia.dataset?.url || oldMedia.getAttribute('src') || '';
        const oldSignature = oldItem.dataset?.mediaSignature || `${selector}:${oldUrl}`;
        const newItem = newItems.find(item => item.dataset?.mediaSignature === oldSignature)
            || newItems.find(item => item.querySelector?.(selector)?.dataset?.url === oldUrl)
            || newItems[index];
        const newMedia = newItem?.querySelector?.(selector);
        const newUrl = newMedia?.dataset?.url || newMedia?.getAttribute?.('src') || '';
        if(!newMedia || oldUrl !== newUrl) return;
        const state = captureMediaPlaybackState(oldMedia);
        oldMedia.className = newMedia.className;
        oldMedia.style.cssText = newMedia.style.cssText;
        if(oldMedia.tagName.toLowerCase() === 'video'){
            oldMedia.poster = newMedia.poster || '';
            oldMedia.preload = newMedia.preload || oldMedia.preload;
        }
        newMedia.replaceWith(oldMedia);
        restoreMediaPlaybackState(oldMedia, state);
        requestAnimationFrame(() => restoreMediaPlaybackState(oldMedia, state));
    });
}
function captureMediaPlaybackStates(){
    const states = new Map();
    world.querySelectorAll('video[data-url], audio[data-url]').forEach(media => {
        const tag = media.tagName.toLowerCase();
        const url = media.dataset.url || media.getAttribute('src') || '';
        if(url) states.set(`${tag}:${url}`, captureMediaPlaybackState(media));
    });
    return states;
}
function restoreMediaPlaybackStates(states){
    if(!states?.size) return;
    world.querySelectorAll('video[data-url], audio[data-url]').forEach(media => {
        const tag = media.tagName.toLowerCase();
        const url = media.dataset.url || media.getAttribute('src') || '';
        restoreMediaPlaybackState(media, states.get(`${tag}:${url}`));
    });
}
function captureVideoPreviewFrame(video){
    if(!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return '';
    try {
        const maxEdge = 640;
        const scale = Math.min(1, maxEdge / Math.max(video.videoWidth, video.videoHeight));
        const width = Math.max(1, Math.round(video.videoWidth * scale));
        const height = Math.max(1, Math.round(video.videoHeight * scale));
        const canvasEl = document.createElement('canvas');
        canvasEl.width = width;
        canvasEl.height = height;
        const ctx = canvasEl.getContext('2d');
        if(!ctx) return '';
        ctx.drawImage(video, 0, 0, width, height);
        return canvasEl.toDataURL('image/jpeg', 0.76);
    } catch(e) {
        return '';
    }
}
function isVideoPreviewFullscreen(video){
    if(!video) return false;
    const fullscreenEl = document.fullscreenElement || document.webkitFullscreenElement || null;
    return Boolean(fullscreenEl && (fullscreenEl === video || fullscreenEl.contains?.(video)));
}
function deactivateCanvasVideoPreview(itemEl){
    const container = itemEl?.querySelector?.('[data-video-preview-container="1"]');
    const video = container?.querySelector?.('video[data-video-preview="1"]');
    if(!container || !video) return;
    if(isVideoPreviewFullscreen(video)) return;
    container.classList.remove('is-playing');
    const posterSrc = video.dataset.posterSrc || '';
    const frameSrc = captureVideoPreviewFrame(video) || posterSrc;
    container.dataset.previewTime = Number.isFinite(video.currentTime) ? String(video.currentTime) : '';
    try { video.pause?.(); } catch(e) {}
    const img = document.createElement('img');
    img.className = `${video.className || ''} is-blurred`.trim();
    if(frameSrc) img.src = frameSrc;
    img.dataset.originalSrc = video.dataset.originalSrc || '';
    img.dataset.posterSrc = posterSrc;
    img.dataset.videoSrc = video.dataset.url || '';
    img.draggable = false;
    if(video.style?.cssText) img.style.cssText = video.style.cssText;
    video.replaceWith(img);
}
function handleCanvasVideoFullscreenExit(){
    if(document.fullscreenElement || document.webkitFullscreenElement) return;
    world?.querySelectorAll?.('[data-video-preview-container="1"] video[data-video-preview="1"]').forEach(video => {
        const itemEl = video.closest('.thumb-item,.image-wrap');
        if(itemEl && !itemEl.matches(':hover')) deactivateCanvasVideoPreview(itemEl);
    });
}
document.addEventListener('fullscreenchange', handleCanvasVideoFullscreenExit);
document.addEventListener('webkitfullscreenchange', handleCanvasVideoFullscreenExit);
function syncActiveCanvasVideoSize(itemEl, video){
    const nodeEl = itemEl?.closest?.('.image-node');
    const node = nodes.find(candidate => candidate.id === nodeEl?.dataset?.id);
    const index = Number(itemEl?.dataset?.imageIndex ?? 0);
    const image = node?.images?.[index];
    const w = Number(video?.videoWidth || 0);
    const h = Number(video?.videoHeight || 0);
    if(!node || !image || w <= 0 || h <= 0) return;
    image.natural_w = w;
    image.natural_h = h;
    if((node.images || []).length === 1){
        const layout = imageLayout(node.images, nodeScale(node), node);
        nodeEl.style.width = `${layout.width}px`;
        nodeEl.style.height = `${layout.height}px`;
        itemEl.style.setProperty('--node-img-w', `${layout.width}px`);
        itemEl.style.setProperty('--node-img-h', `${layout.height}px`);
        const container = video.closest('[data-video-preview-container="1"]');
        if(container){
            container.style.width = `${layout.width}px`;
            container.style.height = `${layout.height}px`;
        }
    }
    scheduleSave();
}
function activateCanvasVideoPreview(itemEl){
    const container = itemEl?.querySelector?.('[data-video-preview-container="1"]');
    const poster = container?.querySelector?.('img.video-poster');
    if(!container || !poster) return;
    const src = poster.dataset.videoSrc || poster.dataset.originalSrc || '';
    if(!src) return;
    const video = document.createElement('video');
    video.className = String(poster.className || '').replace(/\bis-blurred\b/g, '').trim();
    video.src = src;
    video.dataset.url = src;
    video.dataset.videoPreview = '1';
    video.dataset.originalSrc = poster.dataset.originalSrc || '';
    video.dataset.posterSrc = poster.dataset.posterSrc || '';
    video.muted = true;
    video.autoplay = true;
    video.controls = true;
    video.loop = true;
    video.playsInline = true;
    video.preload = 'metadata';
    video.disablePictureInPicture = true;
    video.setAttribute('controls', '');
    video.setAttribute('loop', '');
    video.setAttribute('playsinline', '');
    video.setAttribute('preload', 'metadata');
    video.setAttribute('disablepictureinpicture', '');
    video.setAttribute('controlslist', 'nodownload noplaybackrate noremoteplayback');
    video.draggable = false;
    if(poster.style?.cssText) video.style.cssText = poster.style.cssText;
    video.style.removeProperty('width');
    video.style.removeProperty('height');
    const resumeTime = Math.max(0, Number(container.dataset.previewTime || 0) || 0);
    const startPlayback = () => {
        syncActiveCanvasVideoSize(itemEl, video);
        if(resumeTime > 0){
            try { video.currentTime = resumeTime; } catch(e) {}
        }
        const promise = video.play?.();
        if(promise?.catch) promise.catch(() => {});
    };
    if(video.readyState >= 1) startPlayback();
    else video.addEventListener('loadedmetadata', startPlayback, {once:true});
    container.classList.add('is-playing');
    poster.replaceWith(video);
}
function smartRunTaskLabel(run){
    const s = run?.settings || {};
    if(run?.kind === 'video') return s.videoModel || 'Video';
    if(s.engine === 'comfy') return s.comfyWorkflow || 'ComfyUI';
    return s.model || 'API Image';
}
function outputUrlLooksVideo(url){
    return /\.(mp4|webm|mov|m4v)(\?|$)/.test(String(url || '').toLowerCase());
}
function filePreviewUrl(item){
    const fileId = String(item?.file_id || '').trim();
    const explicit = String(item?.preview_url || item?.previewUrl || '').trim();
    if(explicit) return explicit;
    if(fileId) return `/api/files/${encodeURIComponent(fileId)}/preview`;
    return String(item?.url || '');
}
function fileThumbnailUrl(item){
    const fileId = String(item?.file_id || '').trim();
    if(fileId) return `/api/files/${encodeURIComponent(fileId)}/thumb`;
    return filePreviewUrl(item);
}
function proxiedMediaUrl(itemOrUrl, name=''){
    if(typeof itemOrUrl === 'string') return String(itemOrUrl || '');
    return filePreviewUrl(itemOrUrl);
}
function thumbMediaUrl(itemOrUrl){
    if(typeof itemOrUrl === 'string') return String(itemOrUrl || '');
    return fileThumbnailUrl(itemOrUrl);
}
function renderedThumbSrcForRef(ref){
    if(!ref || !world) return thumbMediaUrl(ref);
    try {
        const nodeId = String(ref.nodeId || '').trim();
        const rawImageIndex = ref.imageIndex;
        const imageIndex = rawImageIndex === '' || rawImageIndex == null ? null : Number(rawImageIndex);
        const fileId = String(ref.file_id || '').trim();
        const url = String(ref.url || '').trim();
        if(nodeId){
            const nodeEl = [...world.querySelectorAll('.image-node')].find(el => el.dataset.id === nodeId);
            if(nodeEl){
                const itemEls = [...nodeEl.querySelectorAll('[data-image-index], [data-ref-node-id][data-ref-image-index]')];
                const exact = itemEls.find(el => {
                    if(el.dataset.refNodeId && el.dataset.refNodeId !== nodeId) return false;
                    const idx = el.dataset.refImageIndex ?? el.dataset.imageIndex ?? '';
                    return imageIndex != null ? Number(idx) === imageIndex : true;
                });
                const img = exact?.querySelector?.('img');
                const src = img?.currentSrc || img?.getAttribute?.('src') || '';
                if(src) return src;
                const fallbackImg = nodeEl.querySelector('img');
                const fallbackSrc = fallbackImg?.currentSrc || fallbackImg?.getAttribute?.('src') || '';
                if(fallbackSrc) return fallbackSrc;
            }
        }
        const allImgs = [...world.querySelectorAll('img')];
        if(fileId){
            const byFile = allImgs.find(img => String(img.getAttribute('src') || '').includes(`/api/files/${fileId}/thumb`));
            const src = byFile?.currentSrc || byFile?.getAttribute?.('src') || '';
            if(src) return src;
        }
        if(url){
            const byUrl = allImgs.find(img => {
                const src = String(img.getAttribute('src') || '');
                const original = String(img.dataset.originalSrc || '');
                return src === url || original === url;
            });
            const src = byUrl?.currentSrc || byUrl?.getAttribute?.('src') || '';
            if(src) return src;
        }
    } catch(e) {}
    return thumbMediaUrl(ref);
}
function videoPosterHtml(item, extraClass='', style=''){
    const cls = extraClass ? ` class="${extraClass}"` : '';
    const styleAttr = style ? ` style="${style}"` : '';
    const fileId = String(item?.file_id || fileIdFromUrl(item?.url || '') || '').trim();
    const explicitPoster = String(item?.poster_url || item?.posterUrl || item?.thumbnail_url || item?.thumbnailUrl || '').trim();
    const posterUrl = explicitPoster || (fileId ? `/api/files/${encodeURIComponent(fileId)}/thumb` : '');
    const src = filePreviewUrl(item) || item?.url || '';
    const srcAttr = posterUrl ? ` src="${escapeAttr(posterUrl)}"` : '';
    return `<img${cls}${srcAttr} data-original-src="${escapeAttr(item?.url || '')}" data-poster-src="${escapeAttr(posterUrl)}" data-video-src="${escapeAttr(src)}" draggable="false"${styleAttr}>`;
}
function displayMediaUrl(itemOrUrl, name=''){
    if(typeof itemOrUrl === 'string') return String(itemOrUrl || '');
    return proxiedMediaUrl(itemOrUrl, name);
}
function bindImageProxyFallback(imgEl, itemOrUrl){
    if(!imgEl || imgEl.dataset.proxyFallbackBound === '1') return;
    imgEl.dataset.proxyFallbackBound = '1';
    imgEl.addEventListener('error', () => {
        if(imgEl.dataset.proxyFallbackTried === '1') return;
        const fallback = typeof itemOrUrl === 'object' && itemOrUrl ? filePreviewUrl(itemOrUrl) : String(itemOrUrl || '');
        if(!fallback || fallback === imgEl.getAttribute('src')) return;
        imgEl.dataset.proxyFallbackTried = '1';
        imgEl.src = fallback;
    });
}
function safeExportFileName(name, fallback='download.zip'){
    const cleaned = String(name || fallback).replace(/[\\/:*?"<>|]+/g, '_').trim();
    return cleaned || fallback;
}
function fileNameFromUrl(url=''){
    try {
        const parsed = new URL(String(url || ''), window.location.href);
        return decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop() || '');
    } catch(e) {
        return decodeURIComponent(String(url || '').split('?')[0].split('#')[0].split('/').filter(Boolean).pop() || '');
    }
}
function fileIdFromUrl(url=''){
    const text = String(url || '').trim();
    try {
        const parsed = new URL(text, window.location.origin);
        const match = parsed.pathname.match(/^\/api\/files\/([^/]+)\/(?:preview|download)(?:\/?$)/);
        return match ? decodeURIComponent(match[1]) : '';
    } catch(_) {
        const match = text.match(/\/api\/files\/([^/?#]+)\/(?:preview|download)(?:[/?#]|$)/);
        return match ? decodeURIComponent(match[1]) : '';
    }
}
function fileDownloadUrl(item){
    const fileId = String(item?.file_id || '').trim();
    const explicit = String(item?.download_url || item?.downloadUrl || '').trim();
    if(explicit) return explicit;
    if(fileId) return `/api/files/${encodeURIComponent(fileId)}/download`;
    return String(item?.url || '');
}
function extensionForMediaItem(item, fallback='.png'){
    const source = [item?.name, item?.url].map(value => String(value || '').split('?')[0].split('#')[0]).find(value => /\.[a-z0-9]{2,8}$/i.test(value));
    if(source) return source.match(/(\.[a-z0-9]{2,8})$/i)?.[1] || fallback;
    const kind = mediaKindForItem(item);
    if(kind === 'video') return '.mp4';
    if(kind === 'audio') return '.mp3';
    if(kind === 'text') return '.txt';
    return fallback;
}
function downloadNameForMediaItem(item, fallbackPrefix='canvas-output'){
    const localName = fileNameFromUrl(item?.url || '');
    const preferred = localName || item?.name || '';
    const ext = extensionForMediaItem(item);
    const randomName = `${fallbackPrefix}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}${ext}`;
    let name = safeExportFileName(preferred || randomName, randomName);
    if(!/\.[a-z0-9]{2,8}$/i.test(name)) name += ext;
    return name;
}
function downloadPreviewImage(){
    const image = currentEditImage().image;
    if(!image?.url) return;
    const name = downloadNameForMediaItem(image, 'image');
    const link = document.createElement('a');
    link.href = fileDownloadUrl(image);
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
}
function downloadPreviewFile(item){
    if(!item?.url) return;
    const name = downloadNameForMediaItem(item, 'output');
    const link = document.createElement('a');
    link.href = fileDownloadUrl(item);
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
}
function previewDownloadGroupItems(){
    const node = nodes.find(n => n.id === previewNavState.nodeId);
    return previewSourceImages(node, previewNavState.source)
        .filter(item => item?.url)
        .map((item, index) => ({...item, __index:index}))
        .sort((a, b) => {
            const ga = a.grid || {};
            const gb = b.grid || {};
            const rowDiff = Number(ga.row ?? a.__index) - Number(gb.row ?? b.__index);
            if(rowDiff) return rowDiff;
            const colDiff = Number(ga.col ?? a.__index) - Number(gb.col ?? b.__index);
            return colDiff || a.__index - b.__index;
        });
}
async function downloadPreviewGroup(){
    const node = nodes.find(n => n.id === previewNavState.nodeId);
    const items = previewDownloadGroupItems();
    if(!items.length) return;
    try {
        const filename = safeExportFileName(`${node?.title || 'image-group'}.zip`, 'image-group.zip');
        const response = await fetch('/api/canvas-assets/download', {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({
                filename,
                urls:items.map(item => fileDownloadUrl(item) || item.url).filter(Boolean),
                items:items.map((item, index) => ({url:fileDownloadUrl(item) || item.url, name:downloadNameForMediaItem(item, `image-${String(index + 1).padStart(2, '0')}`)}))
            })
        });
        if(!response.ok) throw new Error((await response.text()) || '批量下载失败');
        const blob = await response.blob();
        const href = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = href;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(href), 1200);
    } catch(e) {
        toast((e.message || '批量下载失败').slice(0, 160));
    }
}
// 分组节点（智能分组 或 含多张图的图片节点）——快捷栏显示「下载全部/解组」。
function isGroupShortcutNode(node){
    if(!node) return false;
    if(isSmartGroupNode(node)) return true;
    return isSmartImageNode(node) && !isHistoryGroupNode(node) && (node.images || []).filter(img => img?.url).length > 1;
}
// 下载分组节点里的全部图片（打包 zip），复用后端批量下载接口。
async function downloadGroupNodeImages(node){
    if(!node) return;
    const items = (node.type === 'smart-group' ? imagesForNode(node) : (node.images || []))
        .filter(item => item?.url && !isMaskImageItem(item));
    if(!items.length){ toast('没有可下载的图片'); return; }
    if(items.length === 1){ downloadPreviewFile(items[0]); return; }
    try {
        const filename = safeExportFileName(`${node.title || 'image-group'}.zip`, 'image-group.zip');
        const response = await fetch('/api/canvas-assets/download', {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({
                filename,
                urls:items.map(item => fileDownloadUrl(item) || item.url).filter(Boolean),
                items:items.map((item, index) => ({url:fileDownloadUrl(item) || item.url, name:downloadNameForMediaItem(item, `image-${String(index + 1).padStart(2, '0')}`)}))
            })
        });
        if(!response.ok) throw new Error((await response.text()) || '批量下载失败');
        const blob = await response.blob();
        const href = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = href;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(href), 1200);
    } catch(e) {
        toast((e.message || '批量下载失败').slice(0, 160));
    }
}
