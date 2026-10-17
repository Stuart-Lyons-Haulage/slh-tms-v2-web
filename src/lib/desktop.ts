export type DesktopSaveOptions = {
  defaultName: string;
  content: string;
  encoding?: 'utf8' | 'base64';
  filters?: Array<{ name: string; extensions: string[] }>;
};

export type DesktopBridge = {
  isDesktop: true;
  app: { getInfo: () => Promise<{ name: string; version: string; platform: string; serverUrl: string }> };
  files: { save: (options: DesktopSaveOptions) => Promise<{ saved: boolean; filePath?: string }> };
  print: { currentPage: () => Promise<{ printed: boolean }> };
  notifications: { show: (title: string, body: string) => Promise<{ shown: boolean }> };
  shell: { openExternal: (target: string) => Promise<{ opened: boolean }> };
};

declare global {
  interface Window {
    slhDesktop?: DesktopBridge;
  }
}

export function isDesktopApp(): boolean {
  return window.slhDesktop?.isDesktop === true;
}

export function desktopBridge(): DesktopBridge | undefined {
  return window.slhDesktop;
}
