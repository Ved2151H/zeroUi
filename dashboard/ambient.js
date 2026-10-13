/*
 * Zero UI | Emergency Console — ambient wiring
 * ============================================
 *
 * Pairs with ambient.css. Only the parts that cannot be done in pure CSS
 * live here:
 *
 *   1. the scroll-progress line (rAF-throttled, transform-only)
 *   2. staggered scroll-reveal (IntersectionObserver, one class flip per
 *      element, stagger capped at 240ms, observers disconnected after)
 *
 * Everything is skipped entirely under prefers-reduced-motion, where the
 * console's "motion reports state, never decorates" rule applies unbroken:
 * nothing here is wired, nothing animates, nothing is observed.
 *
 * ambient.js?v= pairs with the ?v= pin in index.html like every other asset.
 */
(function () {
    'use strict';

    var mqReduced = window.matchMedia('(prefers-reduced-motion: reduce)');

    function init() {
        if (mqReduced.matches) return;   // reduced motion: ambient stays off

        injectWells();
        initScrollProgress();
        initScrollReveal();
    }

    /* ═══════════ 0. The background wells ═══════════ */

    function injectWells() {
        if (document.querySelector('.ambient-wells')) return;
        // Fixed, pointer-transparent, z-index 0 in the CSS; app.js's surface
        // switch keeps working because ambient.css hides the wells on 'deep'.
        document.body.insertBefore(
            Object.assign(document.createElement('div'), {
                className: 'ambient-wells',
                'aria-hidden': 'true',
            }),
            document.body.firstChild,
        );
    }

    /* ═══════════ 1. Scroll progress line ═══════════ */

    function initScrollProgress() {
        var topbar = document.querySelector('.topbar');
        if (!topbar) return;

        var line = document.createElement('div');
        line.className = 'scroll-progress';
        line.dataset.active = 'false';
        topbar.appendChild(line);

        var ticking = false;

        function update() {
            ticking = false;
            // Any scrollable region in the console reports its own depth; the
            // furthest progress wins so nested scrollers (queue on phones,
            // doc views) each move the line while they own the screen.
            var progress = 0;
            var scrollers = document.querySelectorAll('.views, .emergencies-list, .scroll-y');
            for (var i = 0; i < scrollers.length; i++) {
                var el = scrollers[i];
                var max = el.scrollHeight - el.clientHeight;
                if (max > 40) {   // ignore near-static containers
                    progress = Math.max(progress, (el.scrollTop || 0) / max);
                }
            }
            line.style.transform = 'scaleX(' + progress.toFixed(4) + ')';
            line.dataset.active = progress > 0.001 ? 'true' : 'false';
        }

        function onScroll() {
            if (!ticking) {
                ticking = true;
                // setTimeout rather than rAF: rAF callbacks never run in a
                // page the compositor is not painting (a hidden preview, a
                // background tab), and the line would freeze there. A 16ms
                // timeout is the same cadence as one frame, transform-only,
                // and keeps working in every environment.
                setTimeout(update, 16);
            }
        }

        // Capture phase, not window: scroll events on elements do not
        // bubble, so a window listener never sees the queue or a doc view
        // scroll. Capture on document sees every one of them.
        document.addEventListener('scroll', onScroll, { capture: true, passive: true });
        window.addEventListener('resize', onScroll, { passive: true });
        update();
    }

    /* ═══════════ 2. Scroll reveal ═══════════ */

    function initScrollReveal() {
        if (!('IntersectionObserver' in window)) return;   // old engines: content simply shows

        var observer = new IntersectionObserver(onIntersect, {
            root: null,           // viewport-visible check works for nested scrollers
            rootMargin: '0px 0px -8% 0px',
            threshold: 0.05,
        });

        var order = 0;

        function onIntersect(entries) {
            entries.forEach(function (entry) {
                if (!entry.isIntersecting) return;
                var el = entry.target;
                el.style.animationDelay = Math.min(order * 40, 240) + 'ms';
                order = (order + 1) % 8;   // cap the wave length
                el.classList.add('revealed');
                el.classList.remove('reveal-pending');
                observer.unobserve(el);    // one settle per element, ever
            });
        }

        function watch(el) {
            if (!el.classList.contains('reveal')) {
                el.classList.add('reveal');
            }
            observer.observe(el);
        }

        // Queue cards: the list rebuilds wholesale, so reveal only cards that
        // have not been seen before. Cards the observer already released stay
        // revealed because the class lives on the element, not the observer.
        // A rebuild keeps markup fresh but the observer re-arms per element.
        var list = document.querySelector('.emergencies-list');
        if (list) {
            var schedule = null;
            var mo = new MutationObserver(function () {
                // Batch the 40 appendChild calls from one rebuild into a
                // single walk. setTimeout rather than rAF for the same reason
                // as the progress line: rAF does not fire in unpainted pages.
                if (schedule) return;
                schedule = setTimeout(function () {
                    schedule = null;
                    list.querySelectorAll('.emergency-card:not(.revealed)').forEach(watch);
                }, 60);
            });
            mo.observe(list, { childList: true });
            // Seed whatever the first paint already produced
            list.querySelectorAll('.emergency-card:not(.revealed)').forEach(watch);
        }

        // Document views (settings / analytics / reports) settle as they enter
        document.querySelectorAll('.doc-inner').forEach(function (doc) {
            Array.prototype.forEach.call(doc.children, function (child, i) {
                // Headers first; depth grows with position, capped
                child.style.transitionDelay = Math.min(i * 30, 180) + 'ms';
                watch(child);
            });
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
