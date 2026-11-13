import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

export function assertDarkEmeraldTheme() {
    const bundle = readFileSync(new URL('../../assets/ops-precision-pilot.js', import.meta.url), 'utf8');
    const { window } = new JSDOM('<meta name="theme-color"><div id="bottom-nav"></div>', {
        url: 'https://fixture.invalid', runScripts: 'outside-only', pretendToBeVisual: true
    });
    try {
        window.localStorage.setItem('gnc_last_theme_v1', 'light');
        window.document.documentElement.classList.add('outdoor-mode');
        window.eval(bundle);
        const appearance = window.__gncOpsPilot;
        for (const view of ['home', 'drive', 'detail', 'av', 'request', 'communication', 'managers', 'docks', 'reports']) {
            appearance.primeCachedAppearance({ userKey: 'theme_fixture', activeView: view });
            assert.equal(appearance.getState().preferences.themeMode, 'light');
            assert.equal(appearance.getState().effectiveTheme, 'dark');
            assert.equal(window.document.documentElement.classList.contains('dark'), true);
            assert.equal(window.document.documentElement.dataset.theme, 'dark');
            assert.equal(window.document.body.dataset.opsTheme, 'dark');
            assert.equal(window.document.getElementById('bottom-nav').dataset.resolvedTheme, 'dark');
        }
    } finally { window.close(); }
}
