import { useEffect } from 'react';

type DeviceMode = 'mobile' | 'tablet' | 'desktop';

function detectDeviceMode(): { mode: DeviceMode; touch: boolean } {
  const width = window.innerWidth;
  const touch = window.matchMedia?.('(pointer: coarse)').matches
    || navigator.maxTouchPoints > 0;
  const mode: DeviceMode = width < 720 ? 'mobile' : width < 1100 ? 'tablet' : 'desktop';
  return { mode, touch };
}

export function useDeviceMode() {
  useEffect(() => {
    const applyDeviceMode = () => {
      const { mode, touch } = detectDeviceMode();
      document.documentElement.dataset.deviceMode = mode;
      document.documentElement.toggleAttribute('data-touch', touch);
    };

    applyDeviceMode();
    window.addEventListener('resize', applyDeviceMode);
    window.addEventListener('orientationchange', applyDeviceMode);
    return () => {
      window.removeEventListener('resize', applyDeviceMode);
      window.removeEventListener('orientationchange', applyDeviceMode);
    };
  }, []);
}
