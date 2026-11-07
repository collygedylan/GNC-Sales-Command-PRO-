(function installCardWindow(root) {
    'use strict';
    if (root.GncCardWindow) return;
    const active = new Set();
    const now = () => root.performance?.now?.() || Date.now();
    const raf = fn => root.requestAnimationFrame(fn);
    class Heights {
        constructor(count, estimate) {
            this.count = count; this.values = new Float64Array(count); this.values.fill(estimate);
            this.tree = new Float64Array(count + 1);
            for (let i = 1; i <= count; i++) this.tree[i] = estimate * (i & -i);
        }
        sum(end) { let result = 0; for (let i = end; i > 0; i -= i & -i) result += this.tree[i]; return result; }
        set(index, value) {
            const delta = value - this.values[index]; if (Math.abs(delta) < 0.5) return false;
            this.values[index] = value;
            for (let i = index + 1; i <= this.count; i += i & -i) this.tree[i] += delta;
            return true;
        }
        at(offset) {
            let index = 0, sum = 0, bit = 1;
            while (bit * 2 <= this.count) bit *= 2;
            for (; bit; bit >>= 1) { const next = index + bit; if (next <= this.count && sum + this.tree[next] <= offset) { index = next; sum += this.tree[next]; } }
            return Math.min(index, Math.max(0, this.count - 1));
        }
    }
    function destroy(container) { container?.__gncCardWindow?.destroy(); }
    function mount(container, options) {
        if (!container || !options || !Array.isArray(options.rows) || typeof options.renderRow !== 'function') return null;
        const previous = container.__gncCardWindow;
        if (previous && previous.signature === options.signature && previous.rows === options.rows && !previous.disposed) { previous.refresh(false); return previous; }
        const old = previous?.snapshot();
        destroy(container);
        const rows = options.rows, scrollRoot = options.scrollRoot || container;
        const doc = container.ownerDocument;
        const nodes = new Map(), pending = new Map();
        let frame = 0, disposed = false, columns = old?.columns || 1, gap = old?.gap ?? 12;
        let width = old?.width || 0, heights = new Heights(Math.ceil(rows.length / columns), Math.max(48, Number(options.estimatedHeight) || 320) + gap);
        if (old && old.rows.length === rows.length && old.columns === columns) heights = old.heights;
        let start = 0, end = 0, desiredStart = 0, desiredEnd = 0, baseOffset = 0, prefixHeight = 0, contentOffset = 0, measuring = true, needsReset = false;
        let stickBottom = false, internalScroll = NaN;
        const pinned = new Set();
        const initialPosition = container.style.position;
        const initialOverflowAnchor = container.style.overflowAnchor;
        if (root.getComputedStyle(container).position === 'static') container.style.position = 'relative';
        const spacer = kind => { const node = doc.createElement('div'); node.dataset.cardWindowSpacer = kind; node.setAttribute('aria-hidden','true'); node.style.cssText = 'grid-column:1 / -1;pointer-events:none;padding:0;margin:0;min-height:0;'; return node; };
        const top = spacer('before'), bottom = spacer('after');
        const accessory = (html, kind) => { if (!html) return null; const node = doc.createElement('div'); node.dataset.cardWindowAccessory = kind; node.style.gridColumn = '1 / -1'; node.innerHTML = html; return node; };
        const prefix = accessory(options.prefixHtml, 'prefix'), footer = accessory(options.footerHtml, 'footer');
        const template = doc.createElement('template');
        const valid = () => !disposed && container.__gncCardWindow === controller && container.isConnected && (!options.isCurrent || options.isCurrent());
        function remove(index, node) { resize?.unobserve(node); options.onUnmount?.(node, rows[index], index); node.remove(); nodes.delete(index); pinned.delete(index); }
        function setScroll(value) { scrollRoot.scrollTop = value; internalScroll = scrollRoot.scrollTop; }
        function isAtBottom() { return scrollRoot.scrollTop > 0 && scrollRoot.scrollHeight-scrollRoot.clientHeight-scrollRoot.scrollTop <= 2; }
        function refresh(invalidate = false) {
            if (disposed) return;
            if (invalidate) { needsReset = true; measuring = true; }
            if (!frame && valid()) frame = raf(update);
        }
        function geometry() {
            const style = root.getComputedStyle(container);
            const nextWidth = container.clientWidth;
            const nextColumns = style.display === 'grid' ? Math.max(1, style.gridTemplateColumns.split(/\s+/).filter(value => value && value !== 'none').length) : 1;
            const nextGap = parseFloat(style.rowGap) || 0;
            const oldBand = heights.at(Math.max(0, scrollRoot.scrollTop-baseOffset));
            const anchorIndex = oldBand * columns, anchorOffset = scrollRoot.scrollTop-baseOffset-heights.sum(oldBand);
            const changed = needsReset || nextColumns !== columns || nextWidth !== width || nextGap !== gap;
            if (changed) {
                columns = nextColumns; width = nextWidth; gap = nextGap;
                heights = new Heights(Math.ceil(rows.length / columns), Math.max(48, Number(options.estimatedHeight) || 320) + gap);
                measuring = true; needsReset = false;
            }
            const rootRect = scrollRoot.getBoundingClientRect(), listRect = container.getBoundingClientRect();
            const padding = parseFloat(style.paddingTop) || 0;
            prefixHeight = prefix ? prefix.getBoundingClientRect().height + gap : 0;
            contentOffset = padding + prefixHeight;
            baseOffset = scrollRoot === container ? contentOffset : listRect.top - rootRect.top + scrollRoot.scrollTop + contentOffset;
            if (changed && anchorIndex > 0) {
                start = Math.floor(anchorIndex/columns)*columns;end=Math.min(rows.length,start+columns);
                setSpacers();
                setScroll(stickBottom ? scrollRoot.scrollHeight : baseOffset+heights.sum(Math.floor(anchorIndex/columns))+Math.max(0,anchorOffset));
            }
            return Math.max(0, scrollRoot.scrollTop - baseOffset);
        }
        function setSpacers() {
            const firstBand = Math.floor(start / columns), lastBand = Math.ceil(end / columns);
            const before = heights.sum(firstBand), after = heights.sum(heights.count) - heights.sum(lastBand);
            top.style.display = before > 0 ? '' : 'none'; top.style.height = Math.max(0, before - gap) + 'px';
            bottom.style.display = after > 0 ? '' : 'none'; bottom.style.height = Math.max(0, after - gap) + 'px';
            container.dataset.cardWindowStart = String(start); container.dataset.cardWindowEnd = String(end); container.dataset.cardWindowTotal = String(rows.length);
        }
        function measure() {
            if (!measuring || !nodes.size) return;
            measuring = false;
            const bandHeights = new Map();
            nodes.forEach((node, index) => { if(pinned.has(index))return;const band = Math.floor(index / columns),style=root.getComputedStyle(node);const height=node.getBoundingClientRect().height+(parseFloat(style.marginTop)||0)+(parseFloat(style.marginBottom)||0);bandHeights.set(band,Math.max(bandHeights.get(band)||0,height)); });
            const anchorBand = heights.at(Math.max(0, scrollRoot.scrollTop - baseOffset));
            const beforeAnchor = heights.sum(anchorBand);
            let changed = false;
            bandHeights.forEach((height, band) => { if (height > 0) changed = heights.set(band, height + gap) || changed; });
            if (changed) {
                const delta = heights.sum(anchorBand) - beforeAnchor;
                setSpacers();
                if (stickBottom) setScroll(scrollRoot.scrollHeight);
                else if (Math.abs(delta) > 0.5) setScroll(scrollRoot.scrollTop+delta);
            }
        }
        function makeNode(index) {
            template.innerHTML = options.renderRow(rows[index], index);
            let node = template.content.firstElementChild;
            if (!node || template.content.childElementCount !== 1) { node = doc.createElement('div'); node.append(template.content.cloneNode(true)); }
            node.dataset.cardWindowIndex = String(index);
            node.style.setProperty('content-visibility','visible','important');
            node.style.setProperty('contain-intrinsic-size','none','important');
            return node;
        }
        function update() {
            frame = 0;
            if (!valid()) return;
            const started = now();
            stickBottom = stickBottom || isAtBottom();
            geometry();
            measure();
            const viewportTop = Math.max(0,scrollRoot.scrollTop-baseOffset);
            const viewport = Math.max(1, scrollRoot.clientHeight || root.innerHeight || 700);
            const overscan = Math.min(1000, Math.max(360, viewport * 0.75));
            desiredStart = heights.at(Math.max(0, viewportTop - overscan)) * columns;
            desiredEnd = Math.min(rows.length, (heights.at(viewportTop + viewport + overscan) + 1) * columns);
            for (const index of pending.keys()) if (index < desiredStart || index >= desiredEnd) pending.delete(index);
            // Generation yields between rich cards; scrolling itself only queues one frame.
            for (let index = desiredStart; index < desiredEnd; index++) {
                if (!nodes.has(index) && !pending.has(index)) pending.set(index, makeNode(index));
                if (now() - started >= 4) break;
            }
            let complete = true;
            for (let index = desiredStart; index < desiredEnd; index++) if (!nodes.has(index) && !pending.has(index)) { complete = false; break; }
            if (complete) {
                const sameRange = start === desiredStart && end === desiredEnd;
                start = desiredStart; end = desiredEnd;
                for (const [index, node] of nodes) if (index < start || index >= end) {
                    if (node.contains(doc.activeElement)) {
                        pinned.add(index);
                        const style=root.getComputedStyle(container),left=parseFloat(style.paddingLeft)||0,right=parseFloat(style.paddingRight)||0,columnGap=parseFloat(style.columnGap)||gap;
                        const cardWidth=(width-left-right-columnGap*(columns-1))/columns;
                        node.style.setProperty('position','absolute','important');node.style.width=cardWidth+'px';node.style.left=(left+(index%columns)*(cardWidth+columnGap))+'px';node.style.top=(contentOffset+heights.sum(Math.floor(index/columns)))+'px';
                    } else remove(index,node);
                }
                const added = [];
                for (let index = end - 1, next = bottom; index >= start; index--) {
                    let node = nodes.get(index);
                    if (!node) { node = pending.get(index); pending.delete(index); nodes.set(index,node); added.push([node,index]); }
                    if (pinned.delete(index)) { node.style.removeProperty('position');node.style.removeProperty('width');node.style.removeProperty('left');node.style.removeProperty('top'); }
                    if (node.nextSibling !== next && !node.contains(doc.activeElement)) container.insertBefore(node,next);
                    next = node;
                }
                setSpacers();
                if (stickBottom) setScroll(scrollRoot.scrollHeight);
                added.forEach(([node,index]) => { resize?.observe(node); options.onMount?.(node,rows[index],index); });
                if (added.length || !sameRange) { measuring = true; refresh(); options.onRange?.({start,end,total:rows.length}); }
            } else refresh();
            controller.lastFrameMs = now() - started;
            controller.maxFrameMs = Math.max(controller.maxFrameMs, controller.lastFrameMs);
        }
        const resize = typeof root.ResizeObserver === 'function' ? new root.ResizeObserver(entries => {
            if (!valid()) return;
            if (entries.some(entry => entry.target !== container || entry.contentRect.width !== width)) { measuring = true; refresh(); }
        }) : null;
        const controller = {rows,signature:options.signature,scope:options.scope,lastFrameMs:0,maxFrameMs:0,get disposed(){return disposed;},refresh,
            debug:()=>({columns,gap,start,end,desiredStart,desiredEnd,baseOffset,prefixHeight,frame,pending:pending.size,scrollTop:scrollRoot.scrollTop,valid:valid()}),
            snapshot:()=>({rows,columns,gap,heights,width}),
            destroy() { if (disposed) return; disposed=true; if(frame)root.cancelAnimationFrame(frame); resize?.disconnect(); scrollRoot.removeEventListener('scroll', onScroll);container.removeEventListener('focusout',onFocusOut);container.style.position=initialPosition;container.style.overflowAnchor=initialOverflowAnchor; nodes.forEach((node,index)=>options.onUnmount?.(node,rows[index],index)); pending.clear(); active.delete(controller); if(container.__gncCardWindow===controller){delete container.__gncCardWindow;delete container.dataset.cardWindowTotal;delete container.dataset.cardWindowStart;delete container.dataset.cardWindowEnd;} },
            lifecycle() { if (!valid()) { if(frame)root.cancelAnimationFrame(frame);frame=0;pending.clear();resize?.disconnect(); } else { resize?.observe(container);nodes.forEach(node=>resize?.observe(node));refresh(); } }
        };
        const onScroll = () => { if(Math.abs(scrollRoot.scrollTop-internalScroll)>1||!Number.isFinite(internalScroll))stickBottom=isAtBottom();refresh(); };
        const onFocusOut = () => refresh();
        container.__gncCardWindow = controller;
        active.add(controller);
        // Keep the first rich card immediately available, then prepare its nearby window.
        const initial = rows.length ? Math.min(rows.length-1, Math.max(0, Math.floor(scrollRoot.scrollTop / (Math.max(48, Number(options.estimatedHeight)||320)+gap))*columns)) : -1;
        const first = initial >= 0 ? makeNode(initial) : null;
        if (first) { nodes.set(initial,first); start=initial;end=initial+1; }
        container.replaceChildren(...[prefix,top,first,bottom,footer].filter(Boolean));
        container.style.overflowAnchor = 'none';
        setSpacers();
        if (first) { resize?.observe(first);options.onMount?.(first,rows[initial],initial); }
        resize?.observe(container);
        scrollRoot.addEventListener('scroll',onScroll,{passive:true});
        container.addEventListener('focusout',onFocusOut,{passive:true});
        refresh();
        return controller;
    }
    const refreshAll = () => active.forEach(controller=>controller.refresh(true));
    root.addEventListener('resize',refreshAll,{passive:true});
    root.AgMetricLifecycle?.subscribe?.(event=>active.forEach(controller=>event.type==='session'?controller.destroy():controller.lifecycle()));
    root.document?.addEventListener('visibilitychange',()=>active.forEach(controller=>controller.lifecycle()),{passive:true});
    root.GncCardWindow = Object.freeze({mount,destroy,refresh:container=>container?.__gncCardWindow?.refresh(true),refreshAll});
})(window);
