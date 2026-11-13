import type { Page } from '@playwright/test';

export function measureNavigationFallback(page: Page) {
  return page.locator('#bottom-nav').evaluate(readNavigationFallback);
}

function readNavigationFallback(nav: Element) {
  const toRgba = (value: string) => (value.match(/[\d.]+/g) || []).map(Number);
  const luminance = (channels: number[]) => {
    const linear = channels.map((channel) => {
      const normalized = channel / 255;
      return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  };
  const contrast = (foreground: string, background: string, surface: string) => {
    const surfaceRgb = toRgba(surface).slice(0, 3);
    const backgroundRgba = toRgba(background);
    const alpha = backgroundRgba[3] ?? 1;
    const compositedBackground = backgroundRgba.slice(0, 3).map((channel, index) => channel * alpha + surfaceRgb[index] * (1 - alpha));
    const [lighter, darker] = [luminance(toRgba(foreground)), luminance(compositedBackground)].sort((a, b) => b - a);
    return (lighter + 0.05) / (darker + 0.05);
  };
  const inactive = nav.querySelector('.footer-nav-btn:not(.active)') as HTMLElement;
  const active = nav.querySelector('.footer-nav-btn.active') as HTMLElement;
  const label = inactive.querySelector('span') as HTMLElement;
  const navStyle = getComputedStyle(nav);
  const inactiveStyle = getComputedStyle(inactive);
  const activeStyle = getComputedStyle(active);
  return {
    background: navStyle.backgroundColor,
    border: navStyle.borderTopColor,
    inactiveColor: inactiveStyle.color,
    activeColor: activeStyle.color,
    activeBackground: activeStyle.backgroundColor,
    inactiveContrast: contrast(inactiveStyle.color, navStyle.backgroundColor, navStyle.backgroundColor),
    activeContrast: contrast(activeStyle.color, activeStyle.backgroundColor, navStyle.backgroundColor),
    labelOpacity: getComputedStyle(label).opacity,
    resolvedTheme: (nav as HTMLElement).dataset.resolvedTheme,
  };
}
